const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const yaml = require('js-yaml')
const { writeUpdateManifest } = require('../scripts/lib/update-manifest.cjs')
const { settings, verifyChannel, publish } = require('../scripts/publish-update-channel.cjs')

function fixture(channel = 'stable-x64') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-publication-'))
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  const options = { target: 'target-updates', legacy: 'legacy-updates', channel, version: '1.2.3', fingerprint }
  for (const name of ['Automnia Setup-1.2.3-x64.exe', 'Automnia-1.2.3-x64.dmg', 'Automnia-1.2.3-x64.zip', 'Automnia-1.2.3-x64.AppImage']) {
    fs.writeFileSync(path.join(root, name), 'payload for ' + name)
  }
  for (const [source, alias] of [['latest.yml', 'stable-x64.yml'], ['latest-mac.yml', 'stable-x64-mac.yml'], ['latest-linux.yml', 'stable-x64-linux.yml']]) {
    fs.writeFileSync(path.join(root, source), 'version: 1.2.3\n')
    if (channel === 'stable-x64') fs.copyFileSync(path.join(root, source), path.join(root, alias))
  }
  const sign = (rolloutPercentage) => writeUpdateManifest({
    artifactRoot: root, outputDir: root, channel, version: options.version, minimumVersion: '0.0.0',
    privateKeyPem, rolloutPercentage,
  })
  sign(5)
  return { root, options, sign, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function fakeCloud() {
  const objects = new Map()
  const events = []
  return {
    objects, events,
    checkBucket(bucket) { events.push({ operation: 'check', bucket }) },
    copy(source, destination, immutable, metadata) {
      events.push({ operation: 'copy', source, destination, immutable, metadata })
      if (immutable && objects.has(destination)) throw new Error('generation precondition failed')
      const content = source.startsWith('gs://') ? objects.get(source) : fs.readFileSync(source)
      if (!content) throw new Error('source does not exist')
      objects.set(destination, Buffer.from(content))
    },
    describe(destination) {
      const value = objects.get(destination)
      if (!value) throw new Error('object does not exist')
      return { size: value.length, md5_hash: crypto.createHash('md5').update(value).digest('base64') }
    },
  }
}

test('x64 publication prepares both buckets before advancing matching channel metadata', () => {
  const f = fixture()
  try {
    const storage = fakeCloud()
    publish(f.root, f.options, 'release', storage)
    const writes = storage.events.filter((event) => event.operation === 'copy')
    const prefixes = ['gs://target-updates/stable-x64/', 'gs://legacy-updates/stable-x64/']
    for (const prefix of prefixes) {
      for (const name of ['stable-x64.yml', 'stable-x64-mac.yml', 'stable-x64-linux.yml', 'update-manifest.json', 'update-manifest.json.sig']) {
        assert.ok(storage.objects.has(prefix + name), prefix + name)
      }
      assert.deepEqual(storage.objects.get(prefix + 'stable-x64.yml'), storage.objects.get(prefix + 'latest.yml'))
      const mutable = writes.filter((event) => event.destination.startsWith(prefix) && !event.immutable)
      assert.equal(mutable.at(-1).destination, prefix + 'update-manifest.json')
      assert.ok(mutable.every((event) => event.metadata))
    }
    assert.ok(!writes.some((event) => /\/stable\//.test(event.destination)), 'shared stable channel must remain untouched')
    const firstMutable = writes.findIndex((event) => !event.immutable)
    assert.ok(writes.slice(firstMutable).every((event) => !event.immutable), 'both channels need immutable payloads before either pointer advances')
    assert.ok(writes.findIndex((event) => event.destination === prefixes[0] + 'update-manifest.json') <
      writes.findIndex((event) => event.destination === prefixes[1] + 'update-manifest.json'))
    assert.ok(writes.some((event) => event.source.startsWith('gs://target-updates/releases/')), 'copies between buckets should use GCS objects')
    assert.ok(writes.filter((event) => event.destination.includes('/releases/') && /(?:\.yml|update-manifest|update-signing)/.test(event.destination))
      .every((event) => event.immutable && event.metadata), 'version metadata must remain create-only and non-cacheable')

    // A retry with identical immutable bytes can resume, but cannot replace a conflicting object.
    publish(f.root, f.options, 'release', storage)
    storage.objects.set('gs://target-updates/releases/1.2.3/Automnia Setup-1.2.3-x64.exe', Buffer.from('wrong'))
    const previousWrites = storage.events.length
    assert.throws(() => publish(f.root, f.options, 'release', storage), /Immutable upload failed or conflicts/)
    assert.ok(!storage.events.slice(previousWrites).some((event) => event.operation === 'copy' && !event.immutable))
  } finally {
    f.cleanup()
  }
})

test('a failure preparing the legacy bucket cannot advance the target pointer', () => {
  const f = fixture()
  try {
    const storage = fakeCloud()
    const copy = storage.copy
    storage.copy = (...args) => {
      if (args[1].startsWith('gs://legacy-updates/releases/')) throw new Error('legacy write denied')
      return copy(...args)
    }
    assert.throws(() => publish(f.root, f.options, 'release', storage), /legacy write denied/)
    assert.ok(!storage.events.some((event) => event.operation === 'copy' && !event.immutable))
    assert.equal(storage.objects.has('gs://target-updates/stable-x64/update-manifest.json'), false)
  } finally {
    f.cleanup()
  }
})

test('promotion changes only its signed channel and refuses missing or changed legacy payloads', () => {
  const f = fixture()
  try {
    const storage = fakeCloud()
    publish(f.root, f.options, 'release', storage)
    f.sign(100)
    const start = storage.events.length
    publish(f.root, f.options, 'promote', storage)
    const writes = storage.events.slice(start).filter((event) => event.operation === 'copy')
    assert.ok(writes.length > 0)
    assert.ok(writes.every((event) => !event.immutable && event.destination.includes('/stable-x64/')))
    assert.ok(!writes.some((event) => event.destination.includes('/releases/')))
    assert.equal(JSON.parse(storage.objects.get('gs://legacy-updates/stable-x64/update-manifest.json')).rolloutPercentage, 100)

    storage.objects.delete('gs://legacy-updates/stable-x64/Automnia Setup-1.2.3-x64.exe')
    const beforeFailure = storage.events.length
    assert.throws(() => publish(f.root, f.options, 'promote', storage), /object does not exist/)
    assert.ok(!storage.events.slice(beforeFailure).some((event) => event.operation === 'copy'))
  } finally {
    f.cleanup()
  }
})

test('shared stable promotion remains separate and rejects a different signed channel or key', () => {
  const f = fixture('stable')
  try {
    const storage = fakeCloud()
    for (const bucket of [f.options.target, f.options.legacy]) {
      for (const name of fs.readdirSync(f.root).filter((name) => /\.(exe|dmg|zip|appimage)$/i.test(name))) {
        storage.objects.set('gs://' + bucket + '/stable/' + name, fs.readFileSync(path.join(f.root, name)))
      }
      storage.objects.set('gs://' + bucket + '/stable-x64/update-manifest.json', Buffer.from('keep'))
    }
    publish(f.root, f.options, 'promote', storage)
    for (const bucket of [f.options.target, f.options.legacy]) {
      assert.equal(storage.objects.get('gs://' + bucket + '/stable-x64/update-manifest.json').toString(), 'keep')
      assert.equal(JSON.parse(storage.objects.get('gs://' + bucket + '/stable/update-manifest.json')).channel, 'stable')
    }
    assert.throws(() => verifyChannel(f.root, { ...f.options, channel: 'stable-x64' }), /version or channel/)
    assert.throws(() => verifyChannel(f.root, { ...f.options, fingerprint: '0'.repeat(64) }), /does not match the trusted installed key/)
    fs.appendFileSync(path.join(f.root, 'Automnia Setup-1.2.3-x64.exe'), 'tampered')
    assert.throws(() => verifyChannel(f.root, f.options), /size mismatch|checksum mismatch/)
  } finally {
    f.cleanup()
  }
})

test('publication requires distinct buckets, an explicit channel, and the trusted key fingerprint', () => {
  const env = {
    AUTOMNIA_UPDATE_BUCKET: 'target-updates', AUTOMNIA_LEGACY_UPDATE_BUCKET: 'legacy-updates',
    AUTOMNIA_UPDATE_CHANNEL: 'stable-x64', AUTOMNIA_RELEASE_VERSION: 'v1.2.3',
    AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256: 'a'.repeat(64),
  }
  assert.equal(settings(env).version, '1.2.3')
  assert.throws(() => settings({ ...env, AUTOMNIA_LEGACY_UPDATE_BUCKET: '' }), /LEGACY_UPDATE_BUCKET/)
  assert.throws(() => settings({ ...env, AUTOMNIA_LEGACY_UPDATE_BUCKET: env.AUTOMNIA_UPDATE_BUCKET }), /must be distinct/)
  assert.throws(() => settings({ ...env, AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256: '' }), /TRUSTED_KEY_SHA256/)
  assert.throws(() => settings({ ...env, AUTOMNIA_UPDATE_CHANNEL: 'beta' }), /channel must be/)
})

test('publication CLI verifies the signed release before contacting storage', () => {
  const f = fixture()
  try {
    const env = {
      ...process.env,
      AUTOMNIA_UPDATE_BUCKET: f.options.target,
      AUTOMNIA_LEGACY_UPDATE_BUCKET: f.options.legacy,
      AUTOMNIA_UPDATE_CHANNEL: f.options.channel,
      AUTOMNIA_RELEASE_VERSION: 'v' + f.options.version,
      AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256: f.options.fingerprint,
      AUTOMNIA_UPDATE_OUTPUT_DIR: f.root,
    }
    const command = path.join(__dirname, '..', 'scripts', 'publish-update-channel.cjs')
    const valid = spawnSync(process.execPath, [command, 'verify'], { env, encoding: 'utf8' })
    assert.equal(valid.status, 0, valid.stderr)
    const invalid = spawnSync(process.execPath, [command, 'verify'], {
      env: { ...env, AUTOMNIA_UPDATE_CHANNEL: 'stable' }, encoding: 'utf8',
    })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /version or channel/)
  } finally {
    f.cleanup()
  }
})

test('identity-only promotion stops after read-only bucket preflight', () => {
  const file = path.join(__dirname, '..', '.github', 'workflows', 'promote-desktop-update.yml')
  const workflow = yaml.load(fs.readFileSync(file, 'utf8'))
  assert.equal(workflow.on.workflow_dispatch.inputs.identity_check_only.default, false)
  const steps = workflow.jobs.promote.steps
  const preflight = steps.findIndex((step) => step.run === 'node scripts/publish-update-channel.cjs preflight')
  assert.ok(preflight >= 0)
  const subsequent = steps.slice(preflight + 1)
  assert.ok(subsequent.some((step) => step.run === 'node scripts/publish-update-channel.cjs promote'))
  assert.ok(subsequent.every((step) => step.if === '${{ !inputs.identity_check_only }}'))
})

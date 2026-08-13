const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  collectArtifacts,
  createUpdateManifest,
  inferArch,
  inferPlatform,
  signManifest,
  verifyUpdateManifest,
  writeUpdateManifest,
} = require('../scripts/lib/update-manifest.cjs')

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function write(root, relative, contents = relative) {
  const filePath = path.join(root, relative)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
  return filePath
}

test('signed update manifests verify artifacts and reject tampering', () => {
  const root = tempRoot('automnia-update-test-')
  try {
    const release = path.join(root, 'release')
    const updates = path.join(release, 'updates')
    fs.mkdirSync(release, { recursive: true })
    const artifact = write(release, 'Automnia-Setup-0.0.6-x64.exe', 'signed-release-candidate')
    const { privateKey } = crypto.generateKeyPairSync('ed25519')

    const written = writeUpdateManifest({
      artifactRoot: release,
      outputDir: updates,
      product: 'Automnia',
      version: '0.0.6',
      minimumVersion: '0.0.5',
      channel: 'stable',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      keyId: 'unit-test',
    })
    assert.equal(written.signed, true)
    assert.equal(written.manifest.artifacts.length, 1)
    assert.equal(written.manifest.artifacts[0].platform, 'windows')
    assert.equal(written.manifest.artifacts[0].arch, 'x64')

    const verified = verifyUpdateManifest({
      artifactRoot: release,
      manifestPath: written.manifestPath,
      signaturePath: written.signaturePath,
      publicKeyPath: written.publicKeyPath,
      requireSigning: true,
    })
    assert.equal(verified.signed, true)
    assert.equal(verified.artifactCount, 1)

    fs.appendFileSync(artifact, 'tampered')
    assert.throws(() => verifyUpdateManifest({
      artifactRoot: release,
      manifestPath: written.manifestPath,
      signaturePath: written.signaturePath,
      publicKeyPath: written.publicKeyPath,
      requireSigning: true,
    }), /size mismatch|checksum mismatch/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('artifact discovery classifies platforms and excludes unpacked or evidence files', () => {
  const root = tempRoot('automnia-update-discovery-')
  try {
    write(root, 'Automnia-Setup-1.2.3-arm64.exe')
    write(root, 'Automnia-1.2.3-x64.dmg')
    write(root, 'Automnia-1.2.3-amd64.AppImage')
    write(root, 'Automnia-portable.zip')
    write(root, 'win-unpacked/Automnia.exe')
    write(root, 'linux-unpacked/automnia')
    write(root, 'evidence/proof.zip')
    write(root, 'updates/old.zip')
    write(root, 'Uninstall Automnia.exe')
    write(root, 'notes.txt')

    const artifacts = collectArtifacts(root)
    assert.deepEqual(artifacts.map((entry) => [entry.platform, entry.arch]), [
      ['linux', 'x64'],
      ['macos', 'x64'],
      ['portable', 'universal'],
      ['windows', 'arm64'],
    ])
    assert.equal(inferPlatform('thing.pkg'), 'macos')
    assert.equal(inferPlatform('thing.rpm'), 'linux')
    assert.equal(inferArch('thing-ia32.zip'), 'ia32')
    assert.equal(inferArch('thing.bin'), 'universal')
    assert.throws(() => collectArtifacts(root, ['../outside.exe']), /escapes artifact root/)
    assert.throws(() => collectArtifacts(root, ['missing.exe']), /is missing/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('unsigned update manifests are supported only when signing is optional', () => {
  const root = tempRoot('automnia-update-unsigned-')
  try {
    write(root, 'Automnia-1.0.0.deb')
    const output = path.join(root, 'updates')
    const written = writeUpdateManifest({ artifactRoot: root, outputDir: output, version: '1.0.0' })
    assert.equal(written.signed, false)
    assert.equal(verifyUpdateManifest({ artifactRoot: root, manifestPath: written.manifestPath }).signed, false)
    assert.throws(() => verifyUpdateManifest({ artifactRoot: root, manifestPath: written.manifestPath, requireSigning: true }), /required/)

    const partialSignature = path.join(output, 'update-manifest.json.sig')
    fs.writeFileSync(partialSignature, 'broken\n')
    assert.throws(() => verifyUpdateManifest({
      artifactRoot: root,
      manifestPath: written.manifestPath,
      signaturePath: partialSignature,
    }), /Partial update signing evidence/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('update manifest rejects unsafe shapes, duplicate entries, wrong keys, and empty releases', () => {
  const root = tempRoot('automnia-update-invalid-')
  try {
    assert.throws(() => createUpdateManifest({ artifactRoot: root, version: '1.0.0' }), /No distributable/)
    const artifact = write(root, 'Automnia-x86.msi', 'payload')
    const manifest = createUpdateManifest({ artifactRoot: root, version: '1.0.0', artifacts: [artifact] })
    const { privateKey: rsaKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    assert.throws(() => signManifest(manifest, { privateKeyPem: rsaKey.export({ type: 'pkcs8', format: 'pem' }) }), /requires Ed25519/)
    assert.throws(() => signManifest(manifest, { privateKeyPem: 'x', privateKeyFile: 'y' }), /either update signing PEM or file/)

    const manifestPath = path.join(root, 'invalid.json')
    fs.writeFileSync(manifestPath, JSON.stringify({ schema: 2 }))
    assert.throws(() => verifyUpdateManifest({ artifactRoot: root, manifestPath }), /schema must be 1/)

    const duplicate = { ...manifest, artifacts: [...manifest.artifacts, { ...manifest.artifacts[0] }] }
    fs.writeFileSync(manifestPath, JSON.stringify(duplicate))
    assert.throws(() => verifyUpdateManifest({ artifactRoot: root, manifestPath }), /Duplicate update artifact path/)

    const unsafe = { ...manifest, artifacts: [{ ...manifest.artifacts[0], file: '../outside.exe' }] }
    fs.writeFileSync(manifestPath, JSON.stringify(unsafe))
    assert.throws(() => verifyUpdateManifest({ artifactRoot: root, manifestPath }), /Unsafe update artifact path/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

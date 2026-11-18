#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { verifyUpdateManifest } = require('./lib/update-manifest.cjs')
const { parseVersion } = require('../electron/update-policy.cjs')

const signedMetadata = [
  'update-signing.json',
  'update-manifest-public-key.pem',
  'update-manifest.json.sig',
  'update-manifest.json',
]
const providerAliases = [
  ['latest.yml', 'stable-x64.yml'],
  ['latest-mac.yml', 'stable-x64-mac.yml'],
  ['latest-linux.yml', 'stable-x64-linux.yml'],
]

function settings(env) {
  const target = String(env.AUTOMNIA_UPDATE_BUCKET || '').trim()
  const legacy = String(env.AUTOMNIA_LEGACY_UPDATE_BUCKET || '').trim()
  const fingerprint = String(env.AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256 || '').trim().toLowerCase()
  const channel = String(env.AUTOMNIA_UPDATE_CHANNEL || '').trim()
  const version = String(env.AUTOMNIA_RELEASE_VERSION || '').trim().replace(/^v/, '')
  for (const [name, value] of [['AUTOMNIA_UPDATE_BUCKET', target], ['AUTOMNIA_LEGACY_UPDATE_BUCKET', legacy]]) {
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)) throw new Error(name + ' must be a bucket name without gs://')
  }
  if (target === legacy) throw new Error('Target and legacy update buckets must be distinct')
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256 must be the 64-character installed-key fingerprint')
  if (!['stable', 'stable-x64'].includes(channel)) throw new Error('Update channel must be stable or stable-x64')
  parseVersion(version)
  return { target, legacy, fingerprint, channel, version }
}

function verifyChannel(root, options) {
  const metadataPath = (name) => path.join(root, name)
  const publicKey = crypto.createPublicKey(fs.readFileSync(metadataPath('update-manifest-public-key.pem')))
  const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  if (fingerprint !== options.fingerprint) throw new Error('Update signing key does not match the trusted installed key')
  const result = verifyUpdateManifest({
    artifactRoot: root,
    manifestPath: metadataPath('update-manifest.json'),
    signaturePath: metadataPath('update-manifest.json.sig'),
    publicKeyPath: metadataPath('update-manifest-public-key.pem'),
    requireSigning: true,
  })
  if (result.manifest.channel !== options.channel || result.manifest.version !== options.version) {
    throw new Error('Signed release version or channel does not match the requested publication')
  }
  const summary = JSON.parse(fs.readFileSync(metadataPath('update-signing.json'), 'utf8'))
  const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')
  const signature = Buffer.from(fs.readFileSync(metadataPath('update-manifest.json.sig'), 'utf8').trim(), 'base64')
  if (summary.manifestSha256 !== hash(fs.readFileSync(metadataPath('update-manifest.json'))) ||
      summary.signatureSha256 !== hash(signature) || summary.publicKeySha256 !== fingerprint) {
    throw new Error('Update signing summary does not match the verified release')
  }
  return result.manifest
}

function listPublicationFiles(root, channel, manifest) {
  const files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  const allProvider = (name) => /^latest(?:-[a-z0-9._-]+)?\.yml$/i.test(name) || /^stable-x64(?:-[a-z0-9._-]+)?\.yml$/i.test(name)
  const provider = files.filter((name) => /^latest(?:-[a-z0-9._-]+)?\.yml$/i.test(name) ||
    (channel === 'stable-x64' && /^stable-x64(?:-[a-z0-9._-]+)?\.yml$/i.test(name)))
  for (const [extension, metadata] of [['.exe', 'latest.yml'], ['.dmg', 'latest-mac.yml'], ['.appimage', 'latest-linux.yml']]) {
    if (manifest.artifacts.some((item) => item.file.toLowerCase().endsWith(extension)) && !provider.includes(metadata)) {
      throw new Error('Missing provider metadata: ' + metadata)
    }
  }
  if (channel === 'stable-x64') {
    for (const [source, alias] of providerAliases) {
      if (files.includes(source) && (!files.includes(alias) ||
          !fs.readFileSync(path.join(root, source)).equals(fs.readFileSync(path.join(root, alias))))) {
        throw new Error('Missing or inconsistent x64 provider metadata: ' + alias)
      }
    }
  }
  for (const name of signedMetadata) if (!files.includes(name)) throw new Error('Missing signing metadata: ' + name)
  return {
    payloads: files.filter((name) => !allProvider(name) && !signedMetadata.includes(name)),
    provider,
  }
}

function gcloud(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    throw new Error('gcloud ' + args.slice(0, 3).join(' ') + ' failed: ' +
      String(result.error?.message || result.stderr || 'unknown error').trim().slice(-1200))
  }
  return result.stdout
}

const cloud = {
  checkBucket: (bucket) => gcloud(['storage', 'buckets', 'describe', 'gs://' + bucket, '--format=json']),
  copy: (source, destination, immutable, metadata = false) => gcloud([
    'storage', 'cp',
    ...(immutable ? ['--if-generation-match=0'] : []),
    metadata ? '--cache-control=no-store,max-age=0' : '--cache-control=public,max-age=31536000,immutable',
    source, destination,
  ]),
  describe: (destination) => JSON.parse(gcloud(['storage', 'objects', 'describe', destination, '--format=json'])),
}

function localDigest(file) {
  const hash = crypto.createHash('md5')
  const buffer = Buffer.alloc(4 * 1024 * 1024)
  const fd = fs.openSync(file, 'r')
  try {
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
  } finally {
    fs.closeSync(fd)
  }
  return { size: fs.statSync(file).size, md5: hash.digest('base64') }
}

function publish(root, options, mode, storage = cloud) {
  if (!['release', 'promote'].includes(mode)) throw new Error('Unknown publication mode')
  if (mode === 'release' && options.channel !== 'stable-x64') throw new Error('The x64 release workflow may publish only stable-x64')
  const manifest = verifyChannel(root, options)
  const { payloads, provider } = listPublicationFiles(root, options.channel, manifest)
  const buckets = [options.target, options.legacy]
  const uri = (bucket, prefix, name) => 'gs://' + bucket + '/' + prefix + '/' + name
  const releasePrefix = 'releases/' + options.version
  const digestCache = new Map()
  const matches = (name, destination) => {
    if (!digestCache.has(name)) digestCache.set(name, localDigest(path.join(root, name)))
    const expected = digestCache.get(name)
    const actual = storage.describe(destination)
    return Number(actual.size) === expected.size && actual.md5_hash === expected.md5
  }
  const immutable = (name, source, destination, metadata = false) => {
    try {
      storage.copy(source, destination, true, metadata)
    } catch (error) {
      try {
        if (matches(name, destination)) return
      } catch {
        // Retain the original copy failure when the destination cannot be read.
      }
      throw new Error('Immutable upload failed or conflicts at ' + destination + ': ' + error.message)
    }
  }
  for (const bucket of buckets) storage.checkBucket(bucket)

  if (mode === 'release') {
    // Upload once from the runner; use GCS-to-GCS copies for the other three locations.
    for (const name of [...payloads, ...provider, ...signedMetadata]) {
      immutable(name, path.join(root, name), uri(options.target, releasePrefix, name), !payloads.includes(name))
    }
    for (const bucket of buckets) {
      if (bucket === options.legacy) {
        for (const name of [...payloads, ...provider, ...signedMetadata]) {
          immutable(name, uri(options.target, releasePrefix, name), uri(bucket, releasePrefix, name), !payloads.includes(name))
        }
      }
      for (const name of payloads) {
        immutable(name, uri(options.target, releasePrefix, name), uri(bucket, options.channel, name))
      }
    }
  } else {
    // Do not advertise a promoted release unless its immutable payloads exist in both channels.
    for (const bucket of buckets) {
      for (const name of payloads) {
        const destination = uri(bucket, options.channel, name)
        if (!matches(name, destination)) throw new Error('Promoted payload differs at ' + destination)
      }
    }
  }

  // Complete the target first; an old client may immediately install a build pointing there.
  for (const bucket of buckets) {
    for (const name of [...provider, ...signedMetadata]) {
      storage.copy(path.join(root, name), uri(bucket, options.channel, name), false, true)
    }
  }
}

if (require.main === module) {
  try {
    const mode = process.argv[2]
    const options = settings(process.env)
    const root = path.resolve(process.env.AUTOMNIA_UPDATE_OUTPUT_DIR || 'release/update-channel')
    if (mode === 'preflight') {
      for (const bucket of [options.target, options.legacy]) cloud.checkBucket(bucket)
    } else if (mode === 'verify') {
      verifyChannel(root, options)
    } else {
      publish(root, options, mode)
    }
    console.log('[update-publication] ' + mode + ' complete for ' + options.channel + ' ' + options.version)
  } catch (error) {
    console.error('[update-publication] ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  }
}

module.exports = { settings, verifyChannel, listPublicationFiles, publish }

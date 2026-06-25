const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DISTRIBUTABLE_EXTENSIONS = [
  '.exe', '.msi', '.msix', '.appx', '.dmg', '.pkg', '.appimage', '.deb', '.rpm', '.zip', '.tar.gz',
]

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function manifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const stack = [path.resolve(root)]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile()) files.push(fullPath)
    }
  }
  return files
}

function isDistributable(filePath, artifactRoot) {
  const relative = normalizeRelative(path.relative(artifactRoot, filePath)).toLowerCase()
  if (!relative || relative.startsWith('../')) return false
  if (
    relative.startsWith('evidence/') ||
    relative.startsWith('updates/') ||
    relative.includes('/win-unpacked/') ||
    relative.startsWith('win-unpacked/') ||
    relative.includes('/linux-unpacked/') ||
    relative.startsWith('linux-unpacked/') ||
    relative.includes('/mac/') ||
    /(^|\/)uninstall[^/]*\.exe$/.test(relative)
  ) return false
  return DISTRIBUTABLE_EXTENSIONS.some((extension) => relative.endsWith(extension))
}

function inferPlatform(relativePath) {
  const value = relativePath.toLowerCase()
  if (/\.(exe|msi|msix|appx)$/.test(value)) return 'windows'
  if (/\.(dmg|pkg)$/.test(value)) return 'macos'
  if (/\.(appimage|deb|rpm)$/.test(value)) return 'linux'
  return 'portable'
}

function inferArch(relativePath) {
  const value = relativePath.toLowerCase()
  if (/(^|[-_.\/])(arm64|aarch64)([-_.\/]|$)/.test(value)) return 'arm64'
  if (/(^|[-_.\/])(ia32|x86)([-_.\/]|$)/.test(value)) return 'ia32'
  if (/(^|[-_.\/])(x64|amd64)([-_.\/]|$)/.test(value)) return 'x64'
  return 'universal'
}

function collectArtifacts(artifactRoot, explicitFiles = []) {
  const root = path.resolve(artifactRoot)
  const candidates = explicitFiles.length
    ? explicitFiles.map((filePath) => path.resolve(root, filePath))
    : walkFiles(root).filter((filePath) => isDistributable(filePath, root))
  const seen = new Set()
  const artifacts = []
  for (const filePath of candidates) {
    if (!isWithin(root, filePath)) throw new Error(`Update artifact escapes artifact root: ${filePath}`)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Update artifact is missing: ${filePath}`)
    const relative = normalizeRelative(path.relative(root, filePath))
    if (seen.has(relative)) throw new Error(`Duplicate update artifact: ${relative}`)
    seen.add(relative)
    const stat = fs.statSync(filePath)
    artifacts.push({
      platform: inferPlatform(relative),
      arch: inferArch(relative),
      file: relative,
      size: stat.size,
      sha256: sha256File(filePath),
    })
  }
  return artifacts.sort((left, right) => left.file.localeCompare(right.file))
}

function createUpdateManifest(options) {
  const artifacts = collectArtifacts(options.artifactRoot, options.artifacts || [])
  if (!artifacts.length) throw new Error(`No distributable update artifacts found under ${options.artifactRoot}`)
  return {
    schema: 1,
    product: options.product || 'DystopAI',
    version: String(options.version || '').trim(),
    channel: String(options.channel || 'stable').trim() || 'stable',
    generatedAt: options.generatedAt || new Date().toISOString(),
    minimumVersion: String(options.minimumVersion || options.version || '').trim(),
    artifacts,
  }
}

function loadPrivateKey(options = {}) {
  const pem = options.privateKeyPem || process.env.DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_PEM
  const filePath = options.privateKeyFile || process.env.DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_FILE
  if (pem && filePath) throw new Error('Configure either update signing PEM or file, not both')
  if (filePath) return crypto.createPrivateKey(fs.readFileSync(path.resolve(filePath), 'utf8'))
  if (pem) return crypto.createPrivateKey(String(pem).replace(/\\n/g, '\n'))
  return null
}

function signManifest(manifest, options = {}) {
  const privateKey = loadPrivateKey(options)
  if (!privateKey) return null
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Update signing requires Ed25519, got ${privateKey.asymmetricKeyType || 'unknown'}`)
  }
  const bytes = manifestBytes(manifest)
  const signature = crypto.sign(null, bytes, privateKey)
  const publicKey = crypto.createPublicKey(privateKey)
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  return {
    signature,
    publicKeyPem,
    summary: {
      schema: 1,
      algorithm: 'Ed25519',
      keyId: options.keyId || process.env.DYSTOPAI_UPDATE_SIGNING_KEY_ID || sha256Bytes(publicKeyDer).slice(0, 16),
      signedAt: new Date().toISOString(),
      manifestSha256: sha256Bytes(bytes),
      signatureSha256: sha256Bytes(signature),
      publicKeySha256: sha256Bytes(publicKeyDer),
    },
  }
}

function writeUpdateManifest(options) {
  const outputDir = path.resolve(options.outputDir)
  ensureDirectory(outputDir)
  const manifest = createUpdateManifest(options)
  const manifestPath = path.join(outputDir, 'update-manifest.json')
  fs.writeFileSync(manifestPath, manifestBytes(manifest))

  const signed = signManifest(manifest, options)
  const result = { manifest, manifestPath, signed: Boolean(signed) }
  if (!signed) return result

  const signaturePath = path.join(outputDir, 'update-manifest.json.sig')
  const publicKeyPath = path.join(outputDir, 'update-manifest-public-key.pem')
  const summaryPath = path.join(outputDir, 'update-signing.json')
  fs.writeFileSync(signaturePath, `${signed.signature.toString('base64')}\n`, { mode: 0o600 })
  fs.writeFileSync(publicKeyPath, signed.publicKeyPem, { mode: 0o644 })
  fs.writeFileSync(summaryPath, `${JSON.stringify(signed.summary, null, 2)}\n`, { mode: 0o644 })
  return { ...result, signaturePath, publicKeyPath, summaryPath, signing: signed.summary }
}

function verifyManifestShape(manifest) {
  if (!isRecord(manifest) || manifest.schema !== 1) throw new Error('Update manifest schema must be 1')
  for (const key of ['product', 'version', 'channel', 'generatedAt', 'minimumVersion']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Update manifest is missing ${key}`)
  }
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw new Error('Update manifest must include artifacts')
}

function verifyUpdateManifest(options) {
  const artifactRoot = path.resolve(options.artifactRoot)
  const manifestPath = path.resolve(options.manifestPath)
  const manifest = readJson(manifestPath)
  verifyManifestShape(manifest)
  const seen = new Set()
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact)) throw new Error('Update manifest artifact entries must be objects')
    const relative = normalizeRelative(artifact.file)
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Unsafe update artifact path: ${relative}`)
    if (seen.has(relative)) throw new Error(`Duplicate update artifact path: ${relative}`)
    seen.add(relative)
    if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) throw new Error(`Invalid SHA-256 for ${relative}`)
    const filePath = path.resolve(artifactRoot, relative)
    if (!isWithin(artifactRoot, filePath)) throw new Error(`Update artifact escapes root: ${relative}`)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Update artifact is missing: ${relative}`)
    const stat = fs.statSync(filePath)
    if (stat.size !== artifact.size) throw new Error(`Update artifact size mismatch for ${relative}`)
    const actual = sha256File(filePath)
    if (actual !== artifact.sha256) throw new Error(`Update artifact checksum mismatch for ${relative}`)
  }

  const signaturePath = options.signaturePath && path.resolve(options.signaturePath)
  const publicKeyPath = options.publicKeyPath && path.resolve(options.publicKeyPath)
  const requireSigning = Boolean(options.requireSigning)
  if (!signaturePath && !publicKeyPath) {
    if (requireSigning) throw new Error('Signed update manifest is required')
    return { manifest, signed: false, artifactCount: manifest.artifacts.length }
  }
  if (!signaturePath || !publicKeyPath || !fs.existsSync(signaturePath) || !fs.existsSync(publicKeyPath)) {
    throw new Error('Partial update signing evidence found')
  }
  const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8')
  if (/PRIVATE KEY/.test(publicKeyPem)) throw new Error('Update public key contains private-key material')
  const publicKey = crypto.createPublicKey(publicKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Update public key must be Ed25519')
  const signature = Buffer.from(fs.readFileSync(signaturePath, 'utf8').trim(), 'base64')
  if (!crypto.verify(null, manifestBytes(manifest), publicKey, signature)) {
    throw new Error('Update manifest signature verification failed')
  }
  return { manifest, signed: true, artifactCount: manifest.artifacts.length }
}

module.exports = {
  collectArtifacts,
  createUpdateManifest,
  inferArch,
  inferPlatform,
  manifestBytes,
  sha256File,
  signManifest,
  verifyUpdateManifest,
  writeUpdateManifest,
}

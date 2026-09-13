const crypto = require('node:crypto')
const path = require('node:path')

const MANIFEST_MAX_BYTES = 1024 * 1024
const SIGNATURE_MAX_BYTES = 4096
const PLATFORM_NAMES = new Set(['windows', 'macos', 'linux'])
const ARCH_NAMES = new Set(['x64', 'arm64', 'ia32', 'universal'])

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function manifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  if (!match) throw new Error(`Invalid semantic version: ${String(value || '')}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0
  if (!left.prerelease.length) return 1
  if (!right.prerelease.length) return -1
  const count = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function normalizeBaseUrl(value, options = {}) {
  const parsed = new URL(String(value || '').trim())
  const localhost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
  if (parsed.username || parsed.password) throw new Error('Update URL must not contain credentials')
  if (parsed.protocol !== 'https:' && !(options.allowInsecureLocalhost && localhost && parsed.protocol === 'http:')) {
    throw new Error('Update URL must use HTTPS')
  }
  if (parsed.search || parsed.hash) throw new Error('Update base URL must not contain a query or fragment')
  return parsed.toString().replace(/\/$/, '')
}

function safeArtifactPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null
  return normalized
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.schema !== 1) throw new Error('Update manifest schema must be 1')
  for (const key of ['product', 'version', 'channel', 'generatedAt', 'minimumVersion']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Update manifest is missing ${key}`)
  }
  parseVersion(manifest.version)
  parseVersion(manifest.minimumVersion)
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(manifest.channel)) throw new Error('Update manifest channel is invalid')
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error('Update manifest generatedAt is invalid')
  if (manifest.releaseNotesUrl !== undefined) {
    const releaseNotes = new URL(String(manifest.releaseNotesUrl))
    if (releaseNotes.protocol !== 'https:' || releaseNotes.username || releaseNotes.password) throw new Error('Release notes URL must use HTTPS')
  }
  if (manifest.mandatoryAfter !== undefined && !Number.isFinite(Date.parse(manifest.mandatoryAfter))) {
    throw new Error('Update manifest mandatoryAfter is invalid')
  }
  const rollout = manifest.rolloutPercentage === undefined ? 100 : Number(manifest.rolloutPercentage)
  if (!Number.isFinite(rollout) || rollout < 0 || rollout > 100) throw new Error('Update rollout percentage must be between 0 and 100')
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 32) {
    throw new Error('Update manifest must include a bounded artifact list')
  }
  const seen = new Set()
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact)) throw new Error('Update artifact entries must be objects')
    const file = safeArtifactPath(artifact.file)
    if (!file) throw new Error('Update artifact path is unsafe')
    if (seen.has(file)) throw new Error(`Duplicate update artifact: ${file}`)
    seen.add(file)
    if (!PLATFORM_NAMES.has(artifact.platform)) throw new Error(`Unsupported update platform: ${String(artifact.platform || '')}`)
    if (!ARCH_NAMES.has(artifact.arch)) throw new Error(`Unsupported update architecture: ${String(artifact.arch || '')}`)
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 16 * 1024 * 1024 * 1024) {
      throw new Error(`Invalid update artifact size: ${file}`)
    }
    if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) throw new Error(`Invalid update artifact checksum: ${file}`)
  }
  return manifest
}

function verifySignedManifest(manifestText, signatureText, publicKeyPem) {
  if (Buffer.byteLength(manifestText, 'utf8') > MANIFEST_MAX_BYTES) throw new Error('Update manifest is too large')
  if (Buffer.byteLength(signatureText, 'utf8') > SIGNATURE_MAX_BYTES) throw new Error('Update signature is too large')
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    throw new Error('Update manifest is not valid JSON')
  }
  validateManifest(manifest)
  const publicKey = crypto.createPublicKey(publicKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Update trust key must be Ed25519')
  const normalizedSignature = String(signatureText || '').trim()
  if (!testSignature(normalizedSignature)) throw new Error('Update signature encoding is invalid')
  const signature = Buffer.from(normalizedSignature, 'base64')
  if (signature.length !== 64 || signature.toString('base64') !== normalizedSignature) {
    throw new Error('Update signature encoding is invalid')
  }
  if (!crypto.verify(null, manifestBytes(manifest), publicKey, signature)) {
    throw new Error('Update manifest signature verification failed')
  }
  return manifest
}

// Kept separate so malformed base64 never reaches a permissive decoder path.
function testSignature(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

function selectArtifact(manifest, platform, arch) {
  const platformName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform
  const platformArtifacts = manifest.artifacts.filter((artifact) => artifact.platform === platformName)
  const exact = platformArtifacts.filter((artifact) => artifact.arch === arch)
  const universal = platformArtifacts.filter((artifact) => artifact.arch === 'universal')
  const candidates = exact.length ? exact : universal
  const preferredExtension = platformName === 'windows' ? '.exe' : platformName === 'macos' ? '.zip' : '.appimage'
  return candidates.find((artifact) => artifact.file.toLowerCase().endsWith(preferredExtension)) || candidates[0] || null
}

function isMandatoryUpdate(manifest, currentVersion, now = Date.now()) {
  if (compareVersions(currentVersion, manifest.minimumVersion) < 0) return true
  return Boolean(manifest.mandatoryAfter && Date.parse(manifest.mandatoryAfter) <= now)
}

function rolloutBucket(installationId, version) {
  const digest = crypto.createHash('sha256').update(`${installationId}\0${version}`).digest()
  return digest.readUInt32BE(0) / 0x100000000 * 100
}

function isRolloutEligible(manifest, installationId, mandatory = false) {
  if (mandatory) return true
  const percentage = manifest.rolloutPercentage === undefined ? 100 : Number(manifest.rolloutPercentage)
  return percentage >= 100 || (percentage > 0 && rolloutBucket(installationId, manifest.version) < percentage)
}

function artifactUrl(baseUrl, artifact) {
  const parsedBase = new URL(`${normalizeBaseUrl(baseUrl)}/`)
  const relative = safeArtifactPath(artifact.file)
  if (!relative) throw new Error('Update artifact path is unsafe')
  return new URL(relative.split('/').map(encodeURIComponent).join('/'), parsedBase).toString()
}

function expectedUpdateFilename(info) {
  const files = Array.isArray(info?.files) ? info.files : []
  const candidate = files[0]?.url || info?.path || ''
  try {
    return path.basename(decodeURIComponent(new URL(candidate, 'https://updates.invalid/').pathname))
  } catch {
    return path.basename(String(candidate || ''))
  }
}

module.exports = {
  MANIFEST_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  artifactUrl,
  compareVersions,
  expectedUpdateFilename,
  isMandatoryUpdate,
  isRolloutEligible,
  manifestBytes,
  normalizeBaseUrl,
  parseVersion,
  safeArtifactPath,
  selectArtifact,
  testSignature,
  validateManifest,
  verifySignedManifest,
}

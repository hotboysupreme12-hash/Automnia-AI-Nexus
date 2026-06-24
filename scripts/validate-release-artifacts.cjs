const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.resolve(process.env.DYSTOPAI_RELEASE_EVIDENCE_DIR || path.join(root, 'release', 'evidence'))
const artifactRoot = path.resolve(process.env.DYSTOPAI_RELEASE_ARTIFACT_ROOT || path.join(root, 'release'))
const allowNoArtifacts = process.env.DYSTOPAI_RELEASE_VALIDATE_ALLOW_NO_ARTIFACTS === '1'
const requireSigning = /^(1|true|yes)$/i.test(String(process.env.DYSTOPAI_RELEASE_REQUIRE_SIGNING || ''))

const sbomPath = path.join(evidenceDir, 'dystopai-sbom.cdx.json')
const checksumsPath = path.join(evidenceDir, 'checksums.sha256')
const evidenceSummaryPath = path.join(evidenceDir, 'release-evidence.json')
const signaturePath = path.join(evidenceDir, 'checksums.sha256.sig')
const publicKeyPath = path.join(evidenceDir, 'signing-public-key.pem')
const signingSummaryPath = path.join(evidenceDir, 'release-signing.json')

function relativePath(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/')
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath))
}

function readRequiredText(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`[release-validate] Missing ${label}: ${filePath}`)
  return fs.readFileSync(filePath, 'utf8')
}

function readRequiredJson(filePath, label) {
  try {
    return JSON.parse(readRequiredText(filePath, label))
  } catch (error) {
    throw new Error(`[release-validate] Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveManifestPath(manifestPath) {
  if (path.isAbsolute(manifestPath)) return path.resolve(manifestPath)
  return path.resolve(root, manifestPath)
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isEvidencePath(filePath) {
  return isWithin(evidenceDir, filePath)
}

function parseChecksumManifest(text) {
  const rows = []
  const malformed = []
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd()
    if (!line) continue
    const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line)
    if (!match) {
      malformed.push({ line: index + 1, value: rawLine })
      continue
    }
    rows.push({
      line: index + 1,
      expectedSha256: match[1],
      manifestPath: match[2],
      filePath: resolveManifestPath(match[2]),
    })
  }
  if (malformed.length) {
    const preview = malformed.slice(0, 5).map((row) => `line ${row.line}`).join(', ')
    throw new Error(`[release-validate] Malformed checksum manifest row(s): ${preview}`)
  }
  if (!rows.length) throw new Error('[release-validate] Checksum manifest is empty')
  return rows
}

function validateChecksums() {
  const manifestText = readRequiredText(checksumsPath, 'checksum manifest')
  const rows = parseChecksumManifest(manifestText)
  const mismatches = []
  let artifactCount = 0
  let evidenceChecksumFound = false

  for (const row of rows) {
    if (!fs.existsSync(row.filePath) || !fs.statSync(row.filePath).isFile()) {
      mismatches.push(`line ${row.line}: missing ${row.manifestPath}`)
      continue
    }
    const actualSha256 = sha256File(row.filePath)
    if (actualSha256 !== row.expectedSha256) {
      mismatches.push(`line ${row.line}: sha256 mismatch for ${row.manifestPath}`)
    }
    if (path.resolve(row.filePath) === path.resolve(sbomPath)) evidenceChecksumFound = true
    if (isWithin(artifactRoot, row.filePath) && !isEvidencePath(row.filePath)) artifactCount += 1
  }

  if (mismatches.length) {
    throw new Error(`[release-validate] Checksum validation failed:\n${mismatches.slice(0, 20).join('\n')}`)
  }
  if (!evidenceChecksumFound) throw new Error('[release-validate] Checksum manifest must include the generated SBOM')
  if (!allowNoArtifacts && artifactCount < 1) {
    throw new Error('[release-validate] No packaged artifacts were found in the checksum manifest. Run packaging before release validation.')
  }

  return { checksumCount: rows.length, artifactCount }
}

function validateSbom() {
  const sbom = readRequiredJson(sbomPath, 'SBOM')
  if (sbom.bomFormat !== 'CycloneDX') throw new Error('[release-validate] SBOM must use CycloneDX format')
  if (sbom.specVersion !== '1.5') throw new Error('[release-validate] SBOM must use CycloneDX specVersion 1.5')
  if (!Array.isArray(sbom.components) || sbom.components.length < 1) {
    throw new Error('[release-validate] SBOM must contain at least one component')
  }
  return { componentCount: sbom.components.length }
}

function validateEvidenceSummary(checksumCount, componentCount) {
  const summary = readRequiredJson(evidenceSummaryPath, 'release evidence summary')
  if (summary.schema !== 1) throw new Error('[release-validate] Release evidence summary schema must be 1')
  if (summary.checksumCount !== checksumCount) {
    throw new Error(`[release-validate] Release evidence summary checksumCount ${summary.checksumCount} does not match manifest count ${checksumCount}`)
  }
  if (summary.componentCount !== componentCount) {
    throw new Error(`[release-validate] Release evidence summary componentCount ${summary.componentCount} does not match SBOM count ${componentCount}`)
  }
  return summary
}

function validateSignatureIfPresent() {
  const signatureFiles = [signaturePath, publicKeyPath, signingSummaryPath]
  const existing = signatureFiles.filter((filePath) => fs.existsSync(filePath))
  if (!existing.length) {
    if (requireSigning) {
      throw new Error('[release-validate] Release signing evidence is required for this public release build. Run npm run release:sign with DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE or DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM before publishing.')
    }
    return { signed: false }
  }
  if (existing.length !== signatureFiles.length) {
    throw new Error('[release-validate] Partial release-signing evidence found. Expected signature, public key, and signing summary.')
  }

  const checksums = fs.readFileSync(checksumsPath)
  const signature = Buffer.from(readRequiredText(signaturePath, 'checksum signature').trim(), 'base64')
  const publicKeyPem = readRequiredText(publicKeyPath, 'signing public key')
  if (/PRIVATE KEY/.test(publicKeyPem)) throw new Error('[release-validate] Signing public key file contains private-key material')
  const publicKey = crypto.createPublicKey(publicKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`[release-validate] Expected Ed25519 signing public key, got ${publicKey.asymmetricKeyType || 'unknown'}`)
  }
  if (!crypto.verify(null, checksums, publicKey, signature)) {
    throw new Error('[release-validate] Checksum signature verification failed')
  }

  const summary = readRequiredJson(signingSummaryPath, 'release signing summary')
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  if (summary.algorithm !== 'Ed25519') throw new Error('[release-validate] Signing summary algorithm must be Ed25519')
  if (summary.signedFileSha256 !== sha256Bytes(checksums)) throw new Error('[release-validate] Signing summary signedFileSha256 does not match checksum manifest')
  if (summary.signatureSha256 !== sha256Bytes(signature)) throw new Error('[release-validate] Signing summary signatureSha256 does not match signature')
  if (summary.publicKeySha256 !== sha256Bytes(publicKeyDer)) throw new Error('[release-validate] Signing summary publicKeySha256 does not match public key')

  return { signed: true, keyId: summary.keyId || null }
}

function main() {
  const { checksumCount, artifactCount } = validateChecksums()
  const { componentCount } = validateSbom()
  validateEvidenceSummary(checksumCount, componentCount)
  const signature = validateSignatureIfPresent()

  console.log(`[release-validate] verified ${checksumCount} checksum(s)`)
  console.log(`[release-validate] verified ${artifactCount} packaged artifact file(s) under ${relativePath(artifactRoot)}`)
  console.log(`[release-validate] verified ${componentCount} SBOM component(s)`)
  console.log(signature.signed
    ? `[release-validate] verified Ed25519 checksum signature${signature.keyId ? ` (${signature.keyId})` : ''}`
    : '[release-validate] no signing evidence present; checksum signature verification skipped')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

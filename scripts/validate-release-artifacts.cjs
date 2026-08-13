const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { verifyUpdateManifest } = require('./lib/update-manifest.cjs')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.resolve(process.env.AUTOMNIA_RELEASE_EVIDENCE_DIR || path.join(root, 'release', 'evidence'))
const artifactRoot = path.resolve(process.env.AUTOMNIA_RELEASE_ARTIFACT_ROOT || path.join(root, 'release'))
const allowNoArtifacts = process.env.AUTOMNIA_RELEASE_VALIDATE_ALLOW_NO_ARTIFACTS === '1'
const requireSigning = /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_RELEASE_REQUIRE_SIGNING || process.env.AUTOMNIA_RELEASE_REQUIRE_SIGNING || ''))

const sbomPath = path.join(evidenceDir, 'automnia-sbom.cdx.json')
const checksumsPath = path.join(evidenceDir, 'checksums.sha256')
const evidenceSummaryPath = path.join(evidenceDir, 'release-evidence.json')
const signaturePath = path.join(evidenceDir, 'checksums.sha256.sig')
const publicKeyPath = path.join(evidenceDir, 'signing-public-key.pem')
const signingSummaryPath = path.join(evidenceDir, 'release-signing.json')
const distributionSigningPath = path.join(evidenceDir, 'distribution-signing.json')
const requiredDistributionTests = ['freshInstall', 'upgrade', 'uninstall', 'corruptedUpdate']
const updateDir = path.join(artifactRoot, 'updates')
const updateManifestPath = path.join(updateDir, 'update-manifest.json')
const updateSignaturePath = path.join(updateDir, 'update-manifest.json.sig')
const updatePublicKeyPath = path.join(updateDir, 'update-manifest-public-key.pem')
const updateSigningSummaryPath = path.join(updateDir, 'update-signing.json')


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

  return { checksumCount: rows.length, artifactCount, rows }
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
      throw new Error('[release-validate] Release signing evidence is required for this public release build. Run npm run release:sign with AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_FILE or AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM before publishing.')
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

function validateUpdateChannelIfPresent(checksumRows) {
  const requiredFiles = [updateManifestPath, updateSignaturePath, updatePublicKeyPath, updateSigningSummaryPath]
  const existing = requiredFiles.filter((filePath) => fs.existsSync(filePath))
  if (!existing.length) {
    if (requireSigning) {
      throw new Error('[release-validate] Public releases require a signed update manifest. Run npm run release:update-manifest with update signing credentials before release:evidence.')
    }
    return { present: false, signed: false, artifactCount: 0 }
  }
  if (existing.length !== requiredFiles.length) {
    throw new Error('[release-validate] Partial signed-update evidence found. Expected manifest, signature, public key, and signing summary.')
  }

  const checksumPaths = new Set(checksumRows.map((row) => normalizedManifestPath(row.manifestPath)))
  for (const filePath of requiredFiles) {
    const manifestPath = normalizedManifestPath(relativePath(filePath))
    if (!checksumPaths.has(manifestPath)) {
      throw new Error(`[release-validate] Signed update evidence is missing from checksums.sha256: ${manifestPath}`)
    }
  }

  const verified = verifyUpdateManifest({
    artifactRoot,
    manifestPath: updateManifestPath,
    signaturePath: updateSignaturePath,
    publicKeyPath: updatePublicKeyPath,
    requireSigning: true,
  })
  const summary = readRequiredJson(updateSigningSummaryPath, 'update signing summary')
  const manifestBytes = fs.readFileSync(updateManifestPath)
  const signature = Buffer.from(readRequiredText(updateSignaturePath, 'update signature').trim(), 'base64')
  const publicKey = crypto.createPublicKey(readRequiredText(updatePublicKeyPath, 'update public key'))
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  if (summary.algorithm !== 'Ed25519') throw new Error('[release-validate] Update signing summary algorithm must be Ed25519')
  if (summary.manifestSha256 !== sha256Bytes(manifestBytes)) throw new Error('[release-validate] Update signing summary manifestSha256 does not match manifest')
  if (summary.signatureSha256 !== sha256Bytes(signature)) throw new Error('[release-validate] Update signing summary signatureSha256 does not match signature')
  if (summary.publicKeySha256 !== sha256Bytes(publicKeyDer)) throw new Error('[release-validate] Update signing summary publicKeySha256 does not match public key')
  return { present: true, signed: verified.signed, artifactCount: verified.artifactCount }
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[release-validate] Distribution signing evidence must include ${label}`)
  }
  return value.trim()
}

function requireStatus(value, label, expected) {
  if (value !== expected) {
    throw new Error(`[release-validate] Distribution signing evidence ${label} must be ${expected}`)
  }
}

function normalizedManifestPath(value) {
  return String(value || '').replace(/\\/g, '/')
}

function isWindowsInstallerManifestPath(manifestPath) {
  const normalized = normalizedManifestPath(manifestPath).toLowerCase()
  if (normalized.includes('/win-unpacked/')) return false
  return normalized.endsWith('.exe') || normalized.endsWith('.msi') || normalized.endsWith('.msix') || normalized.endsWith('.appx')
}

function validateDistributionArtifactEntry(entry, checksumPaths) {
  const artifact = objectRecord(entry)
  if (!artifact) throw new Error('[release-validate] Distribution signing artifact entries must be objects')

  const platform = requireString(artifact.platform, 'artifact platform')
  const artifactPath = normalizedManifestPath(requireString(artifact.artifact, 'artifact path'))
  if (!checksumPaths.has(artifactPath)) {
    throw new Error(`[release-validate] Distribution signing artifact is not present in the signed checksum manifest: ${artifactPath}`)
  }

  const resolvedArtifact = resolveManifestPath(artifactPath)
  if (!isWithin(artifactRoot, resolvedArtifact) || isEvidencePath(resolvedArtifact)) {
    throw new Error(`[release-validate] Distribution signing artifact must be a packaged artifact under ${relativePath(artifactRoot)}: ${artifactPath}`)
  }

  const signing = objectRecord(artifact.signing)
  if (!signing) throw new Error(`[release-validate] Distribution signing artifact is missing signing details: ${artifactPath}`)
  requireStatus(signing.status, `for ${artifactPath}`, 'verified')
  requireString(signing.verificationCommand, `verification command for ${artifactPath}`)

  if (platform === 'windows') {
    if (!isWindowsInstallerManifestPath(artifactPath)) {
      throw new Error(`[release-validate] Windows public artifacts must be signed installer files, not unpacked directories: ${artifactPath}`)
    }
    requireStatus(signing.type, `type for ${artifactPath}`, 'authenticode')
    requireString(signing.signer, `Authenticode signer for ${artifactPath}`)
    requireString(signing.thumbprint, `Authenticode certificate thumbprint for ${artifactPath}`)
    requireString(signing.timestamp, `Authenticode timestamp for ${artifactPath}`)
  }

  if (platform === 'macos') {
    requireStatus(signing.type, `type for ${artifactPath}`, 'apple-developer-id')
    requireStatus(signing.notarizationStatus, `notarization status for ${artifactPath}`, 'verified')
    requireStatus(signing.stapled, `notarization stapling for ${artifactPath}`, true)
  }

  return {
    platform,
    artifactPath,
    signingType: signing.type,
  }
}

function validateDistributionSigningIfRequired(checksumRows, updateChannel) {
  if (!fs.existsSync(distributionSigningPath)) {
    if (requireSigning) {
      throw new Error('[release-validate] Distribution signing evidence is required for public release builds. Record Windows Authenticode signing, signed update channel, rollback, and install/upgrade/uninstall/corrupted-update test evidence in release/evidence/distribution-signing.json before running release:evidence and release:sign.')
    }
    return { present: false, windowsInstallerSigned: false }
  }

  const checksumPaths = new Set(checksumRows.map((row) => normalizedManifestPath(row.manifestPath)))
  const distributionManifestPath = normalizedManifestPath(relativePath(distributionSigningPath))
  if (!checksumPaths.has(distributionManifestPath)) {
    throw new Error('[release-validate] Distribution signing evidence must be included in the signed checksum manifest. Create release/evidence/distribution-signing.json before running npm run release:evidence.')
  }

  const evidence = readRequiredJson(distributionSigningPath, 'distribution signing evidence')
  if (evidence.schema !== 1) throw new Error('[release-validate] Distribution signing evidence schema must be 1')

  const artifacts = Array.isArray(evidence.artifacts) ? evidence.artifacts : []
  if (!artifacts.length) throw new Error('[release-validate] Distribution signing evidence must include at least one artifact')
  const artifactSummaries = artifacts.map((artifact) => validateDistributionArtifactEntry(artifact, checksumPaths))
  const windowsInstallerSigned = artifactSummaries.some((artifact) =>
    artifact.platform === 'windows' &&
    artifact.signingType === 'authenticode' &&
    isWindowsInstallerManifestPath(artifact.artifactPath))

  const distributionUpdateChannel = objectRecord(evidence.updateChannel)
  if (!distributionUpdateChannel) throw new Error('[release-validate] Distribution signing evidence must include updateChannel')
  requireStatus(distributionUpdateChannel.signed, 'updateChannel.signed', true)
  if (!updateChannel?.signed) throw new Error('[release-validate] Distribution evidence claims a signed update channel but the signed update manifest did not verify')
  requireStatus(distributionUpdateChannel.rollbackTested, 'updateChannel.rollbackTested', true)
  requireString(distributionUpdateChannel.verificationCommand, 'update channel verification command')

  const installTests = objectRecord(evidence.installTests)
  if (!installTests) throw new Error('[release-validate] Distribution signing evidence must include installTests')
  for (const testName of requiredDistributionTests) {
    const testResult = objectRecord(installTests[testName])
    if (!testResult) throw new Error(`[release-validate] Distribution signing evidence must include installTests.${testName}`)
    requireStatus(testResult.status, `installTests.${testName}.status`, 'passed')
    requireString(testResult.evidence, `installTests.${testName}.evidence`)
  }

  if (requireSigning && !windowsInstallerSigned) {
    throw new Error('[release-validate] Public release validation requires at least one signed Windows installer artifact with verified Authenticode evidence.')
  }

  return { present: true, windowsInstallerSigned, artifactCount: artifactSummaries.length }
}

function main() {
  const { checksumCount, artifactCount, rows } = validateChecksums()
  const { componentCount } = validateSbom()
  validateEvidenceSummary(checksumCount, componentCount)
  const signature = validateSignatureIfPresent()
  const updateChannel = validateUpdateChannelIfPresent(rows)
  const distribution = validateDistributionSigningIfRequired(rows, updateChannel)

  console.log(`[release-validate] verified ${checksumCount} checksum(s)`)
  console.log(`[release-validate] verified ${artifactCount} packaged artifact file(s) under ${relativePath(artifactRoot)}`)
  console.log(`[release-validate] verified ${componentCount} SBOM component(s)`)
  console.log(updateChannel.present
    ? `[release-validate] verified signed update manifest for ${updateChannel.artifactCount} artifact(s)`
    : '[release-validate] no update manifest present; update-channel validation skipped')
  console.log(signature.signed
    ? `[release-validate] verified Ed25519 checksum signature${signature.keyId ? ` (${signature.keyId})` : ''}`
    : '[release-validate] no signing evidence present; checksum signature verification skipped')
  console.log(distribution.present
    ? `[release-validate] verified distribution signing evidence for ${distribution.artifactCount} artifact(s)`
    : '[release-validate] no distribution signing evidence present; consumer-distribution validation skipped')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

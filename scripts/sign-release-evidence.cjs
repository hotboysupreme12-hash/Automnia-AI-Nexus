const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.resolve(process.env.DYSTOPAI_RELEASE_EVIDENCE_DIR || path.join(root, 'release', 'evidence'))
const checksumsPath = path.join(evidenceDir, 'checksums.sha256')
const signaturePath = path.join(evidenceDir, 'checksums.sha256.sig')
const publicKeyPath = path.join(evidenceDir, 'signing-public-key.pem')
const signingSummaryPath = path.join(evidenceDir, 'release-signing.json')

function relativePath(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/')
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[release-signing] Missing ${label}: ${filePath}. Run npm run release:evidence first.`)
  }
  return fs.readFileSync(filePath)
}

function readPrivateKeyPem() {
  const inlinePem = process.env.DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM
  if (inlinePem && inlinePem.trim()) return inlinePem

  const keyFile = process.env.DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE
  if (keyFile && keyFile.trim()) {
    return fs.readFileSync(path.resolve(keyFile), 'utf8')
  }

  throw new Error(
    '[release-signing] Missing signing key. Set DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE or DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM.',
  )
}

function loadPrivateKey() {
  const key = readPrivateKeyPem()
  const privateKey = crypto.createPrivateKey({
    key,
    passphrase: process.env.DYSTOPAI_RELEASE_SIGNING_PASSPHRASE || undefined,
  })
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`[release-signing] Expected an Ed25519 private key, got ${privateKey.asymmetricKeyType || 'unknown'}.`)
  }
  return privateKey
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })

  const checksums = readRequiredFile(checksumsPath, 'checksum manifest')
  const privateKey = loadPrivateKey()
  const publicKey = crypto.createPublicKey(privateKey)
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  const signature = crypto.sign(null, checksums, privateKey)
  const generatedAt = new Date().toISOString()
  const keyId = process.env.DYSTOPAI_RELEASE_SIGNING_KEY_ID?.trim() || sha256Bytes(publicKeyDer).slice(0, 16)

  fs.writeFileSync(signaturePath, `${signature.toString('base64')}\n`)
  fs.writeFileSync(publicKeyPath, publicKeyPem)
  fs.writeFileSync(signingSummaryPath, `${JSON.stringify({
    schema: 1,
    generatedAt,
    algorithm: 'Ed25519',
    keyId,
    signedFile: relativePath(checksumsPath),
    signedFileSha256: sha256Bytes(checksums),
    signatureFile: relativePath(signaturePath),
    signatureEncoding: 'base64',
    signatureSha256: sha256Bytes(signature),
    publicKeyFile: relativePath(publicKeyPath),
    publicKeySha256: sha256Bytes(publicKeyDer),
    evidenceDir: relativePath(evidenceDir),
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    hostname: os.hostname(),
    ci: {
      githubRunId: process.env.GITHUB_RUN_ID || null,
      githubSha: process.env.GITHUB_SHA || null,
      githubRef: process.env.GITHUB_REF || null,
    },
  }, null, 2)}\n`)

  console.log(`[release-signing] signed ${relativePath(checksumsPath)}`)
  console.log(`[release-signing] wrote ${relativePath(signaturePath)}`)
  console.log(`[release-signing] wrote ${relativePath(publicKeyPath)}`)
  console.log(`[release-signing] wrote ${relativePath(signingSummaryPath)}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

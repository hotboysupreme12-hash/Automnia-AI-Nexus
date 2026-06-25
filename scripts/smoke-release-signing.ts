import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const scripts = packageJson.scripts || {}
const signingSource = readFileSync(path.join(root, 'scripts/sign-release-evidence.cjs'), 'utf8')
const workflowSource = readFileSync(path.join(root, '.github/workflows/control-plane-ci.yml'), 'utf8')
const publicReleaseSource = readFileSync(path.join(root, '.github/workflows/public-release.yml'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
const governance = readFileSync(path.join(root, 'docs/RELEASE_GOVERNANCE.md'), 'utf8')

assert.match(signingSource, /DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE/, 'release signing must support private-key file input')
assert.match(signingSource, /DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM/, 'release signing must support private-key env input')
assert.match(signingSource, /asymmetricKeyType !== 'ed25519'/, 'release signing must require Ed25519 keys')
assert.match(signingSource, /crypto\.sign\(null, checksums, privateKey\)/, 'release signing must sign the checksum manifest bytes')
assert.match(signingSource, /checksums\.sha256\.sig/, 'release signing must write a detached checksum signature')
assert.match(signingSource, /signing-public-key\.pem/, 'release signing must publish the verification public key')
assert.match(signingSource, /release-signing\.json/, 'release signing must write a signing evidence summary')
assert.match(scripts['release:sign'] || '', /node scripts\/sign-release-evidence\.cjs/, 'package scripts must expose release signing')
assert.match(scripts['smoke:release-signing'] || '', /tsx scripts\/smoke-release-signing\.ts/, 'package scripts must expose release signing smoke coverage')
assert.match(scripts['test:ci'] || '', /npm run smoke:release-signing/, 'test:ci must include release signing smoke coverage')
assert.match(workflowSource, /DYSTOPAI_RELEASE_SIGNING_ENABLED/, 'branch CI must expose an explicit optional evidence-signing switch')
assert.match(publicReleaseSource, /workflow_dispatch:/, 'dedicated public-release CI must allow manual qualification runs')
assert.match(publicReleaseSource, /tags:\s*\n\s*- 'v\*'/, 'dedicated public-release CI must run for version tags')
assert.match(publicReleaseSource, /DYSTOPAI_RELEASE_REQUIRE_SIGNING:\s*'1'/, 'public-release CI must fail closed without release signing')
assert.match(publicReleaseSource, /DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM/, 'public-release CI must use the configured release-signing private-key secret')
assert.match(publicReleaseSource, /npm run release:sign/, 'public-release CI must sign release evidence')
assert.match(readme, /npm run release:sign/, 'README must document release signing')
assert.match(readme, /DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE/, 'README must document private-key file based signing')
assert.match(readme, /DYSTOPAI_RELEASE_REQUIRE_SIGNING/, 'README must document mandatory public-release signing')
assert.match(governance, /Branch Protection/, 'release governance docs must define branch protection expectations')
assert.match(governance, /DYSTOPAI_RELEASE_REQUIRE_SIGNING/, 'release governance docs must define mandatory release signing')
assert.match(governance, /localhost API only/, 'release governance docs must document the local-only threat model')

const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-release-signing-'))
const evidenceDir = path.join(tempRoot, 'evidence')
mkdirSync(evidenceDir, { recursive: true })

const checksumBytes = Buffer.from([
  '71b5d1a54391b12a3a0a0b77a62b34f2a7337477602bd97a88b01b0cb595a0b7  release/DystopAI-test-artifact.txt',
  'a5c0651a209e63bc148152780c992c2901a27af98c5d890e60dd008ee840eadb  release/evidence/dystopai-sbom.cdx.json',
  '',
].join('\n'), 'utf8')
writeFileSync(path.join(evidenceDir, 'checksums.sha256'), checksumBytes)

const { privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const missingKey = spawnSync(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    DYSTOPAI_RELEASE_EVIDENCE_DIR: evidenceDir,
    DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM: '',
    DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE: '',
  },
  windowsHide: true,
})
assert.notEqual(missingKey.status, 0, 'release signing must fail closed when no private key is provided')
assert.match(missingKey.stderr, /Missing signing key/, 'release signing must explain missing signing key failures')

const result = spawnSync(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    DYSTOPAI_RELEASE_EVIDENCE_DIR: evidenceDir,
    DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
    DYSTOPAI_RELEASE_SIGNING_KEY_ID: 'test-release-key',
  },
  windowsHide: true,
})
assert.equal(result.status, 0, result.stderr || result.stdout)

const signaturePath = path.join(evidenceDir, 'checksums.sha256.sig')
const publicKeyPath = path.join(evidenceDir, 'signing-public-key.pem')
const summaryPath = path.join(evidenceDir, 'release-signing.json')

assert.ok(existsSync(signaturePath), 'release signing must write a detached signature')
assert.ok(existsSync(publicKeyPath), 'release signing must write a public key')
assert.ok(existsSync(summaryPath), 'release signing must write a signing summary')

const signature = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64')
const publicKeyPem = readFileSync(publicKeyPath, 'utf8')
const publicKey = createPublicKey(publicKeyPem)
assert.equal(verify(null, checksumBytes, publicKey, signature), true, 'release signature must verify against the checksum manifest and public key')

const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
  algorithm: string
  keyId: string
  signedFileSha256: string
  signatureEncoding: string
  publicKeySha256: string
}
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer

assert.equal(summary.algorithm, 'Ed25519')
assert.equal(summary.keyId, 'test-release-key')
assert.equal(summary.signedFileSha256, createHash('sha256').update(checksumBytes).digest('hex'))
assert.equal(summary.signatureEncoding, 'base64')
assert.equal(summary.publicKeySha256, createHash('sha256').update(publicKeyDer).digest('hex'))

const generatedEvidenceText = [
  readFileSync(signaturePath, 'utf8'),
  publicKeyPem,
  readFileSync(summaryPath, 'utf8'),
].join('\n')
assert.doesNotMatch(generatedEvidenceText, /PRIVATE KEY/, 'release signing evidence must never include private-key material')

console.log('release signing contract ok')

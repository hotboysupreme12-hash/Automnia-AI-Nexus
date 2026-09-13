const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const {
  compareVersions,
  isMandatoryUpdate,
  isRolloutEligible,
  manifestBytes,
  normalizeBaseUrl,
  selectArtifact,
  verifySignedManifest,
} = require('../electron/update-policy.cjs')

function fixture() {
  return {
    schema: 1,
    product: 'Automnia AI Nexus',
    version: '1.2.0',
    channel: 'stable',
    generatedAt: '2026-09-13T00:00:00.000Z',
    minimumVersion: '1.0.0',
    rolloutPercentage: 25,
    releaseNotesUrl: 'https://automnia.app/releases/1.2.0',
    artifacts: [
      { platform: 'windows', arch: 'x64', file: 'Automnia-Setup-1.2.0-x64.exe', size: 12, sha256: 'a'.repeat(64) },
      { platform: 'macos', arch: 'arm64', file: 'Automnia-1.2.0-arm64.dmg', size: 13, sha256: 'b'.repeat(64) },
      { platform: 'macos', arch: 'arm64', file: 'Automnia-1.2.0-arm64.zip', size: 14, sha256: 'c'.repeat(64) },
      { platform: 'linux', arch: 'x64', file: 'Automnia-1.2.0-x64.deb', size: 15, sha256: 'd'.repeat(64) },
      { platform: 'linux', arch: 'x64', file: 'Automnia-1.2.0-x64.AppImage', size: 16, sha256: 'e'.repeat(64) },
    ],
  }
}

test('runtime update policy verifies an embedded-key signature and rejects tampering', () => {
  const manifest = fixture()
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const text = manifestBytes(manifest).toString('utf8')
  const signature = crypto.sign(null, Buffer.from(text), privateKey).toString('base64')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  assert.deepEqual(verifySignedManifest(text, signature, publicPem), manifest)
  assert.throws(() => verifySignedManifest(text.replace('1.2.0', '9.2.0'), signature, publicPem), /signature verification failed/)
  assert.throws(() => verifySignedManifest(text, 'not-base64', publicPem), /signature encoding/)
})

test('semantic version, mandatory update, and deterministic rollout rules fail closed', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1)
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.10'), -1)
  assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1)
  assert.equal(isMandatoryUpdate(fixture(), '0.9.9'), true)
  assert.equal(isRolloutEligible({ ...fixture(), rolloutPercentage: 0 }, 'install-a', false), false)
  assert.equal(isRolloutEligible({ ...fixture(), rolloutPercentage: 0 }, 'install-a', true), true)
  assert.equal(isRolloutEligible(fixture(), 'stable-install-id', false), isRolloutEligible(fixture(), 'stable-install-id', false))
})

test('platform selection prefers updater-installable payloads', () => {
  const manifest = fixture()
  assert.match(selectArtifact(manifest, 'win32', 'x64').file, /\.exe$/i)
  assert.match(selectArtifact(manifest, 'darwin', 'arm64').file, /\.zip$/i)
  assert.match(selectArtifact(manifest, 'linux', 'x64').file, /\.AppImage$/i)
  assert.equal(selectArtifact(manifest, 'win32', 'arm64'), null)
})

test('update origins require credential-free HTTPS', () => {
  assert.equal(normalizeBaseUrl('https://updates.automnia.app/stable/'), 'https://updates.automnia.app/stable')
  assert.throws(() => normalizeBaseUrl('http://updates.automnia.app/stable'), /HTTPS/)
  assert.throws(() => normalizeBaseUrl('https://user:pass@updates.automnia.app/stable'), /credentials/)
  assert.equal(normalizeBaseUrl('http://127.0.0.1:9999/stable', { allowInsecureLocalhost: true }), 'http://127.0.0.1:9999/stable')
})

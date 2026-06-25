const assert = require('node:assert/strict')
const test = require('node:test')
const { assertTrustedHttpsUrl, parseSha256Manifest } = require('../electron/runtime-download-security.cjs')

test('runtime downloads require trusted HTTPS hosts', () => {
  assert.equal(assertTrustedHttpsUrl('https://nodejs.org/dist/index.json').hostname, 'nodejs.org')
  assert.throws(() => assertTrustedHttpsUrl('http://nodejs.org/dist/index.json'), /non-HTTPS/)
  assert.throws(() => assertTrustedHttpsUrl('https://example.com/node.zip'), /untrusted host/)
  assert.throws(() => assertTrustedHttpsUrl('https://user:pass@nodejs.org/node.zip'), /credential-bearing/)
})

test('Node checksum manifests are parsed strictly', () => {
  const digest = 'a'.repeat(64)
  const entries = parseSha256Manifest(`${digest}  node-v24.16.0-win-x64.zip\ninvalid row\n`)
  assert.equal(entries.get('node-v24.16.0-win-x64.zip'), digest)
  assert.equal(entries.size, 1)
})

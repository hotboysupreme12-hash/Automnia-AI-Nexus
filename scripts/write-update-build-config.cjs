#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const privateKeyPem = String(process.env.AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n').trim()
const privateKeyFile = String(process.env.AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_FILE || '').trim()
const baseUrlValue = String(process.env.AUTOMNIA_UPDATE_BASE_URL || '').trim()
const channel = String(process.env.AUTOMNIA_UPDATE_CHANNEL || 'stable').trim().toLowerCase()

function fail(message) {
  console.error(`[update-build-config] ${message}`)
  process.exit(1)
}

if (!baseUrlValue) fail('AUTOMNIA_UPDATE_BASE_URL is required')
if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(channel)) fail('AUTOMNIA_UPDATE_CHANNEL is invalid')
if (privateKeyPem && privateKeyFile) fail('Configure either AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM or AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_FILE')
if (!privateKeyPem && !privateKeyFile) fail('An Ed25519 update signing key is required')

let baseUrl
try {
  const parsed = new URL(baseUrlValue)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('AUTOMNIA_UPDATE_BASE_URL must be a credential-free HTTPS URL without query or fragment')
  }
  baseUrl = parsed.toString().replace(/\/$/, '')
} catch (error) {
  fail(`AUTOMNIA_UPDATE_BASE_URL is invalid: ${error?.message || error}`)
}

try {
  const source = privateKeyPem || fs.readFileSync(path.resolve(privateKeyFile), 'utf8')
  const privateKey = crypto.createPrivateKey(source)
  if (privateKey.asymmetricKeyType !== 'ed25519') fail(`Update signing key must be Ed25519, got ${privateKey.asymmetricKeyType || 'unknown'}`)
  const publicKey = crypto.createPublicKey(privateKey)
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  const keyId = String(process.env.AUTOMNIA_UPDATE_SIGNING_KEY_ID || '').trim() || crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16)
  const outputDir = path.join(root, 'electron')
  const publicKeyPath = path.join(outputDir, 'update-public-key.pem')
  const configPath = path.join(outputDir, 'update-config.json')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(publicKeyPath, publicKeyPem, { encoding: 'utf8', mode: 0o644 })
  fs.writeFileSync(configPath, `${JSON.stringify({ schema: 1, baseUrl, channel, keyId }, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })
  console.log(`[update-build-config] embedded ${channel} update trust configuration (${keyId})`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

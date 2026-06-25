const { createHash } = require('node:crypto')
const fs = require('node:fs')

/**
 * @param {string | URL} input
 * @param {readonly string[]} allowedHosts
 * @returns {URL}
 */
function assertTrustedHttpsUrl(input, allowedHosts = ['nodejs.org']) {
  const parsed = input instanceof URL ? input : new URL(String(input))
  const allowed = new Set(allowedHosts.map((host) => String(host).toLowerCase()))
  if (parsed.protocol !== 'https:') throw new Error(`Refusing non-HTTPS runtime download: ${parsed.href}`)
  if (parsed.username || parsed.password) throw new Error(`Refusing credential-bearing runtime download URL: ${parsed.href}`)
  if (!allowed.has(parsed.hostname.toLowerCase())) throw new Error(`Refusing runtime download from untrusted host: ${parsed.hostname}`)
  return parsed
}

/** @param {string} text */
function parseSha256Manifest(text) {
  const entries = new Map()
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(rawLine)
    if (!match) continue
    entries.set(match[2], match[1].toLowerCase())
  }
  return entries
}

/** @param {string} filePath */
function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

module.exports = {
  assertTrustedHttpsUrl,
  parseSha256Manifest,
  sha256File,
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the bundled Codex lock pins the plugin, TOML parser, harness and all supported native platforms', () => {
  const lock = JSON.parse(readFileSync('scripts/runtime-locks/openclaw-codex-2026.11.6-lock.json', 'utf8'))
  const entry = (name) => lock.packages[`node_modules/${name}`]
  assert.equal(lock.packages[''].dependencies['@openclaw/codex'], '2026.11.6')
  assert.equal(entry('@openclaw/codex').version, '2026.11.6')
  assert.equal(entry('@openai/codex').version, '0.169.0')
  assert.equal(entry('smol-toml').version, '1.9.1')
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const arch of ['x64', 'arm64']) {
      const item = entry(`@openai/codex-${platform}-${arch}`)
      assert.equal(item.version, `0.169.0-${platform}-${arch}`)
      assert.match(item.integrity, /^sha512-/)
      assert.deepEqual(item.os, [platform])
      assert.deepEqual(item.cpu, [arch])
    }
  }
  for (const [name, item] of Object.entries(lock.packages)) {
    if (name && item.resolved?.startsWith('https://registry.npmjs.org/')) assert.match(item.integrity || '', /^sha512-/)
  }
})

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = path.join(root, 'scripts', 'setup-openclaw-gateway-auth.mjs')
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-gateway-auth-'))

try {
  const tokenOnlyHome = path.join(tempRoot, 'token-only')
  const tokenOnly = spawnSync(process.execPath, [script, '--home', tokenOnlyHome], { encoding: 'utf8' })
  assert.equal(tokenOnly.status, 0, tokenOnly.stderr)
  const tokenOnlyConfig = JSON.parse(readFileSync(path.join(tokenOnlyHome, 'openclaw.json'), 'utf8'))
  const tokenOnlyEnv = readFileSync(path.join(tokenOnlyHome, '.env'), 'utf8')
  assert.equal(tokenOnlyConfig.gateway.auth.mode, 'token')
  assert.match(tokenOnlyConfig.gateway.auth.token, /^[a-f0-9]{64}$/)
  assert.equal('password' in tokenOnlyConfig.gateway.auth, false, 'default auth setup must not synthesize a password')
  assert.equal('password' in tokenOnlyConfig.gateway.remote, false, 'default remote setup must not synthesize a password')
  assert.doesNotMatch(tokenOnlyEnv, /^OPENCLAW_GATEWAY_PASSWORD=/m)

  const explicitHome = path.join(tempRoot, 'explicit-password')
  const explicit = spawnSync(process.execPath, [script, '--home', explicitHome, '--password', 'explicit-local-secret'], { encoding: 'utf8' })
  assert.equal(explicit.status, 0, explicit.stderr)
  const explicitConfig = JSON.parse(readFileSync(path.join(explicitHome, 'openclaw.json'), 'utf8'))
  const explicitEnv = readFileSync(path.join(explicitHome, '.env'), 'utf8')
  assert.equal(explicitConfig.gateway.auth.password, 'explicit-local-secret')
  assert.equal(explicitConfig.gateway.remote.password, 'explicit-local-secret')
  assert.match(explicitEnv, /^OPENCLAW_GATEWAY_PASSWORD=explicit-local-secret$/m)

  console.log('gateway auth hardening contract ok')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

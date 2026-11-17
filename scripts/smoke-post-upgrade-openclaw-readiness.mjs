import assert from 'node:assert/strict'
import {
  BOUNDED_SMOKES,
  CODEX_HARNESS_VERSION,
  CODEX_PLUGIN_VERSION,
  OPENCLAW_VERSION,
  loopbackBaseUrl,
  parseTokenFileContents,
  summarizeProviderStatuses,
  verifyLocalRuntimeBundles,
} from './post-upgrade-openclaw-readiness.mjs'

assert.equal(OPENCLAW_VERSION, '2026.11.5')
assert.equal(CODEX_PLUGIN_VERSION, '2026.11.5')
assert.equal(CODEX_HARNESS_VERSION, '0.164.0')

const localChecks = verifyLocalRuntimeBundles()
assert.equal(localChecks.length, 2, 'readiness must validate both OpenClaw and Codex runtime bundles')
assert.ok(localChecks.every((check) => check.ok), localChecks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.detail}`).join('\n'))

const safeStatuses = summarizeProviderStatuses({
  ok: true,
  data: {
    providers: [{
      provider: 'google-vertex',
      label: 'Google Cloud Vertex AI',
      configured: true,
      mode: 'oauth',
      apiKey: { configured: false, value: 'do-not-print-api-key' },
      oauth: { configured: true, accessToken: 'do-not-print-access-token', refreshToken: 'do-not-print-refresh-token' },
      gcloud: { configured: true, accessToken: 'do-not-print-gcloud-token' },
      email: 'private@example.test',
      persistencePath: 'C:\\private\\auth.json',
    }],
  },
})
assert.deepEqual(safeStatuses, [{
  provider: 'google-vertex',
  configured: true,
  mode: 'oauth',
  apiKeyConfigured: false,
  oauthConfigured: true,
  subscriptionConfigured: false,
  gcloudConfigured: true,
}])
const serializedStatuses = JSON.stringify(safeStatuses)
for (const secret of ['do-not-print-api-key', 'do-not-print-access-token', 'do-not-print-refresh-token', 'do-not-print-gcloud-token', 'private@example.test', 'C:\\private\\auth.json']) {
  assert.equal(serializedStatuses.includes(secret), false, `provider status summary must exclude ${secret}`)
}

assert.equal(parseTokenFileContents('plain-control-center-token-123456'), 'plain-control-center-token-123456')
assert.equal(parseTokenFileContents('{"token":"json-control-center-token-123456"}'), 'json-control-center-token-123456')
assert.equal(parseTokenFileContents('{"token":"short"}'), '')
assert.equal(parseTokenFileContents('{broken'), '')
assert.equal(loopbackBaseUrl('http://127.0.0.1:4050/'), 'http://127.0.0.1:4050')
assert.throws(() => loopbackBaseUrl('https://example.com'), /loopback host/)
assert.throws(() => loopbackBaseUrl('http://user:pass@localhost:4050'), /credentials/)

const smokeFiles = BOUNDED_SMOKES.map((smoke) => smoke.args.at(-1))
assert.ok(smokeFiles.includes('scripts/smoke-openclaw-contracts.mjs'))
assert.ok(smokeFiles.includes('scripts/smoke-agent-turn-stream.ts'))
assert.ok(smokeFiles.includes('scripts/smoke-provider-auth-service.ts'))
assert.ok(smokeFiles.includes('scripts/smoke-gateway-diagnostics-service.ts'))
assert.ok(smokeFiles.includes('scripts/smoke-gateway-chat-service.ts'))

console.log(`post-upgrade readiness contract ok (${localChecks.length} bundles, ${BOUNDED_SMOKES.length} bounded smokes)`)

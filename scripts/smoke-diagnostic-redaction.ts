import assert from 'node:assert/strict'
import { applyDiagnosticRedactions, redactDiagnosticText, safeDiagnosticPayload } from '../src/utils/diagnosticRedaction'

const sensitiveText = [
  'api_key=sk-ui-smoke-secret-123456',
  'Authorization: Bearer raw-token-value-123456',
  '+15555550123',
  'user@example.com',
  'C:\\Users\\hotbo\\Downloads\\secret.txt',
  '/Users/hotbo/.openclaw/openclaw.json',
].join(' ')

const redacted = redactDiagnosticText(sensitiveText, 500)

assert.match(redacted, /api_key=\[redacted\]/)
assert.match(redacted, /Authorization=\[redacted\]/)
assert.match(redacted, /\[redacted-phone\]/)
assert.match(redacted, /\[redacted-email\]/)
assert.match(redacted, /%USERPROFILE%/)
assert.match(redacted, /\/Users\/\[redacted\]/)
assert.doesNotMatch(redacted, /sk-ui-smoke-secret/)
assert.doesNotMatch(redacted, /raw-token-value/)
assert.doesNotMatch(redacted, /\+15555550123/)
assert.doesNotMatch(redacted, /user@example\.com/)
assert.doesNotMatch(redacted, /C:\\Users\\hotbo/)
assert.doesNotMatch(redacted, /\/Users\/hotbo/)

const rawRedacted = applyDiagnosticRedactions('2026-06-21T17:15:58.628Z\napi_key=sk-raw-secret-123456789012\ncall +15555550123')
assert.match(rawRedacted, /2026-06-21T17:15:58\.628Z/)
assert.match(rawRedacted, /\n/)
assert.match(rawRedacted, /api_key=\[redacted\]/)
assert.match(rawRedacted, /\[redacted-phone\]/)
assert.doesNotMatch(rawRedacted, /sk-raw-secret/)
assert.doesNotMatch(rawRedacted, /\+15555550123/)

const payload = safeDiagnosticPayload({
  sessionKey: 'session=raw-session-value',
  runId: 'ui-smoke-run',
  transport: 'gateway-chat',
  text: 'raw prompt should not be allowlisted',
  token: 'should-not-appear',
  ok: true,
  elapsedSeconds: 12,
})

assert.equal(payload?.sessionKey, 'session=[redacted]')
assert.equal(payload?.runId, 'ui-smoke-run')
assert.equal(payload?.transport, 'gateway-chat')
assert.equal(payload?.ok, true)
assert.equal(payload?.elapsedSeconds, 12)
assert.equal('text' in (payload || {}), false)
assert.equal('token' in (payload || {}), false)

console.log('Diagnostic redaction smoke checks passed.')

import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDiagnosticRedactions, safeDiagnosticPayload } from '../src/utils/diagnosticRedaction'

test('diagnostics redact credentials and personal identifiers', () => {
  const redacted = applyDiagnosticRedactions('Authorization: Bearer abc.def token=secret user@example.com +1 (404) 555-1212 C:\\Users\\Moses\\work')
  assert.doesNotMatch(redacted, /abc\.def|secret|user@example\.com|404.*555|Users\\Moses/)
  assert.match(redacted, /\[redacted\]/)
  assert.match(redacted, /\[redacted-email\]/)
  assert.match(redacted, /\[redacted-phone\]/)
  assert.match(redacted, /%USERPROFILE%/)

  assert.deepEqual(safeDiagnosticPayload({ agentId: 'agent-a', password: 'bad', ok: true }), { agentId: 'agent-a', ok: true })
})

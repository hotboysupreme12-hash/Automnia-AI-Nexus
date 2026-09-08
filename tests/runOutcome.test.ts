import assert from 'node:assert/strict'
import test from 'node:test'
import { runOutcomeLabel } from '../src/utils/runOutcome'

test('run labels distinguish termination, policy blocks and provider failures', () => {
  for (const [kind, label] of [['aborted', 'Cancelled'], ['cancelled', 'Cancelled'], ['timeout', 'Timed out'], ['provider_forbidden', 'Blocked'], ['auth_missing', 'Blocked'], ['rate_limit', 'Blocked'], ['gateway_disconnect', 'Failed'], ['unknown', 'Failed']]) {
    assert.equal(runOutcomeLabel({ ok: false, failureKind: kind }), label)
  }
  assert.equal(runOutcomeLabel({ ok: true, failureKind: 'timeout' }), 'Complete')
  assert.equal(runOutcomeLabel({ ok: false, streaming: true }), 'Working')
})

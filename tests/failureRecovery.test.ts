import assert from 'node:assert/strict'
import test from 'node:test'
import { failureRecoveryForKind } from '../src/utils/failureRecovery'

test('failure kinds receive readable recovery guidance', () => {
  const kinds = [
    'timeout',
    'rate_limit',
    'gateway_disconnect',
    'gateway_unavailable',
    'runtime_unavailable',
    'auth_expired',
    'auth_missing',
    'plugin_loader_error',
    'stale_lock',
    'disk_low',
    'provider_unsupported',
    'provider_forbidden',
    'insufficient_credits',
    'credits_exhausted',
    'sandbox_unavailable',
    'network_error',
    'process_error',
    'browser_preflight_failed',
    'context_overflow',
    'validation',
    'provider_error',
    'aborted',
    'cancelled',
    'interrupted',
    'unknown',
  ]

  for (const kind of kinds) {
    const recovery = failureRecoveryForKind(kind)
    assert.ok(recovery, `${kind} should have recovery guidance`)
    assert.ok(recovery.label.trim(), `${kind} should have a concise label`)
    assert.ok(recovery.detail.trim(), `${kind} should have actionable detail`)
  }
})

test('only existing safe recovery buttons are exposed', () => {
  assert.deepEqual(failureRecoveryForKind('insufficient_credits'), {
    label: 'Manage credits or routing',
    detail: 'Open Account to add Automnia credits or choose your connected provider.',
    action: 'open-settings',
  })
  assert.equal(failureRecoveryForKind('gateway_disconnect')?.action, 'restart-gateway')
  assert.equal(failureRecoveryForKind('auth_missing')?.action, undefined)
  assert.equal(failureRecoveryForKind('context_overflow')?.action, undefined)
  assert.equal(failureRecoveryForKind('timeout')?.action, undefined)
})

test('unknown future failure kinds stay visible without promising an unsafe retry', () => {
  assert.deepEqual(failureRecoveryForKind('future_failure_kind'), {
    label: 'Review the error details',
    detail: 'Check the response and recent activity. Confirm whether any actions completed before submitting the request again.',
  })
  assert.equal(failureRecoveryForKind('  '), null)
})

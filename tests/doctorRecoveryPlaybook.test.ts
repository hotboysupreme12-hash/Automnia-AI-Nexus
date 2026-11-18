import assert from 'node:assert/strict'
import test from 'node:test'
import type { DoctorFinding } from '../src/hooks/useRuntimeStatus'
import { canCopyDoctorDiagnosticCommand, canRunGuidedDoctorRepair, doctorRecoveryTarget, doctorRepairResultMessage } from '../src/utils/doctorRecoveryPlaybook'

function finding(overrides: Partial<DoctorFinding> = {}): DoctorFinding {
  return {
    checkId: 'gateway',
    category: 'gateway',
    severity: 'warning',
    message: 'Gateway needs attention',
    guidedAction: {
      kind: 'gateway_status',
      label: 'Inspect Gateway status',
      detail: 'Review the Gateway before a repair.',
      surface: 'monitor',
      allowsDoctorRepair: true,
    },
    ...overrides,
  }
}

test('Doctor playbook links findings to supported Automnia surfaces only', () => {
  assert.deepEqual(doctorRecoveryTarget(finding()), {
    kind: 'monitor',
    target: 'gateway',
    label: 'View Gateway monitor',
  })
  assert.deepEqual(doctorRecoveryTarget(finding({
    category: 'auth',
    guidedAction: { kind: 'provider_auth', label: 'Refresh auth', detail: 'Review auth', surface: 'provider-auth' },
  })), {
    kind: 'workspace',
    target: 'settings-account',
    label: 'Open account settings',
  })
  assert.deepEqual(doctorRecoveryTarget(finding({
    category: 'cron',
    guidedAction: { kind: 'cron_diagnostics', label: 'Inspect jobs', detail: 'Review jobs', surface: 'missions' },
  })), {
    kind: 'workspace',
    target: 'missions',
    label: 'Open Missions',
  })
  assert.equal(doctorRecoveryTarget(finding({
    category: 'secret',
    guidedAction: { kind: 'secret_audit', label: 'Audit', detail: 'Read only', surface: 'terminal', command: ['openclaw', 'secrets', 'audit'] },
  })), null)
})

test('broad Doctor repair requires explicit server allowance, supported kind, and actionable severity', () => {
  assert.equal(canRunGuidedDoctorRepair(finding()), true)
  assert.equal(canRunGuidedDoctorRepair(finding({ guidedAction: { kind: 'provider_auth', label: 'Refresh auth', detail: 'May consume quota', allowsDoctorRepair: true } })), false)
  assert.equal(canRunGuidedDoctorRepair(finding({ severity: 'info' })), false)
  assert.equal(canRunGuidedDoctorRepair(finding({ guidedAction: { kind: 'gateway_status', label: 'Inspect', detail: 'Review only' } })), false)
})

test('repair command is never presented as a copyable diagnostic command', () => {
  assert.equal(canCopyDoctorDiagnosticCommand(finding()), false)
  assert.equal(canCopyDoctorDiagnosticCommand(finding({
    guidedAction: { kind: 'config_lint', label: 'Lint', detail: 'Read only', command: ['openclaw', 'doctor', '--lint'] },
  })), true)
})

test('Doctor repair result summarizes post-checks without copying raw command output', () => {
  const message = doctorRepairResultMessage({
    id: 'repair-1',
    startedAt: '2026-11-17T00:00:00.000Z',
    endedAt: '2026-11-17T00:00:01.000Z',
    ok: false,
    command: { args: ['doctor', '--fix'], code: 1, elapsedMs: 1000, detail: 'token=should-not-display' },
    doctor: {
      id: 'doctor-2',
      startedAt: '2026-11-17T00:00:00.000Z',
      endedAt: '2026-11-17T00:00:01.000Z',
      ok: false,
      checks: [],
      summary: 'Doctor found 1 error.',
    },
  })
  assert.match(message, /finished with outstanding issues/)
  assert.match(message, /exit code: 1/)
  assert.match(message, /Doctor found 1 error/)
  assert.doesNotMatch(message, /should-not-display/)
})

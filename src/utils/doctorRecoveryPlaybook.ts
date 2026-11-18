import type { DoctorFinding, DoctorGuidedActionKind, DoctorRepairRun } from '../hooks/useRuntimeStatus'

export type DoctorRecoveryTarget =
  | { kind: 'workspace'; target: 'plugins' | 'missions' | 'settings-account'; label: string }
  | { kind: 'monitor'; target: 'gateway' | 'logs'; label: string }

const DOCTOR_REPAIR_KINDS = new Set<DoctorGuidedActionKind>([
  'doctor_repair',
  'plugin_inspect',
  'session_cleanup_preview',
  'gateway_status',
  'config_lint',
])

/** Return only in-app destinations that have a clear, existing Automnia surface. */
export function doctorRecoveryTarget(finding: DoctorFinding): DoctorRecoveryTarget | null {
  switch (finding.guidedAction?.kind) {
    case 'plugin_inspect':
    case 'channel_status':
      return { kind: 'workspace', target: 'plugins', label: 'Open Plugins' }
    case 'provider_auth':
    case 'model_status':
      return { kind: 'workspace', target: 'settings-account', label: 'Open account settings' }
    case 'cron_diagnostics':
      return { kind: 'workspace', target: 'missions', label: 'Open Missions' }
    case 'gateway_status':
    case 'session_cleanup_preview':
      return { kind: 'monitor', target: 'gateway', label: 'View Gateway monitor' }
    default:
      return null
  }
}

/** The broad Doctor fix is offered only for server-marked, supported findings. */
export function canRunGuidedDoctorRepair(finding: DoctorFinding): boolean {
  const kind = finding.guidedAction?.kind
  return finding.severity !== 'info'
    && finding.guidedAction?.allowsDoctorRepair === true
    && Boolean(kind && DOCTOR_REPAIR_KINDS.has(kind))
}

export function canCopyDoctorDiagnosticCommand(finding: DoctorFinding): boolean {
  return finding.guidedAction?.kind !== 'doctor_repair' && Boolean(finding.guidedAction?.command?.length)
}

/** Keep the result useful while avoiding echoing command output into the UI. */
export function doctorRepairResultMessage(result: DoctorRepairRun): string {
  const outcome = result.ok ? 'Doctor repair completed.' : 'Doctor repair finished with outstanding issues.'
  const exit = `Command exit code: ${Number.isFinite(result.command.code) ? result.command.code : 'unknown'}.`
  const summary = typeof result.doctor.summary === 'string' ? result.doctor.summary.trim() : ''
  return [outcome, exit, summary].filter(Boolean).join(' ')
}

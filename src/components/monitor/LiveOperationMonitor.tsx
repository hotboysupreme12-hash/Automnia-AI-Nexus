import { memo, useId, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentOperationState, AgentResponse, MissionEvent, OpenClawAgent } from '../../types/nexus'
import { clearRuntimeMonitor, runRuntimeDoctor, runRuntimeDoctorRepair, stopCronShift, updateCronShift, useRuntimeStatus } from '../../hooks/useRuntimeStatus'
import type { DoctorFinding, DoctorRun, GatewayChannelActivity, GatewayLogEntry, RuntimeCronJob, RuntimeMonitorClearResult, RuntimeStatus } from '../../hooks/useRuntimeStatus'
import { ActionStatusBanner } from '../common/ActionStatusBanner'

const CONTROL_CENTER_LOGO_SRC = '/brand/dystopai-app-icon.png'
const DOCTOR_PANEL_DISMISSED_RUN_KEY = 'dystopai-monitor-doctor-dismissed-run'

function doctorRunDismissKey(run: DoctorRun | null): string {
  if (!run) return ''
  return [run.id, run.endedAt, run.startedAt].filter(Boolean).join(':')
}

function readDismissedDoctorRunKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(DOCTOR_PANEL_DISMISSED_RUN_KEY) || ''
  } catch {
    return ''
  }
}

function rememberDismissedDoctorRunKey(key: string) {
  if (typeof window === 'undefined') return
  try {
    if (key) window.localStorage.setItem(DOCTOR_PANEL_DISMISSED_RUN_KEY, key)
    else window.localStorage.removeItem(DOCTOR_PANEL_DISMISSED_RUN_KEY)
  } catch {
    // Browser storage can be unavailable in hardened profiles.
  }
}

function formatCadence(ms: number): string {
  if (ms >= 60 * 60 * 1000 && ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)} hr`
  if (ms >= 60 * 1000 && ms % (60 * 1000) === 0) return `${ms / (60 * 1000)} min`
  return `${Math.max(1, Math.round(ms / 1000))} sec`
}

function formatReportMetric(value: number | null): string {
  return value === null ? 'Unavailable' : String(value)
}

function formatRuntimeTime(ts: string | null | undefined): string {
  if (!ts) return 'never'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function formatCronRemaining(ts: string | null | undefined): string {
  if (!ts) return 'unknown'
  const endMs = Date.parse(ts)
  if (Number.isNaN(endMs)) return 'unknown'
  const remainingMs = endMs - Date.now()
  if (remainingMs <= 0) return 'ending'
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function cronJobDisplayTime(job: RuntimeCronJob): string | null | undefined {
  return job.source === 'control-center' ? job.endsAt || job.nextRunAt : job.nextRunAt || job.endsAt
}

function cronJobTimeLabel(job: RuntimeCronJob): string {
  return job.source === 'control-center' && job.endsAt ? 'Ends' : 'Next'
}

function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId
}

function compactRuntimeText(value: string, max = 110): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function limitRuntimeText(value: string, max = 1200): string {
  const clean = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 3).trim()}...` : clean
}

function formatRuntimeDateTime(ts: string | null | undefined): string {
  if (!ts) return 'unknown'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function missionPromptField(message: string, label: string): string {
  const match = message.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'))
  return match?.[1]?.trim() || ''
}

function missionPromptObjective(message: string): string {
  const match = message.match(/Mission objective:\s*([\s\S]*?)(?:\n\s*(?:Mission evidence:|Cron execution rule:|TEAM_SYNC|Execution workspace:|Doctrine workspace:)|$)/i)
  return match?.[1]?.trim() || ''
}

function cronMissionTitle(job: RuntimeCronJob): string {
  const message = job.message || ''
  const match = message.match(/(?:^|\n)\/new\s+Mission cron (?:run|pulse):\s*"([^"]+)"/i)
    || message.match(/Mission cron (?:run|pulse):\s*"([^"]+)"/i)
  return match?.[1]?.trim() || job.name
}

function cronMissionInfo(job: RuntimeCronJob, agentName: string, timingLabel: string, timing: string | null | undefined, timingValue: string) {
  const message = job.message || ''
  const title = cronMissionTitle(job)
  const objective = missionPromptObjective(message)
  const missionId = missionPromptField(message, 'Mission ID')
  const mode = missionPromptField(message, 'Mode')
  const cadence = missionPromptField(message, 'Cadence') || job.every
  const collaboration = missionPromptField(message, 'Collaboration')
  const missionType = missionPromptField(message, 'Type')
  const fallback = message || `${job.name} scheduled for ${agentName}.`
  const summaryBase = objective || fallback
  const summary = compactRuntimeText(summaryBase, 210) || 'No mission details captured yet.'
  const fullDescription = [
    `Mission: ${title}`,
    missionId ? `Mission ID: ${missionId}` : '',
    `Agent: ${agentName}`,
    cadence ? `Cadence: ${cadence}` : '',
    timing ? `${timingLabel}: ${formatRuntimeDateTime(timing)}` : `${timingLabel}: ${timingValue}`,
    mode ? `Mode: ${mode}` : '',
    collaboration ? `Collaboration: ${collaboration}` : '',
    missionType ? `Type: ${missionType}` : '',
    job.model ? `Model: ${job.model}` : '',
    '',
    objective ? `Objective:\n${limitRuntimeText(objective, 1000)}` : `Cron instruction:\n${limitRuntimeText(fallback, 1000)}`,
    job.lastError ? `\nLast error:\n${limitRuntimeText(job.lastError, 360)}` : '',
  ].filter(Boolean).join('\n')

  return { title, summary, fullDescription }
}

type CronScheduleKind = 'every' | 'cron' | 'at'

function cronEditableScheduleKind(job: RuntimeCronJob): CronScheduleKind {
  return job.scheduleKind === 'cron' || job.scheduleKind === 'at' || job.scheduleKind === 'every' ? job.scheduleKind : 'every'
}

function normalizeEveryScheduleForInput(value: string): string {
  const clean = value.trim().toLowerCase().replace(/^every\s+/, '').replace(/\s+/g, ' ')
  const compact = clean.replace(/\s+/g, '')
  if (/^\d+[smhdw]$/.test(compact)) return compact
  const match = clean.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/)
  if (!match) return value.trim()
  const unit = match[2]
  const normalizedUnit = unit.startsWith('s') ? 's' : unit.startsWith('m') ? 'm' : unit.startsWith('h') ? 'h' : unit.startsWith('d') ? 'd' : 'w'
  return `${match[1]}${normalizedUnit}`
}

function cronEditableScheduleValue(job: RuntimeCronJob): string {
  const kind = cronEditableScheduleKind(job)
  if (kind === 'cron') return (job.scheduleLabel && job.scheduleLabel !== 'cron' ? job.scheduleLabel : job.every) || ''
  if (kind === 'at') return job.nextRunAt || job.endsAt || ''
  return normalizeEveryScheduleForInput(job.every || job.scheduleLabel || '')
}

function clampMetric(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

type MonitorTone = 'cyan' | 'emerald' | 'amber' | 'rose'

function statusClass(status: AgentOperationState['heartbeatStatus'] | undefined) {
  if (status === 'active') return 'dy-monitor-status-pill is-active'
  if (status === 'idle') return 'dy-monitor-status-pill is-idle'
  return 'dy-monitor-status-pill is-dormant'
}

function extractFiles(text: string): string[] {
  const matches = text.match(/(?:[\w.-]+\/)+[\w .@()[\]-]+\.[a-z0-9]+|[\w .@()[\]-]+\.(?:tsx?|jsx?|css|json|md|html|py|txt|log)/gi) || []
  return Array.from(new Set(matches.map((match) => match.trim().replace(/[),.;:]+$/, '')))).slice(0, 4)
}

function summarizeActivity(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'No details captured.'
  const edited = clean.match(/\b(?:edited|changed|updated|created|fixed|patched|wrote)\b[^.]{0,160}/i)?.[0]
  if (edited) return edited
  return clean.length > 190 ? `${clean.slice(0, 189).trim()}...` : clean
}

function isWorkingDelegationText(text: string) {
  return /active delegations?.*agents working/i.test(text)
}

function WorkingDots() {
  return (
    <span className="inline-flex w-5 items-end gap-0.5 align-baseline">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="inline-block h-1 w-1 rounded-full bg-current opacity-35 animate-bounce"
          style={{ animationDelay: `${index * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}

function LiveText({ text }: { text: string }) {
  if (!isWorkingDelegationText(text)) return <>{text}</>
  return (
    <>
      {text.replace(/\.{3}\s*$/, '')}
      <WorkingDots />
    </>
  )
}

const MetricBar = memo(function MetricBar({ label, value, tone = 'cyan' }: { label: string; value: number; tone?: MonitorTone }) {
  return (
    <div className="dy-monitor-gauge" data-tone={tone}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[0.10em]">
        <span className="dy-monitor-gauge-label">{label}</span>
        <span className="dy-monitor-gauge-value tabular-nums">{value}</span>
      </div>
      <div className="dy-monitor-gauge-track h-1.5 overflow-hidden rounded-none">
        <div className="dy-monitor-gauge-fill h-full rounded-none"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
})

type AgentLiveMetrics = {
  turns: number
  failures: number
  successRate: number
  runtime: number
  stability: number
  efficiency: number
  avgDurationMs: number
  lastTurnAt?: string
}

function deriveAgentMetrics(agent: OpenClawAgent, recentResponses: AgentResponse[], op?: AgentOperationState, busy = false): AgentLiveMetrics {
  const recent = recentResponses.slice(0, 20)
  const turns = recent.length
  const failures = recent.filter((response) => !response.ok).length
  const successRate = turns ? ((turns - failures) / turns) * 100 : (busy || op?.heartbeatStatus === 'active' ? 100 : 0)
  const completed = recent.filter((response) => response.ok && response.durationMs > 0)
  const avgDurationMs = completed.length ? Math.round(completed.reduce((sum, response) => sum + response.durationMs, 0) / completed.length) : 0
  const timeoutMs = Math.max(30_000, (agent.runtimePolicy?.timeoutSeconds || 90) * 1000)
  const speedScore = avgDurationMs ? clampMetric(100 - (avgDurationMs / timeoutMs) * 65) : (turns ? 65 : 0)
  const runtime = clampMetric(turns ? speedScore : (busy ? 72 : 0))
  const retryPenalty = (op?.retryCount || 0) * 8
  const stability = clampMetric(turns ? successRate - retryPenalty : (op?.heartbeatStatus === 'active' ? 88 : 0))
  const efficiency = clampMetric(turns ? ((successRate * 0.62) + (speedScore * 0.38)) - retryPenalty : (busy ? 68 : 0))
  return { turns, failures, successRate: clampMetric(successRate), runtime, stability, efficiency, avgDurationMs, lastTurnAt: recent[0]?.timestamp }
}

type MonitorTab = 'gateway' | 'heartbeat' | 'performance' | 'logs'

const MONITOR_TAB_TITLE: Record<MonitorTab, string> = {
  gateway: 'Gateway runtime, active cron jobs, channel traffic, and logs',
  heartbeat: 'Heartbeat scheduler state for active party agents',
  performance: 'Live runtime, efficiency, stability, and success metrics',
  logs: 'Recent agent and control-center activity logs',
}

function MonitorTabIcon({ tab }: { tab: MonitorTab }) {
  if (tab === 'gateway') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="2.2" />
        <circle cx="6.5" cy="17" r="2.2" />
        <circle cx="17.5" cy="17" r="2.2" />
        <path d="M12 7.3v4.2M12 11.5 8.1 15M12 11.5l3.9 3.5" />
      </svg>
    )
  }
  if (tab === 'heartbeat') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4v3M18 4v3M4.8 9.5h14.4" />
        <path d="M5.5 6.5h13A1.5 1.5 0 0 1 20 8v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8a1.5 1.5 0 0 1 1.5-1.5Z" />
      </svg>
    )
  }
  if (tab === 'performance') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 19V9.5M12 19V5M18.5 19v-7.5" />
        <path d="M4 19.2h16" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h7l3 3v12H7V4.5Z" />
      <path d="M14 4.5V8h3M9.5 12h5M9.5 15h5" />
    </svg>
  )
}

type ActivityItem =
  | { kind: 'response'; id: string; agentId: string; timestamp: string; ok: boolean; title: string; detail: string; files: string[]; failureKind?: string }
  | { kind: 'event'; id: string; agentId?: string; timestamp: string; ok: boolean; title: string; detail: string; files: string[]; eventType: MissionEvent['type']; failureKind?: string }

function makeResponseActivity(entry: AgentResponse): ActivityItem {
  const files = extractFiles(`${entry.prompt}\n${entry.response}`)
  return { kind: 'response', id: entry.id, agentId: entry.agentId, timestamp: entry.timestamp, ok: entry.ok, title: entry.ok ? 'Completed' : 'Attention', detail: summarizeActivity(entry.response || entry.prompt), files, failureKind: entry.failureKind }
}

function makeEventActivity(event: MissionEvent): ActivityItem {
  const completedLaneTurn = /\bcompleted\s*\(\d+s\)\s*:/i.test(event.message)
  const ok = completedLaneTurn
    ? true
    : !/\b(failed|error|err|blocked)\b/i.test(event.message)
  const title = event.type === 'coordination' ? 'Coordinating' : event.type === 'mission' ? 'Mission' : event.type === 'runtime' ? 'Runtime' : 'Agent'
  return { kind: 'event', id: event.id, agentId: event.agentId, timestamp: event.timestamp, ok, title, detail: summarizeActivity(event.message), files: extractFiles(event.message), eventType: event.type, failureKind: event.failureKind }
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function joinReadableList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] || ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function cleanSlateSummary(result: RuntimeMonitorClearResult): string {
  const cleared = [
    formatCount(result.cleared.gatewayLogs, 'gateway log entry', 'gateway log entries'),
    formatCount(result.cleared.gatewayLogTailSnapshots, 'log tail snapshot'),
    formatCount(result.cleared.recentRuns, 'completed runtime call'),
  ]
  const activeRuns = `${formatCount(result.activeRuns, 'active run')} ${result.activeRuns === 1 ? 'was' : 'were'} left running`
  const cleanup = result.sessionLockCleanup
  const cleanupSummary = cleanup
    ? ` Session lock sweep scanned ${formatCount(cleanup.scanned, 'lock')} and removed ${formatCount(cleanup.removed, 'stale lock')}${cleanup.errors ? ` with ${formatCount(cleanup.errors, 'error')}` : ''}.`
    : ''
  return `Cleared ${joinReadableList(cleared)}. ${activeRuns}.${cleanupSummary}`
}

function DoctorDismissButton({ onDismiss }: { onDismiss?: () => void }) {
  if (!onDismiss) return null
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[12px] font-semibold uppercase text-slate-300 transition hover:border-white/20 hover:bg-white/[0.055] hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300/40"
      title="Hide this Doctor summary"
      aria-label="Hide Doctor summary"
    >
      Hide
    </button>
  )
}

function doctorFindingToneClass(finding: DoctorFinding): string {
  if (finding.severity === 'error') return 'border-rose-400/20 text-rose-100'
  if (finding.severity === 'warning') return 'border-amber-400/20 text-amber-100'
  return 'border-emerald-400/16 text-emerald-100'
}

function doctorFindingAction(finding: DoctorFinding): string {
  const guidedAction = finding.guidedAction
  const command = guidedAction?.command?.length ? `Run: ${guidedAction.command.join(' ')}` : ''
  const doctorRepairHint = finding.fixHint
    || finding.repairAction
    || (guidedAction?.allowsDoctorRepair ? 'Run openclaw doctor --fix to quarantine invalid plugin config.' : '')
  return [
    guidedAction?.label,
    command,
    doctorRepairHint,
    guidedAction?.detail,
  ].filter(Boolean).join(' | ')
}

function DoctorPanel({ run, error, persisted = false, onDismiss }: { run: DoctorRun | null; error: string; persisted?: boolean; onDismiss?: () => void }) {
  if (!run && !error) return null
  const checks = run?.checks || []
  const title = persisted && run?.endedAt
    ? `Last Doctor: ${formatRuntimeDateTime(run.endedAt)}`
    : run?.summary
  return (
    <div className="border-b border-white/[0.04] bg-black/20 px-5 py-3">
      {error ? (
        <div
          className="flex items-start justify-between gap-3 rounded-xl border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] text-rose-200/90"
          role="alert"
        >
          <span className="min-w-0 break-words">Doctor failed: {error}</span>
          <DoctorDismissButton onDismiss={onDismiss} />
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.018] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold text-slate-100">{title}</p>
              {persisted && run?.summary && (
                <p className="mt-0.5 truncate text-[12px] text-slate-400" title={run.summary}>{run.summary}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.10em] ${run?.ok ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`}>
                {run?.ok ? 'doctor ok' : 'action needed'}
              </span>
              <DoctorDismissButton onDismiss={onDismiss} />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {checks.map((check) => {
              const findings = (check.findings || []).slice(0, 2)
              const extraFindings = Math.max(0, (check.findings?.length || 0) - findings.length)
              return (
                <div key={check.id} className={`rounded-lg border px-2.5 py-2 text-[12px] ${check.severity === 'error' ? 'border-rose-400/18 bg-rose-400/[0.04]' : check.severity === 'warning' ? 'border-amber-400/18 bg-amber-400/[0.04]' : 'border-emerald-400/12 bg-emerald-400/[0.025]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-bold text-slate-100">{check.label}</p>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold uppercase ${check.severity === 'error' ? 'text-rose-200' : check.severity === 'warning' ? 'text-amber-200' : 'text-emerald-200'}`}>
                      {check.severity}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-slate-400" title={check.evidence}>{check.evidence}</p>
                  {(check.failureKind || check.repairAction) && (
                    <p className="mt-1 line-clamp-2 text-[12px] text-cyan-100/85" title={check.repairAction || check.failureKind}>
                      {check.failureKind ? check.failureKind.replace(/_/g, ' ') : check.repairAction}
                    </p>
                  )}
                  {findings.length > 0 && (
                    <ul className="dy-doctor-finding-list mt-2 space-y-1 border-t border-white/[0.05] pt-1.5">
                      {findings.map((finding) => {
                        const action = doctorFindingAction(finding)
                        const location = finding.ocPath || finding.path || ''
                        return (
                          <li key={`${finding.checkId}-${finding.path || finding.ocPath || finding.message}`} className={`dy-doctor-finding border-l-2 pl-2 text-[12px] leading-snug ${doctorFindingToneClass(finding)}`}>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0 font-bold uppercase tracking-[0.10em]">{finding.category}</span>
                              <span className="min-w-0 truncate text-slate-400" title={finding.checkId}>{finding.checkId}</span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-slate-300" title={finding.message}>{finding.message}</p>
                            {location && <p className="mt-0.5 truncate text-slate-400" title={location}>{location}</p>}
                            {action && <p className="mt-0.5 line-clamp-2 text-cyan-100/85" title={action}>{compactRuntimeText(action, 260)}</p>}
                          </li>
                        )
                      })}
                      {extraFindings > 0 && (
                        <li className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-400">
                          +{extraFindings} more finding{extraFindings === 1 ? '' : 's'}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function CronJobCard({
  job,
  agentById,
  onPause,
  onEdit,
  pausing,
}: {
  job: RuntimeCronJob
  agentById: Map<string, OpenClawAgent>
  onPause: (job: RuntimeCronJob) => void
  onEdit: (job: RuntimeCronJob) => void
  pausing: boolean
}) {
  const agent = agentById.get(job.agent)
  const timing = cronJobDisplayTime(job)
  const timingLabel = cronJobTimeLabel(job)
  const timingValue = timing ? formatCronRemaining(timing) : job.every || 'unknown'
  const model = job.model || 'default'
  const status = job.status || 'active'
  const agentName = agent?.name || job.agent
  const missionInfo = cronMissionInfo(job, agentName, timingLabel, timing, timingValue)
  return (
    <div
      className="dy-cron-job-card relative flex min-h-16 flex-col gap-2 px-3 py-2.5 text-[12px] leading-tight transition hover:bg-white/[0.025]"
      data-state={status}
      title={`OpenClaw cron ${job.cronId}`}
    >
      <div className="dy-cron-job-actions absolute right-3 top-3 inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(job)}
          title={`Edit ${job.name}`}
          aria-label={`Edit cron job ${job.name}`}
          className="dy-cron-action-button dy-cron-edit-button inline-flex items-center justify-center"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 20h4.4L18.9 9.5a2.1 2.1 0 0 0 0-3l-1.4-1.4a2.1 2.1 0 0 0-3 0L4 15.6V20Z" />
            <path d="m13.6 6 4.4 4.4" />
          </svg>
        </button>
        <button
          type="button"
          disabled={pausing}
          onClick={() => onPause(job)}
          title={`Pause ${job.name}`}
          aria-label={`Pause cron job ${job.name}`}
          className="dy-cron-action-button dy-cron-pause-button inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 7h10v10H7Z" />
          </svg>
        </button>
      </div>

      <div className="dy-cron-job-header min-w-0 pr-16">
        <div className="dy-cron-job-title-block min-w-0">
          <div className="dy-cron-job-meta-row flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="dy-cron-status-badge rounded-none border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-300" data-state={status}>
              {status}
            </span>
            <span className="dy-cron-job-source">{job.source || 'openclaw'}</span>
          </div>
          <div className="dy-cron-job-title-row flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="truncate text-[12px] font-bold text-slate-100">{missionInfo.title}</p>
          </div>
          <p className="dy-cron-job-subtitle mt-0.5 truncate font-mono text-[12px] text-slate-400">{job.name} / {shortSessionId(job.cronId)}</p>
        </div>
      </div>
      <div className="dy-cron-job-details grid min-w-0 grid-cols-2 gap-1.5 text-[12px] text-slate-400 sm:grid-cols-4">
        <span className="dy-session-meta-chip" title={agentName}><span>Agent</span><strong>{agentName}</strong></span>
        <span className="dy-session-meta-chip"><span>Cadence</span><strong>{job.every}</strong></span>
        <span className="dy-session-meta-chip"><span>{timingLabel}</span><strong>{timingValue}</strong></span>
        <span className="dy-session-meta-chip" title={model}><span>Model</span><strong>{model}</strong></span>
      </div>
      <div
        className="dy-cron-mission-info dy-cron-instruction-chip dy-cron-description-panel"
        data-full-description={missionInfo.fullDescription}
        title={missionInfo.fullDescription}
        tabIndex={0}
      >
        <span>Description</span>
        <strong>{missionInfo.summary}</strong>
      </div>
    </div>
  )
}

function CronJobEditDialog({
  job,
  agentById,
  saving,
  onClose,
  onSave,
}: {
  job: RuntimeCronJob
  agentById: Map<string, OpenClawAgent>
  saving: boolean
  onClose: () => void
  onSave: (job: RuntimeCronJob, payload: {
    name: string
    scheduleKind: CronScheduleKind
    schedule: string
    message: string
    messageMode: 'message' | 'system-event'
  }) => Promise<void>
}) {
  const titleId = useId()
  const [name, setName] = useState(job.name || '')
  const [scheduleKind, setScheduleKind] = useState<CronScheduleKind>(() => cronEditableScheduleKind(job))
  const [schedule, setSchedule] = useState(() => cronEditableScheduleValue(job))
  const [message, setMessage] = useState(job.message || '')
  const [error, setError] = useState('')
  const agent = agentById.get(job.agent)
  const agentName = agent?.name || job.agent
  const messageEditable = !/^command$/i.test(job.payloadKind || '')
  const scheduleHelp = scheduleKind === 'every'
    ? 'Use 10m, 1h, 2d, or 1w.'
    : scheduleKind === 'cron'
      ? 'Use a 5- or 6-field cron expression.'
      : 'Use an ISO timestamp or relative value like 20m.'
  const canSave = Boolean(name.trim() && schedule.trim() && (!messageEditable || message.trim()) && !saving)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dy-cron-edit-dialog flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden border border-white/10 bg-[#070707] shadow-2xl shadow-black/70"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSave) return
          setError('')
          void onSave(job, {
            name: name.trim(),
            scheduleKind,
            schedule: schedule.trim(),
            message: message.trim(),
            messageMode: job.session === 'main' ? 'system-event' : 'message',
          }).catch((saveError) => {
            setError(saveError instanceof Error ? saveError.message : String(saveError))
          })
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[13px] font-bold text-white">Edit cron job</h2>
            <p className="mt-1 truncate text-[12px] text-slate-400">{agentName} / {shortSessionId(job.cronId)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="dy-cron-action-button inline-flex h-8 w-8 items-center justify-center border border-white/10 text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Close editor"
            aria-label="Close cron editor"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 gap-3 overflow-auto p-4">
          <label className="grid gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="border border-white/10 bg-black px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/50"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
            <label className="grid gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300">
              Schedule
              <select
                value={scheduleKind}
                onChange={(event) => setScheduleKind(event.target.value as CronScheduleKind)}
                className="border border-white/10 bg-black px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/50"
              >
                <option value="every">Every</option>
                <option value="cron">Cron</option>
                <option value="at">At</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300">
              Frequency
              <input
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="border border-white/10 bg-black px-3 py-2 font-mono text-[12px] normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/50"
                placeholder={scheduleKind === 'cron' ? '0 12 * * 5' : scheduleKind === 'at' ? '2026-06-22T12:00:00-04:00' : '1h'}
              />
              <span className="text-[12px] normal-case tracking-normal text-slate-400">{scheduleHelp}</span>
            </label>
          </div>

          <label className="grid gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300">
            Text
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!messageEditable}
              rows={8}
              className="min-h-40 resize-y border border-white/10 bg-black px-3 py-2 text-[12px] leading-relaxed normal-case tracking-normal text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={messageEditable ? 'Cron job instructions' : 'Command cron jobs do not have editable agent text here.'}
            />
          </label>

          {error && (
            <div className="border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-[11px] text-rose-100" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function GatewayLogLine({ entry }: { entry: GatewayLogEntry }) {
  const errorLevel = entry.level === 'error'
  const warningLevel = entry.level === 'warning' || entry.level === 'warn'
  const displayStream = errorLevel ? 'issue' : warningLevel ? 'warn' : entry.stream
  const streamClass =
    errorLevel
      ? 'text-rose-200/90'
      : warningLevel
      ? 'text-amber-300/85'
      : entry.stream === 'stderr'
      ? 'text-rose-300/80'
      : entry.stream === 'lifecycle'
        ? 'text-cyan-300/80'
        : entry.stream === 'channel'
          ? 'text-sky-300/80'
          : entry.stream === 'gateway'
            ? 'text-slate-300/75'
            : 'text-emerald-300/75'
  return (
    <div
      className="dy-gateway-log-line"
      data-level={entry.level || ''}
      data-stream={entry.stream}
      role="listitem"
      title={`${formatRuntimeTime(entry.timestamp)} ${displayStream.toUpperCase()} ${entry.message}`}
    >
      <span className="dy-gateway-log-time">[{formatRuntimeTime(entry.timestamp)}]</span>
      <span className={`dy-gateway-log-stream ${streamClass}`}>{displayStream}</span>
      <span className="dy-gateway-log-message">{entry.message}</span>
    </div>
  )
}

type GatewayActivityDisplay = {
  label: string
  summary: string
  detail: string
  raw: string
}

const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
  clawtalk: 'ClawTalk',
  discord: 'Discord',
  googlechat: 'Google Chat',
  imessage: 'iMessage',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  msteams: 'Teams',
  signal: 'Signal',
  slack: 'Slack',
  sms: 'SMS',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
}

function gatewayActivityToken(text: string, key: string): string {
  const match = text.match(new RegExp(`\\b${key}=("[^"]*"|\\S+)`, 'iu'))
  return match?.[1]?.replace(/^"|"$/g, '').trim() || ''
}

function gatewayActivityChannelLabel(channel: string): string {
  const normalized = channel.trim().toLowerCase()
  return CHANNEL_DISPLAY_NAMES[normalized] || normalized.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || 'Channel'
}

function gatewayActivitySourcePrefix(message: string): { prefix: string; text: string } {
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/u)
  return match ? { prefix: match[1].trim(), text: match[2].trim() } : { prefix: '', text: message.trim() }
}

function gatewayActivitySpoolLabel(spool: string): string {
  if (!spool) return ''
  const normalized = spool.replace(/\\/g, '/')
  const spoolName = normalized.split('/').filter(Boolean).pop() || spool
  const account = spoolName.match(/^ingress-spool-(.+)$/iu)?.[1]?.replace(/[-_]+/g, ' ')
  return account && account !== 'default'
    ? `Watching the ${account} inbox spool.`
    : `Watching the inbox spool.`
}

function gatewayActivityDisplay(event: GatewayChannelActivity): GatewayActivityDisplay {
  const { prefix, text } = gatewayActivitySourcePrefix(event.message)
  const raw = text || event.message
  const compactRaw = compactRuntimeText(raw, 220)
  const channel = gatewayActivityChannelLabel(event.channel)
  const sourceDetail = prefix ? `Source ${prefix}.` : ''
  const spool = gatewayActivityToken(raw, 'spool')
  const outcome = gatewayActivityToken(raw, 'outcome').toLowerCase()
  const duration = gatewayActivityToken(raw, 'duration')
  const error = gatewayActivityToken(raw, 'error')

  if (/\b(?:isolated\s+)?polling ingress started\b/iu.test(raw)) {
    return {
      label: 'Listening',
      summary: `${channel} listener started`,
      detail: [sourceDetail, gatewayActivitySpoolLabel(spool) || 'Watching for incoming messages.'].filter(Boolean).join(' '),
      raw,
    }
  }

  if (/\b(?:isolated\s+)?polling ingress stopped\b/iu.test(raw)) {
    return {
      label: 'Stopped',
      summary: `${channel} listener stopped`,
      detail: [sourceDetail, spool ? gatewayActivitySpoolLabel(spool) : 'Incoming message polling is no longer running.'].filter(Boolean).join(' '),
      raw,
    }
  }

  if (/\bpolling ingress\b/iu.test(raw) && /\b(?:error|failed|failure)\b/iu.test(raw)) {
    return {
      label: 'Issue',
      summary: `${channel} listener needs attention`,
      detail: error || compactRaw,
      raw,
    }
  }

  if (/^message processed:\s+channel=/iu.test(raw)) {
    const processedChannel = gatewayActivityChannelLabel(gatewayActivityToken(raw, 'channel') || event.channel)
    const failed = outcome === 'error' || outcome === 'failed' || /\boutcome=(?:error|failed)\b/iu.test(raw)
    const durationText = duration ? `Handled in ${duration}.` : ''
    return {
      label: failed ? 'Issue' : 'Handled',
      summary: `${processedChannel} message ${failed ? 'failed' : 'processed'}`,
      detail: [durationText, error ? `Error: ${error}` : '', sourceDetail].filter(Boolean).join(' ') || compactRaw,
      raw,
    }
  }

  if (event.direction === 'outbound' || /\b(?:reply sent|sent to|send ok|outbound send ok|sendMessage|message sent|delivered)\b/iu.test(raw)) {
    return {
      label: 'Sent',
      summary: `${channel} message sent`,
      detail: compactRaw,
      raw,
    }
  }

  if (event.direction === 'inbound' || /\b(?:received|incoming|inbound|getUpdates|webhook)\b/iu.test(raw)) {
    return {
      label: 'Incoming',
      summary: `${channel} message received`,
      detail: compactRaw,
      raw,
    }
  }

  return {
    label: event.direction === 'system' ? 'System' : event.direction === 'outbound' ? 'Sent' : 'Incoming',
    summary: compactRaw,
    detail: sourceDetail,
    raw,
  }
}

function GatewayActivityLine({ event }: { event: GatewayChannelActivity }) {
  const display = gatewayActivityDisplay(event)
  const channelLabel = event.agentId ? `${event.channel} / ${event.agentId}` : event.channel
  return (
    <div className="dy-gateway-activity-line dy-gateway-event-card grid grid-cols-[9px_minmax(0,1fr)] items-start gap-3 border-b border-white/[0.08] px-3 py-2.5 text-[12px] leading-tight transition hover:bg-white/[0.025]" data-direction={event.direction} title={display.raw}>
      <span className="dy-gateway-direction-marker mt-1 h-2 w-2 shrink-0 rounded-none" data-direction={event.direction} aria-hidden="true" />
      <div className="dy-gateway-activity-copy min-w-0">
        <div className="dy-gateway-event-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="dy-gateway-direction-label text-[11px] font-bold uppercase tracking-[0.08em]">{display.label}</span>
          <span className="dy-gateway-event-time font-mono text-[12px] tabular-nums text-slate-400">{formatRuntimeTime(event.timestamp)}</span>
          <span className="dy-gateway-event-source max-w-full truncate font-mono text-[12px] font-semibold text-slate-300" title={channelLabel}>{channelLabel}</span>
        </div>
        <p className="dy-gateway-event-message mt-1.5 min-w-0 font-medium text-slate-100">{display.summary}</p>
        {display.detail && display.detail !== display.summary && (
          <p className="dy-gateway-event-detail mt-1 min-w-0 text-[12px] leading-snug text-slate-400">{compactRuntimeText(display.detail, 420)}</p>
        )}
      </div>
    </div>
  )
}

function GatewayActivityCard({ activity }: { activity: RuntimeStatus['gateway']['activity'] | undefined }) {
  const events = activity?.events || []
  return (
    <div className="dy-monitor-card dy-channel-activity-card dy-gateway-feed-card flex min-h-0 flex-col self-stretch rounded-none border border-white/[0.04] bg-white/[0.015] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-slate-100">Channel Activity</p>
          <p className="mt-0.5 text-[12px] text-slate-400">Recent Telegram, SMS, and plugin traffic</p>
        </div>
        <div className="dy-channel-activity-stats flex flex-wrap items-center gap-1.5">
          <span className="dy-channel-activity-stat border border-white/[0.08] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-state={activity?.active ? 'active' : 'quiet'}>
            {activity?.active ? 'active' : 'quiet'}
          </span>
          <span className="dy-channel-activity-stat border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="inbound">{activity?.inboundCount || 0} incoming</span>
          <span className="dy-channel-activity-stat border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="outbound">{activity?.outboundCount || 0} sent</span>
          {Boolean(activity?.systemCount) && (
            <span className="dy-channel-activity-stat border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="system" title={`${activity?.systemCount || 0} system event${(activity?.systemCount || 0) === 1 ? '' : 's'} captured`}>{activity?.systemCount || 0} system</span>
          )}
        </div>
      </div>
      <div className="dy-monitor-stream-box dy-gateway-event-list min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/25 shadow-inner shadow-black/20">
        {events.slice(0, 28).map((event) => <GatewayActivityLine key={event.id} event={event} />)}
        {!events.length && <div className="dy-monitor-empty py-6 text-center text-[12px] font-medium text-slate-400">No channel activity captured yet.</div>}
      </div>
    </div>
  )
}

function GatewayLogTailCard({ logs }: { logs: GatewayLogEntry[] }) {
  const logTailId = 'gateway-log-tail'
  const [expanded, setExpanded] = useState(false)
  const visibleLogs = useMemo(() => logs.slice(0, expanded ? 48 : 0), [expanded, logs])
  const hiddenLogCount = Math.max(0, logs.length - visibleLogs.length)

  return (
    <div className="dy-monitor-card dy-gateway-log-card dy-monitor-console-card flex min-h-0 flex-col rounded-none border border-white/[0.04] bg-black/35 p-4" data-collapsed={!expanded}>
      <div className={`dy-gateway-log-header flex shrink-0 items-center justify-between gap-3 ${expanded ? 'mb-3' : ''}`}>
        <div className="dy-gateway-log-title text-[13px] font-bold text-slate-100">Gateway Log Tail</div>
        <div className="dy-gateway-log-controls flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.10em] text-slate-400">{logs.length} entries</span>
          <button
            type="button"
            className="dy-gateway-log-toggle rounded-none border border-white/[0.10] bg-black/30 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.10em] text-slate-300 transition hover:border-white/30 hover:bg-white/[0.06]"
            aria-controls={logTailId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {expanded && (
        <div id={logTailId} className="dy-monitor-log-box min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/30 p-3 font-mono text-[13px] leading-[1.45]" role="list" aria-label="Gateway log tail">
          {visibleLogs.length ? visibleLogs.map((entry) => <GatewayLogLine key={entry.id} entry={entry} />) : <div className="dy-gateway-log-empty text-slate-400">No gateway log entries captured yet.</div>}
          {hiddenLogCount > 0 && (
            <div className="dy-gateway-log-hidden mt-3 border-t border-white/[0.05] pt-3 text-[12px] uppercase tracking-[0.10em] text-slate-400">
              {hiddenLogCount} older entr{hiddenLogCount === 1 ? 'y' : 'ies'} hidden
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RuntimeGatewayPanel({
  status,
  error,
  agentById,
  onRefresh,
}: {
  status: RuntimeStatus | null
  error: string
  agentById: Map<string, OpenClawAgent>
  onRefresh: () => void
}) {
  const gateway = status?.gateway
  const activeCronJobs = useMemo(() => status?.shifts?.active || [], [status?.shifts?.active])
  const activeCronCount = status?.shifts?.activeCount ?? activeCronJobs.length
  const cronCadences = useMemo(() => Array.from(new Set(activeCronJobs.map((job) => job.every).filter(Boolean))), [activeCronJobs])
  const logs = gateway?.logs || []
  const activity = gateway?.activity
  const [cronCancelKey, setCronCancelKey] = useState('')
  const [cronCancelConfirm, setCronCancelConfirm] = useState(false)
  const [cronEditJob, setCronEditJob] = useState<RuntimeCronJob | null>(null)
  const [cronEditKey, setCronEditKey] = useState('')
  const [actionError, setActionError] = useState('')
  const [runtimeNotice, setRuntimeNotice] = useState('')
  const cronCancelPreview = useMemo(() => {
    return activeCronJobs.slice(0, 3).map((job) => `${job.name} (${job.agent})`).join(', ')
  }, [activeCronJobs])
  const pauseCronJob = async (job: RuntimeCronJob) => {
    setCronCancelConfirm(false)
    setCronCancelKey(job.id)
    setActionError('')
    setRuntimeNotice('')
    try {
      await stopCronShift(job.id)
      setRuntimeNotice(`Paused cron job ${job.name}.`)
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setCronCancelKey('')
    }
  }
  const pauseAllCronJobs = async (jobs = activeCronJobs) => {
    if (!jobs.length || cronCancelKey === '__all__') return
    setCronCancelConfirm(false)
    setCronCancelKey('__all__')
    setActionError('')
    setRuntimeNotice('')
    try {
      for (const job of jobs) {
        await stopCronShift(job.id)
      }
      setRuntimeNotice(`Paused ${jobs.length} active cron job${jobs.length === 1 ? '' : 's'}.`)
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setCronCancelKey('')
    }
  }
  const requestCancelAllCronJobs = () => {
    if (!activeCronJobs.length || cronCancelKey === '__all__') return
    setActionError('')
    setRuntimeNotice('')
    if (activeCronJobs.length > 1) {
      setCronCancelConfirm(true)
      return
    }
    void pauseAllCronJobs(activeCronJobs)
  }
  const keepCronJobsScheduled = () => {
    setCronCancelConfirm(false)
    setRuntimeNotice('Cron jobs kept scheduled.')
  }
  const editCronJob = (job: RuntimeCronJob) => {
    setCronCancelConfirm(false)
    setCronEditJob(job)
    setActionError('')
    setRuntimeNotice('')
  }
  const saveCronJobEdit = async (
    job: RuntimeCronJob,
    payload: { name: string; scheduleKind: CronScheduleKind; schedule: string; message: string; messageMode: 'message' | 'system-event' },
  ) => {
    if (cronEditKey) return
    setCronEditKey(job.id)
    setActionError('')
    setRuntimeNotice('')
    try {
      await updateCronShift({ shiftId: job.id, ...payload })
      setRuntimeNotice(`Updated cron job ${payload.name}.`)
      setCronEditJob(null)
      onRefresh()
      window.setTimeout(onRefresh, 1200)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setCronEditKey('')
    }
  }
  return (
    <div className="dy-gateway-panel grid gap-3">
      {error && (
        <div
          className="dy-monitor-alert rounded-none border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-rose-200/90"
          data-tone="rose"
          role="alert"
        >
          Runtime status unavailable: {error}
        </div>
      )}
      {actionError && (
        <div
          className="dy-monitor-alert rounded-none border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-rose-200/90"
          data-tone="rose"
          role="alert"
        >
          Runtime action failed: {actionError}
        </div>
      )}
      {runtimeNotice && (
        <div
          className="dy-monitor-alert rounded-none border border-cyan-400/15 bg-cyan-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-cyan-100/85"
          data-tone="cyan"
          role="status"
          aria-live="polite"
        >
          {runtimeNotice}
        </div>
      )}
      {cronCancelConfirm && activeCronJobs.length > 0 && (
        <ActionStatusBanner
          className="dy-monitor-alert px-4 text-[11px] leading-relaxed"
          rounded="none"
          buttonRounded="none"
          actionTextClassName="text-[12px]"
          message={`Pause all ${activeCronJobs.length} active cron job${activeCronJobs.length === 1 ? '' : 's'}?`}
          detail={cronCancelPreview ? (
            <>
              {cronCancelPreview}
              {activeCronJobs.length > 3 ? ` +${activeCronJobs.length - 3} more` : ''}
            </>
          ) : undefined}
          detailTitle={activeCronJobs.map((job) => `${job.name} (${job.agent})`).join(', ')}
          confirmLabel="Pause jobs"
          confirmAriaLabel={`Pause ${activeCronJobs.length} active cron job${activeCronJobs.length === 1 ? '' : 's'}`}
          cancelAriaLabel="Keep cron jobs scheduled"
          busy={cronCancelKey === '__all__'}
          onConfirm={() => void pauseAllCronJobs(activeCronJobs)}
          onCancel={keepCronJobsScheduled}
        />
      )}
      {cronEditJob && (
        <CronJobEditDialog
          job={cronEditJob}
          agentById={agentById}
          saving={cronEditKey === cronEditJob.id}
          onClose={() => {
            if (!cronEditKey) setCronEditJob(null)
          }}
          onSave={saveCronJobEdit}
        />
      )}

      <div className="dy-gateway-layout">
        <GatewayActivityCard activity={activity} />

          <div className="dy-monitor-card dy-cron-jobs-card flex min-h-0 flex-col self-stretch rounded-none border border-white/[0.04] bg-white/[0.015] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold text-slate-100">Active Cron Jobs</p>
                <p className="mt-0.5 text-[12px] text-slate-400">Enabled OpenClaw cron jobs currently scheduled</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.10em] text-slate-400">{activeCronCount} active</span>
                {cronCadences.length > 0 && (
                  <span className="dy-cron-cadence-badge hidden rounded-none border border-white/[0.06] bg-white/[0.025] px-2 py-0.5 text-[11px] font-semibold text-slate-300 sm:inline-flex" title={cronCadences.join(', ')}>
                    {cronCadences.slice(0, 2).join(' / ')}
                  </span>
                )}
                {activeCronJobs.length > 0 && (
                  <button
                    type="button"
                    disabled={cronCancelKey === '__all__'}
                    onClick={requestCancelAllCronJobs}
                    title={`Pause all ${activeCronJobs.length} active cron jobs`}
                    className="dy-cron-cancel-button rounded-none border border-rose-300/15 bg-rose-300/[0.035] px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.10em] text-rose-100 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cronCancelKey === '__all__' ? 'Pausing' : 'Pause all'}
                  </button>
                )}
              </div>
            </div>
            <div className={`dy-monitor-stream-box min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/25 shadow-inner shadow-black/20 divide-y divide-white/[0.035] ${activeCronJobs.length ? '' : 'dy-cron-stream-empty'}`}>
              {activeCronJobs.map((job) => (
                <CronJobCard
                  key={job.id}
                  job={job}
                  agentById={agentById}
                  onPause={pauseCronJob}
                  onEdit={editCronJob}
                  pausing={cronCancelKey === job.id || cronCancelKey === '__all__'}
                />
              ))}
              {!activeCronJobs.length && (
                <div className="dy-monitor-empty dy-session-empty-state dy-cron-empty-state py-6 text-center text-[12px] font-medium text-slate-400">
                  <span className="dy-cron-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M6 4.7v2.8M18 4.7v2.8M4.8 9.7h14.4" />
                      <path d="M5.7 6.4h12.6A1.7 1.7 0 0 1 20 8.1v10.2a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3V8.1a1.7 1.7 0 0 1 1.7-1.7Z" />
                      <path d="M12 12.2v3.2l2.2 1.3" />
                    </svg>
                  </span>
                  <strong>No active cron jobs.</strong>
                  <span>Enabled OpenClaw cron jobs will appear here.</span>
                </div>
              )}
            </div>
          </div>

        <GatewayLogTailCard logs={logs} />
      </div>
    </div>
  )
}

export function LiveOperationMonitor() {
  const activePartyIds = useNexusStore((state) => state.activePartyIds)
  const agents = useNexusStore((state) => state.agents)
  const operationStates = useNexusStore((state) => state.operationStates)
  const missionFeed = useNexusStore((state) => state.missionFeed)
  const agentResponses = useNexusStore((state) => state.agentResponses)
  const latestReport = useNexusStore((state) => state.missionReports[0])
  const busyAgentIds = useNexusStore((state) => state.busyAgentIds)
  const resetSimulation = useNexusStore((state) => state.resetSimulation)
  const { status: runtimeStatus, error: runtimeError, refresh: refreshRuntimeStatus } = useRuntimeStatus(5000)

  const [tab, setTab] = useState<MonitorTab>('gateway')
  const [doctorRun, setDoctorRun] = useState<DoctorRun | null>(null)
  const [doctorError, setDoctorError] = useState('')
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [doctorRepairBusy, setDoctorRepairBusy] = useState(false)
  const [dismissedDoctorRunKey, setDismissedDoctorRunKey] = useState(readDismissedDoctorRunKey)
  const [cleanSlateBusy, setCleanSlateBusy] = useState(false)
  const [cleanSlateError, setCleanSlateError] = useState('')
  const [cleanSlateResult, setCleanSlateResult] = useState<RuntimeMonitorClearResult | null>(null)

  const visibleAgents = useMemo(() => agents.filter((agent) => activePartyIds.includes(agent.id)), [agents, activePartyIds])
  const visibleAgentIds = useMemo(() => new Set(visibleAgents.map((agent) => agent.id)), [visibleAgents])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const recentResponsesByAgent = useMemo(() => {
    const grouped = new Map<string, AgentResponse[]>()
    for (const response of agentResponses.slice(0, 80)) {
      if (!visibleAgentIds.has(response.agentId)) continue
      const bucket = grouped.get(response.agentId)
      if (bucket) {
        if (bucket.length < 20) bucket.push(response)
      } else {
        grouped.set(response.agentId, [response])
      }
    }
    return grouped
  }, [agentResponses, visibleAgentIds])
  const liveMetricsByAgent = useMemo(() => {
    const metrics = new Map<string, AgentLiveMetrics>()
    for (const agent of visibleAgents) {
      metrics.set(agent.id, deriveAgentMetrics(agent, recentResponsesByAgent.get(agent.id) || [], operationStates[agent.id], busyAgentIds.includes(agent.id)))
    }
    return metrics
  }, [busyAgentIds, operationStates, recentResponsesByAgent, visibleAgents])
  const persistedDoctorRun = runtimeStatus?.diagnostics?.doctor?.lastRun || null
  const rawDisplayedDoctorRun = doctorRun || (doctorError ? null : persistedDoctorRun)
  const rawDisplayedDoctorRunKey = doctorRunDismissKey(rawDisplayedDoctorRun)
  const doctorPanelDismissed = !doctorError && Boolean(rawDisplayedDoctorRunKey) && rawDisplayedDoctorRunKey === dismissedDoctorRunKey
  const displayedDoctorRun = doctorPanelDismissed ? null : rawDisplayedDoctorRun
  const displayedDoctorRunPersisted = !doctorRun && !doctorError && Boolean(persistedDoctorRun) && !doctorPanelDismissed
  const doctorRepairAvailable = Boolean(
    runtimeStatus?.gateway?.restartDiagnostics?.needsAttention
      || rawDisplayedDoctorRun?.checks.some((check) => {
        const actionableCheck = check.repairAction && (check.severity === 'warning' || check.severity === 'error')
        const actionableFinding = check.findings?.some((finding) => (
          (finding.severity === 'warning' || finding.severity === 'error')
          && Boolean(finding.guidedAction?.allowsDoctorRepair || finding.fixHint || finding.repairAction)
        ))
        return Boolean(actionableCheck || actionableFinding)
      }),
  )
  const activity = useMemo(
    () => [...agentResponses.slice(0, 18).map(makeResponseActivity), ...missionFeed.slice(0, 18).map(makeEventActivity)]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 18),
    [agentResponses, missionFeed],
  )

  const runDoctor = async () => {
    setDoctorBusy(true)
    setDoctorError('')
    try {
      const result = await runRuntimeDoctor()
      setDismissedDoctorRunKey('')
      rememberDismissedDoctorRunKey('')
      setDoctorRun(result)
      refreshRuntimeStatus()
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : String(error))
    } finally {
      setDoctorBusy(false)
    }
  }

  const repairWithDoctor = async () => {
    setDoctorRepairBusy(true)
    setDoctorError('')
    try {
      const result = await runRuntimeDoctorRepair()
      setDismissedDoctorRunKey('')
      rememberDismissedDoctorRunKey('')
      setDoctorRun(result.doctor)
      refreshRuntimeStatus()
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : String(error))
    } finally {
      setDoctorRepairBusy(false)
    }
  }

  const cleanSlate = async () => {
    setCleanSlateBusy(true)
    setCleanSlateError('')
    setCleanSlateResult(null)
    resetSimulation()
    setDoctorRun(null)
    setDoctorError('')
    setDismissedDoctorRunKey('')
    rememberDismissedDoctorRunKey('')
    try {
      const result = await clearRuntimeMonitor()
      setCleanSlateResult(result)
    } catch (error) {
      setCleanSlateError(error instanceof Error ? error.message : String(error))
      refreshRuntimeStatus()
    } finally {
      setCleanSlateBusy(false)
    }
  }

  const dismissDoctorPanel = () => {
    const key = doctorRunDismissKey(rawDisplayedDoctorRun)
    if (key) {
      setDismissedDoctorRunKey(key)
      rememberDismissedDoctorRunKey(key)
    }
    setDoctorRun(null)
    setDoctorError('')
  }

  return (
    <section data-dui-panel="monitor" className="dy-monitor-shell overflow-hidden rounded-none border border-white/[0.06] bg-[linear-gradient(180deg,#101112,#080909)] shadow-2xl shadow-black/40">
      <DoctorPanel run={displayedDoctorRun} error={doctorError} persisted={displayedDoctorRunPersisted} onDismiss={dismissDoctorPanel} />
      {cleanSlateResult && !cleanSlateError && (
        <div className="border-b border-white/[0.04] bg-black/20 px-5 py-3">
          <div
            className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] px-4 py-3 text-[11px] leading-relaxed text-cyan-100/90"
            role="status"
            aria-live="polite"
          >
            <strong className="mr-1 text-slate-100">Clean Slate complete.</strong>
            <span>{cleanSlateSummary(cleanSlateResult)}</span>
            <p className="mt-1 text-slate-400">Monitor cache was cleared; durable OpenClaw transcripts and active Gateway work were preserved.</p>
          </div>
        </div>
      )}
      {cleanSlateError && (
        <div className="border-b border-white/[0.04] bg-black/20 px-5 py-3">
          <div
            className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-rose-200/90"
            role="alert"
          >
            Clean Slate failed: {cleanSlateError}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="dy-monitor-tabs border-b border-white/[0.04] px-5 py-3">
        <div className="dy-monitor-tabbar">
          <div
            className="dy-monitor-tab-list flex gap-1 rounded-none border border-white/[0.05] bg-white/[0.015] p-1"
            role="tablist"
            aria-label="Monitor views"
          >
          {(['gateway', 'heartbeat', 'performance', 'logs'] as MonitorTab[]).map((item) => (
            <button key={item} id={`monitor-tab-${item}`} type="button" role="tab" onClick={() => setTab(item)} data-active={tab === item ? 'true' : 'false'} aria-selected={tab === item} aria-controls={`monitor-panel-${item}`} title={MONITOR_TAB_TITLE[item]}
              className={`flex-1 rounded-none px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-all ${tab === item ? 'bg-white/[0.065] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'}`}>
              <MonitorTabIcon tab={item} />
              {item === 'heartbeat' ? 'scheduler' : item}
            </button>
          ))}
          </div>
          <div className="dy-monitor-tools">
            <button type="button" disabled={doctorBusy} onClick={runDoctor} className="dy-monitor-tool-button" title="Run runtime doctor">
              {doctorBusy ? 'Doctor running' : 'Doctor'}
            </button>
            <button
              type="button"
              disabled={doctorRepairBusy || doctorBusy || !doctorRepairAvailable}
              onClick={() => void repairWithDoctor()}
              className="dy-monitor-tool-button dy-monitor-doctor-repair-button"
              title="Run OpenClaw Doctor safe non-interactive repair, then rerun diagnostics."
            >
              {doctorRepairBusy ? 'Repairing' : 'Doctor repair'}
            </button>
            <button
              type="button"
              disabled={cleanSlateBusy}
              onClick={() => void cleanSlate()}
              className="dy-monitor-tool-button"
              title="Clear local monitor cache, log tail snapshots, recent runtime calls, and stale session locks without stopping active Gateway runs."
            >
              {cleanSlateBusy ? 'Cleaning' : 'Clean Slate'}
            </button>
          </div>
        </div>
      </div>

      <div
        id={`monitor-panel-${tab}`}
        className="dy-monitor-body p-5"
        role="tabpanel"
        aria-labelledby={`monitor-tab-${tab}`}
      >
        {tab === 'heartbeat' && (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleAgents.map((agent) => {
              const op = operationStates[agent.id]
              return (
                <div key={agent.id} className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-bold text-slate-100">{agent.name}</p>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.10em] ${statusClass(op?.heartbeatStatus)}`}>
                      {op?.heartbeatStatus ?? 'dormant'}
                    </span>
                  </div>
                  <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[12px] text-slate-400">Cron Cadence</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{formatCadence(agent.heartbeat.tickIntervalMs)}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[12px] text-slate-400">Retry</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{op?.retryCount ?? 0} / interval {formatCadence(agent.heartbeat.idleTimeoutMs)}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[12px] text-slate-400">Loop Flag</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{agent.heartbeat.continuous ? 'on' : 'off'}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[12px] text-slate-400">Recovery</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{agent.heartbeat.recoveryMode ? 'on' : 'off'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'performance' && (
          <div className="grid gap-3">
            {visibleAgents.map((agent) => (
              <div key={agent.id} className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-slate-100">{agent.name}</p>
                  <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-1 text-[12px] font-semibold text-cyan-100/90">
                    {(liveMetricsByAgent.get(agent.id)?.turns || 0)} turns · {liveMetricsByAgent.get(agent.id)?.lastTurnAt ? new Date(liveMetricsByAgent.get(agent.id)!.lastTurnAt!).toLocaleTimeString() : 'no runs'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricBar label="Efficiency" value={liveMetricsByAgent.get(agent.id)?.efficiency || 0} />
                  <MetricBar label="Runtime" value={liveMetricsByAgent.get(agent.id)?.runtime || 0} />
                  <MetricBar label="Stability" value={liveMetricsByAgent.get(agent.id)?.stability || 0} />
                  <MetricBar label="Success" value={liveMetricsByAgent.get(agent.id)?.successRate || 0} />
                </div>
              </div>
            ))}
            {latestReport && (
              <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3.5">
                <p className="text-[11px] text-cyan-200/90 leading-relaxed">
                  Last report: efficiency {formatReportMetric(latestReport.efficiencyRating)}, drift {formatReportMetric(latestReport.soulDrift)}, errors {formatReportMetric(latestReport.errors)}, XP {formatReportMetric(latestReport.xpGained)}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="grid gap-3">
            {activity.map((item, index) => {
              const agent = item.agentId ? agentById.get(item.agentId) : undefined
              const isControlCenter = item.kind === 'event' && !item.agentId
              const isWorkingStatus = isControlCenter && isWorkingDelegationText(item.detail)
              return (
                <motion.div key={`${item.kind}-${item.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.02, 0.15) }}
                  className={`relative overflow-hidden rounded-xl border p-3.5 ${
                    isControlCenter
                      ? 'border-white/[0.045] bg-zinc-950/35'
                      : item.ok
                        ? 'border-white/[0.04] bg-white/[0.015]'
                        : 'border-rose-400/15 bg-rose-400/[0.03]'
                  }`}>
                  <div className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${isControlCenter ? 'bg-slate-600/45' : 'dy-activity-rail'}`} />
                  <div className="flex gap-3 pl-2">
                    <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-1 ${isControlCenter ? 'bg-zinc-950/60 ring-white/[0.06]' : 'ring-white/10'}`}>
                      {isControlCenter ? (
                        <img src={CONTROL_CENTER_LOGO_SRC} alt="" className="h-full w-full object-cover opacity-80" />
                      ) : agent?.portrait ? (
                        <img src={agent.portrait} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/[0.02] text-sm font-bold text-slate-600">{agent?.name?.charAt(0) || 'O'}</div>
                      )}
                      {item.ok && !isControlCenter && <span className="dy-activity-dot absolute right-0.5 top-0.5 h-2 w-2 rounded-full" data-tone="emerald" />}
                      {isWorkingStatus && <span className="dy-activity-dot absolute right-1 top-1 h-2 w-2 rounded-full animate-pulse" data-tone="neutral" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`truncate text-[12px] font-bold ${isControlCenter ? 'text-slate-300' : 'text-slate-100'}`}>{agent?.name || item.agentId || 'Control Center'}</p>
                        <span className="dy-activity-status rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]" data-status={isControlCenter ? 'control' : item.ok ? 'ok' : 'blocked'}>{item.ok ? item.title : 'Blocked'}</span>
                        {item.failureKind && (
                          <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.04] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-100">
                            {item.failureKind.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="font-mono text-[12px] text-slate-400">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className={`mt-1.5 text-[12px] leading-relaxed ${isControlCenter ? 'text-slate-400' : 'text-slate-300/90'}`}><LiveText text={item.detail} /></p>
                      {item.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.files.map((file) => <span key={file} className="max-w-[240px] truncate rounded-md border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1 font-mono text-[12px] text-amber-100">{file}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
            {!activity.length && <div className="rounded-xl border border-dashed border-white/[0.06] py-10 text-center text-[12px] font-medium text-slate-400">No activity recorded.</div>}
          </div>
        )}

        {tab === 'gateway' && (
          <RuntimeGatewayPanel status={runtimeStatus} error={runtimeError} agentById={agentById} onRefresh={refreshRuntimeStatus} />
        )}
      </div>
    </section>
  )
}

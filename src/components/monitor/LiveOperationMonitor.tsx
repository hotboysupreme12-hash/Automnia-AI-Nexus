import { memo, useId, useMemo, useState } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentOperationState, AgentResponse, MissionEvent, OpenClawAgent } from '../../types/nexus'
import { clearRuntimeMonitor, restartGatewayRuntime, runRuntimeDoctor, stopCronShift, updateCronShift } from '../../hooks/useRuntimeStatus'
import type { DoctorFinding, DoctorRun, GatewayChannelActivity, GatewayLogEntry, RuntimeCronJob, RuntimeMonitorClearResult, RuntimeStatus } from '../../hooks/useRuntimeStatus'
import { agentPortraitSrc } from '../../utils/portrait'
import { useChannelActivitySettings } from '../settings/channelActivitySettings'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import { Badge, Button, IconButton, StatusChip } from '../ui'
import type { BadgeTone } from '../ui'

const AUTOMNIA_LOCKUP_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const DOCTOR_PANEL_DISMISSED_RUN_KEY = 'automnia-monitor-doctor-dismissed-run'
const DOCTOR_SNAPSHOT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

function doctorRunDismissKey(run: DoctorRun | null): string {
  if (!run) return ''
  return [run.id, run.endedAt, run.startedAt].filter(Boolean).join(':')
}

function doctorSnapshotIsStale(run: DoctorRun | null): boolean {
  const timestamp = run?.endedAt || run?.startedAt
  if (!timestamp) return false
  const completedAt = Date.parse(timestamp)
  return Number.isFinite(completedAt) && Date.now() - completedAt > DOCTOR_SNAPSHOT_STALE_AFTER_MS
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
  if (!ts) return 'Not scheduled'
  const endMs = Date.parse(ts)
  if (Number.isNaN(endMs)) return 'Time unavailable'
  const remainingMs = endMs - Date.now()
  if (remainingMs <= 0) return 'Ending now'
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `In ${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours}h` : ''}`
  if (hours) return `In ${hours}h${minutes ? ` ${minutes}m` : ''}`
  return `In ${minutes} minute${minutes === 1 ? '' : 's'}`
}

function formatCronCadence(value: string | null | undefined): string {
  const clean = value?.trim()
  if (!clean) return 'Schedule unavailable'
  const match = clean.match(/^(?:every\s+)?(\d+)\s*([smhdw])$/iu)
  if (!match) return clean
  const amount = Number(match[1])
  const unit = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' }[match[2].toLowerCase() as 's' | 'm' | 'h' | 'd' | 'w']
  return `Every ${amount} ${unit}${amount === 1 ? '' : 's'}`
}

function formatCronStatus(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'active' || normalized === 'running') return 'Running'
  if (normalized === 'paused') return 'Paused'
  if (normalized === 'completed' || normalized === 'complete') return 'Complete'
  if (normalized === 'failed' || normalized === 'error') return 'Needs attention'
  return value?.trim() ? value.trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'Running'
}

function formatCronSource(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'control-center') return 'Automnia schedule'
  if (normalized === 'openclaw') return 'OpenClaw schedule'
  return value?.trim() ? value.trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'Connected schedule'
}

function cronJobDisplayTime(job: RuntimeCronJob): string | null | undefined {
  return job.source === 'control-center' ? job.endsAt || job.nextRunAt : job.nextRunAt || job.endsAt
}

function cronJobTimeLabel(job: RuntimeCronJob): string {
  return job.source === 'control-center' && job.endsAt ? 'Ends' : 'Next run'
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
  if (!ts) return 'Not scheduled'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
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
  const summary = compactRuntimeText(summaryBase, 210) || 'Instructions are not available yet.'
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
    objective ? `Objective:\n${limitRuntimeText(objective, 1000)}` : `Run instructions:\n${limitRuntimeText(fallback, 1000)}`,
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

function heartbeatStatusTone(status: AgentOperationState['heartbeatStatus'] | undefined): BadgeTone {
  if (status === 'active') return 'success'
  if (status === 'idle') return 'info'
  return 'neutral'
}

function activityStatusTone(item: Pick<ActivityItem, 'ok'>, isControlCenter: boolean): BadgeTone {
  if (isControlCenter) return 'neutral'
  return item.ok ? 'success' : 'error'
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
  gateway: 'Runtime status, scheduled runs, and live message flow',
  heartbeat: 'Heartbeat scheduler state for active party agents',
  performance: 'Live runtime, efficiency, stability, and success metrics',
  logs: 'Unified Gateway Activity for agent runs and Gateway events',
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
  | { kind: 'gateway-log'; id: string; timestamp: string; ok: boolean; title: string; detail: string; files: string[]; stream: GatewayLogEntry['stream']; level?: string; source?: string }

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

function makeGatewayLogActivity(entry: GatewayLogEntry): ActivityItem {
  const signal = `${entry.level || ''} ${entry.message}`.toLowerCase()
  const hasError = entry.stream === 'stderr' || /\b(error|failed|failure|exception|blocked|fatal)\b/.test(signal)
  const hasWarning = !hasError && /\b(warn|warning|retry|degraded|unavailable)\b/.test(signal)
  return {
    kind: 'gateway-log',
    id: `${entry.id}-${entry.timestamp}`,
    timestamp: entry.timestamp,
    ok: !hasError,
    title: hasError ? 'Gateway issue' : hasWarning ? 'Gateway warning' : 'Gateway event',
    detail: entry.message || 'Gateway event recorded without a message.',
    files: [],
    stream: entry.stream,
    level: entry.level,
    source: entry.source,
  }
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
    <Button
      onClick={onDismiss}
      variant="quiet"
      size="compact"
      className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[12px] font-semibold uppercase text-slate-300 transition hover:border-white/20 hover:bg-white/[0.055] hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300/40"
      title="Hide this Doctor summary"
      aria-label="Hide Doctor summary"
    >
      Hide
    </Button>
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

function DoctorPanel({ run, error, persisted = false, stale = false, onDismiss }: { run: DoctorRun | null; error: string; persisted?: boolean; stale?: boolean; onDismiss?: () => void }) {
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
              {stale && (
                <p className="mt-1 text-[11px] text-amber-200/85">This Doctor snapshot is over 24 hours old. Run Doctor to refresh runtime state.</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.10em] ${stale ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200' : run?.ok ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`}>
                {stale ? 'refresh recommended' : run?.ok ? 'doctor ok' : 'action needed'}
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
  const timingValue = timing ? formatCronRemaining(timing) : formatCronCadence(job.every)
  const model = job.model || 'default'
  const status = job.status || 'active'
  const statusLabel = formatCronStatus(status)
  const agentName = agent?.name || job.agent
  const missionInfo = cronMissionInfo(job, agentName, timingLabel, timing, timingValue)
  return (
    <div
      className="dy-cron-job-card relative flex min-h-16 flex-col gap-2 px-3 py-2.5 text-[12px] leading-tight transition"
      data-state={status}
      data-ui-revision="cron-job-v2"
      title={`OpenClaw cron ${job.cronId}`}
    >
      <div className="dy-cron-job-actions absolute right-3 top-3 inline-flex items-center gap-1">
        <IconButton
          onClick={() => onEdit(job)}
          title={`Edit schedule for ${job.name}`}
          aria-label={`Edit schedule for ${job.name}`}
          size="compact"
          variant="quiet"
          className="dy-cron-action-button dy-cron-edit-button inline-flex items-center justify-center"
          icon={(
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 20h4.4L18.9 9.5a2.1 2.1 0 0 0 0-3l-1.4-1.4a2.1 2.1 0 0 0-3 0L4 15.6V20Z" />
            <path d="m13.6 6 4.4 4.4" />
          </svg>
          )}
        />
        <IconButton
          disabled={pausing}
          onClick={() => onPause(job)}
          title={`Pause ${job.name}`}
          aria-label={`Pause scheduled run ${job.name}`}
          size="compact"
          variant="danger"
          className="dy-cron-action-button dy-cron-pause-button inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
          icon={(
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 7h10v10H7Z" />
          </svg>
          )}
        />
      </div>

      <div className="dy-cron-job-header min-w-0 pr-16">
        <span className="dy-cron-job-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="7.5" />
            <path d="M12 7.7v4.8l3.2 1.8" />
            <path d="M7 3.8 4.8 6M17 3.8 19.2 6" />
          </svg>
        </span>
        <div className="dy-cron-job-title-block min-w-0">
          <div className="dy-cron-job-meta-row flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge className="dy-cron-status-badge rounded-none border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-300" data-state={status} tone={status === 'active' ? 'success' : 'neutral'} size="micro">
              {statusLabel}
            </Badge>
            <span className="dy-cron-job-source">{formatCronSource(job.source)}</span>
          </div>
          <div className="dy-cron-job-title-row flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="truncate text-[12px] font-bold text-slate-100">{missionInfo.title}</p>
          </div>
          <p className="dy-cron-job-subtitle mt-0.5 truncate text-[12px] text-slate-400">{job.name} · Run {shortSessionId(job.cronId)}</p>
        </div>
      </div>
      <div className="dy-cron-job-details grid min-w-0 grid-cols-2 gap-1.5 text-[12px] text-slate-400 sm:grid-cols-4">
        <span className="dy-session-meta-chip" title={agentName}><span>Owner</span><strong>{agentName}</strong></span>
        <span className="dy-session-meta-chip" title={formatCronCadence(job.every)}><span>Cadence</span><strong>{formatCronCadence(job.every)}</strong></span>
        <span className="dy-session-meta-chip"><span>{timingLabel}</span><strong>{timingValue}</strong></span>
        <span className="dy-session-meta-chip" title={model}><span>Model</span><strong>{model === 'default' ? 'Default model' : model}</strong></span>
      </div>
      <div
        className="dy-cron-mission-info dy-cron-instruction-chip dy-cron-description-panel"
        data-full-description={missionInfo.fullDescription}
        title={missionInfo.fullDescription}
        tabIndex={0}
      >
        <span>What this run does</span>
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
    ? 'Examples: 10m, 1h, 2d, or 1w.'
    : scheduleKind === 'cron'
      ? 'Enter a five- or six-field cron expression.'
      : 'Enter an ISO timestamp or a relative value such as 20m.'
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
            <h2 id={titleId} className="truncate text-[13px] font-bold text-white">Edit scheduled run</h2>
            <p className="mt-1 truncate text-[12px] text-slate-400">{agentName} · Run {shortSessionId(job.cronId)}</p>
          </div>
          <IconButton
            onClick={onClose}
            disabled={saving}
            icon={(
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            )}
            variant="quiet"
            size="compact"
            className="dy-cron-action-button inline-flex h-8 w-8 items-center justify-center border border-white/10 text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Close schedule editor"
            aria-label="Close schedule editor"
          />
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
              Schedule type
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
              Run frequency
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
            Instructions
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!messageEditable}
              rows={8}
              className="min-h-40 resize-y border border-white/10 bg-black px-3 py-2 text-[12px] leading-relaxed normal-case tracking-normal text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={messageEditable ? 'Describe what this scheduled run should do.' : 'This command schedule does not have editable run instructions.'}
            />
          </label>

          {error && (
            <div className="border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-[11px] text-rose-100" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button
            onClick={onClose}
            disabled={saving}
            variant="secondary"
            size="compact"
            className="border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSave}
            variant="primary"
            size="compact"
            className="border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving schedule' : 'Save schedule'}
          </Button>
        </div>
      </form>
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
    ? `Connected to the ${account} inbox.`
    : `Connected to the inbox.`
}

function humanReadableChannelDetail(value: string): string {
  const cleaned = value
    .replace(/\b(?:channel|outcome|duration|sessionKey|scope|mode|model|token)=("[^"]*"|\S+)/giu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim()
  if (!cleaned) return 'No message details were captured.'
  if (/^(?:message )?(?:received|sent|delivered|processed)(?:\.)?$/iu.test(cleaned)) return 'No message details were captured.'
  return compactRuntimeText(cleaned, 420)
}

function gatewayActivityDisplay(event: GatewayChannelActivity): GatewayActivityDisplay {
  const { prefix, text } = gatewayActivitySourcePrefix(event.message)
  const raw = text || event.message
  const compactRaw = compactRuntimeText(raw, 220)
  const channel = gatewayActivityChannelLabel(event.channel)
  const sourceDetail = prefix ? `Connected through ${prefix}.` : ''
  const spool = gatewayActivityToken(raw, 'spool')
  const outcome = gatewayActivityToken(raw, 'outcome').toLowerCase()
  const duration = gatewayActivityToken(raw, 'duration')
  const error = gatewayActivityToken(raw, 'error')

  if (/\b(?:isolated\s+)?polling ingress started\b/iu.test(raw)) {
    return {
      label: 'Ready',
      summary: `${channel} is ready to receive messages`,
      detail: [sourceDetail, gatewayActivitySpoolLabel(spool) || 'Waiting for incoming messages.'].filter(Boolean).join(' '),
      raw,
    }
  }

  if (/\b(?:isolated\s+)?polling ingress stopped\b/iu.test(raw)) {
    return {
      label: 'Paused',
      summary: `${channel} is no longer listening`,
      detail: [sourceDetail, spool ? gatewayActivitySpoolLabel(spool) : 'Incoming messages are not being checked right now.'].filter(Boolean).join(' '),
      raw,
    }
  }

  if (/\bpolling ingress\b/iu.test(raw) && /\b(?:error|failed|failure)\b/iu.test(raw)) {
    return {
      label: 'Needs attention',
      summary: `${channel} could not stay connected`,
      detail: humanReadableChannelDetail(error || compactRaw),
      raw,
    }
  }

  if (/^message processed:\s+channel=/iu.test(raw)) {
    const processedChannel = gatewayActivityChannelLabel(gatewayActivityToken(raw, 'channel') || event.channel)
    const failed = outcome === 'error' || outcome === 'failed' || /\boutcome=(?:error|failed)\b/iu.test(raw)
    const durationText = duration ? `Completed in ${duration}.` : ''
    return {
      label: failed ? 'Needs attention' : 'Processed',
      summary: failed ? `${processedChannel} message could not be processed` : `${processedChannel} message was processed`,
      detail: [durationText, error ? `Details: ${humanReadableChannelDetail(error)}` : '', sourceDetail].filter(Boolean).join(' ') || humanReadableChannelDetail(compactRaw),
      raw,
    }
  }

  if (event.direction === 'outbound' || /\b(?:reply sent|sent to|send ok|outbound send ok|sendMessage|message sent|delivered)\b/iu.test(raw)) {
    return {
      label: 'Delivered',
      summary: `${channel} message delivered`,
      detail: humanReadableChannelDetail(compactRaw),
      raw,
    }
  }

  if (event.direction === 'inbound' || /\b(?:received|incoming|inbound|getUpdates|webhook)\b/iu.test(raw)) {
    return {
      label: 'Received',
      summary: `${channel} message received`,
      detail: humanReadableChannelDetail(compactRaw),
      raw,
    }
  }

  return {
    label: event.direction === 'system' ? 'System' : event.direction === 'outbound' ? 'Delivered' : 'Received',
    summary: `${channel} activity recorded`,
    detail: [humanReadableChannelDetail(compactRaw), sourceDetail].filter(Boolean).join(' '),
    raw,
  }
}

const GatewayActivityLine = memo(function GatewayActivityLine({ event }: { event: GatewayChannelActivity }) {
  const display = gatewayActivityDisplay(event)
  const channelLabel = gatewayActivityChannelLabel(event.channel)
  const sourceLabel = event.agentId ? `${channelLabel} · ${event.agentId}` : channelLabel
  const channelMark = channelLabel.slice(0, 2).toUpperCase()
  return (
    <article className="dy-gateway-activity-line dy-gateway-event-card" data-direction={event.direction} title={display.raw}>
      <span className="dy-channel-activity-avatar" data-direction={event.direction} aria-hidden="true">{channelMark}</span>
      <div className="dy-gateway-activity-copy">
        <div className="dy-gateway-event-meta">
          <span className="dy-gateway-event-source" title={sourceLabel}>{sourceLabel}</span>
          <span className="dy-gateway-direction-label">{display.label}</span>
          <time className="dy-gateway-event-time" dateTime={event.timestamp}>{formatRuntimeTime(event.timestamp)}</time>
        </div>
        <p className="dy-gateway-event-message">{display.summary}</p>
        {display.detail && display.detail !== display.summary && <p className="dy-gateway-event-detail">{display.detail}</p>}
      </div>
    </article>
  )
})

const GatewayActivityCard = memo(function GatewayActivityCard({ activity }: { activity: RuntimeStatus['gateway']['activity'] | undefined }) {
  const { retentionLimit, autoTrim } = useChannelActivitySettings()
  const allEvents = activity?.events || []
  const events = autoTrim ? allEvents.slice(0, retentionLimit) : allEvents.slice(0, 100)
  const lastEvent = activity?.lastEventAt ? formatRuntimeTime(activity.lastEventAt) : 'No updates yet'
  return (
    <section className="dy-monitor-card dy-channel-activity-card dy-gateway-feed-card" aria-labelledby="channel-activity-title">
      <div className="dy-channel-activity-header">
        <div className="dy-channel-activity-heading">
          <span className="dy-channel-activity-heading-mark" aria-hidden="true">
            <img src="/icons/channel-activity-generated.png" alt="" />
          </span>
          <div>
            <p className="dy-channel-activity-eyebrow">Connected message flow</p>
            <h3 id="channel-activity-title">Live Message Flow</h3>
            <p>Plain-language updates from your connected channels.</p>
          </div>
        </div>
        <div className="dy-channel-activity-status" data-state={activity?.active ? 'active' : 'quiet'}>
          <i aria-hidden="true" />
          <strong>{activity?.active ? 'Streaming' : 'Idle'}</strong>
          <span>Last update: {lastEvent}</span>
        </div>
      </div>

      <div className="dy-channel-activity-stats" aria-label="Message flow summary">
        <div className="dy-channel-activity-stat" data-direction="inbound"><span>Received</span><strong>{activity?.inboundCount || 0}</strong><small>incoming messages</small></div>
        <div className="dy-channel-activity-stat" data-direction="outbound"><span>Delivered</span><strong>{activity?.outboundCount || 0}</strong><small>outgoing messages</small></div>
        <div className="dy-channel-activity-stat" data-direction="system"><span>Received</span><strong>{events.length}</strong><small>{events.length === 1 ? 'message' : 'messages'}</small></div>
      </div>

      <div className="dy-channel-activity-feed-head">
        <div><strong>Latest updates</strong><span>{autoTrim ? `Showing the last ${retentionLimit} automatically` : 'Showing all available updates'}</span></div>
        <span className="dy-channel-activity-count">{events.length} {events.length === 1 ? 'update' : 'updates'}</span>
      </div>
      <div className="dy-monitor-stream-box dy-gateway-event-list" role="log" aria-live="polite" aria-label="Latest message updates">
        {events.map((event) => <GatewayActivityLine key={`${event.id}-${event.timestamp}`} event={event} />)}
        {!events.length && <div className="dy-monitor-empty dy-channel-activity-empty"><strong>No messages yet</strong><span>New channel messages will appear here as they arrive.</span></div>}
      </div>
    </section>
  )
})

const RuntimeGatewayPanel = memo(function RuntimeGatewayPanel({
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
  const activeCronJobs = useMemo(() => {
    const seen = new Set<string>()
    return (status?.shifts?.active || []).filter((job) => {
      const key = job.cronId || job.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [status?.shifts?.active])
  const cronSyncError = status?.shifts?.error || ''
  const activeCronCount = status?.shifts?.activeCount ?? activeCronJobs.length
  const cronCadences = useMemo(() => Array.from(new Set(activeCronJobs.map((job) => job.every).filter(Boolean))), [activeCronJobs])
  const activity = gateway?.activity
  const [cronCancelKey, setCronCancelKey] = useState('')
  const [cronCancelConfirm, setCronCancelConfirm] = useState(false)
  const [cronEditJob, setCronEditJob] = useState<RuntimeCronJob | null>(null)
  const [cronEditKey, setCronEditKey] = useState('')
  const [actionError, setActionError] = useState('')
  const [runtimeNotice, setRuntimeNotice] = useState('')
  const localSessionNeedsReconnect = /\bauth(?:entication)?(?:\s+required)?\b|\bauth_required\b|\blocal runtime session needs to reconnect\b/i.test(error)
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
      setRuntimeNotice(`Paused scheduled run ${job.name}.`)
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The scheduled run could not be paused.')
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
      setRuntimeNotice(`Paused ${jobs.length} scheduled run${jobs.length === 1 ? '' : 's'}.`)
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The scheduled runs could not be paused.')
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
    setRuntimeNotice('Scheduled runs remain active.')
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
      setRuntimeNotice(`Updated scheduled run ${payload.name}.`)
      setCronEditJob(null)
      onRefresh()
      window.setTimeout(onRefresh, 1200)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The scheduled run could not be updated.')
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
          {localSessionNeedsReconnect ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Local runtime session expired while the control service restarted. Reconnecting now should restore status without signing in again.</span>
              <button
                type="button"
                onClick={onRefresh}
                className="rounded border border-rose-200/30 bg-rose-100/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-100/20"
              >
                Reconnect runtime
              </button>
            </div>
          ) : (
            <>Runtime status unavailable: {error}</>
          )}
        </div>
      )}
      {actionError && (
        <div
          className="dy-monitor-alert rounded-none border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-rose-200/90"
          data-tone="rose"
          role="alert"
        >
          Scheduled run action failed: {actionError}
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
          message={`Pause all ${activeCronJobs.length} scheduled run${activeCronJobs.length === 1 ? '' : 's'}?`}
          detail={cronCancelPreview ? (
            <>
              {cronCancelPreview}
              {activeCronJobs.length > 3 ? ` +${activeCronJobs.length - 3} more` : ''}
            </>
          ) : undefined}
          detailTitle={activeCronJobs.map((job) => `${job.name} (${job.agent})`).join(', ')}
          confirmLabel="Pause jobs"
          confirmAriaLabel={`Pause ${activeCronJobs.length} scheduled run${activeCronJobs.length === 1 ? '' : 's'}`}
          cancelAriaLabel="Keep scheduled runs active"
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
            <div className="dy-cron-panel-header">
              <div className="dy-cron-panel-title">
                <div className="dy-cron-panel-heading">
                  <span className="dy-cron-panel-heading-mark" aria-hidden="true">
                    <img src="/icons/cron-jobs-generated.png" alt="" />
                  </span>
                  <div>
                    <p className="dy-cron-panel-eyebrow">Automated runs</p>
                    <h3>Scheduled Runs</h3>
                    <p>Every enabled automation, with its cadence and next run at a glance.</p>
                  </div>
                </div>
              </div>
              <div className="dy-cron-panel-summary flex items-center gap-2">
                <span className="dy-cron-active-count text-[12px] font-semibold uppercase tracking-[0.10em] text-slate-400"><i aria-hidden="true" />{cronSyncError ? 'Status unavailable' : `${activeCronCount} running`}</span>
                {cronCadences.length > 0 && (
                  <span className="dy-cron-cadence-badge hidden rounded-none border border-white/[0.06] bg-white/[0.025] px-2 py-0.5 text-[11px] font-semibold text-slate-300 sm:inline-flex" title={cronCadences.join(', ')}>
                    {cronCadences.slice(0, 2).map(formatCronCadence).join(' · ')}
                  </span>
                )}
                {activeCronJobs.length > 0 && (
                  <Button
                    disabled={cronCancelKey === '__all__'}
                    onClick={requestCancelAllCronJobs}
                    title={`Pause all ${activeCronJobs.length} scheduled runs`}
                    variant="danger"
                    size="compact"
                    className="dy-cron-cancel-button rounded-none border border-rose-300/15 bg-rose-300/[0.035] px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.10em] text-rose-100 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cronCancelKey === '__all__' ? 'Pausing…' : 'Pause all'}
                  </Button>
                )}
              </div>
            </div>
            <div className={`dy-monitor-stream-box dy-cron-job-list min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/25 shadow-inner shadow-black/20 ${activeCronJobs.length ? '' : 'dy-cron-stream-empty'}`}>
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
              {activeCronJobs.length > 0 && (
                <div className="dy-cron-list-footer" aria-label="Cron job list status">
                  Showing all {activeCronJobs.length} running {activeCronJobs.length === 1 ? 'run' : 'runs'}
                </div>
              )}
              {!activeCronJobs.length && cronSyncError && (
                <div className="dy-monitor-empty dy-session-empty-state dy-cron-empty-state py-6 text-center text-[12px] font-medium text-amber-100/80" role="alert">
                  <strong>Scheduled runs are unavailable.</strong>
                  <span>We could not read the scheduler right now.</span>
                  <Button onClick={onRefresh} variant="secondary" size="compact" className="mt-3">Try again</Button>
                </div>
              )}
              {!activeCronJobs.length && !cronSyncError && (
                <div className="dy-monitor-empty dy-session-empty-state dy-cron-empty-state py-6 text-center text-[12px] font-medium text-slate-400">
                  <span className="dy-cron-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M6 4.7v2.8M18 4.7v2.8M4.8 9.7h14.4" />
                      <path d="M5.7 6.4h12.6A1.7 1.7 0 0 1 20 8.1v10.2a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3V8.1a1.7 1.7 0 0 1 1.7-1.7Z" />
                      <path d="M12 12.2v3.2l2.2 1.3" />
                    </svg>
                  </span>
                  <strong>No scheduled runs.</strong>
                  <span>Enabled automations will appear here when they are ready.</span>
                </div>
              )}
            </div>
          </div>

      </div>
    </div>
  )
})

const MonitorHeartbeatPanel = memo(function MonitorHeartbeatPanel({ visibleAgents }: { visibleAgents: OpenClawAgent[] }) {
  const operationStates = useNexusStore((state) => state.operationStates)

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {visibleAgents.map((agent) => {
        const op = operationStates[agent.id]
        return (
          <div key={agent.id} className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-bold text-slate-100">{agent.name}</p>
              <StatusChip
                label="Heartbeat"
                value={op?.heartbeatStatus ?? 'dormant'}
                state={op?.heartbeatStatus ?? 'dormant'}
                tone={heartbeatStatusTone(op?.heartbeatStatus)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.10em] ${statusClass(op?.heartbeatStatus)}`}
              />
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
  )
})

const MonitorPerformancePanel = memo(function MonitorPerformancePanel({ visibleAgents }: { visibleAgents: OpenClawAgent[] }) {
  const operationStates = useNexusStore((state) => state.operationStates)
  const agentResponses = useNexusStore((state) => state.agentResponses)
  const latestReport = useNexusStore((state) => state.missionReports[0])
  const busyAgentIds = useNexusStore((state) => state.busyAgentIds)
  const visibleAgentIds = useMemo(() => new Set(visibleAgents.map((agent) => agent.id)), [visibleAgents])
  const busyAgentIdSet = useMemo(() => new Set(busyAgentIds), [busyAgentIds])
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
      metrics.set(agent.id, deriveAgentMetrics(agent, recentResponsesByAgent.get(agent.id) || [], operationStates[agent.id], busyAgentIdSet.has(agent.id)))
    }
    return metrics
  }, [busyAgentIdSet, operationStates, recentResponsesByAgent, visibleAgents])

  return (
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
  )
})

const GatewayActivityPanel = memo(function GatewayActivityPanel({ agentById, gatewayLogs }: { agentById: Map<string, OpenClawAgent>; gatewayLogs: GatewayLogEntry[] }) {
  const agentResponses = useNexusStore((state) => state.agentResponses)
  const missionFeed = useNexusStore((state) => state.missionFeed)
  const [failedPortraitKeys, setFailedPortraitKeys] = useState<Set<string>>(() => new Set())
  const activity = useMemo(() => {
    const items = [
      ...agentResponses.slice(0, 24).map((entry) => ({ item: makeResponseActivity(entry), timestampMs: Date.parse(entry.timestamp) })),
      ...missionFeed.slice(0, 24).map((event) => ({ item: makeEventActivity(event), timestampMs: Date.parse(event.timestamp) })),
      ...gatewayLogs.slice(0, 48).map((entry) => ({ item: makeGatewayLogActivity(entry), timestampMs: Date.parse(entry.timestamp) })),
    ]
    return items
      .sort((a, b) => (Number.isFinite(b.timestampMs) ? b.timestampMs : 0) - (Number.isFinite(a.timestampMs) ? a.timestampMs : 0))
      .slice(0, 48)
      .map((entry) => entry.item)
  }, [agentResponses, gatewayLogs, missionFeed])

  return (
    <div className="dy-gateway-activity-list grid gap-3" role="log" aria-live="polite" aria-label="Gateway activity">
      {activity.map((item) => {
        const agentId = item.kind === 'response' || item.kind === 'event' ? item.agentId : undefined
        const agent = agentId ? agentById.get(agentId) : undefined
        const isGatewayLog = item.kind === 'gateway-log'
        const isControlCenter = isGatewayLog || (item.kind === 'event' && !item.agentId)
        const isWorkingStatus = item.kind === 'event' && !item.agentId && isWorkingDelegationText(item.detail)
        const portraitSrc = agent ? agentPortraitSrc(agent.id, agent.portrait) : ''
        const portraitKey = agent && portraitSrc ? `${agent.id}::${portraitSrc}` : ''
        const portraitFailed = portraitKey ? failedPortraitKeys.has(portraitKey) : false
        return (
          <div key={`${item.kind}-${item.id}`} className={`dy-gateway-activity-entry relative overflow-hidden rounded-xl border p-3.5 ${
            isControlCenter
              ? 'border-white/[0.045] bg-zinc-950/35'
              : item.ok
                ? 'border-white/[0.04] bg-white/[0.015]'
                : 'border-rose-400/15 bg-rose-400/[0.03]'
          }`} data-activity-kind={item.kind} data-tone={item.ok ? 'ok' : 'error'}>
            <div className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${isGatewayLog ? 'dy-gateway-activity-rail' : isControlCenter ? 'bg-slate-600/45' : 'dy-activity-rail'}`} />
            <div className="flex gap-3 pl-2">
              <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-1 ${isControlCenter ? 'bg-zinc-950/60 ring-white/[0.06]' : 'ring-white/10'}`}>
                {isControlCenter ? (
                  <img src={AUTOMNIA_LOCKUP_SRC} alt="" className="dy-monitor-automnia-avatar h-full w-full object-cover opacity-90" />
                ) : portraitSrc && !portraitFailed ? (
                  <img
                    src={portraitSrc}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setFailedPortraitKeys((current) => new Set(current).add(portraitKey))}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.02] text-sm font-bold text-slate-600">{agent?.name?.charAt(0) || 'A'}</div>
                )}
                {item.ok && <span className="dy-activity-dot absolute right-0.5 top-0.5 h-2 w-2 rounded-full" data-tone={isGatewayLog ? 'neutral' : 'emerald'} />}
                {isWorkingStatus && <span className="dy-activity-dot absolute right-1 top-1 h-2 w-2 rounded-full animate-pulse" data-tone="neutral" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`truncate text-[12px] font-bold ${isControlCenter ? 'text-slate-300' : 'text-slate-100'}`}>{isGatewayLog || isControlCenter ? 'Automnia' : agent?.name || agentId || 'Agent'}</p>
                  {isGatewayLog && <span className="dy-gateway-activity-announcer"><img src={AUTOMNIA_LOCKUP_SRC} alt="" draggable={false} />Gateway Announcement</span>}
                  <Badge className="dy-activity-status rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]" data-status={isControlCenter ? 'control' : item.ok ? 'ok' : 'blocked'} tone={activityStatusTone(item, isControlCenter)} size="micro">{isGatewayLog ? 'Gateway' : item.ok ? item.title : 'Blocked'}</Badge>
                  {item.kind !== 'gateway-log' && item.failureKind && (
                    <Badge className="rounded-full border border-amber-300/15 bg-amber-300/[0.04] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-100" tone="warning" size="micro">
                      {item.failureKind.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  <span className="font-mono text-[12px] text-slate-400">{formatRuntimeTime(item.timestamp)}</span>
                </div>
                <p className={`mt-1.5 text-[12px] leading-relaxed ${isControlCenter ? 'text-slate-400' : 'text-slate-300/90'} ${isGatewayLog ? 'dy-gateway-activity-message' : ''}`}>{isGatewayLog ? item.detail : <LiveText text={item.detail} />}</p>
                {isGatewayLog && (
                  <div className="dy-gateway-activity-meta mt-2 flex flex-wrap gap-1.5">
                    <span>{item.stream}</span>
                    {item.level && <span>{item.level}</span>}
                    {item.source && <span>{item.source}</span>}
                  </div>
                )}
                {item.files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.files.map((file) => <span key={file} className="max-w-[240px] truncate rounded-md border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1 font-mono text-[12px] text-amber-100">{file}</span>)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {!activity.length && <div className="rounded-xl border border-dashed border-white/[0.06] py-10 text-center text-[12px] font-medium text-slate-400">No Gateway activity recorded yet.</div>}
    </div>
  )
})

const GatewayActivityWorkspace = memo(function GatewayActivityWorkspace({
  agentById,
  gatewayLogs,
}: {
  agentById: Map<string, OpenClawAgent>
  gatewayLogs: GatewayLogEntry[]
}) {
  const agentResponses = useNexusStore((state) => state.agentResponses)
  const missionFeed = useNexusStore((state) => state.missionFeed)
  const visibleActivityCount = Math.min(48, agentResponses.length + missionFeed.length + gatewayLogs.length)

  return (
    <div className="dy-monitor-logs-workspace" data-log-workspace="true">
      <header className="dy-monitor-logs-hero">
        <div className="dy-monitor-logs-hero__brand"><img src={AUTOMNIA_LOCKUP_SRC} alt="Automnia AI Nexus" draggable={false} /></div>
        <div className="dy-monitor-logs-hero__stats" aria-label="Gateway activity summary">
          <div><strong>{agentResponses.length + missionFeed.length}</strong><span>agent runs</span></div>
          <div><strong>{gatewayLogs.length}</strong><span>Gateway logs</span></div>
          <div><strong>{visibleActivityCount}</strong><span>showing</span></div>
        </div>
      </header>

      <section className="dy-monitor-log-surface" aria-labelledby="gateway-activity-title">
        <div className="dy-monitor-log-surface__head">
          <div>
            <span>Automnia feed</span>
            <h3 id="gateway-activity-title">Gateway Activity</h3>
          </div>
          <span>{visibleActivityCount} recent</span>
        </div>
        <GatewayActivityPanel agentById={agentById} gatewayLogs={gatewayLogs} />
      </section>
    </div>
  )
})

export const LiveOperationMonitor = memo(function LiveOperationMonitor({
  status: runtimeStatus,
  error: runtimeError,
  onRefresh: refreshRuntimeStatus,
}: {
  status: RuntimeStatus | null
  error: string
  onRefresh: () => void
}) {
  const activePartyIds = useNexusStore((state) => state.activePartyIds)
  const agents = useNexusStore((state) => state.agents)
  const resetSimulation = useNexusStore((state) => state.resetSimulation)
  const [tab, setTab] = useState<MonitorTab>('gateway')
  const [doctorRun, setDoctorRun] = useState<DoctorRun | null>(null)
  const [doctorError, setDoctorError] = useState('')
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [gatewayRestartBusy, setGatewayRestartBusy] = useState(false)
  const [gatewayRestartError, setGatewayRestartError] = useState('')
  const [dismissedDoctorRunKey, setDismissedDoctorRunKey] = useState(readDismissedDoctorRunKey)
  const [cleanSlateBusy, setCleanSlateBusy] = useState(false)
  const [cleanSlateError, setCleanSlateError] = useState('')
  const [cleanSlateResult, setCleanSlateResult] = useState<RuntimeMonitorClearResult | null>(null)

  const activePartyIdSet = useMemo(() => new Set(activePartyIds), [activePartyIds])
  const visibleAgents = useMemo(() => agents.filter((agent) => activePartyIdSet.has(agent.id)), [agents, activePartyIdSet])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const persistedDoctorRun = runtimeStatus?.diagnostics?.doctor?.lastRun || null
  const rawDisplayedDoctorRun = doctorRun || (doctorError ? null : persistedDoctorRun)
  const rawDisplayedDoctorRunKey = doctorRunDismissKey(rawDisplayedDoctorRun)
  const doctorPanelDismissed = !doctorError && Boolean(rawDisplayedDoctorRunKey) && rawDisplayedDoctorRunKey === dismissedDoctorRunKey
  const displayedDoctorRun = doctorPanelDismissed ? null : rawDisplayedDoctorRun
  const displayedDoctorRunPersisted = !doctorRun && !doctorError && Boolean(persistedDoctorRun) && !doctorPanelDismissed
  const displayedDoctorRunStale = displayedDoctorRunPersisted && doctorSnapshotIsStale(displayedDoctorRun)

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

  const restartGateway = async () => {
    setGatewayRestartBusy(true)
    setGatewayRestartError('')
    try {
      await restartGatewayRuntime()
      refreshRuntimeStatus()
    } catch (error) {
      setGatewayRestartError(error instanceof Error ? error.message : String(error))
    } finally {
      setGatewayRestartBusy(false)
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
      <DoctorPanel run={displayedDoctorRun} error={doctorError} persisted={displayedDoctorRunPersisted} stale={displayedDoctorRunStale} onDismiss={dismissDoctorPanel} />
      {gatewayRestartError && (
        <div className="border-b border-white/[0.04] bg-black/20 px-5 py-3">
          <div
            className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] px-4 py-3 text-[11px] leading-relaxed text-rose-200/90"
            role="alert"
          >
            Restart Gateway failed: {gatewayRestartError}
          </div>
        </div>
      )}
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
            <Button key={item} id={`monitor-tab-${item}`} data-monitor-tab={item} role="tab" onClick={() => setTab(item)} data-active={tab === item ? 'true' : 'false'} aria-selected={tab === item} aria-controls={`monitor-panel-${item}`} title={MONITOR_TAB_TITLE[item]}
              variant={tab === item ? 'primary' : 'quiet'}
              size="compact"
              leadingIcon={<MonitorTabIcon tab={item} />}
              className={`flex-1 rounded-none px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-all ${tab === item ? 'bg-white/[0.065] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'}`}>
              {item === 'heartbeat' ? 'scheduler' : item}
            </Button>
          ))}
          </div>
          <div className="dy-monitor-tools">
            <Button disabled={doctorBusy} onClick={runDoctor} className="dy-monitor-tool-button" title="Run runtime doctor" size="compact" variant="secondary" loading={doctorBusy}>
              {doctorBusy ? 'Doctor running' : 'Doctor'}
            </Button>
            <Button
              disabled={gatewayRestartBusy}
              onClick={() => void restartGateway()}
              size="compact"
              variant="secondary"
              loading={gatewayRestartBusy}
              className="dy-monitor-tool-button dy-gateway-restart-button"
              title="Restart the OpenClaw Gateway and refresh runtime status."
            >
              {gatewayRestartBusy ? 'Restarting' : 'Restart Gateway'}
            </Button>
            <Button
              disabled={cleanSlateBusy}
              onClick={() => void cleanSlate()}
              size="compact"
              variant="secondary"
              loading={cleanSlateBusy}
              className="dy-monitor-tool-button"
              title="Clear local monitor cache, log tail snapshots, recent runtime calls, and stale session locks without stopping active Gateway runs."
            >
              {cleanSlateBusy ? 'Cleaning' : 'Clean Slate'}
            </Button>
          </div>
        </div>
      </div>

      <div
        id={`monitor-panel-${tab}`}
        className="dy-monitor-body p-5"
        role="tabpanel"
        aria-labelledby={`monitor-tab-${tab}`}
      >
        {tab === 'heartbeat' && <MonitorHeartbeatPanel visibleAgents={visibleAgents} />}

        {tab === 'performance' && <MonitorPerformancePanel visibleAgents={visibleAgents} />}

        {tab === 'logs' && <GatewayActivityWorkspace agentById={agentById} gatewayLogs={runtimeStatus?.gateway.logs || []} />}

        {tab === 'gateway' && (
          <RuntimeGatewayPanel status={runtimeStatus} error={runtimeError} agentById={agentById} onRefresh={refreshRuntimeStatus} />
        )}
      </div>
    </section>
  )
})

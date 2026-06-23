import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentOperationState, AgentResponse, MissionEvent, OpenClawAgent } from '../../types/nexus'
import { abortStaleGatewayChatTurns, clearRuntimeMonitor, closeRuntimeSession, restartGatewayRuntime, runRuntimeDoctor, startGatewayRuntime, stopCronShift, stopGatewayRuntime, updateCronShift, useRuntimeStatus } from '../../hooks/useRuntimeStatus'
import type { DoctorRun, GatewayChannelActivity, GatewayLogEntry, OpenAgentSession, RuntimeCronJob, RuntimeMonitorClearResult, RuntimeRun, RuntimeSessionCloseResult, RuntimeStatus } from '../../hooks/useRuntimeStatus'
import { ActionStatusBanner } from '../common/ActionStatusBanner'

const CONTROL_CENTER_LOGO_SRC = '/brand/dystopai-app-icon.png'
const GATEWAY_CHAT_STALE_TURN_MS = 5 * 60_000
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

function formatRuntimeDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  return `${seconds}s`
}

function formatRuntimeDelay(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
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

function runtimeSessionKey(session: OpenAgentSession): string {
  return `${session.agentId}:${session.sessionId}`
}

function runtimeSessionActivityMs(session: OpenAgentSession): number {
  return Math.max(
    Date.parse(session.gatewayLastEventAt || '') || 0,
    Date.parse(session.updatedAt || '') || 0,
    Date.parse(session.lastTouchedAt || '') || 0,
  )
}

function runtimeSessionState(session: OpenAgentSession): 'running' | 'gateway' | 'active' | 'locked' | 'stale-lock' | 'stored' | 'missing' {
  if (session.activeRunId) return 'running'
  if (session.gatewayActive) return 'gateway'
  if (session.active) return 'active'
  if (session.sessionLock?.removable) return 'stale-lock'
  if (session.sessionLock) return 'locked'
  return session.sessionFileExists ? 'stored' : 'missing'
}

function runtimeSessionStateLabel(session: OpenAgentSession): string {
  const state = runtimeSessionState(session)
  if (state === 'running') return 'running'
  if (state === 'gateway') return 'gateway active'
  if (state === 'active') return 'active'
  if (state === 'stale-lock') return 'stale lock'
  if (state === 'locked') return 'locked'
  if (state === 'stored') return 'stored'
  return 'missing file'
}

function compareRuntimeSessions(a: OpenAgentSession, b: OpenAgentSession): number {
  const activeWeight = (session: OpenAgentSession) => (
    session.activeRunId ? 5 : session.gatewayActive ? 4 : session.active ? 3 : session.sessionLock?.removable ? 2 : session.sessionLock ? 1 : 0
  )
  const activeDelta = activeWeight(b) - activeWeight(a)
  if (activeDelta) return activeDelta
  return runtimeSessionActivityMs(b) - runtimeSessionActivityMs(a)
}

function sessionLockLabel(session: OpenAgentSession): string {
  const lock = session.sessionLock
  if (!lock) return ''
  if (!lock.stale) return lock.pid ? `Writer pid ${lock.pid} is active` : 'Writer lock present'
  const reason = lock.staleReasons.length ? lock.staleReasons.map((item) => item.replace(/-/g, ' ')).join(', ') : 'stale'
  return lock.removable ? `Stale lock: ${reason}` : `Lock warning: ${reason}`
}

function sessionLockDetail(session: OpenAgentSession): string {
  const lock = session.sessionLock
  if (!lock) return ''
  const age = lock.ageMs ?? lock.mtimeAgeMs
  const owner = lock.pid ? `pid ${lock.pid}${lock.ownerAlive === false ? ' dead' : lock.ownerAlive ? ' alive' : ''}` : 'no pid'
  return `${sessionLockLabel(session)} (${owner}, age ${formatRuntimeDuration(age)})`
}

function sessionCloseSummary(result: RuntimeSessionCloseResult): string {
  const terminated = result.terminatedRuns.length
  const gatewayAborts = result.gatewayAborts || []
  const gatewayAbortSummary = gatewayAborts.length
    ? ` Gateway abort requested ${formatCount(gatewayAborts.filter((entry) => entry.ok).length, 'session')} of ${gatewayAborts.length}.`
    : ''
  const cleanup = result.sessionLockCleanup
  const cleanupSummary = cleanup
    ? ` Lock sweep scanned ${formatCount(cleanup.scanned, 'lock')} and removed ${formatCount(cleanup.removed, 'stale lock')}${cleanup.errors ? ` with ${formatCount(cleanup.errors, 'error')}` : ''}.`
    : ''
  return `Closed ${formatCount(result.closedSessions, 'session')}, cleared ${formatCount(result.clearedHistories, 'history', 'histories')}, and terminated ${formatCount(terminated, 'active call')}.${gatewayAbortSummary}${cleanupSummary}`
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

function avg(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function clampMetric(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

type MonitorTone = 'cyan' | 'emerald' | 'amber' | 'rose'

type MonitorIcon = 'runtime' | 'stability' | 'efficiency' | 'failed'

const HEALTH_HISTORY_LIMIT = 40
const HEALTH_SAMPLE_INTERVAL_MS = 1000
const SPARKLINE_LEFT = 6
const SPARKLINE_RIGHT = 166
const SPARKLINE_TOP = 7
const SPARKLINE_BOTTOM = 42

type HealthSnapshotInput = {
  runtime: number
  stability: number
  efficiency: number
  failedTurns: number
  runtimePulse?: number
  stabilityPulse?: number
  efficiencyPulse?: number
  failurePulse?: number
}

type HealthSnapshot = HealthSnapshotInput & {
  timestamp: number
  runtimePulse: number
  stabilityPulse: number
  efficiencyPulse: number
  failurePulse: number
}

function normalizeHealthSnapshot(health: HealthSnapshotInput, timestamp = Date.now()): HealthSnapshot {
  return {
    timestamp,
    runtime: clampMetric(health.runtime),
    stability: clampMetric(health.stability),
    efficiency: clampMetric(health.efficiency),
    failedTurns: Math.max(0, Math.round(Number.isFinite(health.failedTurns) ? health.failedTurns : 0)),
    runtimePulse: clampMetric(health.runtimePulse ?? 0),
    stabilityPulse: clampMetric(health.stabilityPulse ?? 0),
    efficiencyPulse: clampMetric(health.efficiencyPulse ?? 0),
    failurePulse: clampMetric(health.failurePulse ?? 0),
  }
}

function appendHealthSnapshot(history: HealthSnapshot[], snapshot: HealthSnapshot): HealthSnapshot[] {
  return [...history, snapshot].slice(-HEALTH_HISTORY_LIMIT)
}

function seedHealthHistory(health: HealthSnapshotInput): HealthSnapshot[] {
  const latest = normalizeHealthSnapshot(health)
  const start = latest.timestamp - ((HEALTH_HISTORY_LIMIT - 1) * HEALTH_SAMPLE_INTERVAL_MS)
  return Array.from({ length: HEALTH_HISTORY_LIMIT }, (_, index) => ({
    ...latest,
    timestamp: start + (index * HEALTH_SAMPLE_INTERVAL_MS),
  }))
}

function useHealthHistory(health: HealthSnapshotInput): HealthSnapshot[] {
  const latestRef = useRef(normalizeHealthSnapshot(health))
  const [history, setHistory] = useState<HealthSnapshot[]>(() => seedHealthHistory(health))

  useEffect(() => {
    latestRef.current = normalizeHealthSnapshot(health)
  }, [health])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHistory((previous) => appendHealthSnapshot(previous, {
        ...latestRef.current,
        timestamp: Date.now(),
      }))
    }, HEALTH_SAMPLE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  return history
}

type SparklinePoint = {
  x: number
  y: number
  value: number
  pulse: number
}

type SparklineShape = {
  linePath: string
  areaPath: string
  markers: SparklinePoint[]
}

function isFailedRuntimeRun(run: RuntimeRun): boolean {
  return run.status === 'failed' || run.status === 'timeout' || run.status === 'aborted' || run.status === 'interrupted'
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function runtimeStatusHealth(status: RuntimeStatus | null): HealthSnapshotInput {
  if (!status) return { runtime: 0, stability: 0, efficiency: 0, failedTurns: 0 }

  const recentRuns = status.recentRuns || []
  const activeRuns = status.activeRuns || []
  const completedRuns = recentRuns.filter((run) => run.status === 'completed')
  const failedRuns = recentRuns.filter(isFailedRuntimeRun)
  const finishedRuns = recentRuns.filter((run) => run.status !== 'running')
  const activeSessions = (status.sessions || []).filter((session) => session.active || session.gatewayActive).length
  const gatewayOnline = Boolean(status.gateway?.healthy || status.gateway?.processRunning)
  const gatewayChat = status.gateway?.chat
  const gatewayChatActive = (gatewayChat?.activeRuns || 0) + (gatewayChat?.activeObservers || 0)
  const gatewayChatOldestAgeMs = Math.max(gatewayChat?.oldestRunAgeMs || 0, gatewayChat?.oldestObserverAgeMs || 0)
  const gatewayChatStalePenalty = gatewayChatOldestAgeMs > GATEWAY_CHAT_STALE_TURN_MS * 2
    ? 18
    : gatewayChatOldestAgeMs > GATEWAY_CHAT_STALE_TURN_MS
      ? 8
      : 0
  const runtimeSeverity = status.runtime?.severity || 'info'
  const activity = status.gateway?.activity
  const activityCount = (activity?.inboundCount || 0) + (activity?.outboundCount || 0) + (activity?.systemCount || 0)
  const activeRunCount = activeRuns.length + gatewayChatActive
  const failureCount = failedRuns.length + activeRuns.filter(isFailedRuntimeRun).length
  const successRate = finishedRuns.length ? ((finishedRuns.length - failedRuns.length) / finishedRuns.length) * 100 : (gatewayOnline ? 92 : 0)
  const avgElapsed = mean(completedRuns.map((run) => run.elapsedMs || 0).filter((value) => value > 0))
  const avgTimeout = mean(completedRuns.map((run) => run.timeoutMs || 0).filter((value) => value > 0)) || 90_000
  const speedScore = avgElapsed
    ? clampMetric(100 - ((avgElapsed / Math.max(1, avgTimeout)) * 70))
    : activeRunCount
      ? 74
      : gatewayOnline
        ? 66
        : 0
  const runtimeBase = Math.max(
    gatewayOnline ? 58 : 0,
    activeRunCount ? 84 : 0,
    activeSessions ? 72 : 0,
    completedRuns.length ? speedScore : 0,
  )
  const stabilityBase = runtimeSeverity === 'error'
    ? 28
    : runtimeSeverity === 'warning'
      ? 66
      : gatewayOnline
        ? 90
        : 0
  const throughputScore = clampMetric(Math.min(100, (activityCount * 5) + (activeRunCount * 24) + (activeSessions * 9) + (activity?.active ? 18 : 0)))

  return {
    runtime: clampMetric(runtimeBase),
    stability: clampMetric((finishedRuns.length ? ((successRate * 0.76) + (stabilityBase * 0.24)) : stabilityBase) - gatewayChatStalePenalty),
    efficiency: clampMetric(finishedRuns.length ? ((successRate * 0.58) + (speedScore * 0.34) + (throughputScore * 0.08)) : (gatewayOnline ? Math.max(throughputScore, 52) : 0)),
    failedTurns: failureCount,
    runtimePulse: clampMetric((gatewayOnline ? 18 : 0) + (activeRunCount * 32) + (activeSessions * 12) + (activity?.active ? 24 : 0) + (gatewayChatActive * 20)),
    stabilityPulse: clampMetric((gatewayOnline ? 14 : 0) + (runtimeSeverity === 'warning' ? 18 : 0) + (runtimeSeverity === 'error' ? 36 : 0) + (failureCount * 16)),
    efficiencyPulse: clampMetric(throughputScore + (completedRuns.length * 7)),
    failurePulse: clampMetric(failureCount * 28),
  }
}

function pulseOffset(index: number, pulse: number, scaleMax: number, value: number): number {
  if (pulse <= 0) return 0
  const phase = index % 8
  const wave = phase === 2 ? 1 : phase === 3 ? -0.32 : phase === 4 ? 0.62 : phase === 5 ? -0.18 : 0
  if (!wave) return 0
  const amplitude = scaleMax * (0.055 + ((Math.min(100, pulse) / 100) * 0.19))
  const direction = value > scaleMax * 0.8 ? -1 : 1
  return wave * amplitude * direction
}

function smoothPath(points: SparklinePoint[]): string {
  if (!points.length) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const midX = (previous.x + point.x) / 2
    return `${path} C ${midX.toFixed(1)} ${previous.y.toFixed(1)}, ${midX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  }, `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`)
}

function buildSparklineShape(values: number[], maxValue: number, pulseValues: number[] = []): SparklineShape {
  const samples = values.length > 1 ? values : [values[0] || 0, values[0] || 0]
  const xRange = SPARKLINE_RIGHT - SPARKLINE_LEFT
  const yRange = SPARKLINE_BOTTOM - SPARKLINE_TOP
  const scaleMax = Math.max(1, maxValue)
  const points = samples.map((rawValue, index) => {
    const value = Math.max(0, Math.min(scaleMax, Number.isFinite(rawValue) ? rawValue : 0))
    const pulse = Math.max(0, Math.min(100, Number.isFinite(pulseValues[index]) ? pulseValues[index] : 0))
    const displayValue = Math.max(0, Math.min(scaleMax, value + pulseOffset(index, pulse, scaleMax, value)))
    const x = SPARKLINE_LEFT + ((index / (samples.length - 1)) * xRange)
    const y = SPARKLINE_BOTTOM - ((displayValue / scaleMax) * yRange)
    return { x, y, value, pulse }
  })
  const linePath = smoothPath(points)
  const first = points[0]
  const last = points[points.length - 1]
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${SPARKLINE_BOTTOM} L ${first.x.toFixed(1)} ${SPARKLINE_BOTTOM} Z`
  const markerIndexes = new Set<number>([points.length - 1])
  points.forEach((point, index) => {
    const previous = points[index - 1]
    if (point.pulse >= 55 && index % 2 === 0) markerIndexes.add(index)
    if (previous && Math.abs(point.value - previous.value) >= scaleMax * 0.08) markerIndexes.add(index)
  })
  const markers = Array.from(markerIndexes).sort((a, b) => a - b).slice(-9).map((index) => points[index])
  return { linePath, areaPath, markers }
}

function failedSparklineMax(values: number[]): number {
  const high = Math.max(0, ...values)
  return Math.max(5, Math.ceil(high / 5) * 5)
}

function MetricIcon({ type }: { type: MonitorIcon }) {
  if (type === 'runtime') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 7.5v5l3.4 2.1" />
      </svg>
    )
  }
  if (type === 'stability') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.8 19 7v5.1c0 4.25-2.75 7.1-7 8.1-4.25-1-7-3.85-7-8.1V7l7-3.2Z" />
        <path d="m8.8 12 2.1 2.1 4.5-4.7" />
      </svg>
    )
  }
  if (type === 'efficiency') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.2 15.8a8.4 8.4 0 1 1 15.6 0" />
        <path d="M12 13.2 16.4 8" />
        <path d="M7.2 15.8h9.6" />
        <path d="M6.7 10.6h.1M17.2 10.6h.1M12 6.9h.1" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.1 21 19H3l9-14.9Z" />
      <path d="M12 9v4.8" />
      <path d="M12 17.1h.1" />
    </svg>
  )
}

function Sparkline({ values, pulseValues, maxValue = 100 }: { values: number[]; pulseValues?: number[]; maxValue?: number }) {
  const gradientId = useId().replace(/:/g, '')
  const shape = useMemo(() => buildSparklineShape(values, maxValue, pulseValues), [maxValue, pulseValues, values])
  return (
    <svg className="dy-health-sparkline" viewBox="0 0 172 48" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${gradientId}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path className="dy-health-sparkline-grid" d="M6 12.5H166M6 24.5H166M6 36.5H166" />
      <path className="dy-health-sparkline-area" d={shape.areaPath} fill={`url(#${gradientId}-fill)`} />
      <path className="dy-health-sparkline-line" d={shape.linePath} />
      {shape.markers.map((point, index) => (
        <circle key={`${point.x.toFixed(1)}-${index}`} className="dy-health-sparkline-dot" cx={point.x} cy={point.y} r={point.pulse >= 55 ? 1.8 : 1.25} />
      ))}
    </svg>
  )
}

function HealthCard({
  icon,
  label,
  value,
  suffix = '',
  tone,
  series,
  pulseSeries,
  scaleMax = 100,
}: {
  icon: MonitorIcon
  label: string
  value: number
  suffix?: string
  tone: MonitorTone
  series: number[]
  pulseSeries?: number[]
  scaleMax?: number
}) {
  return (
    <div className="dy-health-card rounded-none border border-white/[0.04] bg-white/[0.015] p-3.5" data-tone={tone}>
      <span className="dy-health-icon" aria-hidden="true">
        <MetricIcon type={icon} />
      </span>
      <span className="dy-health-copy">
        <p className="dy-health-label text-[9px] font-semibold uppercase tracking-[0.14em]">{label}</p>
        <p className="dy-health-value mt-1 text-xl font-bold">{value}{suffix}</p>
      </span>
      <Sparkline values={series} pulseValues={pulseSeries} maxValue={scaleMax} />
    </div>
  )
}

function MonitorHealthGrid({ health }: { health: HealthSnapshotInput }) {
  const healthHistory = useHealthHistory(health)
  const healthSeries = useMemo(() => ({
    runtime: healthHistory.map((snapshot) => snapshot.runtime),
    stability: healthHistory.map((snapshot) => snapshot.stability),
    efficiency: healthHistory.map((snapshot) => snapshot.efficiency),
    failedTurns: healthHistory.map((snapshot) => snapshot.failedTurns),
    runtimePulse: healthHistory.map((snapshot) => snapshot.runtimePulse),
    stabilityPulse: healthHistory.map((snapshot) => snapshot.stabilityPulse),
    efficiencyPulse: healthHistory.map((snapshot) => snapshot.efficiencyPulse),
    failurePulse: healthHistory.map((snapshot) => snapshot.failurePulse),
  }), [healthHistory])
  const failedScaleMax = failedSparklineMax(healthSeries.failedTurns)

  return (
    <div className="dy-monitor-health-grid mt-4 grid gap-3 sm:grid-cols-4">
      <HealthCard icon="runtime" label="Runtime" value={health.runtime} tone="cyan" series={healthSeries.runtime} pulseSeries={healthSeries.runtimePulse} />
      <HealthCard icon="stability" label="Stability" value={health.stability} tone="emerald" series={healthSeries.stability} pulseSeries={healthSeries.stabilityPulse} />
      <HealthCard icon="efficiency" label="Efficiency" value={health.efficiency} suffix="%" tone="cyan" series={healthSeries.efficiency} pulseSeries={healthSeries.efficiencyPulse} />
      <HealthCard icon="failed" label="Failed" value={health.failedTurns} tone="rose" series={healthSeries.failedTurns} pulseSeries={healthSeries.failurePulse} scaleMax={failedScaleMax} />
    </div>
  )
}

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
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.10em]">
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

type RuntimeTelemetryTone = MonitorTone | 'neutral'

function RuntimeDatum({
  label,
  value,
  title,
  wide = false,
}: {
  label: string
  value: string | number
  title?: string
  wide?: boolean
}) {
  return (
    <div className={`dy-runtime-datum min-w-0 ${wide ? 'dy-runtime-datum-wide' : ''}`}>
      <span>{label}</span>
      <strong title={title || String(value)}>{value}</strong>
    </div>
  )
}

function RuntimeTelemetryCluster({
  label,
  tone = 'neutral',
  children,
}: {
  label: string
  tone?: RuntimeTelemetryTone
  children: ReactNode
}) {
  return (
    <div className="dy-runtime-cluster min-w-0 rounded-none border border-white/[0.04] bg-black/15 px-2.5 py-2" data-tone={tone}>
      <p>{label}</p>
      <div className="dy-runtime-cluster-items">
        {children}
      </div>
    </div>
  )
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
      className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[8px] font-semibold uppercase text-slate-400 transition hover:border-white/20 hover:bg-white/[0.055] hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300/40"
      title="Hide this Doctor summary"
      aria-label="Hide Doctor summary"
    >
      Hide
    </button>
  )
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
                <p className="mt-0.5 truncate text-[10px] text-slate-500" title={run.summary}>{run.summary}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] ${run?.ok ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`}>
                {run?.ok ? 'doctor ok' : 'action needed'}
              </span>
              <DoctorDismissButton onDismiss={onDismiss} />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {checks.map((check) => (
              <div key={check.id} className={`rounded-lg border px-2.5 py-2 text-[10px] ${check.severity === 'error' ? 'border-rose-400/18 bg-rose-400/[0.04]' : check.severity === 'warning' ? 'border-amber-400/18 bg-amber-400/[0.04]' : 'border-emerald-400/12 bg-emerald-400/[0.025]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-bold text-slate-100">{check.label}</p>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase ${check.severity === 'error' ? 'text-rose-200' : check.severity === 'warning' ? 'text-amber-200' : 'text-emerald-200'}`}>
                    {check.severity}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-slate-400" title={check.evidence}>{check.evidence}</p>
                {(check.failureKind || check.repairAction) && (
                  <p className="mt-1 line-clamp-2 text-[9px] text-cyan-200/75" title={check.repairAction || check.failureKind}>
                    {check.failureKind ? check.failureKind.replace(/_/g, ' ') : check.repairAction}
                  </p>
                )}
              </div>
            ))}
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
      className="dy-cron-job-card relative flex min-h-16 flex-col gap-2 px-3 py-2.5 text-[10px] leading-tight transition hover:bg-white/[0.025]"
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
            <span className="dy-cron-status-badge rounded-none border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[7px] font-semibold uppercase text-slate-300" data-state={status}>
              {status}
            </span>
            <span className="dy-cron-job-source">{job.source || 'openclaw'}</span>
          </div>
          <div className="dy-cron-job-title-row flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="truncate text-[12px] font-bold text-slate-100">{missionInfo.title}</p>
          </div>
          <p className="dy-cron-job-subtitle mt-0.5 truncate font-mono text-[9px] text-slate-600">{job.name} / {shortSessionId(job.cronId)}</p>
        </div>
      </div>
      <div className="dy-cron-job-details grid min-w-0 grid-cols-2 gap-1.5 text-[9px] text-slate-500 sm:grid-cols-4">
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
            <p className="mt-1 truncate text-[10px] text-slate-400">{agentName} / {shortSessionId(job.cronId)}</p>
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
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="border border-white/10 bg-black px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/50"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
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
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Frequency
              <input
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="border border-white/10 bg-black px-3 py-2 font-mono text-[12px] normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/50"
                placeholder={scheduleKind === 'cron' ? '0 12 * * 5' : scheduleKind === 'at' ? '2026-06-22T12:00:00-04:00' : '1h'}
              />
              <span className="text-[9px] normal-case tracking-normal text-slate-500">{scheduleHelp}</span>
            </label>
          </div>

          <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
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
            className="border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="dy-gateway-activity-line dy-gateway-event-card grid grid-cols-[9px_minmax(0,1fr)] items-start gap-3 border-b border-white/[0.08] px-3 py-2.5 text-[10px] leading-tight transition hover:bg-white/[0.025]" data-direction={event.direction} title={display.raw}>
      <span className="dy-gateway-direction-marker mt-1 h-2 w-2 shrink-0 rounded-none" data-direction={event.direction} aria-hidden="true" />
      <div className="dy-gateway-activity-copy min-w-0">
        <div className="dy-gateway-event-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="dy-gateway-direction-label text-[7px] font-bold uppercase tracking-[0.08em]">{display.label}</span>
          <span className="dy-gateway-event-time font-mono text-[8px] tabular-nums text-slate-500">{formatRuntimeTime(event.timestamp)}</span>
          <span className="dy-gateway-event-source max-w-full truncate font-mono text-[8px] font-semibold text-slate-400" title={channelLabel}>{channelLabel}</span>
        </div>
        <p className="dy-gateway-event-message mt-1.5 min-w-0 font-medium text-slate-100">{display.summary}</p>
        {display.detail && display.detail !== display.summary && (
          <p className="dy-gateway-event-detail mt-1 min-w-0 text-[9px] leading-snug text-slate-500">{compactRuntimeText(display.detail, 420)}</p>
        )}
      </div>
    </div>
  )
}

function RuntimeSessionsCard({
  sessions,
  agentById,
  onClose,
  closingKey,
}: {
  sessions: OpenAgentSession[]
  agentById: Map<string, OpenClawAgent>
  onClose: (session: OpenAgentSession) => void
  closingKey: string
}) {
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  const activeCount = sessions.filter((session) => session.activeRunId || session.active || session.gatewayActive).length
  const displayedSessions = sessions.slice(0, 16)
  const hiddenCount = Math.max(0, sessions.length - displayedSessions.length)
  const sessionSummary = activeCount
    ? `${activeCount} active lane${activeCount === 1 ? '' : 's'}`
    : `${sessions.length} total lane${sessions.length === 1 ? '' : 's'}`

  return (
    <div className="dy-monitor-card dy-runtime-sessions-card flex min-h-0 flex-col rounded-none border border-white/[0.04] bg-white/[0.015]" data-expanded={expanded}>
      <button
        type="button"
        className="dy-runtime-sessions-toggle grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-none border-0 bg-transparent px-3 py-2.5 text-left transition hover:bg-white/[0.035] focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-200/50"
        aria-controls={panelId}
        aria-expanded={expanded}
        title={expanded ? 'Hide runtime session controls' : 'Show runtime session controls'}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0">
          <p className="dy-runtime-sessions-title truncate text-[12px] font-bold text-slate-100">Runtime Sessions</p>
          <p className="dy-runtime-sessions-summary mt-0.5 truncate text-[9px] text-slate-500">{sessionSummary}</p>
        </div>
        <div className="dy-runtime-session-stats flex items-center gap-1.5">
          <span className="dy-channel-activity-stat border border-white/[0.08] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400" data-state={activeCount ? 'active' : 'quiet'}>
            {activeCount ? `${activeCount} active` : 'quiet'}
          </span>
          <span className="dy-runtime-sessions-toggle-label border border-white/[0.08] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {expanded ? 'hide' : 'open'}
          </span>
        </div>
      </button>
      {expanded && (
        <div id={panelId} className="dy-runtime-sessions-panel min-h-0 px-3 pb-3" role="region" aria-label="Runtime session lanes">
          <p className="dy-runtime-sessions-description mb-2 text-[10px] text-slate-500">Gateway session lanes, cached history, and lock sweep controls</p>
          <div className="dy-monitor-stream-box dy-runtime-session-list min-h-0 overflow-auto rounded-none border border-white/[0.04] bg-black/25 shadow-inner shadow-black/20">
            {displayedSessions.map((session) => {
              const agent = agentById.get(session.agentId)
              const key = runtimeSessionKey(session)
              const busy = closingKey === key
              const state = runtimeSessionState(session)
              const latestActivity = session.gatewayLastEventAt || session.updatedAt || session.lastTouchedAt
              const closeLabel = state === 'stored' || state === 'missing' || state === 'locked' || state === 'stale-lock' ? 'Sweep' : 'Close lane'
              const closeTitle = state === 'stored' || state === 'missing' || state === 'locked' || state === 'stale-lock'
                ? 'Clear cached history for this session and sweep any matching stale lock.'
                : 'Abort active runtime work for this session, clear cached history, and sweep matching stale locks.'
              const lockDetail = sessionLockDetail(session)
              return (
                <div
                  key={key}
                  className="dy-runtime-session-card border-b border-white/[0.08] px-3 py-2.5 text-[10px] leading-tight transition hover:bg-white/[0.025]"
                  data-state={state}
                  title={`${agent?.name || session.agentId} / ${session.sessionId}`}
                >
                  <div className="dy-runtime-session-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="dy-runtime-session-state rounded-none border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[7px] font-semibold uppercase text-slate-300" data-state={state}>
                          {runtimeSessionStateLabel(session)}
                        </span>
                        <p className="min-w-0 truncate text-[11px] font-bold text-slate-100">{agent?.name || session.agentId}</p>
                      </div>
                      <p className="mt-1 truncate font-mono text-[8.5px] text-slate-600" title={session.sessionId}>
                        {shortSessionId(session.sessionId)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(closingKey)}
                      onClick={() => onClose(session)}
                      title={closeTitle}
                      aria-label={`${closeLabel} session ${session.sessionId} for ${agent?.name || session.agentId}`}
                      className="dy-gateway-action-button dy-runtime-session-close rounded-none border border-rose-300/15 bg-rose-300/[0.035] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-rose-200/80 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                      data-tone="rose"
                    >
                      {busy ? 'Closing' : closeLabel}
                    </button>
                  </div>
                  <div className="dy-runtime-session-details mt-2 grid min-w-0 grid-cols-2 gap-1.5 text-[9px] text-slate-500 sm:grid-cols-4">
                    <span className="dy-session-meta-chip"><span>Provider</span><strong>{session.provider || 'default'}</strong></span>
                    <span className="dy-session-meta-chip" title={session.modelId || undefined}><span>Model</span><strong>{session.modelId || 'default'}</strong></span>
                    <span className="dy-session-meta-chip"><span>Messages</span><strong>{session.conversationMessages}</strong></span>
                    <span className="dy-session-meta-chip"><span>Activity</span><strong>{formatRuntimeTime(latestActivity)}</strong></span>
                  </div>
                  {session.sessionLock && (
                    <div
                      className="dy-runtime-session-lock mt-2 min-w-0 rounded-none border px-2 py-1.5 text-[9px] leading-snug"
                      data-stale={session.sessionLock.stale ? 'true' : 'false'}
                      data-removable={session.sessionLock.removable ? 'true' : 'false'}
                      title={`${lockDetail}\n${session.sessionLock.lockPath}`}
                    >
                      <span className="font-semibold uppercase tracking-[0.08em]">{session.sessionLock.removable ? 'Reclaimable lock' : session.sessionLock.stale ? 'Lock warning' : 'Writer lock'}</span>
                      <strong>{lockDetail}</strong>
                    </div>
                  )}
                  {(session.activeRunId || session.gatewayEventCount || !session.sessionFileExists) && (
                    <p className="mt-1.5 truncate font-mono text-[8.5px] text-slate-500" title={session.activeRunId || session.sessionFile || undefined}>
                      {session.activeRunId
                        ? `run ${shortSessionId(session.activeRunId)}`
                        : !session.sessionFileExists
                          ? 'session file missing'
                          : `${session.gatewayEventCount || 0} gateway events`}
                    </p>
                  )}
                </div>
              )
            })}
            {hiddenCount > 0 && (
              <div className="border-t border-white/[0.05] px-3 py-2 text-[9px] uppercase tracking-[0.10em] text-slate-600">
                {hiddenCount} older session{hiddenCount === 1 ? '' : 's'} hidden
              </div>
            )}
            {!displayedSessions.length && (
              <div className="dy-monitor-empty dy-session-empty-state py-6 text-center text-[11px] font-medium text-slate-600">
                <strong>No runtime sessions.</strong>
                <span>Gateway-backed agent sessions will appear here when they start.</span>
              </div>
            )}
          </div>
        </div>
      )}
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
          <p className="mt-0.5 text-[10px] text-slate-500">Recent Telegram, SMS, and plugin traffic</p>
        </div>
        <div className="dy-channel-activity-stats flex flex-wrap items-center gap-1.5">
          <span className="dy-channel-activity-stat border border-white/[0.08] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400" data-state={activity?.active ? 'active' : 'quiet'}>
            {activity?.active ? 'active' : 'quiet'}
          </span>
          <span className="dy-channel-activity-stat border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="inbound">{activity?.inboundCount || 0} incoming</span>
          <span className="dy-channel-activity-stat border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="outbound">{activity?.outboundCount || 0} sent</span>
          {Boolean(activity?.systemCount) && (
            <span className="dy-channel-activity-stat border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-300" data-direction="system" title={`${activity?.systemCount || 0} system event${(activity?.systemCount || 0) === 1 ? '' : 's'} captured`}>{activity?.systemCount || 0} system</span>
          )}
        </div>
      </div>
      <div className="dy-monitor-stream-box dy-gateway-event-list min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/25 shadow-inner shadow-black/20">
        {events.slice(0, 28).map((event) => <GatewayActivityLine key={event.id} event={event} />)}
        {!events.length && <div className="dy-monitor-empty py-6 text-center text-[11px] font-medium text-slate-600">No channel activity captured yet.</div>}
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
          <span className="text-[9px] font-semibold uppercase tracking-[0.10em] text-slate-500">{logs.length} entries</span>
          <button
            type="button"
            className="dy-gateway-log-toggle rounded-none border border-white/[0.10] bg-black/30 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-300 transition hover:border-white/30 hover:bg-white/[0.06]"
            aria-controls={logTailId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {expanded && (
        <div id={logTailId} className="dy-monitor-log-box min-h-0 flex-1 overflow-auto rounded-none border border-white/[0.04] bg-black/30 p-3 font-mono text-[9px] leading-[1.45]" role="list" aria-label="Gateway log tail">
          {visibleLogs.length ? visibleLogs.map((entry) => <GatewayLogLine key={entry.id} entry={entry} />) : <div className="dy-gateway-log-empty text-slate-600">No gateway log entries captured yet.</div>}
          {hiddenLogCount > 0 && (
            <div className="dy-gateway-log-hidden mt-3 border-t border-white/[0.05] pt-3 text-[9px] uppercase tracking-[0.10em] text-slate-600">
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
  const gatewayTone: MonitorTone = gateway?.healthy ? 'emerald' : gateway?.processRunning ? 'amber' : 'rose'
  const runtimeTone: MonitorTone = status?.runtime?.severity === 'error' ? 'rose' : status?.runtime?.severity === 'warning' ? 'amber' : 'emerald'
  const doctorDiagnostics = status?.diagnostics?.doctor
  const lastDoctorRun = doctorDiagnostics?.lastRun || null
  const doctorTone: MonitorTone = doctorDiagnostics?.errorCount
    ? 'rose'
    : doctorDiagnostics?.warningCount
      ? 'amber'
      : lastDoctorRun
        ? 'emerald'
        : 'cyan'
  const activeCronJobs = useMemo(() => status?.shifts?.active || [], [status?.shifts?.active])
  const activeCronCount = status?.shifts?.activeCount ?? activeCronJobs.length
  const nextCronJob = useMemo(() => {
    return activeCronJobs.reduce<RuntimeCronJob | null>((next, job) => {
      const nextTime = next ? cronJobDisplayTime(next) : null
      const nextMs = nextTime ? Date.parse(nextTime) : Number.POSITIVE_INFINITY
      const jobTime = cronJobDisplayTime(job)
      const jobMs = jobTime ? Date.parse(jobTime) : Number.NaN
      if (Number.isNaN(jobMs)) return next
      return jobMs < nextMs ? job : next
    }, null)
  }, [activeCronJobs])
  const nextCronTime = nextCronJob ? cronJobDisplayTime(nextCronJob) : null
  const cronAgents = useMemo(() => new Set(activeCronJobs.map((job) => job.agent)).size, [activeCronJobs])
  const cronCadences = useMemo(() => Array.from(new Set(activeCronJobs.map((job) => job.every).filter(Boolean))), [activeCronJobs])
  const cronTone: MonitorTone = activeCronCount > 0 ? 'emerald' : 'cyan'
  const logs = gateway?.logs || []
  const activity = gateway?.activity
  const gatewayChat = gateway?.chat
  const gatewayChatActiveRuns = gatewayChat?.activeRuns || 0
  const gatewayChatActiveObservers = gatewayChat?.activeObservers || 0
  const gatewayChatOldestAgeMs = Math.max(gatewayChat?.oldestRunAgeMs || 0, gatewayChat?.oldestObserverAgeMs || 0)
  const gatewayChatLatestRecovery = gatewayChat?.recentRecoveries?.[0] || null
  const gatewayStartup = gateway?.startup
  const gatewayStartupTimeline = gatewayStartup?.timeline || []
  const gatewayStartupLatest = gatewayStartupTimeline.length ? gatewayStartupTimeline[gatewayStartupTimeline.length - 1] : null
  const gatewayStartupGraceRemainingMs = gatewayStartup?.graceRemainingMs ?? gateway?.startupGraceRemainingMs ?? 0
  const gatewayStartupTone: RuntimeTelemetryTone = gatewayStartupLatest?.status === 'failed'
    ? 'rose'
    : gatewayStartupLatest?.status === 'warning'
      ? 'amber'
      : gatewayStartupLatest?.phase === 'healthy' || gateway?.healthy
        ? 'emerald'
        : gateway?.ensureInFlight || gatewayStartupGraceRemainingMs > 0
          ? 'cyan'
          : 'neutral'
  const gatewayStartupPhase = gatewayStartupLatest?.phase || (gateway?.ensureInFlight ? 'starting' : gateway?.healthy ? 'healthy' : 'idle')
  const gatewayStartupLastDuration = gatewayStartupLatest?.durationMs !== undefined
    ? formatRuntimeDuration(gatewayStartupLatest.durationMs)
    : gatewayStartupLatest?.status || '-'
  const gatewayReadiness = gateway?.readiness
  const gatewayReadinessTone: RuntimeTelemetryTone = !gatewayReadiness
    ? 'neutral'
    : !gatewayReadiness.reachable
      ? 'rose'
      : gatewayReadiness.ready && !gatewayReadiness.degraded
        ? 'emerald'
        : 'amber'
  const gatewayReadinessLabel = gatewayReadiness?.ready
    ? 'yes'
    : gatewayReadiness?.reachable
      ? 'settling'
      : gateway?.processRunning
        ? 'probing'
        : 'offline'
  const gatewayReadinessDetail = gatewayReadiness?.failing?.length
    ? gatewayReadiness.failing.join('; ')
    : gatewayReadiness?.error || gatewayReadiness?.status || (gatewayReadiness?.ready ? 'Gateway readyz reports usable readiness.' : 'Gateway readiness has not been confirmed.')
  const gatewayEventLoopLabel = gatewayReadiness?.eventLoop
    ? gatewayReadiness.eventLoop.degraded
      ? 'degraded'
      : 'ok'
    : '-'
  const gatewayEventLoopTitle = gatewayReadiness?.eventLoop
    ? [
        gatewayReadiness.eventLoop.reasons.length ? gatewayReadiness.eventLoop.reasons.join('; ') : 'Event loop within readiness thresholds.',
        `max ${formatRuntimeDelay(gatewayReadiness.eventLoop.delayMaxMs)}`,
        `util ${gatewayReadiness.eventLoop.utilization !== undefined ? gatewayReadiness.eventLoop.utilization.toFixed(3) : '-'}`,
      ].join(' ')
    : 'No readyz event-loop block was returned.'
  const gatewayChatTone: RuntimeTelemetryTone = !gatewayChat
    ? 'neutral'
    : gatewayChatOldestAgeMs > GATEWAY_CHAT_STALE_TURN_MS * 2
      ? 'rose'
      : gatewayChatOldestAgeMs > GATEWAY_CHAT_STALE_TURN_MS
        ? 'amber'
        : gatewayChatActiveRuns || gatewayChatActiveObservers
          ? 'emerald'
          : 'cyan'
  const gatewayChatHasStaleTurns = gatewayChatOldestAgeMs >= GATEWAY_CHAT_STALE_TURN_MS && gatewayChatActiveRuns > 0
  const runtimeSessions = useMemo(() => [...(status?.sessions || [])].sort(compareRuntimeSessions), [status?.sessions])
  const [runtimeAction, setRuntimeAction] = useState('')
  const [sessionCloseKey, setSessionCloseKey] = useState('')
  const [cronCancelKey, setCronCancelKey] = useState('')
  const [cronCancelConfirm, setCronCancelConfirm] = useState(false)
  const [cronEditJob, setCronEditJob] = useState<RuntimeCronJob | null>(null)
  const [cronEditKey, setCronEditKey] = useState('')
  const [actionError, setActionError] = useState('')
  const [runtimeNotice, setRuntimeNotice] = useState('')
  const gatewayFullyStopped = Boolean(gateway && !gateway.healthy && !gateway.processRunning && !gateway.ensureInFlight && !gateway.restartScheduled)
  const gatewayPrimaryAction = gatewayFullyStopped ? 'start-gateway' : 'restart-gateway'
  const gatewayPrimaryBusy = runtimeAction === 'start-gateway' || runtimeAction === 'restart-gateway'
  const gatewayPrimaryLabel = runtimeAction === 'start-gateway'
    ? 'Starting'
    : runtimeAction === 'restart-gateway'
      ? 'Resetting'
      : gatewayFullyStopped
        ? 'Start gateway'
        : 'Reset gateway'
  const gatewayPrimaryTitle = gatewayFullyStopped
    ? 'Start the OpenClaw gateway process and recheck health.'
    : 'Force stop any stale gateway listener, start OpenClaw again, and recheck health.'
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
  const closeSessionLane = async (session: OpenAgentSession) => {
    const key = runtimeSessionKey(session)
    if (sessionCloseKey) return
    setCronCancelConfirm(false)
    setSessionCloseKey(key)
    setActionError('')
    setRuntimeNotice('')
    try {
      const result = await closeRuntimeSession({ agentId: session.agentId, sessionId: session.sessionId, sessionKey: session.sessionKey })
      setRuntimeNotice(sessionCloseSummary(result))
      onRefresh()
      window.setTimeout(onRefresh, 1500)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionCloseKey('')
    }
  }
  const stopGateway = async () => {
    setCronCancelConfirm(false)
    setRuntimeAction('stop-gateway')
    setActionError('')
    setRuntimeNotice('')
    try {
      await stopGatewayRuntime()
      setRuntimeNotice('Gateway stop requested. Once shutdown is confirmed, the reset action becomes Start gateway.')
      onRefresh()
      window.setTimeout(onRefresh, 1500)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeAction('')
    }
  }
  const startGateway = async () => {
    setCronCancelConfirm(false)
    setRuntimeAction('start-gateway')
    setActionError('')
    setRuntimeNotice('')
    try {
      await startGatewayRuntime()
      setRuntimeNotice('Gateway start requested. Runtime status will refresh after the health check completes.')
      onRefresh()
      window.setTimeout(onRefresh, 1500)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeAction('')
    }
  }
  const restartGateway = async () => {
    setCronCancelConfirm(false)
    setRuntimeAction('restart-gateway')
    setActionError('')
    setRuntimeNotice('')
    try {
      await restartGatewayRuntime()
      setRuntimeNotice('Gateway reset requested. Runtime status will refresh after the health check completes.')
      onRefresh()
      window.setTimeout(onRefresh, 1500)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeAction('')
    }
  }
  const runGatewayPrimaryAction = () => {
    void (gatewayPrimaryAction === 'start-gateway' ? startGateway() : restartGateway())
  }
  const abortStaleGatewayTurns = async () => {
    if (!gatewayChatHasStaleTurns || runtimeAction === 'abort-stale-chat') return
    setCronCancelConfirm(false)
    setRuntimeAction('abort-stale-chat')
    setActionError('')
    setRuntimeNotice('')
    try {
      const result = await abortStaleGatewayChatTurns(GATEWAY_CHAT_STALE_TURN_MS)
      const aborted = result.aborted.length
      setRuntimeNotice(aborted
        ? `Aborted ${aborted} stale Gateway agent turn${aborted === 1 ? '' : 's'}.`
        : `No Gateway agent turns were older than ${formatRuntimeDuration(result.minAgeMs)}.`)
      onRefresh()
      window.setTimeout(onRefresh, 1200)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeAction('')
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
          actionTextClassName="text-[8px]"
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
        <div className="dy-monitor-card dy-gateway-summary-card flex flex-col rounded-none border border-white/[0.04] bg-white/[0.015] p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold text-slate-100">Gateway Runtime</p>
                <p className="mt-0.5 text-[10px] text-slate-500">OpenClaw gateway health, process, and restart state</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <span className={`dy-gateway-status-pill inline-flex items-center gap-1.5 rounded-none border px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] ${gateway?.healthy ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200' : gateway?.processRunning ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`} data-tone={gateway?.healthy ? 'emerald' : gateway?.processRunning ? 'amber' : 'rose'}>
                  <span className={`h-1.5 w-1.5 rounded-none ${gateway?.healthy ? 'bg-emerald-400' : gateway?.processRunning ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`} />
                  {gateway?.state || 'checking'}
                </span>
                <button
                  type="button"
                  disabled={gatewayPrimaryBusy || runtimeAction === 'stop-gateway'}
                  onClick={runGatewayPrimaryAction}
                  className="dy-gateway-action-button rounded-none border border-cyan-300/15 bg-cyan-300/[0.035] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-cyan-100/85 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                  data-tone="cyan"
                  title={gatewayPrimaryTitle}
                >
                  {gatewayPrimaryLabel}
                </button>
                <button
                  type="button"
                  disabled={runtimeAction === 'stop-gateway' || gatewayPrimaryBusy || (!gateway?.healthy && !gateway?.processRunning)}
                  onClick={stopGateway}
                  className="dy-gateway-action-button rounded-none border border-rose-300/15 bg-rose-300/[0.035] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-rose-200/85 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                  data-tone="rose"
                  title="Stop the OpenClaw gateway process. Gateway-backed actions can start it again later."
                >
                  {runtimeAction === 'stop-gateway' ? 'Stopping' : 'Stop gateway'}
                </button>
                {gatewayChatHasStaleTurns && (
                  <button
                    type="button"
                    disabled={runtimeAction === 'abort-stale-chat'}
                    onClick={() => void abortStaleGatewayTurns()}
                    className="dy-gateway-action-button rounded-none border border-amber-300/15 bg-amber-300/[0.035] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-amber-100/85 transition hover:border-amber-300/30 hover:bg-amber-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                    data-tone="amber"
                    title={`Abort Gateway agent turns older than ${formatRuntimeDuration(GATEWAY_CHAT_STALE_TURN_MS)}. Partial output remains visible when the Gateway has buffered it.`}
                  >
                    {runtimeAction === 'abort-stale-chat' ? 'Aborting turns' : 'Abort stale turns'}
                  </button>
                )}
              </div>
            </div>
            <RuntimeSessionsCard
              sessions={runtimeSessions}
              agentById={agentById}
              onClose={(session) => void closeSessionLane(session)}
              closingKey={sessionCloseKey}
            />
            <div className="dy-runtime-compact-grid mt-3">
              <RuntimeTelemetryCluster label="Process" tone={gatewayTone}>
                <RuntimeDatum label="Port" value={gateway?.port ?? '-'} />
                <RuntimeDatum label="PID" value={gateway?.pid ?? 'none'} />
                <RuntimeDatum label="Uptime" value={formatRuntimeDuration(gateway?.uptimeMs)} wide />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Health" tone={gatewayTone}>
                <RuntimeDatum label="Healthy" value={formatRuntimeTime(gateway?.lastHealthyAt)} />
                <RuntimeDatum label="Started" value={formatRuntimeTime(gateway?.lastStartedAt)} />
                {gatewayStartupGraceRemainingMs > 0 && (
                  <RuntimeDatum
                    label="Grace"
                    value={formatRuntimeDuration(gatewayStartupGraceRemainingMs)}
                    title="Gateway startup grace remaining before Control Center treats missing health as restart-worthy."
                  />
                )}
                <RuntimeDatum label="Exit" value={formatRuntimeTime(gateway?.lastExitAt)} wide />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Readiness" tone={gatewayReadinessTone}>
                <RuntimeDatum label="Ready" value={gatewayReadinessLabel} title={gatewayReadinessDetail} />
                <RuntimeDatum label="Loop" value={gatewayEventLoopLabel} title={gatewayEventLoopTitle} />
                <RuntimeDatum label="P99" value={formatRuntimeDelay(gatewayReadiness?.eventLoop?.delayP99Ms)} title={gatewayEventLoopTitle} />
                <RuntimeDatum label="Uptime" value={formatRuntimeDuration(gatewayReadiness?.uptimeMs)} />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Startup" tone={gatewayStartupTone}>
                <RuntimeDatum label="Phase" value={gatewayStartupPhase} title={gatewayStartupLatest?.message || 'No startup sequence recorded yet.'} />
                <RuntimeDatum label="Elapsed" value={gatewayStartupLatest ? formatRuntimeDuration(gatewayStartupLatest.elapsedMs) : '-'} />
                <RuntimeDatum label="Steps" value={gatewayStartupTimeline.length} />
                <RuntimeDatum
                  label="Last"
                  value={gatewayStartupLastDuration}
                  title={gatewayStartupLatest ? `${gatewayStartupLatest.status}: ${gatewayStartupLatest.message}` : 'No startup sequence recorded yet.'}
                />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Traffic" tone={activity?.active ? 'emerald' : 'neutral'}>
                <RuntimeDatum label="Channel" value={activity?.active ? 'active' : 'quiet'} />
                <RuntimeDatum label="Last event" value={formatRuntimeTime(activity?.lastEventAt)} />
                <RuntimeDatum label="Counts" value={`${activity?.inboundCount || 0} in / ${activity?.outboundCount || 0} out / ${activity?.systemCount || 0} sys`} wide />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Agent Turns" tone={gatewayChatTone}>
                <RuntimeDatum label="Runs" value={gatewayChatActiveRuns} />
                <RuntimeDatum label="Streams" value={gatewayChatActiveObservers} />
                {gatewayChatLatestRecovery && (
                  <RuntimeDatum
                    label="Recovered"
                    value={`${gatewayChatLatestRecovery.abortedCount} @ ${formatRuntimeTime(gatewayChatLatestRecovery.timestamp)}`}
                    title={`${gatewayChatLatestRecovery.reason}; threshold ${formatRuntimeDuration(gatewayChatLatestRecovery.minAgeMs)}; ${gatewayChatLatestRecovery.abortedCount} aborted, ${gatewayChatLatestRecovery.skippedCount} still active.`}
                    wide
                  />
                )}
                <RuntimeDatum
                  label="Oldest"
                  value={gatewayChatOldestAgeMs ? formatRuntimeDuration(gatewayChatOldestAgeMs) : 'idle'}
                  title={gatewayChat ? `Oldest run ${formatRuntimeDuration(gatewayChat.oldestRunAgeMs)} / stream ${formatRuntimeDuration(gatewayChat.oldestObserverAgeMs)}` : 'Gateway chat waiter metrics are not available yet.'}
                  wide
                />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Build" tone={runtimeTone}>
                <RuntimeDatum label="Version" value={status?.runtime?.current || 'unknown'} title={status?.runtime?.current || undefined} wide />
                <RuntimeDatum label="Restarts" value={gateway?.restartCount ?? 0} />
                <RuntimeDatum label="Queued" value={gateway?.restartScheduled ? 'yes' : 'no'} />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Doctor" tone={doctorTone}>
                <RuntimeDatum label="Last" value={formatRuntimeTime(doctorDiagnostics?.lastRunAt)} />
                <RuntimeDatum label="Issues" value={`${doctorDiagnostics?.errorCount || 0} err / ${doctorDiagnostics?.warningCount || 0} warn`} wide />
                <RuntimeDatum
                  label="History"
                  value={doctorDiagnostics?.recent?.length || 0}
                  title={lastDoctorRun?.summary || 'Run Doctor to generate an upgrade and runtime readiness report.'}
                />
              </RuntimeTelemetryCluster>
              <RuntimeTelemetryCluster label="Cron Jobs" tone={cronTone}>
                <RuntimeDatum label="Active" value={activeCronCount} />
                <RuntimeDatum label="Agents" value={cronAgents || 0} />
                <RuntimeDatum
                  label="Next"
                  value={nextCronTime ? formatCronRemaining(nextCronTime) : 'none'}
                  title={nextCronJob && nextCronTime ? `${nextCronJob.name} ${cronJobTimeLabel(nextCronJob).toLowerCase()} at ${formatRuntimeTime(nextCronTime)}` : undefined}
                  wide
                />
              </RuntimeTelemetryCluster>
            </div>
          </div>

        <GatewayActivityCard activity={activity} />

          <div className="dy-monitor-card dy-cron-jobs-card flex min-h-0 flex-col self-stretch rounded-none border border-white/[0.04] bg-white/[0.015] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold text-slate-100">Active Cron Jobs</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Enabled OpenClaw cron jobs currently scheduled</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.10em] text-slate-500">{activeCronCount} active</span>
                {cronCadences.length > 0 && (
                  <span className="dy-cron-cadence-badge hidden rounded-none border border-white/[0.06] bg-white/[0.025] px-2 py-0.5 text-[8px] font-semibold text-slate-400 sm:inline-flex" title={cronCadences.join(', ')}>
                    {cronCadences.slice(0, 2).join(' / ')}
                  </span>
                )}
                {activeCronJobs.length > 0 && (
                  <button
                    type="button"
                    disabled={cronCancelKey === '__all__'}
                    onClick={requestCancelAllCronJobs}
                    title={`Pause all ${activeCronJobs.length} active cron jobs`}
                    className="dy-cron-cancel-button rounded-none border border-rose-300/15 bg-rose-300/[0.035] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-rose-200/80 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
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
                <div className="dy-monitor-empty dy-session-empty-state dy-cron-empty-state py-6 text-center text-[11px] font-medium text-slate-600">
                  <span className="dy-session-empty-icon dy-cron-empty-icon" aria-hidden="true">
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
  const [dismissedDoctorRunKey, setDismissedDoctorRunKey] = useState(readDismissedDoctorRunKey)
  const [cleanSlateBusy, setCleanSlateBusy] = useState(false)
  const [cleanSlateError, setCleanSlateError] = useState('')
  const [cleanSlateResult, setCleanSlateResult] = useState<RuntimeMonitorClearResult | null>(null)
  const [healthResetKey, setHealthResetKey] = useState(0)

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
  const runtimeHealth = useMemo(() => runtimeStatusHealth(runtimeStatus), [runtimeStatus])
  const health = useMemo(() => {
    const active = visibleAgents.filter((agent) => operationStates[agent.id]?.heartbeatStatus === 'active').length
    const metrics = visibleAgents.map((agent) => liveMetricsByAgent.get(agent.id)).filter((entry): entry is AgentLiveMetrics => Boolean(entry))
    const metricsHaveSignal = metrics.some((entry) => entry.turns > 0 || entry.failures > 0 || entry.runtime > 0 || entry.stability > 0 || entry.efficiency > 0)
    const runtime = metricsHaveSignal ? avg(metrics.map((entry) => entry.runtime)) : runtimeHealth.runtime
    const stability = metricsHaveSignal ? avg(metrics.map((entry) => entry.stability)) : runtimeHealth.stability
    const efficiency = metricsHaveSignal ? avg(metrics.map((entry) => entry.efficiency)) : runtimeHealth.efficiency
    const failedTurns = Math.max(agentResponses.slice(0, 40).filter((response) => !response.ok).length, runtimeHealth.failedTurns)
    const busyPulse = busyAgentIds.length * 24
    return {
      active,
      runtime,
      stability,
      efficiency,
      failedTurns,
      runtimePulse: clampMetric(Math.max(runtimeHealth.runtimePulse || 0, (active * 18) + busyPulse)),
      stabilityPulse: clampMetric(Math.max(runtimeHealth.stabilityPulse || 0, active * 10)),
      efficiencyPulse: clampMetric(Math.max(runtimeHealth.efficiencyPulse || 0, busyPulse + (metricsHaveSignal ? efficiency : 0))),
      failurePulse: clampMetric(Math.max(runtimeHealth.failurePulse || 0, failedTurns * 22)),
    }
  }, [agentResponses, busyAgentIds, liveMetricsByAgent, operationStates, runtimeHealth, visibleAgents])
  const persistedDoctorRun = runtimeStatus?.diagnostics?.doctor?.lastRun || null
  const rawDisplayedDoctorRun = doctorRun || (doctorError ? null : persistedDoctorRun)
  const rawDisplayedDoctorRunKey = doctorRunDismissKey(rawDisplayedDoctorRun)
  const doctorPanelDismissed = !doctorError && Boolean(rawDisplayedDoctorRunKey) && rawDisplayedDoctorRunKey === dismissedDoctorRunKey
  const displayedDoctorRun = doctorPanelDismissed ? null : rawDisplayedDoctorRun
  const displayedDoctorRunPersisted = !doctorRun && !doctorError && Boolean(persistedDoctorRun) && !doctorPanelDismissed
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

  const cleanSlate = async () => {
    setCleanSlateBusy(true)
    setCleanSlateError('')
    setCleanSlateResult(null)
    resetSimulation()
    setDoctorRun(null)
    setDoctorError('')
    setDismissedDoctorRunKey('')
    rememberDismissedDoctorRunKey('')
    setHealthResetKey((value) => value + 1)
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
      {/* Header */}
      <div className="dy-monitor-header relative overflow-hidden border-b border-white/[0.05] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(184,188,190,0.018)_38%,rgba(255,255,255,0.01))] px-5 py-4">
        <MonitorHealthGrid key={healthResetKey} health={health} />
      </div>

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
              className={`flex-1 rounded-none px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-all ${tab === item ? 'bg-white/[0.065] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'}`}>
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
                    <span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] ${statusClass(op?.heartbeatStatus)}`}>
                      {op?.heartbeatStatus ?? 'dormant'}
                    </span>
                  </div>
                  <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[9px] text-slate-500">Cron Cadence</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{formatCadence(agent.heartbeat.tickIntervalMs)}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[9px] text-slate-500">Retry</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{op?.retryCount ?? 0} / interval {formatCadence(agent.heartbeat.idleTimeoutMs)}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[9px] text-slate-500">Loop Flag</span>
                      <p className="font-semibold text-slate-200 text-[11px]">{agent.heartbeat.continuous ? 'on' : 'off'}</p>
                    </div>
                    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5">
                      <span className="text-[9px] text-slate-500">Recovery</span>
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
                  <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-cyan-300/80">
                    {(liveMetricsByAgent.get(agent.id)?.turns || 0)} turns · {liveMetricsByAgent.get(agent.id)?.lastTurnAt ? new Date(liveMetricsByAgent.get(agent.id)!.lastTurnAt!).toLocaleTimeString() : 'no runs'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricBar label="Efficiency" value={liveMetricsByAgent.get(agent.id)?.efficiency || 0} />
                  <MetricBar label="Runtime" value={liveMetricsByAgent.get(agent.id)?.runtime || 0} tone="emerald" />
                  <MetricBar label="Stability" value={liveMetricsByAgent.get(agent.id)?.stability || 0} tone="amber" />
                  <MetricBar label="Success" value={liveMetricsByAgent.get(agent.id)?.successRate || 0} />
                </div>
              </div>
            ))}
            {latestReport && (
              <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3.5">
                <p className="text-[11px] text-cyan-200/90 leading-relaxed">
                  Last report: efficiency {latestReport.efficiencyRating}, drift {latestReport.soulDrift}, errors {latestReport.errors}, XP +{latestReport.xpGained}
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
                        <span className="dy-activity-status rounded-full border px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.08em]" data-status={isControlCenter ? 'control' : item.ok ? 'ok' : 'blocked'}>{item.ok ? item.title : 'Blocked'}</span>
                        {item.failureKind && (
                          <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.04] px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.08em] text-amber-200/80">
                            {item.failureKind.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="font-mono text-[9px] text-slate-600">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className={`mt-1.5 text-[11px] leading-relaxed ${isControlCenter ? 'text-slate-500' : 'text-slate-300/90'}`}><LiveText text={item.detail} /></p>
                      {item.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.files.map((file) => <span key={file} className="max-w-[240px] truncate rounded-md border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1 font-mono text-[9px] text-amber-200/80">{file}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
            {!activity.length && <div className="rounded-xl border border-dashed border-white/[0.06] py-10 text-center text-[12px] font-medium text-slate-600">No activity recorded.</div>}
          </div>
        )}

        {tab === 'gateway' && (
          <RuntimeGatewayPanel status={runtimeStatus} error={runtimeError} agentById={agentById} onRefresh={refreshRuntimeStatus} />
        )}
      </div>
    </section>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { apiErrorMessage, apiRequest, type ApiErrorEnvelope, type ApiRequestOptions } from '../api/client'

const RUNTIME_STATUS_MIN_TIMEOUT_MS = 25_000
const RUNTIME_STATUS_MAX_TIMEOUT_MS = 45_000
const RUNTIME_STATUS_CLIENT_CACHE_MS = 1_000
const RUNTIME_ACTION_TIMEOUT_MS = 30_000
const RUNTIME_DOCTOR_TIMEOUT_MS = 60_000
const RUNTIME_CRON_SHIFT_HYDRATION_CACHE_MS = 5_000
const CLIENT_CHANNEL_ACTIVITY_HISTORY_LIMIT = 100

export type GatewayLogEntry = {
  id: number
  timestamp: string
  stream: 'stdout' | 'stderr' | 'lifecycle' | 'gateway' | 'channel'
  message: string
  level?: string
  source?: string
  channel?: string
  direction?: GatewayChannelDirection
}

export type GatewayChannelDirection = 'inbound' | 'outbound' | 'system'

export type GatewayStartupTimelineEvent = {
  id: number
  timestamp: string
  phase: string
  status: 'started' | 'completed' | 'warning' | 'failed'
  message: string
  elapsedMs: number
  durationMs?: number
  pid?: number | null
}

export type GatewayStartupSummary = {
  graceRemainingMs: number
  startedAt: string | null
  lastPhase: string | null
  lastStatus: string | null
  timeline: GatewayStartupTimelineEvent[]
}

export type GatewayReadinessEventLoop = {
  degraded: boolean
  reasons: string[]
  intervalMs?: number
  delayP99Ms?: number
  delayMaxMs?: number
  utilization?: number
  cpuCoreRatio?: number
}

export type GatewayReadinessSummary = {
  reachable: boolean
  ready: boolean
  degraded: boolean
  checkedAt: string | null
  httpStatus?: number
  status?: string
  failing: string[]
  uptimeMs: number | null
  eventLoop: GatewayReadinessEventLoop | null
  error?: string
}

export type GatewayChannelActivity = {
  id: number
  timestamp: string
  channel: string
  direction: GatewayChannelDirection
  message: string
  level?: string
  source?: string
  agentId?: string
}

export type GatewayRestartLifecycleEntry = {
  at: string
  reason: string
  outcome: 'scheduled' | 'started' | 'succeeded' | 'failed' | 'skipped'
  eventAt?: string | null
}

export type GatewayRestartDiagnostics = {
  severity: 'info' | 'warning'
  needsAttention: boolean
  summary: string
  recentAttempts: number
  recentFailures: number
  failureStreak: number
  latestOutcome: GatewayRestartLifecycleEntry['outcome'] | null
  latestReason: string | null
  latestAt: string | null
  activeWork: number
  queuedWork: number
  repairAction?: string
}

export type GatewayActivitySummary = {
  active: boolean
  lastEventAt: string | null
  sourcePath: string | null
  inboundCount: number
  outboundCount: number
  systemCount: number
  events: GatewayChannelActivity[]
}

export type GatewayStabilityEvent = {
  seq?: number
  ts?: string
  type: string
  level?: string
  source?: string
  reason?: string
  outcome?: string
  action?: string
  phase?: string
  toolName?: string
  activeWorkKind?: string
  active?: number
  waiting?: number
  queued?: number
  queueDepth?: number
  queueSize?: number
  waitMs?: number
  ageMs?: number
  durationMs?: number
  eventLoopDelayP99Ms?: number
  eventLoopDelayMaxMs?: number
  eventLoopUtilization?: number
  cpuCoreRatio?: number
}

export type GatewayStabilitySummary = {
  byType: Record<string, number>
  active: number | null
  waiting: number | null
  queued: number | null
  maxQueueDepth: number | null
  warningCount: number
  latestEventType: string | null
  latestEventAt: string | null
  recentWarnings: string[]
}

export type GatewayStabilityStatus = {
  available: boolean
  source: 'diagnostics.stability' | 'gateway-client-not-ready'
  generatedAt: string | null
  count: number
  dropped: number
  lastSeq: number | null
  summary: GatewayStabilitySummary
  events: GatewayStabilityEvent[]
  error?: string
}

export type GatewayChatRuntimeSummary = {
  activeRuns: number
  activeObservers: number
  oldestRunAgeMs: number
  oldestObserverAgeMs: number
  recentRecoveries?: Array<{
    id: string
    timestamp: string
    reason: string
    minAgeMs: number
    abortedCount: number
    skippedCount: number
    aborted: Array<{
      runId: string
      ageMs: number
      hadStreamObserver: boolean
    }>
  }>
}

export type GatewayChatAbortStaleResult = {
  ok: true
  minAgeMs: number
  aborted: Array<{
    runId: string
    ageMs: number
    hadStreamObserver: boolean
  }>
  skipped: number
  chat: GatewayChatRuntimeSummary
}

export type RuntimeRunAbortResult = {
  ok: true
  found: boolean
  runId: string
  stopped: boolean
  method?: string
  detail?: string
}

export type RuntimeRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted'

export type RuntimeRun = {
  id: string
  command: string
  agentId?: string
  sessionId?: string
  cwd: string
  timeoutMs: number
  startedAt: string
  endedAt?: string
  elapsedMs?: number
  status: RuntimeRunStatus
  pid?: number
  exitCode?: number
  stdoutPreview?: string
  stderrPreview?: string
  failureKind?: string
}

export type OpenAgentSession = {
  agentId: string
  sessionId: string
  sessionKey?: string | null
  active: boolean
  activeRunId: string | null
  provider: string | null
  modelId: string | null
  conversationMessages: number
  updatedAt: string | null
  gatewayActive?: boolean
  gatewayLastEventAt?: string | null
  gatewayEventCount?: number
  gatewayInboundCount?: number
  gatewayOutboundCount?: number
  sessionFile: string
  sessionFileExists: boolean
  lastTouchedAt: string | null
  sessionLock?: {
    lockPath: string
    pid: number | null
    ownerAlive: boolean | null
    ageMs: number | null
    mtimeAgeMs: number
    staleReasons: string[]
    stale: boolean
    removable: boolean
  }
}

export type RuntimeCronJob = {
  id: string
  name: string
  agent: string
  every: string
  durationMinutes: number
  message: string
  model?: string
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  timeoutSeconds?: number
  wake?: 'now' | 'next-heartbeat'
  session?: 'main' | 'isolated'
  announce?: boolean
  cronId: string
  startedAt: string
  endsAt?: string | null
  nextRunAt?: string | null
  source?: 'control-center' | 'openclaw'
  status?: string
  scheduleKind?: string
  scheduleLabel?: string
  payloadKind?: string
  lastError?: string | null
}

export type RuntimePluginSummary = {
  id: string
  name: string
  description?: string
  origin?: string
  category: string
  status: string
  enabled?: boolean
  configuredEnabled?: boolean | null
  runtimeLoaded?: boolean
  managed?: boolean
  channels?: string[]
  providers?: string[]
  commands?: string[]
  missingDependencies?: string[]
  restartRequired?: boolean
}

export type RuntimePluginCacheSummary = {
  source: string
  refreshedAt: number
  refreshing: boolean
}

export type RuntimePersistenceSummary = {
  sqlitePath: string
  sqliteAvailable: boolean
  fallback: string | null
  legacyImportWarning?: string | null
}

export type RuntimeStatus = {
  ok: boolean
  generatedAt: string
  monitor?: {
    cached?: boolean
    summary?: boolean
    cacheAgeMs?: number
    cacheTtlMs?: number
    buildMs?: number
    forceRefresh?: boolean
    timings?: Record<string, number>
    sources?: Record<string, number | string>
  }
  runtime?: {
    ok: boolean
    current: string | null
    expected: string
    embedded: boolean
    bin: string
    node: string
    severity: 'info' | 'warning' | 'error'
    message: string
  }
  persistence?: RuntimePersistenceSummary
  optimization?: {
    contextPruning: {
      enabled: boolean
      mode: string
      ttl: string
      keepLastAssistants: number | null
      hardClear: boolean
      minPrunableToolChars: number | null
      toolsDeny: string[]
    }
    session: {
      dmScope: string
      maintenanceMode: string
      pruneAfter: string | number | null
      maxEntries: number | null
    }
    memory: {
      backend: string
      citations: string
      qmdEnabled: boolean
      qmdSearchMode: string
      qmdSessionsEnabled: boolean
      qmdStartup: string
      qmdTimeoutMs: number | null
    }
    compaction?: {
      enabled: boolean
      reserveTokensFloor: number | null
      keepRecentTokens: number | null
      midTurnPrecheck: boolean
      truncateAfterCompaction: boolean
      notifyUser: boolean
    }
  }
  gateway: {
    state: string
    healthy: boolean
    processRunning: boolean
    ownedByControlCenter?: boolean
    pid: number | null
    port: number
    restartCount: number
    restartScheduled: boolean
    ensureInFlight: boolean
    startupGraceRemainingMs?: number
    startup?: GatewayStartupSummary
    readiness?: GatewayReadinessSummary
    autoRestartPaused?: boolean
    lastStartedAt: string | null
    lastHealthyAt: string | null
    lastExitAt: string | null
    lastExitCode: number | null
    lastRestartAt?: string | null
    lastRestartReason?: string | null
    lastRestartOutcome?: 'scheduled' | 'started' | 'succeeded' | 'failed' | 'skipped' | null
    recentRestarts?: GatewayRestartLifecycleEntry[]
    restartDiagnostics?: GatewayRestartDiagnostics
    migration?: {
      active: boolean
      startedAt: string | null
      lastSeenAt: string | null
      retryAfterAt: string | null
      message: string
    }
    uptimeMs: number
    logs: GatewayLogEntry[]
    activity: GatewayActivitySummary
    stability?: GatewayStabilityStatus
    chat?: GatewayChatRuntimeSummary
  }
  sessions: OpenAgentSession[]
  activeRuns: RuntimeRun[]
  recentRuns: RuntimeRun[]
  plugins: {
    enabledCount: number
    totalCount: number
    all?: RuntimePluginSummary[]
    enabled: RuntimePluginSummary[]
    communication: RuntimePluginSummary[]
    cache?: RuntimePluginCacheSummary
    cliError?: string
  }
  shifts: {
    activeCount: number
    active: RuntimeCronJob[]
    error?: string
  }
  missions: {
    activeCount: number
    active: unknown[]
  }
  diagnostics?: {
    doctor?: {
      lastRun: DoctorRun | null
      recent: DoctorRun[]
      warningCount: number
      errorCount: number
      lastRunAt: string | null
      cache?: {
        source: string
        refreshedAt: number
        refreshing: boolean
      }
    }
  }
}

export type DoctorFindingCategory =
  | 'gateway'
  | 'plugin'
  | 'auth'
  | 'secret'
  | 'session'
  | 'cron'
  | 'skills'
  | 'config'
  | 'sandbox'
  | 'memory'
  | 'provider'
  | 'channel'
  | 'runtime'
  | 'unknown'

export type DoctorGuidedActionKind =
  | 'doctor_repair'
  | 'plugin_inspect'
  | 'provider_auth'
  | 'secret_audit'
  | 'session_cleanup_preview'
  | 'cron_diagnostics'
  | 'gateway_status'
  | 'skills_check'
  | 'config_lint'
  | 'sandbox_lint'
  | 'memory_status'
  | 'model_status'
  | 'channel_status'
  | 'operator_review'

export type DoctorGuidedAction = {
  kind: DoctorGuidedActionKind
  label: string
  detail: string
  command?: string[]
  surface?: 'monitor' | 'plugins' | 'provider-auth' | 'missions' | 'skills' | 'terminal'
  allowsDoctorRepair?: boolean
}

export type DoctorFinding = {
  checkId: string
  category: DoctorFindingCategory
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string
  ocPath?: string
  fixHint?: string
  repairAction?: string
  guidedAction?: DoctorGuidedAction
}

export type DoctorCheck = {
  id: string
  label: string
  ok: boolean
  severity: 'info' | 'warning' | 'error'
  failureKind?: string
  evidence: string
  elapsedMs?: number
  repairAction?: string
  findings?: DoctorFinding[]
}

export type DoctorRun = {
  id: string
  startedAt: string
  endedAt: string
  ok: boolean
  checks: DoctorCheck[]
  summary: string
}

export type DoctorRepairRun = {
  id: string
  startedAt: string
  endedAt: string
  ok: boolean
  command: {
    args: string[]
    code: number
    elapsedMs: number
    detail: string
    failureKind?: string
    timedOut?: boolean
  }
  doctor: DoctorRun
}

export type RuntimeMonitorClearResult = {
  ok: true
  clearedAt: string
  cleared: {
    gatewayLogs: number
    gatewayLogTailSnapshots: number
    recentRuns: number
  }
  activeRuns: number
  sessionLockCleanup?: {
    scanned: number
    removed: number
    errors: number
  }
}

export type RuntimeSessionCloseResult = {
  ok: true
  closedSessions: number
  clearedHistories: number
  closed: Array<{ agentId: string; sessionId: string; scope: string }>
  terminatedRuns: Array<{ id: string; pid: number | null; agentId?: string; sessionId?: string }>
  gatewayAborts?: Array<{
    sessionKey: string
    runId?: string
    agentId?: string
    sessionId?: string
    ok: boolean
    method: 'sessions.abort' | 'chat.abort' | 'gateway-client'
    detail?: string
  }>
  sessionLockCleanup?: {
    scanned: number
    removed: number
    errors: number
  }
  sessions?: OpenAgentSession[]
}

async function runtimeActionRequest<T>(path: string, options: ApiRequestOptions = {}, timeoutMs = RUNTIME_ACTION_TIMEOUT_MS): Promise<T> {
  const result = await apiRequest<T>(path, {
    ...options,
    timeoutMs: options.timeoutMs ?? timeoutMs,
  })
  if (!result.ok) throw runtimeApiRequestError(result.error)
  return result.data
}

export async function closeRuntimeSession(payload: { agentId?: string; sessionId?: string; sessionKey?: string | null; all?: boolean }) {
  const data = await runtimeActionRequest<RuntimeSessionCloseResult>('/api/openclaw/runtime/session/close', {
    method: 'POST',
    body: payload,
  })
  if (data.ok !== true) throw new Error('Close session failed.')
  return data
}

export async function abortStaleGatewayChatTurns(minAgeMs = 5 * 60_000) {
  const data = await runtimeActionRequest<GatewayChatAbortStaleResult>('/api/openclaw/runtime/chat/abort-stale', {
    method: 'POST',
    body: { minAgeMs },
  })
  if (data.ok !== true) throw new Error('Abort stale turns failed.')
  return data
}

export async function abortRuntimeRun(runId: string) {
  const data = await runtimeActionRequest<RuntimeRunAbortResult>('/api/openclaw/runtime/run/abort', {
    method: 'POST',
    body: { runId },
  })
  if (data.ok !== true) throw new Error('Stop runtime run failed.')
  return data
}

export async function stopCronShift(shiftId: string) {
  const result = await apiRequest<{ shiftId: string; cronId: string }>('/api/shifts/stop', {
    method: 'POST',
    body: { shiftId },
    timeoutMs: RUNTIME_ACTION_TIMEOUT_MS,
  })
  if (!result.ok) throw new Error(apiErrorMessage(result.error))
  invalidateCronShiftHydrationCache()
  return result.data
}

export async function updateCronShift(payload: {
  shiftId: string
  name?: string
  scheduleKind?: 'every' | 'cron' | 'at'
  schedule?: string
  message?: string
  messageMode?: 'message' | 'system-event'
}) {
  const result = await apiRequest<{ shiftId: string; cronId: string; shift: RuntimeCronJob | null }>('/api/shifts/update', {
    method: 'POST',
    body: payload,
    timeoutMs: 60_000,
  })
  if (!result.ok) throw new Error(apiErrorMessage(result.error))
  invalidateCronShiftHydrationCache()
  return result.data
}

export async function listCronShifts(options: ApiRequestOptions = {}): Promise<RuntimeCronJob[]> {
  const result = await apiRequest<{ shifts?: RuntimeCronJob[] }>('/api/shifts', {
    ...options,
    cache: options.cache ?? 'no-store',
    timeoutMs: options.timeoutMs ?? 20_000,
  })
  if (!result.ok) throw new Error(apiErrorMessage(result.error))
  if (!Array.isArray(result.data.shifts)) throw new Error('Cron list response missing shifts.')
  return result.data.shifts
}

let cachedCronShiftHydration: { loadedAt: number; shifts: RuntimeCronJob[] } | null = null
let cronShiftHydrationRequest: Promise<RuntimeCronJob[]> | null = null

function invalidateCronShiftHydrationCache() {
  cachedCronShiftHydration = null
}

async function listCronShiftsForHydration(): Promise<RuntimeCronJob[]> {
  const now = Date.now()
  if (cachedCronShiftHydration && now - cachedCronShiftHydration.loadedAt <= RUNTIME_CRON_SHIFT_HYDRATION_CACHE_MS) {
    return cachedCronShiftHydration.shifts
  }
  if (cronShiftHydrationRequest) return cronShiftHydrationRequest

  cronShiftHydrationRequest = listCronShifts({ timeoutMs: 20_000 })
    .then((shifts) => {
      // Do not cache an empty read. A cron add can return before OpenClaw's
      // SQLite writer has committed, and caching that empty response would
      // hide a valid job for the entire hydration window.
      cachedCronShiftHydration = shifts.length > 0
        ? { loadedAt: Date.now(), shifts }
        : null
      return shifts
    })
    .finally(() => {
      cronShiftHydrationRequest = null
    })

  return cronShiftHydrationRequest
}

export async function stopGatewayRuntime() {
  const data = await runtimeActionRequest<{ ok?: boolean; stop?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/stop', {
    method: 'POST',
  })
  if (data.ok !== true) throw new Error('Stop gateway failed.')
  return data
}

export async function startGatewayRuntime() {
  const data = await runtimeActionRequest<{ ok?: boolean; start?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/start', {
    method: 'POST',
  })
  if (data.ok !== true) throw new Error('Start gateway failed.')
  return data
}

export async function restartGatewayRuntime() {
  const data = await runtimeActionRequest<{ ok?: boolean; restart?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/restart', {
    method: 'POST',
  })
  if (data.ok !== true) throw new Error('Restart gateway failed.')
  return data
}

export async function setRuntimePluginEnabled(pluginId: string, enabled: boolean) {
  return runtimeActionRequest<{ restart?: { detail?: string; scheduled?: boolean; restarted?: boolean } }>(`/api/plugins/${encodeURIComponent(pluginId)}`, {
    method: 'POST',
    body: { enabled, restart: false },
  }, 45_000)
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error)
}

function isRuntimeStatusPayload(value: unknown): value is RuntimeStatus {
  return Boolean(value && typeof value === 'object' && 'gateway' in value)
}

async function hydrateRuntimeStatusCronJobs(status: RuntimeStatus): Promise<RuntimeStatus> {
  try {
    const shifts = await listCronShiftsForHydration()
    const serverShifts = status.shifts?.active || []
    const serverActiveCount = status.shifts?.activeCount ?? serverShifts.length

    // An empty hydration result is not authoritative while the status
    // payload already has active jobs. Preserve the last known-good snapshot
    // instead of replacing it with the transient empty read.
    if (!shifts.length && (serverShifts.length > 0 || serverActiveCount > 0)) return status

    return {
      ...status,
      shifts: {
        ...status.shifts,
        activeCount: shifts.length,
        active: shifts,
      },
    }
  } catch {
    return status
  }
}

function runtimeApiRequestError(error: ApiErrorEnvelope) {
  const message = apiErrorMessage(error)
  if (error.code === 'timeout') return new DOMException(message, 'TimeoutError')
  if (error.code === 'aborted') return new DOMException(message, 'AbortError')
  return new Error(message)
}

type RuntimeStatusSnapshot = {
  status: RuntimeStatus | null
  error: string
}

let cachedRuntimeStatus: RuntimeStatus | null = null
let cachedRuntimeError = ''
let cachedRuntimeStatusKey = ''
let runtimeStatusRequest: AbortController | null = null
let runtimeStatusRequestAbortReason: 'idle' | 'paused' | null = null
let runtimeStatusRefreshPending = false
let runtimePollTimer: number | null = null
let runtimeSubscriberId = 0
const runtimeStatusSubscribers = new Set<() => void>()
const runtimeSubscriberIntervals = new Map<number, number>()
let cachedRuntimeSummaryStatus: RuntimeStatus | null = null
let cachedRuntimeSummaryError = ''
let cachedRuntimeSummaryStatusKey = ''
let runtimeSummaryRequest: AbortController | null = null
let runtimeSummaryRequestAbortReason: 'idle' | 'paused' | null = null
let runtimeSummaryRefreshPending = false
let runtimeSummaryPollTimer: number | null = null
let runtimeSummarySubscriberId = 0
const runtimeSummarySubscribers = new Set<() => void>()
const runtimeSummarySubscriberIntervals = new Map<number, number>()
let runtimeLifecycleListenersInstalled = false
let runtimeResumeRefreshTimer: number | null = null
let runtimeChannelActivityHistory: GatewayChannelActivity[] = []

function runtimeSnapshot(): RuntimeStatusSnapshot {
  return { status: cachedRuntimeStatus, error: cachedRuntimeError }
}

function runtimeSummarySnapshot(): RuntimeStatusSnapshot {
  return { status: cachedRuntimeSummaryStatus, error: cachedRuntimeSummaryError }
}

function notifyRuntimeSubscribers() {
  runtimeStatusSubscribers.forEach((listener) => listener())
}

function notifyRuntimeSummarySubscribers() {
  runtimeSummarySubscribers.forEach((listener) => listener())
}

function channelActivityEntryKey(event: GatewayChannelActivity) {
  return `${event.id}|${event.timestamp}|${event.channel}|${event.direction}|${event.message}|${event.level || ''}|${event.source || ''}|${event.agentId || ''}`
}

function mergeRuntimeChannelActivity(status: RuntimeStatus): RuntimeStatus {
  const incoming = status.gateway.activity?.events || []
  const previousByKey = new Map(runtimeChannelActivityHistory.map((event) => [channelActivityEntryKey(event), event]))
  const merged: GatewayChannelActivity[] = []
  const seen = new Set<string>()

  for (const event of [...incoming, ...runtimeChannelActivityHistory]) {
    const key = channelActivityEntryKey(event)
    if (seen.has(key)) continue
    seen.add(key)
    // The API creates new event objects on every poll. Reuse the previous
    // object for unchanged events so memoized activity rows can bail out.
    merged.push(previousByKey.get(key) || event)
  }

  merged.sort((a, b) => {
    const aTime = Date.parse(a.timestamp)
    const bTime = Date.parse(b.timestamp)
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
  })
  runtimeChannelActivityHistory = merged.slice(0, CLIENT_CHANNEL_ACTIVITY_HISTORY_LIMIT)

  const activity = status.gateway.activity
  const events = runtimeChannelActivityHistory
  return {
    ...status,
    gateway: {
      ...status.gateway,
      activity: {
        ...activity,
        lastEventAt: events[0]?.timestamp || activity.lastEventAt || null,
        sourcePath: events[0]?.source || activity.sourcePath || null,
        inboundCount: events.filter((event) => event.direction === 'inbound').length,
        outboundCount: events.filter((event) => event.direction === 'outbound').length,
        systemCount: events.filter((event) => event.direction === 'system').length,
        events,
      },
    },
  }
}

function runtimeLogEntryKey(entry: GatewayLogEntry) {
  return [entry.id, entry.timestamp, entry.stream, entry.message, entry.level || '', entry.source || '', entry.channel || '', entry.direction || ''].join('|')
}

function runtimeCronJobKey(job: RuntimeCronJob) {
  return [
    job.id,
    job.cronId,
    job.name,
    job.agent,
    job.every,
    job.durationMinutes,
    job.message,
    job.model || '',
    job.thinking || '',
    job.timeoutSeconds || '',
    job.wake || '',
    job.session || '',
    job.announce || '',
    job.startedAt,
    job.endsAt || '',
    job.nextRunAt || '',
    job.source || '',
    job.status || '',
    job.scheduleKind || '',
    job.scheduleLabel || '',
    job.payloadKind || '',
    job.lastError || '',
  ].join('|')
}

function runtimeDoctorRunKey(run: DoctorRun | null) {
  if (!run) return ''
  return [
    run.id,
    run.startedAt,
    run.endedAt,
    run.ok,
    run.summary,
    run.checks.map((check) => [
      check.id,
      check.label,
      check.ok,
      check.severity,
      check.failureKind || '',
      check.evidence,
      check.repairAction || '',
      (check.findings || []).map((finding) => [finding.checkId, finding.severity, finding.message, finding.path || '', finding.ocPath || ''].join('~')).join('^'),
    ].join('~')).join('^'),
  ].join('|')
}

function runtimeStatusSemanticKey(status: RuntimeStatus | null) {
  if (!status) return 'empty'

  const gateway = status.gateway
  const activity = gateway.activity
  const readiness = gateway.readiness
  const stability = gateway.stability
  const stabilitySummary = stability?.summary
  const doctor = status.diagnostics?.doctor
  const activityKey = (activity?.events || []).map((event) => channelActivityEntryKey(event)).join('^')
  const sessionsKey = (status.sessions || []).map((session) => [
    session.agentId,
    session.sessionId,
    session.active,
    session.activeRunId || '',
    session.gatewayActive || false,
    session.gatewayLastEventAt || '',
    session.gatewayEventCount || '',
  ].join('|')).join('^')
  const activeRunsKey = (status.activeRuns || []).map((run) => [
    run.id,
    run.agentId || '',
    run.status,
    run.startedAt,
    run.endedAt || '',
    run.elapsedMs || '',
    run.exitCode || '',
    run.failureKind || '',
  ].join('|')).join('^')
  const stabilityKey = stability ? [
    stability.available,
    stability.source,
    stability.count,
    stability.dropped,
    stabilitySummary?.active ?? '',
    stabilitySummary?.waiting ?? '',
    stabilitySummary?.queued ?? '',
    stabilitySummary?.maxQueueDepth ?? '',
    stabilitySummary?.warningCount ?? '',
    stabilitySummary?.latestEventType || '',
    stabilitySummary?.latestEventAt || '',
    (stabilitySummary?.recentWarnings || []).join('^'),
    stability.error || '',
  ].join('|') : ''
  const restartDiagnostics = gateway.restartDiagnostics
  const doctorKey = doctor ? [
    doctor.warningCount,
    doctor.errorCount,
    doctor.lastRunAt || '',
    runtimeDoctorRunKey(doctor.lastRun),
  ].join('|') : ''

  return [
    gateway.state,
    gateway.healthy,
    gateway.processRunning,
    gateway.restartScheduled,
    gateway.ensureInFlight,
    gateway.lastExitCode ?? '',
    gateway.lastRestartOutcome || '',
    gateway.migration?.active || false,
    gateway.migration?.message || '',
    readiness ? [readiness.reachable, readiness.ready, readiness.degraded, readiness.status || '', readiness.error || '', readiness.failing.join('^')].join('|') : '',
    restartDiagnostics ? [restartDiagnostics.severity, restartDiagnostics.needsAttention, restartDiagnostics.summary, restartDiagnostics.recentFailures, restartDiagnostics.failureStreak, restartDiagnostics.latestOutcome || '', restartDiagnostics.latestReason || '', restartDiagnostics.latestAt || '', restartDiagnostics.activeWork, restartDiagnostics.queuedWork].join('|') : '',
    activity?.active || false,
    activity?.lastEventAt || '',
    activity?.sourcePath || '',
    activity?.inboundCount || 0,
    activity?.outboundCount || 0,
    activity?.systemCount || 0,
    activityKey,
    (gateway.logs || []).map(runtimeLogEntryKey).join('^'),
    (status.shifts?.active || []).map(runtimeCronJobKey).join('^'),
    status.shifts?.activeCount ?? '',
    status.shifts?.error || '',
    activeRunsKey,
    sessionsKey,
    gateway.chat ? [gateway.chat.activeRuns, gateway.chat.activeObservers].join('|') : '',
    stabilityKey,
    doctorKey,
  ].join('\u001e')
}

function publishRuntimeStatusSnapshot(status: RuntimeStatus) {
  const stableStatus = mergeRuntimeChannelActivity(status)
  const nextKey = runtimeStatusSemanticKey(stableStatus)
  if (!cachedRuntimeStatus || cachedRuntimeStatusKey !== nextKey) {
    cachedRuntimeStatus = stableStatus
    cachedRuntimeStatusKey = nextKey
  }
  cachedRuntimeError = ''
  if (!cachedRuntimeSummaryStatus || cachedRuntimeSummaryStatusKey !== nextKey) {
    cachedRuntimeSummaryStatus = cachedRuntimeStatus || stableStatus
    cachedRuntimeSummaryStatusKey = nextKey
  }
  cachedRuntimeSummaryError = ''
  notifyRuntimeSummarySubscribers()
}

function emptyGatewayActivity(): GatewayActivitySummary {
  return {
    active: false,
    lastEventAt: null,
    sourcePath: null,
    inboundCount: 0,
    outboundCount: 0,
    systemCount: 0,
    events: [],
  }
}

function isRuntimeMonitorClearResult(value: unknown): value is RuntimeMonitorClearResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<RuntimeMonitorClearResult>
  const cleanup = result.sessionLockCleanup
  const cleanupValid = !cleanup
    || (
      typeof cleanup.scanned === 'number'
      && typeof cleanup.removed === 'number'
      && typeof cleanup.errors === 'number'
    )
  return result.ok === true
    && typeof result.clearedAt === 'string'
    && typeof result.activeRuns === 'number'
    && Boolean(result.cleared)
    && typeof result.cleared?.gatewayLogs === 'number'
    && typeof result.cleared?.gatewayLogTailSnapshots === 'number'
    && typeof result.cleared?.recentRuns === 'number'
    && cleanupValid
}

export async function clearRuntimeMonitor(): Promise<RuntimeMonitorClearResult> {
  const data = await runtimeActionRequest<unknown>('/api/openclaw/runtime/monitor/clear', {
    method: 'POST',
  })
  if (!isRuntimeMonitorClearResult(data)) throw new Error('Clear runtime monitor returned an invalid response.')

  runtimeChannelActivityHistory = []
  if (cachedRuntimeStatus) {
    cachedRuntimeStatus = {
      ...cachedRuntimeStatus,
      generatedAt: data.clearedAt,
      gateway: {
        ...cachedRuntimeStatus.gateway,
        logs: [],
        activity: emptyGatewayActivity(),
      },
      recentRuns: [],
    }
    cachedRuntimeStatusKey = runtimeStatusSemanticKey(cachedRuntimeStatus)
    cachedRuntimeError = ''
    notifyRuntimeSubscribers()
  }
  if (cachedRuntimeSummaryStatus) {
    cachedRuntimeSummaryStatus = {
      ...cachedRuntimeSummaryStatus,
      generatedAt: data.clearedAt,
      gateway: {
        ...cachedRuntimeSummaryStatus.gateway,
        logs: [],
        activity: emptyGatewayActivity(),
      },
      recentRuns: [],
    }
    cachedRuntimeSummaryStatusKey = runtimeStatusSemanticKey(cachedRuntimeSummaryStatus)
    cachedRuntimeSummaryError = ''
    notifyRuntimeSummarySubscribers()
  }

  return data
}

function currentRuntimePollInterval() {
  const intervals = Array.from(runtimeSubscriberIntervals.values())
  return intervals.length ? Math.min(...intervals) : 0
}

function currentRuntimeSummaryPollInterval() {
  const intervals = Array.from(runtimeSummarySubscriberIntervals.values())
  return intervals.length ? Math.min(...intervals) : 0
}

function runtimePollingAllowed() {
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
  // Electron can keep renderer timers alive while its window is occluded. Do
  // not spend CPU polling a live monitor that the operator cannot currently
  // see; focus/visibility listeners will trigger a refresh when it returns.
  const focused = typeof document === 'undefined' || typeof document.hasFocus !== 'function' || document.hasFocus()
  const online = typeof navigator === 'undefined' || navigator.onLine !== false
  return visible && focused && online
}

function runtimeStatusAgeMs(status: RuntimeStatus | null) {
  const generatedAtMs = status?.generatedAt ? Date.parse(status.generatedAt) : NaN
  return Number.isFinite(generatedAtMs) ? Math.max(0, Date.now() - generatedAtMs) : Number.POSITIVE_INFINITY
}

export async function runRuntimeDoctor(): Promise<DoctorRun> {
  const data = await runtimeActionRequest<DoctorRun>('/api/doctor/run', {
    method: 'POST',
  }, RUNTIME_DOCTOR_TIMEOUT_MS)
  if (!data || !('checks' in data)) throw new Error('Doctor returned an invalid response.')
  return data
}

export async function runRuntimeDoctorRepair(): Promise<DoctorRepairRun> {
  const data = await runtimeActionRequest<DoctorRepairRun>('/api/doctor/repair', {
    method: 'POST',
  }, RUNTIME_DOCTOR_TIMEOUT_MS + 90_000)
  if (!data || !('doctor' in data) || !data.doctor || !('checks' in data.doctor)) {
    throw new Error('Doctor repair returned an invalid response.')
  }
  return data
}

function rescheduleRuntimePolling() {
  if (runtimePollTimer) {
    window.clearInterval(runtimePollTimer)
    runtimePollTimer = null
  }

  const intervalMs = currentRuntimePollInterval()
  if (intervalMs <= 0 || !runtimePollingAllowed()) return

  runtimePollTimer = window.setInterval(() => {
    if (!runtimePollingAllowed()) {
      rescheduleRuntimePolling()
      return
    }
    void loadRuntimeStatus(intervalMs)
  }, intervalMs)
}

function rescheduleRuntimeSummaryPolling() {
  if (runtimeSummaryPollTimer) {
    window.clearInterval(runtimeSummaryPollTimer)
    runtimeSummaryPollTimer = null
  }

  const intervalMs = currentRuntimeSummaryPollInterval()
  if (intervalMs <= 0 || !runtimePollingAllowed()) return

  runtimeSummaryPollTimer = window.setInterval(() => {
    if (!runtimePollingAllowed()) {
      rescheduleRuntimeSummaryPolling()
      return
    }
    void loadRuntimeSummaryStatus(intervalMs)
  }, intervalMs)
}

function refreshVisibleRuntimePolling() {
  rescheduleRuntimePolling()
  rescheduleRuntimeSummaryPolling()
  if (!runtimePollingAllowed()) {
    if (runtimeStatusRequest && !runtimeStatusRequest.signal.aborted) {
      runtimeStatusRequestAbortReason = 'paused'
      runtimeStatusRequest.abort()
    }
    if (runtimeSummaryRequest && !runtimeSummaryRequest.signal.aborted) {
      runtimeSummaryRequestAbortReason = 'paused'
      runtimeSummaryRequest.abort()
    }
    if (runtimeResumeRefreshTimer) {
      window.clearTimeout(runtimeResumeRefreshTimer)
      runtimeResumeRefreshTimer = null
    }
    return
  }
  if (runtimeResumeRefreshTimer) return

  runtimeResumeRefreshTimer = window.setTimeout(() => {
    runtimeResumeRefreshTimer = null
    if (!runtimePollingAllowed()) return
    const runtimeIntervalMs = currentRuntimePollInterval()
    const summaryIntervalMs = currentRuntimeSummaryPollInterval()
    if (runtimeIntervalMs > 0) void loadRuntimeStatus(runtimeIntervalMs, true)
    if (summaryIntervalMs > 0) void loadRuntimeSummaryStatus(summaryIntervalMs, true)
  }, 60)
}

function ensureRuntimeLifecycleListeners() {
  if (runtimeLifecycleListenersInstalled || typeof window === 'undefined') return
  runtimeLifecycleListenersInstalled = true
  window.addEventListener('focus', refreshVisibleRuntimePolling)
  window.addEventListener('blur', refreshVisibleRuntimePolling)
  window.addEventListener('online', refreshVisibleRuntimePolling)
  window.addEventListener('offline', refreshVisibleRuntimePolling)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', refreshVisibleRuntimePolling)
  }
}

function abortRuntimeStatusRequestIfIdle() {
  if (runtimeStatusSubscribers.size || runtimeSubscriberIntervals.size || !runtimeStatusRequest) return
  runtimeStatusRequestAbortReason = 'idle'
  runtimeStatusRequest.abort()
}

function abortRuntimeSummaryRequestIfIdle() {
  if (runtimeSummarySubscribers.size || runtimeSummarySubscriberIntervals.size || !runtimeSummaryRequest) return
  runtimeSummaryRequestAbortReason = 'idle'
  runtimeSummaryRequest.abort()
}

async function loadRuntimeStatus(intervalMs: number, forceRefresh = false) {
  if (!forceRefresh && cachedRuntimeStatus) {
    const maxAgeMs = Math.min(RUNTIME_STATUS_CLIENT_CACHE_MS, Math.max(500, intervalMs))
    if (runtimeStatusAgeMs(cachedRuntimeStatus) <= maxAgeMs) {
      cachedRuntimeError = ''
      notifyRuntimeSubscribers()
      return
    }
  }

  if (runtimeStatusRequest) {
    if (forceRefresh) runtimeStatusRefreshPending = true
    return
  }

  const controller = new AbortController()
  runtimeStatusRequest = controller
  runtimeStatusRequestAbortReason = null
  const requestTimeoutMs = Math.max(
    RUNTIME_STATUS_MIN_TIMEOUT_MS,
    Math.min(RUNTIME_STATUS_MAX_TIMEOUT_MS, intervalMs + 7_500),
  )

  try {
    const result = await apiRequest<RuntimeStatus>(`/api/openclaw/runtime/status${forceRefresh ? '?refresh=1' : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
      timeoutMs: requestTimeoutMs,
    })
    const idleAbort = runtimeStatusRequestAbortReason === 'idle' && controller.signal.aborted
    const pausedAbort = runtimeStatusRequestAbortReason === 'paused' && controller.signal.aborted
    if (!result.ok) {
      if (idleAbort || pausedAbort) return
      throw runtimeApiRequestError(result.error)
    }
    if (!isRuntimeStatusPayload(result.data)) {
      throw new Error('Runtime status response missing gateway data.')
    }
    publishRuntimeStatusSnapshot(await hydrateRuntimeStatusCronJobs(result.data))
  } catch (loadError) {
    const idleAbort = runtimeStatusRequestAbortReason === 'idle' && controller.signal.aborted
    const pausedAbort = runtimeStatusRequestAbortReason === 'paused' && controller.signal.aborted
    if (!idleAbort && !pausedAbort) {
      cachedRuntimeError = loadError instanceof DOMException && (loadError.name === 'AbortError' || loadError.name === 'TimeoutError')
        ? cachedRuntimeStatus
          ? 'Runtime status timed out; showing the last snapshot.'
          : 'Runtime status timed out.'
        : errorMessage(loadError)
    }
  } finally {
    if (runtimeStatusRequest === controller) {
      runtimeStatusRequest = null
      runtimeStatusRequestAbortReason = null
    }
    notifyRuntimeSubscribers()
    if (runtimeStatusRefreshPending) {
      runtimeStatusRefreshPending = false
      void loadRuntimeStatus(intervalMs, true)
    }
  }
}

async function loadRuntimeSummaryStatus(intervalMs: number, forceRefresh = false) {
  if (!forceRefresh && cachedRuntimeSummaryStatus) {
    const maxAgeMs = Math.min(RUNTIME_STATUS_CLIENT_CACHE_MS, Math.max(500, intervalMs))
    if (runtimeStatusAgeMs(cachedRuntimeSummaryStatus) <= maxAgeMs) {
      cachedRuntimeSummaryError = ''
      notifyRuntimeSummarySubscribers()
      return
    }
  }

  if (runtimeSummaryRequest) {
    if (forceRefresh) runtimeSummaryRefreshPending = true
    return
  }

  const controller = new AbortController()
  runtimeSummaryRequest = controller
  runtimeSummaryRequestAbortReason = null
  const requestTimeoutMs = Math.max(
    RUNTIME_STATUS_MIN_TIMEOUT_MS,
    Math.min(RUNTIME_STATUS_MAX_TIMEOUT_MS, intervalMs + 7_500),
  )

  try {
    const result = await apiRequest<RuntimeStatus>(`/api/openclaw/runtime/summary${forceRefresh ? '?refresh=1' : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
      timeoutMs: requestTimeoutMs,
    })
    const idleAbort = runtimeSummaryRequestAbortReason === 'idle' && controller.signal.aborted
    const pausedAbort = runtimeSummaryRequestAbortReason === 'paused' && controller.signal.aborted
    if (!result.ok) {
      if (idleAbort || pausedAbort) return
      throw runtimeApiRequestError(result.error)
    }
    if (!isRuntimeStatusPayload(result.data)) {
      throw new Error('Runtime summary response missing gateway data.')
    }
    const mergedStatus = mergeRuntimeChannelActivity(result.data)
    const nextKey = runtimeStatusSemanticKey(mergedStatus)
    if (!cachedRuntimeSummaryStatus || cachedRuntimeSummaryStatusKey !== nextKey) {
      cachedRuntimeSummaryStatus = mergedStatus
      cachedRuntimeSummaryStatusKey = nextKey
    }
    cachedRuntimeSummaryError = ''
  } catch (loadError) {
    const idleAbort = runtimeSummaryRequestAbortReason === 'idle' && controller.signal.aborted
    const pausedAbort = runtimeSummaryRequestAbortReason === 'paused' && controller.signal.aborted
    if (!idleAbort && !pausedAbort) {
      cachedRuntimeSummaryError = loadError instanceof DOMException && (loadError.name === 'AbortError' || loadError.name === 'TimeoutError')
        ? cachedRuntimeSummaryStatus
          ? 'Runtime summary timed out; showing the last snapshot.'
          : 'Runtime summary timed out.'
        : errorMessage(loadError)
    }
  } finally {
    if (runtimeSummaryRequest === controller) {
      runtimeSummaryRequest = null
      runtimeSummaryRequestAbortReason = null
    }
    notifyRuntimeSummarySubscribers()
    if (runtimeSummaryRefreshPending) {
      runtimeSummaryRefreshPending = false
      void loadRuntimeSummaryStatus(intervalMs, true)
    }
  }
}

export function useRuntimeStatus(intervalMs = 5000) {
  const [snapshot, setSnapshot] = useState<RuntimeStatusSnapshot>(() => runtimeSnapshot())

  useEffect(() => {
    const subscriberId = ++runtimeSubscriberId
    const activeIntervalMs = Math.max(1000, Math.round(intervalMs || 0))
    const listener = () => setSnapshot((previous) => {
      const next = runtimeSnapshot()
      return previous.status === next.status && previous.error === next.error ? previous : next
    })

    ensureRuntimeLifecycleListeners()
    runtimeStatusSubscribers.add(listener)
    if (intervalMs > 0) runtimeSubscriberIntervals.set(subscriberId, activeIntervalMs)
    rescheduleRuntimePolling()
    if (intervalMs > 0 && runtimePollingAllowed()) void loadRuntimeStatus(activeIntervalMs)

    return () => {
      runtimeStatusSubscribers.delete(listener)
      runtimeSubscriberIntervals.delete(subscriberId)
      rescheduleRuntimePolling()
      abortRuntimeStatusRequestIfIdle()
    }
  }, [intervalMs])

  const refresh = useCallback(() => {
    void loadRuntimeStatus(Math.max(1000, Math.round(intervalMs || currentRuntimePollInterval() || 5000)), true)
  }, [intervalMs])

  return { status: snapshot.status, error: snapshot.error, refresh }
}

export function useRuntimeSummaryStatus(intervalMs = 8000) {
  const [snapshot, setSnapshot] = useState<RuntimeStatusSnapshot>(() => runtimeSummarySnapshot())

  useEffect(() => {
    const subscriberId = ++runtimeSummarySubscriberId
    const activeIntervalMs = Math.max(1000, Math.round(intervalMs || 0))
    const listener = () => setSnapshot((previous) => {
      const next = runtimeSummarySnapshot()
      return previous.status === next.status && previous.error === next.error ? previous : next
    })

    ensureRuntimeLifecycleListeners()
    runtimeSummarySubscribers.add(listener)
    if (intervalMs > 0) runtimeSummarySubscriberIntervals.set(subscriberId, activeIntervalMs)
    rescheduleRuntimeSummaryPolling()
    if (intervalMs > 0 && runtimePollingAllowed()) void loadRuntimeSummaryStatus(activeIntervalMs)

    return () => {
      runtimeSummarySubscribers.delete(listener)
      runtimeSummarySubscriberIntervals.delete(subscriberId)
      rescheduleRuntimeSummaryPolling()
      abortRuntimeSummaryRequestIfIdle()
    }
  }, [intervalMs])

  const refresh = useCallback(() => {
    void loadRuntimeSummaryStatus(Math.max(1000, Math.round(intervalMs || currentRuntimeSummaryPollInterval() || 8000)), true)
  }, [intervalMs])

  return { status: snapshot.status, error: snapshot.error, refresh }
}

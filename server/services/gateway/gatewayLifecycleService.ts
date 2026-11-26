import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { BoundedProcessResult } from '../process/boundedProcessService'

export const DEFAULT_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_GATEWAY_RESTART_DRAIN_TIMEOUT_MS = 2 * 60 * 60 * 1000
const GATEWAY_RESTART_GRACEFUL_STOP_TIMEOUT_MS = 15_000
const GATEWAY_RESTART_FORCE_EXIT_TIMEOUT_MS = 15_000
const PLUGIN_MUTATION_DRAIN_TIMEOUT_MS = 315_000
const PLUGIN_MUTATION_FORCE_EXIT_TIMEOUT_MS = 15_000
const PLUGIN_MUTATION_PORT_RELEASE_TIMEOUT_MS = 30_000

export function resolveTelegramSpooledHandlerTimeoutMs(configured = process.env.OPENCLAW_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS) {
  const timeoutMs = Number(configured)
  return Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS
}

export type GatewayRestartOutcome = 'scheduled' | 'started' | 'succeeded' | 'failed' | 'skipped'

export type GatewayRestartLifecycleSnapshot = {
  at: string
  reason: string
  outcome: GatewayRestartOutcome
  eventAt?: string
}

export type GatewayRestartDiagnostics = {
  severity: 'info' | 'warning'
  needsAttention: boolean
  summary: string
  recentAttempts: number
  recentFailures: number
  failureStreak: number
  latestOutcome: GatewayRestartOutcome | null
  latestReason: string | null
  latestAt: string | null
  activeWork: number
  queuedWork: number
  repairAction?: string
}

export type GatewayLogEntry = {
  id: number
  timestamp: string
  stream: 'stdout' | 'stderr' | 'lifecycle' | 'gateway' | 'channel'
  message: string
  level?: string
  source?: string
  channel?: string
  direction?: 'inbound' | 'outbound' | 'system'
}

export type GatewayStartupPhase =
  | 'requested'
  | 'config'
  | 'registry'
  | 'spawned'
  | 'http'
  | 'ready'
  | 'prewarm'
  | 'healthy'
  | 'exit'
  | 'failed'
  | 'warning'

export type GatewayStartupStatus = 'started' | 'completed' | 'warning' | 'failed'

export type GatewayStartupTimelineEvent = {
  id: number
  timestamp: string
  phase: GatewayStartupPhase
  status: GatewayStartupStatus
  message: string
  elapsedMs: number
  durationMs?: number
  pid?: number | null
}

export type GatewayStabilityStatus = {
  summary: {
    active?: number | null
    waiting?: number | null
    queued?: number | null
    maxQueueDepth?: number | null
    recentWarnings: string[]
  }
}

export type GatewayLifecycleSnapshot = {
  lastStartedAt: string | null
  lastHealthyAt: string | null
  lastExitAt: string | null
  lastExitCode: number | null
  lastRestartAt: string | null
  lastRestartReason: string | null
  lastRestartOutcome: GatewayRestartOutcome | null
}

export type GatewaySpawnSpec = {
  command: string
  args: readonly string[]
  shell: boolean
}

export type GatewayStartupMaintenanceMode = 'off' | 'deferred' | 'blocking'

export type SpawnTextResult = BoundedProcessResult

type GatewayHealthResult = {
  healthy: boolean
  payload: unknown
}

type PluginRegistryRefreshResult = {
  code: number | null
}

type GatewayStabilityUnavailableSource = 'diagnostics.stability' | 'gateway-client-not-ready'

export type GatewayStartupPluginRepairSummary = {
  repairedClawTalkManifests?: string[]
  repairedTelegramRuntimes?: string[]
  clawTalkRegistryRefreshed?: boolean
}

export type GatewayMigrationStatus = {
  active: boolean
  startedAt: string | null
  lastSeenAt: string | null
  retryAfterAt: string | null
  message: string
}

export type GatewayLifecycleServiceOptions = {
  gatewayHttpPort: number
  controlCenterPort: number
  controlCenterToken: string
  openClawConfigPath: string
  openClawStateRoot: string
  startupHealthGraceMs: number
  startupHealthConfirmTimeoutMs: number
  startupHealthPollMs: number
  /**
   * Keep filesystem/plugin/config maintenance out of the critical startup
   * path by default. The desktop app uses `off`; tests and explicit recovery
   * callers can retain the historical `blocking` behavior.
   */
  startupMaintenanceMode?: GatewayStartupMaintenanceMode
  isShuttingDown: () => boolean
  isOpenClawRuntimeAvailable: () => boolean
  openClawRuntimeUnavailableMessage: () => string
  openClawSpawnSpec: (args: string[]) => GatewaySpawnSpec
  openClawProcessEnv: (overrides: Record<string, string | undefined>) => NodeJS.ProcessEnv
  openClawRuntimeCwd: () => string
  spawnText: (command: string, args: string[], options?: { timeoutMs?: number; windowsHide?: boolean }) => Promise<SpawnTextResult>
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  terminateProcessTree: (pid: number | undefined, reason?: string, force?: boolean) => Promise<{ ok: boolean; detail: string }>
  checkTcpPort: (host: string, port: number, timeoutMs?: number) => Promise<boolean>
  tryReleaseGatewayPort: () => Promise<{ released: boolean; detail: string }>
  isPidAlive: (pid: number) => boolean
  delayMs: (ms: number) => Promise<void>
  getActiveAgentRunCount?: () => number | null | Promise<number | null>
  gatewayRestartDrainTimeoutMs?: number
  appendBoundedRuntimeOutput: (current: string, chunk: unknown) => string
  compactGatewayLogMessage: (value: string, max?: number) => string
  redactSensitiveText: (value: string) => string
  stripAnsi: (value: string) => string
  sanitizeGatewayStartupMessage: (message: string, max?: number) => string
  formatGatewayProcessOutput: (prefix: string, message: string) => string
  pushGatewayLog: (stream: GatewayLogEntry['stream'], message: string, level?: string) => void
  appendGatewayLifecycleEvent: (entry: Record<string, unknown>) => void | Promise<void>
  getGatewayLogs: () => GatewayLogEntry[]
  isRuntimeMonitorEntryVisible: (timestamp: string | null | undefined) => boolean
  invalidateRuntimeStatusCache: () => void
  gatewayStabilityUnavailable: (source: GatewayStabilityUnavailableSource, error?: string) => GatewayStabilityStatus
  fetchGatewayHealthPayload: () => Promise<GatewayHealthResult>
  repairClawTalkPluginManifestContracts: () => Promise<string[]>
  repairTelegramAgentRoutingRuntime: () => Promise<string[]>
  refreshOpenClawPluginRegistry: (reason: string) => Promise<PluginRegistryRefreshResult>
  ensureGatewayStartupPluginDefaults: (repairSummary?: GatewayStartupPluginRepairSummary) => Promise<void>
  prepareOpenClawConfigForGatewayStartup: (reason: string) => Promise<boolean>
  isInvalidOpenClawConfigText: (value: string) => boolean
  scheduleOpenClawSessionLockSweep: (reason: string) => void
  sweepOpenClawSessionLocks: (reason: string, options: { minIntervalMs?: number; minAgeMs?: number; quiet?: boolean }) => Promise<unknown>
  stopControlCenterGatewayClient: (reason: string) => void
  log?: Pick<typeof console, 'info' | 'log' | 'warn' | 'error'>
}

export function buildGatewayRunArgs(port: number): string[] {
  return ['gateway', 'run', '--port', String(port), '--allow-unconfigured']
}

function gatewayRestartOutcomeLevel(outcome: GatewayRestartOutcome) {
  return outcome === 'failed' ? 'warning' : 'info'
}

export function createGatewayLifecycleService(options: GatewayLifecycleServiceOptions) {
  const log = options.log || console
  const spawnProcess = options.spawnProcess || spawn
  const gatewayStartupTimeline: GatewayStartupTimelineEvent[] = []
  const gatewayStartupPhaseStartedAtMs = new Map<GatewayStartupPhase, number>()
  const startupTimelineLimit = 18
  const restartTimelineLimit = 5

  let gatewayProcess: ChildProcess | null = null
  let gatewayRestartTimer: NodeJS.Timeout | null = null
  let gatewayRestartCount = 0
  let gatewayEnsureInFlight: Promise<void> | null = null
  let gatewayEnsureInFlightGeneration: number | null = null
  let gatewayEnsureGeneration = 0
  let gatewayEnsureStartedAtMs = 0
  let gatewayRestartInFlight: Promise<{ restarted: boolean; detail: string }> | null = null
  let pluginOfflineMutationQueue: Promise<void> = Promise.resolve()
  let pluginOfflineMutationPending = 0
  const gatewayRestartAdmissionPauses = new Set<symbol>()
  let gatewayProcessOwnedByControlCenter = false
  let lastGatewayPortReleaseAt = 0
  let gatewayAutoRestartPaused = false
  let gatewayLastStartedAt: string | null = null
  let gatewayLastHealthyAt: string | null = null
  let gatewayLastExitAt: string | null = null
  let gatewayLastExitCode: number | null = null
  let gatewayLastRestartAt: string | null = null
  let gatewayLastRestartReason: string | null = null
  let gatewayLastRestartOutcome: GatewayRestartOutcome | null = null
  let gatewayStartupGraceUntilMs = 0
  let gatewayListenerPidCache: { checkedAt: number; pid: number | null } | null = null
  let gatewayStartupTimelineSeq = 0
  let gatewayStartupTimelineStartedAtMs = 0
  let gatewayHealthCheckInterval: NodeJS.Timeout | null = null
  let gatewayMigrationStartedAt: string | null = null
  let gatewayMigrationLastSeenAt: string | null = null
  let gatewayMigrationRetryAfterAt: string | null = null

  const gatewayMigrationMessage = 'OpenClaw is applying startup migrations. The Gateway may restart several times while this completes.'

  function pauseGatewayRestartAdmission(reason: string): () => void {
    const token = Symbol(reason)
    gatewayRestartAdmissionPauses.add(token)
    options.pushGatewayLog('lifecycle', `Gateway turn admission paused: ${reason}`)
    return () => {
      if (!gatewayRestartAdmissionPauses.delete(token)) return
      if (gatewayRestartAdmissionPauses.size === 0) {
        options.pushGatewayLog('lifecycle', `Gateway turn admission resumed after: ${reason}`)
      }
    }
  }

  async function waitForGatewayAdmission(signal?: AbortSignal): Promise<void> {
    while (gatewayRestartAdmissionPauses.size > 0) {
      if (signal?.aborted) {
        const error = new Error('Gateway agent turn aborted while waiting for restart admission')
        error.name = 'AbortError'
        throw error
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    if (signal?.aborted) {
      const error = new Error('Gateway agent turn aborted before dispatch')
      error.name = 'AbortError'
      throw error
    }
  }

  function migrationRetryAfterFromText(value: string): string | null {
    const match = value.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\b/)
    return match?.[1] || null
  }

  function isGatewayMigrationInProgressText(value: string): boolean {
    return /startup migrations? are already running|migrations? (?:are )?(?:already )?(?:running|in progress)|retry after .*\d{4}-\d{2}-\d{2}T/i.test(value)
  }

  function markGatewayMigrationInProgress(value: string): void {
    if (!isGatewayMigrationInProgressText(value)) return
    const now = new Date().toISOString()
    if (!gatewayMigrationStartedAt) gatewayMigrationStartedAt = now
    gatewayMigrationLastSeenAt = now
    gatewayMigrationRetryAfterAt = migrationRetryAfterFromText(value) || gatewayMigrationRetryAfterAt
    options.invalidateRuntimeStatusCache()
  }

  function completeGatewayMigration(): void {
    if (!gatewayMigrationStartedAt) return
    gatewayMigrationStartedAt = null
    gatewayMigrationLastSeenAt = null
    gatewayMigrationRetryAfterAt = null
    options.invalidateRuntimeStatusCache()
  }

  function gatewayMigrationStatus(): GatewayMigrationStatus {
    return {
      active: Boolean(gatewayMigrationStartedAt),
      startedAt: gatewayMigrationStartedAt,
      lastSeenAt: gatewayMigrationLastSeenAt,
      retryAfterAt: gatewayMigrationRetryAfterAt,
      message: gatewayMigrationMessage,
    }
  }

  function clearRestartTimer(): void {
    if (!gatewayRestartTimer) return
    clearTimeout(gatewayRestartTimer)
    gatewayRestartTimer = null
  }

  function clearListenerPidCache(): void {
    gatewayListenerPidCache = null
  }

  function pauseAutoRestart(): void {
    gatewayAutoRestartPaused = true
    // Cancel an ensure attempt already awaiting startup work. Clearing only
    // the retry timer can otherwise let that attempt spawn after an operator
    // has stopped the Gateway.
    gatewayEnsureGeneration += 1
    clearRestartTimer()
  }

  function pauseAutoRestartForInvalidConfig(detail: string): void {
    pauseAutoRestart()
    const message = `Gateway auto-restart paused: OpenClaw config is still invalid after repair. ${detail}`
    log.warn(`[gateway] ${message}`)
    options.pushGatewayLog('lifecycle', message)
  }

  function pauseAutoRestartForRuntimeUnavailable(detail: string): void {
    pauseAutoRestart()
    const message = `Gateway auto-restart paused: OpenClaw runtime is unavailable. ${detail}`
    log.warn(`[gateway] ${message}`)
    options.pushGatewayLog('lifecycle', message)
  }

  function resumeAutoRestart(): void {
    if (gatewayAutoRestartPaused) {
      gatewayAutoRestartPaused = false
      gatewayEnsureGeneration += 1
    }
  }

  function resumeAutoRestartAfterConfigRepair(): void {
    resumeAutoRestart()
    gatewayRestartCount = 0
    options.pushGatewayLog('lifecycle', 'OpenClaw config repaired and validated; gateway startup may continue')
  }

  function lifecycleSnapshot(): GatewayLifecycleSnapshot {
    return {
      lastStartedAt: gatewayLastStartedAt,
      lastHealthyAt: gatewayLastHealthyAt,
      lastExitAt: gatewayLastExitAt,
      lastExitCode: gatewayLastExitCode,
      lastRestartAt: gatewayLastRestartAt,
      lastRestartReason: gatewayLastRestartReason,
      lastRestartOutcome: gatewayLastRestartOutcome,
    }
  }

  function markGatewayHealthy(): void {
    gatewayLastHealthyAt = new Date().toISOString()
  }

  function recordGatewayRestartLifecycleLedger(
    at: string,
    reason: string,
    outcome: GatewayRestartOutcome,
  ): void {
    const sanitizedReason = options.sanitizeGatewayStartupMessage(reason || 'unspecified gateway restart', 180)
    void Promise.resolve(options.appendGatewayLifecycleEvent({
      event: 'gateway.restart.lifecycle',
      timestamp: new Date().toISOString(),
      stream: 'lifecycle',
      level: gatewayRestartOutcomeLevel(outcome),
      source: 'control-center',
      direction: 'system',
      lifecycle: 'restart',
      restartRequestedAt: at,
      restartReason: sanitizedReason,
      restartOutcome: outcome,
      message: `Gateway restart ${outcome}: ${sanitizedReason}`,
    })).catch(() => undefined)
  }

  function restartLifecycleSnapshotFromMemory(): GatewayRestartLifecycleSnapshot | null {
    if (!gatewayLastRestartAt || !gatewayLastRestartReason || !gatewayLastRestartOutcome) return null
    return {
      at: gatewayLastRestartAt,
      reason: gatewayLastRestartReason,
      outcome: gatewayLastRestartOutcome,
      eventAt: gatewayLastRestartAt,
    }
  }

  function recordGatewayRestartRequest(
    reason: string,
    outcome: GatewayRestartOutcome,
  ): void {
    gatewayLastRestartAt = new Date().toISOString()
    gatewayLastRestartReason = options.sanitizeGatewayStartupMessage(reason || 'unspecified gateway restart', 180)
    gatewayLastRestartOutcome = outcome
    recordGatewayRestartLifecycleLedger(gatewayLastRestartAt, gatewayLastRestartReason, outcome)
    options.invalidateRuntimeStatusCache()
  }

  function markGatewayRestartOutcome(outcome: GatewayRestartOutcome): void {
    if (!gatewayLastRestartAt) return
    if (gatewayLastRestartOutcome === outcome) return
    gatewayLastRestartOutcome = outcome
    recordGatewayRestartLifecycleLedger(
      gatewayLastRestartAt,
      gatewayLastRestartReason || 'unspecified gateway restart',
      outcome,
    )
    options.invalidateRuntimeStatusCache()
  }

  function resetGatewayStartupTimeline(message: string): void {
    gatewayStartupTimeline.length = 0
    gatewayStartupPhaseStartedAtMs.clear()
    gatewayStartupTimelineStartedAtMs = Date.now()
    recordGatewayStartupEvent('requested', 'started', message)
  }

  function recordGatewayStartupEvent(
    phase: GatewayStartupPhase,
    status: GatewayStartupStatus,
    message: string,
    eventOptions: { pid?: number | null; durationMs?: number } = {},
  ): void {
    const now = Date.now()
    if (!gatewayStartupTimelineStartedAtMs) gatewayStartupTimelineStartedAtMs = now

    let durationMs = eventOptions.durationMs
    if (status === 'started') {
      gatewayStartupPhaseStartedAtMs.set(phase, now)
    } else {
      const startedAt = gatewayStartupPhaseStartedAtMs.get(phase)
      if (durationMs === undefined && startedAt) durationMs = Math.max(0, now - startedAt)
      gatewayStartupPhaseStartedAtMs.delete(phase)
    }

    gatewayStartupTimeline.push({
      id: ++gatewayStartupTimelineSeq,
      timestamp: new Date(now).toISOString(),
      phase,
      status,
      message: options.sanitizeGatewayStartupMessage(message),
      elapsedMs: Math.max(0, now - gatewayStartupTimelineStartedAtMs),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(eventOptions.pid !== undefined ? { pid: eventOptions.pid } : {}),
    })

    if (gatewayStartupTimeline.length > startupTimelineLimit) {
      gatewayStartupTimeline.splice(0, gatewayStartupTimeline.length - startupTimelineLimit)
    }
    options.invalidateRuntimeStatusCache()
  }

  async function gatewayListenerPidForPort(port: number) {
    const now = Date.now()
    if (gatewayListenerPidCache && now - gatewayListenerPidCache.checkedAt < 7_500) return gatewayListenerPidCache.pid
    let pid: number | null = null
    if (process.platform === 'win32') {
      const result = await options.spawnText('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
      ], {
        windowsHide: true,
        timeoutMs: 2500,
      })
      const parsed = Number((result.stdout || '').trim().split(/\s+/)[0])
      if (Number.isFinite(parsed) && parsed > 0) pid = parsed
    } else {
      const result = await options.spawnText('sh', ['-c', `command -v lsof >/dev/null 2>&1 && lsof -tiTCP:${port} -sTCP:LISTEN | head -n 1 || true`], {
        timeoutMs: 2500,
      })
      const parsed = Number((result.stdout || '').trim().split(/\s+/)[0])
      if (Number.isFinite(parsed) && parsed > 0) pid = parsed
    }
    gatewayListenerPidCache = { checkedAt: now, pid }
    return pid
  }

  async function isGatewayHealthy(): Promise<boolean> {
    const health = await options.fetchGatewayHealthPayload()
    if (health.healthy) {
      markGatewayHealthy()
      completeGatewayMigration()
    }
    return health.healthy
  }

  function gatewayStartupGraceRemainingMs(now = Date.now()): number {
    return Math.max(0, gatewayStartupGraceUntilMs - now)
  }

  function markGatewayStartupGrace(): void {
    gatewayStartupGraceUntilMs = Math.max(gatewayStartupGraceUntilMs, Date.now() + options.startupHealthGraceMs)
  }

  async function waitForGatewayStartupHealth(timeoutMs = options.startupHealthConfirmTimeoutMs): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      if (await isGatewayHealthy()) return true
      if (gatewayProcess?.pid && !options.isPidAlive(gatewayProcess.pid)) return false
      await options.delayMs(options.startupHealthPollMs)
    }
    return false
  }

  async function waitForExistingGatewayHealth(listenerPid: number): Promise<boolean> {
    const timeoutMs = Math.min(options.startupHealthConfirmTimeoutMs, 15_000)
    const deadline = Date.now() + timeoutMs
    markGatewayStartupGrace()
    options.pushGatewayLog('lifecycle', `existing gateway listener pid=${listenerPid} detected; waiting for health before recovery`)
    while (Date.now() <= deadline) {
      if (!options.isPidAlive(listenerPid)) break
      if (await isGatewayHealthy()) {
        gatewayStartupGraceUntilMs = 0
        gatewayRestartCount = 0
        if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
          markGatewayRestartOutcome('succeeded')
        }
        options.pushGatewayLog('lifecycle', `attached to existing healthy gateway listener pid=${listenerPid}`)
        return true
      }
      await options.delayMs(options.startupHealthPollMs)
    }
    gatewayStartupGraceUntilMs = 0
    return false
  }

  async function waitForGatewayStartupHealthIfStarting(): Promise<{ waited: boolean; healthy: boolean }> {
    const hasStartupWork = () => Boolean(
      gatewayEnsureInFlight
      || gatewayRestartTimer
      || (gatewayProcess?.pid && options.isPidAlive(gatewayProcess.pid))
      || gatewayStartupGraceRemainingMs() > 0,
    )

    if (!hasStartupWork()) return { waited: false, healthy: false }

    const timeoutMs = Math.max(
      options.startupHealthConfirmTimeoutMs,
      options.startupHealthGraceMs + options.startupHealthConfirmTimeoutMs,
    )
    const startupStartedAt = gatewayEnsureStartedAtMs || gatewayStartupTimelineStartedAtMs || Date.now()
    const deadline = startupStartedAt + timeoutMs
    options.pushGatewayLog('lifecycle', 'waiting for the in-progress Gateway startup to become healthy')

    while (Date.now() <= deadline) {
      if (await isGatewayHealthy()) return { waited: true, healthy: true }
      if (!hasStartupWork()) return { waited: true, healthy: false }

      const remainingMs = Math.max(1, deadline - Date.now())
      const delay = options.delayMs(Math.min(options.startupHealthPollMs, remainingMs))
      const inFlight = gatewayEnsureInFlight
      if (inFlight) {
        await Promise.race([inFlight.catch(() => undefined), delay])
      } else {
        await delay
      }
    }

    return { waited: true, healthy: await isGatewayHealthy() }
  }

  function startGatewayHealthMonitor(): void {
    if (gatewayHealthCheckInterval) return
    gatewayHealthCheckInterval = setInterval(async () => {
      if (options.isShuttingDown()) return
      if (gatewayAutoRestartPaused) return
      if (gatewayEnsureInFlight || gatewayStartupGraceRemainingMs() > 0) return
      const healthy = await isGatewayHealthy()
      if (!healthy && !gatewayProcess) {
        log.log('[gateway] health check failed - attempting restart')
        scheduleGatewayRestart('health monitor detected an unhealthy gateway')
      } else if (healthy && gatewayRestartCount > 0) {
        gatewayRestartCount = 0
      }
    }, 15000)
  }

  function stopGatewayHealthMonitor(): void {
    if (gatewayHealthCheckInterval) {
      clearInterval(gatewayHealthCheckInterval)
      gatewayHealthCheckInterval = null
    }
  }

  function spawnGateway(): Promise<{ pid: number }> {
    return new Promise((resolve, reject) => {
      if (!options.isOpenClawRuntimeAvailable()) {
        reject(new Error(options.openClawRuntimeUnavailableMessage()))
        return
      }
      const spec = options.openClawSpawnSpec(buildGatewayRunArgs(options.gatewayHttpPort))
      const env = options.openClawProcessEnv({
        // Telegram's watchdog only covers claim→handler adoption. Once adopted,
        // long model work is governed by the agent turn timeout. Keep the
        // watchdog at its five-minute recovery window so a pre-adoption stall
        // cannot leave a durable Telegram update claimed for hours.
        OPENCLAW_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS: String(resolveTelegramSpooledHandlerTimeoutMs()),
        // The Gateway is a local untrusted boundary from the billing point
        // of view. Give injected channel runtimes the same bearer credential
        // used by the Control Center so traffic-gate checks cannot be spoofed
        // by an unauthenticated local request.
        CONTROL_CENTER_TOKEN: options.controlCenterToken,
        // Let the managed Gateway expose its live listener before expensive
        // plugin/channel sidecars finish loading.  Sidecars still start
        // asynchronously after the listener is available.
        AUTOMNIA_MANAGED_GATEWAY_STARTUP: 'defer',
        // The injected ClawTalk and Telegram helpers prefer this alias when
        // both names exist. Refresh it as well so a stale parent-process
        // value cannot make the local traffic gate appear unauthorized.
        CLAWTALK_CONTROL_CENTER_TOKEN: options.controlCenterToken,
        CONTROL_CENTER_PORT: String(options.controlCenterPort),
        CONTROL_CENTER_AGENT_TURN_STREAM_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/agent-turn/stream`,
        CLAWTALK_CONTROL_CENTER_AGENT_TURN_STREAM_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/agent-turn/stream`,
        CLAWTALK_CONTROL_CENTER_CONSOLE_FINAL_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/clawtalk-console/final`,
      })
      const child = spawnProcess(spec.command, spec.args, {
        cwd: options.openClawRuntimeCwd(),
        env,
        shell: spec.shell,
        stdio: 'pipe',
        detached: process.platform !== 'win32',
        ...(process.platform === 'win32' ? { windowsHide: true } : {}),
      })
      let settled = false
      let stdout = ''
      let stderr = ''
      let sawInvalidConfig = false
      let sawHttpListening = false
      let sawReady = false
      let sawAgentRuntimePrewarm = false
      let sawProviderAuthPrewarm = false
      let readyFallbackTimer: NodeJS.Timeout | null = null
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        if (readyFallbackTimer) {
          clearTimeout(readyFallbackTimer)
          readyFallbackTimer = null
        }
        callback()
      }
      gatewayLastStartedAt = new Date().toISOString()
      gatewayLastExitAt = null
      gatewayLastExitCode = null
      options.pushGatewayLog(
        'lifecycle',
        `starting OpenClaw gateway on port ${options.gatewayHttpPort} (pid=${child.pid ?? 'n/a'}, config=${options.openClawConfigPath}, state=${options.openClawStateRoot})`,
      )
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString()
        stdout = options.appendBoundedRuntimeOutput(stdout, text)
        markGatewayMigrationInProgress(stdout)
        if (options.isInvalidOpenClawConfigText(text)) sawInvalidConfig = true
        const visibleOutput = options.formatGatewayProcessOutput('[gateway]', text)
        if (visibleOutput) process.stdout.write(visibleOutput)
        options.pushGatewayLog('stdout', text)
        const lowerText = text.toLowerCase()
        if (!sawHttpListening && lowerText.includes('http server listening')) {
          sawHttpListening = true
          recordGatewayStartupEvent('http', 'completed', 'Gateway HTTP server is listening', { pid: child.pid ?? null })
        }
        if (!sawReady && lowerText.includes('ready')) {
          sawReady = true
          recordGatewayStartupEvent('ready', 'completed', 'Gateway reported ready', { pid: child.pid ?? null })
        }
        if (!sawAgentRuntimePrewarm && lowerText.includes('agent runtime plugins pre-warmed')) {
          sawAgentRuntimePrewarm = true
          recordGatewayStartupEvent('prewarm', 'completed', 'Agent runtime plugins pre-warmed', { pid: child.pid ?? null })
        }
        if (!sawProviderAuthPrewarm && lowerText.includes('provider auth state pre-warmed')) {
          sawProviderAuthPrewarm = true
          recordGatewayStartupEvent('prewarm', 'completed', 'Provider auth state pre-warmed', { pid: child.pid ?? null })
        }
        if (lowerText.includes('ready') || lowerText.includes('http server listening')) {
          settle(() => resolve({ pid: child.pid ?? 0 }))
        }
      })
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString()
        stderr = options.appendBoundedRuntimeOutput(stderr, text)
        markGatewayMigrationInProgress(stderr)
        if (options.isInvalidOpenClawConfigText(text)) sawInvalidConfig = true
        const visibleOutput = options.formatGatewayProcessOutput('[gateway-err]', text)
        if (visibleOutput) process.stderr.write(visibleOutput)
        options.pushGatewayLog('stderr', text)
      })
      child.on('error', (err) => {
        options.pushGatewayLog('lifecycle', `gateway process error: ${err.message}`)
        recordGatewayStartupEvent('failed', 'failed', `Gateway process error: ${err.message}`, { pid: child.pid ?? null })
        settle(() => reject(err))
      })
      child.on('close', (code) => {
        log.log(`[gateway] process exited (code=${code})`)
        gatewayLastExitAt = new Date().toISOString()
        gatewayLastExitCode = code ?? null
        options.pushGatewayLog('lifecycle', `process exited (code=${code ?? 'unknown'})`)
        recordGatewayStartupEvent(
          'exit',
          code === 0 || options.isShuttingDown() ? 'completed' : 'failed',
          `Gateway process exited with code ${code ?? 'unknown'}`,
          { pid: child.pid ?? null },
        )
        if (gatewayProcess === child) {
          gatewayProcess = null
          gatewayProcessOwnedByControlCenter = false
          gatewayStartupGraceUntilMs = 0
        }
        options.scheduleOpenClawSessionLockSweep('gateway process exit')
        const detail = options.compactGatewayLogMessage(options.redactSensitiveText(options.stripAnsi(`${stderr}\n${stdout}`)).trim(), 1200)
        settle(() => reject(new Error(`Gateway exited prematurely with code ${code}${detail ? `: ${detail}` : ''}`)))
        if (!options.isShuttingDown() && !gatewayAutoRestartPaused) {
          if (sawInvalidConfig) {
            options.pushGatewayLog('lifecycle', 'gateway exited after invalid config; startup repair will handle retry')
            return
          }
          void isGatewayHealthy().then((healthy) => {
            if (healthy) {
              gatewayRestartCount = 0
              return
            }
            scheduleGatewayRestart('gateway process exited while health probe was unhealthy')
          })
        }
      })
      gatewayProcess = child
      gatewayProcessOwnedByControlCenter = true
      readyFallbackTimer = setTimeout(() => {
        settle(() => resolve({ pid: child.pid ?? 0 }))
      }, 10000)
      readyFallbackTimer.unref?.()
    })
  }

  function scheduleGatewayRestart(reason = 'gateway health recovery'): void {
    if (options.isShuttingDown() || gatewayAutoRestartPaused) return
    if (gatewayRestartTimer || gatewayEnsureInFlight) return
    const backoffMs = Math.min(1000 * Math.pow(2, gatewayRestartCount), 30000)
    gatewayRestartCount += 1
    log.log(`[gateway] scheduling restart in ${backoffMs}ms (attempt #${gatewayRestartCount})`)
    recordGatewayRestartRequest(reason, 'scheduled')
    options.pushGatewayLog('lifecycle', `restart scheduled in ${backoffMs}ms (attempt #${gatewayRestartCount})`)
    clearRestartTimer()
    gatewayRestartTimer = setTimeout(() => {
      gatewayRestartTimer = null
      if (pluginOfflineMutationPending > 0) {
        options.pushGatewayLog('lifecycle', `restart deferred until the plugin state transaction completes: ${reason}`)
        return
      }
      markGatewayRestartOutcome('started')
      void ensureGatewayRunningIfAllowed()
    }, backoffMs)
  }

  async function ensureGatewayRunning(): Promise<void> {
    if (pluginOfflineMutationPending > 0) {
      await pluginOfflineMutationQueue
      return ensureGatewayRunning()
    }
    resumeAutoRestart()
    return ensureGatewayRunningIfAllowed()
  }

  function isGatewayEnsureCurrent(generation: number): boolean {
    return generation === gatewayEnsureGeneration && !gatewayAutoRestartPaused && !options.isShuttingDown()
  }

  type GatewayStartupMaintenanceResult = {
    configReady: boolean
    repairedClawTalkManifests: string[]
    repairedTelegramRuntimes: string[]
    clawTalkRegistryRefreshed: boolean
  }

  async function runGatewayStartupMaintenance(
    generation: number,
    reason: string,
  ): Promise<GatewayStartupMaintenanceResult | null> {
    const [clawTalkRepairResult, telegramRepairResult] = await Promise.all([
      options.repairClawTalkPluginManifestContracts().then((repaired) => ({ ok: true as const, repaired })).catch((error) => {
        log.warn('[plugins/clawtalk] startup repair failed:', error)
        return { ok: false as const, repaired: [] as string[] }
      }),
      options.repairTelegramAgentRoutingRuntime().then((repaired) => ({ ok: true as const, repaired })).catch((error) => {
        log.warn('[plugins/telegram] startup agent-routing repair failed:', error)
        return { ok: false as const, repaired: [] as string[] }
      }),
    ])
    if (!isGatewayEnsureCurrent(generation)) return null

    const repairedClawTalkManifests = clawTalkRepairResult.repaired
    const repairedTelegramRuntimes = telegramRepairResult.repaired
    let clawTalkRegistryRefreshed = false
    if (repairedClawTalkManifests.length) {
      log.info(`[plugins/clawtalk] repaired package contracts/runtime in ${repairedClawTalkManifests.length} install(s)`)
      const registryResult = await options.refreshOpenClawPluginRegistry('clawtalk-startup-repair').catch((error) => {
        log.warn('[plugins/clawtalk] registry refresh after startup repair failed:', error)
        return null
      })
      clawTalkRegistryRefreshed = registryResult?.code === 0
    }
    if (repairedTelegramRuntimes.length) {
      log.info(`[plugins/telegram] repaired agent-routing runtime in ${repairedTelegramRuntimes.length} install(s)`)
    }
    if (!isGatewayEnsureCurrent(generation)) return null

    await options.sweepOpenClawSessionLocks(reason, { minIntervalMs: 0, minAgeMs: 0 })
    if (!isGatewayEnsureCurrent(generation)) return null
    await options.ensureGatewayStartupPluginDefaults({
      ...(clawTalkRepairResult.ok ? { repairedClawTalkManifests } : {}),
      ...(telegramRepairResult.ok ? { repairedTelegramRuntimes } : {}),
      clawTalkRegistryRefreshed,
    })
    if (!isGatewayEnsureCurrent(generation)) return null

    recordGatewayStartupEvent('config', 'started', 'Validating OpenClaw config')
    const configReady = await options.prepareOpenClawConfigForGatewayStartup(reason)
    if (configReady) {
      recordGatewayStartupEvent('config', 'completed', 'OpenClaw config is valid')
    } else {
      recordGatewayStartupEvent('config', 'failed', 'OpenClaw config validation did not complete')
    }
    return {
      configReady,
      repairedClawTalkManifests,
      repairedTelegramRuntimes,
      clawTalkRegistryRefreshed,
    }
  }

  async function ensureGatewayRunningIfAllowed(): Promise<void> {
    if (gatewayAutoRestartPaused || options.isShuttingDown()) return
    const generation = gatewayEnsureGeneration
    if (gatewayEnsureInFlight) {
      const pending = gatewayEnsureInFlight
      if (gatewayEnsureInFlightGeneration === generation) return pending
      await pending.catch(() => undefined)
      if (!isGatewayEnsureCurrent(generation)) return
      return ensureGatewayRunningIfAllowed()
    }
    gatewayEnsureStartedAtMs = Date.now()
    gatewayEnsureInFlightGeneration = generation
    gatewayEnsureInFlight = ensureGatewayRunningInner(generation).finally(() => {
      gatewayEnsureInFlight = null
      gatewayEnsureInFlightGeneration = null
      gatewayEnsureStartedAtMs = 0
    })
    return gatewayEnsureInFlight
  }

  async function ensureGatewayRunningInner(generation: number): Promise<void> {
    if (!isGatewayEnsureCurrent(generation)) return
    if (await isGatewayHealthy()) {
      if (!isGatewayEnsureCurrent(generation)) return
      gatewayStartupGraceUntilMs = 0
      if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
        markGatewayRestartOutcome('succeeded')
      }
      return
    }

    const existingGatewayPid = gatewayProcess?.pid
    if (existingGatewayPid && options.isPidAlive(existingGatewayPid)) {
      if (await waitForGatewayStartupHealth()) return
      if (!isGatewayEnsureCurrent(generation)) return
      if (gatewayProcess?.pid === existingGatewayPid && options.isPidAlive(existingGatewayPid)) {
        const detail = `managed Gateway pid=${existingGatewayPid} is still running without confirmed health; refusing to spawn a duplicate`
        log.warn(`[gateway] ${detail}`)
        options.pushGatewayLog('lifecycle', detail)
        return
      }
    }

    log.log(`[gateway] starting OpenClaw gateway on port ${options.gatewayHttpPort}...`)
    markGatewayStartupGrace()
    resetGatewayStartupTimeline(`Gateway startup requested on port ${options.gatewayHttpPort}`)
    options.pushGatewayLog('lifecycle', `starting requested on port ${options.gatewayHttpPort}`)

    const startupMaintenanceMode = options.startupMaintenanceMode ?? 'blocking'
    let maintenanceResult: GatewayStartupMaintenanceResult | null = null
    if (startupMaintenanceMode === 'blocking') {
      try {
        maintenanceResult = await runGatewayStartupMaintenance(generation, 'gateway startup')
      } catch (error) {
        log.error('[gateway] startup maintenance failed:', error)
        options.pushGatewayLog('lifecycle', `startup maintenance failed: ${String(error)}`, 'warning')
        recordGatewayStartupEvent('config', 'failed', `Gateway startup maintenance failed: ${String(error)}`)
        if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
          markGatewayRestartOutcome('failed')
        }
        return
      }
      if (!maintenanceResult || !isGatewayEnsureCurrent(generation)) return
    } else {
      const message = startupMaintenanceMode === 'deferred'
        ? 'Gateway startup maintenance deferred until after the listener is online'
        : 'Gateway startup maintenance disabled for fast start'
      options.pushGatewayLog('lifecycle', message)
      recordGatewayStartupEvent('config', 'completed', message)
    }

    const repairedClawTalkManifests = maintenanceResult?.repairedClawTalkManifests || []
    const repairedTelegramRuntimes = maintenanceResult?.repairedTelegramRuntimes || []
    const healthy = await isGatewayHealthy()
    if (!isGatewayEnsureCurrent(generation)) return
    if (healthy) {
      const repairedRuntimeLabels = [
        repairedClawTalkManifests.length ? 'ClawTalk' : '',
        repairedTelegramRuntimes.length ? 'Telegram' : '',
      ].filter(Boolean)
      if (repairedRuntimeLabels.length) {
        // A healthy Gateway is already serving active turns.  Plugin repair is
        // startup maintenance; killing the process from this hot path drops
        // the in-flight request and makes the UI report "Failed to fetch".
        // Keep the repaired files for the next explicit Gateway restart.
        const ownership = gatewayProcessOwnedByControlCenter && gatewayProcess ? 'owned' : 'external'
        const detail = `${ownership} gateway is healthy; repaired ${repairedRuntimeLabels.join(' and ')} runtime will load on the next explicit Gateway restart`
        log.info(`[gateway] ${detail}`)
        options.pushGatewayLog('lifecycle', detail)
        gatewayRestartCount = 0
        gatewayStartupGraceUntilMs = 0
        return
      } else {
        log.log(`[gateway] already healthy on port ${options.gatewayHttpPort}`)
        gatewayRestartCount = 0
        gatewayStartupGraceUntilMs = 0
        return
      }
    }

    const portBusy = await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700)
    if (!isGatewayEnsureCurrent(generation)) return
    if (portBusy) {
      const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
      if (!isGatewayEnsureCurrent(generation)) return
      if (listenerPid && options.isPidAlive(listenerPid) && await waitForExistingGatewayHealth(listenerPid)) {
        return
      }
      if (!isGatewayEnsureCurrent(generation)) return

      const now = Date.now()
      if (now - lastGatewayPortReleaseAt < 5000) {
        log.warn(`[gateway] port ${options.gatewayHttpPort} is busy but unhealthy; waiting before another recovery attempt`)
        gatewayStartupGraceUntilMs = 0
        return
      }
      const activeWork = await waitForGatewayAgentRunsToDrain('unhealthy Gateway listener recovery', 0)
      if (!activeWork.drained) {
        const detail = activeWork.activeRuns === null
          ? 'Gateway listener recovery deferred because active agent session state could not be confirmed.'
          : `Gateway listener recovery deferred because ${activeWork.activeRuns} agent run(s) are still active.`
        options.pushGatewayLog('lifecycle', detail, 'warning')
        gatewayStartupGraceUntilMs = 0
        return
      }
      lastGatewayPortReleaseAt = now
      log.warn(`[gateway] port ${options.gatewayHttpPort} accepts TCP but did not answer /healthz; releasing stale listener`)
      const released = await options.tryReleaseGatewayPort()
      if (!isGatewayEnsureCurrent(generation)) return
      log.warn(`[gateway] stale listener release ${released.released ? 'ok' : 'failed'}: ${released.detail}`)
      clearListenerPidCache()
      if (!released.released && (await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700))) {
        gatewayStartupGraceUntilMs = 0
        return
      }
    }

    try {
      if (startupMaintenanceMode === 'blocking' && !maintenanceResult?.configReady) {
        gatewayStartupGraceUntilMs = 0
        if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
          markGatewayRestartOutcome('failed')
        }
        recordGatewayStartupEvent('config', 'failed', 'OpenClaw config validation blocked Gateway startup')
        return
      }
      // OpenClaw reads its persisted cold registry during normal startup.
      // --refresh is a repair operation: launching a second CLI here repeats
      // runtime initialization and delays the Gateway (up to the CLI timeout).
      // Manifest repairs above and plugin install/config flows own refreshes.
      recordGatewayStartupEvent('spawned', 'started', 'Spawning Gateway process')
      const { pid } = await spawnGateway()
      recordGatewayStartupEvent('spawned', 'completed', `Gateway process spawned with pid ${pid}`, { pid })
      log.log(`[gateway] started with pid ${pid}`)
      options.pushGatewayLog('lifecycle', `started with pid ${pid}`)

      if (startupMaintenanceMode === 'deferred') {
        const deferredMaintenanceTimer = setTimeout(() => {
          if (!isGatewayEnsureCurrent(generation)) return
          void runGatewayStartupMaintenance(generation, 'deferred gateway startup maintenance').then((result) => {
            if (result && !result.configReady) {
              options.pushGatewayLog('lifecycle', 'deferred Gateway startup maintenance found an invalid config; use Doctor for repair details', 'warning')
            }
          }).catch((error) => {
            log.warn('[gateway] deferred startup maintenance failed:', error)
            options.pushGatewayLog('lifecycle', `deferred startup maintenance failed: ${String(error)}`, 'warning')
          })
        }, 1500)
        deferredMaintenanceTimer.unref?.()
      }

      if (await waitForGatewayStartupHealth()) {
        gatewayStartupGraceUntilMs = 0
        recordGatewayStartupEvent('healthy', 'completed', 'Gateway health confirmed', { pid })
        log.log(`[gateway] healthy on http://127.0.0.1:${options.gatewayHttpPort}`)
        gatewayRestartCount = 0
        if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
          markGatewayRestartOutcome('succeeded')
        }
        options.pushGatewayLog('lifecycle', `healthy on http://127.0.0.1:${options.gatewayHttpPort}`)
        return
      }
      const detail = `health check did not confirm within ${options.startupHealthConfirmTimeoutMs}ms, but process is running`
      log.warn(`[gateway] ${detail}`)
      options.pushGatewayLog('lifecycle', detail)
      recordGatewayStartupEvent('warning', 'warning', detail, { pid })
    } catch (err) {
      log.error('[gateway] failed to start:', err)
      options.pushGatewayLog('lifecycle', `failed to start: ${String(err)}`)
      recordGatewayStartupEvent('failed', 'failed', `Gateway startup failed: ${String(err)}`)
      if (options.isInvalidOpenClawConfigText(String(err))) {
        const repaired = await options.prepareOpenClawConfigForGatewayStartup('gateway invalid-config recovery')
        if (repaired && !options.isShuttingDown()) {
          options.pushGatewayLog('lifecycle', 'retrying gateway startup after config repair')
          setTimeout(() => {
            void ensureGatewayRunningIfAllowed()
          }, 500).unref?.()
        }
      }
      if (!gatewayProcess) gatewayStartupGraceUntilMs = 0
      if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
        markGatewayRestartOutcome('failed')
      }
    }
  }

  function stopGateway(): void {
    if (!gatewayProcess) return
    completeGatewayMigration()
    log.log('[gateway] stopping...')
    options.pushGatewayLog('lifecycle', 'stopping gateway process')
    try {
      void options.terminateProcessTree(gatewayProcess.pid, 'gateway stop')
    } catch {
      // Process may already be gone.
    }
    const exitTimer = setTimeout(() => {
      if (gatewayProcess) {
        try {
          void options.terminateProcessTree(gatewayProcess.pid, 'gateway stop escalation', true)
        } catch {
          // Process may already be gone.
        }
      }
    }, 5000)
    gatewayProcess.on('close', () => {
      clearTimeout(exitTimer)
      log.log('[gateway] stopped')
      options.pushGatewayLog('lifecycle', 'gateway stopped')
      gatewayProcess = null
      gatewayProcessOwnedByControlCenter = false
    })
  }

  async function stopGatewayRuntime(reason = 'manual stop'): Promise<{ stopped: boolean; detail: string; port: number; pid: number | null }> {
    if (pluginOfflineMutationPending > 0) {
      await pluginOfflineMutationQueue
      return stopGatewayRuntime(reason)
    }
    pauseAutoRestart()
    completeGatewayMigration()
    gatewayStartupGraceUntilMs = 0
    stopGatewayHealthMonitor()
    options.stopControlCenterGatewayClient(`${reason}: gateway runtime stop`)

    const pid = gatewayProcess?.pid || await gatewayListenerPidForPort(options.gatewayHttpPort)
    if (gatewayProcess?.pid) {
      try {
        await options.terminateProcessTree(gatewayProcess.pid, 'manual gateway stop')
      } catch {
        // The port release path below is authoritative.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    const release = await options.tryReleaseGatewayPort()
    gatewayProcess = null
    gatewayProcessOwnedByControlCenter = false
    gatewayRestartCount = 0
    gatewayLastExitAt = new Date().toISOString()
    gatewayLastExitCode = null
    gatewayListenerPidCache = null

    const stillBusy = await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700)
    const stopped = !stillBusy
    await options.sweepOpenClawSessionLocks('gateway stop', { minIntervalMs: 0, minAgeMs: 0 })
    options.pushGatewayLog('lifecycle', `${reason}: gateway ${stopped ? 'stopped' : 'still listening'} on port ${options.gatewayHttpPort}${pid ? ` pid=${pid}` : ''}`)
    return {
      stopped,
      port: options.gatewayHttpPort,
      pid: pid || null,
      detail: release.detail,
    }
  }

  function restartLifecycleTimelineWithMemory(
    restartSnapshot: GatewayRestartLifecycleSnapshot | null,
    restartTimeline: GatewayRestartLifecycleSnapshot[],
  ): GatewayRestartLifecycleSnapshot[] {
    const byRequestedAt = new Map<string, GatewayRestartLifecycleSnapshot>()
    for (const snapshot of restartTimeline) {
      byRequestedAt.set(snapshot.at, snapshot)
    }
    if (restartSnapshot) byRequestedAt.set(restartSnapshot.at, restartSnapshot)
    const memorySnapshot = restartLifecycleSnapshotFromMemory()
    if (memorySnapshot) byRequestedAt.set(memorySnapshot.at, memorySnapshot)
    return Array.from(byRequestedAt.values())
      .sort((a, b) => Date.parse(b.eventAt || b.at) - Date.parse(a.eventAt || a.at))
      .slice(0, restartTimelineLimit)
  }

  function restartDiagnostics(
    healthy: boolean,
    recentRestarts: GatewayRestartLifecycleSnapshot[],
    stability: GatewayStabilityStatus,
  ): GatewayRestartDiagnostics {
    const now = Date.now()
    const recentWindowMs = 15 * 60 * 1000
    const windowedRestarts = recentRestarts.filter((entry) => {
      const at = Date.parse(entry.eventAt || entry.at)
      return Number.isFinite(at) && now - at <= recentWindowMs
    })
    const timeline = windowedRestarts.length ? windowedRestarts : recentRestarts
    const latest = recentRestarts[0] || null
    const recentFailures = timeline.filter((entry) => entry.outcome === 'failed').length
    let failureStreak = 0
    for (const entry of recentRestarts) {
      if (entry.outcome !== 'failed') break
      failureStreak += 1
    }
    const activeWork = Math.max(0, stability.summary.active ?? 0, stability.summary.waiting ?? 0)
    const queuedWork = Math.max(0, stability.summary.queued ?? 0, stability.summary.maxQueueDepth ?? 0)
    const recentWarning = stability.summary.recentWarnings[0]
    const restartChurn = timeline.length >= 3 && !healthy
    const needsAttention = !healthy && (
      failureStreak > 0 ||
      recentFailures > 0 ||
      restartChurn ||
      latest?.outcome === 'started' ||
      latest?.outcome === 'scheduled'
    )
    const repairAction = needsAttention
      ? activeWork > 0 || queuedWork > 0
        ? 'Inspect active Gateway work before forcing a restart; use Doctor if the queue does not drain.'
        : failureStreak > 0 || recentFailures > 1
          ? 'Run Doctor, inspect Gateway logs, then restart the Gateway.'
          : 'Restart Gateway and rerun Doctor if health does not recover.'
      : undefined
    const summary = needsAttention
      ? [
          failureStreak > 0 ? `${failureStreak} restart failure${failureStreak === 1 ? '' : 's'} in a row` : '',
          restartChurn ? `${timeline.length} restart attempts in the last 15m` : '',
          activeWork || queuedWork ? `active work ${activeWork}, queued ${queuedWork}` : '',
          recentWarning ? `latest stability warning: ${recentWarning}` : '',
        ].filter(Boolean).join('; ') || 'Gateway restart recovery needs attention.'
      : latest
        ? `Restart ${latest.outcome}${latest.at ? ` at ${latest.at}` : ''}; ${healthy ? 'Gateway is healthy.' : 'waiting for health recovery.'}`
        : healthy
          ? 'No restart recovery needed; Gateway is healthy.'
          : 'No restart attempts recorded; Gateway is not healthy.'

    return {
      severity: needsAttention ? 'warning' : 'info',
      needsAttention,
      summary: options.sanitizeGatewayStartupMessage(summary, 260),
      recentAttempts: timeline.length,
      recentFailures,
      failureStreak,
      latestOutcome: latest?.outcome || null,
      latestReason: latest?.reason || null,
      latestAt: latest?.at || null,
      activeWork,
      queuedWork,
      ...(repairAction ? { repairAction } : {}),
    }
  }

  function gatewayStatusSnapshot(
    healthy: boolean,
    listenerPid: number | null = null,
    restartSnapshot: GatewayRestartLifecycleSnapshot | null = null,
    restartTimeline: GatewayRestartLifecycleSnapshot[] = [],
    stability: GatewayStabilityStatus = options.gatewayStabilityUnavailable('gateway-client-not-ready'),
  ) {
    const managedPid = gatewayProcess?.pid && options.isPidAlive(gatewayProcess.pid) ? gatewayProcess.pid : null
    const pid = managedPid || listenerPid
    const processRunning = healthy || Boolean(pid && options.isPidAlive(pid))
    const startupGraceRemainingMs = gatewayStartupGraceRemainingMs()
    const startupTimeline = gatewayStartupTimeline.slice()
    const latestStartupEvent = startupTimeline.length ? startupTimeline[startupTimeline.length - 1] : null
    const startedMs = gatewayLastStartedAt ? new Date(gatewayLastStartedAt).getTime() : NaN
    const recentRestarts = restartLifecycleTimelineWithMemory(restartSnapshot, restartTimeline)
    const lastRestart = recentRestarts[0] || restartSnapshot || null
    const lastRestartAt = gatewayLastRestartAt || lastRestart?.at || null
    const lastRestartReason = gatewayLastRestartReason || lastRestart?.reason || null
    const lastRestartOutcome = gatewayLastRestartOutcome || lastRestart?.outcome || null
    const diagnostics = restartDiagnostics(healthy, recentRestarts, stability)
    const state = healthy
      ? 'healthy'
      : gatewayRestartTimer
        ? 'restarting'
        : gatewayEnsureInFlight
          ? 'starting'
          : processRunning
            ? 'starting'
            : startupGraceRemainingMs > 0
              ? 'starting'
              : 'offline'
    return {
      state,
      healthy,
      processRunning,
      pid,
      ownedByControlCenter: Boolean(managedPid && gatewayProcessOwnedByControlCenter),
      port: options.gatewayHttpPort,
      restartCount: gatewayRestartCount,
      restartScheduled: Boolean(gatewayRestartTimer),
      ensureInFlight: Boolean(gatewayEnsureInFlight),
      startupGraceRemainingMs,
      startup: {
        graceRemainingMs: startupGraceRemainingMs,
        startedAt: startupTimeline[0]?.timestamp || gatewayLastStartedAt,
        lastPhase: latestStartupEvent?.phase || null,
        lastStatus: latestStartupEvent?.status || null,
        timeline: startupTimeline,
      },
      autoRestartPaused: gatewayAutoRestartPaused,
      lastStartedAt: gatewayLastStartedAt,
      lastHealthyAt: gatewayLastHealthyAt,
      lastExitAt: gatewayLastExitAt,
      lastExitCode: gatewayLastExitCode,
      lastRestartAt,
      lastRestartReason,
      lastRestartOutcome,
      recentRestarts,
      restartDiagnostics: diagnostics,
      migration: gatewayMigrationStatus(),
      uptimeMs: Number.isFinite(startedMs) && (healthy || processRunning) ? Date.now() - startedMs : 0,
      logs: options.getGatewayLogs().filter((entry) => options.isRuntimeMonitorEntryVisible(entry.timestamp)).slice(0, 80),
    }
  }

  function tryRestartGatewayService(optionsArg: { force?: boolean; allowExternalTakeover?: boolean; reason?: string } = {}): Promise<{ restarted: boolean; detail: string }> {
    if (pluginOfflineMutationPending > 0) {
      return pluginOfflineMutationQueue.then(() => tryRestartGatewayService(optionsArg))
    }
    if (gatewayRestartInFlight) return gatewayRestartInFlight

    const releaseAdmission = pauseGatewayRestartAdmission(optionsArg.reason || 'Gateway restart')
    const restartPromise = tryRestartGatewayServiceInner(optionsArg).finally(() => {
      releaseAdmission()
      if (gatewayRestartInFlight === restartPromise) gatewayRestartInFlight = null
    })
    gatewayRestartInFlight = restartPromise
    return restartPromise
  }

  async function waitForGatewayAgentRunsToDrain(
    reason: string,
    requestedTimeoutMs = options.gatewayRestartDrainTimeoutMs ?? DEFAULT_GATEWAY_RESTART_DRAIN_TIMEOUT_MS,
  ): Promise<{ drained: boolean; activeRuns: number | null }> {
    const timeoutMs = Math.max(0, requestedTimeoutMs)
    const startedAt = Date.now()
    const deadline = startedAt + timeoutMs
    let lastLogAt = 0
    const readActiveRuns = async () => {
      if (!options.getActiveAgentRunCount) return 0
      try {
        const count = await options.getActiveAgentRunCount()
        return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null
      } catch {
        return null
      }
    }
    let activeRuns = await readActiveRuns()

    while (activeRuns !== 0 && Date.now() < deadline && !options.isShuttingDown()) {
      if (!lastLogAt || Date.now() - lastLogAt >= 30_000) {
        const waitedMs = Date.now() - startedAt
        const activity = activeRuns === null ? 'active agent session state is unavailable' : `${activeRuns} active agent run(s)`
        const message = `Gateway restart waiting for ${activity} (${Math.round(waitedMs / 1000)}s elapsed): ${reason}`
        options.pushGatewayLog('lifecycle', message)
        lastLogAt = Date.now()
      }
      // Recheck promptly after the last agent turn completes so a queued
      // settings restart starts without an extra one-second pause.
      await options.delayMs(Math.min(250, Math.max(1, deadline - Date.now())))
      activeRuns = await readActiveRuns()
    }

    return { drained: activeRuns === 0, activeRuns }
  }

  async function tryRestartGatewayServiceInner(optionsArg: { force?: boolean; allowExternalTakeover?: boolean; reason?: string } = {}): Promise<{ restarted: boolean; detail: string }> {
    try {
      if (optionsArg.force) resumeAutoRestart()
      const logs: string[] = []
      const restartReason = optionsArg.reason || (optionsArg.force ? 'forced gateway restart' : 'gateway restart recovery')
      const startup = await waitForGatewayStartupHealthIfStarting()
      if (!optionsArg.force && await isGatewayHealthy()) {
        startGatewayHealthMonitor()
        recordGatewayRestartRequest(restartReason, 'skipped')
        return { restarted: true, detail: 'gateway already healthy' }
      }
      if (!optionsArg.force && startup.waited && startup.healthy) {
        startGatewayHealthMonitor()
        recordGatewayRestartRequest(restartReason, 'skipped')
        return { restarted: true, detail: 'gateway startup completed and health was confirmed' }
      }
      // A forced restart may arrive while the initial start is still running.
      // Join that attempt before stopping anything so a second OpenClaw process
      // cannot enter the same state directory during startup migrations.
      const activeStartup = gatewayEnsureInFlight
      if (activeStartup) await activeStartup.catch(() => undefined)
      if (gatewayRestartTimer) clearRestartTimer()

      if (gatewayProcess) {
        const pid = gatewayProcess.pid
        const drain = await waitForGatewayAgentRunsToDrain(restartReason)
        if (!drain.drained) {
          const detail = drain.activeRuns === null
            ? 'Gateway restart was deferred because active agent session state could not be confirmed; let current work finish, then retry the restart.'
            : `Gateway restart was deferred because ${drain.activeRuns} agent run(s) are still active; let the current work finish, then retry the restart.`
          options.pushGatewayLog('lifecycle', detail, 'warning')
          recordGatewayRestartRequest(restartReason, 'skipped')
          markGatewayRestartOutcome('skipped')
          return { restarted: false, detail }
        }
        recordGatewayRestartRequest(restartReason, 'started')
        try {
          await options.terminateProcessTree(pid, 'gateway restart')
        } catch {
          // The graceful process shutdown path below is authoritative.
        }
        if (pid && options.isPidAlive(pid)) {
          const deadline = Date.now() + GATEWAY_RESTART_GRACEFUL_STOP_TIMEOUT_MS
          while (Date.now() <= deadline && options.isPidAlive(pid)) {
            await options.delayMs(Math.min(options.startupHealthPollMs, Math.max(1, deadline - Date.now())))
          }
          if (options.isPidAlive(pid)) {
            const finalDrain = await waitForGatewayAgentRunsToDrain(`${restartReason} force-stop safety check`, 0)
            if (!finalDrain.drained) {
              const detail = finalDrain.activeRuns === null
                ? `Owned Gateway pid=${pid} did not exit gracefully; active agent state could not be confirmed, so it remains running.`
                : `Owned Gateway pid=${pid} did not exit gracefully; ${finalDrain.activeRuns} agent run(s) remain active, so it remains running.`
              options.pushGatewayLog('lifecycle', detail, 'warning')
              markGatewayRestartOutcome('skipped')
              return { restarted: false, detail }
            }

            await options.terminateProcessTree(pid, 'gateway restart force escalation', true).catch(() => undefined)
            const forceDeadline = Date.now() + GATEWAY_RESTART_FORCE_EXIT_TIMEOUT_MS
            while (Date.now() <= forceDeadline && options.isPidAlive(pid)) {
              await options.delayMs(Math.min(options.startupHealthPollMs, Math.max(1, forceDeadline - Date.now())))
            }
            if (options.isPidAlive(pid)) {
              const detail = `Owned Gateway pid=${pid} did not exit after graceful and forced shutdown.`
              options.pushGatewayLog('lifecycle', detail, 'warning')
              markGatewayRestartOutcome('failed')
              return { restarted: false, detail }
            }
            options.pushGatewayLog('lifecycle', `Gateway pid=${pid} required forced shutdown after agent work drained; restart is continuing.`)
          }
        }
        gatewayProcess = null
        gatewayProcessOwnedByControlCenter = false
      } else {
        const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
        if (listenerPid && !optionsArg.allowExternalTakeover) {
          const externalDetail = `external gateway listener pid=${listenerPid} left running; manual restart can take over if needed`
          logs.push(`[gateway-external] ${externalDetail}`)
          startGatewayHealthMonitor()
          recordGatewayRestartRequest(restartReason, 'skipped')
          markGatewayRestartOutcome('skipped')
          return { restarted: false, detail: logs.join('\n') }
        }
        const drain = await waitForGatewayAgentRunsToDrain(restartReason)
        if (!drain.drained) {
          const detail = drain.activeRuns === null
            ? 'Gateway takeover was deferred because active agent session state could not be confirmed; let current work finish, then retry.'
            : `Gateway takeover was deferred because ${drain.activeRuns} agent run(s) are still active; let current work finish, then retry.`
          options.pushGatewayLog('lifecycle', detail, 'warning')
          recordGatewayRestartRequest(restartReason, 'skipped')
          markGatewayRestartOutcome('skipped')
          return { restarted: false, detail }
        }
        recordGatewayRestartRequest(restartReason, 'started')
      }

      const released = await options.tryReleaseGatewayPort()
      logs.push(`[gateway-port-release] ${released.released ? 'ok' : 'failed'} | ${released.detail}`)
      gatewayRestartCount = 0
      await ensureGatewayRunningIfAllowed()
      let restarted = await isGatewayHealthy()
      if (!restarted) {
        const startupAfterRestart = await waitForGatewayStartupHealthIfStarting()
        restarted = startupAfterRestart.waited && startupAfterRestart.healthy
      }
      if (restarted) startGatewayHealthMonitor()
      markGatewayRestartOutcome(restarted ? 'succeeded' : 'failed')
      logs.push(`[gateway-health-after-restart] ${restarted ? 'ok' : 'failed'}`)
      return {
        restarted,
        detail: logs.filter(Boolean).join('\n').trim(),
      }
    } catch (error) {
      markGatewayRestartOutcome('failed')
      return { restarted: false, detail: String(error) }
    }
  }

  async function pauseForPluginInstallRepair(actions: string[]) {
    pauseAutoRestart()
    stopGatewayHealthMonitor()
    const pid = gatewayProcess?.pid || await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
    if (gatewayProcess?.pid) {
      await options.terminateProcessTree(gatewayProcess.pid, 'plugin install repair', true).catch((error) => {
        actions.push(`gateway process stop warning: ${String(error)}`)
      })
    }
    const released = await options.tryReleaseGatewayPort().catch((error) => ({ released: false, detail: String(error) }))
    gatewayProcess = null
    gatewayRestartCount = 0
    gatewayListenerPidCache = null
    actions.push(`paused gateway during plugin install repair${pid ? ` pid=${pid}` : ''}; ${released.detail}`)
  }

  function resumeAfterPluginInstallRepair(actions: string[]) {
    resumeAutoRestart()
    actions.push('resumed gateway auto-start after plugin install repair')
  }

  async function withGatewayStoppedForPluginMutation<T>(
    reason: string,
    operation: () => Promise<T>,
  ): Promise<{ value: T; restarted: boolean; detail: string }> {
    pluginOfflineMutationPending += 1
    const run = pluginOfflineMutationQueue.then(async () => {
      const releaseAdmission = pauseGatewayRestartAdmission(`plugin mutation: ${reason}`)
      try {
        return await withGatewayStoppedForPluginMutationInner(reason, operation)
      } finally {
        releaseAdmission()
      }
    })
    pluginOfflineMutationQueue = run.then(
      () => { pluginOfflineMutationPending = Math.max(0, pluginOfflineMutationPending - 1) },
      () => { pluginOfflineMutationPending = Math.max(0, pluginOfflineMutationPending - 1) },
    )
    return run
  }

  async function withGatewayStoppedForPluginMutationInner<T>(
    reason: string,
    operation: () => Promise<T>,
  ): Promise<{ value: T; restarted: boolean; detail: string }> {
    const restartInFlight = gatewayRestartInFlight
    if (restartInFlight) await restartInFlight.catch(() => undefined)

    const wasAutoRestartPaused = gatewayAutoRestartPaused
    const wasHealthMonitorRunning = Boolean(gatewayHealthCheckInterval)
    const hadStartupInFlight = Boolean(gatewayEnsureInFlight)
    const hadRestartScheduled = Boolean(gatewayRestartTimer)
    const originalManagedPid = gatewayProcessOwnedByControlCenter ? gatewayProcess?.pid : undefined
    const wasManagedGatewayRunning = Boolean(originalManagedPid && options.isPidAlive(originalManagedPid))
    const shouldRestoreGateway = wasManagedGatewayRunning || (!wasAutoRestartPaused && (
      hadStartupInFlight || hadRestartScheduled
    ))
    const startup = gatewayEnsureInFlight

    pauseAutoRestart()
    stopGatewayHealthMonitor()

    let value!: T
    let operationError: unknown
    let restartError: unknown
    let restarted = false
    let restartDetail = 'Gateway was already offline; no restart was needed.'

    try {
      if (startup) await startup.catch(() => undefined)

      const managedPid = gatewayProcessOwnedByControlCenter ? gatewayProcess?.pid : undefined
      const managedRunning = Boolean(managedPid && options.isPidAlive(managedPid))
      if (!managedRunning) {
        const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
        if (listenerPid && options.isPidAlive(listenerPid)) {
          throw new Error(
            `Cannot run ${reason} while external Gateway pid=${listenerPid} owns the OpenClaw state. ` +
            'No local plugin mutation was attempted. Inspect openclaw gateway status, stop that Gateway through its service owner, then retry from Automnia.',
          )
        }
      } else if (managedPid) {
        const activeWork = await waitForGatewayAgentRunsToDrain(reason, PLUGIN_MUTATION_DRAIN_TIMEOUT_MS)
        if (!activeWork.drained) {
          const detail = activeWork.activeRuns === null
            ? `Cannot run ${reason}: active agent session state could not be confirmed, so the Gateway was left running and no plugin files were changed.`
            : `Cannot run ${reason}: ${activeWork.activeRuns} agent run(s) are still active, so the Gateway was left running and no plugin files were changed.`
          throw new Error(detail)
        }
        const gracefulStop = await options.terminateProcessTree(managedPid, `plugin mutation drain: ${reason}`)
        options.pushGatewayLog(
          'lifecycle',
          `${reason}: requested graceful Gateway shutdown${gracefulStop.detail ? `; ${gracefulStop.detail}` : ''}`,
        )
        let deadline = Date.now() + PLUGIN_MUTATION_DRAIN_TIMEOUT_MS
        while (Date.now() <= deadline && options.isPidAlive(managedPid)) {
          await options.delayMs(Math.min(options.startupHealthPollMs, Math.max(1, deadline - Date.now())))
        }
        if (options.isPidAlive(managedPid)) {
          options.pushGatewayLog('lifecycle', `${reason}: graceful Gateway drain expired; escalating for managed pid=${managedPid}`)
          await options.terminateProcessTree(managedPid, `plugin mutation force stop: ${reason}`, true)
          deadline = Date.now() + PLUGIN_MUTATION_FORCE_EXIT_TIMEOUT_MS
          while (Date.now() <= deadline && options.isPidAlive(managedPid)) {
            await options.delayMs(Math.min(options.startupHealthPollMs, Math.max(1, deadline - Date.now())))
          }
        }
        if (options.isPidAlive(managedPid)) {
          throw new Error(`Cannot run ${reason}: managed Gateway pid=${managedPid} did not stop after graceful shutdown and force escalation.`)
        }
        if (gatewayProcess?.pid === managedPid) {
          gatewayProcess = null
          gatewayProcessOwnedByControlCenter = false
        }
        clearListenerPidCache()
      }

      const releaseDeadline = Date.now() + PLUGIN_MUTATION_PORT_RELEASE_TIMEOUT_MS
      let portBusy = await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700)
      while (portBusy && Date.now() <= releaseDeadline) {
        const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
        if (listenerPid && options.isPidAlive(listenerPid) && !wasManagedGatewayRunning) {
          throw new Error(
            `Cannot run ${reason}: external Gateway pid=${listenerPid} is using the OpenClaw state. ` +
            'No local plugin mutation was attempted. Inspect openclaw gateway status and stop it through its service owner before retrying.',
          )
        }
        await options.delayMs(Math.min(options.startupHealthPollMs, Math.max(1, releaseDeadline - Date.now())))
        portBusy = await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700)
      }
      if (portBusy) {
        throw new Error(`Cannot run ${reason}: the Gateway listener is still active. No plugin files were changed.`)
      }

      value = await operation()
    } catch (error) {
      operationError = error
    }

    try {
      if (shouldRestoreGateway) {
        resumeAutoRestart()
        const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
        if (listenerPid && options.isPidAlive(listenerPid)) {
          if (gatewayProcessOwnedByControlCenter && gatewayProcess?.pid && options.isPidAlive(gatewayProcess.pid)) {
            const health = await waitForExistingGatewayHealth(listenerPid)
            if (!health) throw new Error(`managed Gateway pid=${listenerPid} was still running but did not become healthy`)
          } else {
            throw new Error(
              `external Gateway pid=${listenerPid} appeared while ${reason} was running; Automnia left it untouched.`,
            )
          }
        } else {
          await ensureGatewayRunningIfAllowed()
          const health = await waitForGatewayStartupHealthIfStarting()
          if (!health.healthy && !await isGatewayHealthy()) {
            throw new Error(`Gateway did not become healthy after ${reason}.`)
          }
        }
        startGatewayHealthMonitor()
        if (wasAutoRestartPaused) pauseAutoRestart()
        restarted = true
        restartDetail = `Gateway stopped for ${reason} and returned to a healthy state.`
      } else {
        if (!wasAutoRestartPaused) resumeAutoRestart()
        if (wasHealthMonitorRunning) startGatewayHealthMonitor()
      }
    } catch (error) {
      restartError = error
      if (wasAutoRestartPaused) pauseAutoRestart()
    }

    if (operationError) {
      const error = operationError instanceof Error ? operationError : new Error(String(operationError))
      if (restartError) error.message += ` Gateway recovery also failed: ${String(restartError)}`
      throw error
    }
    if (restartError) {
      throw new Error(`${reason} completed, but Gateway recovery failed: ${String(restartError)}`)
    }

    return { value, restarted, detail: restartDetail }
  }

  return {
    buildGatewayRunArgs,
    clearListenerPidCache,
    clearRestartTimer,
    gatewayListenerPidForPort,
    gatewayStatusSnapshot,
    isGatewayHealthy,
    lifecycleSnapshot,
    markGatewayHealthy,
    pauseAutoRestart,
    pauseAutoRestartForInvalidConfig,
    pauseAutoRestartForRuntimeUnavailable,
    pauseForPluginInstallRepair,
    restartDiagnostics,
    restartLifecycleTimelineWithMemory,
    resumeAfterPluginInstallRepair,
    resumeAutoRestartAfterConfigRepair,
    startGatewayHealthMonitor,
    stopGateway,
    stopGatewayHealthMonitor,
    stopGatewayRuntime,
    tryRestartGatewayService,
    waitForGatewayAdmission,
    isGatewayRestartAdmissionPaused: () => gatewayRestartAdmissionPauses.size > 0,
    withGatewayStoppedForPluginMutation,
    waitForGatewayStartupHealthIfStarting,
    ensureGatewayRunning,
  }
}

export type GatewayLifecycleService = ReturnType<typeof createGatewayLifecycleService>

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

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

export type SpawnTextResult = {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

type GatewayHealthResult = {
  healthy: boolean
  payload: unknown
}

type PluginRegistryRefreshResult = {
  code: number | null
}

type GatewayStabilityUnavailableSource = 'diagnostics.stability' | 'gateway-client-not-ready'

export type GatewayLifecycleServiceOptions = {
  gatewayHttpPort: number
  controlCenterPort: number
  openClawConfigPath: string
  openClawStateRoot: string
  startupHealthGraceMs: number
  startupHealthConfirmTimeoutMs: number
  startupHealthPollMs: number
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
  ensureGatewayStartupPluginDefaults: () => Promise<void>
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

  function resumeAutoRestartAfterConfigRepair(): void {
    gatewayAutoRestartPaused = false
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
    if (health.healthy) markGatewayHealthy()
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
        CONTROL_CENTER_AGENT_TURN_STREAM_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/agent-turn/stream`,
        CLAWTALK_CONTROL_CENTER_AGENT_TURN_STREAM_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/agent-turn/stream`,
        CLAWTALK_CONTROL_CENTER_CONSOLE_FINAL_URL: `http://127.0.0.1:${options.controlCenterPort}/api/openclaw/clawtalk-console/final`,
      })
      const child = spawnProcess(spec.command, spec.args, {
        cwd: options.openClawRuntimeCwd(),
        env,
        shell: spec.shell,
        stdio: 'pipe',
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
      markGatewayRestartOutcome('started')
      void ensureGatewayRunning()
    }, backoffMs)
  }

  async function ensureGatewayRunning(): Promise<void> {
    if (gatewayEnsureInFlight) return gatewayEnsureInFlight
    gatewayEnsureInFlight = ensureGatewayRunningInner().finally(() => {
      gatewayEnsureInFlight = null
    })
    return gatewayEnsureInFlight
  }

  async function ensureGatewayRunningInner(): Promise<void> {
    gatewayAutoRestartPaused = false
    if (await isGatewayHealthy()) {
      gatewayStartupGraceUntilMs = 0
      if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
        markGatewayRestartOutcome('succeeded')
      }
      return
    }

    const repairedClawTalkManifests = await options.repairClawTalkPluginManifestContracts().catch((error) => {
      log.warn('[plugins/clawtalk] startup repair failed:', error)
      return [] as string[]
    })
    const repairedTelegramRuntimes = await options.repairTelegramAgentRoutingRuntime().catch((error) => {
      log.warn('[plugins/telegram] startup agent-routing repair failed:', error)
      return [] as string[]
    })
    if (repairedClawTalkManifests.length) {
      log.info(`[plugins/clawtalk] repaired package contracts/runtime in ${repairedClawTalkManifests.length} install(s)`)
      await options.refreshOpenClawPluginRegistry('clawtalk-startup-repair').catch((error) => {
        log.warn('[plugins/clawtalk] registry refresh after startup repair failed:', error)
      })
    }
    if (repairedTelegramRuntimes.length) {
      log.info(`[plugins/telegram] repaired agent-routing runtime in ${repairedTelegramRuntimes.length} install(s)`)
    }
    const healthy = await isGatewayHealthy()
    if (healthy) {
      const repairedRuntimeLabels = [
        repairedClawTalkManifests.length ? 'ClawTalk' : '',
        repairedTelegramRuntimes.length ? 'Telegram' : '',
      ].filter(Boolean)
      if (repairedRuntimeLabels.length) {
        if (!gatewayProcessOwnedByControlCenter || !gatewayProcess) {
          const detail = `external gateway is healthy; restart it to load repaired ${repairedRuntimeLabels.join(' and ')} runtime`
          log.info(`[gateway] ${detail}`)
          options.pushGatewayLog('lifecycle', detail)
          gatewayRestartCount = 0
          gatewayStartupGraceUntilMs = 0
          return
        }
        log.info(`[gateway] restarting owned healthy gateway to load repaired ${repairedRuntimeLabels.join(' and ')} runtime`)
        options.pushGatewayLog('lifecycle', `restarting owned gateway to load repaired ${repairedRuntimeLabels.join(' and ')} runtime`)
        await options.terminateProcessTree(gatewayProcess.pid, 'gateway repaired runtime restart', true).catch(() => ({ ok: false, detail: 'terminate failed' }))
        gatewayProcess = null
        gatewayProcessOwnedByControlCenter = false
        await options.delayMs(750)
      } else {
        log.log(`[gateway] already healthy on port ${options.gatewayHttpPort}`)
        gatewayRestartCount = 0
        gatewayStartupGraceUntilMs = 0
        return
      }
    }

    const portBusy = await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700)
    if (portBusy) {
      const now = Date.now()
      if (now - lastGatewayPortReleaseAt < 5000) {
        log.warn(`[gateway] port ${options.gatewayHttpPort} is busy but unhealthy; waiting before another recovery attempt`)
        return
      }
      lastGatewayPortReleaseAt = now
      log.warn(`[gateway] port ${options.gatewayHttpPort} accepts TCP but did not answer /health; releasing stale listener`)
      const released = await options.tryReleaseGatewayPort()
      log.warn(`[gateway] stale listener release ${released.released ? 'ok' : 'failed'}: ${released.detail}`)
      if (!released.released && (await options.checkTcpPort('127.0.0.1', options.gatewayHttpPort, 700))) {
        return
      }
    }

    log.log(`[gateway] starting OpenClaw gateway on port ${options.gatewayHttpPort}...`)
    markGatewayStartupGrace()
    resetGatewayStartupTimeline(`Gateway startup requested on port ${options.gatewayHttpPort}`)
    options.pushGatewayLog('lifecycle', `starting requested on port ${options.gatewayHttpPort}`)
    try {
      await options.sweepOpenClawSessionLocks('gateway startup', { minIntervalMs: 0, minAgeMs: 0 })
      await options.ensureGatewayStartupPluginDefaults()
      recordGatewayStartupEvent('config', 'started', 'Validating OpenClaw config')
      const configReady = await options.prepareOpenClawConfigForGatewayStartup('gateway startup')
      if (!configReady) {
        gatewayStartupGraceUntilMs = 0
        if (gatewayLastRestartOutcome === 'scheduled' || gatewayLastRestartOutcome === 'started') {
          markGatewayRestartOutcome('failed')
        }
        recordGatewayStartupEvent('config', 'failed', 'OpenClaw config validation blocked Gateway startup')
        return
      }
      recordGatewayStartupEvent('config', 'completed', 'OpenClaw config is valid')
      recordGatewayStartupEvent('registry', 'started', 'Refreshing plugin registry before startup')
      await options.refreshOpenClawPluginRegistry('gateway-startup').then((result) => {
        if (result.code === 0) {
          recordGatewayStartupEvent('registry', 'completed', 'Plugin registry refresh completed')
        } else {
          recordGatewayStartupEvent('registry', 'warning', `Plugin registry refresh exited ${result.code}`)
        }
      }).catch((error) => {
        log.warn('[plugins] registry refresh before gateway startup failed:', error)
        recordGatewayStartupEvent('registry', 'warning', `Plugin registry refresh failed: ${String(error)}`)
      })
      recordGatewayStartupEvent('spawned', 'started', 'Spawning Gateway process')
      const { pid } = await spawnGateway()
      recordGatewayStartupEvent('spawned', 'completed', `Gateway process spawned with pid ${pid}`, { pid })
      log.log(`[gateway] started with pid ${pid}`)
      options.pushGatewayLog('lifecycle', `started with pid ${pid}`)
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
            void ensureGatewayRunning()
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
    pauseAutoRestart()
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
          ? 'Run Doctor, inspect Gateway logs, then restart the Gateway from Monitor.'
          : 'Restart Gateway from Monitor and rerun Doctor if health does not recover.'
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
      uptimeMs: Number.isFinite(startedMs) && (healthy || processRunning) ? Date.now() - startedMs : 0,
      logs: options.getGatewayLogs().filter((entry) => options.isRuntimeMonitorEntryVisible(entry.timestamp)).slice(0, 80),
    }
  }

  async function tryRestartGatewayService(optionsArg: { force?: boolean; allowExternalTakeover?: boolean; reason?: string } = {}): Promise<{ restarted: boolean; detail: string }> {
    try {
      const logs: string[] = []
      const restartReason = optionsArg.reason || (optionsArg.force ? 'forced gateway restart' : 'gateway restart recovery')
      if (!optionsArg.force && await isGatewayHealthy()) {
        startGatewayHealthMonitor()
        recordGatewayRestartRequest(restartReason, 'skipped')
        return { restarted: true, detail: 'gateway already healthy' }
      }
      recordGatewayRestartRequest(restartReason, 'started')

      if (gatewayProcess) {
        try {
          await options.terminateProcessTree(gatewayProcess.pid, 'gateway restart', true)
        } catch {
          // The port release path below is authoritative.
        }
        gatewayProcess = null
        gatewayProcessOwnedByControlCenter = false
      } else {
        const listenerPid = await gatewayListenerPidForPort(options.gatewayHttpPort).catch(() => null)
        if (listenerPid && !optionsArg.allowExternalTakeover) {
          const externalDetail = `external gateway listener pid=${listenerPid} left running; manual restart can take over if needed`
          logs.push(`[gateway-external] ${externalDetail}`)
          startGatewayHealthMonitor()
          markGatewayRestartOutcome('skipped')
          return { restarted: false, detail: logs.join('\n') }
        }
      }

      const released = await options.tryReleaseGatewayPort()
      logs.push(`[gateway-port-release] ${released.released ? 'ok' : 'failed'} | ${released.detail}`)
      gatewayRestartCount = 0
      await ensureGatewayRunning()
      const restarted = await isGatewayHealthy()
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
    gatewayAutoRestartPaused = false
    actions.push('resumed gateway auto-start after plugin install repair')
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
    ensureGatewayRunning,
  }
}

export type GatewayLifecycleService = ReturnType<typeof createGatewayLifecycleService>

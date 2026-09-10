type SessionLockCleanupResult = {
  scanned: number
  removed: unknown[]
  errors: unknown[]
  skipped?: boolean
}

type SessionLockSweepOptions = {
  minIntervalMs?: number
  minAgeMs?: number
  quiet?: boolean
}

type SessionLockCleanupSummary = {
  scanned: number
  removed: number
  errors: number
}

export type RuntimeShutdownResult = {
  sessions: unknown
  terminatedRuns: unknown[]
  pluginSetupTerminals: number
  oauthCallbackServers: unknown
  gateway: unknown | null
  sessionLockCleanup: SessionLockCleanupSummary | null
}

export type RuntimeMonitorClearResult = {
  ok: true
  clearedAt: string
  cleared: Record<string, unknown>
  activeRuns: number
  sessionLockCleanup: SessionLockCleanupSummary
}

export type RuntimeRecoveryServiceOptions = {
  clearAgentTurnSessions: () => unknown
  clearBrowserProbeCache: () => void
  clearGatewayRuntimeMonitorHistory: () => Record<string, unknown>
  clearRecentOpenClawRuns: () => void
  clearShutdownPinnedTimers: () => void
  closeOAuthCallbackServersForProcessExit: (reason: string) => void
  closeOAuthCallbackServersForShutdown: (reason: string) => Promise<unknown>
  closeRuntimeLedger: () => void
  getActiveOpenClawRunCount: () => number
  getRecentOpenClawRunCount: () => number
  invalidateGatewayLedgerSnapshotCache: () => void
  invalidateRuntimeStatusCache: () => void
  markShuttingDown: () => void
  pauseGatewayAutoRestart: () => void
  persistAllMissionRecords: (reason: string) => Promise<unknown>
  pushGatewayLog: (stream: 'lifecycle', message: string, level?: string) => void
  setRuntimeMonitorClearedAtMs: (value: number) => void
  stopAllPluginSetupTerminalSessions: (reason: string) => number
  stopControlCenterGatewayClient: (reason: string) => void
  stopGateway: () => void
  stopGatewayHealthMonitor: () => void
  stopGatewayRuntime: (reason?: string) => Promise<unknown>
  stopMissionCronExpirySweep: () => void
  sweepOpenClawSessionLocks: (reason: string, options: SessionLockSweepOptions) => Promise<SessionLockCleanupResult>
  terminateAllOpenClawRuns: (reason: string) => void
  terminateAllOpenClawRunsNow: (reason: string) => Promise<unknown[]>
  writeRuntimeMonitorClearMarker: (clearedAt: Date) => Promise<void>
  now?: () => Date
}

export type RuntimeRecoveryService = ReturnType<typeof createRuntimeRecoveryService>

function cleanupSummary(result: SessionLockCleanupResult): SessionLockCleanupSummary {
  return {
    scanned: result.scanned,
    removed: result.removed.length,
    errors: result.errors.length,
  }
}

export function createRuntimeRecoveryService(options: RuntimeRecoveryServiceOptions) {
  const now = options.now ?? (() => new Date())
  let shutdownInFlight: Promise<RuntimeShutdownResult> | null = null

  async function clearRuntimeMonitor(): Promise<RuntimeMonitorClearResult> {
    const lockCleanup = await options.sweepOpenClawSessionLocks('monitor clear', {
      minIntervalMs: 0,
      minAgeMs: 0,
    })
    const clearedAt = now()
    const cleared = {
      ...options.clearGatewayRuntimeMonitorHistory(),
      recentRuns: options.getRecentOpenClawRunCount(),
    }
    options.setRuntimeMonitorClearedAtMs(clearedAt.getTime())
    options.invalidateGatewayLedgerSnapshotCache()
    options.invalidateRuntimeStatusCache()
    options.clearRecentOpenClawRuns()
    await options.writeRuntimeMonitorClearMarker(clearedAt)
    return {
      ok: true,
      clearedAt: clearedAt.toISOString(),
      cleared,
      activeRuns: options.getActiveOpenClawRunCount(),
      sessionLockCleanup: cleanupSummary(lockCleanup),
    }
  }

  async function shutdownControlCenterRuntime(reason = 'control center shutdown'): Promise<RuntimeShutdownResult> {
    if (shutdownInFlight) return shutdownInFlight
    shutdownInFlight = (async () => {
      options.markShuttingDown()
      options.pauseGatewayAutoRestart()
      options.clearShutdownPinnedTimers()
      options.stopGatewayHealthMonitor()
      options.stopMissionCronExpirySweep()
      // A failed save or one broken cleanup must not strand other resources.
      const attempt = async <T>(label: string, action: () => T | Promise<T>, fallback: T): Promise<T> => {
        try {
          return await action()
        } catch (error) {
          options.pushGatewayLog('lifecycle', `${reason}: ${label} warning: ${String(error)}`)
          return fallback
        }
      }
      await attempt('mission snapshot', () => options.persistAllMissionRecords(`${reason}:snapshot-before-shutdown`), null)
      const sessions = await attempt('session cleanup', () => options.clearAgentTurnSessions(), null)
      const terminatedRuns = await attempt('run termination', () => options.terminateAllOpenClawRunsNow(reason), [])
      await attempt('gateway client cleanup', () => options.stopControlCenterGatewayClient(reason), undefined)
      const pluginSetupTerminals = await attempt('plugin terminal cleanup', () => options.stopAllPluginSetupTerminalSessions(reason), 0)
      const oauthCallbackServers = await attempt('OAuth cleanup', () => options.closeOAuthCallbackServersForShutdown(reason), null)
      const gateway = await attempt('gateway shutdown', () => options.stopGatewayRuntime(reason), null)
      const lockCleanup = await attempt<SessionLockCleanupResult | null>('session lock cleanup', () => options.sweepOpenClawSessionLocks(reason, {
        minIntervalMs: 0,
        minAgeMs: 0,
      }), null)
      await attempt('browser cache cleanup', () => options.clearBrowserProbeCache(), undefined)
      await attempt('ledger close', () => options.closeRuntimeLedger(), undefined)
      return {
        sessions,
        terminatedRuns,
        pluginSetupTerminals,
        oauthCallbackServers,
        gateway,
        sessionLockCleanup: lockCleanup ? cleanupSummary(lockCleanup) : null,
      }
    })().finally(() => {
      shutdownInFlight = null
    })
    return shutdownInFlight
  }

  async function shutdownRuntime(reason = 'desktop quit') {
    const shutdown = await shutdownControlCenterRuntime(reason)
    return { ok: true, shutdown }
  }

  function processExitCleanup(reason: string): void {
    options.markShuttingDown()
    options.clearShutdownPinnedTimers()
    options.closeOAuthCallbackServersForProcessExit(reason)
    options.terminateAllOpenClawRuns(reason)
    options.stopGateway()
    options.stopGatewayHealthMonitor()
    options.stopMissionCronExpirySweep()
    options.closeRuntimeLedger()
  }

  return {
    clearRuntimeMonitor,
    shutdownControlCenterRuntime,
    shutdownRuntime,
    processExitCleanup,
  }
}

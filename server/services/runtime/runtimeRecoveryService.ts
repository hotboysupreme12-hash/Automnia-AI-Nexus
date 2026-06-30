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
      await options.persistAllMissionRecords(`${reason}:snapshot-before-shutdown`)
      const sessions = options.clearAgentTurnSessions()
      const terminatedRuns = await options.terminateAllOpenClawRunsNow(reason)
      options.stopControlCenterGatewayClient(reason)
      const pluginSetupTerminals = options.stopAllPluginSetupTerminalSessions(reason)
      const oauthCallbackServers = await options.closeOAuthCallbackServersForShutdown(reason)
      const gateway = await options.stopGatewayRuntime(reason).catch((error) => {
        options.pushGatewayLog('lifecycle', `${reason}: gateway shutdown warning: ${String(error)}`)
        return null
      })
      const lockCleanup = await options.sweepOpenClawSessionLocks(reason, {
        minIntervalMs: 0,
        minAgeMs: 0,
      }).catch((error) => {
        options.pushGatewayLog('lifecycle', `${reason}: session lock cleanup warning: ${String(error)}`)
        return null
      })
      options.clearBrowserProbeCache()
      options.closeRuntimeLedger()
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

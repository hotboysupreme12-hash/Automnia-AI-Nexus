import type { GatewayActivitySummary, GatewayLogEntry } from '../gateway/gatewayLogService'
import type { RuntimeRecoveryService } from './runtimeRecoveryService'

export type RuntimeSessionCloseInput = {
  agentId?: string
  sessionId?: string
  sessionKey?: string
  all?: boolean
}

type GatewayStatusSnapshot = Record<string, unknown> & {
  healthy?: boolean
  processRunning?: boolean
}

type SessionLockCleanupResult = {
  scanned: number
  removed: unknown[]
  errors: unknown[]
  skipped?: boolean
}

export type RuntimeActionServiceOptions = {
  abortGatewayRuntimeSessionsForClose: (input: RuntimeSessionCloseInput) => Promise<unknown>
  abortStaleGatewayChatWaiters: (minAgeMs: number, reason: string) => Record<string, unknown>
  cleanupOpenClawSessionLocks: (options: {
    agentId?: string
    sessionId?: string
    all?: boolean
    minAgeMs?: number
    reason?: string
    quiet?: boolean
  }) => Promise<SessionLockCleanupResult>
  closeRuntimeSessions: (input: RuntimeSessionCloseInput) => Record<string, unknown>
  ensureGatewayRunning: () => Promise<void>
  gatewayHttpPort: number
  gatewayListenerPidForPort: (port: number) => Promise<number | null>
  gatewayStatusSnapshot: (healthy: boolean, listenerPid?: number | null) => GatewayStatusSnapshot
  invalidateRuntimeStatusCache: () => void
  isGatewayHealthy: () => Promise<boolean>
  openAgentSessionSnapshots: (gatewayActivity?: GatewayActivitySummary) => Promise<unknown[]>
  readExternalChannelActivityEntries: () => Promise<GatewayLogEntry[]>
  readExternalGatewayLogEntries: () => Promise<GatewayLogEntry[]>
  runtimeRecovery: Pick<RuntimeRecoveryService, 'clearRuntimeMonitor' | 'shutdownRuntime'>
  scheduleOpenClawSessionLockSweep: (reason: string) => void
  startGatewayHealthMonitor: () => void
  stopGatewayRuntime: (reason?: string) => Promise<unknown>
  summarizeGatewayActivity: (entries: GatewayLogEntry[]) => GatewayActivitySummary
  tryRestartGatewayService: (options: { force?: boolean; allowExternalTakeover?: boolean; reason?: string }) => Promise<unknown>
}

export type RuntimeActionService = ReturnType<typeof createRuntimeActionService>

function cleanupSummary(result: SessionLockCleanupResult) {
  return {
    scanned: result.scanned,
    removed: result.removed.length,
    errors: result.errors.length,
  }
}

export function createRuntimeActionService(options: RuntimeActionServiceOptions) {
  async function gatewayStatusAfterAction(listenerOnlyWhenHealthy: boolean) {
    const gatewayHealthy = await options.isGatewayHealthy()
    const listenerPid = listenerOnlyWhenHealthy && !gatewayHealthy
      ? null
      : await options.gatewayListenerPidForPort(options.gatewayHttpPort)
    return options.gatewayStatusSnapshot(gatewayHealthy, listenerPid)
  }

  async function closeRuntimeSession(input: RuntimeSessionCloseInput) {
    const result = options.closeRuntimeSessions(input)
    const gatewayAborts = await options.abortGatewayRuntimeSessionsForClose(input)
    const lockCleanup = await options.cleanupOpenClawSessionLocks({
      agentId: input.agentId,
      sessionId: input.sessionId,
      all: input.all,
      minAgeMs: 0,
      reason: 'runtime session close',
    })
    options.scheduleOpenClawSessionLockSweep('runtime session close follow-up')
    const [externalGatewayLogs, externalChannelActivityLogs] = await Promise.all([
      options.readExternalGatewayLogEntries(),
      options.readExternalChannelActivityEntries(),
    ])
    const activity = options.summarizeGatewayActivity([...externalGatewayLogs, ...externalChannelActivityLogs])
    return {
      ok: true,
      ...result,
      gatewayAborts,
      sessionLockCleanup: cleanupSummary(lockCleanup),
      sessions: await options.openAgentSessionSnapshots(activity),
    }
  }

  function abortStaleGatewayChat(minAgeMs: number) {
    const result = options.abortStaleGatewayChatWaiters(minAgeMs, 'operator stale-turn recovery')
    options.invalidateRuntimeStatusCache()
    return { ok: true, ...result }
  }

  async function clearRuntimeMonitor() {
    return options.runtimeRecovery.clearRuntimeMonitor()
  }

  async function shutdownRuntime() {
    return options.runtimeRecovery.shutdownRuntime('desktop quit')
  }

  async function stopGateway() {
    const stop = await options.stopGatewayRuntime('manual gateway stop requested')
    options.invalidateRuntimeStatusCache()
    const gateway = await gatewayStatusAfterAction(true)
    return { ok: true, stop, gateway }
  }

  async function startGateway() {
    await options.ensureGatewayRunning()
    options.startGatewayHealthMonitor()
    options.invalidateRuntimeStatusCache()
    const gateway = await gatewayStatusAfterAction(false)
    return {
      ok: true,
      start: {
        started: gateway.healthy || gateway.processRunning,
        detail: gateway.healthy ? 'gateway healthy' : gateway.processRunning ? 'gateway process running' : 'gateway start requested',
      },
      gateway,
    }
  }

  async function restartGateway() {
    const restart = await options.tryRestartGatewayService({
      force: true,
      allowExternalTakeover: true,
      reason: 'manual gateway restart requested',
    })
    options.invalidateRuntimeStatusCache()
    const gateway = await gatewayStatusAfterAction(true)
    return { ok: true, restart, gateway }
  }

  return {
    closeRuntimeSession,
    abortStaleGatewayChat,
    clearRuntimeMonitor,
    shutdownRuntime,
    stopGateway,
    startGateway,
    restartGateway,
  }
}

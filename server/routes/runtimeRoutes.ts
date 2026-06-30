import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type RuntimeSessionCloseInput = {
  agentId?: string
  sessionId?: string
  sessionKey?: string
  all?: boolean
}

type GatewayChannelDirection = 'inbound' | 'outbound' | 'system'

type GatewayLogEntry = {
  id: number
  timestamp: string
  stream: 'stdout' | 'stderr' | 'lifecycle' | 'gateway' | 'channel'
  message: string
  level?: string
  source?: string
  channel?: string
  direction?: GatewayChannelDirection
}

type GatewayChannelActivity = {
  id: number
  timestamp: string
  channel: string
  direction: GatewayChannelDirection
  message: string
  level?: string
  source?: string
  agentId?: string
}

type GatewayActivitySummary = {
  active: boolean
  lastEventAt: string | null
  sourcePath: string | null
  inboundCount: number
  outboundCount: number
  systemCount: number
  events: GatewayChannelActivity[]
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

type RuntimeRoutesOptions = {
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
  clearRuntimeMonitorHistory: (clearedAt?: Date) => Record<string, unknown>
  closeRuntimeSessions: (input: RuntimeSessionCloseInput) => Record<string, unknown>
  ensureGatewayRunning: () => Promise<void>
  gatewayHttpPort: number
  gatewayListenerPidForPort: (port: number) => Promise<number | null>
  gatewayStatusSnapshot: (healthy: boolean, listenerPid?: number | null) => GatewayStatusSnapshot
  getRuntimeStatusPayload: (forcePluginRefresh: boolean) => Promise<Record<string, unknown>>
  getRuntimeSummaryPayload: (forceRefresh: boolean) => Promise<Record<string, unknown>>
  invalidateRuntimeStatusCache: () => void
  isGatewayHealthy: () => Promise<boolean>
  isValidAgentId: (agentId: string) => boolean
  openAgentSessionSnapshots: (gatewayActivity?: GatewayActivitySummary) => Promise<unknown>
  readExternalChannelActivityEntries: () => Promise<GatewayLogEntry[]>
  readExternalGatewayLogEntries: () => Promise<GatewayLogEntry[]>
  scheduleOpenClawSessionLockSweep: (reason: string) => void
  shutdownControlCenterRuntime: (reason?: string) => Promise<unknown>
  startGatewayHealthMonitor: () => void
  stopGatewayRuntime: (reason?: string) => Promise<unknown>
  summarizeGatewayActivity: (entries: GatewayLogEntry[]) => GatewayActivitySummary
  sweepOpenClawSessionLocks: (
    reason: string,
    options: { minIntervalMs?: number; minAgeMs?: number; quiet?: boolean },
  ) => Promise<SessionLockCleanupResult>
  tryRestartGatewayService: (options: { force?: boolean; allowExternalTakeover?: boolean; reason?: string }) => Promise<unknown>
  writeRuntimeMonitorClearMarker: (clearedAt: Date) => Promise<void>
}

const RuntimeSessionCloseSchema = z.object({
  agentId: z.string().trim().min(1).max(120).optional(),
  sessionId: z.string().trim().min(1).max(240).optional(),
  sessionKey: z.string().trim().min(1).max(512).optional(),
  all: z.boolean().optional().default(false),
}).refine((value) => value.all || Boolean(value.agentId || value.sessionId || value.sessionKey), {
  message: 'Provide agentId, sessionId, sessionKey, or all=true.',
})

const RuntimeGatewayChatAbortStaleSchema = z.object({
  minAgeMs: z.number().int().min(30_000).max(24 * 60 * 60_000).optional().default(5 * 60_000),
})

export function registerRuntimeRoutes(app: Express, options: RuntimeRoutesOptions) {
  app.post('/api/openclaw/runtime/session/close', async (req, res) => {
    const parsed = RuntimeSessionCloseSchema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const { agentId, sessionId, sessionKey, all } = parsed.data
    if (agentId && !options.isValidAgentId(agentId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    }

    try {
      const result = options.closeRuntimeSessions({ agentId, sessionId, sessionKey, all })
      const gatewayAborts = await options.abortGatewayRuntimeSessionsForClose({ agentId, sessionId, sessionKey, all })
      const lockCleanup = await options.cleanupOpenClawSessionLocks({
        agentId,
        sessionId,
        all,
        minAgeMs: 0,
        reason: 'runtime session close',
      })
      options.scheduleOpenClawSessionLockSweep('runtime session close follow-up')
      const [externalGatewayLogs, externalChannelActivityLogs] = await Promise.all([
        options.readExternalGatewayLogEntries(),
        options.readExternalChannelActivityEntries(),
      ])
      const activity = options.summarizeGatewayActivity([...externalGatewayLogs, ...externalChannelActivityLogs])
      return apiSuccess(res, {
        ok: true,
        ...result,
        gatewayAborts,
        sessionLockCleanup: {
          scanned: lockCleanup.scanned,
          removed: lockCleanup.removed.length,
          errors: lockCleanup.errors.length,
        },
        sessions: await options.openAgentSessionSnapshots(activity),
      })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to close runtime session', String(error))
    }
  })

  app.post('/api/openclaw/runtime/chat/abort-stale', async (req, res) => {
    const parsed = RuntimeGatewayChatAbortStaleSchema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = options.abortStaleGatewayChatWaiters(parsed.data.minAgeMs, 'operator stale-turn recovery')
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, { ok: true, ...result })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to abort stale gateway chat turns', String(error))
    }
  })

  app.post('/api/openclaw/runtime/monitor/clear', async (_req, res) => {
    try {
      const lockCleanup = await options.sweepOpenClawSessionLocks('monitor clear', { minIntervalMs: 0, minAgeMs: 0 })
      const clearedAt = new Date()
      const cleared = options.clearRuntimeMonitorHistory(clearedAt)
      await options.writeRuntimeMonitorClearMarker(clearedAt)
      return apiSuccess(res, {
        ok: true,
        ...cleared,
        sessionLockCleanup: {
          scanned: lockCleanup.scanned,
          removed: lockCleanup.removed.length,
          errors: lockCleanup.errors.length,
        },
      })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to clear runtime monitor', String(error))
    }
  })

  app.post('/api/openclaw/runtime/shutdown', async (_req, res) => {
    try {
      const shutdown = await options.shutdownControlCenterRuntime('desktop quit')
      return apiSuccess(res, { ok: true, shutdown })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to shut down runtime processes', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/stop', async (_req, res) => {
    try {
      const stop = await options.stopGatewayRuntime('manual stop requested from monitor')
      options.invalidateRuntimeStatusCache()
      const gatewayHealthy = await options.isGatewayHealthy()
      const listenerPid = gatewayHealthy ? await options.gatewayListenerPidForPort(options.gatewayHttpPort) : null
      const gateway = options.gatewayStatusSnapshot(gatewayHealthy, listenerPid)
      return apiSuccess(res, {
        ok: true,
        stop,
        gateway,
      })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to stop gateway', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/start', async (_req, res) => {
    try {
      await options.ensureGatewayRunning()
      options.startGatewayHealthMonitor()
      options.invalidateRuntimeStatusCache()
      const gatewayHealthy = await options.isGatewayHealthy()
      const listenerPid = await options.gatewayListenerPidForPort(options.gatewayHttpPort)
      const gateway = options.gatewayStatusSnapshot(gatewayHealthy, listenerPid)
      return apiSuccess(res, {
        ok: true,
        start: {
          started: gateway.healthy || gateway.processRunning,
          detail: gateway.healthy ? 'gateway healthy' : gateway.processRunning ? 'gateway process running' : 'gateway start requested',
        },
        gateway,
      })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to start gateway', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/restart', async (_req, res) => {
    try {
      const restart = await options.tryRestartGatewayService({
        force: true,
        allowExternalTakeover: true,
        reason: 'manual restart requested from monitor',
      })
      options.invalidateRuntimeStatusCache()
      const gatewayHealthy = await options.isGatewayHealthy()
      const listenerPid = gatewayHealthy ? await options.gatewayListenerPidForPort(options.gatewayHttpPort) : null
      const gateway = options.gatewayStatusSnapshot(gatewayHealthy, listenerPid)
      return apiSuccess(res, {
        ok: true,
        restart,
        gateway,
      })
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to restart gateway', String(error))
    }
  })

  app.get('/api/openclaw/runtime/status', async (req, res) => {
    try {
      const forcePluginRefresh = req.query.refresh === '1' || req.query.refresh === 'true'
      return apiSuccess(res, await options.getRuntimeStatusPayload(forcePluginRefresh))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_status_failed', 'Failed to fetch runtime status', String(error))
    }
  })

  app.get('/api/openclaw/runtime/summary', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true'
      return apiSuccess(res, await options.getRuntimeSummaryPayload(forceRefresh))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_summary_failed', 'Failed to fetch runtime summary', String(error))
    }
  })
}

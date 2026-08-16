import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { RuntimeActionService } from '../services/runtime/runtimeActionService'
import type { GatewayActivityFeed } from '../services/runtime/gatewayActivityFeedService'

type RuntimeRoutesOptions = {
  getRuntimeStatusPayload: (forcePluginRefresh: boolean) => Promise<Record<string, unknown>>
  getRuntimeSummaryPayload: (forceRefresh: boolean) => Promise<Record<string, unknown>>
  getGatewayActivityFeed: (limit?: number) => Promise<GatewayActivityFeed>
  isValidAgentId: (agentId: string) => boolean
  runtimeActions: RuntimeActionService
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

const RuntimeRunAbortSchema = z.object({
  runId: z.string().trim().min(1).max(160),
})

const RuntimeActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(48),
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
      return apiSuccess(res, await options.runtimeActions.closeRuntimeSession({ agentId, sessionId, sessionKey, all }))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to close runtime session', String(error))
    }
  })

  app.post('/api/openclaw/runtime/chat/abort-stale', async (req, res) => {
    const parsed = RuntimeGatewayChatAbortStaleSchema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      return apiSuccess(res, options.runtimeActions.abortStaleGatewayChat(parsed.data.minAgeMs))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to abort stale gateway chat turns', String(error))
    }
  })

  app.post('/api/openclaw/runtime/run/abort', async (req, res) => {
    const parsed = RuntimeRunAbortSchema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      return apiSuccess(res, await options.runtimeActions.abortOpenClawRun(parsed.data.runId))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to stop the active runtime run', String(error))
    }
  })

  app.post('/api/openclaw/runtime/monitor/clear', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runtimeActions.clearRuntimeMonitor())
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to clear runtime monitor', String(error))
    }
  })

  app.post('/api/openclaw/runtime/shutdown', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runtimeActions.shutdownRuntime())
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to shut down runtime processes', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/stop', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runtimeActions.stopGateway())
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to stop gateway', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/start', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runtimeActions.startGateway())
    } catch (error) {
      return apiFailure(res, 500, 'runtime_action_failed', 'Failed to start gateway', String(error))
    }
  })

  app.post('/api/openclaw/runtime/gateway/restart', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runtimeActions.restartGateway())
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

  app.get('/api/openclaw/runtime/activity', async (req, res) => {
    const parsed = RuntimeActivityQuerySchema.safeParse(req.query)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid activity query', parsed.error.flatten())

    try {
      return apiSuccess(res, await options.getGatewayActivityFeed(parsed.data.limit))
    } catch (error) {
      return apiFailure(res, 500, 'runtime_activity_failed', 'Failed to fetch Gateway activity', String(error))
    }
  })
}

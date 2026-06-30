import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { MissionLifecycleEvent, MissionStateService } from '../services/missions/missionStateService'
import type { BackendMissionReport, MissionLifecycleProjection } from '../services/missions/missionReportService'

type MissionRoutesOptions = {
  buildMissionLifecycleProjection: (options?: {
    missionId?: string | null
    missionLimit?: number
    eventLimit?: number
    feedLimit?: number
    reportLimit?: number
  }) => Promise<MissionLifecycleProjection>
  listMissionReports: (limit?: number) => Promise<BackendMissionReport[]>
  missionStateService: Pick<MissionStateService, 'startMission' | 'stopMission'>
  readMissionEvents: (limit: number) => Promise<MissionLifecycleEvent[]>
}

export function registerMissionRoutes(app: Express, options: MissionRoutesOptions) {
  app.get('/api/missions', async (_req, res) => {
    return apiSuccess(res, await options.buildMissionLifecycleProjection({
      missionLimit: 500,
      eventLimit: 300,
      feedLimit: 120,
      reportLimit: 80,
    }))
  })

  app.get('/api/missions/projection', async (_req, res) => {
    return apiSuccess(res, await options.buildMissionLifecycleProjection({
      missionLimit: 500,
      eventLimit: 500,
      feedLimit: 120,
      reportLimit: 80,
    }))
  })

  app.get('/api/missions/:missionId/lifecycle', async (req, res) => {
    const missionId = req.params.missionId?.trim()
    if (!missionId) return apiFailure(res, 400, 'invalid_payload', 'Mission id is required')
    const projection = await options.buildMissionLifecycleProjection({
      missionId,
      missionLimit: 1000,
      eventLimit: 1000,
      feedLimit: 200,
      reportLimit: 200,
    })
    if (!projection.missions.length && !projection.events.length && !projection.reports.length) {
      return apiFailure(res, 404, 'mission_not_found', 'Mission lifecycle not found')
    }
    return apiSuccess(res, {
      missionId,
      ...projection,
      mission: projection.missions[0] || null,
      report: projection.reports[0] || null,
    })
  })

  app.get('/api/missions/:missionId/events', async (req, res) => {
    const missionId = req.params.missionId?.trim()
    if (!missionId) return apiFailure(res, 400, 'invalid_payload', 'Mission id is required')
    const events = await options.readMissionEvents(1000)
    return apiSuccess(res, { missionId, events: events.filter((event) => event.missionId === missionId) })
  })

  app.get('/api/missions/:missionId/report', async (req, res) => {
    const missionId = req.params.missionId?.trim()
    if (!missionId) return apiFailure(res, 400, 'invalid_payload', 'Mission id is required')
    const reports = await options.listMissionReports(200)
    const report = reports.find((entry) => entry.missionId === missionId) || null
    if (!report) return apiFailure(res, 404, 'mission_report_not_found', 'Mission report not found')
    return apiSuccess(res, { missionId, report })
  })

  app.post('/api/missions/start', async (req, res) => {
    const schema = z.object({
      title: z.string().min(1).max(120),
      brief: z.string().min(1).max(2000),
      party: z.array(z.string().min(1)).min(1).max(8),
      mode: z.enum(['instant', 'hours', 'days', 'weeks', 'continuous', 'indefinite']),
      amount: z.number().int().min(1).max(52).nullable().optional(),
      missionType: z.string().min(1).max(80).optional(),
      collaborationMode: z.string().min(1).max(80).optional(),
      complexity: z.number().int().min(0).max(100).optional(),
      riskTolerance: z.number().int().min(0).max(100).optional(),
      cadenceSeconds: z.number().int().min(15).max(24 * 60 * 60).optional(),
      maxCycles: z.number().int().min(1).max(1000).nullable().optional(),
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const result = await options.missionStateService.startMission(parsed.data)
    if (!result.ok) return apiFailure(res, result.status, result.code, result.message, result.detail)
    return apiSuccess(res, {
      deduped: result.deduped,
      idempotencyKey: result.idempotencyKey,
      mission: result.mission,
    })
  })

  app.post('/api/missions/stop', async (req, res) => {
    const schema = z.object({
      missionId: z.string().min(1),
      reason: z.string().trim().max(300).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const result = await options.missionStateService.stopMission(parsed.data)
    if (!result.ok) return apiFailure(res, result.status, result.code, result.message, result.detail)
    return apiSuccess(res, { mission: result.mission, cleanup: result.cleanup })
  })
}

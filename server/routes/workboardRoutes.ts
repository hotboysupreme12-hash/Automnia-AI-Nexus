import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { WorkboardServiceError, type WorkboardService } from '../services/workboardService'

type WorkboardRoutesOptions = {
  workboard: WorkboardService
  isMissionKnown?: (missionId: string) => boolean
}

function sendWorkboardError(res: Parameters<typeof apiFailure>[0], error: unknown) {
  if (error instanceof WorkboardServiceError) return apiFailure(res, error.status, error.code, error.message)
  return apiFailure(res, 500, 'workboard_failed', 'Workboard request failed.')
}

const evidenceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  uri: z.string().trim().min(1).max(2048).refine((value) => {
    if (value.startsWith('/api/files/')) return !value.includes('..')
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  }, 'Evidence must be an HTTP(S) URL or an Automnia file link.'),
})

export function registerWorkboardRoutes(app: Express, options: WorkboardRoutesOptions) {
  app.get('/api/workboard/tasks', async (_req, res) => {
    try { return apiSuccess(res, { tasks: await options.workboard.listTasks() }) }
    catch (error) { return sendWorkboardError(res, error) }
  })

  app.post('/api/workboard/tasks', async (req, res) => {
    const parsed = z.object({
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().max(4000).optional(),
      missionId: z.string().trim().min(1).max(160).nullable().optional(),
      assignedAgentId: z.string().trim().min(1).max(160).nullable().optional(),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid workboard task.', parsed.error.flatten())
    const missionId = parsed.data.missionId || null
    if (missionId && options.isMissionKnown && !options.isMissionKnown(missionId)) return apiFailure(res, 404, 'mission_not_found', 'Selected Automnia mission was not found.')
    try { return apiSuccess(res, { task: await options.workboard.createTask({ ...parsed.data, missionId }) }) }
    catch (error) { return sendWorkboardError(res, error) }
  })

  app.patch('/api/workboard/tasks/:taskId', async (req, res) => {
    const parsed = z.object({
      status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
      assignedAgentId: z.string().trim().min(1).max(160).nullable().optional(),
      dependsOn: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    }).refine((value) => Object.keys(value).length > 0, 'At least one task field is required.').safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid workboard task update.', parsed.error.flatten())
    try { return apiSuccess(res, { task: await options.workboard.updateTask(req.params.taskId, parsed.data) }) }
    catch (error) { return sendWorkboardError(res, error) }
  })

  app.post('/api/workboard/tasks/:taskId/comments', async (req, res) => {
    const parsed = z.object({
      body: z.string().trim().min(1).max(4000),
      evidence: z.array(evidenceSchema).max(10).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid workboard comment.', parsed.error.flatten())
    try { return apiSuccess(res, { comment: await options.workboard.addComment(req.params.taskId, { ...parsed.data, actor: 'operator' }) }) }
    catch (error) { return sendWorkboardError(res, error) }
  })
}

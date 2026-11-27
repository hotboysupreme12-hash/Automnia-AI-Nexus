import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import {
  MAX_WORKBOARD_LEASE_TTL_MS,
  MIN_WORKBOARD_LEASE_TTL_MS,
  WORKBOARD_EXECUTION_STATES,
  WorkboardServiceError,
  type WorkboardService,
} from '../services/workboardService'

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

const claimedFilesSchema = z.array(z.string().trim().min(1).max(320)).max(50)
const dependsOnSchema = z.array(z.string().trim().min(1).max(160)).max(50)
const leaseTtlMsSchema = z.number().int().min(MIN_WORKBOARD_LEASE_TTL_MS).max(MAX_WORKBOARD_LEASE_TTL_MS)
const executionStateSchema = z.enum(WORKBOARD_EXECUTION_STATES)

const waitingDependencySchema = z.object({
  dependencyTaskId: z.string().trim().min(1).max(160),
  responsibleAgentId: z.string().trim().min(1).max(160).nullable().optional(),
  deliverable: z.string().trim().min(1).max(500),
  nextCheckAt: z.string().trim().min(1).max(80).nullable().optional(),
  fallbackTask: z.string().trim().min(1).max(500).nullable().optional(),
})

const handoffSchema = z.object({
  fromAgentId: z.string().trim().min(1).max(160),
  toAgentId: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2000),
  filesModified: claimedFilesSchema.optional(),
  testsExecuted: z.string().trim().max(1000).optional(),
  knownFailures: z.string().trim().max(1000).optional(),
  nextAction: z.string().trim().min(1).max(1000),
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
      leaseOwnerAgentId: z.string().trim().min(1).max(160).nullable().optional(),
      leaseTtlMs: leaseTtlMsSchema.optional(),
      claimedFiles: claimedFilesSchema.optional(),
      dependsOn: dependsOnSchema.optional(),
      executionState: executionStateSchema.optional(),
      waitingDependency: waitingDependencySchema.nullable().optional(),
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
      executionState: executionStateSchema.optional(),
      assignedAgentId: z.string().trim().min(1).max(160).nullable().optional(),
      leaseOwnerAgentId: z.string().trim().min(1).max(160).nullable().optional(),
      leaseTtlMs: leaseTtlMsSchema.optional(),
      heartbeat: z.boolean().optional(),
      actorAgentId: z.string().trim().min(1).max(160).nullable().optional(),
      forceTakeover: z.boolean().optional(),
      claimedFiles: claimedFilesSchema.optional(),
      dependsOn: dependsOnSchema.optional(),
      waitingDependency: waitingDependencySchema.nullable().optional(),
      handoff: handoffSchema.nullable().optional(),
      acknowledgeHandoff: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, 'At least one task field is required.').safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid workboard task update.', parsed.error.flatten())
    try { return apiSuccess(res, { task: await options.workboard.updateTask(req.params.taskId, parsed.data) }) }
    catch (error) { return sendWorkboardError(res, error) }
  })

  app.post('/api/workboard/tasks/:taskId/comments', async (req, res) => {
    const parsed = z.object({
      body: z.string().trim().min(1).max(4000),
      actor: z.string().trim().min(1).max(120).optional(),
      evidence: z.array(evidenceSchema).max(10).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid workboard comment.', parsed.error.flatten())
    try {
      return apiSuccess(res, {
        comment: await options.workboard.addComment(req.params.taskId, {
          ...parsed.data,
          actor: parsed.data.actor || 'operator',
        }),
      })
    }
    catch (error) { return sendWorkboardError(res, error) }
  })
}

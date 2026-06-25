import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { computeShiftDurationMinutes } from '../shiftContracts'
import type {
  HeartbeatRuntimeDefaults,
  RuntimeCronJobSummary,
  Shift,
  StartShiftPayload,
} from '../shiftContracts'

type OpenClawCommandResult = {
  stdout: string
  stderr: string
  code: number
}

type HeartbeatRuntimePerAgentStore = Record<string, Partial<HeartbeatRuntimeDefaults>>

type ShiftRoutesOptions = {
  activeShifts: Map<string, Shift>
  clearShiftRuntimeState: (shift: Shift) => void
  createShiftFromPayload: (input: StartShiftPayload) => Promise<Shift>
  invalidateRuntimeStatusCache: () => void
  isValidAgentId: (agentId: string) => boolean
  listActiveCronJobViews: () => { active: RuntimeCronJobSummary[]; error?: string }
  mergeHeartbeatRuntimeDefaults: (
    base: HeartbeatRuntimeDefaults,
    patch?: Partial<HeartbeatRuntimeDefaults>,
  ) => HeartbeatRuntimeDefaults
  readHeartbeatRuntimeDefaults: () => Promise<HeartbeatRuntimeDefaults>
  readHeartbeatRuntimePerAgent: () => Promise<HeartbeatRuntimePerAgentStore>
  runOpenClaw: (args: string[], timeoutMs?: number) => Promise<OpenClawCommandResult>
  startManagedTeamSyncOrchestrator: (input: {
    batchId: string
    runId: string
    targetFile: string
    leadAgent: string
    shifts: Shift[]
    durationMinutes: number
    leadEvery: string
    workerEvery: string
  }) => Promise<void>
  sweepExpiredMissionCronJobs: (reason: string) => Promise<unknown>
  writeHeartbeatRuntimeDefaults: (defaults: HeartbeatRuntimeDefaults) => Promise<void>
  writeHeartbeatRuntimePerAgent: (store: HeartbeatRuntimePerAgentStore) => Promise<void>
}

function isValidCronJobId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,180}$/.test(value)
}

function normalizeCronEveryEditInput(value: string): string | null {
  const clean = value.trim().toLowerCase().replace(/^every\s+/, '').replace(/\s+/g, ' ')
  const compact = clean.replace(/\s+/g, '')
  if (/^\d+[smhdw]$/.test(compact)) return compact
  const match = clean.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/)
  if (!match) return null
  const unit = match[2]
  const normalizedUnit = unit.startsWith('s') ? 's' : unit.startsWith('m') ? 'm' : unit.startsWith('h') ? 'h' : unit.startsWith('d') ? 'd' : 'w'
  return `${match[1]}${normalizedUnit}`
}

export function registerShiftRoutes(app: Express, options: ShiftRoutesOptions) {
  const {
    activeShifts,
    clearShiftRuntimeState,
    createShiftFromPayload,
    invalidateRuntimeStatusCache,
    isValidAgentId,
    listActiveCronJobViews,
    mergeHeartbeatRuntimeDefaults,
    readHeartbeatRuntimeDefaults,
    readHeartbeatRuntimePerAgent,
    runOpenClaw,
    startManagedTeamSyncOrchestrator,
    sweepExpiredMissionCronJobs,
    writeHeartbeatRuntimeDefaults,
    writeHeartbeatRuntimePerAgent,
  } = options

  const updateActiveShiftFromCronEdit = (
    shift: Shift | undefined,
    patch: { name?: string; scheduleKind?: 'every' | 'cron' | 'at'; schedule?: string; message?: string },
  ) => {
    if (!shift) return
    const next: Shift = {
      ...shift,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.schedule ? { every: patch.schedule } : {}),
      ...(patch.message ? { message: patch.message } : {}),
    }
    activeShifts.set(shift.id, next)
  }

  app.post('/api/shifts/start', async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(80),
      agent: z.string().min(1).optional(),
      every: z.string().regex(/^\d+[smhdw]$/),
      durationMinutes: z.number().int().min(1).max(10080).optional(),
      durationValue: z.number().int().min(1).max(10080).optional(),
      durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks']).optional(),
      message: z.string().min(5),
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    if (parsed.data.agent && !isValidAgentId(parsed.data.agent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')
    }

    try {
      const shift = await createShiftFromPayload(parsed.data)
      return apiSuccess(res, { shift })
    } catch (error) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to create shift', String(error))
    }
  })

  app.post('/api/shifts/start-batch', async (req, res) => {
    const schema = z.object({
      namePrefix: z.string().min(1).max(80).optional(),
      agentIds: z.array(z.string().min(1)).min(1).max(20),
      leadAgent: z.string().min(1).optional(),
      every: z.string().regex(/^\d+[smhdw]$/),
      leadEvery: z.string().regex(/^\d+[smhdw]$/).optional(),
      workerEvery: z.string().regex(/^\d+[smhdw]$/).optional(),
      durationMinutes: z.number().int().min(1).max(10080).optional(),
      durationValue: z.number().int().min(1).max(10080).optional(),
      durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks']).optional(),
      message: z.string().min(5).optional(),
      leadMessage: z.string().min(5).optional(),
      workerMessage: z.string().min(5).optional(),
      model: z.string().min(3).max(160).optional(),
      leadModel: z.string().min(3).max(160).optional(),
      workerModel: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      leadSession: z.enum(['main', 'isolated']).optional(),
      workerSession: z.enum(['main', 'isolated']).optional(),
      managedTeamSync: z.boolean().optional(),
      runId: z.string().min(3).max(160).optional(),
      targetFile: z.string().min(1).max(260).optional(),
      announce: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    const uniqueAgents = Array.from(new Set(payload.agentIds.map((agentId) => agentId.trim()).filter(Boolean)))
    if (!uniqueAgents.length) return apiFailure(res, 400, 'invalid_payload', 'No valid agent ids supplied')
    const invalidAgent = uniqueAgents.find((agentId) => !isValidAgentId(agentId))
    if (invalidAgent) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id', { agentId: invalidAgent })

    const requestedLeadAgent = payload.leadAgent?.trim()
    if (requestedLeadAgent && !isValidAgentId(requestedLeadAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid lead agent id')
    }
    if (requestedLeadAgent && !uniqueAgents.includes(requestedLeadAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Lead agent must be included in agentIds')
    }

    const leadAgent = requestedLeadAgent || uniqueAgents[0]
    const defaultsMessage = payload.message || 'Read TEAM_SYNC.md, execute one concrete assigned task, and update status.'
    const namePrefix = payload.namePrefix?.trim() || 'Heartbeat'
    const leadEvery = payload.leadEvery || payload.every
    const workerEvery = payload.workerEvery || payload.every
    const leadSession = payload.leadSession || payload.session || 'main'
    const workerSession = payload.workerSession || 'isolated'
    const leadModel = payload.leadModel || payload.model
    const workerModel = payload.workerModel || payload.model

    const shifts: Shift[] = []
    const errors: Array<{ agentId: string; error: string }> = []

    for (const agentId of uniqueAgents) {
      const isLead = agentId === leadAgent
      const roleMessage = isLead ? payload.leadMessage || defaultsMessage : payload.workerMessage || defaultsMessage
      const shiftName = `${namePrefix}-${agentId}`.slice(0, 80)
      try {
        const shift = await createShiftFromPayload({
          name: shiftName,
          agent: agentId,
          every: isLead ? leadEvery : workerEvery,
          durationMinutes: payload.durationMinutes,
          durationValue: payload.durationValue,
          durationUnit: payload.durationUnit,
          message: roleMessage,
          model: isLead ? leadModel : workerModel,
          thinking: payload.thinking,
          timeoutSeconds: payload.timeoutSeconds,
          wake: payload.wake,
          session: isLead ? leadSession : workerSession,
          announce: payload.announce,
        })
        shifts.push(shift)
      } catch (error) {
        errors.push({ agentId, error: String(error) })
      }
    }

    const batchId = randomUUID()
    const managedEnabled = payload.managedTeamSync === true
    const effectiveRunId = (payload.runId || '').trim() || `batch-${Date.now()}`
    const targetFile = (payload.targetFile || 'collab-site-7m.html').trim()
    if (managedEnabled && shifts.length) {
      await startManagedTeamSyncOrchestrator({
        batchId,
        runId: effectiveRunId,
        targetFile,
        leadAgent,
        shifts,
        durationMinutes: computeShiftDurationMinutes(payload),
        leadEvery,
        workerEvery,
      }).catch(() => undefined)
    }

    const batchPayload = {
      batchId,
      managedTeamSync: managedEnabled,
      runId: effectiveRunId,
      leadAgent,
      startedCount: shifts.length,
      failedCount: errors.length,
      shifts,
      errors,
    }
    if (!shifts.length) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to start team workflow', batchPayload)
    }
    return apiSuccess(res, batchPayload)
  })

  app.post('/api/shifts/stop', async (req, res) => {
    const schema = z.object({ shiftId: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const shift = activeShifts.get(parsed.data.shiftId)
    const cronId = shift?.cronId || parsed.data.shiftId.replace(/^cron:/, '').trim()
    if (!isValidCronJobId(cronId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid cron job id')
    }

    try {
      const result = await runOpenClaw(['cron', 'disable', cronId], 45000)
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'Failed to disable cron job')
      }
      if (shift) {
        clearShiftRuntimeState(shift)
      } else {
        const matchingShift = Array.from(activeShifts.values()).find((entry) => entry.cronId === cronId)
        if (matchingShift) clearShiftRuntimeState(matchingShift)
      }
      invalidateRuntimeStatusCache()
      return apiSuccess(res, { shiftId: parsed.data.shiftId, cronId })
    } catch (error) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to stop shift', String(error))
    }
  })

  app.post('/api/shifts/update', async (req, res) => {
    const schema = z.object({
      shiftId: z.string().min(1),
      name: z.string().min(1).max(80).optional(),
      scheduleKind: z.enum(['every', 'cron', 'at']).optional(),
      schedule: z.string().min(1).max(240).optional(),
      message: z.string().min(1).max(50000).optional(),
      messageMode: z.enum(['message', 'system-event']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    const shift = activeShifts.get(payload.shiftId)
    const cronId = shift?.cronId || payload.shiftId.replace(/^cron:/, '').trim()
    if (!isValidCronJobId(cronId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid cron job id')
    }

    const args = ['cron', 'edit', cronId]
    const updatePatch: { name?: string; scheduleKind?: 'every' | 'cron' | 'at'; schedule?: string; message?: string } = {}

    if (payload.name?.trim()) {
      const name = payload.name.trim()
      args.push('--name', name)
      updatePatch.name = name
    }

    if (payload.schedule || payload.scheduleKind) {
      if (!payload.schedule || !payload.scheduleKind) {
        return apiFailure(res, 400, 'invalid_payload', 'Schedule kind and value are both required to edit timing')
      }
      const rawSchedule = payload.schedule.trim()
      if (payload.scheduleKind === 'every') {
        const every = normalizeCronEveryEditInput(rawSchedule)
        if (!every) return apiFailure(res, 400, 'invalid_payload', 'Use a simple interval like 10m, 1h, 2d, or 1w.')
        args.push('--every', every)
        updatePatch.schedule = every
      } else if (payload.scheduleKind === 'cron') {
        args.push('--cron', rawSchedule)
        updatePatch.schedule = rawSchedule
      } else {
        args.push('--at', rawSchedule)
        updatePatch.schedule = rawSchedule
      }
      updatePatch.scheduleKind = payload.scheduleKind
    }

    if (payload.message?.trim()) {
      const message = payload.message.trim()
      args.push(payload.messageMode === 'system-event' ? '--system-event' : '--message', message)
      updatePatch.message = message
    }

    if (args.length <= 3) {
      return apiFailure(res, 400, 'invalid_payload', 'No cron job changes supplied')
    }

    try {
      const result = await runOpenClaw(args, 60000)
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'Failed to update cron job')
      }
      updateActiveShiftFromCronEdit(shift, updatePatch)
      invalidateRuntimeStatusCache()
      const updated = listActiveCronJobViews().active.find((job) => job.cronId === cronId || job.id === payload.shiftId)
      return apiSuccess(res, { shiftId: payload.shiftId, cronId, shift: updated || null })
    } catch (error) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to update cron job', String(error))
    }
  })

  app.get('/api/shifts', async (_req, res) => {
    try {
      await sweepExpiredMissionCronJobs('shifts endpoint mission cron expiry sweep').catch(() => undefined)
      const cronJobs = listActiveCronJobViews()
      return apiSuccess(res, {
        shifts: cronJobs.active,
        ...(cronJobs.error ? { error: cronJobs.error } : {}),
      })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to list shifts', String(error))
    }
  })

  app.get('/api/shifts/defaults', async (_req, res) => {
    try {
      const defaults = await readHeartbeatRuntimeDefaults()
      return apiSuccess(res, { defaults })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to read shift defaults', String(error))
    }
  })

  app.post('/api/shifts/defaults', async (req, res) => {
    const schema = z.object({
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
      leadAgent: z.string().min(1).max(80).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const current = await readHeartbeatRuntimeDefaults()
      const next = mergeHeartbeatRuntimeDefaults(current, parsed.data)
      await writeHeartbeatRuntimeDefaults(next)

      return apiSuccess(res, { defaults: next })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to update shift defaults', String(error))
    }
  })

  app.get('/api/shifts/defaults/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')
    try {
      const globalDefaults = await readHeartbeatRuntimeDefaults()
      const perAgentStore = await readHeartbeatRuntimePerAgent()
      const agentDefaults = perAgentStore[agentId] || {}
      const resolved = mergeHeartbeatRuntimeDefaults(globalDefaults, agentDefaults)
      return apiSuccess(res, { agentId, globalDefaults, agentDefaults, resolved })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to read per-agent shift defaults', String(error))
    }
  })

  app.post('/api/shifts/defaults/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')

    const schema = z.object({
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
      leadAgent: z.string().min(1).max(80).optional(),
      clear: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const perAgent = await readHeartbeatRuntimePerAgent()
      if (parsed.data.clear) {
        delete perAgent[agentId]
      } else {
        const previous = perAgent[agentId] || {}
        const nextPatch: Partial<HeartbeatRuntimeDefaults> = {
          ...previous,
          ...parsed.data,
        }
        delete (nextPatch as Partial<HeartbeatRuntimeDefaults> & { clear?: boolean }).clear
        if (nextPatch.model) nextPatch.model = nextPatch.model.trim()
        if (nextPatch.leadAgent) nextPatch.leadAgent = nextPatch.leadAgent.trim()
        perAgent[agentId] = nextPatch
      }

      await writeHeartbeatRuntimePerAgent(perAgent)
      const globalDefaults = await readHeartbeatRuntimeDefaults()
      const agentDefaults = perAgent[agentId] || {}
      const resolved = mergeHeartbeatRuntimeDefaults(globalDefaults, agentDefaults)
      return apiSuccess(res, { agentId, agentDefaults, resolved })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to update per-agent shift defaults', String(error))
    }
  })
}

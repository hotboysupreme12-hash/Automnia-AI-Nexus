import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type MissionMode = 'instant' | 'hours' | 'days' | 'weeks' | 'continuous' | 'indefinite'
type MissionStatus = 'active' | 'completed' | 'cancelled'
type MissionLifecycleState =
  | 'draft'
  | 'validating'
  | 'scheduled'
  | 'dispatching'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
type MissionCronRole = 'leader' | 'worker' | 'reviewer'
type MissionCronJobStatus = 'created' | 'running' | 'completed' | 'failed' | 'disabled' | 'removed'

type TeamSyncAssignment = {
  agentId: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt: string
  note?: string
}

type MissionCronJob = {
  id: string
  cronId: string
  missionId: string
  agentId: string
  role: MissionCronRole
  round: number
  name: string
  status: MissionCronJobStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  summary: string | null
  runtimeRunId: string | null
  cronRunId: string | null
  sessionId: string | null
  sessionKey: string | null
}

type MissionSchedulerState = {
  engine: 'openclaw-cron'
  policy: 'leader-first'
  status: 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopping' | 'stopped'
  round: number
  cycleIntervalMs: number
  nextRoundAt: string | null
  maxCycles: number | null
  leaderAgentId: string | null
  activeJobId: string | null
  jobs: MissionCronJob[]
  lastError: string | null
}

type Mission = {
  id: string
  idempotencyKey?: string
  title: string
  brief: string
  mode: MissionMode
  amount: number | null
  missionType?: string
  collaborationMode?: string
  complexity?: number
  riskTolerance?: number
  cadenceSeconds?: number
  startAt: string
  endAt: string | null
  status: MissionStatus
  lifecycleState: MissionLifecycleState
  party: string[]
  createdAt: string
  completedAt: string | null
  scheduler: MissionSchedulerState
}

type MissionLifecycleEvent = {
  id: string
  missionId: string
  timestamp: string
  at: string
  type: 'mission_started' | 'agent_assigned' | 'agent_update' | 'mission_completed' | 'mission_cancelled'
  message: string
  actor: string
  previousState: MissionLifecycleState | null
  nextState: MissionLifecycleState | null
  idempotencyKey: string
  agentId?: string
  evidence?: Record<string, unknown>
}

type MissionReport = {
  missionId: string
} & Record<string, unknown>

type MissionLifecycleProjection = {
  missions: unknown[]
  feed: unknown[]
  events: MissionLifecycleEvent[]
  reports: MissionReport[]
}

type MissionCronCleanupSummary = {
  attempted: number
  removed: number
  disabled: number
  failed: number
  results: unknown[]
}

type MissionRoutesOptions = {
  buildMissionLifecycleProjection: (options?: {
    missionId?: string | null
    missionLimit?: number
    eventLimit?: number
    feedLimit?: number
    reportLimit?: number
  }) => Promise<MissionLifecycleProjection>
  cleanupMissionCronJobs: (mission: Mission) => Promise<MissionCronCleanupSummary>
  clearMissionController: (missionId: string) => void
  completeCronMission: (
    mission: Mission,
    status: MissionStatus,
    note: string,
    assignments: TeamSyncAssignment[],
    activity: string[],
  ) => Promise<void>
  controlCenterMissionSchedulerDryRun: boolean
  findMissionByIdempotencyKey: (idempotencyKey: string | null) => Mission | null
  listMissionReports: (limit?: number) => Promise<MissionReport[]>
  missionCronCleanupFailureSummary: (error: unknown) => MissionCronCleanupSummary
  missionCronJobNeedsRecovery: (job: MissionCronJob) => boolean
  missionDurationMs: (mode: MissionMode, amount: number | null) => number
  missionSchedulerInitialState: (args: {
    party: string[]
    cadenceSeconds?: number | null
    maxCycles?: number | null
  }) => MissionSchedulerState
  missionTimers: Map<string, NodeJS.Timeout>
  missionView: (mission: Mission) => unknown
  missions: Map<string, Mission>
  normalizeMissionLaunchIdempotencyKey: (value: unknown) => string | null
  persistMissionRecord: (mission: Mission, reason: string) => void
  pushMissionEvent: (event: {
    missionId: string
    type: MissionLifecycleEvent['type']
    message: string
    agentId?: string
    actor?: string
    previousState?: MissionLifecycleState
    nextState?: MissionLifecycleState
    idempotencyKey?: string
    evidence?: Record<string, unknown>
  }) => void
  readMissionEvents: (limit: number) => Promise<MissionLifecycleEvent[]>
  recordMissionReport: (mission: Mission) => unknown
  scheduleNextMissionRound: (
    mission: Mission,
    assignments: TeamSyncAssignment[],
    activity: string[],
    delayMs: number,
  ) => void
  startRecurringMissionCronJobs: (
    mission: Mission,
    assignments: TeamSyncAssignment[],
    activity: string[],
  ) => Promise<void>
  transitionMissionState: (
    mission: Mission,
    nextState: MissionLifecycleState,
    type: MissionLifecycleEvent['type'],
    message: string,
    options?: {
      actor?: string
      idempotencyKey?: string
      evidence?: Record<string, unknown>
    },
  ) => void
  writeTeamSyncSnapshot: (params: {
    missionId: string
    title: string
    mode: MissionMode
    status: MissionStatus
    assignments: TeamSyncAssignment[]
    activity: string[]
  }) => Promise<void>
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

    const payload = parsed.data
    const idempotencyKey = options.normalizeMissionLaunchIdempotencyKey(payload.idempotencyKey)
    const uniqueParty = Array.from(new Set(payload.party.map((agentId) => agentId.trim()).filter(Boolean)))
    if (!uniqueParty.length) return apiFailure(res, 400, 'invalid_payload', 'Mission requires at least one valid agent.')
    const existingMission = options.findMissionByIdempotencyKey(idempotencyKey)
    if (existingMission) {
      return apiSuccess(res, {
        deduped: true,
        idempotencyKey,
        mission: options.missionView(existingMission),
      })
    }

    const mission: Mission = {
      id: randomUUID(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      title: payload.title,
      brief: payload.brief,
      mode: payload.mode,
      amount: payload.mode === 'indefinite' || payload.mode === 'continuous' || payload.mode === 'instant' ? null : payload.amount || 1,
      missionType: payload.missionType,
      collaborationMode: payload.collaborationMode,
      complexity: payload.complexity,
      riskTolerance: payload.riskTolerance,
      cadenceSeconds: payload.cadenceSeconds,
      startAt: new Date().toISOString(),
      endAt: null,
      status: 'active',
      lifecycleState: 'draft',
      party: uniqueParty,
      createdAt: new Date().toISOString(),
      completedAt: null,
      scheduler: options.missionSchedulerInitialState({
        party: uniqueParty,
        cadenceSeconds: payload.cadenceSeconds,
        maxCycles: payload.maxCycles ?? null,
      }),
    }
    const missionActivity: string[] = []
    const missionAssignments: TeamSyncAssignment[] = mission.party.map((agentId) => ({
      agentId,
      task: mission.brief,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    }))

    const durationMs = options.missionDurationMs(mission.mode, mission.amount)
    if (durationMs > 0) {
      mission.endAt = new Date(Date.now() + durationMs).toISOString()
      const timer = setTimeout(() => {
        const target = options.missions.get(mission.id)
        if (!target || target.status !== 'active') return
        options.missionTimers.delete(mission.id)
        void options.completeCronMission(target, 'completed', `Mission completed by cron timer: ${target.title}`, missionAssignments, missionActivity)
      }, durationMs)
      options.missionTimers.set(mission.id, timer)
    }

    options.missions.set(mission.id, mission)
    options.transitionMissionState(mission, 'validating', 'mission_started', `Cron mission accepted for validation: ${mission.title}`, {
      idempotencyKey: `${mission.id}:draft->validating`,
      evidence: { partySize: mission.party.length, mode: mission.mode },
    })
    options.transitionMissionState(mission, 'scheduled', 'mission_started', `Cron mission scheduled: ${mission.title}`, {
      idempotencyKey: `${mission.id}:validating->scheduled`,
      evidence: { cadenceSeconds: mission.cadenceSeconds || null, maxCycles: mission.scheduler.maxCycles },
    })
    missionActivity.unshift(`${new Date().toISOString()} | cron mission started`)
    for (const state of missionAssignments) {
      state.status = 'queued'
      state.updatedAt = new Date().toISOString()
      state.note = 'awaiting cron leader round'
    }
    for (const agentId of mission.party) {
      options.pushMissionEvent({
        missionId: mission.id,
        type: 'agent_assigned',
        agentId,
        message: `${agentId} assigned to cron mission: ${mission.brief.slice(0, 120)}`,
      })
    }
    await options.writeTeamSyncSnapshot({
      missionId: mission.id,
      title: mission.title,
      mode: mission.mode,
      status: mission.status,
      assignments: missionAssignments,
      activity: missionActivity,
    })

    try {
      if (options.controlCenterMissionSchedulerDryRun) {
        mission.scheduler.status = 'waiting'
        mission.scheduler.nextRoundAt = null
        mission.scheduler.lastError = null
        missionActivity.unshift(`${new Date().toISOString()} | scheduler | mission scheduler dry-run armed`)
        options.persistMissionRecord(mission, 'scheduler-dry-run')
        options.pushMissionEvent({
          missionId: mission.id,
          type: 'agent_update',
          message: `Mission scheduler dry-run armed: ${mission.title}`,
          actor: 'scheduler',
          evidence: {
            dryRun: true,
            reason: 'CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN',
            partySize: mission.party.length,
            mode: mission.mode,
          },
        })
      } else if (mission.mode === 'instant') {
        options.scheduleNextMissionRound(mission, missionAssignments, missionActivity, 0)
      } else {
        await options.startRecurringMissionCronJobs(mission, missionAssignments, missionActivity)
      }
      options.transitionMissionState(mission, 'running', 'mission_started', `Cron mission running: ${mission.title}`, {
        idempotencyKey: `${mission.id}:scheduled->running`,
        evidence: { schedulerStatus: mission.scheduler.status, jobs: mission.scheduler.jobs.length },
      })
    } catch (error) {
      const timer = options.missionTimers.get(mission.id)
      if (timer) {
        clearTimeout(timer)
        options.missionTimers.delete(mission.id)
      }
      mission.status = 'cancelled'
      mission.completedAt = new Date().toISOString()
      options.transitionMissionState(mission, 'failed', 'mission_cancelled', `Cron mission failed during scheduler setup: ${String(error)}`, {
        idempotencyKey: `${mission.id}:scheduled->failed`,
        evidence: { error: String(error) },
      })
      options.recordMissionReport(mission)
      options.missions.delete(mission.id)
      return apiFailure(res, 500, 'mission_scheduler_failed', 'Failed to create mission cron jobs', String(error))
    }

    return apiSuccess(res, { deduped: false, idempotencyKey, mission: options.missionView(mission) })
  })

  app.post('/api/missions/stop', async (req, res) => {
    const schema = z.object({
      missionId: z.string().min(1),
      reason: z.string().trim().max(300).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const mission = options.missions.get(parsed.data.missionId)
    if (!mission) return apiFailure(res, 404, 'mission_not_found', 'Mission not found')
    if (mission.status !== 'active') return apiFailure(res, 400, 'mission_invalid_state', `Mission is already ${mission.status}`)

    const timer = options.missionTimers.get(mission.id)
    if (timer) {
      clearTimeout(timer)
      options.missionTimers.delete(mission.id)
    }
    options.clearMissionController(mission.id)

    mission.status = 'cancelled'
    mission.completedAt = new Date().toISOString()
    mission.endAt ||= mission.completedAt
    mission.scheduler.status = 'stopping'
    mission.scheduler.nextRoundAt = null
    mission.scheduler.activeJobId = null
    mission.scheduler.lastError = null
    const cancellationReason = parsed.data.reason || 'mission cancelled by operator'
    options.persistMissionRecord(mission, 'cancellation-requested')
    options.pushMissionEvent({
      missionId: mission.id,
      type: 'agent_update',
      message: `Mission cancellation requested: ${mission.title}`,
      actor: 'operator',
      previousState: mission.lifecycleState,
      nextState: mission.lifecycleState,
      idempotencyKey: `${mission.id}:operator-cancel-requested:${mission.completedAt}`,
      evidence: {
        reason: cancellationReason,
        jobs: mission.scheduler.jobs.length,
        activeJobs: mission.scheduler.jobs.filter(options.missionCronJobNeedsRecovery).length,
        round: mission.scheduler.round,
      },
    })

    const cleanup = await options.cleanupMissionCronJobs(mission).catch(options.missionCronCleanupFailureSummary)
    if (cleanup.failed > 0) {
      mission.scheduler.status = 'failed'
      mission.scheduler.lastError = `Mission cancellation cleanup failed for ${cleanup.failed} job(s).`
      options.pushMissionEvent({
        missionId: mission.id,
        type: 'agent_update',
        message: `Mission cancellation cleanup failed for ${cleanup.failed} cron job(s).`,
        actor: 'scheduler',
        evidence: { cleanup },
      })
    } else {
      mission.scheduler.status = 'stopped'
    }
    options.transitionMissionState(mission, 'cancelled', 'mission_cancelled', `Cron mission cancelled: ${mission.title}`, {
      actor: 'operator',
      idempotencyKey: `${mission.id}:operator-cancel:${mission.completedAt}`,
      evidence: {
        reason: cancellationReason,
        jobs: mission.scheduler.jobs.length,
        round: mission.scheduler.round,
        cleanup,
      },
    })
    options.recordMissionReport(mission)
    await options.writeTeamSyncSnapshot({
      missionId: mission.id,
      title: mission.title,
      mode: mission.mode,
      status: mission.status,
      assignments: mission.party.map((agentId) => ({
        agentId,
        task: mission.brief,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        note: cancellationReason,
      })),
      activity: [
        `${new Date().toISOString()} | ${cancellationReason}`,
        `${new Date().toISOString()} | scheduler | cancellation cleanup removed=${cleanup.removed} disabled=${cleanup.disabled} failed=${cleanup.failed}`,
      ],
    })
    return apiSuccess(res, { mission: options.missionView(mission), cleanup })
  })
}

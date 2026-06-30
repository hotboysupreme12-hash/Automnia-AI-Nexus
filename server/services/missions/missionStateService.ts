import { randomUUID } from 'node:crypto'

export type MissionMode = 'instant' | 'hours' | 'days' | 'weeks' | 'continuous' | 'indefinite'
export type MissionStatus = 'active' | 'completed' | 'cancelled'
export type MissionLifecycleState =
  | 'draft'
  | 'validating'
  | 'scheduled'
  | 'dispatching'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type MissionCronRole = 'leader' | 'worker' | 'reviewer'
export type MissionCronJobStatus = 'created' | 'running' | 'completed' | 'failed' | 'disabled' | 'removed'

export type TeamSyncAssignment = {
  agentId: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt: string
  note?: string
}

export type MissionCronJob = {
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

export type MissionCronCleanupResult = {
  jobId: string
  cronId: string
  agentId: string
  previousStatus: MissionCronJobStatus
  status: MissionCronJobStatus
  ok: boolean
  action: 'removed' | 'disabled' | 'unchanged'
  detail: string | null
}

export type MissionCronCleanupSummary = {
  attempted: number
  removed: number
  disabled: number
  failed: number
  results: MissionCronCleanupResult[]
}

export type MissionSchedulerState = {
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

export type Mission = {
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

export type MissionFeedEvent = {
  id: string
  missionId: string
  at: string
  type: 'mission_started' | 'agent_assigned' | 'agent_update' | 'mission_completed' | 'mission_cancelled'
  message: string
  agentId?: string
  actor?: string
  previousState?: MissionLifecycleState
  nextState?: MissionLifecycleState
  idempotencyKey?: string
  evidence?: Record<string, unknown>
}

export type MissionLifecycleEvent = {
  id: string
  missionId: string
  timestamp: string
  at: string
  type: MissionFeedEvent['type']
  message: string
  actor: string
  previousState: MissionLifecycleState | null
  nextState: MissionLifecycleState | null
  idempotencyKey: string
  agentId?: string
  evidence?: Record<string, unknown>
}

export type MissionRecordSnapshot = Mission & {
  missionId: string
  updatedAt: string
  persistedAt: string
  persistReason: string
}

export type MissionView = Mission & {
  progress: number | null
}

export type MissionStartPayload = {
  title: string
  brief: string
  party: string[]
  mode: MissionMode
  amount?: number | null
  missionType?: string
  collaborationMode?: string
  complexity?: number
  riskTolerance?: number
  cadenceSeconds?: number
  maxCycles?: number | null
  idempotencyKey?: string
}

export type MissionStopPayload = {
  missionId: string
  reason?: string
}

export type MissionStateServiceErrorCode =
  | 'invalid_payload'
  | 'mission_invalid_state'
  | 'mission_not_found'
  | 'mission_scheduler_failed'

export type MissionStateServiceError = {
  ok: false
  status: number
  code: MissionStateServiceErrorCode
  message: string
  detail?: unknown
}

export type MissionStartResult =
  | {
    ok: true
    deduped: boolean
    idempotencyKey: string | null
    mission: MissionView
  }
  | MissionStateServiceError

export type MissionStopResult =
  | {
    ok: true
    mission: MissionView
    cleanup: MissionCronCleanupSummary
  }
  | MissionStateServiceError

export type MissionTransitionResult = {
  previousState: MissionLifecycleState
  nextState: MissionLifecycleState
  event: MissionFeedEvent
}

export type MissionStateServiceOptions = {
  appendMissionEvent: (event: MissionLifecycleEvent) => Promise<unknown>
  appendMissionRecord: (record: MissionRecordSnapshot) => Promise<unknown>
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
  missionCronCleanupFailureSummary: (error: unknown) => MissionCronCleanupSummary
  missionCronJobNeedsRecovery: (job: MissionCronJob) => boolean
  missionFeed: MissionFeedEvent[]
  missions: Map<string, Mission>
  missionTimers: Map<string, NodeJS.Timeout>
  now?: () => Date
  persistWarning?: (message: string, error: unknown) => void
  randomId?: () => string
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
  writeTeamSyncSnapshot: (params: {
    missionId: string
    title: string
    mode: MissionMode
    status: MissionStatus
    assignments: TeamSyncAssignment[]
    activity: string[]
  }) => Promise<void>
}

function defaultPersistWarning(message: string, error: unknown) {
  console.warn(message, error)
}

function uniqueMissionParty(party: string[]) {
  return Array.from(new Set(party.map((agentId) => agentId.trim()).filter(Boolean)))
}

export function missionDurationMs(mode: MissionMode, amount: number | null) {
  if (mode === 'indefinite' || mode === 'continuous' || mode === 'instant') return 0
  const safeAmount = Math.max(1, amount || 1)
  if (mode === 'hours') return safeAmount * 60 * 60 * 1000
  if (mode === 'days') return safeAmount * 24 * 60 * 60 * 1000
  return safeAmount * 7 * 24 * 60 * 60 * 1000
}

function missionProgress(mission: Mission) {
  if (mission.status === 'completed') return 100
  if (mission.status === 'cancelled') return 0
  if (mission.mode === 'indefinite' || mission.mode === 'continuous') return null
  if (mission.mode === 'instant') return 100
  if (!mission.endAt) return null

  const total = new Date(mission.endAt).getTime() - new Date(mission.startAt).getTime()
  if (total <= 0) return 100
  const elapsed = Date.now() - new Date(mission.startAt).getTime()
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)))
}

export function missionView(mission: Mission): MissionView {
  return {
    ...mission,
    progress: missionProgress(mission),
  }
}

export function missionCycleIntervalMs(cadenceSeconds?: number | null) {
  const seconds = Number(cadenceSeconds || 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return 5 * 60 * 1000
  return Math.max(15, Math.min(24 * 60 * 60, Math.round(seconds))) * 1000
}

export function missionSchedulerInitialState(args: {
  party: string[]
  cadenceSeconds?: number | null
  maxCycles?: number | null
}): MissionSchedulerState {
  return {
    engine: 'openclaw-cron',
    policy: 'leader-first',
    status: 'idle',
    round: 0,
    cycleIntervalMs: missionCycleIntervalMs(args.cadenceSeconds),
    nextRoundAt: null,
    maxCycles: args.maxCycles ?? null,
    leaderAgentId: args.party[0] || null,
    activeJobId: null,
    jobs: [],
    lastError: null,
  }
}

export function normalizeMissionLaunchIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 160 ? trimmed : null
}

export function missionRecordSnapshot(mission: Mission, reason: string): MissionRecordSnapshot {
  const updatedAt = new Date().toISOString()
  return {
    ...mission,
    missionId: mission.id,
    updatedAt,
    persistedAt: updatedAt,
    persistReason: reason,
    scheduler: {
      ...mission.scheduler,
      jobs: mission.scheduler.jobs.map((job) => ({ ...job })),
    },
    party: [...mission.party],
  }
}

export function createMissionStateService(options: MissionStateServiceOptions) {
  const now = () => options.now?.() || new Date()
  const isoNow = () => now().toISOString()
  const randomId = () => options.randomId?.() || randomUUID()
  const warn = options.persistWarning || defaultPersistWarning

  function listMissions(): Mission[] {
    return Array.from(options.missions.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  function findMissionByIdempotencyKey(idempotencyKey: string | null): Mission | null {
    if (!idempotencyKey) return null
    return Array.from(options.missions.values())
      .filter((mission) => mission.idempotencyKey === idempotencyKey)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null
  }

  function pushMissionEvent(event: Omit<MissionFeedEvent, 'id' | 'at'>): MissionFeedEvent {
    const fullEvent: MissionFeedEvent = {
      id: randomId(),
      at: isoNow(),
      ...event,
    }
    options.missionFeed.unshift(fullEvent)
    if (options.missionFeed.length > 300) {
      options.missionFeed.length = 300
    }
    const ledgerEvent: MissionLifecycleEvent = {
      id: fullEvent.id,
      missionId: fullEvent.missionId,
      timestamp: fullEvent.at,
      at: fullEvent.at,
      type: fullEvent.type,
      message: fullEvent.message,
      actor: fullEvent.actor || fullEvent.agentId || 'control-center',
      previousState: fullEvent.previousState || null,
      nextState: fullEvent.nextState || null,
      idempotencyKey: fullEvent.idempotencyKey || `${fullEvent.missionId}:${fullEvent.type}:${fullEvent.id}`,
      ...(fullEvent.agentId ? { agentId: fullEvent.agentId } : {}),
      ...(fullEvent.evidence ? { evidence: fullEvent.evidence } : {}),
    }
    void options.appendMissionEvent(ledgerEvent).catch((error) => {
      warn('[missions] failed to append mission event ledger:', error)
    })
    return fullEvent
  }

  function persistMissionRecord(mission: Mission, reason: string) {
    void options.appendMissionRecord(missionRecordSnapshot(mission, reason)).catch((error) => {
      warn('[missions] failed to append mission record ledger:', error)
    })
  }

  function transitionMissionState(
    mission: Mission,
    nextState: MissionLifecycleState,
    type: MissionFeedEvent['type'],
    message: string,
    transitionOptions: {
      actor?: string
      idempotencyKey?: string
      evidence?: Record<string, unknown>
    } = {},
  ): MissionTransitionResult {
    const previousState = mission.lifecycleState
    mission.lifecycleState = nextState
    const event = pushMissionEvent({
      missionId: mission.id,
      type,
      message,
      actor: transitionOptions.actor || 'control-center',
      previousState,
      nextState,
      idempotencyKey: transitionOptions.idempotencyKey || `${mission.id}:${previousState}->${nextState}:${type}`,
      ...(transitionOptions.evidence ? { evidence: transitionOptions.evidence } : {}),
    })
    persistMissionRecord(mission, `transition:${previousState}->${nextState}`)
    return { previousState, nextState, event }
  }

  async function startMission(payload: MissionStartPayload): Promise<MissionStartResult> {
    const idempotencyKey = normalizeMissionLaunchIdempotencyKey(payload.idempotencyKey)
    const party = uniqueMissionParty(payload.party)
    if (!party.length) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        message: 'Mission requires at least one valid agent.',
      }
    }
    const existingMission = findMissionByIdempotencyKey(idempotencyKey)
    if (existingMission) {
      return {
        ok: true,
        deduped: true,
        idempotencyKey,
        mission: missionView(existingMission),
      }
    }

    const createdAt = isoNow()
    const mission: Mission = {
      id: randomId(),
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
      startAt: createdAt,
      endAt: null,
      status: 'active',
      lifecycleState: 'draft',
      party,
      createdAt,
      completedAt: null,
      scheduler: missionSchedulerInitialState({
        party,
        cadenceSeconds: payload.cadenceSeconds,
        maxCycles: payload.maxCycles ?? null,
      }),
    }
    const missionActivity: string[] = []
    const missionAssignments: TeamSyncAssignment[] = mission.party.map((agentId) => ({
      agentId,
      task: mission.brief,
      status: 'queued',
      updatedAt: isoNow(),
    }))

    const durationMs = missionDurationMs(mission.mode, mission.amount)
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
    transitionMissionState(mission, 'validating', 'mission_started', `Cron mission accepted for validation: ${mission.title}`, {
      idempotencyKey: `${mission.id}:draft->validating`,
      evidence: { partySize: mission.party.length, mode: mission.mode },
    })
    transitionMissionState(mission, 'scheduled', 'mission_started', `Cron mission scheduled: ${mission.title}`, {
      idempotencyKey: `${mission.id}:validating->scheduled`,
      evidence: { cadenceSeconds: mission.cadenceSeconds || null, maxCycles: mission.scheduler.maxCycles },
    })
    missionActivity.unshift(`${isoNow()} | cron mission started`)
    for (const state of missionAssignments) {
      state.status = 'queued'
      state.updatedAt = isoNow()
      state.note = 'awaiting cron leader round'
    }
    for (const agentId of mission.party) {
      pushMissionEvent({
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
        missionActivity.unshift(`${isoNow()} | scheduler | mission scheduler dry-run armed`)
        persistMissionRecord(mission, 'scheduler-dry-run')
        pushMissionEvent({
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
      transitionMissionState(mission, 'running', 'mission_started', `Cron mission running: ${mission.title}`, {
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
      mission.completedAt = isoNow()
      transitionMissionState(mission, 'failed', 'mission_cancelled', `Cron mission failed during scheduler setup: ${String(error)}`, {
        idempotencyKey: `${mission.id}:scheduled->failed`,
        evidence: { error: String(error) },
      })
      options.recordMissionReport(mission)
      options.missions.delete(mission.id)
      return {
        ok: false,
        status: 500,
        code: 'mission_scheduler_failed',
        message: 'Failed to create mission cron jobs',
        detail: String(error),
      }
    }

    return { ok: true, deduped: false, idempotencyKey, mission: missionView(mission) }
  }

  async function stopMission(payload: MissionStopPayload): Promise<MissionStopResult> {
    const mission = options.missions.get(payload.missionId)
    if (!mission) return { ok: false, status: 404, code: 'mission_not_found', message: 'Mission not found' }
    if (mission.status !== 'active') {
      return {
        ok: false,
        status: 400,
        code: 'mission_invalid_state',
        message: `Mission is already ${mission.status}`,
      }
    }

    const timer = options.missionTimers.get(mission.id)
    if (timer) {
      clearTimeout(timer)
      options.missionTimers.delete(mission.id)
    }
    options.clearMissionController(mission.id)

    mission.status = 'cancelled'
    mission.completedAt = isoNow()
    mission.endAt ||= mission.completedAt
    mission.scheduler.status = 'stopping'
    mission.scheduler.nextRoundAt = null
    mission.scheduler.activeJobId = null
    mission.scheduler.lastError = null
    const cancellationReason = payload.reason || 'mission cancelled by operator'
    persistMissionRecord(mission, 'cancellation-requested')
    pushMissionEvent({
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
      pushMissionEvent({
        missionId: mission.id,
        type: 'agent_update',
        message: `Mission cancellation cleanup failed for ${cleanup.failed} cron job(s).`,
        actor: 'scheduler',
        evidence: { cleanup },
      })
    } else {
      mission.scheduler.status = 'stopped'
    }
    transitionMissionState(mission, 'cancelled', 'mission_cancelled', `Cron mission cancelled: ${mission.title}`, {
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
        updatedAt: isoNow(),
        note: cancellationReason,
      })),
      activity: [
        `${isoNow()} | ${cancellationReason}`,
        `${isoNow()} | scheduler | cancellation cleanup removed=${cleanup.removed} disabled=${cleanup.disabled} failed=${cleanup.failed}`,
      ],
    })
    return { ok: true, mission: missionView(mission), cleanup }
  }

  return {
    findMissionByIdempotencyKey,
    listMissions,
    missionDurationMs,
    missionSchedulerInitialState,
    missionView,
    normalizeMissionLaunchIdempotencyKey,
    persistMissionRecord,
    pushMissionEvent,
    startMission,
    stopMission,
    transitionMissionState,
  }
}

export type MissionStateService = ReturnType<typeof createMissionStateService>

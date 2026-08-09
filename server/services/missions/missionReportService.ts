import {
  missionSchedulerInitialState,
  missionView,
  type Mission,
  type MissionCronJob,
  type MissionCronJobStatus,
  type MissionCronRole,
  type MissionCollaborationMode,
  type MissionFeedEvent,
  type MissionLifecycleEvent,
  type MissionLifecycleState,
  type MissionMode,
  type MissionRecordSnapshot,
  type MissionSchedulerState,
  type MissionStatus,
  type MissionType,
} from './missionStateService'

export type BackendMissionReportEvidence = {
  source: 'runtime-responses' | 'mission-feed' | 'mixed' | 'none'
  acceptedRuns: number
  startedRuns: number
  completedRuns: number
  failedRuns: number
  cancelledRuns: number
  timedOutRuns: number
  retryCount: number
  fallbackCount: number
  verificationFailures: number
  toolFailures: number
  commandFailures: number
  humanInterventions: number
  agentParticipation: string[]
  queueDelayMs: number | null
  timeToFirstTokenMs: number | null
  totalExecutionDurationMs: number | null
  missionWallTimeMs: number | null
  tokenUsageEstimate: number | null
  runtimeRunIds: string[]
  cronRunIds: string[]
  sessionIds: string[]
  sessionKeys: string[]
  unavailableMetrics: string[]
}

export type BackendMissionReport = {
  id: string
  missionId: string
  generatedAt: string
  efficiencyRating: number | null
  soulDrift: number | null
  heartbeatStabilityScore: number | null
  runtimeEfficiency: number | null
  errors: number | null
  xpGained: number | null
  skillUnlocks: string[]
  evidence: BackendMissionReportEvidence
}

type MissionView = ReturnType<typeof missionView>

export type MissionLifecycleProjection = {
  generatedAt: string
  missions: MissionView[]
  feed: MissionFeedEvent[]
  events: MissionLifecycleEvent[]
  reports: BackendMissionReport[]
  projection: {
    source: 'memory+ledger'
    missionCount: number
    activeMissionCount: number
    feedCount: number
    eventCount: number
    reportCount: number
    durableRecordCount: number
    memoryRecordCount: number
  }
}

export type MissionReportServiceOptions = {
  appendMissionReport: (report: BackendMissionReport) => Promise<unknown>
  missionFeed: MissionFeedEvent[]
  missions: Map<string, Mission>
  now?: () => Date
  persistWarning?: (message: string, error: unknown) => void
  readMissionEvents: <T>(limit: number) => Promise<T[]>
  readMissionRecords: <T>(limit: number) => Promise<T[]>
  readMissionReports: <T>(limit: number) => Promise<T[]>
}

function defaultPersistWarning(message: string, error: unknown) {
  console.warn(message, error)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberOrNull(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampMissionScore(value: number) {
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeMissionMode(value: unknown): MissionMode {
  return value === 'instant' || value === 'hours' || value === 'days' || value === 'weeks' || value === 'continuous' || value === 'indefinite'
    ? value
    : 'instant'
}

function normalizeMissionStatus(value: unknown): MissionStatus {
  return value === 'completed' || value === 'cancelled' ? value : 'active'
}

function normalizeMissionType(value: unknown): MissionType | undefined {
  return value === 'codeGeneration' || value === 'planning' || value === 'research' || value === 'orchestration' || value === 'memoryManagement'
    ? value
    : undefined
}

function normalizeMissionCollaborationMode(value: unknown): MissionCollaborationMode | undefined {
  return value === 'parallel' || value === 'sequential' || value === 'hierarchical' || value === 'swarm' || value === 'specialist'
    ? value
    : undefined
}

function lifecycleStateFromStatus(status: MissionStatus): MissionLifecycleState {
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  return 'running'
}

function normalizeMissionLifecycleState(value: unknown, status: MissionStatus): MissionLifecycleState {
  return value === 'draft' ||
    value === 'validating' ||
    value === 'scheduled' ||
    value === 'dispatching' ||
    value === 'running' ||
    value === 'verifying' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : lifecycleStateFromStatus(status)
}

function normalizeMissionCronRole(value: unknown): MissionCronRole {
  return value === 'leader' || value === 'reviewer' ? value : 'worker'
}

function normalizeMissionCronJobStatus(value: unknown): MissionCronJobStatus {
  return value === 'created' || value === 'running' || value === 'completed' || value === 'failed' || value === 'disabled' || value === 'removed'
    ? value
    : 'created'
}

function normalizeMissionCronJob(value: unknown, missionId: string): MissionCronJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const cronId = stringValue(record.cronId)
  const agentId = stringValue(record.agentId)
  if (!id || !cronId || !agentId) return null
  return {
    id,
    cronId,
    missionId: stringValue(record.missionId) || missionId,
    agentId,
    role: normalizeMissionCronRole(record.role),
    round: Math.max(0, Math.round(numberValue(record.round) || 0)),
    name: stringValue(record.name) || `mission-${missionId}-${agentId}`,
    status: normalizeMissionCronJobStatus(record.status),
    createdAt: stringValue(record.createdAt) || new Date().toISOString(),
    startedAt: stringValue(record.startedAt),
    endedAt: stringValue(record.endedAt),
    summary: stringValue(record.summary),
    runtimeRunId: stringValue(record.runtimeRunId),
    cronRunId: stringValue(record.cronRunId) || stringValue(record.runId),
    sessionId: stringValue(record.sessionId),
    sessionKey: stringValue(record.sessionKey),
    scheduleKind: record.scheduleKind === 'recurring' ? 'recurring' : 'one-shot',
    runCount: Math.max(0, Math.round(numberValue(record.runCount) || 0)),
    completedRunCount: Math.max(0, Math.round(numberValue(record.completedRunCount) || 0)),
    failedRunCount: Math.max(0, Math.round(numberValue(record.failedRunCount) || 0)),
    lastRunAt: stringValue(record.lastRunAt),
    lastRunStatus: record.lastRunStatus === 'completed' || record.lastRunStatus === 'failed' ? record.lastRunStatus : null,
  }
}

function normalizeMissionSchedulerState(
  value: unknown,
  missionId: string,
  party: string[],
  cadenceSeconds?: number | null,
  collaborationMode?: MissionCollaborationMode,
): MissionSchedulerState {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const fallback = missionSchedulerInitialState({ party, cadenceSeconds, collaborationMode })
  const status = record.status
  const schedulerStatus: MissionSchedulerState['status'] =
    status === 'idle' ||
    status === 'running' ||
    status === 'waiting' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'stopping' ||
    status === 'stopped'
      ? status
      : fallback.status
  return {
    engine: 'openclaw-cron',
    policy:
      record.policy === 'leader-first' ||
      record.policy === 'parallel' ||
      record.policy === 'sequential' ||
      record.policy === 'hierarchical' ||
      record.policy === 'swarm' ||
      record.policy === 'specialist'
        ? record.policy
        : fallback.policy,
    status: schedulerStatus,
    round: Math.max(0, Math.round(numberValue(record.round) || fallback.round)),
    cycleIntervalMs: Math.max(15_000, Math.round(numberValue(record.cycleIntervalMs) || fallback.cycleIntervalMs)),
    nextRoundAt: stringValue(record.nextRoundAt),
    maxCycles: numberValue(record.maxCycles),
    leaderAgentId: stringValue(record.leaderAgentId) || fallback.leaderAgentId,
    activeJobId: stringValue(record.activeJobId),
    jobs: arrayValue(record.jobs)
      .map((job) => normalizeMissionCronJob(job, missionId))
      .filter((job): job is MissionCronJob => Boolean(job)),
    lastError: stringValue(record.lastError),
  }
}

export function normalizeMissionRecordSnapshot(value: unknown): Mission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id) || stringValue(record.missionId)
  const title = stringValue(record.title)
  const brief = stringValue(record.brief)
  if (!id || !title || !brief) return null
  const party = arrayValue(record.party).map((agentId) => stringValue(agentId)).filter((agentId): agentId is string => Boolean(agentId))
  if (!party.length) return null
  const status = normalizeMissionStatus(record.status)
  const mode = normalizeMissionMode(record.mode)
  const cadenceSeconds = numberValue(record.cadenceSeconds)
  const missionType = normalizeMissionType(record.missionType)
  const collaborationMode = normalizeMissionCollaborationMode(record.collaborationMode)
  const agentCadenceRecord = record.agentCadenceSeconds && typeof record.agentCadenceSeconds === 'object' && !Array.isArray(record.agentCadenceSeconds)
    ? record.agentCadenceSeconds as Record<string, unknown>
    : {}
  const agentCadenceSeconds = Object.fromEntries(
    party.flatMap((agentId) => {
      const seconds = numberValue(agentCadenceRecord[agentId])
      return seconds === null ? [] : [[agentId, Math.max(15, Math.min(24 * 60 * 60, Math.round(seconds)))] as const]
    }),
  )
  return {
    id,
    ...(stringValue(record.idempotencyKey) ? { idempotencyKey: stringValue(record.idempotencyKey) || undefined } : {}),
    title,
    brief,
    mode,
    amount: numberValue(record.amount),
    ...(missionType ? { missionType } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
    ...(numberValue(record.complexity) !== null ? { complexity: numberValue(record.complexity) || 0 } : {}),
    ...(numberValue(record.riskTolerance) !== null ? { riskTolerance: numberValue(record.riskTolerance) || 0 } : {}),
    ...(cadenceSeconds !== null ? { cadenceSeconds } : {}),
    ...(Object.keys(agentCadenceSeconds).length ? { agentCadenceSeconds } : {}),
    startAt: stringValue(record.startAt) || stringValue(record.createdAt) || new Date().toISOString(),
    endAt: stringValue(record.endAt),
    status,
    lifecycleState: normalizeMissionLifecycleState(record.lifecycleState, status),
    party,
    createdAt: stringValue(record.createdAt) || stringValue(record.startAt) || new Date().toISOString(),
    completedAt: stringValue(record.completedAt),
    scheduler: normalizeMissionSchedulerState(record.scheduler, id, party, cadenceSeconds, collaborationMode),
  }
}

function missionSortMs(mission: Pick<Mission, 'createdAt' | 'startAt' | 'completedAt'>) {
  const candidates = [mission.completedAt, mission.createdAt, mission.startAt]
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function missionFeedEventFromLifecycleEvent(event: MissionLifecycleEvent, fallbackGeneratedAt: string): MissionFeedEvent | null {
  if (!event?.id || !event.missionId || !event.message) return null
  const type = event.type
  if (type !== 'mission_started' && type !== 'agent_assigned' && type !== 'agent_update' && type !== 'mission_completed' && type !== 'mission_cancelled') return null
  return {
    id: event.id,
    missionId: event.missionId,
    at: event.at || event.timestamp || fallbackGeneratedAt,
    type,
    message: event.message,
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.previousState ? { previousState: event.previousState } : {}),
    ...(event.nextState ? { nextState: event.nextState } : {}),
    ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
    ...(event.evidence ? { evidence: event.evidence } : {}),
  }
}

function missionWallTimeMs(mission: Mission) {
  const started = Date.parse(mission.startAt)
  const ended = Date.parse(mission.completedAt || mission.endAt || '')
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null
  return Math.max(0, ended - started)
}

function missionReportUnavailableMetrics(report: Pick<BackendMissionReport, 'efficiencyRating' | 'soulDrift' | 'heartbeatStabilityScore' | 'runtimeEfficiency' | 'errors' | 'xpGained'>) {
  return ([
    ['efficiencyRating', report.efficiencyRating],
    ['soulDrift', report.soulDrift],
    ['heartbeatStabilityScore', report.heartbeatStabilityScore],
    ['runtimeEfficiency', report.runtimeEfficiency],
    ['errors', report.errors],
    ['xpGained', report.xpGained],
  ] as const)
    .filter(([, value]) => value === null)
    .map(([key]) => key)
}

export function createMissionReportService(options: MissionReportServiceOptions) {
  const missionReports = new Map<string, BackendMissionReport>()
  const now = () => options.now?.() || new Date()
  const isoNow = () => now().toISOString()
  const warn = options.persistWarning || defaultPersistWarning

  function mergeMissionFeedEvents(lifecycleEvents: MissionLifecycleEvent[], limit: number, missionId?: string | null) {
    const byId = new Map<string, MissionFeedEvent>()
    const matchesMission = (id: string) => !missionId || id === missionId
    for (const event of options.missionFeed) {
      if (!matchesMission(event.missionId)) continue
      byId.set(event.id, event)
    }
    const fallbackGeneratedAt = isoNow()
    for (const event of lifecycleEvents) {
      if (!matchesMission(event.missionId)) continue
      const feedEvent = missionFeedEventFromLifecycleEvent(event, fallbackGeneratedAt)
      if (feedEvent) byId.set(feedEvent.id, feedEvent)
    }
    return Array.from(byId.values())
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, Math.max(1, Math.min(300, Math.round(limit))))
  }

  async function listMissionRecordsForProjection(limit = 500) {
    const records = await options.readMissionRecords<MissionRecordSnapshot>(limit).catch(() => [])
    const latestByMission = new Map<string, Mission>()
    let durableRecordCount = 0
    for (const record of records) {
      const mission = normalizeMissionRecordSnapshot(record)
      if (!mission) continue
      latestByMission.set(mission.id, mission)
      durableRecordCount += 1
    }
    for (const mission of options.missions.values()) {
      latestByMission.set(mission.id, mission)
    }
    return {
      missions: Array.from(latestByMission.values())
        .sort((a, b) => missionSortMs(b) - missionSortMs(a)),
      durableRecordCount,
      memoryRecordCount: options.missions.size,
    }
  }

  function buildMissionReport(mission: Mission, events: MissionFeedEvent[] = options.missionFeed): BackendMissionReport {
    const missionEvents = events.filter((event) => event.missionId === mission.id)
    const jobs = mission.scheduler.jobs
    const terminalJobs = jobs.filter((job) => (job.runCount || 0) > 0 || job.status === 'completed' || job.status === 'failed')
    const completedRuns = jobs.reduce(
      (total, job) => total + Math.max(0, job.completedRunCount || (job.status === 'completed' ? 1 : 0)),
      0,
    )
    const failedRuns = jobs.reduce(
      (total, job) => total + Math.max(0, job.failedRunCount || (job.status === 'failed' ? 1 : 0)),
      0,
    )
    const terminalRuns = completedRuns + failedRuns
    const runtimeRunIds = Array.from(new Set(jobs.map((job) => job.runtimeRunId).filter((value): value is string => Boolean(value))))
    const cronRunIds = Array.from(new Set(jobs.map((job) => job.cronRunId).filter((value): value is string => Boolean(value))))
    const sessionIds = Array.from(new Set(jobs.map((job) => job.sessionId).filter((value): value is string => Boolean(value))))
    const sessionKeys = Array.from(new Set(jobs.map((job) => job.sessionKey).filter((value): value is string => Boolean(value))))
    const hasRuntimeEvidence = runtimeRunIds.length > 0 || cronRunIds.length > 0 || sessionIds.length > 0 || sessionKeys.length > 0
    const verificationFailures = missionEvents.filter((event) => /\b(verification|acceptance|test|build)\b.*\b(fail|failed|failure|error)\b/i.test(event.message)).length
    const commandFailures = missionEvents.filter((event) => /\b(command|cron|openclaw)\b.*\b(fail|failed|error)\b/i.test(event.message)).length
    const retryCount = missionEvents.filter((event) => /\bretry(?:ing| attempts?)?\b/i.test(event.message)).length
    const fallbackCount = missionEvents.filter((event) => /\bfallback|fall back\b/i.test(event.message)).length
    const cancelledRuns = mission.lifecycleState === 'cancelled' ? Math.max(1, mission.party.length) : 0
    const acceptedRuns = Math.max(
      mission.party.length,
      missionEvents.filter((event) => event.type === 'agent_assigned').length,
    )
    const startedRuns = Math.max(
      jobs.filter((job) => job.startedAt).length,
      missionEvents.filter((event) => /\b(round|started|running)\b/i.test(event.message)).length,
    )
    const startedTimes = jobs
      .map((job) => (job.startedAt ? Date.parse(job.startedAt) : null))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const totalExecutionDurationMs = terminalJobs.length
      ? terminalJobs.reduce((total, job) => {
          const started = job.startedAt ? Date.parse(job.startedAt) : NaN
          const ended = job.endedAt ? Date.parse(job.endedAt) : NaN
          return total + (Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0)
        }, 0)
      : null
    const queueDelayMs = startedTimes.length
      ? Math.round(startedTimes.reduce((total, value) => total + Math.max(0, value - Date.parse(mission.createdAt)), 0) / startedTimes.length)
      : null
    const runtimeEfficiency = terminalRuns ? clampMissionScore((completedRuns / terminalRuns) * 100 - retryCount * 3 - commandFailures * 5) : null
    const efficiencyRating = terminalRuns ? clampMissionScore((completedRuns / terminalRuns) * 100 - retryCount * 3 - verificationFailures * 10 - commandFailures * 4) : null
    const heartbeatStabilityScore = clampMissionScore(100 - failedRuns * 8 - cancelledRuns * 8 - retryCount * 3 - fallbackCount * 4)
    const errors = missionEvents.length || terminalRuns ? failedRuns + verificationFailures + commandFailures : null
    const baseReport = {
      efficiencyRating,
      soulDrift: null,
      heartbeatStabilityScore,
      runtimeEfficiency,
      errors,
      xpGained: null,
    }
    return {
      id: `mission-report:${mission.id}`,
      missionId: mission.id,
      generatedAt: isoNow(),
      ...baseReport,
      skillUnlocks: [],
      evidence: {
        source: hasRuntimeEvidence && missionEvents.length ? 'mixed' : hasRuntimeEvidence ? 'runtime-responses' : missionEvents.length || jobs.length ? 'mission-feed' : 'none',
        acceptedRuns,
        startedRuns,
        completedRuns,
        failedRuns,
        cancelledRuns,
        timedOutRuns: 0,
        retryCount,
        fallbackCount,
        verificationFailures,
        toolFailures: 0,
        commandFailures,
        humanInterventions: missionEvents.filter((event) => event.actor === 'operator').length,
        agentParticipation: Array.from(new Set([
          ...jobs.map((job) => job.agentId),
          ...missionEvents.map((event) => event.agentId).filter((agentId): agentId is string => Boolean(agentId)),
        ])).filter((agentId) => mission.party.includes(agentId)),
        queueDelayMs: numberOrNull(queueDelayMs),
        timeToFirstTokenMs: null,
        totalExecutionDurationMs: numberOrNull(totalExecutionDurationMs),
        missionWallTimeMs: missionWallTimeMs(mission),
        tokenUsageEstimate: null,
        runtimeRunIds,
        cronRunIds,
        sessionIds,
        sessionKeys,
        unavailableMetrics: missionReportUnavailableMetrics(baseReport),
      },
    }
  }

  function recordMissionReport(mission: Mission) {
    const report = buildMissionReport(mission)
    missionReports.set(mission.id, report)
    void options.appendMissionReport(report).catch((error) => {
      warn('[missions] failed to append mission report ledger:', error)
    })
    return report
  }

  async function listMissionReports(limit = 80): Promise<BackendMissionReport[]> {
    const persisted = await options.readMissionReports<BackendMissionReport>(limit).catch(() => [])
    const byMission = new Map<string, BackendMissionReport>()
    for (const report of persisted) byMission.set(report.missionId, report)
    for (const report of missionReports.values()) byMission.set(report.missionId, report)
    return Array.from(byMission.values())
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
      .slice(0, limit)
  }

  async function buildMissionLifecycleProjection(optionsArg: {
    missionId?: string | null
    missionLimit?: number
    eventLimit?: number
    feedLimit?: number
    reportLimit?: number
  } = {}): Promise<MissionLifecycleProjection> {
    const missionId = optionsArg.missionId?.trim() || null
    const [recordProjection, events, reports] = await Promise.all([
      listMissionRecordsForProjection(optionsArg.missionLimit || 500),
      options.readMissionEvents<MissionLifecycleEvent>(optionsArg.eventLimit || 1000).catch(() => []),
      listMissionReports(optionsArg.reportLimit || 100),
    ])
    const projectedMissions = missionId
      ? recordProjection.missions.filter((mission) => mission.id === missionId)
      : recordProjection.missions
    const projectedEvents = (missionId ? events.filter((event) => event.missionId === missionId) : events)
      .slice(-Math.max(1, Math.min(1000, Math.round(optionsArg.eventLimit || 300))))
    const projectedReports = missionId
      ? reports.filter((report) => report.missionId === missionId)
      : reports
    const feed = mergeMissionFeedEvents(projectedEvents, optionsArg.feedLimit || 120, missionId)
    return {
      generatedAt: isoNow(),
      missions: projectedMissions.map((mission) => missionView(mission)),
      feed,
      events: projectedEvents,
      reports: projectedReports,
      projection: {
        source: 'memory+ledger',
        missionCount: projectedMissions.length,
        activeMissionCount: projectedMissions.filter((mission) => mission.status === 'active').length,
        feedCount: feed.length,
        eventCount: projectedEvents.length,
        reportCount: projectedReports.length,
        durableRecordCount: recordProjection.durableRecordCount,
        memoryRecordCount: recordProjection.memoryRecordCount,
      },
    }
  }

  return {
    buildMissionLifecycleProjection,
    buildMissionReport,
    listMissionRecordsForProjection,
    listMissionReports,
    mergeMissionFeedEvents,
    recordMissionReport,
  }
}

export type MissionReportService = ReturnType<typeof createMissionReportService>

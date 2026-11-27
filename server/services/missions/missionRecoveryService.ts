import type {
  Mission,
  MissionCronCleanupSummary,
  MissionCronJob,
  MissionFeedEvent,
  MissionRecordSnapshot,
  MissionStatus,
  TeamSyncAssignment,
} from './missionStateService'
import { normalizeMissionRecordSnapshot } from './missionReportService'

export type MissionCronReconciliationSnapshot = {
  available: boolean
  activeCronIds: Set<string>
  disabledCronIds: Set<string>
  knownCronIds: Set<string>
  error?: string
}

export type MissionRuntimeReconciliationStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'aborted'
  | 'interrupted'
  | 'unknown'

export type MissionGatewaySessionReconciliationStatus = 'verified' | 'missing' | 'unavailable' | 'not-checked'

export type MissionGatewaySessionReconciliationDetail = {
  jobId: string
  cronId: string
  agentId: string
  runtimeRunId: string | null
  cronRunId: string | null
  sessionId: string | null
  sessionKey: string | null
  gatewayStatus: MissionGatewaySessionReconciliationStatus
  runtimeStatus: MissionRuntimeReconciliationStatus
  detail?: string
}

export type MissionGatewaySessionReconciliationResult = {
  available: boolean
  checked: number
  sessionChecked: number
  verified: number
  missing: number
  unavailable: number
  notChecked: number
  runtimeRunning: number
  runtimeCompleted: number
  runtimeFailed: number
  runtimeTimedOut: number
  runtimeAborted: number
  runtimeInterrupted: number
  runtimeUnknown: number
  details: MissionGatewaySessionReconciliationDetail[]
  error?: string
}

type GatewayClientState = {
  client: {
    request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>
  }
}

export type MissionRecoveryServiceOptions = {
  cleanupMissionCronJobs?: (mission: Mission) => Promise<MissionCronCleanupSummary>
  clearMissionController: (missionId: string) => void
  clearShiftRuntimeStateForCronId: (cronId: string) => void
  completeCronMission?: (
    mission: Mission,
    status: MissionStatus,
    note: string,
    assignments: TeamSyncAssignment[],
    activity: string[],
  ) => Promise<void>
  controlCenterStartedAtMs: number
  ensureGatewayClient: (signal?: AbortSignal) => Promise<GatewayClientState>
  getRuntimeRunStatus: (runId: string | null | undefined) => MissionRuntimeReconciliationStatus
  listMissionCronReconciliationSnapshot: () => MissionCronReconciliationSnapshot
  missionCronJobNeedsRecovery: (job: MissionCronJob) => boolean
  missions: Map<string, Mission>
  persistMissionRecord: (mission: Mission, reason: string) => void
  pushGatewayLog: (channel: 'channel' | 'gateway' | 'stdout' | 'stderr' | 'lifecycle', message: string) => void
  pushMissionEvent: (event: Omit<MissionFeedEvent, 'id' | 'at'>) => MissionFeedEvent
  readMissionRecords: <T>(limit: number) => Promise<T[]>
  recordMissionReport: (mission: Mission) => unknown
  redactSensitiveText: (text: string) => string
  rehydrateRecurringMissionShifts: (mission: Mission, cronState: MissionCronReconciliationSnapshot) => void
  armRehydratedMissionTimer: (mission: Mission, assignments: TeamSyncAssignment[], activity: string[]) => void
  transitionMissionState: (
    mission: Mission,
    nextState: Mission['lifecycleState'],
    type: MissionFeedEvent['type'],
    message: string,
    options?: {
      actor?: string
      idempotencyKey?: string
      evidence?: Record<string, unknown>
    },
  ) => unknown
  trimTask: (text: string, maxLength?: number) => string
  now?: () => Date
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function statusCounterName(status: MissionRuntimeReconciliationStatus) {
  if (status === 'running') return 'runtimeRunning'
  if (status === 'completed') return 'runtimeCompleted'
  if (status === 'failed') return 'runtimeFailed'
  if (status === 'timeout') return 'runtimeTimedOut'
  if (status === 'aborted') return 'runtimeAborted'
  if (status === 'interrupted') return 'runtimeInterrupted'
  return 'runtimeUnknown'
}

export function createMissionRecoveryService(options: MissionRecoveryServiceOptions) {
  const now = () => options.now?.() || new Date()
  const isoNow = () => now().toISOString()
  const pendingRecoveryReports = new Map<string, Promise<unknown>>()

  function missionAssignmentsFromRecord(mission: Mission): TeamSyncAssignment[] {
    const terminalStatus = mission.status === 'completed' ? 'completed' : mission.status === 'cancelled' ? 'cancelled' : 'queued'
    return mission.party.map((agentId) => ({
      agentId,
      task: mission.brief,
      status: terminalStatus,
      updatedAt: isoNow(),
      note: `rehydrated mission record (${mission.lifecycleState})`,
    }))
  }

  function redactedRecoveryDetail(value: unknown, maxLength = 500) {
    return options.redactSensitiveText(options.trimTask(String(value || ''), maxLength))
  }

  function missionRecoveryCleanupFailureSummary(error: unknown, jobs: MissionCronJob[] = []): MissionCronCleanupSummary {
    const detail = redactedRecoveryDetail(error, 500)
    if (!jobs.length) {
      return {
        attempted: 0,
        removed: 0,
        disabled: 0,
        failed: 1,
        results: [{
          jobId: 'unknown',
          cronId: 'unknown',
          agentId: 'unknown',
          previousStatus: 'failed',
          status: 'failed',
          ok: false,
          action: 'unchanged',
          detail,
        }],
      }
    }
    return {
      attempted: jobs.length,
      removed: 0,
      disabled: 0,
      failed: jobs.length,
      results: jobs.map((job) => ({
        jobId: job.id,
        cronId: job.cronId,
        agentId: job.agentId,
        previousStatus: job.status,
        status: job.status,
        ok: false,
        action: 'unchanged' as const,
        detail,
      })),
    }
  }

  function isMissionDeadlineElapsed(mission: Mission) {
    if (typeof mission.endAt !== 'string' || !mission.endAt.trim()) return false
    const endAtMs = Date.parse(mission.endAt)
    return Number.isFinite(endAtMs) && endAtMs <= now().getTime()
  }

  async function completeExpiredRehydratedMission(
    mission: Mission,
    cronState: MissionCronReconciliationSnapshot,
    activity: string[],
  ) {
    const endedAt = isoNow()
    const hasExternalCleanup = Boolean(options.completeCronMission || options.cleanupMissionCronJobs)
    if (cronState.available) {
      for (const job of mission.scheduler.jobs) {
        if (!options.missionCronJobNeedsRecovery(job)) continue
        if (!cronState.knownCronIds.has(job.cronId)) {
          job.status = 'removed'
          job.endedAt ||= endedAt
          job.summary ||= 'OpenClaw cron job auto-expired before restart recovery.'
          options.clearShiftRuntimeStateForCronId(job.cronId)
          continue
        }
        if (!hasExternalCleanup) {
          job.status = cronState.disabledCronIds.has(job.cronId) ? 'disabled' : 'removed'
          job.endedAt ||= endedAt
          job.summary ||= 'OpenClaw cron job finalized after shift deadline elapsed.'
          options.clearShiftRuntimeStateForCronId(job.cronId)
        }
      }
    } else if (!hasExternalCleanup) {
      for (const job of mission.scheduler.jobs) {
        if (!options.missionCronJobNeedsRecovery(job)) continue
        options.clearShiftRuntimeStateForCronId(job.cronId)
      }
    }

    const note = `Mission completed during restart recovery: ${mission.title}`
    const completedAssignments: TeamSyncAssignment[] = mission.party.map((agentId) => ({
      agentId,
      task: mission.brief,
      status: 'completed',
      updatedAt: endedAt,
      note,
    }))

    if (options.completeCronMission) {
      await options.completeCronMission(mission, 'completed', note, completedAssignments, activity)
      return
    }

    options.clearMissionController(mission.id)
    mission.status = 'completed'
    mission.completedAt = endedAt
    mission.endAt ||= endedAt
    mission.scheduler.status = 'completed'
    mission.scheduler.nextRoundAt = null
    mission.scheduler.activeJobId = null
    const pendingJobs = mission.scheduler.jobs.filter(options.missionCronJobNeedsRecovery)
    const cleanup = options.cleanupMissionCronJobs
      ? await options.cleanupMissionCronJobs(mission).catch((error) => missionRecoveryCleanupFailureSummary(error, pendingJobs))
      : undefined
    if (cleanup && cleanup.failed > 0) {
      mission.scheduler.status = 'failed'
      mission.scheduler.lastError = `Mission cron cleanup failed for ${cleanup.failed} job(s).`
      options.pushMissionEvent({
        missionId: mission.id,
        type: 'agent_update',
        message: mission.scheduler.lastError,
        actor: 'recovery',
        evidence: { cleanup },
      })
    }
    options.transitionMissionState(mission, 'completed', 'mission_completed', note, {
      actor: 'recovery',
      idempotencyKey: `${mission.id}:deadline-completed:${options.controlCenterStartedAtMs}`,
      evidence: {
        round: mission.scheduler.round,
        jobs: mission.scheduler.jobs.length,
        failedJobs: mission.scheduler.jobs.filter((job) => job.status === 'failed').length,
        ...(cleanup ? { cleanup } : {}),
      },
    })
    await Promise.resolve(options.recordMissionReport(mission)).catch((error) => {
      options.pushGatewayLog('stderr', `mission recovery report write failed for ${mission.id}: ${redactedRecoveryDetail(error)}`)
    })
  }

  function failRehydratedMissionScheduler(
    mission: Mission,
    reason: string,
    evidence: {
      missingCronIds: string[]
      disabledCronIds: string[]
      affectedJobIds: string[]
      survivingCronIds?: string[]
    },
  ) {
    const completedAt = isoNow()
    mission.status = 'cancelled'
    mission.completedAt = completedAt
    mission.endAt ||= completedAt
    mission.scheduler.status = 'failed'
    mission.scheduler.nextRoundAt = null
    mission.scheduler.activeJobId = null
    mission.scheduler.lastError = reason
    options.clearMissionController(mission.id)
    options.transitionMissionState(mission, 'failed', 'mission_cancelled', `Mission scheduler reconciliation failed: ${reason}`, {
      actor: 'recovery',
      idempotencyKey: `${mission.id}:cron-reconciliation-failed:${options.controlCenterStartedAtMs}`,
      evidence,
    })
    const reportPromise = Promise.resolve(options.recordMissionReport(mission))
      .catch((error) => {
        options.pushGatewayLog('stderr', `mission recovery report write failed for ${mission.id}: ${redactedRecoveryDetail(error)}`)
      })
      .finally(() => {
        if (pendingRecoveryReports.get(mission.id) === reportPromise) {
          pendingRecoveryReports.delete(mission.id)
        }
      })
    pendingRecoveryReports.set(mission.id, reportPromise)
  }

  async function cleanupSurvivingMissionCronJobs(mission: Mission): Promise<MissionCronCleanupSummary | null> {
    const survivingJobs = mission.scheduler.jobs.filter(options.missionCronJobNeedsRecovery)
    if (!survivingJobs.length) return null
    const survivingCronIds = survivingJobs.map((job) => job.cronId)

    if (!options.cleanupMissionCronJobs) {
      for (const job of survivingJobs) {
        options.clearShiftRuntimeStateForCronId(job.cronId)
      }
      return null
    }

    const cleanup = await options.cleanupMissionCronJobs(mission).catch((error) =>
      missionRecoveryCleanupFailureSummary(error, survivingJobs))
    const endedAt = isoNow()
    for (const job of survivingJobs) {
      if (job.status === 'removed' || job.status === 'disabled') {
        job.endedAt ||= endedAt
        job.summary ||= 'OpenClaw cron job removed after partial scheduler recovery failure.'
      }
    }
    if (cleanup.failed > 0) {
      const cleanupDetail = `orphan cron cleanup failed for ${cleanup.failed} surviving job(s)`
      mission.scheduler.lastError = mission.scheduler.lastError
        ? `${mission.scheduler.lastError}; ${cleanupDetail}`
        : cleanupDetail
    }
    options.pushMissionEvent({
      missionId: mission.id,
      type: 'agent_update',
      message: cleanup.failed > 0
        ? `Orphan cron cleanup failed for ${cleanup.failed} surviving job(s) on ${mission.title}.`
        : `Cleaned up ${survivingCronIds.length} surviving OpenClaw cron job(s) after partial scheduler recovery failure on ${mission.title}.`,
      actor: 'recovery',
      previousState: mission.lifecycleState,
      nextState: mission.lifecycleState,
      idempotencyKey: `${mission.id}:orphan-cron-cleanup:${options.controlCenterStartedAtMs}`,
      evidence: {
        survivingCronIds,
        cleanup,
      },
    })
    options.persistMissionRecord(mission, 'orphan-cron-cleanup')
    await Promise.resolve(options.recordMissionReport(mission)).catch((error) => {
      options.pushGatewayLog('stderr', `mission recovery report refresh failed for ${mission.id}: ${redactedRecoveryDetail(error)}`)
    })
    return cleanup
  }

  function reconcileRehydratedMissionCronJobs(mission: Mission, cronState: MissionCronReconciliationSnapshot) {
    const pendingJobs = mission.scheduler.jobs.filter(options.missionCronJobNeedsRecovery)
    if (!pendingJobs.length) return true

    if (!cronState.available) {
      const detail = redactedRecoveryDetail(cronState.error || 'OpenClaw cron state unavailable')
      options.pushGatewayLog('lifecycle', `mission cron reconciliation skipped for ${mission.id}: ${detail}`)
      return true
    }

    const missingCronIds: string[] = []
    const disabledCronIds: string[] = []
    const affectedJobIds: string[] = []
    const survivingCronIds: string[] = []
    const endedAt = isoNow()

    for (const job of pendingJobs) {
      if (cronState.activeCronIds.has(job.cronId)) {
        survivingCronIds.push(job.cronId)
        continue
      }
      affectedJobIds.push(job.id)
      if (cronState.disabledCronIds.has(job.cronId)) {
        disabledCronIds.push(job.cronId)
        job.status = 'disabled'
        job.summary = 'OpenClaw cron job was disabled during startup reconciliation.'
      } else {
        missingCronIds.push(job.cronId)
        job.status = 'removed'
        job.summary = 'OpenClaw cron job was missing during startup reconciliation.'
      }
      job.endedAt ||= endedAt
      options.clearShiftRuntimeStateForCronId(job.cronId)
    }

    if (!affectedJobIds.length) return true

    const reason = [
      missingCronIds.length ? `${missingCronIds.length} missing cron job(s)` : '',
      disabledCronIds.length ? `${disabledCronIds.length} disabled cron job(s)` : '',
    ].filter(Boolean).join('; ')
    failRehydratedMissionScheduler(mission, reason || 'mission cron jobs are no longer active', {
      missingCronIds,
      disabledCronIds,
      affectedJobIds,
      ...(survivingCronIds.length ? { survivingCronIds } : {}),
    })
    return false
  }

  function missionGatewaySessionReconciliationCandidates(mission: Mission) {
    return mission.scheduler.jobs
      .filter(options.missionCronJobNeedsRecovery)
      .filter((job) => Boolean(job.runtimeRunId || job.cronRunId || job.sessionId || job.sessionKey))
      .slice(0, 80)
  }

  function gatewayErrorLooksNotFound(error: unknown) {
    const record = isLooseRecord(error) ? error : {}
    const code = typeof record.gatewayCode === 'string' ? record.gatewayCode : typeof record.code === 'string' ? record.code : ''
    const message = error instanceof Error ? error.message : String(error || '')
    return /not[_-]?found|missing|unknown/i.test(code) || /\b(not\s*found|missing|unknown)\b/i.test(message)
  }

  function missionGatewaySessionDetail(
    job: MissionCronJob,
    gatewayStatus: MissionGatewaySessionReconciliationStatus,
    runtimeStatus: MissionRuntimeReconciliationStatus,
    detail?: string,
  ): MissionGatewaySessionReconciliationDetail {
    return {
      jobId: job.id,
      cronId: job.cronId,
      agentId: job.agentId,
      runtimeRunId: job.runtimeRunId,
      cronRunId: job.cronRunId,
      sessionId: job.sessionId,
      sessionKey: job.sessionKey,
      gatewayStatus,
      runtimeStatus,
      ...(detail ? { detail: redactedRecoveryDetail(detail, 500) } : {}),
    }
  }

  function summarizeMissionGatewaySessionReconciliation(
    details: MissionGatewaySessionReconciliationDetail[],
    gatewayAvailable: boolean,
    error?: string,
  ): MissionGatewaySessionReconciliationResult {
    const result: MissionGatewaySessionReconciliationResult = {
      available: gatewayAvailable,
      checked: details.length,
      sessionChecked: details.filter((detail) => Boolean(detail.sessionKey)).length,
      verified: details.filter((detail) => detail.gatewayStatus === 'verified').length,
      missing: details.filter((detail) => detail.gatewayStatus === 'missing').length,
      unavailable: details.filter((detail) => detail.gatewayStatus === 'unavailable').length,
      notChecked: details.filter((detail) => detail.gatewayStatus === 'not-checked').length,
      runtimeRunning: 0,
      runtimeCompleted: 0,
      runtimeFailed: 0,
      runtimeTimedOut: 0,
      runtimeAborted: 0,
      runtimeInterrupted: 0,
      runtimeUnknown: 0,
      details,
    }
    for (const detail of details) {
      result[statusCounterName(detail.runtimeStatus)] += 1
    }
    if (error) result.error = redactedRecoveryDetail(error, 500)
    return result
  }

  function missionGatewaySessionReconciliationMessage(mission: Mission, result: MissionGatewaySessionReconciliationResult) {
    if (!result.checked) return ''
    if (!result.available) {
      return `Mission Gateway session reconciliation deferred for ${mission.title}: Gateway unavailable for ${result.sessionChecked} session reference(s)`
    }
    const parts = [
      `${result.checked} referenced job(s) checked`,
      result.verified ? `${result.verified} session(s) verified` : '',
      result.missing ? `${result.missing} session(s) missing` : '',
      result.notChecked ? `${result.notChecked} job(s) without session key` : '',
      result.runtimeInterrupted ? `${result.runtimeInterrupted} runtime run(s) interrupted` : '',
      result.runtimeTimedOut ? `${result.runtimeTimedOut} runtime run(s) timed out` : '',
      result.runtimeFailed ? `${result.runtimeFailed} runtime run(s) failed` : '',
    ].filter(Boolean)
    return `Mission Gateway session reconciliation for ${mission.title}: ${parts.join('; ')}`
  }

  function shouldRecordMissionGatewaySessionReconciliation(result: MissionGatewaySessionReconciliationResult) {
    return result.checked > 0 || !result.available || Boolean(result.error)
  }

  async function reconcileMissionGatewaySessions(mission: Mission): Promise<MissionGatewaySessionReconciliationResult> {
    const candidates = missionGatewaySessionReconciliationCandidates(mission)
    if (!candidates.length) return summarizeMissionGatewaySessionReconciliation([], true)

    const runtimeStatuses = new Map<string, MissionRuntimeReconciliationStatus>()
    for (const job of candidates) {
      runtimeStatuses.set(job.id, options.getRuntimeRunStatus(job.runtimeRunId) || 'unknown')
    }

    const jobsWithSessionKeys = candidates.filter((job) => Boolean(job.sessionKey))
    if (!jobsWithSessionKeys.length) {
      return summarizeMissionGatewaySessionReconciliation(
        candidates.map((job) => missionGatewaySessionDetail(job, 'not-checked', runtimeStatuses.get(job.id) || 'unknown', 'No durable Gateway session key was recorded for this job.')),
        true,
      )
    }

    let state: GatewayClientState
    try {
      state = await options.ensureGatewayClient(AbortSignal.timeout(5_000))
    } catch (error) {
      const detail = redactedRecoveryDetail(error)
      return summarizeMissionGatewaySessionReconciliation(
        candidates.map((job) => missionGatewaySessionDetail(
          job,
          job.sessionKey ? 'unavailable' : 'not-checked',
          runtimeStatuses.get(job.id) || 'unknown',
          job.sessionKey ? detail : 'No durable Gateway session key was recorded for this job.',
        )),
        false,
        detail,
      )
    }

    const details: MissionGatewaySessionReconciliationDetail[] = new Array(candidates.length)
    const sessionLookups = new Map<string, Promise<{ status: MissionGatewaySessionReconciliationStatus; detail?: string }>>()
    const deadline = Date.now() + 10_000
    let adapterTimedOut = false
    let nextIndex = 0
    async function describeSession(sessionKey: string): Promise<{ status: MissionGatewaySessionReconciliationStatus; detail?: string }> {
      const shared = sessionLookups.get(sessionKey)
      if (shared) return shared
      const pending = (async () => {
        const remaining = deadline - Date.now()
        if (remaining <= 0 || adapterTimedOut) return { status: 'unavailable' as const, detail: 'Session recovery deadline reached; retry reconciliation.' }
        const timeoutMs = Math.min(3_000, remaining)
        let timer: NodeJS.Timeout | undefined
        try {
          // The outer deadline also covers adapters that fail to honor timeoutMs.
          const payload = await Promise.race([
            state.client.request('sessions.describe', { key: sessionKey }, { timeoutMs }),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
              // An adapter ignoring its timeout may still hold a request slot.
              // Leave queued sessions retryable rather than increasing load.
              adapterTimedOut = true
              reject(new Error('Session recovery timed out.'))
            }, timeoutMs) }),
          ])
          if (isLooseRecord(payload) && payload.ok === false) {
            const detail = typeof payload.error === 'string' ? payload.error : 'sessions.describe returned ok=false'
            return { status: gatewayErrorLooksNotFound(detail) ? 'missing' as const : 'unavailable' as const, detail }
          }
          return { status: 'verified' as const }
        } catch (error) {
          return { status: gatewayErrorLooksNotFound(error) ? 'missing' as const : 'unavailable' as const, detail: String(error) }
        } finally {
          if (timer) clearTimeout(timer)
        }
      })()
      sessionLookups.set(sessionKey, pending)
      return pending
    }
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++
        const job = candidates[index]
        const runtimeStatus = runtimeStatuses.get(job.id) || 'unknown'
        if (!job.sessionKey) {
          details[index] = missionGatewaySessionDetail(job, 'not-checked', runtimeStatus, 'No durable Gateway session key was recorded for this job.')
          continue
        }
        const result = await describeSession(job.sessionKey)
        details[index] = missionGatewaySessionDetail(job, result.status, runtimeStatus, result.detail)
      }
    }))

    return summarizeMissionGatewaySessionReconciliation(details, details.every((detail) => detail.gatewayStatus !== 'unavailable'))
  }

  async function hydrateMissionRecordsFromLedger() {
    const records = await options.readMissionRecords<MissionRecordSnapshot>(500)
    if (!records.length) return
    const latestByMission = new Map<string, Mission>()
    for (const record of records) {
      const mission = normalizeMissionRecordSnapshot(record)
      if (!mission) continue
      latestByMission.set(mission.id, mission)
    }
    let restored = 0
    let activeRestored = 0
    const cronState = options.listMissionCronReconciliationSnapshot()
    for (const mission of latestByMission.values()) {
      options.missions.set(mission.id, mission)
      restored += 1
      if (mission.status === 'active') {
        try {
          const activity = [`${isoNow()} | mission rehydrated from durable record`]
          if (isMissionDeadlineElapsed(mission)) {
            await completeExpiredRehydratedMission(mission, cronState, activity)
            continue
          }
          const assignments = missionAssignmentsFromRecord(mission)
          const schedulerRecovered = reconcileRehydratedMissionCronJobs(mission, cronState)
          if (!schedulerRecovered) {
            await pendingRecoveryReports.get(mission.id)
            await cleanupSurvivingMissionCronJobs(mission)
            continue
          }
          activeRestored += 1
          const gatewaySessionReconciliation = await reconcileMissionGatewaySessions(mission)
          if (shouldRecordMissionGatewaySessionReconciliation(gatewaySessionReconciliation)) {
            options.pushMissionEvent({
              missionId: mission.id,
              type: 'agent_update',
              message: missionGatewaySessionReconciliationMessage(mission, gatewaySessionReconciliation),
              actor: 'recovery',
              previousState: mission.lifecycleState,
              nextState: mission.lifecycleState,
              idempotencyKey: `${mission.id}:gateway-session-reconciled:${options.controlCenterStartedAtMs}`,
              evidence: {
                gatewaySessionReconciliation,
              },
            })
            options.persistMissionRecord(mission, 'gateway-session-reconciled')
          }
          options.rehydrateRecurringMissionShifts(mission, cronState)
          options.armRehydratedMissionTimer(mission, assignments, activity)
          options.pushMissionEvent({
            missionId: mission.id,
            type: 'agent_update',
            message: `Mission rehydrated from durable record: ${mission.title}`,
            actor: 'recovery',
            previousState: mission.lifecycleState,
            nextState: mission.lifecycleState,
            idempotencyKey: `${mission.id}:rehydrated:${options.controlCenterStartedAtMs}`,
            evidence: {
              schedulerStatus: mission.scheduler.status,
              jobs: mission.scheduler.jobs.length,
              cronReconciliation: cronState.available ? 'verified' : 'unavailable',
              ...(cronState.error ? { cronReconciliationError: redactedRecoveryDetail(cronState.error) } : {}),
            },
          })
        } catch (error) {
          options.pushGatewayLog('stderr', `mission recovery failed for ${mission.id}: ${redactedRecoveryDetail(error)}`)
        }
      }
    }
    if (restored) {
      options.pushGatewayLog('lifecycle', `rehydrated ${restored} mission record(s) from the ledger after restart (${activeRestored} active)`)
    }
  }

  return {
    cleanupSurvivingMissionCronJobs,
    completeExpiredRehydratedMission,
    failRehydratedMissionScheduler,
    hydrateMissionRecordsFromLedger,
    isMissionDeadlineElapsed,
    missionAssignmentsFromRecord,
    missionGatewaySessionReconciliationMessage,
    reconcileMissionGatewaySessions,
    reconcileRehydratedMissionCronJobs,
    shouldRecordMissionGatewaySessionReconciliation,
    summarizeMissionGatewaySessionReconciliation,
  }
}

export type MissionRecoveryService = ReturnType<typeof createMissionRecoveryService>

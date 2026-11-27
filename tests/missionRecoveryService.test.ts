import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMissionRecoveryService,
  type MissionCronReconciliationSnapshot,
} from '../server/services/missions/missionRecoveryService'
import {
  missionRecordSnapshot,
  missionSchedulerInitialState,
  type Mission,
  type MissionCronCleanupSummary,
  type MissionCronJob,
  type MissionFeedEvent,
  type MissionLifecycleState,
  type MissionStatus,
  type TeamSyncAssignment,
} from '../server/services/missions/missionStateService'

function makeJob(overrides: Partial<MissionCronJob> = {}): MissionCronJob {
  return {
    id: overrides.id || 'job-1',
    cronId: overrides.cronId || 'cron-1',
    missionId: overrides.missionId || 'mission-1',
    agentId: overrides.agentId || 'agent-a',
    role: overrides.role || 'leader',
    round: overrides.round ?? 1,
    name: overrides.name || 'mission-test-agent-a',
    status: overrides.status || 'created',
    createdAt: overrides.createdAt || '2026-06-30T11:55:00.000Z',
    startedAt: overrides.startedAt ?? null,
    endedAt: overrides.endedAt ?? null,
    summary: overrides.summary ?? null,
    runtimeRunId: overrides.runtimeRunId ?? null,
    cronRunId: overrides.cronRunId ?? null,
    sessionId: overrides.sessionId ?? null,
    sessionKey: overrides.sessionKey ?? null,
  }
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  const party = overrides.party || ['agent-a']
  return {
    id: overrides.id || 'mission-1',
    title: overrides.title || 'Recovered mission',
    brief: overrides.brief || 'Prove mission recovery behavior.',
    mode: overrides.mode || 'hours',
    amount: overrides.amount ?? 1,
    startAt: overrides.startAt || '2026-06-30T11:50:00.000Z',
    endAt: overrides.endAt ?? '2026-06-30T13:00:00.000Z',
    status: overrides.status || 'active',
    lifecycleState: overrides.lifecycleState || 'running',
    party,
    createdAt: overrides.createdAt || '2026-06-30T11:50:00.000Z',
    completedAt: overrides.completedAt ?? null,
    scheduler: overrides.scheduler || missionSchedulerInitialState({ party, cadenceSeconds: overrides.cadenceSeconds }),
    ...overrides,
  }
}

function availableCronState(activeCronIds: string[] = [], disabledCronIds: string[] = []): MissionCronReconciliationSnapshot {
  return {
    available: true,
    activeCronIds: new Set(activeCronIds),
    disabledCronIds: new Set(disabledCronIds),
    knownCronIds: new Set([...activeCronIds, ...disabledCronIds]),
  }
}

function unavailableCronState(error = 'OpenClaw cron state unavailable with secret-token'): MissionCronReconciliationSnapshot {
  return {
    available: false,
    activeCronIds: new Set(),
    disabledCronIds: new Set(),
    knownCronIds: new Set(),
    error,
  }
}

function createHarness(overrides: Partial<{
  cleanupMissionCronJobs: (mission: Mission) => Promise<MissionCronCleanupSummary>
  completeCronMission: (
    mission: Mission,
    status: MissionStatus,
    note: string,
    assignments: TeamSyncAssignment[],
    activity: string[],
  ) => Promise<void>
  cronState: MissionCronReconciliationSnapshot
  ensureGatewayClient: () => Promise<{ client: { request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown> } }>
  getRuntimeRunStatus: (runId: string | null | undefined) => 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted' | 'unknown'
  recordMissionReport: (mission: Mission) => unknown
}> = {}) {
  const missions = new Map<string, Mission>()
  const state = {
    armedTimers: [] as Array<{ mission: Mission; assignments: TeamSyncAssignment[]; activity: string[] }>,
    cleanupCalls: [] as string[],
    clearedControllers: [] as string[],
    clearedCronIds: [] as string[],
    completedCronMissions: [] as Array<{ mission: Mission; status: MissionStatus; note: string; assignments: TeamSyncAssignment[]; activity: string[] }>,
    events: [] as Array<Omit<MissionFeedEvent, 'id' | 'at'>>,
    gatewayRequests: [] as Array<{ method: string; params?: Record<string, unknown>; options?: { timeoutMs?: number } }>,
    logs: [] as Array<{ channel: string; message: string }>,
    persisted: [] as Array<{ missionId: string; reason: string }>,
    readRecords: [] as unknown[],
    reports: [] as Mission[],
    shifts: [] as Array<{ mission: Mission; cronState: MissionCronReconciliationSnapshot }>,
    transitions: [] as Array<{ missionId: string; previousState: MissionLifecycleState; nextState: MissionLifecycleState; type: MissionFeedEvent['type']; message: string; options?: unknown }>,
  }
  const service = createMissionRecoveryService({
    ...(overrides.cleanupMissionCronJobs
      ? {
          cleanupMissionCronJobs: async (mission) => {
            state.cleanupCalls.push(mission.id)
            return overrides.cleanupMissionCronJobs!(mission)
          },
        }
      : {}),
    clearMissionController: (missionId) => {
      state.clearedControllers.push(missionId)
    },
    clearShiftRuntimeStateForCronId: (cronId) => {
      state.clearedCronIds.push(cronId)
    },
    ...(overrides.completeCronMission
      ? {
          completeCronMission: async (mission, status, note, assignments, activity) => {
            state.completedCronMissions.push({ mission, status, note, assignments, activity })
            await overrides.completeCronMission!(mission, status, note, assignments, activity)
          },
        }
      : {}),
    controlCenterStartedAtMs: Date.parse('2026-06-30T12:00:00.000Z'),
    ensureGatewayClient: overrides.ensureGatewayClient || (async () => ({
      client: {
        request: async (method, params, options) => {
          state.gatewayRequests.push({ method, params, options })
          return { ok: true }
        },
      },
    })),
    getRuntimeRunStatus: overrides.getRuntimeRunStatus || (() => 'unknown'),
    listMissionCronReconciliationSnapshot: () => overrides.cronState || availableCronState(['cron-1']),
    missionCronJobNeedsRecovery: (job) => job.status === 'created' || job.status === 'running',
    missions,
    persistMissionRecord: (mission, reason) => {
      state.persisted.push({ missionId: mission.id, reason })
    },
    pushGatewayLog: (channel, message) => {
      state.logs.push({ channel, message })
    },
    pushMissionEvent: (event) => {
      state.events.push(event)
      return {
        id: `event-${state.events.length}`,
        at: '2026-06-30T12:00:00.000Z',
        ...event,
      }
    },
    readMissionRecords: async <T>(limit: number) => state.readRecords.slice(0, limit) as T[],
    recordMissionReport: overrides.recordMissionReport || ((mission) => {
      state.reports.push({ ...mission, scheduler: { ...mission.scheduler, jobs: mission.scheduler.jobs.map((job) => ({ ...job })) } })
      return { missionId: mission.id }
    }),
    redactSensitiveText: (text) => text.replace(/secret-token/gi, '[REDACTED]'),
    rehydrateRecurringMissionShifts: (mission, cronState) => {
      state.shifts.push({ mission, cronState })
    },
    armRehydratedMissionTimer: (mission, assignments, activity) => {
      state.armedTimers.push({ mission, assignments, activity })
    },
    transitionMissionState: (mission, nextState, type, message, optionsArg) => {
      const previousState = mission.lifecycleState
      mission.lifecycleState = nextState
      state.transitions.push({ missionId: mission.id, previousState, nextState, type, message, options: optionsArg })
      return { previousState, nextState }
    },
    trimTask: (text, maxLength = 180) => text.replace(/\s+/g, ' ').trim().slice(0, maxLength),
    now: () => new Date('2026-06-30T12:00:00.000Z'),
  })
  return { missions, service, state }
}

test('hydrateMissionRecordsFromLedger restores active missions and delegates recovered shifts and timers', async () => {
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-active']),
    getRuntimeRunStatus: () => 'interrupted',
  })
  const mission = makeMission({
    id: 'mission-active',
    party: ['agent-a', 'agent-b'],
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a', 'agent-b'], cadenceSeconds: 300 }),
      jobs: [makeJob({
        id: 'job-active',
        cronId: 'cron-active',
        missionId: 'mission-active',
        runtimeRunId: 'runtime-1',
        sessionId: 'session-1',
        sessionKey: 'agent:agent-a:mission-active',
      })],
    },
  })
  state.readRecords.push(missionRecordSnapshot(mission, 'test-active'))

  await service.hydrateMissionRecordsFromLedger()

  assert.equal(missions.get('mission-active')?.id, 'mission-active')
  assert.deepEqual(state.gatewayRequests, [{
    method: 'sessions.describe',
    params: { key: 'agent:agent-a:mission-active' },
    options: { timeoutMs: 3_000 },
  }])
  assert.equal(state.events.some((event) => event.idempotencyKey === 'mission-active:gateway-session-reconciled:1782820800000'), true)
  assert.equal(state.events.some((event) => event.idempotencyKey === 'mission-active:rehydrated:1782820800000'), true)
  assert.deepEqual(state.persisted, [{ missionId: 'mission-active', reason: 'gateway-session-reconciled' }])
  assert.equal(state.shifts.length, 1)
  assert.equal(state.armedTimers.length, 1)
  assert.deepEqual(state.armedTimers[0]?.assignments.map((assignment) => assignment.agentId), ['agent-a', 'agent-b'])
  assert.equal(state.logs[0]?.message, 'rehydrated 1 mission record(s) from the ledger after restart (1 active)')
})

test('reconcileRehydratedMissionCronJobs preserves recovered missions when cron jobs remain active', () => {
  const { service, state } = createHarness()
  const mission = makeMission({
    id: 'mission-active-cron',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a', 'agent-b'] }),
      status: 'running',
      activeJobId: 'job-active-a',
      jobs: [
        makeJob({ id: 'job-active-a', cronId: 'cron-active-a', missionId: 'mission-active-cron', status: 'created' }),
        makeJob({ id: 'job-active-b', cronId: 'cron-active-b', missionId: 'mission-active-cron', agentId: 'agent-b', role: 'worker', status: 'running' }),
      ],
    },
  })

  const recovered = service.reconcileRehydratedMissionCronJobs(mission, availableCronState(['cron-active-a', 'cron-active-b']))

  assert.equal(recovered, true)
  assert.equal(mission.status, 'active')
  assert.equal(mission.lifecycleState, 'running')
  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.activeJobId, 'job-active-a')
  assert.deepEqual(mission.scheduler.jobs.map((job) => job.status), ['created', 'running'])
  assert.deepEqual(state.clearedCronIds, [])
  assert.deepEqual(state.clearedControllers, [])
  assert.deepEqual(state.transitions, [])
  assert.deepEqual(state.reports, [])
  assert.deepEqual(state.logs, [])
})

test('reconcileRehydratedMissionCronJobs fails recovered missions when cron jobs disappeared', () => {
  const { service, state } = createHarness()
  const mission = makeMission({
    id: 'mission-missing-cron',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      jobs: [
        makeJob({ id: 'job-missing', cronId: 'cron-missing', missionId: 'mission-missing-cron' }),
        makeJob({ id: 'job-disabled', cronId: 'cron-disabled', missionId: 'mission-missing-cron' }),
      ],
    },
  })

  const recovered = service.reconcileRehydratedMissionCronJobs(mission, availableCronState([], ['cron-disabled']))

  assert.equal(recovered, false)
  assert.equal(mission.status, 'cancelled')
  assert.equal(mission.lifecycleState, 'failed')
  assert.equal(mission.scheduler.status, 'failed')
  assert.equal(mission.scheduler.lastError, '1 missing cron job(s); 1 disabled cron job(s)')
  assert.deepEqual(mission.scheduler.jobs.map((job) => job.status), ['removed', 'disabled'])
  assert.deepEqual(state.clearedCronIds, ['cron-missing', 'cron-disabled'])
  assert.deepEqual(state.clearedControllers, ['mission-missing-cron'])
  assert.equal(state.reports.length, 1)
  assert.equal(state.transitions[0]?.message, 'Mission scheduler reconciliation failed: 1 missing cron job(s); 1 disabled cron job(s)')
  assert.deepEqual((state.transitions[0]?.options as { evidence?: unknown } | undefined)?.evidence, {
    missingCronIds: ['cron-missing'],
    disabledCronIds: ['cron-disabled'],
    affectedJobIds: ['job-missing', 'job-disabled'],
  })
})

test('reconcileRehydratedMissionCronJobs defers unavailable cron state with redacted evidence', () => {
  const { service, state } = createHarness()
  const mission = makeMission({
    id: 'mission-cron-unavailable',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      status: 'running',
      jobs: [
        makeJob({ id: 'job-unavailable', cronId: 'cron-unavailable', missionId: 'mission-cron-unavailable', status: 'running' }),
      ],
    },
  })

  const recovered = service.reconcileRehydratedMissionCronJobs(mission, unavailableCronState())

  assert.equal(recovered, true)
  assert.equal(mission.status, 'active')
  assert.equal(mission.lifecycleState, 'running')
  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.jobs[0]?.status, 'running')
  assert.deepEqual(state.clearedCronIds, [])
  assert.deepEqual(state.transitions, [])
  assert.deepEqual(state.reports, [])
  assert.match(state.logs[0]?.message || '', /\[REDACTED\]/)
  assert.doesNotMatch(state.logs[0]?.message || '', /secret-token/i)
})

test('hydrateMissionRecordsFromLedger records redacted unavailable cron reconciliation evidence', async () => {
  const { missions, service, state } = createHarness({
    cronState: unavailableCronState('cron sqlite open failed with secret-token'),
  })
  const mission = makeMission({
    id: 'mission-unavailable-cron-hydrate',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      status: 'running',
      jobs: [
        makeJob({ id: 'job-unavailable-hydrate', cronId: 'cron-unavailable-hydrate', missionId: 'mission-unavailable-cron-hydrate', status: 'running' }),
      ],
    },
  })
  state.readRecords.push(missionRecordSnapshot(mission, 'test-unavailable-cron'))

  await service.hydrateMissionRecordsFromLedger()

  const rehydratedEvent = state.events.find((event) => event.idempotencyKey === 'mission-unavailable-cron-hydrate:rehydrated:1782820800000')
  const evidence = rehydratedEvent?.evidence as Record<string, unknown> | undefined
  assert.equal(missions.get('mission-unavailable-cron-hydrate')?.status, 'active')
  assert.equal(state.shifts.length, 1)
  assert.equal(state.armedTimers.length, 1)
  assert.equal(evidence?.cronReconciliation, 'unavailable')
  assert.match(String(evidence?.cronReconciliationError || ''), /\[REDACTED\]/)
  assert.doesNotMatch(String(evidence?.cronReconciliationError || ''), /secret-token/i)
  assert.match(state.logs[0]?.message || '', /\[REDACTED\]/)
  assert.doesNotMatch(state.logs[0]?.message || '', /secret-token/i)
})

test('reconcileMissionGatewaySessions returns redacted unavailable evidence when Gateway cannot be reached', async () => {
  const { service } = createHarness({
    ensureGatewayClient: async () => {
      throw new Error('gateway offline with secret-token')
    },
    getRuntimeRunStatus: () => 'running',
  })
  const mission = makeMission({
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      jobs: [makeJob({ runtimeRunId: 'runtime-1', sessionKey: 'agent:agent-a:mission' })],
    },
  })

  const result = await service.reconcileMissionGatewaySessions(mission)

  assert.equal(result.available, false)
  assert.equal(result.checked, 1)
  assert.equal(result.sessionChecked, 1)
  assert.equal(result.unavailable, 1)
  assert.equal(result.runtimeRunning, 1)
  assert.match(result.error || '', /\[REDACTED\]/)
  assert.match(result.details[0]?.detail || '', /\[REDACTED\]/)
})

test('reconcileMissionGatewaySessions classifies missing Gateway sessions without mutating mission state', async () => {
  const { service, state } = createHarness({
    ensureGatewayClient: async () => ({
      client: {
        request: async (method, params, options) => {
          state.gatewayRequests.push({ method, params, options })
          return { ok: false, error: 'session not found' }
        },
      },
    }),
    getRuntimeRunStatus: () => 'failed',
  })
  const mission = makeMission({
    lifecycleState: 'running',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      jobs: [makeJob({ runtimeRunId: 'runtime-1', sessionKey: 'agent:agent-a:missing' })],
    },
  })

  const result = await service.reconcileMissionGatewaySessions(mission)

  assert.equal(result.available, true)
  assert.equal(result.missing, 1)
  assert.equal(result.runtimeFailed, 1)
  assert.equal(mission.lifecycleState, 'running')
  assert.equal(mission.scheduler.jobs[0]?.status, 'created')
  assert.equal(state.gatewayRequests[0]?.method, 'sessions.describe')
})

test('recovery bounds concurrent requests and deduplicates shared Gateway sessions', async () => {
  let active = 0
  let peak = 0
  const requests: string[] = []
  const { service } = createHarness({
    ensureGatewayClient: async () => ({ client: { request: async (_method, params) => {
      active += 1
      peak = Math.max(peak, active)
      requests.push(String(params?.key))
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { ok: true }
    } } }),
  })
  const mission = makeMission()
  mission.scheduler.jobs = Array.from({ length: 20 }, (_, index) => makeJob({ id: `job-${index}`, sessionKey: `session-${index % 10}`, status: 'running' }))
  const result = await service.reconcileMissionGatewaySessions(mission)
  assert.equal(requests.length, 10)
  assert.equal(peak, 4)
  assert.equal(result.verified, 20)
  assert.deepEqual(result.details.map((detail) => detail.jobId), mission.scheduler.jobs.map((job) => job.id))
})

test('hydrateMissionRecordsFromLedger completes deadline-elapsed missions cleanly via completeCronMission when cron auto-expired offline', async () => {
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-still-active'], ['cron-disabled-offline']),
    completeCronMission: async (mission, status) => {
      mission.status = status
      mission.lifecycleState = 'completed'
      mission.completedAt = '2026-06-30T12:00:00.000Z'
      mission.scheduler.status = 'completed'
      for (const job of mission.scheduler.jobs) {
        if (job.status === 'created' || job.status === 'running') {
          job.status = 'removed'
          job.endedAt = '2026-06-30T12:00:00.000Z'
        }
      }
    },
  })
  const expiredMission = makeMission({
    id: 'mission-expired-offline',
    title: 'Overnight Shift',
    party: ['agent-a', 'agent-b', 'agent-c'],
    endAt: '2026-06-30T11:59:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a', 'agent-b', 'agent-c'] }),
      status: 'running',
      jobs: [
        makeJob({ id: 'job-expired', cronId: 'cron-auto-expired', missionId: 'mission-expired-offline', agentId: 'agent-a', status: 'running' }),
        makeJob({ id: 'job-disabled', cronId: 'cron-disabled-offline', missionId: 'mission-expired-offline', agentId: 'agent-b', role: 'worker', status: 'created' }),
        makeJob({ id: 'job-active', cronId: 'cron-still-active', missionId: 'mission-expired-offline', agentId: 'agent-c', role: 'worker', status: 'running' }),
      ],
    },
  })
  state.readRecords.push(missionRecordSnapshot(expiredMission, 'test-expired-offline'))

  await service.hydrateMissionRecordsFromLedger()

  const restored = missions.get('mission-expired-offline')
  assert.equal(restored?.status, 'completed')
  assert.equal(restored?.lifecycleState, 'completed')
  assert.equal(state.completedCronMissions.length, 1)
  assert.equal(state.completedCronMissions[0]?.status, 'completed')
  assert.equal(state.completedCronMissions[0]?.note, 'Mission completed during restart recovery: Overnight Shift')
  assert.deepEqual(state.clearedCronIds, ['cron-auto-expired'])
  assert.equal(restored?.scheduler.jobs[0]?.summary, 'OpenClaw cron job auto-expired before restart recovery.')
  assert.equal(state.shifts.length, 0)
  assert.equal(state.armedTimers.length, 0)
  assert.equal(state.events.some((event) => event.idempotencyKey?.includes(':rehydrated:')), false)
  assert.equal(state.logs[0]?.message, 'rehydrated 1 mission record(s) from the ledger after restart (0 active)')
})

test('hydrateMissionRecordsFromLedger completes deadline-elapsed missions via fallback cleanup when completeCronMission is omitted', async () => {
  let asyncReportResolved = false
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-surviving']),
    cleanupMissionCronJobs: async (mission) => {
      for (const job of mission.scheduler.jobs) {
        if (job.status === 'created' || job.status === 'running') {
          job.status = 'removed'
        }
      }
      return {
        attempted: 1,
        removed: 1,
        disabled: 0,
        failed: 0,
        results: [{
          jobId: 'job-surviving',
          cronId: 'cron-surviving',
          agentId: 'agent-a',
          previousStatus: 'running',
          status: 'removed',
          ok: true,
          action: 'removed',
          detail: null,
        }],
      }
    },
    recordMissionReport: async (mission) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      asyncReportResolved = true
      state.reports.push({ ...mission })
      return { missionId: mission.id }
    },
  })
  const expiredMission = makeMission({
    id: 'mission-expired-fallback',
    endAt: '2026-06-30T12:00:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      status: 'running',
      activeJobId: 'job-surviving',
      jobs: [makeJob({ id: 'job-surviving', cronId: 'cron-surviving', missionId: 'mission-expired-fallback', status: 'running' })],
    },
  })
  state.readRecords.push(missionRecordSnapshot(expiredMission, 'test-expired-fallback'))

  await service.hydrateMissionRecordsFromLedger()

  assert.equal(asyncReportResolved, true)
  assert.equal(missions.get('mission-expired-fallback')?.status, 'completed')
  assert.equal(missions.get('mission-expired-fallback')?.lifecycleState, 'completed')
  assert.equal(missions.get('mission-expired-fallback')?.scheduler.activeJobId, null)
  assert.deepEqual(state.cleanupCalls, ['mission-expired-fallback'])
  assert.deepEqual(state.clearedControllers, ['mission-expired-fallback'])
  assert.equal(state.transitions[0]?.nextState, 'completed')
  assert.equal(state.transitions[0]?.type, 'mission_completed')
  assert.equal(state.reports.length, 1)
})

test('hydrateMissionRecordsFromLedger awaits report write and tears down surviving zombie cron jobs on partial cron loss', async () => {
  const sequence: string[] = []
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-surviving-worker']),
    recordMissionReport: async (mission) => {
      sequence.push(`report-start:${mission.scheduler.jobs.map((job) => job.status).join(',')}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      sequence.push(`report-end:${mission.scheduler.jobs.map((job) => job.status).join(',')}`)
      state.reports.push({ ...mission, scheduler: { ...mission.scheduler, jobs: mission.scheduler.jobs.map((job) => ({ ...job })) } })
      return { missionId: mission.id }
    },
    cleanupMissionCronJobs: async (mission) => {
      sequence.push('cleanup-surviving')
      const surviving = mission.scheduler.jobs.find((job) => job.cronId === 'cron-surviving-worker')
      assert.ok(surviving)
      surviving.status = 'removed'
      return {
        attempted: 1,
        removed: 1,
        disabled: 0,
        failed: 0,
        results: [{
          jobId: surviving.id,
          cronId: surviving.cronId,
          agentId: surviving.agentId,
          previousStatus: 'running',
          status: 'removed',
          ok: true,
          action: 'removed',
          detail: null,
        }],
      }
    },
  })
  const partialLossMission = makeMission({
    id: 'mission-partial-loss',
    party: ['agent-a', 'agent-b'],
    endAt: '2026-06-30T14:00:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a', 'agent-b'] }),
      status: 'running',
      jobs: [
        makeJob({ id: 'job-lost-leader', cronId: 'cron-lost-leader', missionId: 'mission-partial-loss', agentId: 'agent-a', role: 'leader', status: 'running' }),
        makeJob({ id: 'job-surviving-worker', cronId: 'cron-surviving-worker', missionId: 'mission-partial-loss', agentId: 'agent-b', role: 'worker', status: 'running' }),
      ],
    },
  })
  state.readRecords.push(missionRecordSnapshot(partialLossMission, 'test-partial-loss'))

  await service.hydrateMissionRecordsFromLedger()

  const restored = missions.get('mission-partial-loss')
  assert.equal(restored?.status, 'cancelled')
  assert.equal(restored?.lifecycleState, 'failed')
  assert.deepEqual(restored?.scheduler.jobs.map((job) => job.status), ['removed', 'removed'])
  assert.equal(restored?.scheduler.jobs[1]?.summary, 'OpenClaw cron job removed after partial scheduler recovery failure.')
  assert.deepEqual(sequence, [
    'report-start:removed,running',
    'report-end:removed,running',
    'cleanup-surviving',
    'report-start:removed,removed',
    'report-end:removed,removed',
  ])
  assert.deepEqual((state.transitions[0]?.options as { evidence?: unknown } | undefined)?.evidence, {
    missingCronIds: ['cron-lost-leader'],
    disabledCronIds: [],
    affectedJobIds: ['job-lost-leader'],
    survivingCronIds: ['cron-surviving-worker'],
  })
  assert.equal(state.events.some((event) => event.idempotencyKey === 'mission-partial-loss:orphan-cron-cleanup:1782820800000'), true)
  assert.deepEqual(state.persisted, [{ missionId: 'mission-partial-loss', reason: 'orphan-cron-cleanup' }])
  assert.equal(state.reports.length, 2)
})

test('cleanupSurvivingMissionCronJobs records redacted error details when orphan cron cleanup fails', async () => {
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-zombie']),
    cleanupMissionCronJobs: async () => {
      throw new Error('cron rm failed with secret-token')
    },
    recordMissionReport: async () => {
      throw new Error('report disk error with secret-token')
    },
  })
  const mission = makeMission({
    id: 'mission-orphan-cleanup-error',
    party: ['agent-a', 'agent-b'],
    endAt: '2026-06-30T14:00:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a', 'agent-b'] }),
      status: 'running',
      jobs: [
        makeJob({ id: 'job-missing', cronId: 'cron-missing', missionId: 'mission-orphan-cleanup-error', agentId: 'agent-a', status: 'created' }),
        makeJob({ id: 'job-zombie', cronId: 'cron-zombie', missionId: 'mission-orphan-cleanup-error', agentId: 'agent-b', role: 'worker', status: 'running' }),
      ],
    },
  })
  state.readRecords.push(missionRecordSnapshot(mission, 'test-orphan-cleanup-error'))

  await service.hydrateMissionRecordsFromLedger()

  const restored = missions.get('mission-orphan-cleanup-error')
  assert.match(restored?.scheduler.lastError || '', /1 missing cron job\(s\); orphan cron cleanup failed for 1 surviving job\(s\)/)
  const cleanupEvent = state.events.find((event) => event.idempotencyKey === 'mission-orphan-cleanup-error:orphan-cron-cleanup:1782820800000')
  assert.ok(cleanupEvent)
  assert.doesNotMatch(JSON.stringify(cleanupEvent.evidence), /secret-token/i)
  assert.match(JSON.stringify(cleanupEvent.evidence), /\[REDACTED\]/)
  assert.equal(state.logs.filter((entry) => entry.channel === 'stderr').length >= 2, true)
  for (const entry of state.logs) {
    assert.doesNotMatch(entry.message, /secret-token/i)
  }
})

test('hydrateMissionRecordsFromLedger isolates per-mission recovery exceptions so subsequent active missions still rehydrate', async () => {
  const { missions, service, state } = createHarness({
    cronState: availableCronState(['cron-healthy']),
    completeCronMission: async (mission) => {
      if (mission.id === 'mission-expired-throws') {
        throw new Error('report write crashed with secret-token')
      }
    },
  })
  const expiredBroken = makeMission({
    id: 'mission-expired-throws',
    endAt: '2026-06-30T11:55:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      status: 'running',
      jobs: [makeJob({ id: 'job-expired-throws', cronId: 'cron-expired-throws', missionId: 'mission-expired-throws', status: 'running' })],
    },
  })
  const healthyActive = makeMission({
    id: 'mission-healthy-next',
    endAt: '2026-06-30T14:00:00.000Z',
    scheduler: {
      ...missionSchedulerInitialState({ party: ['agent-a'] }),
      status: 'running',
      jobs: [makeJob({ id: 'job-healthy', cronId: 'cron-healthy', missionId: 'mission-healthy-next', status: 'running' })],
    },
  })
  state.readRecords.push(
    missionRecordSnapshot(expiredBroken, 'test-expired-throws'),
    missionRecordSnapshot(healthyActive, 'test-healthy-next'),
  )

  await service.hydrateMissionRecordsFromLedger()

  assert.equal(missions.get('mission-healthy-next')?.status, 'active')
  assert.equal(state.shifts.length, 1)
  assert.equal(state.shifts[0]?.mission.id, 'mission-healthy-next')
  assert.equal(state.armedTimers.length, 1)
  assert.equal(state.logs.some((entry) => entry.channel === 'stderr' && entry.message.includes('mission recovery failed for mission-expired-throws')), true)
  assert.equal(state.logs.some((entry) => entry.message.includes('rehydrated 2 mission record(s) from the ledger after restart (1 active)')), true)
  for (const entry of state.logs) {
    assert.doesNotMatch(entry.message, /secret-token/i)
  }
})

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
  type MissionCronJob,
  type MissionFeedEvent,
  type MissionLifecycleState,
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

function createHarness(overrides: Partial<{
  cronState: MissionCronReconciliationSnapshot
  ensureGatewayClient: () => Promise<{ client: { request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown> } }>
  getRuntimeRunStatus: (runId: string | null | undefined) => 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted' | 'unknown'
}> = {}) {
  const missions = new Map<string, Mission>()
  const state = {
    armedTimers: [] as Array<{ mission: Mission; assignments: TeamSyncAssignment[]; activity: string[] }>,
    clearedControllers: [] as string[],
    clearedCronIds: [] as string[],
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
    clearMissionController: (missionId) => {
      state.clearedControllers.push(missionId)
    },
    clearShiftRuntimeStateForCronId: (cronId) => {
      state.clearedCronIds.push(cronId)
    },
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
    recordMissionReport: (mission) => {
      state.reports.push({ ...mission })
      return { missionId: mission.id }
    },
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

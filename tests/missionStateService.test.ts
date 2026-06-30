import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMissionStateService,
  missionSchedulerInitialState,
  type Mission,
  type MissionCronCleanupSummary,
  type MissionFeedEvent,
  type MissionLifecycleState,
  type MissionLifecycleEvent,
  type MissionRecordSnapshot,
} from '../server/services/missions/missionStateService'

function createHarness(overrides: Partial<{
  dryRun: boolean
  cleanup: MissionCronCleanupSummary
  startRecurringError: Error
}> = {}) {
  const state = {
    appendedEvents: [] as MissionLifecycleEvent[],
    appendedRecords: [] as MissionRecordSnapshot[],
    completed: [] as unknown[],
    controllersCleared: [] as string[],
    reports: [] as Mission[],
    scheduledRounds: [] as unknown[],
    snapshots: [] as unknown[],
    startRecurringCalls: [] as unknown[],
  }
  const missions = new Map<string, Mission>()
  const missionFeed: MissionFeedEvent[] = []
  const missionTimers = new Map<string, NodeJS.Timeout>()
  let id = 0
  const service = createMissionStateService({
    appendMissionEvent: async (event) => {
      state.appendedEvents.push(event)
    },
    appendMissionRecord: async (record) => {
      state.appendedRecords.push(record)
    },
    cleanupMissionCronJobs: async () => overrides.cleanup || {
      attempted: 1,
      removed: 1,
      disabled: 0,
      failed: 0,
      results: [],
    },
    clearMissionController: (missionId) => {
      state.controllersCleared.push(missionId)
    },
    completeCronMission: async (...args) => {
      state.completed.push(args)
    },
    controlCenterMissionSchedulerDryRun: overrides.dryRun ?? true,
    missionCronCleanupFailureSummary: (error) => ({
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
        detail: String(error),
      }],
    }),
    missionCronJobNeedsRecovery: (job) => job.status === 'created' || job.status === 'running',
    missionFeed,
    missions,
    missionTimers,
    now: () => new Date('2026-06-30T12:00:00.000Z'),
    persistWarning: () => undefined,
    randomId: () => `id-${++id}`,
    recordMissionReport: (mission) => {
      state.reports.push({ ...mission })
      return { missionId: mission.id }
    },
    scheduleNextMissionRound: (...args) => {
      state.scheduledRounds.push(args)
    },
    startRecurringMissionCronJobs: async (...args) => {
      state.startRecurringCalls.push(args)
      if (overrides.startRecurringError) throw overrides.startRecurringError
    },
    writeTeamSyncSnapshot: async (snapshot) => {
      state.snapshots.push(snapshot)
    },
  })

  return { service, state, missions, missionFeed, missionTimers }
}

function missionFixture(overrides: Partial<Mission> = {}): Mission {
  const party = overrides.party || ['agent-a']
  return {
    id: 'mission-fixture',
    title: 'Fixture mission',
    brief: 'Exercise mission state transitions.',
    mode: 'instant',
    amount: null,
    startAt: '2026-06-30T11:59:00.000Z',
    endAt: null,
    status: 'active',
    lifecycleState: 'running',
    party,
    createdAt: '2026-06-30T11:59:00.000Z',
    completedAt: null,
    scheduler: missionSchedulerInitialState({ party }),
    ...overrides,
  }
}

test('startMission rejects empty parties before mutating mission state', async () => {
  const { service, state, missions, missionFeed } = createHarness()

  const result = await service.startMission({
    title: 'Invalid mission',
    brief: 'No valid agents.',
    party: [' ', ''],
    mode: 'instant',
    idempotencyKey: 'invalid-key-123',
  })

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.code, 'invalid_payload')
  assert.equal(missions.size, 0)
  assert.equal(missionFeed.length, 0)
  assert.equal(state.appendedEvents.length, 0)
  assert.equal(state.appendedRecords.length, 0)
})

test('startMission creates a ledger-backed mission and dedupes repeated launch keys', async () => {
  const { service, state, missions, missionFeed } = createHarness()

  const first = await service.startMission({
    title: 'Beta mission',
    brief: 'Prepare the beta slice.',
    party: ['agent-a', 'agent-a', ' agent-b '],
    mode: 'instant',
    idempotencyKey: '  launch-key-123  ',
  })
  const second = await service.startMission({
    title: 'Duplicate mission',
    brief: 'Should not create another record.',
    party: ['agent-c'],
    mode: 'instant',
    idempotencyKey: 'launch-key-123',
  })

  assert.equal(first.ok, true)
  assert.equal(first.ok && first.deduped, false)
  assert.equal(second.ok, true)
  assert.equal(second.ok && second.deduped, true)
  assert.equal(missions.size, 1)
  assert.equal(missionFeed.length, 6)
  assert.deepEqual(first.ok && first.mission.party, ['agent-a', 'agent-b'])
  assert.equal(first.ok && first.idempotencyKey, 'launch-key-123')
  assert.equal(first.ok && first.mission.lifecycleState, 'running')
  assert.equal(state.snapshots.length, 1)
  assert.deepEqual(
    state.appendedEvents.map((event) => event.idempotencyKey),
    [
      'id-1:draft->validating',
      'id-1:validating->scheduled',
      'id-1:agent_assigned:id-4',
      'id-1:agent_assigned:id-5',
      'id-1:agent_update:id-6',
      'id-1:scheduled->running',
    ],
  )
  assert.equal(state.appendedRecords.some((record) => record.persistReason === 'scheduler-dry-run'), true)
})

test('startMission delegates instant missions to scheduler rounds when dry-run is disabled', async () => {
  const { service, state, missions, missionTimers } = createHarness({ dryRun: false })

  const result = await service.startMission({
    title: 'Instant mission',
    brief: 'Dispatch a real scheduler round.',
    party: ['agent-a'],
    mode: 'instant',
    idempotencyKey: 'instant-key-123',
  })

  assert.equal(result.ok, true)
  assert.equal(missions.size, 1)
  assert.equal(missionTimers.size, 0)
  assert.equal(state.scheduledRounds.length, 1)
  assert.equal(state.startRecurringCalls.length, 0)
  assert.equal(state.appendedEvents.at(-1)?.nextState, 'running')
  assert.equal(state.appendedRecords.at(-1)?.persistReason, 'transition:scheduled->running')
})

test('startMission arms duration timers and delegates recurring scheduler setup', async () => {
  const { service, state, missions, missionTimers } = createHarness({ dryRun: false })

  const result = await service.startMission({
    title: 'Recurring mission',
    brief: 'Arm a recurring beta mission.',
    party: ['agent-a', 'agent-b'],
    mode: 'hours',
    amount: 2,
    cadenceSeconds: 30,
    maxCycles: 3,
    idempotencyKey: 'recurring-key-123',
  })

  assert.equal(result.ok, true)
  assert.equal(missions.size, 1)
  assert.equal(missionTimers.size, 1)
  assert.equal(state.startRecurringCalls.length, 1)
  assert.equal(state.scheduledRounds.length, 0)
  const mission = Array.from(missions.values())[0]
  assert.ok(mission.endAt)
  assert.equal(mission.scheduler.maxCycles, 3)
  assert.equal(mission.scheduler.cycleIntervalMs, 30_000)
  assert.equal(state.appendedEvents.at(-1)?.nextState, 'running')
  assert.equal(state.appendedRecords.at(-1)?.persistReason, 'transition:scheduled->running')

  for (const timer of missionTimers.values()) clearTimeout(timer)
  missionTimers.clear()
})

test('startMission rolls back mission state when scheduler setup fails', async () => {
  const { service, state, missions, missionTimers } = createHarness({
    dryRun: false,
    startRecurringError: new Error('cron unavailable'),
  })

  const result = await service.startMission({
    title: 'Timed mission',
    brief: 'This should roll back.',
    party: ['agent-a'],
    mode: 'hours',
    amount: 1,
    idempotencyKey: 'timed-key-123',
  })

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.code, 'mission_scheduler_failed')
  assert.equal(missions.size, 0)
  assert.equal(missionTimers.size, 0)
  assert.equal(state.reports.length, 1)
  assert.equal(state.appendedEvents.at(-1)?.nextState, 'failed')
  assert.equal(state.appendedRecords.at(-1)?.persistReason, 'transition:scheduled->failed')
})

test('transitionMissionState persists lifecycle evidence for mission state, scheduler, and recovery edges', () => {
  const { service, state, missions, missionFeed } = createHarness()
  const transitions: Array<{
    previous: MissionLifecycleState
    next: MissionLifecycleState
    type: MissionFeedEvent['type']
  }> = [
    { previous: 'draft', next: 'validating', type: 'mission_started' },
    { previous: 'validating', next: 'scheduled', type: 'mission_started' },
    { previous: 'scheduled', next: 'running', type: 'mission_started' },
    { previous: 'scheduled', next: 'failed', type: 'mission_cancelled' },
    { previous: 'running', next: 'dispatching', type: 'agent_update' },
    { previous: 'dispatching', next: 'running', type: 'agent_update' },
    { previous: 'running', next: 'verifying', type: 'agent_update' },
    { previous: 'verifying', next: 'completed', type: 'mission_completed' },
    { previous: 'running', next: 'failed', type: 'mission_cancelled' },
    { previous: 'running', next: 'cancelled', type: 'mission_cancelled' },
  ]

  for (const [index, transition] of transitions.entries()) {
    const mission = missionFixture({
      id: `mission-transition-${index}`,
      lifecycleState: transition.previous,
    })
    missions.set(mission.id, mission)

    const result = service.transitionMissionState(
      mission,
      transition.next,
      transition.type,
      `${transition.previous} to ${transition.next}`,
      {
        actor: 'transition-test',
        idempotencyKey: `${mission.id}:${transition.previous}->${transition.next}`,
        evidence: { edge: `${transition.previous}->${transition.next}` },
      },
    )

    assert.equal(result.previousState, transition.previous)
    assert.equal(result.nextState, transition.next)
    assert.equal(mission.lifecycleState, transition.next)
    assert.equal(result.event.previousState, transition.previous)
    assert.equal(result.event.nextState, transition.next)
    assert.equal(result.event.actor, 'transition-test')
    assert.deepEqual(result.event.evidence, { edge: `${transition.previous}->${transition.next}` })
    assert.equal(state.appendedEvents.at(-1)?.idempotencyKey, `${mission.id}:${transition.previous}->${transition.next}`)
    assert.equal(state.appendedEvents.at(-1)?.actor, 'transition-test')
    assert.equal(state.appendedEvents.at(-1)?.previousState, transition.previous)
    assert.equal(state.appendedEvents.at(-1)?.nextState, transition.next)
    assert.deepEqual(state.appendedEvents.at(-1)?.evidence, { edge: `${transition.previous}->${transition.next}` })
    assert.equal(state.appendedRecords.at(-1)?.persistReason, `transition:${transition.previous}->${transition.next}`)
  }

  assert.equal(missionFeed.length, transitions.length)
  assert.equal(state.appendedEvents.length, transitions.length)
  assert.equal(state.appendedRecords.length, transitions.length)
})

test('stopMission cancels active work, records cleanup evidence, and writes Team Sync state', async () => {
  const { service, state, missions } = createHarness()
  const mission = missionFixture({
    id: 'mission-1',
    title: 'Cancelable mission',
    brief: 'Cancel this mission.',
    lifecycleState: 'running',
  })
  mission.scheduler.round = 2
  mission.scheduler.jobs.push({
    id: 'job-1',
    cronId: 'cron-1',
    missionId: mission.id,
    agentId: 'agent-a',
    role: 'leader',
    round: 2,
    name: 'mission-job',
    status: 'created',
    createdAt: '2026-06-30T11:59:00.000Z',
    startedAt: null,
    endedAt: null,
    summary: null,
    runtimeRunId: null,
    cronRunId: null,
    sessionId: null,
    sessionKey: null,
  })
  missions.set(mission.id, mission)

  const result = await service.stopMission({ missionId: mission.id, reason: 'operator test' })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.mission.status, 'cancelled')
  assert.equal(result.ok && result.cleanup.removed, 1)
  assert.deepEqual(state.controllersCleared, ['mission-1'])
  assert.equal(mission.scheduler.status, 'stopped')
  assert.equal(state.reports.length, 1)
  assert.equal(state.snapshots.length, 1)
  assert.equal(state.appendedEvents.some((event) => event.message === 'Mission cancellation requested: Cancelable mission'), true)
  assert.equal(state.appendedEvents.at(-1)?.nextState, 'cancelled')
  assert.equal(state.appendedRecords.at(-1)?.persistReason, 'transition:running->cancelled')
})

test('stopMission records failed cleanup evidence while still finalizing cancellation', async () => {
  const cleanup: MissionCronCleanupSummary = {
    attempted: 1,
    removed: 0,
    disabled: 0,
    failed: 1,
    results: [{
      jobId: 'job-1',
      cronId: 'cron-1',
      agentId: 'agent-a',
      previousStatus: 'running',
      status: 'failed',
      ok: false,
      action: 'unchanged',
      detail: 'OpenClaw cron cleanup failed',
    }],
  }
  const { service, state, missions } = createHarness({ cleanup })
  const mission = missionFixture({
    id: 'mission-cleanup-failure',
    title: 'Cleanup failure mission',
    lifecycleState: 'running',
  })
  mission.scheduler.jobs.push({
    id: 'job-1',
    cronId: 'cron-1',
    missionId: mission.id,
    agentId: 'agent-a',
    role: 'leader',
    round: 1,
    name: 'mission-job',
    status: 'running',
    createdAt: '2026-06-30T11:59:00.000Z',
    startedAt: '2026-06-30T11:59:30.000Z',
    endedAt: null,
    summary: null,
    runtimeRunId: null,
    cronRunId: null,
    sessionId: null,
    sessionKey: null,
  })
  missions.set(mission.id, mission)

  const result = await service.stopMission({ missionId: mission.id })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.cleanup.failed, 1)
  assert.equal(mission.status, 'cancelled')
  assert.equal(mission.lifecycleState, 'cancelled')
  assert.equal(mission.scheduler.status, 'failed')
  assert.equal(mission.scheduler.lastError, 'Mission cancellation cleanup failed for 1 job(s).')
  assert.equal(state.appendedEvents.some((event) => event.message === 'Mission cancellation cleanup failed for 1 cron job(s).'), true)
  assert.equal(state.appendedEvents.at(-1)?.nextState, 'cancelled')
  assert.equal(state.appendedRecords.at(-1)?.persistReason, 'transition:running->cancelled')
  assert.equal(state.snapshots.length, 1)
  assert.equal(state.reports.length, 1)
})

test('stopMission rejects missing and terminal missions without mutating state', async () => {
  const { service, missions, state } = createHarness()
  const missing = await service.stopMission({ missionId: 'missing' })
  assert.equal(missing.ok, false)
  assert.equal(missing.ok === false && missing.code, 'mission_not_found')

  missions.set('done', {
    id: 'done',
    title: 'Done',
    brief: 'Already complete.',
    mode: 'instant',
    amount: null,
    startAt: '2026-06-30T11:59:00.000Z',
    endAt: null,
    status: 'completed',
    lifecycleState: 'completed',
    party: ['agent-a'],
    createdAt: '2026-06-30T11:59:00.000Z',
    completedAt: '2026-06-30T12:00:00.000Z',
    scheduler: missionSchedulerInitialState({ party: ['agent-a'] }),
  })
  const terminal = await service.stopMission({ missionId: 'done' })
  assert.equal(terminal.ok, false)
  assert.equal(terminal.ok === false && terminal.code, 'mission_invalid_state')
  assert.equal(state.appendedEvents.length, 0)
  assert.equal(state.appendedRecords.length, 0)
})

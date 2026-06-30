import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMissionReportService,
  type BackendMissionReport,
} from '../server/services/missions/missionReportService'
import {
  missionSchedulerInitialState,
  type Mission,
  type MissionFeedEvent,
  type MissionLifecycleEvent,
  type MissionRecordSnapshot,
} from '../server/services/missions/missionStateService'

function createMission(overrides: Partial<Mission> = {}): Mission {
  const party = overrides.party || ['agent-a', 'agent-b']
  return {
    id: overrides.id || 'mission-1',
    title: overrides.title || 'Report mission',
    brief: overrides.brief || 'Build report evidence.',
    mode: overrides.mode || 'instant',
    amount: overrides.amount ?? null,
    startAt: overrides.startAt || '2026-06-30T12:00:00.000Z',
    endAt: overrides.endAt ?? null,
    status: overrides.status || 'completed',
    lifecycleState: overrides.lifecycleState || 'completed',
    party,
    createdAt: overrides.createdAt || '2026-06-30T12:00:00.000Z',
    completedAt: overrides.completedAt ?? '2026-06-30T12:05:00.000Z',
    scheduler: overrides.scheduler || missionSchedulerInitialState({ party }),
    ...overrides,
  }
}

function createHarness() {
  const missionFeed: MissionFeedEvent[] = []
  const missions = new Map<string, Mission>()
  const appendedReports: BackendMissionReport[] = []
  const persistedReports: BackendMissionReport[] = []
  const persistedEvents: MissionLifecycleEvent[] = []
  const persistedRecords: MissionRecordSnapshot[] = []
  const service = createMissionReportService({
    appendMissionReport: async (report) => {
      appendedReports.push(report)
    },
    missionFeed,
    missions,
    now: () => new Date('2026-06-30T12:06:00.000Z'),
    persistWarning: () => undefined,
    readMissionEvents: async <T>() => persistedEvents as T[],
    readMissionRecords: async <T>() => persistedRecords as T[],
    readMissionReports: async <T>() => persistedReports as T[],
  })
  return {
    appendedReports,
    missionFeed,
    missions,
    persistedEvents,
    persistedRecords,
    persistedReports,
    service,
  }
}

test('buildMissionReport preserves runtime-backed cron/session evidence and confidence metrics', () => {
  const { missionFeed, service } = createHarness()
  const mission = createMission()
  mission.scheduler.jobs.push({
    id: 'job-a',
    cronId: 'cron-a',
    missionId: mission.id,
    agentId: 'agent-a',
    role: 'leader',
    round: 1,
    name: 'mission-job-a',
    status: 'completed',
    createdAt: '2026-06-30T12:00:00.000Z',
    startedAt: '2026-06-30T12:00:10.000Z',
    endedAt: '2026-06-30T12:01:10.000Z',
    summary: 'completed',
    runtimeRunId: 'runtime-a',
    cronRunId: 'cron-run-a',
    sessionId: 'session-a',
    sessionKey: 'session-key-a',
  }, {
    id: 'job-b',
    cronId: 'cron-b',
    missionId: mission.id,
    agentId: 'agent-b',
    role: 'worker',
    round: 1,
    name: 'mission-job-b',
    status: 'failed',
    createdAt: '2026-06-30T12:00:00.000Z',
    startedAt: '2026-06-30T12:00:20.000Z',
    endedAt: '2026-06-30T12:02:20.000Z',
    summary: 'failed',
    runtimeRunId: 'runtime-b',
    cronRunId: null,
    sessionId: null,
    sessionKey: null,
  })
  missionFeed.push({
    id: 'event-a',
    missionId: mission.id,
    at: '2026-06-30T12:01:30.000Z',
    type: 'agent_update',
    agentId: 'agent-b',
    message: 'Verification failed after one retry command failed.',
  })

  const report = service.buildMissionReport(mission)

  assert.equal(report.generatedAt, '2026-06-30T12:06:00.000Z')
  assert.equal(report.evidence.source, 'mixed')
  assert.equal(report.evidence.completedRuns, 1)
  assert.equal(report.evidence.failedRuns, 1)
  assert.equal(report.evidence.retryCount, 1)
  assert.equal(report.evidence.verificationFailures, 1)
  assert.equal(report.evidence.commandFailures, 1)
  assert.equal(report.evidence.queueDelayMs, 15_000)
  assert.equal(report.evidence.totalExecutionDurationMs, 180_000)
  assert.equal(report.evidence.missionWallTimeMs, 300_000)
  assert.deepEqual(report.evidence.runtimeRunIds, ['runtime-a', 'runtime-b'])
  assert.deepEqual(report.evidence.cronRunIds, ['cron-run-a'])
  assert.deepEqual(report.evidence.sessionIds, ['session-a'])
  assert.deepEqual(report.evidence.sessionKeys, ['session-key-a'])
  assert.deepEqual(report.evidence.agentParticipation, ['agent-a', 'agent-b'])
  assert.ok(typeof report.efficiencyRating === 'number' && report.efficiencyRating < 50)
})

test('buildMissionReport falls back to mission-feed evidence without runtime references', () => {
  const { missionFeed, service } = createHarness()
  const mission = createMission({ id: 'mission-feed-only', party: ['agent-a'] })
  missionFeed.push({
    id: 'assigned',
    missionId: mission.id,
    at: '2026-06-30T12:00:00.000Z',
    type: 'agent_assigned',
    agentId: 'agent-a',
    message: 'agent-a assigned',
  }, {
    id: 'started',
    missionId: mission.id,
    at: '2026-06-30T12:00:05.000Z',
    type: 'agent_update',
    agentId: 'agent-a',
    message: 'agent-a started running mission work',
  })

  const report = service.buildMissionReport(mission)

  assert.equal(report.evidence.source, 'mission-feed')
  assert.equal(report.evidence.acceptedRuns, 1)
  assert.equal(report.evidence.startedRuns, 1)
  assert.equal(report.evidence.completedRuns, 0)
  assert.deepEqual(report.evidence.runtimeRunIds, [])
  assert.equal(report.runtimeEfficiency, null)
  assert.ok(report.evidence.unavailableMetrics.includes('runtimeEfficiency'))
})

test('buildMissionReport lowers scores and counts failed cron jobs', () => {
  const { service } = createHarness()
  const mission = createMission({ id: 'mission-failed-jobs' })
  mission.scheduler.jobs.push({
    id: 'job-failed',
    cronId: 'cron-failed',
    missionId: mission.id,
    agentId: 'agent-a',
    role: 'worker',
    round: 1,
    name: 'mission-job-failed',
    status: 'failed',
    createdAt: '2026-06-30T12:00:00.000Z',
    startedAt: '2026-06-30T12:01:00.000Z',
    endedAt: '2026-06-30T12:02:00.000Z',
    summary: 'OpenClaw command failed.',
    runtimeRunId: null,
    cronRunId: null,
    sessionId: null,
    sessionKey: null,
  })

  const report = service.buildMissionReport(mission)

  assert.equal(report.evidence.source, 'mission-feed')
  assert.equal(report.evidence.completedRuns, 0)
  assert.equal(report.evidence.failedRuns, 1)
  assert.equal(report.errors, 1)
  assert.equal(report.runtimeEfficiency, 0)
  assert.equal(report.efficiencyRating, 0)
  assert.ok(typeof report.heartbeatStabilityScore === 'number' && report.heartbeatStabilityScore < 100)
})

test('buildMissionReport returns explicit no-evidence reports instead of invented metrics', () => {
  const { service } = createHarness()
  const mission = createMission({
    id: 'mission-empty',
    party: ['agent-a'],
    status: 'completed',
    lifecycleState: 'completed',
    completedAt: '2026-06-30T12:01:00.000Z',
  })

  const report = service.buildMissionReport(mission)

  assert.equal(report.evidence.source, 'none')
  assert.equal(report.evidence.acceptedRuns, 1)
  assert.equal(report.evidence.startedRuns, 0)
  assert.equal(report.errors, null)
  assert.equal(report.efficiencyRating, null)
  assert.equal(report.xpGained, null)
  assert.ok(report.evidence.unavailableMetrics.includes('efficiencyRating'))
  assert.equal(report.evidence.missionWallTimeMs, 60_000)
})

test('recordMissionReport and lifecycle projection merge memory reports with durable records', async () => {
  const {
    appendedReports,
    missionFeed,
    missions,
    persistedEvents,
    persistedRecords,
    persistedReports,
    service,
  } = createHarness()
  const memoryMission = createMission({ id: 'memory-mission', title: 'Memory mission' })
  missions.set(memoryMission.id, memoryMission)
  missionFeed.push({
    id: 'memory-feed',
    missionId: memoryMission.id,
    at: '2026-06-30T12:05:00.000Z',
    type: 'mission_completed',
    message: 'Memory mission completed.',
  })
  persistedRecords.push({
    ...createMission({
      id: 'durable-mission',
      title: 'Durable mission',
      party: ['agent-c'],
      createdAt: '2026-06-30T11:00:00.000Z',
      startAt: '2026-06-30T11:00:00.000Z',
      completedAt: '2026-06-30T11:01:00.000Z',
    }),
    missionId: 'durable-mission',
    updatedAt: '2026-06-30T11:01:00.000Z',
    persistedAt: '2026-06-30T11:01:00.000Z',
    persistReason: 'test',
  })
  persistedEvents.push({
    id: 'durable-event',
    missionId: 'durable-mission',
    timestamp: '2026-06-30T11:00:05.000Z',
    at: '2026-06-30T11:00:05.000Z',
    type: 'mission_started',
    message: 'Durable mission started.',
    actor: 'control-center',
    previousState: 'draft',
    nextState: 'running',
    idempotencyKey: 'durable-started',
  })
  persistedReports.push({
    ...service.buildMissionReport(createMission({ id: 'durable-mission', party: ['agent-c'] })),
    generatedAt: '2026-06-30T11:01:00.000Z',
  })

  const recorded = service.recordMissionReport(memoryMission)
  const reports = await service.listMissionReports(10)
  const projection = await service.buildMissionLifecycleProjection({ missionLimit: 10, eventLimit: 10, feedLimit: 10, reportLimit: 10 })

  assert.equal(appendedReports.length, 1)
  assert.equal(recorded.missionId, 'memory-mission')
  assert.deepEqual(reports.map((report) => report.missionId), ['memory-mission', 'durable-mission'])
  assert.deepEqual(projection.missions.map((mission) => mission.id), ['memory-mission', 'durable-mission'])
  assert.equal(projection.reports.length, 2)
  assert.equal(projection.feed.some((event) => event.id === 'memory-feed'), true)
  assert.equal(projection.feed.some((event) => event.id === 'durable-event'), true)
  assert.equal(projection.projection.source, 'memory+ledger')
  assert.equal(projection.projection.durableRecordCount, 1)
  assert.equal(projection.projection.memoryRecordCount, 1)
})

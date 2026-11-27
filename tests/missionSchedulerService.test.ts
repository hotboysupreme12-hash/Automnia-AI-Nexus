import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createMissionSchedulerService,
  type MissionSchedulerOpenClawResult,
} from '../server/services/missions/missionSchedulerService'
import {
  missionSchedulerInitialState,
  type Mission,
  type MissionFeedEvent,
  type TeamSyncAssignment,
} from '../server/services/missions/missionStateService'

function makeMission(overrides: Partial<Mission> = {}): Mission {
  const party = overrides.party || ['agent-a']
  return {
    id: overrides.id || 'mission-1',
    title: overrides.title || 'Scheduler mission',
    brief: overrides.brief || 'Prove the scheduler extraction.',
    mode: overrides.mode || 'instant',
    amount: overrides.amount ?? null,
    startAt: overrides.startAt || '2026-06-30T12:00:00.000Z',
    endAt: overrides.endAt ?? null,
    status: overrides.status || 'active',
    lifecycleState: overrides.lifecycleState || 'running',
    party,
    createdAt: overrides.createdAt || '2026-06-30T12:00:00.000Z',
    completedAt: overrides.completedAt ?? null,
    cadenceSeconds: overrides.cadenceSeconds,
    scheduler: overrides.scheduler || missionSchedulerInitialState({
      party,
      cadenceSeconds: overrides.cadenceSeconds,
    }),
    ...overrides,
  }
}

function makeAssignments(party: string[], task = 'Initial mission task'): TeamSyncAssignment[] {
  return party.map((agentId) => ({
    agentId,
    task,
    status: 'queued',
    updatedAt: '2026-06-30T12:00:00.000Z',
  }))
}

function createHarness(overrides: Partial<{
  runOpenClaw: (args: string[], options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal }) => Promise<MissionSchedulerOpenClawResult>
  extractAgentReply: (stdout: string, stderr: string) => string
  openClawAgentsRoot: string
  maxConcurrentCronRuns: number
  maxConcurrentCronSetups: number
  recordMissionReport: (mission: Mission) => unknown
}> = {}) {
  const state = {
    activeShifts: new Map<string, unknown>(),
    agentMemory: [] as string[],
    clearedCronIds: [] as string[],
    events: [] as Array<Omit<MissionFeedEvent, 'id' | 'at'>>,
    gatewayReadyChecks: 0,
    openClawCalls: [] as string[][],
    persisted: [] as string[],
    reports: [] as Mission[],
    snapshots: [] as unknown[],
    transitions: [] as unknown[],
  }
  const missions = new Map<string, Mission>()
  const missionLoopTimers = new Map<string, NodeJS.Timeout>()
  const missionRunControllers = new Map<string, AbortController>()
  const missionTimers = new Map<string, NodeJS.Timeout>()
  let cronId = 0
  let runtimeRunId = 0
  let eventId = 0
  let id = 0

  const service = createMissionSchedulerService({
    appendAgentDailyMemory: async (agentId, text) => {
      state.agentMemory.push(`${agentId}:${text}`)
    },
    clearDisallowedAutoModelOverridesForAgent: async () => undefined,
    clearShiftRuntimeStateForCronId: (targetCronId) => {
      state.clearedCronIds.push(targetCronId)
    },
    composeAgentDoctrinePrompt: (_agentId, prompt) => prompt,
    ensureGatewayReadyForCronMission: async () => {
      state.gatewayReadyChecks += 1
    },
    ensureTeamSyncFile: async () => undefined,
    extractAgentReply: overrides.extractAgentReply || (() => 'round 1 complete evidence: ok'),
    getAgentAuthEnv: async (agentId) => ({ [`AUTH_${agentId.toUpperCase()}`]: 'configured' }),
    maxConcurrentCronRuns: overrides.maxConcurrentCronRuns,
    maxConcurrentCronSetups: overrides.maxConcurrentCronSetups,
    missionAgentTimeoutSeconds: 900,
    missionLoopTimers,
    missionRunControllers,
    missionTimers,
    missions,
    now: () => new Date('2026-06-30T12:00:00.000Z'),
    openClawAgentsRoot: overrides.openClawAgentsRoot || process.cwd(),
    openClawErrorResult: (error) => ({ stdout: '', stderr: String(error), code: 1 }),
    persistMissionRecord: (_mission, reason) => {
      state.persisted.push(reason)
    },
    port: 4050,
    pushMissionEvent: (event) => {
      state.events.push(event)
      return {
        id: `event-${++eventId}`,
        at: '2026-06-30T12:00:00.000Z',
        ...event,
      }
    },
    randomId: () => `id-${++id}`,
    recordMissionReport: (mission) => {
      state.reports.push({ ...mission })
      return overrides.recordMissionReport ? overrides.recordMissionReport(mission) : { missionId: mission.id }
    },
    redactSensitiveText: (text) => text.replace(/secret-token/gi, '[REDACTED]'),
    resolveAgentRunContext: async () => ({
      doctrineWorkspace: 'C:/automnia/doctrine',
      executionWorkspace: 'C:/automnia/work',
    }),
    resolveMissionCronRuntimeDefaultsForAgent: async () => ({
      model: 'openai/gpt-test',
      thinking: 'medium',
      timeoutSeconds: 60,
    }),
    resolveSharedTeamSyncPath: async (agentId) => `C:/automnia/${agentId}/TEAM_SYNC.md`,
    runCwdForContext: (context) => context.executionWorkspace,
    runOpenClaw: async (args, _timeoutMs, callOptions) => {
      state.openClawCalls.push([...args])
      if (overrides.runOpenClaw) return overrides.runOpenClaw(args, callOptions)
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: JSON.stringify({ id: `cron-${++cronId}` }), stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        runtimeRunId += 1
        return {
          stdout: JSON.stringify({
            runId: `cron-run-${runtimeRunId}`,
            sessionId: '12345678-1234-1234-1234-123456789abc',
            sessionKey: `session-key-${runtimeRunId}-abcdef`,
          }),
          stderr: '',
          code: 0,
          controlCenterRunId: `runtime-${runtimeRunId}`,
        }
      }
      if (args[0] === 'cron' && args[1] === 'rm') return { stdout: '{}', stderr: '', code: 0 }
      if (args[0] === 'cron' && args[1] === 'disable') return { stdout: '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    },
    setActiveShift: (shiftId, shift) => {
      state.activeShifts.set(shiftId, shift)
    },
    stripAnsi: (text) => text,
    transitionMissionState: (mission, nextState, type, message, transitionOptions) => {
      const previousState = mission.lifecycleState
      mission.lifecycleState = nextState
      state.transitions.push({ previousState, nextState, type, message, transitionOptions })
      return { previousState, nextState }
    },
    trimTask: (text, maxLength) => text.slice(0, maxLength),
    writeTeamSyncSnapshot: async (snapshot) => {
      state.snapshots.push(snapshot)
    },
  })

  return {
    service,
    state,
    missions,
    missionLoopTimers,
    missionRunControllers,
    missionTimers,
  }
}

for (const entryTimestamp of ['2026-06-30T11:59:59.000Z', '2026-06-30T12:00:01.000Z', undefined]) {
  test(`failed cron run recovers only dated current-session output (${entryTimestamp || 'undated'})`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automnia-mission-evidence-'))
    try {
      const sessionId = '12345678-1234-1234-1234-123456789abc'
      await mkdir(path.join(root, 'agent-a', 'sessions'), { recursive: true })
      await writeFile(path.join(root, 'agent-a', 'sessions', `${sessionId}.jsonl`), JSON.stringify({
        type: 'message', timestamp: entryTimestamp,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Changed files: report.md. Verification: all acceptance checks passed.' }] },
      }) + '\n')
      const { service, missions, state } = createHarness({
        openClawAgentsRoot: root,
        extractAgentReply: () => '',
        runOpenClaw: async (args) => args[1] === 'add'
          ? { stdout: '{"id":"cron-fixture"}', stderr: '', code: 0 }
          : { stdout: JSON.stringify({ sessionId }), stderr: 'connection failed', code: 1 },
      })
      const mission = makeMission()
      missions.set(mission.id, mission)
      const job = await service.createMissionCronJob({ mission, agentId: 'agent-a', role: 'leader', round: 1 })
      const result = await service.runMissionCronJob(job)
      assert.equal(result.ok, entryTimestamp === '2026-06-30T12:00:01.000Z')
      if (result.ok) {
        assert.equal(state.events.at(-1)?.evidence?.evidenceSource, 'session-final')
        assert.equal(state.events.at(-1)?.evidence?.evidenceTimestamp, entryTimestamp)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

async function waitUntil(predicate: () => boolean, timeoutMs = 250) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('condition was not met before timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('startRecurringMissionCronJobs arms leader and worker cron pulses with Team Sync evidence', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-recurring',
    mode: 'hours',
    amount: 1,
    cadenceSeconds: 300,
    party: ['agent-a', 'agent-b'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a', 'agent-b'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  const assignments = makeAssignments(mission.party)
  const activity: string[] = []

  await service.startRecurringMissionCronJobs(mission, assignments, activity)

  assert.equal(mission.scheduler.status, 'waiting')
  assert.equal(mission.scheduler.nextRoundAt, '2026-06-30T12:05:00.000Z')
  assert.equal(mission.scheduler.jobs.length, 2)
  assert.deepEqual(mission.scheduler.jobs.map((job) => job.role).sort(), ['leader', 'worker'])
  assert.equal(state.activeShifts.size, 2)
  assert.equal(state.snapshots.length, 1)
  assert.equal(state.persisted.includes('recurring-cron-armed'), true)
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'add').length, 2)
  assert.equal(state.openClawCalls.some((args) => args.includes('--every') && args.includes('5m')), true)
  assert.equal(assignments.every((entry) => entry.note === 'scheduled every 5m; immediate kickoff queued'), true)
})

test('startRecurringMissionCronJobs prepares multi-agent schedules concurrently for a fast kickoff', async () => {
  let activeAdds = 0
  let maxConcurrentAdds = 0
  let cronId = 0
  const { service, missions } = createHarness({
    runOpenClaw: async (args) => {
      if (args[0] !== 'cron' || args[1] !== 'add') return { stdout: '{}', stderr: '', code: 0 }
      activeAdds += 1
      maxConcurrentAdds = Math.max(maxConcurrentAdds, activeAdds)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeAdds -= 1
      return { stdout: JSON.stringify({ id: `cron-concurrent-${++cronId}` }), stderr: '', code: 0 }
    },
  })
  const mission = makeMission({
    id: 'mission-concurrent-setup',
    mode: 'continuous',
    party: ['agent-a', 'agent-b', 'agent-c'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a', 'agent-b', 'agent-c'] }),
  })
  missions.set(mission.id, mission)

  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

  assert.equal(maxConcurrentAdds, 3)
  assert.equal(mission.scheduler.jobs.length, 3)
})

test('launchRecurringMissionImmediately runs hierarchical leader before workers and preserves every schedule', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-recurring-now',
    mode: 'continuous',
    collaborationMode: 'hierarchical',
    cadenceSeconds: 300,
    party: ['agent-a', 'agent-b', 'agent-c'],
    scheduler: missionSchedulerInitialState({
      party: ['agent-a', 'agent-b', 'agent-c'],
      cadenceSeconds: 300,
      collaborationMode: 'hierarchical',
    }),
  })
  missions.set(mission.id, mission)
  const assignments = makeAssignments(mission.party)
  const activity: string[] = []

  await service.startRecurringMissionCronJobs(mission, assignments, activity)
  await service.launchRecurringMissionImmediately(mission, assignments, activity)

  const runCalls = state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'run')
  assert.equal(runCalls.length, 3)
  assert.equal(runCalls[0][2], 'cron-1')
  assert.deepEqual(new Set(runCalls.slice(1).map((args) => args[2])), new Set(['cron-2', 'cron-3']))
  assert.equal(state.openClawCalls.some((args) => args[0] === 'cron' && args[1] === 'rm'), false)
  assert.equal(mission.scheduler.round, 1)
  assert.equal(mission.scheduler.status, 'waiting')
  assert.equal(mission.scheduler.jobs.every((job) => job.status === 'created'), true)
  assert.equal(mission.scheduler.jobs.every((job) => job.runCount === 1 && job.lastRunStatus === 'completed'), true)
  assert.equal(assignments.every((entry) => entry.status === 'completed'), true)
  assert.equal(state.events.some((event) => /Immediate kickoff completed for all 3 agent/.test(event.message)), true)
  const workerAddCall = state.openClawCalls.find((args) => args[0] === 'cron' && args[1] === 'add' && args.includes('agent-b'))
  assert.equal(workerAddCall?.some((argument) => /newest named assignment for your agent id/.test(argument)), true)
})

test('parallel recurring missions launch every selected agent as a worker', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-parallel-now',
    mode: 'indefinite',
    collaborationMode: 'parallel',
    party: ['agent-a', 'agent-b', 'agent-c'],
    scheduler: missionSchedulerInitialState({
      party: ['agent-a', 'agent-b', 'agent-c'],
      collaborationMode: 'parallel',
    }),
  })
  missions.set(mission.id, mission)

  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])
  await service.launchRecurringMissionImmediately(mission, makeAssignments(mission.party), [])

  assert.equal(mission.scheduler.jobs.every((job) => job.role === 'worker'), true)
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'run').length, 3)
})

test('every mission type and execution profile reaches the recurring agent prompt', async () => {
  const expectations = {
    codeGeneration: 'Build mission:',
    planning: 'Planning mission:',
    research: 'Research mission:',
    orchestration: 'Orchestration mission:',
    memoryManagement: 'Memory mission:',
  } as const
  for (const [missionType, expectedDirective] of Object.entries(expectations)) {
    const { service, state, missions } = createHarness()
    const mission = makeMission({
      id: `mission-type-${missionType}`,
      mode: 'continuous',
      missionType: missionType as keyof typeof expectations,
      complexity: 87,
      riskTolerance: 12,
      party: ['agent-a'],
      scheduler: missionSchedulerInitialState({ party: ['agent-a'] }),
    })
    missions.set(mission.id, mission)

    await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

    const addCall = state.openClawCalls.find((args) => args[0] === 'cron' && args[1] === 'add')
    assert.equal(addCall?.some((argument) => argument.includes(expectedDirective)), true, missionType)
    assert.equal(addCall?.some((argument) => argument.includes('complexity 87/100; risk tolerance 12/100')), true, missionType)
  }
})

test('recurring schedules preserve each agent cadence instead of collapsing to the fastest lane', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-mixed-cadence',
    mode: 'continuous',
    collaborationMode: 'parallel',
    cadenceSeconds: 120,
    agentCadenceSeconds: { 'agent-a': 120, 'agent-b': 300 },
    party: ['agent-a', 'agent-b'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a', 'agent-b'], cadenceSeconds: 120, collaborationMode: 'parallel' }),
  })
  missions.set(mission.id, mission)

  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

  const addCalls = state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'add')
  const everyForAgent = Object.fromEntries(addCalls.map((args) => [args[args.indexOf('--agent') + 1], args[args.indexOf('--every') + 1]]))
  assert.deepEqual(everyForAgent, { 'agent-a': '2m', 'agent-b': '5m' })
})

test('recurring runtime reconciliation shows scheduled starts and completions exactly once', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-reconciliation',
    mode: 'continuous',
    collaborationMode: 'parallel',
    cadenceSeconds: 300,
    party: ['agent-a', 'agent-b'],
    scheduler: missionSchedulerInitialState({
      party: ['agent-a', 'agent-b'],
      cadenceSeconds: 300,
      collaborationMode: 'parallel',
    }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

  await service.reconcileRecurringMissionCronRuntime(mission.scheduler.jobs.map((job) => ({
    cronId: job.cronId,
    runningAt: '2026-06-30T12:05:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    nextRunAt: '2026-06-30T12:10:00.000Z',
  })))

  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.jobs.every((job) => job.status === 'running'), true)
  assert.equal(state.events.filter((event) => /Scheduled cycle started/.test(event.message)).length, 2)

  const completedSnapshots = mission.scheduler.jobs.map((job) => ({
    cronId: job.cronId,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:10:00.000Z',
  }))
  await service.reconcileRecurringMissionCronRuntime(completedSnapshots)
  await service.reconcileRecurringMissionCronRuntime(completedSnapshots)

  assert.equal(mission.scheduler.status, 'waiting')
  assert.equal(mission.scheduler.round, 1)
  assert.equal(mission.scheduler.nextRoundAt, '2026-06-30T12:10:00.000Z')
  assert.equal(mission.scheduler.jobs.every((job) => job.status === 'created'), true)
  assert.equal(mission.scheduler.jobs.every((job) => job.runCount === 1 && job.completedRunCount === 1), true)
  assert.equal(state.events.filter((event) => /Scheduled cycle completed/.test(event.message)).length, 2)
})

test('runtime reconciliation does not double-count an immediate kickoff still tracked by the scheduler', async () => {
  const { service, missions, missionRunControllers } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-manual-run',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])
  missionRunControllers.set(mission.id, new AbortController())

  await service.reconcileRecurringMissionCronRuntime([{
    cronId: mission.scheduler.jobs[0].cronId,
    runningAt: null,
    lastRunAt: '2026-06-30T12:01:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:05:00.000Z',
  }])

  assert.equal(mission.scheduler.jobs[0].runCount, 0)
  assert.equal(mission.scheduler.round, 0)
  missionRunControllers.delete(mission.id)
})

test('recurring runtime reconciliation keeps failed lanes scheduled and exposes a safe retry error', async () => {
  const { service, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-failure',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

  await service.reconcileRecurringMissionCronRuntime([{
    cronId: mission.scheduler.jobs[0].cronId,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'error',
    lastError: 'provider failed with secret-token',
    nextRunAt: '2026-06-30T12:10:00.000Z',
  }])

  assert.equal(mission.status, 'active')
  assert.equal(mission.scheduler.status, 'waiting')
  assert.equal(mission.scheduler.jobs[0].status, 'created')
  assert.equal(mission.scheduler.jobs[0].failedRunCount, 1)
  assert.match(mission.scheduler.lastError || '', /\[REDACTED\]/)
  assert.equal((mission.scheduler.lastError || '').includes('secret-token'), false)
})

test('recurring runtime reconciliation preserves active runs across duplicate-prevention skips and records completion once', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-skipped-overlap',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])
  const job = mission.scheduler.jobs[0]

  // 12:05 cycle starts running.
  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:05:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    nextRunAt: '2026-06-30T12:10:00.000Z',
  }])
  assert.equal(job.status, 'running')
  assert.equal(mission.scheduler.status, 'running')

  // 12:10 overlapping cron tick is skipped while 12:05 run is still active.
  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:05:00.000Z',
    lastRunAt: '2026-06-30T12:10:00.000Z',
    lastRunStatus: 'skipped',
    lastError: null,
    nextRunAt: '2026-06-30T12:15:00.000Z',
  }])
  assert.equal(job.status, 'running')
  assert.equal(job.lastRunStatus, 'skipped')
  assert.equal(job.runCount || 0, 0)
  assert.equal(job.failedRunCount || 0, 0)
  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.lastError, null)
  assert.equal(state.events.some((event) => /Scheduled cycle skipped/.test(event.message)), true)

  // Active 12:05 run completes (OpenClaw records run start timestamp 12:05 in lastRunAt).
  const completedSnapshot = [{
    cronId: job.cronId,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:15:00.000Z',
  }]
  await service.reconcileRecurringMissionCronRuntime(completedSnapshot)
  await service.reconcileRecurringMissionCronRuntime(completedSnapshot)

  assert.equal(job.status, 'created')
  assert.equal(job.lastRunStatus, 'completed')
  assert.equal(job.runCount, 1)
  assert.equal(job.completedRunCount, 1)
  assert.equal(job.failedRunCount || 0, 0)
  assert.equal(mission.scheduler.status, 'waiting')
  assert.equal(mission.scheduler.round, 1)
})

test('recurring runtime reconciliation counts skipped-over run completion even when the next cycle starts before the next poll', async () => {
  const { service, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-skipped-then-immediate-next-run',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])
  const job = mission.scheduler.jobs[0]

  // 12:05 cycle starts, then 12:10 tick skips while 12:05 continues.
  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:05:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    nextRunAt: '2026-06-30T12:10:00.000Z',
  }])
  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:05:00.000Z',
    lastRunAt: '2026-06-30T12:10:00.000Z',
    lastRunStatus: 'skipped',
    lastError: null,
    nextRunAt: '2026-06-30T12:15:00.000Z',
  }])

  // 12:05 run finishes right before 12:15, and 12:15 starts before the next poll.
  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:15:00.000Z',
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:20:00.000Z',
  }])

  assert.equal(job.runCount, 1)
  assert.equal(job.completedRunCount, 1)
  assert.equal(job.failedRunCount || 0, 0)
  assert.equal(job.status, 'running')
  assert.equal(job.startedAt, '2026-06-30T12:15:00.000Z')
  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.round, 1)
})

test('recurring runtime reconciliation handles previous cycle completion and next cycle start in a single poll', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-finish-and-start',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])
  const job = mission.scheduler.jobs[0]

  await service.reconcileRecurringMissionCronRuntime([{
    cronId: job.cronId,
    runningAt: '2026-06-30T12:10:00.000Z',
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:15:00.000Z',
  }])

  assert.equal(job.runCount, 1)
  assert.equal(job.completedRunCount, 1)
  assert.equal(job.status, 'running')
  assert.equal(job.startedAt, '2026-06-30T12:10:00.000Z')
  assert.equal(job.endedAt, null)
  assert.equal(mission.scheduler.status, 'running')
  assert.equal(mission.scheduler.round, 1)
  assert.equal(state.events.some((event) => /Scheduled cycle completed/.test(event.message)), true)
  assert.equal(state.events.some((event) => /Scheduled cycle started/.test(event.message)), true)
})

test('recurring runtime reconciliation enforces the configured cycle limit', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-runtime-max-cycles',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300, maxCycles: 1 }),
  })
  missions.set(mission.id, mission)
  await service.startRecurringMissionCronJobs(mission, makeAssignments(mission.party), [])

  await service.reconcileRecurringMissionCronRuntime([{
    cronId: mission.scheduler.jobs[0].cronId,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:10:00.000Z',
  }])

  assert.equal(mission.status, 'completed')
  assert.equal(mission.lifecycleState, 'completed')
  assert.equal(mission.scheduler.status, 'completed')
  assert.equal(state.reports.length, 1)
  assert.equal(state.openClawCalls.some((args) => args[0] === 'cron' && args[1] === 'rm'), true)
})

test('cleanupMissionCronJobs disables a cron job when removal fails', async () => {
  const { service, state, missions } = createHarness({
    runOpenClaw: async (args) => {
      state.openClawCalls.push([...args])
      if (args[0] === 'cron' && args[1] === 'rm') {
        return { stdout: '', stderr: 'remove failed with secret-token', code: 1 }
      }
      if (args[0] === 'cron' && args[1] === 'disable') {
        return { stdout: 'disabled', stderr: '', code: 0 }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const mission = makeMission({ id: 'mission-cleanup' })
  mission.scheduler.jobs.push({
    id: 'job-1',
    cronId: 'cron-cleanup',
    missionId: mission.id,
    agentId: 'agent-a',
    role: 'leader',
    round: 1,
    name: 'cleanup-job',
    status: 'created',
    createdAt: '2026-06-30T12:00:00.000Z',
    startedAt: null,
    endedAt: null,
    summary: null,
    runtimeRunId: null,
    cronRunId: null,
    sessionId: null,
    sessionKey: null,
  })
  missions.set(mission.id, mission)

  const cleanup = await service.cleanupMissionCronJobs(mission)

  assert.equal(cleanup.attempted, 1)
  assert.equal(cleanup.disabled, 1)
  assert.equal(cleanup.failed, 0)
  assert.equal(mission.scheduler.jobs[0].status, 'disabled')
  assert.deepEqual(state.clearedCronIds, ['cron-cleanup'])
})

test('runMissionCronRound completes immediately when max cycles are already satisfied', async () => {
  const { service, state, missions } = createHarness()
  const mission = makeMission({
    id: 'mission-max-cycles',
    mode: 'hours',
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], maxCycles: 1 }),
  })
  mission.scheduler.round = 1
  missions.set(mission.id, mission)
  const assignments = makeAssignments(mission.party)
  const activity: string[] = []

  await service.runMissionCronRound(mission.id, assignments, activity)

  assert.equal(mission.status, 'completed')
  assert.equal(mission.lifecycleState, 'completed')
  assert.equal(mission.scheduler.status, 'completed')
  assert.equal(state.openClawCalls.length, 0)
  assert.equal(state.reports.length, 1)
  assert.equal(state.snapshots.length, 1)
  assert.equal(state.transitions.some((transition) => {
    const record = transition as { message?: string; nextState?: string }
    return record.nextState === 'completed' && /completed after 1 cron cycle/.test(record.message || '')
  }), true)
})

test('scheduleNextMissionRound drives an instant mission through cron run completion', async () => {
  const { service, state, missions, missionLoopTimers, missionRunControllers } = createHarness()
  const mission = makeMission({
    id: 'mission-instant',
    mode: 'instant',
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'] }),
  })
  missions.set(mission.id, mission)
  const assignments = makeAssignments(mission.party)
  const activity: string[] = []

  service.scheduleNextMissionRound(mission, assignments, activity, 0)
  await waitUntil(() => mission.status === 'completed')

  assert.equal(mission.scheduler.round, 1)
  assert.equal(mission.scheduler.status, 'completed')
  assert.equal(mission.scheduler.jobs.length, 1)
  assert.equal(mission.scheduler.jobs.every((job) => job.status === 'completed'), true)
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'add').length, 1)
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'run').length, 1)
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'rm').length, 1)
  assert.equal(state.agentMemory.length, 1)
  assert.equal(missionLoopTimers.size, 0)
  assert.equal(missionRunControllers.size, 0)
  assert.equal(state.reports.length, 1)
})

test('instant missions fail visibly instead of being marked completed when an agent run fails', async () => {
  let cronId = 0
  const { service, state, missions } = createHarness({
    extractAgentReply: () => '',
    runOpenClaw: async (args) => {
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: JSON.stringify({ id: `cron-fail-${++cronId}` }), stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        return { stdout: '', stderr: 'provider execution failed', code: 1 }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const mission = makeMission({
    id: 'mission-instant-failure',
    mode: 'instant',
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'] }),
  })
  missions.set(mission.id, mission)

  await service.runMissionCronRound(mission.id, makeAssignments(mission.party), [])

  assert.equal(mission.status, 'cancelled')
  assert.equal(mission.lifecycleState, 'failed')
  assert.equal(mission.scheduler.status, 'failed')
  assert.match(mission.scheduler.lastError || '', /Strike mission failed/)
  assert.equal(state.reports.length, 1)
  assert.equal(state.transitions.some((transition) => (transition as { nextState?: string }).nextState === 'failed'), true)
})

test('instant collaboration modes use distinct command, relay, and concurrent execution plans', async () => {
  for (const mode of ['hierarchical', 'sequential', 'parallel', 'swarm', 'specialist'] as const) {
    const { service, state, missions } = createHarness()
    const mission = makeMission({
      id: `mission-${mode}`,
      mode: 'instant',
      collaborationMode: mode,
      party: ['agent-a', 'agent-b', 'agent-c'],
      scheduler: missionSchedulerInitialState({ party: ['agent-a', 'agent-b', 'agent-c'], collaborationMode: mode }),
    })
    missions.set(mission.id, mission)

    await service.runMissionCronRound(mission.id, makeAssignments(mission.party), [])

    const roles = mission.scheduler.jobs.map((job) => job.role)
    assert.equal(mission.scheduler.leaderAgentId, mode === 'hierarchical' ? 'agent-a' : null)
    assert.equal(roles.filter((role) => role === 'reviewer').length, 1, `${mode} should finish with one review`)
    if (mode === 'hierarchical') {
      assert.equal(roles.filter((role) => role === 'leader').length, 1)
      assert.equal(roles.filter((role) => role === 'worker').length, 2)
    } else {
      assert.equal(roles.filter((role) => role === 'leader').length, 0)
      assert.equal(roles.filter((role) => role === 'worker').length, 3)
    }
    assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'run').length, 4)
    assert.equal(mission.status, 'completed')
  }
})

test('runSemaphore enforces bounded concurrency across parallel cron workers and cancels queued waiters cleanly', async () => {
  let activeRuns = 0
  let maxObservedRuns = 0
  let cronCounter = 0
  const { service, state, missions } = createHarness({
    maxConcurrentCronRuns: 2,
    maxConcurrentCronSetups: 2,
    runOpenClaw: async (args, callOptions) => {
      if (callOptions?.signal?.aborted) {
        throw new Error('aborted signal reached runOpenClaw')
      }
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: JSON.stringify({ id: `cron-bounded-${++cronCounter}` }), stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        activeRuns += 1
        maxObservedRuns = Math.max(maxObservedRuns, activeRuns)
        await new Promise((resolve) => setTimeout(resolve, 12))
        activeRuns -= 1
        return {
          stdout: JSON.stringify({
            runId: `run-${args[2]}`,
            sessionId: '12345678-1234-1234-1234-123456789abc',
            sessionKey: `key-${args[2]}`,
          }),
          stderr: '',
          code: 0,
        }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const party = ['agent-a', 'agent-b', 'agent-c', 'agent-d']
  const mission = makeMission({
    id: 'mission-bounded-concurrency',
    mode: 'instant',
    collaborationMode: 'parallel',
    party,
    scheduler: missionSchedulerInitialState({ party, collaborationMode: 'parallel' }),
  })
  missions.set(mission.id, mission)

  await service.runMissionCronRound(mission.id, makeAssignments(party), [])

  assert.equal(maxObservedRuns, 2)
  assert.equal(mission.status, 'completed')
  assert.equal(state.openClawCalls.filter((args) => args[0] === 'cron' && args[1] === 'run').length, 5)

  // Verify a queued semaphore waiter aborts cleanly and tears down its one-shot cron job.
  let releaseBlocker!: () => void
  const blockerPromise = new Promise<void>((resolve) => {
    releaseBlocker = resolve
  })
  let cronCancelCounter = 0
  const cancelHarness = createHarness({
    maxConcurrentCronRuns: 1,
    runOpenClaw: async (args, callOptions) => {
      if (callOptions?.signal?.aborted) {
        throw new Error('aborted signal passed to cleanup')
      }
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: JSON.stringify({ id: `cron-waiter-${++cronCancelCounter}` }), stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        await blockerPromise
        return { stdout: '{}', stderr: '', code: 0 }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const cancelMission = makeMission({ id: 'mission-waiter-cancel', party: ['agent-a', 'agent-b'] })
  cancelHarness.missions.set(cancelMission.id, cancelMission)
  const job1 = await cancelHarness.service.createMissionCronJob({ mission: cancelMission, agentId: 'agent-a', role: 'worker', round: 1 })
  const job2 = await cancelHarness.service.createMissionCronJob({ mission: cancelMission, agentId: 'agent-b', role: 'worker', round: 1 })
  const waiterController = new AbortController()
  const run1 = cancelHarness.service.runMissionCronJob(job1)
  const run2 = cancelHarness.service.runMissionCronJob(job2, waiterController.signal)
  await new Promise((resolve) => setTimeout(resolve, 8))
  waiterController.abort()
  const res2 = await run2
  assert.equal(res2.ok, false)
  assert.equal(cancelHarness.state.openClawCalls.some((args) => args[0] === 'cron' && args[1] === 'rm' && args[2] === job2.cronId), true)
  releaseBlocker()
  const res1 = await run1
  assert.equal(res1.ok, true)
})

test('aborted mid-flight cron run still removes one-shot cron job without passing aborted signal to cron rm', async () => {
  const controller = new AbortController()
  let removedWithAbortedSignal = false
  const { service, state, missions } = createHarness({
    extractAgentReply: () => '',
    runOpenClaw: async (args, callOptions) => {
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: '{"id":"cron-midflight-abort"}', stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        controller.abort()
        return { stdout: '', stderr: 'aborted by mission stop', code: 1 }
      }
      if (args[0] === 'cron' && args[1] === 'rm') {
        removedWithAbortedSignal = Boolean(callOptions?.signal?.aborted)
        if (callOptions?.signal?.aborted) {
          throw new Error('AbortError')
        }
        return { stdout: '{}', stderr: '', code: 0 }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const mission = makeMission({ id: 'mission-midflight-abort' })
  missions.set(mission.id, mission)
  const job = await service.createMissionCronJob({ mission, agentId: 'agent-a', role: 'worker', round: 1 })
  await service.runMissionCronJob(job, controller.signal)

  assert.equal(removedWithAbortedSignal, false)
  assert.equal(state.openClawCalls.some((args) => args[0] === 'cron' && args[1] === 'rm' && args[2] === 'cron-midflight-abort'), true)
  assert.deepEqual(state.clearedCronIds, ['cron-midflight-abort'])
})

test('failed cron run redacts sensitive tokens across job summaries, events, daily memory, and failCronMission', async () => {
  let cronSeq = 0
  const { service, state, missions } = createHarness({
    extractAgentReply: () => 'Provider auth error: secret-token rejected',
    runOpenClaw: async (args) => {
      if (args[0] === 'cron' && args[1] === 'add') {
        return { stdout: JSON.stringify({ id: `cron-secret-${++cronSeq}` }), stderr: '', code: 0 }
      }
      if (args[0] === 'cron' && args[1] === 'run') {
        return { stdout: '', stderr: 'fatal error using secret-token', code: 1 }
      }
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const mission = makeMission({ id: 'mission-secret-redaction', mode: 'instant', party: ['agent-a'] })
  missions.set(mission.id, mission)

  await service.runMissionCronRound(mission.id, makeAssignments(mission.party), [])

  const serializedEvidence = JSON.stringify({
    jobs: mission.scheduler.jobs,
    lastError: mission.scheduler.lastError,
    events: state.events,
    memory: state.agentMemory,
    transitions: state.transitions,
    snapshots: state.snapshots,
  })
  assert.equal(serializedEvidence.includes('secret-token'), false)
  assert.match(mission.scheduler.jobs[0].summary || '', /\[REDACTED\]/)
  assert.match(mission.scheduler.lastError || '', /\[REDACTED\]/)
})

test('session evidence recovery blocks path-traversal agentIds and symlinked session files outside openClawAgentsRoot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'automnia-evidence-root-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'automnia-evidence-outside-'))
  try {
    const sessionId = '12345678-1234-1234-1234-123456789abc'
    const validLine = JSON.stringify({
      type: 'message',
      timestamp: '2026-06-30T12:00:02.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Changed files: leaked.md. Verification: all acceptance checks passed.' }],
      },
    }) + '\n'
    const outsideFile = path.join(outside, `${sessionId}.jsonl`)
    await writeFile(outsideFile, validLine)
    await mkdir(path.join(root, 'agent-a', 'sessions'), { recursive: true })

    // 1) Invalid traversal agentId is rejected before path resolution.
    const traversalHarness = createHarness({
      openClawAgentsRoot: root,
      extractAgentReply: () => '',
      runOpenClaw: async (args) => args[1] === 'add'
        ? { stdout: '{"id":"cron-traversal"}', stderr: '', code: 0 }
        : { stdout: JSON.stringify({ sessionId }), stderr: 'failed', code: 1 },
    })
    const traversalMission = makeMission({ id: 'mission-traversal', party: ['../outside'] })
    traversalHarness.missions.set(traversalMission.id, traversalMission)
    const traversalJob = await traversalHarness.service.createMissionCronJob({
      mission: traversalMission,
      agentId: '../outside',
      role: 'leader',
      round: 1,
    })
    const traversalResult = await traversalHarness.service.runMissionCronJob(traversalJob)
    assert.equal(traversalResult.ok, false)

    // 2) Symlinked session file pointing outside openClawAgentsRoot is rejected by assertContainedRegularFilePath.
    const symlinkTarget = path.join(root, 'agent-a', 'sessions', `${sessionId}.jsonl`)
    let symlinkCreated = false
    try {
      await symlink(outsideFile, symlinkTarget)
      symlinkCreated = true
    } catch {
      symlinkCreated = false
    }
    if (symlinkCreated) {
      const symlinkHarness = createHarness({
        openClawAgentsRoot: root,
        extractAgentReply: () => '',
        runOpenClaw: async (args) => args[1] === 'add'
          ? { stdout: '{"id":"cron-symlink"}', stderr: '', code: 0 }
          : { stdout: JSON.stringify({ sessionId }), stderr: 'failed', code: 1 },
      })
      const symlinkMission = makeMission({ id: 'mission-symlink', party: ['agent-a'] })
      symlinkHarness.missions.set(symlinkMission.id, symlinkMission)
      const symlinkJob = await symlinkHarness.service.createMissionCronJob({
        mission: symlinkMission,
        agentId: 'agent-a',
        role: 'leader',
        round: 1,
      })
      const symlinkResult = await symlinkHarness.service.runMissionCronJob(symlinkJob)
      assert.equal(symlinkResult.ok, false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('reconcileRecurringMissionCronRuntime queues concurrent poll snapshots instead of dropping updates', async () => {
  let releaseReport!: () => void
  const reportGate = new Promise<void>((resolve) => {
    releaseReport = resolve
  })
  const { service, missions } = createHarness({
    recordMissionReport: () => reportGate,
  })
  const missionA = makeMission({
    id: 'mission-queue-a',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-a'],
    scheduler: missionSchedulerInitialState({ party: ['agent-a'], cadenceSeconds: 300, maxCycles: 1 }),
  })
  const missionB = makeMission({
    id: 'mission-queue-b',
    mode: 'continuous',
    cadenceSeconds: 300,
    party: ['agent-b'],
    scheduler: missionSchedulerInitialState({ party: ['agent-b'], cadenceSeconds: 300 }),
  })
  missions.set(missionA.id, missionA)
  missions.set(missionB.id, missionB)
  await service.startRecurringMissionCronJobs(missionA, makeAssignments(missionA.party), [])
  await service.startRecurringMissionCronJobs(missionB, makeAssignments(missionB.party), [])
  const cronA = missionA.scheduler.jobs[0].cronId
  const cronB = missionB.scheduler.jobs[0].cronId

  const firstReconcile = service.reconcileRecurringMissionCronRuntime([{
    cronId: cronA,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:00.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: null,
  }])
  await new Promise((resolve) => setTimeout(resolve, 10))

  // While firstReconcile is awaiting missionA report persistence, a second snapshot arrives for missionB.
  const secondReconcile = service.reconcileRecurringMissionCronRuntime([{
    cronId: cronB,
    runningAt: null,
    lastRunAt: '2026-06-30T12:05:02.000Z',
    lastRunStatus: 'ok',
    lastError: null,
    nextRunAt: '2026-06-30T12:10:02.000Z',
  }])

  releaseReport()
  await Promise.all([firstReconcile, secondReconcile])

  assert.equal(missionA.status, 'completed')
  assert.equal(missionB.scheduler.jobs[0].runCount, 1)
  assert.equal(missionB.scheduler.jobs[0].completedRunCount, 1)
  assert.equal(missionB.scheduler.round, 1)
  assert.equal(missionB.scheduler.nextRoundAt, '2026-06-30T12:10:02.000Z')
})

import assert from 'node:assert/strict'
import test from 'node:test'

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
  runOpenClaw: (args: string[]) => Promise<MissionSchedulerOpenClawResult>
  extractAgentReply: (stdout: string, stderr: string) => string
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
    missionAgentTimeoutSeconds: 900,
    missionLoopTimers,
    missionRunControllers,
    missionTimers,
    missions,
    now: () => new Date('2026-06-30T12:00:00.000Z'),
    openClawAgentsRoot: process.cwd(),
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
      return { missionId: mission.id }
    },
    redactSensitiveText: (text) => text.replace(/secret-token/gi, '[REDACTED]'),
    resolveAgentRunContext: async () => ({
      doctrineWorkspace: 'C:/dystopai/doctrine',
      executionWorkspace: 'C:/dystopai/work',
    }),
    resolveMissionCronRuntimeDefaultsForAgent: async () => ({
      model: 'openai/gpt-test',
      thinking: 'medium',
      timeoutSeconds: 60,
    }),
    resolveSharedTeamSyncPath: async (agentId) => `C:/dystopai/${agentId}/TEAM_SYNC.md`,
    runCwdForContext: (context) => context.executionWorkspace,
    runOpenClaw: async (args) => {
      state.openClawCalls.push([...args])
      if (overrides.runOpenClaw) return overrides.runOpenClaw(args)
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

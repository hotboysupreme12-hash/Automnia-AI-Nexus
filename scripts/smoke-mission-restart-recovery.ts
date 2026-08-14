import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createMissionRecoveryService,
  type MissionCronReconciliationSnapshot,
} from '../server/services/missions/missionRecoveryService.ts'
import {
  missionRecordSnapshot,
  missionSchedulerInitialState,
  type Mission,
  type MissionCronJob,
  type MissionFeedEvent,
} from '../server/services/missions/missionStateService.ts'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const missionApiSource = readFileSync(path.join(rootDir, 'src/api/missions.ts'), 'utf8')
const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const missionPanelSource = readFileSync(path.join(rootDir, 'src/components/mission/MissionDeploymentPanel.tsx'), 'utf8')
const shellSource = readFileSync(path.join(rootDir, 'src/components/layout/NexusShell.tsx'), 'utf8')
const apiUrlSource = readFileSync(path.join(rootDir, 'src/utils/apiUrl.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(missionApiSource, /apiRequest<BackendMissionsPayload>\('\/api\/missions\/projection'\)/, 'renderer mission projection request must come from the backend projection API')
assert.match(storeSource, /from '..\/api\/missions'/, 'renderer mission projection should be requested through src/api/missions.ts')
assert.doesNotMatch(storeSource, /apiRequest<BackendMissionsPayload>\('\/api\/missions\/projection'\)/, 'nexusStore should not own the mission projection API request')
assert.match(storeSource, /const backendMissionStatusToRunStatus = \(mission: BackendMission\): MissionRun\['status'\] => \{/, 'renderer should centralize backend mission status projection')
assert.match(storeSource, /mission\.lifecycleState === 'failed'\) return 'failed'/, 'renderer should preserve recovered failed lifecycle state')
assert.match(storeSource, /missionHistory: historyRuns\.length \? historyRuns : s\.missionHistory/, 'backend mission history should replace stale local history when recovered records exist')
assert.match(shellSource, /useEffect\(\(\) => \{ void syncMissionProjection\(\)\.catch\(\(\) => undefined\) \}, \[syncMissionProjection\]\)/, 'shell reload should refresh mission projection after renderer recovery')
assert.match(missionPanelSource, /data-mission-projection-state=\{activeMission\.status\}/, 'Mission page should expose backend-projected mission state')
assert.match(missionPanelSource, /activeMission\.title/, 'Mission page should render the recovered backend mission title')
assert.match(apiUrlSource, /\(import\.meta as ViteImportMeta\)\.env\?\.VITE_CONTROL_CENTER_API_TARGET/, 'apiUrl should load safely in Node smoke tests')

const backendRecoveryStartedAtMs = Date.parse('2026-06-30T12:00:00.000Z')
const activeCronState: MissionCronReconciliationSnapshot = {
  available: true,
  activeCronIds: new Set(['cron-backend-kill']),
  disabledCronIds: new Set(),
  knownCronIds: new Set(['cron-backend-kill']),
}
const backendKillJob: MissionCronJob = {
  id: 'job-backend-kill',
  cronId: 'cron-backend-kill',
  missionId: 'mission-backend-kill',
  agentId: 'hn-commander',
  role: 'leader',
  round: 2,
  name: 'mission-backend-kill-hn-commander',
  status: 'running',
  createdAt: '2026-06-30T11:59:00.000Z',
  startedAt: '2026-06-30T12:00:00.000Z',
  endedAt: null,
  summary: null,
  runtimeRunId: 'runtime-backend-kill',
  cronRunId: 'cron-run-backend-kill',
  sessionId: 'session-backend-kill',
  sessionKey: 'agent:hn-commander:mission-backend-kill',
}
const durableBackendKillMission: Mission = {
  id: 'mission-backend-kill',
  title: 'Backend Kill Recovery Mission',
  brief: 'Recover this durable mission after a backend kill and restart.',
  mode: 'hours',
  amount: 1,
  missionType: 'planning',
  collaborationMode: 'parallel',
  complexity: 55,
  riskTolerance: 25,
  cadenceSeconds: 60,
  startAt: '2026-06-30T12:00:00.000Z',
  endAt: null,
  status: 'active',
  lifecycleState: 'running',
  party: ['hn-commander'],
  createdAt: '2026-06-30T11:58:00.000Z',
  completedAt: null,
  scheduler: {
    ...missionSchedulerInitialState({ party: ['hn-commander'], cadenceSeconds: 60 }),
    status: 'running',
    round: 2,
    activeJobId: backendKillJob.id,
    jobs: [backendKillJob],
  },
}
const backendRecoveryMissions = new Map<string, Mission>()
const backendGatewayRequests: string[] = []
const backendRecoveryEvents: MissionFeedEvent[] = []
const backendRecoveryLogs: Array<{ channel: string; message: string }> = []
const backendRecoveryRecords: Array<{ missionId: string; reason: string }> = []
const backendRecoveryShifts: string[] = []
const backendRecoveryTimers: string[] = []
const backendRecoveryService = createMissionRecoveryService({
  clearMissionController: () => undefined,
  clearShiftRuntimeStateForCronId: () => undefined,
  controlCenterStartedAtMs: backendRecoveryStartedAtMs,
  ensureGatewayClient: async () => ({
    client: {
      request: async (method) => {
        backendGatewayRequests.push(method)
        return { ok: true }
      },
    },
  }),
  getRuntimeRunStatus: () => 'interrupted',
  listMissionCronReconciliationSnapshot: () => activeCronState,
  missionCronJobNeedsRecovery: (job) => job.status === 'created' || job.status === 'running',
  missions: backendRecoveryMissions,
  persistMissionRecord: (mission, reason) => {
    backendRecoveryRecords.push({ missionId: mission.id, reason })
  },
  pushGatewayLog: (channel, message) => {
    backendRecoveryLogs.push({ channel, message })
  },
  pushMissionEvent: (event) => {
    const fullEvent: MissionFeedEvent = {
      id: `backend-recovery-event-${backendRecoveryEvents.length + 1}`,
      at: '2026-06-30T12:00:00.000Z',
      ...event,
    }
    backendRecoveryEvents.push(fullEvent)
    return fullEvent
  },
  readMissionRecords: async <T>(limit: number) => {
    assert.equal(limit, 500)
    return [missionRecordSnapshot(durableBackendKillMission, 'pre-backend-kill')] as T[]
  },
  recordMissionReport: (mission) => ({ missionId: mission.id }),
  redactSensitiveText: (text) => text.replace(/secret/gi, '[REDACTED]'),
  rehydrateRecurringMissionShifts: (mission) => {
    backendRecoveryShifts.push(mission.id)
  },
  armRehydratedMissionTimer: (mission) => {
    backendRecoveryTimers.push(mission.id)
  },
  transitionMissionState: () => undefined,
  trimTask: (text, maxLength = 180) => text.replace(/\s+/g, ' ').trim().slice(0, maxLength),
  now: () => new Date('2026-06-30T12:00:00.000Z'),
})

await backendRecoveryService.hydrateMissionRecordsFromLedger()
assert.equal(backendRecoveryMissions.get('mission-backend-kill')?.status, 'active')
assert.equal(backendRecoveryMissions.get('mission-backend-kill')?.lifecycleState, 'running')
assert.deepEqual(backendGatewayRequests, ['sessions.describe'])
assert.deepEqual(backendRecoveryShifts, ['mission-backend-kill'])
assert.deepEqual(backendRecoveryTimers, ['mission-backend-kill'])
assert.equal(backendRecoveryRecords.some((record) => record.reason === 'gateway-session-reconciled'), true)
assert.equal(backendRecoveryEvents.some((event) => event.idempotencyKey === `mission-backend-kill:rehydrated:${backendRecoveryStartedAtMs}`), true)
assert.match(backendRecoveryLogs.at(-1)?.message || '', /rehydrated 1 mission record\(s\) from the ledger after restart \(1 active\)/)

const staleLocalMission = {
  id: 'mission-stale-local',
  title: 'Stale Local Mission',
  description: 'Renderer-local state that should be replaced after reload.',
  complexity: 40,
  riskTolerance: 20,
  durationMode: 'timed',
  durationValue: 1,
  durationUnit: 'hours',
  collaborationMode: 'parallel',
  missionType: 'planning',
  selectedAgents: ['hn-commander'],
  startedAt: '2026-06-30T10:00:00.000Z',
  endedAt: '2026-06-30T10:05:00.000Z',
  status: 'cancelled',
  heartbeatLifecycle: 'stale renderer cache',
  schedulerLifecycle: 'stale renderer cache',
}

const staleLocalReport = {
  id: 'mission-report:mission-stale-local',
  missionId: 'mission-stale-local',
  generatedAt: '2026-06-30T10:05:00.000Z',
  efficiencyRating: null,
  soulDrift: null,
  heartbeatStabilityScore: null,
  runtimeEfficiency: null,
  errors: null,
  xpGained: null,
  skillUnlocks: [],
}

const storage = new Map<string, string>([
  ['nexus-v10', JSON.stringify({
    state: {
      _version: 5,
      activePartyIds: ['hn-commander'],
      confirmedPartyIds: ['hn-commander'],
      missionHistory: [staleLocalMission],
      missionReports: [staleLocalReport],
    },
    version: 0,
  })],
])

const localStorageShim = {
  getItem: (name: string) => storage.get(name) ?? null,
  removeItem: (name: string) => {
    storage.delete(name)
  },
  setItem: (name: string, value: string) => {
    storage.set(name, value)
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageShim,
})

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: () => undefined,
    clearTimeout,
    localStorage: localStorageShim,
    location: { port: '5173' },
    removeEventListener: () => undefined,
    setTimeout,
  },
})

const missionScheduler = {
  engine: 'openclaw-cron',
  policy: 'leader-first',
  status: 'running',
  round: 3,
  nextRoundAt: '2026-06-30T12:05:00.000Z',
  activeJobId: 'job-recovered-active',
  jobs: [
    {
      id: 'job-recovered-active',
      cronId: 'cron-recovered-active',
      agentId: 'hn-commander',
      role: 'leader',
      round: 3,
      status: 'running',
      summary: 'Recovered cron job remains active after backend restart.',
    },
  ],
}

const recoveredActiveMission = {
  id: 'mission-recovered-active',
  title: 'Recovered Active Backend Mission',
  brief: 'Mission recovered from durable backend ledger after backend restart.',
  mode: 'hours',
  amount: 1,
  missionType: 'planning',
  collaborationMode: 'parallel',
  complexity: 62,
  riskTolerance: 18,
  cadenceSeconds: 60,
  startAt: '2026-06-30T12:00:00.000Z',
  endAt: null,
  status: 'active',
  lifecycleState: 'running',
  party: ['hn-commander'],
  createdAt: '2026-06-30T12:00:00.000Z',
  completedAt: null,
  scheduler: missionScheduler,
}

const recoveredFailedMission = {
  ...recoveredActiveMission,
  id: 'mission-recovered-failed',
  title: 'Recovered Failed Backend Mission',
  brief: 'Mission failed during backend restart recovery because the cron job disappeared.',
  status: 'cancelled',
  lifecycleState: 'failed',
  startAt: '2026-06-30T11:00:00.000Z',
  endAt: '2026-06-30T11:08:00.000Z',
  completedAt: '2026-06-30T11:08:00.000Z',
  scheduler: {
    ...missionScheduler,
    status: 'failed',
    round: 1,
    activeJobId: null,
    jobs: [
      {
        ...missionScheduler.jobs[0],
        id: 'job-recovered-failed',
        cronId: 'cron-recovered-failed',
        status: 'removed',
        summary: 'OpenClaw cron job was missing during startup reconciliation.',
      },
    ],
  },
}

const projectionPayload = {
  generatedAt: '2026-06-30T12:01:00.000Z',
  missions: [recoveredActiveMission, recoveredFailedMission],
  feed: [
    {
      id: 'event-recovered-active',
      missionId: 'mission-recovered-active',
      at: '2026-06-30T12:00:05.000Z',
      type: 'mission_started',
      message: 'Mission rehydrated from durable record: Recovered Active Backend Mission',
    },
    {
      id: 'event-recovered-failed',
      missionId: 'mission-recovered-failed',
      at: '2026-06-30T11:08:00.000Z',
      type: 'mission_cancelled',
      message: 'Mission scheduler reconciliation failed: 1 missing cron job(s)',
    },
  ],
  reports: [
    {
      id: 'mission-report:mission-recovered-failed',
      missionId: 'mission-recovered-failed',
      generatedAt: '2026-06-30T11:08:01.000Z',
      efficiencyRating: null,
      soulDrift: null,
      heartbeatStabilityScore: 92,
      runtimeEfficiency: null,
      errors: 1,
      xpGained: null,
      skillUnlocks: [],
      evidence: {
        source: 'mission-feed',
        acceptedRuns: 1,
        startedRuns: 1,
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 1,
        timedOutRuns: 0,
        retryCount: 0,
        fallbackCount: 0,
        verificationFailures: 0,
        toolFailures: 0,
        commandFailures: 1,
        humanInterventions: 0,
        agentParticipation: ['hn-commander'],
        queueDelayMs: null,
        timeToFirstTokenMs: null,
        totalExecutionDurationMs: null,
        missionWallTimeMs: 480000,
        tokenUsageEstimate: null,
        unavailableMetrics: ['efficiencyRating', 'soulDrift', 'runtimeEfficiency', 'xpGained'],
      },
    },
  ],
  projection: {
    source: 'memory+ledger',
    missionCount: 2,
    activeMissionCount: 1,
    durableRecordCount: 2,
    memoryRecordCount: 1,
  },
}

const fetchCalls: string[] = []
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    fetchCalls.push(url)
    assert.match(url, /\/api\/missions\/projection$/, 'renderer recovery smoke should only request the backend projection endpoint')
    return new Response(JSON.stringify({ ok: true, data: projectionPayload }), {
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'smoke-mission-restart-recovery',
      },
      status: 200,
    })
  },
})

const { useNexusStore } = await import('../src/store/nexusStore.ts')

try {
  assert.equal(useNexusStore.getState().activeMission, null, 'active mission should not be persisted across renderer reloads')
  assert.equal(useNexusStore.getState().missionHistory[0]?.id, 'mission-stale-local', 'smoke precondition should start with stale renderer history')

  await useNexusStore.getState().syncMissionProjection()

  const state = useNexusStore.getState()
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0], 'http://127.0.0.1:4050/api/missions/projection')
  assert.equal(state.activeMission?.id, 'mission-recovered-active')
  assert.equal(state.activeMission?.title, 'Recovered Active Backend Mission')
  assert.equal(state.activeMission?.status, 'running')
  assert.equal(state.activeMission?.scheduler?.status, 'running')
  assert.equal(state.activeMission?.scheduler?.round, 3)
  assert.equal(state.missionHistory.some((mission) => mission.id === 'mission-stale-local'), false, 'recovered backend history should replace stale renderer-local history')
  assert.equal(state.missionHistory[0]?.id, 'mission-recovered-failed')
  assert.equal(state.missionHistory[0]?.status, 'failed', 'failed recovered lifecycle should remain failed in the Mission page projection')
  assert.equal(state.missionReports[0]?.missionId, 'mission-recovered-failed')
  assert.equal(state.missionReports.some((report) => report.missionId === 'mission-stale-local'), true, 'local reports unrelated to backend mission ids should be retained')
  assert.equal(state.missionFeed[0]?.message, 'Mission rehydrated from durable record: Recovered Active Backend Mission')
} finally {
  useNexusStore.setState({ activeMission: null })
  useNexusStore.getState().stopMission()
}

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-restart-recovery'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-restart-recovery/)

console.log('mission restart and renderer recovery projection smoke ok')

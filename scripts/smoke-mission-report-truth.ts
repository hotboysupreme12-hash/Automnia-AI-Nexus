import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMissionReport } from '../src/engine/missionReport'
import type { AgentActivityEvent, AgentResponse, MissionEvent, MissionRun } from '../src/types/nexus'

const rootDir = fileURLToPath(new URL('..', import.meta.url))

function activity(id: string, type: string, label: string, timestamp: string): AgentActivityEvent {
  return {
    id,
    type,
    label,
    rawSource: 'mission-report-smoke',
    timestamp,
    severity: 'info',
    surface: 'activity',
    collapsed: false,
    dedupeKey: id,
  }
}

const mission: MissionRun = {
  id: 'mission-truth-smoke',
  title: 'Mission truth smoke',
  description: 'Exercise evidence-backed mission reporting.',
  complexity: 6,
  riskTolerance: 20,
  durationMode: 'instant',
  durationValue: 1,
  durationUnit: 'hours',
  collaborationMode: 'swarm',
  missionType: 'codeGeneration',
  selectedAgents: ['agent-success', 'agent-failure'],
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:02:00.000Z',
  status: 'completed',
  heartbeatLifecycle: 'single cycle, auto-terminate',
}

const responses: AgentResponse[] = [
  {
    id: 'response-success',
    missionId: mission.id,
    agentId: 'agent-success',
    prompt: 'Implement the slice',
    response: 'Completed implementation and verification.',
    ok: true,
    timestamp: '2026-01-01T00:00:40.000Z',
    durationMs: 35_000,
    queuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:05.000Z',
    firstTokenAt: '2026-01-01T00:00:08.000Z',
    completedAt: '2026-01-01T00:00:40.000Z',
    tokenCountEstimate: 220,
    activity: [
      activity('success-accepted', 'run.accepted', 'Accepted task.', '2026-01-01T00:00:00.000Z'),
      activity('success-started', 'run.started', 'Started work.', '2026-01-01T00:00:05.000Z'),
      activity('success-retry-1', 'run.retrying', 'Transient provider retry.', '2026-01-01T00:00:12.000Z'),
      activity('success-retry-2', 'run.retrying', 'Second transient provider retry.', '2026-01-01T00:00:18.000Z'),
      activity('success-finished', 'run.finished', 'Finished work.', '2026-01-01T00:00:40.000Z'),
    ],
  },
  {
    id: 'response-failure',
    missionId: mission.id,
    agentId: 'agent-failure',
    prompt: 'Verify the slice',
    response: 'Blocked by deterministic failure.',
    ok: false,
    timestamp: '2026-01-01T00:01:10.000Z',
    durationMs: 50_000,
    failureKind: 'runtime-error',
    queuedAt: '2026-01-01T00:00:10.000Z',
    startedAt: '2026-01-01T00:00:20.000Z',
    firstTokenAt: '2026-01-01T00:00:25.000Z',
    completedAt: '2026-01-01T00:01:10.000Z',
    tokenCountEstimate: 110,
    activity: [
      activity('failure-accepted', 'run.accepted', 'Accepted task.', '2026-01-01T00:00:10.000Z'),
      activity('failure-started', 'run.started', 'Started work.', '2026-01-01T00:00:20.000Z'),
      activity('failure-failed', 'run.failed', 'Runtime failed.', '2026-01-01T00:01:10.000Z'),
    ],
  },
]

const feed: MissionEvent[] = [
  {
    id: 'verification-failure',
    missionId: mission.id,
    timestamp: '2026-01-01T00:01:30.000Z',
    type: 'runtime',
    message: 'Verification failed: acceptance evidence missing.',
  },
]

const report = buildMissionReport({ mission, responses, feed, generatedAt: '2026-01-01T00:02:01.000Z' })

assert.equal(report.evidence?.source, 'mixed')
assert.equal(report.evidence?.acceptedRuns, 2)
assert.equal(report.evidence?.startedRuns, 2)
assert.equal(report.evidence?.completedRuns, 1)
assert.equal(report.evidence?.failedRuns, 1)
assert.equal(report.evidence?.retryCount, 2)
assert.equal(report.evidence?.verificationFailures, 1)
assert.equal(report.evidence?.queueDelayMs, 7_500)
assert.equal(report.evidence?.timeToFirstTokenMs, 4_000)
assert.equal(report.evidence?.totalExecutionDurationMs, 85_000)
assert.equal(report.evidence?.missionWallTimeMs, 120_000)
assert.equal(report.evidence?.tokenUsageEstimate, 330)
assert.equal(report.xpGained, null)
assert.equal(report.soulDrift, null)
assert.ok(report.evidence?.unavailableMetrics.includes('xpGained'))
assert.ok(report.evidence?.unavailableMetrics.includes('soulDrift'))
assert.ok(typeof report.efficiencyRating === 'number')
assert.ok(report.efficiencyRating < 50, 'the failed agent, retries, and verification failure must lower efficiency')

const engineIndexSource = readFileSync(join(rootDir, 'src/engine/index.ts'), 'utf8')
assert.doesNotMatch(engineIndexSource, /MissionOrchestrator/, 'engine exports must not expose the retired renderer mission lifecycle owner')

const reportPanelSource = readFileSync(join(rootDir, 'src/components/monitor/MissionReportPanel.tsx'), 'utf8')
assert.match(reportPanelSource, /Unavailable/, 'mission report UI must display unavailable metrics explicitly')

const storeSource = readFileSync(join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
assert.match(storeSource, /backendMissionIds = new Set\(backendMissions\.map/, 'backend mission ids must be tracked when merging backend reports')
assert.doesNotMatch(storeSource, /generatedReports/, 'backend-controlled missions must not synthesize renderer-generated reports')
assert.doesNotMatch(storeSource, /buildMissionReport\(\{ mission, responses: s\.agentResponses, feed: missionFeed \}\)/, 'backend projection sync must not generate reports from local renderer feed')
assert.doesNotMatch(storeSource, /MissionOrchestrator|orchestrator/, 'renderer store must not own mission lifecycle through MissionOrchestrator')
assert.match(storeSource, /missionReports:\s*s\.missionReports\.slice\(0,\s*MAX_REPORTS\)/, 'completed mission reports must persist across restarts')
assert.doesNotMatch(storeSource, /fetch\(apiUrl\('\/api\/missions(?:\/start|\/stop)?'/, 'mission lifecycle calls must use the authenticated API client')

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-report'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-report/, 'test:ci must include mission report truth coverage')

console.log('mission report truth contract ok')

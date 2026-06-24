import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  appendMissionRecordLedger,
  appendMissionEventLedger,
  appendMissionReportLedger,
  closeRuntimeLedger,
  configureRuntimeLedger,
  readMissionRecordLedgerTail,
  readMissionEventLedgerTail,
  readMissionReportLedgerTail,
} from '../server/runtimeLedger.ts'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dystopai-mission-ledger-'))

try {
  const missionRecordsJsonl = path.join(tempDir, 'mission-records.jsonl')
  const missionEventsJsonl = path.join(tempDir, 'mission-events.jsonl')
  const missionReportsJsonl = path.join(tempDir, 'mission-reports.jsonl')
  configureRuntimeLedger({
    directory: tempDir,
    runtimeRunsJsonl: path.join(tempDir, 'runtime-runs.jsonl'),
    gatewayEventsJsonl: path.join(tempDir, 'gateway-events.jsonl'),
    diagnosticRunsJsonl: path.join(tempDir, 'diagnostic-runs.jsonl'),
    missionRecordsJsonl,
    missionEventsJsonl,
    missionReportsJsonl,
  })

  const record = {
    id: 'mission-1',
    missionId: 'mission-1',
    title: 'Durable mission smoke',
    brief: 'Persist and rehydrate mission records.',
    mode: 'instant',
    amount: null,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: null,
    status: 'active',
    lifecycleState: 'running',
    party: ['agent-a', 'agent-b'],
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    updatedAt: '2026-01-01T00:01:00.000Z',
    persistedAt: '2026-01-01T00:01:00.000Z',
    persistReason: 'smoke',
    scheduler: {
      engine: 'openclaw-cron',
      policy: 'leader-first',
      status: 'waiting',
      round: 1,
      cycleIntervalMs: 15000,
      nextRoundAt: '2026-01-01T00:01:15.000Z',
      maxCycles: null,
      leaderAgentId: 'agent-a',
      activeJobId: null,
      jobs: [],
      lastError: null,
    },
  }
  const event = {
    id: 'event-1',
    missionId: 'mission-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    at: '2026-01-01T00:00:00.000Z',
    type: 'mission_started',
    actor: 'control-center',
    previousState: 'draft',
    nextState: 'validating',
    idempotencyKey: 'mission-1:draft->validating',
    message: 'Mission accepted for validation.',
    evidence: { partySize: 2 },
  }
  const report = {
    id: 'mission-report:mission-1',
    missionId: 'mission-1',
    generatedAt: '2026-01-01T00:02:00.000Z',
    efficiencyRating: null,
    soulDrift: null,
    heartbeatStabilityScore: 100,
    runtimeEfficiency: null,
    errors: 0,
    xpGained: null,
    skillUnlocks: [],
    evidence: {
      source: 'mission-feed',
      acceptedRuns: 2,
      startedRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      timedOutRuns: 0,
      retryCount: 0,
      fallbackCount: 0,
      verificationFailures: 0,
      toolFailures: 0,
      commandFailures: 0,
      humanInterventions: 0,
      agentParticipation: [],
      queueDelayMs: null,
      timeToFirstTokenMs: null,
      totalExecutionDurationMs: null,
      missionWallTimeMs: 120000,
      tokenUsageEstimate: null,
      unavailableMetrics: ['efficiencyRating', 'soulDrift', 'runtimeEfficiency', 'xpGained'],
    },
  }

  await appendMissionRecordLedger(record, { sqlite: false })
  await appendMissionEventLedger(event, { sqlite: false })
  await appendMissionReportLedger(report, { sqlite: false })

  const records = await readMissionRecordLedgerTail<typeof record>(10, { sqlite: false })
  assert.equal(records.length, 1)
  assert.equal(records[0]?.missionId, 'mission-1')
  assert.equal(records[0]?.lifecycleState, 'running')
  assert.equal(records[0]?.scheduler.status, 'waiting')

  const events = await readMissionEventLedgerTail<typeof event>(10, { sqlite: false })
  assert.equal(events.length, 1)
  assert.equal(events[0]?.previousState, 'draft')
  assert.equal(events[0]?.nextState, 'validating')
  assert.equal(events[0]?.idempotencyKey, 'mission-1:draft->validating')

  const reports = await readMissionReportLedgerTail<typeof report>(10, { sqlite: false })
  assert.equal(reports.length, 1)
  assert.equal(reports[0]?.missionId, 'mission-1')
  assert.equal(reports[0]?.evidence.acceptedRuns, 2)

  const recordLedgerText = await readFile(missionRecordsJsonl, 'utf8')
  const eventLedgerText = await readFile(missionEventsJsonl, 'utf8')
  const reportLedgerText = await readFile(missionReportsJsonl, 'utf8')
  assert.match(recordLedgerText, /"missionId":"mission-1"/)
  assert.match(recordLedgerText, /"lifecycleState":"running"/)
  assert.match(eventLedgerText, /"idempotencyKey":"mission-1:draft->validating"/)
  assert.match(reportLedgerText, /"missionId":"mission-1"/)

  const runtimeLedgerSource = readFileSync(path.join(rootDir, 'server/runtimeLedger.ts'), 'utf8')
  assert.match(runtimeLedgerSource, /CREATE TABLE IF NOT EXISTS mission_events/)
  assert.match(runtimeLedgerSource, /CREATE TABLE IF NOT EXISTS mission_records/)
  assert.match(runtimeLedgerSource, /CREATE TABLE IF NOT EXISTS mission_reports/)
  assert.match(runtimeLedgerSource, /appendMissionRecordLedger/)
  assert.match(runtimeLedgerSource, /readMissionRecordLedgerTail/)
  assert.match(runtimeLedgerSource, /appendMissionEventLedger/)
  assert.match(runtimeLedgerSource, /readMissionReportLedgerTail/)

  const serverSource = readFileSync(path.join(rootDir, 'server/index.ts'), 'utf8')
  assert.match(serverSource, /type MissionLifecycleState/)
  assert.match(serverSource, /missionRecordSnapshot/)
  assert.match(serverSource, /persistMissionRecord/)
  assert.match(serverSource, /hydrateMissionRecordsFromLedger/)
  assert.match(serverSource, /armRehydratedMissionTimer/)
  assert.match(serverSource, /transitionMissionState/)
  assert.match(serverSource, /recordMissionReport/)
  assert.match(serverSource, /registerMissionRoutes\(app, \{/)
  assert.doesNotMatch(serverSource, /app\.get\('\/api\/missions\/:missionId\/events'/)
  assert.match(serverSource, /type MissionLifecycleProjection =/)
  assert.match(serverSource, /reports: BackendMissionReport\[\]/, 'mission lifecycle projection must return backend reports')
  const missionRoutesSource = readFileSync(path.join(rootDir, 'server/routes/missionRoutes.ts'), 'utf8')
  assert.match(missionRoutesSource, /app\.get\('\/api\/missions\/:missionId\/events'/)
  assert.match(missionRoutesSource, /app\.get\('\/api\/missions\/:missionId\/report'/)
  assert.match(missionRoutesSource, /app\.get\('\/api\/missions\/projection'/, '/api/missions/projection must expose durable mission state')

  const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
  assert.match(storeSource, /reports\?: MissionReport\[\]/)
  assert.match(storeSource, /backendReports/)
  assert.match(storeSource, /backendMissionIds = new Set\(backendMissions\.map/)
  assert.match(storeSource, /\.\.\.backendReports,\s*\.\.\.retainedReports/)
  assert.doesNotMatch(storeSource, /generatedReports/, 'backend mission projections must not synthesize renderer-generated reports')

  const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  const scripts = packageJson.scripts || {}
  assert.equal(typeof scripts['smoke:mission-durable-state'], 'string')
  assert.match(scripts['test:ci'] || '', /npm run smoke:mission-durable-state/)

  console.log('mission durable state contract ok')
} finally {
  closeRuntimeLedger()
  await rm(tempDir, { recursive: true, force: true })
}

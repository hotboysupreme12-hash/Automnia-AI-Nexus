import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-mission-report'
const AGENT_ID = 'phase-k-report-agent'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'mission-report-inspection-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'MISSION_REPORT_INSPECTION_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '17-mission-report-inspection-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type MissionScheduler = {
  status?: string
  round?: number
  cycleIntervalMs?: number
  maxCycles?: number | null
  jobs?: Array<{ status?: string; role?: string; agentId?: string }>
}

type MissionView = {
  id: string
  idempotencyKey?: string
  title: string
  mode: 'instant' | 'hours' | 'days' | 'weeks' | 'continuous' | 'indefinite'
  amount: number | null
  status: 'active' | 'completed' | 'cancelled'
  lifecycleState?: string
  party: string[]
  startAt: string
  endAt: string | null
  completedAt: string | null
  progress?: number | null
  scheduler?: MissionScheduler
}

type MissionStartPayload = {
  deduped: boolean
  idempotencyKey: string | null
  mission: MissionView
}

type MissionStopPayload = {
  mission: MissionView
  cleanup: {
    attempted: number
    removed: number
    disabled: number
    failed: number
  }
}

type MissionLifecycleEvent = {
  id?: string
  missionId: string
  type?: string
  message?: string
  actor?: string
  previousState?: string | null
  nextState?: string | null
  evidence?: Record<string, unknown>
}

type BackendMissionReport = {
  id: string
  missionId: string
  generatedAt: string
  efficiencyRating: number | null
  soulDrift: number | null
  heartbeatStabilityScore: number | null
  runtimeEfficiency: number | null
  errors: number | null
  xpGained: number | null
  skillUnlocks: string[]
  evidence: {
    source?: string
    acceptedRuns?: number
    startedRuns?: number
    completedRuns?: number
    failedRuns?: number
    cancelledRuns?: number
    humanInterventions?: number
    agentParticipation?: string[]
    runtimeRunIds?: string[]
    cronRunIds?: string[]
    sessionIds?: string[]
    sessionKeys?: string[]
    unavailableMetrics?: string[]
  }
}

type MissionProjectionPayload = {
  missions?: MissionView[]
  events?: MissionLifecycleEvent[]
  reports?: BackendMissionReport[]
  projection?: {
    missionCount?: number
    activeMissionCount?: number
    durableRecordCount?: number
    memoryRecordCount?: number
    reportCount?: number
  }
}

type MissionEventsPayload = {
  missionId: string
  events: MissionLifecycleEvent[]
}

type MissionLifecyclePayload = MissionProjectionPayload & {
  missionId: string
  mission: MissionView | null
  report?: BackendMissionReport | null
}

type MissionReportPayload = {
  missionId: string
  report: BackendMissionReport
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not allocate a local TCP port'))
      })
    })
  })
}

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const configPath = path.join(stateDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n', 'utf8')
  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONTROL_CENTER_PORT: String(port),
      CONTROL_CENTER_TOKEN: CONTROL_TOKEN,
      CONTROL_CENTER_LOGIN_MAX_ATTEMPTS: '3',
      CONTROL_CENTER_LOGIN_BASE_LOCKOUT_MS: '1000',
      CONTROL_CENTER_LOGIN_MAX_LOCKOUT_MS: '4000',
      CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
      CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
      CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
      CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
      CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
      CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
      CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
      CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
      CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_HOME: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function waitForReady(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Control Center exited ${child.exitCode}\n${output.slice(-3000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
      if (response.ok) return output
    } catch {
      // Retry until startup either succeeds or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Control Center did not become ready\n${output.slice(-3000)}`)
}

async function api<T>(
  port: number,
  apiPath: string,
  options: { method?: string; token?: string; body?: unknown; requestId?: string } = {},
) {
  const requestId = options.requestId || `phase-k-report-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({ 'X-Request-Id': requestId })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json() as ApiEnvelope<T>
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(payload.requestId, requestId)
  if (!response.ok || !payload.ok) {
    const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
    throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
  }
  return payload.data
}

async function login(port: number) {
  const data = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-report-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

async function launchReportMission(port: number, token: string) {
  const data = await api<MissionStartPayload>(port, '/api/missions/start', {
    method: 'POST',
    token,
    requestId: 'phase-k-report-mission-start',
    body: {
      idempotencyKey: 'phase-k-mission-report-129',
      title: 'Phase K Mission Report Inspection Smoke',
      brief: 'Create a mission report in isolated beta state and inspect it through the authenticated report API.',
      party: [AGENT_ID],
      mode: 'continuous',
      amount: null,
      missionType: 'manual-beta-smoke',
      collaborationMode: 'solo',
      complexity: 12,
      riskTolerance: 8,
      cadenceSeconds: 60,
      maxCycles: 3,
    },
  })
  assert.equal(data.deduped, false)
  assert.equal(data.idempotencyKey, 'phase-k-mission-report-129')
  assert.equal(data.mission.idempotencyKey, 'phase-k-mission-report-129')
  assert.equal(data.mission.status, 'active')
  assert.equal(data.mission.lifecycleState, 'running')
  assert.deepEqual(data.mission.party, [AGENT_ID])
  assert.equal(data.mission.scheduler?.status, 'waiting')
  return data.mission
}

function launchTransitionsReady(events: MissionLifecycleEvent[]) {
  const pairs = new Set(events.map((event) => `${event.previousState || ''}->${event.nextState || ''}`))
  return pairs.has('draft->validating')
    && pairs.has('validating->scheduled')
    && pairs.has('scheduled->running')
    && events.some((event) => event.type === 'agent_assigned' && event.missionId)
    && events.some((event) => event.type === 'agent_update' && event.evidence?.dryRun === true)
}

function reportEventsReady(events: MissionLifecycleEvent[]) {
  return launchTransitionsReady(events) && events.some((event) =>
    event.type === 'mission_cancelled'
    && event.actor === 'operator'
    && event.previousState === 'running'
    && event.nextState === 'cancelled',
  )
}

async function waitForMissionEvents(
  port: number,
  token: string,
  missionId: string,
  predicate: (events: MissionLifecycleEvent[]) => boolean,
  label: string,
) {
  const deadline = Date.now() + 8_000
  let lastPayload: MissionEventsPayload | null = null
  while (Date.now() < deadline) {
    lastPayload = await api<MissionEventsPayload>(port, `/api/missions/${encodeURIComponent(missionId)}/events`, {
      token,
      requestId: `phase-k-report-events-${Math.random().toString(36).slice(2, 8)}`,
    })
    if (predicate(lastPayload.events)) return lastPayload.events
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission events did not include ${label} for ${missionId}: ${JSON.stringify(lastPayload?.events || [])}`)
}

async function stopMission(port: number, token: string, missionId: string) {
  const data = await api<MissionStopPayload>(port, '/api/missions/stop', {
    method: 'POST',
    token,
    requestId: 'phase-k-report-mission-stop',
    body: { missionId, reason: 'phase k manual beta mission report inspection smoke' },
  })
  assert.equal(data.mission.id, missionId)
  assert.equal(data.mission.status, 'cancelled')
  assert.equal(data.mission.lifecycleState, 'cancelled')
  assert.equal(data.cleanup.failed, 0)
  return data
}

async function fetchMissionReport(port: number, token: string, missionId: string) {
  const payload = await api<MissionReportPayload>(port, `/api/missions/${encodeURIComponent(missionId)}/report`, {
    token,
    requestId: `phase-k-report-route-${missionId.slice(0, 8)}`,
  })
  assert.equal(payload.missionId, missionId)
  assert.equal(payload.report.id, `mission-report:${missionId}`)
  assert.equal(payload.report.missionId, missionId)
  assert.equal(Number.isFinite(Date.parse(payload.report.generatedAt)), true)
  assert.equal(payload.report.evidence.source, 'mission-feed')
  assert.ok((payload.report.evidence.acceptedRuns || 0) >= 1)
  assert.ok((payload.report.evidence.startedRuns || 0) >= 1)
  assert.equal(payload.report.evidence.completedRuns || 0, 0)
  assert.equal(payload.report.evidence.failedRuns || 0, 0)
  assert.ok((payload.report.evidence.cancelledRuns || 0) >= 1)
  assert.ok((payload.report.evidence.humanInterventions || 0) >= 1)
  assert.deepEqual(payload.report.evidence.agentParticipation || [], [AGENT_ID])
  assert.deepEqual(payload.report.evidence.runtimeRunIds || [], [])
  assert.deepEqual(payload.report.evidence.cronRunIds || [], [])
  assert.deepEqual(payload.report.evidence.sessionIds || [], [])
  assert.deepEqual(payload.report.evidence.sessionKeys || [], [])
  for (const metric of ['efficiencyRating', 'soulDrift', 'runtimeEfficiency', 'xpGained']) {
    assert.ok(payload.report.evidence.unavailableMetrics?.includes(metric), `report should mark ${metric} unavailable`)
  }
  assert.equal(typeof payload.report.heartbeatStabilityScore, 'number')
  assert.equal(payload.report.efficiencyRating, null)
  assert.equal(payload.report.runtimeEfficiency, null)
  assert.equal(payload.report.soulDrift, null)
  assert.equal(payload.report.xpGained, null)
  return payload.report
}

async function fetchLifecycleReport(port: number, token: string, missionId: string, expectedReportId: string) {
  const lifecycle = await api<MissionLifecyclePayload>(port, `/api/missions/${encodeURIComponent(missionId)}/lifecycle`, {
    token,
    requestId: `phase-k-report-lifecycle-${missionId.slice(0, 8)}`,
  })
  assert.equal(lifecycle.missionId, missionId)
  assert.equal(lifecycle.mission?.id, missionId)
  assert.equal(lifecycle.mission?.status, 'cancelled')
  assert.equal(lifecycle.report?.id, expectedReportId)
  assert.equal(lifecycle.report?.missionId, missionId)
  assert.ok((lifecycle.events || []).some((event) => event.type === 'mission_cancelled'))
  return lifecycle
}

async function fetchProjectionReport(port: number, token: string, missionId: string, expectedReportId: string) {
  const projection = await api<MissionProjectionPayload>(port, '/api/missions/projection', {
    token,
    requestId: 'phase-k-report-projection',
  })
  const projectedMission = (projection.missions || []).find((mission) => mission.id === missionId)
  const projectedReport = (projection.reports || []).find((report) => report.id === expectedReportId)
  assert.equal(projectedMission?.status, 'cancelled')
  assert.equal(projectedMission?.lifecycleState, 'cancelled')
  assert.equal(projectedReport?.missionId, missionId)
  assert.ok((projection.projection?.reportCount || 0) >= 1)
  return { projection, projectedMission, projectedReport }
}

async function waitForMissionReportLedger(stateDir: string, missionId: string, reportId: string) {
  const missionReportLedger = path.join(stateDir, 'control-center-ledger', 'mission-reports.jsonl')
  const deadline = Date.now() + 8_000
  let raw = ''
  while (Date.now() < deadline) {
    if (existsSync(missionReportLedger)) {
      raw = readFileSync(missionReportLedger, 'utf8')
      if (raw.includes(reportId) && raw.includes(missionId) && raw.includes('mission-feed')) {
        return {
          path: missionReportLedger,
          bytes: Buffer.byteLength(raw, 'utf8'),
          containsReportId: true,
          containsMissionId: true,
          containsMissionFeedSource: true,
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission report ledger did not include report ${reportId}: ${raw.slice(-1000)}`)
}

function summarizeEvents(events: MissionLifecycleEvent[]) {
  return {
    count: events.length,
    transitions: events
      .filter((event) => event.previousState || event.nextState)
      .map((event) => `${event.previousState || ''}->${event.nextState || ''}`),
    assignedEvents: events.filter((event) => event.type === 'agent_assigned').length,
    dryRunEvents: events.filter((event) => event.evidence?.dryRun === true).length,
    operatorEvents: events.filter((event) => event.actor === 'operator').length,
    reportTerminalEvents: events.filter((event) => event.type === 'mission_cancelled').length,
  }
}

function summarizeReport(report: BackendMissionReport) {
  return {
    id: report.id,
    missionId: report.missionId,
    generatedAt: report.generatedAt,
    source: report.evidence.source || null,
    acceptedRuns: report.evidence.acceptedRuns ?? null,
    startedRuns: report.evidence.startedRuns ?? null,
    completedRuns: report.evidence.completedRuns ?? null,
    failedRuns: report.evidence.failedRuns ?? null,
    cancelledRuns: report.evidence.cancelledRuns ?? null,
    humanInterventions: report.evidence.humanInterventions ?? null,
    agentParticipation: report.evidence.agentParticipation || [],
    heartbeatStabilityScore: report.heartbeatStabilityScore,
    efficiencyRating: report.efficiencyRating,
    runtimeEfficiency: report.runtimeEfficiency,
    unavailableMetrics: report.evidence.unavailableMetrics || [],
    runtimeRunIds: report.evidence.runtimeRunIds || [],
    cronRunIds: report.evidence.cronRunIds || [],
    sessionIds: report.evidence.sessionIds || [],
  }
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ])
  if (child.exitCode === null && child.pid && process.platform !== 'win32') child.kill('SIGKILL')
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|sessionToken["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-mission-report-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  const startupOutput = await waitForReady(child, port)
  const token = await login(port)
  const mission = await launchReportMission(port, token)
  await waitForMissionEvents(port, token, mission.id, launchTransitionsReady, 'launch transitions')
  const stopped = await stopMission(port, token, mission.id)
  const terminalEvents = await waitForMissionEvents(port, token, mission.id, reportEventsReady, 'report terminal events')
  const report = await fetchMissionReport(port, token, mission.id)
  const lifecycle = await fetchLifecycleReport(port, token, mission.id, report.id)
  const projectionResult = await fetchProjectionReport(port, token, mission.id, report.id)
  const ledger = await waitForMissionReportLedger(stateDir, mission.id, report.id)

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [129],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-mission-report-inspection-dry-run',
    scheduler: {
      dryRunEnv: 'CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN',
      dryRunEnabled: true,
      reason: 'Manual beta report inspection should not require live provider credentials.',
    },
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
    },
    mission: {
      id: mission.id,
      idempotencyKey: mission.idempotencyKey,
      title: mission.title,
      stopStatus: stopped.mission.status,
      stopLifecycleState: stopped.mission.lifecycleState,
      cleanupFailed: stopped.cleanup.failed,
    },
    inspection: {
      item: 129,
      reportRoute: `/api/missions/${mission.id}/report`,
      lifecycleRoute: `/api/missions/${mission.id}/lifecycle`,
      projectionRoute: '/api/missions/projection',
      report: summarizeReport(report),
      lifecycleReportMatches: lifecycle.report?.id === report.id,
      projectionReportMatches: projectionResult.projectedReport?.id === report.id,
      projectedMissionStatus: projectionResult.projectedMission?.status || null,
      events: summarizeEvents(terminalEvents),
      missionReportLedger: {
        path: path.relative(tempRoot, ledger.path),
        bytes: ledger.bytes,
        containsReportId: ledger.containsReportId,
        containsMissionId: ledger.containsMissionId,
        containsMissionFeedSource: ledger.containsMissionFeedSource,
      },
    },
    projection: {
      missionCount: projectionResult.projection.projection?.missionCount ?? null,
      activeMissionCount: projectionResult.projection.projection?.activeMissionCount ?? null,
      durableRecordCount: projectionResult.projection.projection?.durableRecordCount ?? null,
      memoryRecordCount: projectionResult.projection.projection?.memoryRecordCount ?? null,
      reportCount: projectionResult.projection.projection?.reportCount ?? null,
    },
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K mission-report evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=129',
    'blockedItems=none',
    `agentId=${AGENT_ID}`,
    `missionId=${mission.id}`,
    `reportId=${report.id}`,
    `reportSource=${report.evidence.source || 'unknown'}`,
    `cancelledRuns=${report.evidence.cancelledRuns ?? 'unknown'}`,
    `humanInterventions=${report.evidence.humanInterventions ?? 'unknown'}`,
    `projectionReportCount=${projectionResult.projection.projection?.reportCount ?? 'unknown'}`,
    `ledgerBytes=${ledger.bytes}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Mission Report Inspection Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta items covered:',
    '',
    '- 129. Complete: inspected a generated mission report through the authenticated mission report route.',
    '',
    'Evidence:',
    '',
    `- Agent: ${AGENT_ID}`,
    `- Mission: ${mission.id} (${stopped.mission.status}, lifecycle ${stopped.mission.lifecycleState})`,
    `- Report: ${report.id} (${report.evidence.source}, cancelled runs ${report.evidence.cancelledRuns ?? 'unknown'})`,
    `- Lifecycle report matches report route: ${lifecycle.report?.id === report.id}`,
    `- Projection report matches report route: ${projectionResult.projectedReport?.id === report.id}`,
    `- Durable mission report ledger bytes: ${ledger.bytes}`,
    `- Unavailable metrics: ${(report.evidence.unavailableMetrics || []).join(', ') || 'none'}`,
    '- Scheduler dry-run was enabled to prove report inspection without provider credentials.',
    '- Evidence stores token length and local isolated paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K mission-report inspection smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

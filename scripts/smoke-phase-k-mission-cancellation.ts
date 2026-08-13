import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-mission-cancellation'
const AGENT_ID = 'phase-k-cancel-agent'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'mission-cancellation-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'MISSION_CANCELLATION_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '09-mission-cancellation-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type MissionScheduler = {
  status?: string
  round?: number
  cycleIntervalMs?: number
  nextRoundAt?: string | null
  maxCycles?: number | null
  jobs?: Array<{ status?: string; role?: string; agentId?: string }>
}

type MissionView = {
  id: string
  idempotencyKey?: string
  title: string
  brief?: string
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

type MissionProjectionPayload = {
  missions?: MissionView[]
  events?: MissionLifecycleEvent[]
  feed?: MissionLifecycleEvent[]
  reports?: BackendMissionReport[]
  projection?: {
    missionCount?: number
    activeMissionCount?: number
    durableRecordCount?: number
    memoryRecordCount?: number
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
  idempotencyKey?: string
  evidence?: Record<string, unknown>
}

type BackendMissionReport = {
  id: string
  missionId: string
  generatedAt: string
  heartbeatStabilityScore?: number | null
  evidence?: {
    source?: string
    acceptedRuns?: number
    startedRuns?: number
    completedRuns?: number
    failedRuns?: number
    cancelledRuns?: number
    humanInterventions?: number
    agentParticipation?: string[]
    unavailableMetrics?: string[]
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

function isPathInsideOrSame(baseDir: string, targetPath: string) {
  const base = path.resolve(baseDir)
  const target = path.resolve(targetPath)
  const normalizedBase = process.platform === 'win32' ? base.toLowerCase() : base
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  const baseWithSeparator = normalizedBase.endsWith(path.sep) ? normalizedBase : `${normalizedBase}${path.sep}`
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(baseWithSeparator)
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
  const requestId = options.requestId || `phase-k-${Math.random().toString(36).slice(2)}`
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
    requestId: 'phase-k-mission-cancel-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

async function launchCancellableMission(port: number, token: string) {
  const data = await api<MissionStartPayload>(port, '/api/missions/start', {
    method: 'POST',
    token,
    requestId: 'phase-k-running-mission-before-cancel',
    body: {
      idempotencyKey: 'phase-k-cancel-mission-121',
      title: 'Phase K Mission Cancellation Smoke',
      brief: 'Launch one running mission in isolated beta state and cancel it through the authenticated stop route.',
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
  assert.equal(data.idempotencyKey, 'phase-k-cancel-mission-121')
  assert.equal(data.mission.idempotencyKey, 'phase-k-cancel-mission-121')
  assert.equal(data.mission.mode, 'continuous')
  assert.equal(data.mission.amount, null)
  assert.equal(data.mission.status, 'active')
  assert.equal(data.mission.lifecycleState, 'running')
  assert.deepEqual(data.mission.party, [AGENT_ID])
  assert.equal(data.mission.scheduler?.status, 'waiting')
  assert.equal(data.mission.scheduler?.round, 0)
  assert.equal(data.mission.scheduler?.cycleIntervalMs, 60_000)
  assert.equal(data.mission.scheduler?.maxCycles, 3)
  assert.deepEqual(data.mission.scheduler?.jobs || [], [])
  return data.mission
}

function startTransitionsReady(events: MissionLifecycleEvent[]) {
  const pairs = new Set(events.map((event) => `${event.previousState || ''}->${event.nextState || ''}`))
  return pairs.has('draft->validating')
    && pairs.has('validating->scheduled')
    && pairs.has('scheduled->running')
    && events.some((event) => event.type === 'agent_assigned' && event.missionId)
    && events.some((event) => event.type === 'agent_update' && event.evidence?.dryRun === true)
}

function cancellationEventsReady(events: MissionLifecycleEvent[]) {
  return events.some((event) =>
    event.type === 'agent_update'
    && event.actor === 'operator'
    && /Mission cancellation requested/i.test(event.message || '')
    && event.previousState === event.nextState,
  ) && events.some((event) =>
    event.type === 'mission_cancelled'
    && event.actor === 'operator'
    && event.previousState === 'running'
    && event.nextState === 'cancelled'
    && typeof event.evidence?.cleanup === 'object',
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
      requestId: `phase-k-cancel-events-${Math.random().toString(36).slice(2, 8)}`,
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
    requestId: 'phase-k-running-mission-cancel',
    body: { missionId, reason: 'phase k manual beta cancellation smoke' },
  })
  assert.equal(data.mission.id, missionId)
  assert.equal(data.mission.status, 'cancelled')
  assert.equal(data.mission.lifecycleState, 'cancelled')
  assert.equal(data.mission.scheduler?.status, 'stopped')
  assert.equal(data.cleanup.attempted, 0)
  assert.equal(data.cleanup.failed, 0)
  assert.equal(data.cleanup.removed, 0)
  assert.equal(data.cleanup.disabled, 0)
  assert.ok(data.mission.completedAt, 'cancelled mission should have completedAt')
  assert.ok(data.mission.endAt, 'cancelled mission should have endAt')
  return data
}

async function fetchCancelledProjection(port: number, token: string, missionId: string) {
  const deadline = Date.now() + 8_000
  let lastProjection: MissionProjectionPayload | null = null
  while (Date.now() < deadline) {
    lastProjection = await api<MissionProjectionPayload>(port, '/api/missions/projection', {
      token,
      requestId: `phase-k-cancel-projection-${Math.random().toString(36).slice(2, 8)}`,
    })
    const projected = (lastProjection.missions || []).find((mission) => mission.id === missionId)
    if (projected?.status === 'cancelled' && projected.lifecycleState === 'cancelled') {
      assert.equal(lastProjection.projection?.activeMissionCount, 0)
      return { projection: lastProjection, mission: projected }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission projection did not show cancelled mission ${missionId}: ${JSON.stringify(lastProjection?.projection || {})}`)
}

async function fetchCancelledLifecycle(port: number, token: string, missionId: string) {
  const lifecycle = await api<MissionLifecyclePayload>(port, `/api/missions/${encodeURIComponent(missionId)}/lifecycle`, {
    token,
    requestId: `phase-k-cancel-lifecycle-${missionId.slice(0, 8)}`,
  })
  assert.equal(lifecycle.missionId, missionId)
  assert.equal(lifecycle.mission?.id, missionId)
  assert.equal(lifecycle.mission?.status, 'cancelled')
  assert.equal(lifecycle.mission?.lifecycleState, 'cancelled')
  assert.ok((lifecycle.events || []).some((event) => event.type === 'mission_cancelled'))
  assert.equal(lifecycle.report?.missionId, missionId)
  assert.ok((lifecycle.report?.evidence?.cancelledRuns || 0) >= 1)
  return lifecycle
}

async function fetchCancellationReport(port: number, token: string, missionId: string) {
  const reportPayload = await api<MissionReportPayload>(port, `/api/missions/${encodeURIComponent(missionId)}/report`, {
    token,
    requestId: `phase-k-cancel-report-${missionId.slice(0, 8)}`,
  })
  assert.equal(reportPayload.missionId, missionId)
  assert.equal(reportPayload.report.missionId, missionId)
  assert.ok((reportPayload.report.evidence?.cancelledRuns || 0) >= 1)
  assert.ok((reportPayload.report.evidence?.humanInterventions || 0) >= 1)
  assert.deepEqual(reportPayload.report.evidence?.agentParticipation || [], [AGENT_ID])
  return reportPayload.report
}

function collectTeamSyncSnapshots(searchRoot: string, missionId: string) {
  const matches: Array<{ file: string; bytes: number; containsCancelled: boolean }> = []
  const stack = [searchRoot]
  while (stack.length) {
    const current = stack.pop()
    if (!current || !existsSync(current)) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }
      if (entry.isFile() && entry.name === 'TEAM_SYNC.md') {
        const raw = readFileSync(entryPath, 'utf8')
        if (raw.includes(missionId) && /cancelled/i.test(raw)) {
          matches.push({ file: entryPath, bytes: Buffer.byteLength(raw, 'utf8'), containsCancelled: true })
        }
      }
    }
  }
  assert.ok(matches.length > 0, `TEAM_SYNC.md should contain cancelled mission ${missionId}`)
  assert.equal(matches.every((match) => isPathInsideOrSame(searchRoot, match.file)), true)
  return matches
}

async function waitForMissionRecordLedger(stateDir: string, missionId: string) {
  const missionRecordLedger = path.join(stateDir, 'control-center-ledger', 'mission-records.jsonl')
  const deadline = Date.now() + 8_000
  let raw = ''
  while (Date.now() < deadline) {
    if (existsSync(missionRecordLedger)) {
      raw = readFileSync(missionRecordLedger, 'utf8')
      if (
        raw.includes(missionId)
        && raw.includes('cancellation-requested')
        && raw.includes('transition:running->cancelled')
      ) {
        return {
          path: missionRecordLedger,
          bytes: Buffer.byteLength(raw, 'utf8'),
          containsCancellationRequested: true,
          containsRunningToCancelled: true,
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission record ledger did not include cancellation evidence for ${missionId}: ${raw.slice(-1000)}`)
}

function summarizeMission(mission: MissionView) {
  return {
    id: mission.id,
    idempotencyKey: mission.idempotencyKey,
    title: mission.title,
    mode: mission.mode,
    amount: mission.amount,
    status: mission.status,
    lifecycleState: mission.lifecycleState,
    party: mission.party,
    progress: mission.progress ?? null,
    endAt: mission.endAt,
    completedAt: mission.completedAt,
    scheduler: {
      status: mission.scheduler?.status || null,
      round: mission.scheduler?.round ?? null,
      cycleIntervalMs: mission.scheduler?.cycleIntervalMs ?? null,
      maxCycles: mission.scheduler?.maxCycles ?? null,
      nextRoundAt: mission.scheduler?.nextRoundAt ?? null,
      jobs: mission.scheduler?.jobs?.length || 0,
    },
  }
}

function summarizeEvents(events: MissionLifecycleEvent[]) {
  return {
    count: events.length,
    transitions: events
      .filter((event) => event.previousState || event.nextState)
      .map((event) => `${event.previousState || ''}->${event.nextState || ''}`),
    dryRunEvents: events.filter((event) => event.evidence?.dryRun === true).length,
    assignedEvents: events.filter((event) => event.type === 'agent_assigned').length,
    cancellationRequestedEvents: events.filter((event) => /Mission cancellation requested/i.test(event.message || '')).length,
    missionCancelledEvents: events.filter((event) => event.type === 'mission_cancelled').length,
  }
}

function summarizeReport(report: BackendMissionReport) {
  return {
    id: report.id,
    missionId: report.missionId,
    generatedAt: report.generatedAt,
    source: report.evidence?.source || null,
    acceptedRuns: report.evidence?.acceptedRuns ?? null,
    startedRuns: report.evidence?.startedRuns ?? null,
    cancelledRuns: report.evidence?.cancelledRuns ?? null,
    humanInterventions: report.evidence?.humanInterventions ?? null,
    agentParticipation: report.evidence?.agentParticipation || [],
    heartbeatStabilityScore: report.heartbeatStabilityScore ?? null,
    unavailableMetrics: report.evidence?.unavailableMetrics || [],
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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-mission-cancel-'))
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

  const launchedMission = await launchCancellableMission(port, token)
  const launchEvents = await waitForMissionEvents(port, token, launchedMission.id, startTransitionsReady, 'launch transitions')

  const stopResult = await stopMission(port, token, launchedMission.id)
  const cancellationEvents = await waitForMissionEvents(
    port,
    token,
    launchedMission.id,
    (events) => startTransitionsReady(events) && cancellationEventsReady(events),
    'cancellation transition',
  )
  const lifecycle = await fetchCancelledLifecycle(port, token, launchedMission.id)
  const report = await fetchCancellationReport(port, token, launchedMission.id)
  const { projection, mission: projectedMission } = await fetchCancelledProjection(port, token, launchedMission.id)
  const teamSync = collectTeamSyncSnapshots(tempRoot, launchedMission.id)
  const ledger = await waitForMissionRecordLedger(stateDir, launchedMission.id)

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [121],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-mission-cancellation-dry-run',
    scheduler: {
      dryRunEnv: 'CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN',
      dryRunEnabled: true,
      reason: 'Manual beta cancellation evidence should not require live provider credentials.',
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
    launchedMission: {
      item: 121,
      route: '/api/missions/start',
      mission: summarizeMission(launchedMission),
      events: summarizeEvents(launchEvents),
    },
    cancellation: {
      item: 121,
      route: '/api/missions/stop',
      lifecycleRoute: `/api/missions/${launchedMission.id}/lifecycle`,
      eventsRoute: `/api/missions/${launchedMission.id}/events`,
      reportRoute: `/api/missions/${launchedMission.id}/report`,
      reasonStoredAs: 'phase k manual beta cancellation smoke',
      mission: summarizeMission(stopResult.mission),
      projectedMission: summarizeMission(projectedMission),
      cleanup: stopResult.cleanup,
      events: summarizeEvents(cancellationEvents),
      lifecycleMissionStatus: lifecycle.mission?.status || null,
      lifecycleReportCancelledRuns: lifecycle.report?.evidence?.cancelledRuns ?? null,
      report: summarizeReport(report),
      teamSyncSnapshots: teamSync.map((entry) => ({
        path: path.relative(tempRoot, entry.file),
        bytes: entry.bytes,
        containsCancelled: entry.containsCancelled,
      })),
      missionRecordLedger: {
        path: path.relative(tempRoot, ledger.path),
        bytes: ledger.bytes,
        containsCancellationRequested: ledger.containsCancellationRequested,
        containsRunningToCancelled: ledger.containsRunningToCancelled,
      },
    },
    projection: {
      route: '/api/missions/projection',
      missionCount: projection.projection?.missionCount ?? null,
      activeMissionCount: projection.projection?.activeMissionCount ?? null,
      durableRecordCount: projection.projection?.durableRecordCount ?? null,
      memoryRecordCount: projection.projection?.memoryRecordCount ?? null,
      cancelledMissionProjected: true,
    },
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K mission-cancellation evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=121',
    'blockedItems=none',
    `agentId=${AGENT_ID}`,
    `missionId=${launchedMission.id}`,
    `stopStatus=${stopResult.mission.status}`,
    `cleanupAttempted=${stopResult.cleanup.attempted}`,
    `cleanupFailed=${stopResult.cleanup.failed}`,
    `events=${summarizeEvents(cancellationEvents).transitions.join(',')}`,
    `reportCancelledRuns=${report.evidence?.cancelledRuns ?? 'unknown'}`,
    `projectionActiveMissionCount=${projection.projection?.activeMissionCount ?? 'unknown'}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Mission Cancellation Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta items covered:',
    '',
    '- 121. Complete: launched one running mission and cancelled it through the authenticated mission stop route.',
    '',
    'Evidence:',
    '',
    `- Agent: ${AGENT_ID}`,
    `- Mission: ${launchedMission.id} (${launchedMission.mode}, cancelled, lifecycle ${stopResult.mission.lifecycleState})`,
    `- Cleanup: attempted ${stopResult.cleanup.attempted}, removed ${stopResult.cleanup.removed}, disabled ${stopResult.cleanup.disabled}, failed ${stopResult.cleanup.failed}`,
    `- Lifecycle transitions: ${summarizeEvents(cancellationEvents).transitions.join(', ')}`,
    `- Report cancelled runs: ${report.evidence?.cancelledRuns ?? 'unknown'}`,
    `- Projection active missions after cancellation: ${projection.projection?.activeMissionCount ?? 'unknown'}`,
    '- Scheduler dry-run was enabled to prove launch, cancellation, projection, ledger, report, and Team Sync behavior without provider credentials.',
    '- Evidence stores token length and local isolated paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K mission-cancellation smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

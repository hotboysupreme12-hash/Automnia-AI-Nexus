import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-mission-launch'
const AGENT_ID = 'phase-k-mission-agent'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'mission-launch-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'MISSION_LAUNCH_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '08-mission-launch-smoke.log')
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

type MissionProjectionPayload = {
  missions?: MissionView[]
  events?: MissionLifecycleEvent[]
  feed?: MissionLifecycleEvent[]
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

type MissionEventsPayload = {
  missionId: string
  events: MissionLifecycleEvent[]
}

type MissionLifecyclePayload = MissionProjectionPayload & {
  missionId: string
  mission: MissionView | null
  report?: unknown
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
    requestId: 'phase-k-mission-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

function assertDryRunLaunch(mission: MissionView, expected: {
  idempotencyKey: string
  mode: MissionView['mode']
  amount: number | null
  item: number
}) {
  assert.equal(mission.idempotencyKey, expected.idempotencyKey)
  assert.equal(mission.mode, expected.mode)
  assert.equal(mission.amount, expected.amount)
  assert.equal(mission.status, 'active')
  assert.equal(mission.lifecycleState, 'running')
  assert.deepEqual(mission.party, [AGENT_ID])
  assert.equal(mission.scheduler?.status, 'waiting')
  assert.equal(mission.scheduler?.round, 0)
  assert.equal(mission.scheduler?.cycleIntervalMs, 60_000)
  assert.equal(mission.scheduler?.maxCycles, 1)
  assert.deepEqual(mission.scheduler?.jobs || [], [])
  if (expected.item === 119) {
    assert.equal(mission.endAt, null)
    assert.equal(mission.progress, 100)
  } else {
    assert.ok(mission.endAt, 'timed mission should have an endAt timestamp')
    assert.ok(Date.parse(mission.endAt || '') > Date.now() + 50 * 60 * 1000, 'timed mission endAt should be about one hour out')
    assert.equal(typeof mission.progress, 'number')
  }
}

async function launchMission(
  port: number,
  token: string,
  params: {
    requestId: string
    idempotencyKey: string
    title: string
    brief: string
    mode: MissionView['mode']
    amount?: number | null
    item: number
  },
) {
  const data = await api<MissionStartPayload>(port, '/api/missions/start', {
    method: 'POST',
    token,
    requestId: params.requestId,
    body: {
      idempotencyKey: params.idempotencyKey,
      title: params.title,
      brief: params.brief,
      party: [AGENT_ID],
      mode: params.mode,
      amount: params.amount ?? null,
      missionType: 'manual-beta-smoke',
      collaborationMode: 'solo',
      complexity: 12,
      riskTolerance: 8,
      cadenceSeconds: 60,
      maxCycles: 1,
    },
  })
  assert.equal(data.deduped, false)
  assert.equal(data.idempotencyKey, params.idempotencyKey)
  assertDryRunLaunch(data.mission, {
    idempotencyKey: params.idempotencyKey,
    mode: params.mode,
    amount: params.mode === 'instant' ? null : params.amount || 1,
    item: params.item,
  })
  return data.mission
}

function expectedTransitions(events: MissionLifecycleEvent[]) {
  const pairs = new Set(events.map((event) => `${event.previousState || ''}->${event.nextState || ''}`))
  return {
    accepted: pairs.has('draft->validating'),
    scheduled: pairs.has('validating->scheduled'),
    running: pairs.has('scheduled->running'),
    dryRun: events.some((event) => event.type === 'agent_update' && event.evidence?.dryRun === true),
    assigned: events.some((event) => event.type === 'agent_assigned' && event.missionId),
  }
}

async function waitForMissionEvents(port: number, token: string, missionId: string) {
  const deadline = Date.now() + 8_000
  let lastPayload: MissionEventsPayload | null = null
  while (Date.now() < deadline) {
    lastPayload = await api<MissionEventsPayload>(port, `/api/missions/${encodeURIComponent(missionId)}/events`, {
      token,
      requestId: `phase-k-events-${missionId.slice(0, 8)}-${Math.random().toString(36).slice(2, 7)}`,
    })
    const transitions = expectedTransitions(lastPayload.events)
    if (transitions.accepted && transitions.scheduled && transitions.running && transitions.dryRun && transitions.assigned) {
      return lastPayload.events
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission lifecycle events did not flush for ${missionId}: ${JSON.stringify(lastPayload?.events || [])}`)
}

async function fetchMissionLifecycle(port: number, token: string, missionId: string) {
  const lifecycle = await api<MissionLifecyclePayload>(port, `/api/missions/${encodeURIComponent(missionId)}/lifecycle`, {
    token,
    requestId: `phase-k-lifecycle-${missionId.slice(0, 8)}`,
  })
  assert.equal(lifecycle.missionId, missionId)
  assert.equal(lifecycle.mission?.id, missionId)
  assert.ok((lifecycle.events || []).length >= 4)
  return lifecycle
}

async function fetchProjectionWithMissions(port: number, token: string, missionIds: string[]) {
  const deadline = Date.now() + 8_000
  let lastProjection: MissionProjectionPayload | null = null
  while (Date.now() < deadline) {
    lastProjection = await api<MissionProjectionPayload>(port, '/api/missions/projection', {
      token,
      requestId: `phase-k-mission-projection-${Math.random().toString(36).slice(2, 7)}`,
    })
    const projectedIds = new Set((lastProjection.missions || []).map((mission) => mission.id))
    if (missionIds.every((missionId) => projectedIds.has(missionId))) return lastProjection
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Mission projection did not include launched missions: ${JSON.stringify(lastProjection?.projection || {})}`)
}

function collectTeamSyncSnapshots(searchRoot: string, missionId: string) {
  const matches: Array<{ file: string; bytes: number }> = []
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
        if (raw.includes(missionId)) matches.push({ file: entryPath, bytes: Buffer.byteLength(raw, 'utf8') })
      }
    }
  }
  assert.ok(matches.length > 0, `TEAM_SYNC.md should contain mission ${missionId}`)
  assert.equal(matches.every((match) => isPathInsideOrSame(searchRoot, match.file)), true)
  return matches
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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-mission-launch-'))
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

  const instantMission = await launchMission(port, token, {
    requestId: 'phase-k-instant-mission-launch',
    idempotencyKey: 'phase-k-instant-mission-119',
    title: 'Phase K Instant Mission Smoke',
    brief: 'Launch one instant mission in isolated beta state and verify backend lifecycle projection.',
    mode: 'instant',
    item: 119,
  })
  const instantEvents = await waitForMissionEvents(port, token, instantMission.id)
  const instantLifecycle = await fetchMissionLifecycle(port, token, instantMission.id)
  const instantTeamSync = collectTeamSyncSnapshots(tempRoot, instantMission.id)

  const timedMission = await launchMission(port, token, {
    requestId: 'phase-k-timed-mission-launch',
    idempotencyKey: 'phase-k-timed-mission-120',
    title: 'Phase K Timed Mission Smoke',
    brief: 'Launch one timed mission in isolated beta state and verify the duration-backed scheduler projection.',
    mode: 'hours',
    amount: 1,
    item: 120,
  })
  const timedEvents = await waitForMissionEvents(port, token, timedMission.id)
  const timedLifecycle = await fetchMissionLifecycle(port, token, timedMission.id)
  const timedTeamSync = collectTeamSyncSnapshots(tempRoot, timedMission.id)
  const projection = await fetchProjectionWithMissions(port, token, [instantMission.id, timedMission.id])

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [119, 120],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-mission-dry-run',
    scheduler: {
      dryRunEnv: 'CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN',
      dryRunEnabled: true,
      reason: 'Manual beta launch evidence should not require live provider credentials.',
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
    instantMission: {
      item: 119,
      route: '/api/missions/start',
      lifecycleRoute: `/api/missions/${instantMission.id}/lifecycle`,
      eventsRoute: `/api/missions/${instantMission.id}/events`,
      mission: summarizeMission(instantMission),
      lifecycleMissionStatus: instantLifecycle.mission?.status || null,
      events: summarizeEvents(instantEvents),
      teamSyncSnapshots: instantTeamSync.map((entry) => ({
        path: path.relative(tempRoot, entry.file),
        bytes: entry.bytes,
      })),
    },
    timedMission: {
      item: 120,
      route: '/api/missions/start',
      lifecycleRoute: `/api/missions/${timedMission.id}/lifecycle`,
      eventsRoute: `/api/missions/${timedMission.id}/events`,
      mission: summarizeMission(timedMission),
      lifecycleMissionStatus: timedLifecycle.mission?.status || null,
      events: summarizeEvents(timedEvents),
      teamSyncSnapshots: timedTeamSync.map((entry) => ({
        path: path.relative(tempRoot, entry.file),
        bytes: entry.bytes,
      })),
    },
    projection: {
      route: '/api/missions/projection',
      missionCount: projection.projection?.missionCount ?? null,
      activeMissionCount: projection.projection?.activeMissionCount ?? null,
      durableRecordCount: projection.projection?.durableRecordCount ?? null,
      memoryRecordCount: projection.projection?.memoryRecordCount ?? null,
      launchedMissionIdsProjected: [instantMission.id, timedMission.id].every((missionId) =>
        (projection.missions || []).some((mission) => mission.id === missionId),
      ),
    },
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K mission-launch evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=119,120',
    'blockedItems=none',
    `agentId=${AGENT_ID}`,
    `instantMissionId=${instantMission.id}`,
    `instantEvents=${summarizeEvents(instantEvents).transitions.join(',')}`,
    `timedMissionId=${timedMission.id}`,
    `timedEvents=${summarizeEvents(timedEvents).transitions.join(',')}`,
    `projectionMissionCount=${projection.projection?.missionCount ?? 'unknown'}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Mission Launch Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta items covered:',
    '',
    '- 119. Complete: launched one instant mission through the authenticated mission start route.',
    '- 120. Complete: launched one timed mission through the authenticated mission start route.',
    '',
    'Evidence:',
    '',
    `- Agent: ${AGENT_ID}`,
    `- Instant mission: ${instantMission.id} (${instantMission.mode}, ${instantMission.status}, lifecycle ${instantMission.lifecycleState})`,
    `- Timed mission: ${timedMission.id} (${timedMission.mode}, ${timedMission.status}, lifecycle ${timedMission.lifecycleState}, ends ${timedMission.endAt})`,
    `- Instant lifecycle transitions: ${summarizeEvents(instantEvents).transitions.join(', ')}`,
    `- Timed lifecycle transitions: ${summarizeEvents(timedEvents).transitions.join(', ')}`,
    '- Scheduler dry-run was enabled to prove launch, projection, ledger, and Team Sync behavior without provider credentials.',
    '- Evidence stores token length and local isolated paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K mission-launch smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

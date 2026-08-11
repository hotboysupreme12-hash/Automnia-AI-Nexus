import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

import {
  CONTROL_CENTER_STATE_KEYS,
  createRuntimeLedgerStore,
  runtimeLedgerPathsForStateRoot,
} from '../server/state/runtimeLedgerStore'

const root = process.cwd()
const CONTROL_TOKEN = 'recovery-soak-control-token'

type Envelope<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not allocate recovery-soak port'))
      })
    })
  })
}

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const configPath = path.join(stateDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n')
  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONTROL_CENTER_PORT: String(port),
      CONTROL_CENTER_TOKEN: CONTROL_TOKEN,
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
    if (child.exitCode !== null) throw new Error(`Recovery server exited ${child.exitCode}\n${output.slice(-3000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
      if (response.ok) return
    } catch {
      // Startup probe retries until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Recovery server did not become ready\n${output.slice(-3000)}`)
}

async function api<T>(port: number, apiPath: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method: options.method || 'GET',
    headers: {
      'X-Request-Id': `recovery-${Math.random().toString(36).slice(2)}`,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json() as Envelope<T>
  if (!response.ok || !payload.ok) {
    const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
    throw new Error(`${apiPath} failed: ${message}`)
  }
  return payload.data
}

async function login(port: number) {
  const data = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
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

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-recovery-soak-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace')
const homeDir = path.join(tempRoot, 'home')
mkdirSync(stateDir, { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
const runtimeLedgerStore = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(stateDir))
try {
  const seededAt = '2026-08-11T12:00:00.000Z'
  assert.equal(runtimeLedgerStore.writeControlCenterState(CONTROL_CENTER_STATE_KEYS.licenseActivation, {
    active: true,
    email: 'recovery-soak@example.test',
    licenseKey: 'AUT-RECOVERY-SOAK-0001',
    tier: 'founding_beta_byok',
    mode: 'byok',
    usagePriority: 'provider_first',
    creditBalance: 0,
    creditBalanceUpdatedAt: null,
    activatedAt: seededAt,
    verifiedAt: seededAt,
  }), true, 'recovery soak fixture must persist an active license before the server starts')
} finally {
  runtimeLedgerStore.close()
}
let child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  await waitForReady(child, port)
  let token = await login(port)
  const launch = await api<{ mission: { id: string } }>(port, '/api/missions/start', {
    method: 'POST',
    token,
    body: {
      idempotencyKey: 'recovery-soak-mission-v1',
      title: 'Recovery soak mission',
      brief: 'Persist a controlled dry-run mission across a forced control-plane restart.',
      party: ['agent-a'],
      mode: 'continuous',
      missionType: 'planning',
      collaborationMode: 'parallel',
      complexity: 10,
      riskTolerance: 10,
      cadenceSeconds: 60,
    },
  })
  const missionId = launch.mission.id

  for (let cycle = 0; cycle < 25; cycle += 1) {
    const [health, projection] = await Promise.all([
      api<{ status: string }>(port, '/api/health'),
      api<{ missions: Array<{ id: string }> }>(port, '/api/missions/projection', { token }),
    ])
    assert.ok(health)
    assert.ok(projection.missions.some((mission) => mission.id === missionId))
  }

  await stopProcess(child)
  child = spawnServer(port, stateDir, workspaceRoot, homeDir)
  await waitForReady(child, port)
  token = await login(port)
  const recovered = await api<{ missions: Array<{ id: string }> }>(port, '/api/missions/projection', { token })
  assert.ok(recovered.missions.some((mission) => mission.id === missionId), 'durable mission must survive control-plane restart')
  await api(port, '/api/missions/stop', { method: 'POST', token, body: { missionId, reason: 'recovery soak cleanup' } })

  console.log('runtime recovery soak ok (25 live cycles plus durable restart)')
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

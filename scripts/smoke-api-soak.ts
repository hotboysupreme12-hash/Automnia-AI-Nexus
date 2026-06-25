import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'release-soak-control-token'
const REQUEST_COUNT = Math.max(100, Math.min(2_000, Number(process.env.DYSTOPAI_SOAK_REQUEST_COUNT || 400)))
const CONCURRENCY = Math.max(1, Math.min(25, Number(process.env.DYSTOPAI_SOAK_CONCURRENCY || 8)))
const P95_LIMIT_MS = Math.max(250, Number(process.env.DYSTOPAI_SOAK_P95_LIMIT_MS || 2_500))

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

function spawnServer(port: number, workspaceRoot: string, stateDir: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, 'openclaw.json'), '{}\n', 'utf8')
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
      OPENCLAW_CONFIG_PATH: path.join(stateDir, 'openclaw.json'),
      OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function waitForServer(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Soak server exited ${child.exitCode}.\n${output.slice(-4_000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Retry while startup work completes.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Soak server did not become ready.\n${output.slice(-4_000)}`)
}

async function login(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': `soak-login-${Date.now()}` },
    body: JSON.stringify({ token: CONTROL_TOKEN }),
    signal: AbortSignal.timeout(5_000),
  })
  const body = await response.json() as { ok?: boolean; data?: { token?: string } }
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.ok(body.data?.token)
  return body.data.token
}

async function terminate(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 4_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

const port = await freePort()
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-soak-workspace-'))
const stateDir = mkdtempSync(path.join(tmpdir(), 'dystopai-soak-state-'))
const homeDir = mkdtempSync(path.join(tmpdir(), 'dystopai-soak-home-'))
const child = spawnServer(port, workspaceRoot, stateDir, homeDir)

try {
  await waitForServer(child, port)
  const sessionToken = await login(port)
  const durations: number[] = []
  const failures: string[] = []
  let cursor = 0

  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= REQUEST_COUNT) return
      const route = index % 5 === 0 ? '/api/health' : '/api/missions/projection'
      const started = performance.now()
      try {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          headers: route === '/api/health'
            ? { 'X-Request-Id': `soak-${index}` }
            : { Authorization: `Bearer ${sessionToken}`, 'X-Request-Id': `soak-${index}` },
          signal: AbortSignal.timeout(8_000),
        })
        const body = await response.json() as { ok?: boolean; requestId?: string }
        if (!response.ok || body.ok !== true || body.requestId !== `soak-${index}`) {
          failures.push(`${route} returned HTTP ${response.status}`)
        }
      } catch (error) {
        failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        durations.push(performance.now() - started)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  const ordered = durations.sort((a, b) => a - b)
  const percentile = (value: number) => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * value) - 1))] || 0
  const summary = {
    requests: REQUEST_COUNT,
    concurrency: CONCURRENCY,
    failures: failures.length,
    p50Ms: Number(percentile(0.5).toFixed(1)),
    p95Ms: Number(percentile(0.95).toFixed(1)),
    maxMs: Number((ordered.at(-1) || 0).toFixed(1)),
  }
  console.log(JSON.stringify(summary, null, 2))
  assert.equal(failures.length, 0, failures.slice(0, 10).join('\n'))
  assert.ok(summary.p95Ms <= P95_LIMIT_MS, `API soak p95 ${summary.p95Ms}ms exceeded ${P95_LIMIT_MS}ms`)
} finally {
  await terminate(child)
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(homeDir, { recursive: true, force: true })
}

console.log('api soak qualification ok')

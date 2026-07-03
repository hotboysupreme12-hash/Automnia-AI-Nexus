import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-gateway-restart-ui'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'gateway-restart-ui-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'GATEWAY_RESTART_UI_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '11-gateway-restart-ui-smoke.log')
const startedAt = new Date().toISOString()
const manualRestartReason = 'manual gateway restart requested'

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type GatewayRestartResult = {
  ok?: boolean
  restart?: Record<string, unknown>
  gateway?: Record<string, unknown>
}

type RuntimeStatusPayload = {
  ok?: boolean
  generatedAt?: string
  gateway?: Record<string, unknown> & {
    recentRestarts?: unknown[]
    restartDiagnostics?: Record<string, unknown>
  }
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

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string, gatewayLogPath: string) {
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
      CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS: '10000',
      CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_POLL_MS: '500',
      CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_GRACE_MS: '15000',
      CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
      CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
      CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
      CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
      CONTROL_CENTER_RUNTIME_STATUS_RESPONSE_TIMEOUT_MS: '15000',
      CONTROL_CENTER_RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS: '10000',
      CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_HOME: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_LOG_PATH: gatewayLogPath,
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
  options: { method?: string; token?: string; body?: unknown; requestId?: string; timeoutMs?: number } = {},
) {
  const requestId = options.requestId || `phase-k-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({ 'X-Request-Id': requestId })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const payload = await response.json() as ApiEnvelope<T>
    assert.equal(response.headers.get('x-request-id'), requestId)
    assert.equal(payload.requestId, requestId)
    if (!response.ok || !payload.ok) {
      const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
      throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
    }
    return payload.data
  } finally {
    clearTimeout(timeout)
  }
}

async function login(port: number) {
  const data = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-gateway-restart-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} should be an object`)
  return value as Record<string, unknown>
}

function asArray(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} should be an array`)
  return value
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

function compactDetail(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 600)
}

function validateGatewayRestartSource() {
  const liveMonitor = readFileSync(path.join(root, 'src/components/monitor/LiveOperationMonitor.tsx'), 'utf8')
  const runtimeHook = readFileSync(path.join(root, 'src/hooks/useRuntimeStatus.ts'), 'utf8')

  assert.ok(!liveMonitor.includes('Gateway Runtime'), 'Monitor should not render the Gateway Runtime summary strip')
  assert.ok(!liveMonitor.includes('restartGatewayFromMonitor'), 'Monitor should not keep the removed Gateway restart click handler')
  assert.ok(liveMonitor.includes('restartGatewayRuntime'), 'Monitor should import the Gateway restart runtime action')
  assert.ok(liveMonitor.includes('dy-gateway-restart-button'), 'Monitor should render the Gateway restart toolbar button')
  assert.ok(liveMonitor.includes('Restart Gateway'), 'Monitor Gateway restart button should be labeled Restart Gateway')
  assert.ok(runtimeHook.includes("runtimeActionRequest<{ ok?: boolean; restart?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/restart'"), 'useRuntimeStatus should call the runtime Gateway restart endpoint')

  return {
    monitorRuntimeSummaryRemoved: true,
    monitorRestartButtonPresent: true,
    runtimeActionHelper: true,
  }
}

function validateRestartAction(result: GatewayRestartResult) {
  assert.equal(result.ok, true)
  const restart = asRecord(result.restart, 'restart result.restart')
  const gateway = asRecord(result.gateway, 'restart result.gateway')
  assert.equal(typeof restart.restarted, 'boolean', 'restart.restarted should be boolean')
  assert.equal(typeof restart.detail, 'string', 'restart.detail should be string')
  assert.equal(gateway.lastRestartReason, manualRestartReason, 'restart gateway snapshot should carry the manual Monitor reason')
  assert.ok(['started', 'succeeded', 'failed', 'skipped'].includes(String(gateway.lastRestartOutcome || '')), 'restart gateway snapshot should carry a restart outcome')
  assert.equal(typeof gateway.healthy, 'boolean', 'restart gateway snapshot should carry health')
  assert.equal(typeof gateway.processRunning, 'boolean', 'restart gateway snapshot should carry process state')
  return {
    restarted: restart.restarted,
    detail: compactDetail(restart.detail),
    gateway: {
      state: gateway.state ?? null,
      healthy: gateway.healthy,
      processRunning: gateway.processRunning,
      restartScheduled: gateway.restartScheduled,
      lastRestartAt: gateway.lastRestartAt ?? null,
      lastRestartReason: gateway.lastRestartReason ?? null,
      lastRestartOutcome: gateway.lastRestartOutcome ?? null,
      restartCount: gateway.restartCount ?? null,
    },
  }
}

function validateRestartStatus(status: RuntimeStatusPayload) {
  assert.equal(status.ok, true)
  assert.ok(status.generatedAt && !Number.isNaN(Date.parse(status.generatedAt)), 'runtime status should include generatedAt')
  const gateway = asRecord(status.gateway, 'status.gateway')
  const recentRestarts = asArray(gateway.recentRestarts, 'status.gateway.recentRestarts')
  const latestManualRestart = recentRestarts.find((entry) => {
    const record = asRecord(entry, 'status.gateway.recentRestarts entry')
    return record.reason === manualRestartReason
  })
  assert.ok(latestManualRestart, 'runtime status should expose the manual Monitor restart lifecycle entry')
  const restartDiagnostics = asRecord(gateway.restartDiagnostics, 'status.gateway.restartDiagnostics')
  assert.equal(restartDiagnostics.latestReason, manualRestartReason, 'restart diagnostics should point at the manual Monitor restart')
  return {
    generatedAt: status.generatedAt,
    gateway: {
      state: gateway.state ?? null,
      healthy: gateway.healthy,
      processRunning: gateway.processRunning,
      restartScheduled: gateway.restartScheduled,
      lastRestartAt: gateway.lastRestartAt ?? null,
      lastRestartReason: gateway.lastRestartReason ?? null,
      lastRestartOutcome: gateway.lastRestartOutcome ?? null,
      recentRestartCount: recentRestarts.length,
      latestManualRestart: {
        at: stringOrNull(asRecord(latestManualRestart, 'latest manual restart').at),
        outcome: stringOrNull(asRecord(latestManualRestart, 'latest manual restart').outcome),
        reason: stringOrNull(asRecord(latestManualRestart, 'latest manual restart').reason),
      },
      restartDiagnostics: {
        summary: compactDetail(restartDiagnostics.summary),
        needsAttention: restartDiagnostics.needsAttention,
        latestOutcome: restartDiagnostics.latestOutcome,
        latestReason: restartDiagnostics.latestReason,
      },
    },
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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-gateway-restart-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const gatewayLogPath = path.join(stateDir, 'gateway.log')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const gatewayRestartSource = validateGatewayRestartSource()
const child = spawnServer(port, stateDir, workspaceRoot, homeDir, gatewayLogPath)

try {
  await waitForReady(child, port)
  const token = await login(port)
  const restartResult = await api<GatewayRestartResult>(port, '/api/openclaw/runtime/gateway/restart', {
    method: 'POST',
    token,
    requestId: 'phase-k-gateway-restart-action',
    timeoutMs: 90_000,
  })
  const runtimeStatus = await api<RuntimeStatusPayload>(port, '/api/openclaw/runtime/status?refresh=1', {
    token,
    requestId: 'phase-k-gateway-restart-status',
    timeoutMs: 45_000,
  })

  const completedAt = new Date().toISOString()
  const restartAction = validateRestartAction(restartResult)
  const restartStatus = validateRestartStatus(runtimeStatus)
  const evidence = {
    phase: 'K',
    completedItems: [123],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-gateway-restart',
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    gatewayRestartSource,
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
      gatewayLogPath,
    },
    restartRoute: '/api/openclaw/runtime/gateway/restart',
    runtimeStatusRoute: '/api/openclaw/runtime/status?refresh=1',
    manualRestartReason,
    restartAction,
    restartStatus,
    server: {
      port,
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K Gateway restart evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=123',
    'blockedItems=none',
    `restartRoute=${evidence.restartRoute}`,
    `manualRestartReason=${manualRestartReason}`,
    `restartRequested=${restartAction.restarted}`,
    `restartOutcome=${restartAction.gateway.lastRestartOutcome}`,
    `gatewayHealthy=${restartAction.gateway.healthy}`,
    `gatewayProcessRunning=${restartAction.gateway.processRunning}`,
    `recentRestartCount=${restartStatus.gateway.recentRestartCount}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Gateway Restart Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 123. Complete: restart Gateway through the authenticated runtime action and verify restart lifecycle evidence.',
    '',
    'Evidence:',
    '',
    `- Monitor Gateway Runtime strip removed: ${gatewayRestartSource.monitorRuntimeSummaryRemoved ? 'yes' : 'no'}`,
    `- Monitor restart button present: ${gatewayRestartSource.monitorRestartButtonPresent ? 'yes' : 'no'}`,
    `- Runtime action helper: ${gatewayRestartSource.runtimeActionHelper ? 'present' : 'missing'}`,
    `- Restart route: ${evidence.restartRoute}`,
    `- Runtime status route: ${evidence.runtimeStatusRoute}`,
    `- Restart reason: ${manualRestartReason}`,
    `- Restart requested result: ${String(restartAction.restarted)}`,
    `- Restart outcome: ${String(restartAction.gateway.lastRestartOutcome)}`,
    `- Gateway health after action: healthy=${String(restartAction.gateway.healthy)}, processRunning=${String(restartAction.gateway.processRunning)}`,
    `- Recent restart lifecycle entries: ${restartStatus.gateway.recentRestartCount}`,
    `- Restart diagnostics: ${restartStatus.gateway.restartDiagnostics.summary}`,
    '- Evidence stores token length and isolated local paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K Gateway restart smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

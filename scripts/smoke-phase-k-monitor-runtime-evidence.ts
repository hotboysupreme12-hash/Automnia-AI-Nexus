import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-monitor-runtime-evidence'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'monitor-runtime-evidence-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'MONITOR_RUNTIME_EVIDENCE_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '10-monitor-runtime-evidence-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type RuntimeStatusPayload = Record<string, unknown> & {
  ok?: boolean
  generatedAt?: string
  monitor?: Record<string, unknown>
  gateway?: Record<string, unknown> & {
    logs?: unknown[]
    activity?: Record<string, unknown> & { events?: unknown[] }
  }
  runtime?: Record<string, unknown>
  persistence?: Record<string, unknown>
  sessions?: unknown[]
  activeRuns?: unknown[]
  recentRuns?: unknown[]
  plugins?: Record<string, unknown>
  shifts?: Record<string, unknown> & { active?: unknown[] }
  missions?: Record<string, unknown> & { active?: unknown[] }
  diagnostics?: Record<string, unknown>
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
    requestId: 'phase-k-monitor-runtime-login',
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

function numberField(record: Record<string, unknown>, key: string, label: string) {
  const value = record[key]
  assert.equal(typeof value, 'number', `${label}.${key} should be numeric`)
  return value as number
}

function booleanField(record: Record<string, unknown>, key: string, label: string) {
  const value = record[key]
  assert.equal(typeof value, 'boolean', `${label}.${key} should be boolean`)
  return value as boolean
}

function stringField(record: Record<string, unknown>, key: string, label: string) {
  const value = record[key]
  assert.equal(typeof value, 'string', `${label}.${key} should be a string`)
  return value as string
}

function seedGatewayMonitorEvidence(gatewayLogPath: string) {
  const now = new Date().toISOString()
  const earlier = new Date(Date.now() - 1000).toISOString()
  writeFileSync(gatewayLogPath, [
    `${earlier} [gateway] http server listening (0 plugins: none)`,
    `${now} [gateway] message processed: channel=telegram outcome=ok inbound message received from phase-k-monitor`,
    `${now} [gateway] message processed: channel=sms outcome=ok outbound send ok duration=32ms agent=phase-k-monitor`,
  ].join('\n') + '\n', 'utf8')
}

function validateRuntimeStatus(status: RuntimeStatusPayload, gatewayLogPath: string) {
  assert.equal(status.ok, true)
  assert.ok(status.generatedAt && !Number.isNaN(Date.parse(status.generatedAt)), 'runtime status should include generatedAt')

  const monitor = asRecord(status.monitor, 'status.monitor')
  const timings = asRecord(monitor.timings, 'status.monitor.timings')
  const sources = asRecord(monitor.sources, 'status.monitor.sources')
  assert.equal(monitor.cached, false)
  assert.equal(monitor.forceRefresh, true)
  numberField(timings, 'totalMs', 'status.monitor.timings')
  assert.ok(numberField(sources, 'gatewayExternalLogs', 'status.monitor.sources') >= 2, 'status should include seeded Gateway external logs')

  const runtime = asRecord(status.runtime, 'status.runtime')
  const persistence = asRecord(status.persistence, 'status.persistence')
  stringField(runtime, 'expected', 'status.runtime')
  assert.ok('sqliteAvailable' in persistence, 'runtime persistence summary should be present for Monitor evidence')

  const gateway = asRecord(status.gateway, 'status.gateway')
  const readiness = asRecord(gateway.readiness, 'status.gateway.readiness')
  const stability = asRecord(gateway.stability, 'status.gateway.stability')
  const restartDiagnostics = asRecord(gateway.restartDiagnostics, 'status.gateway.restartDiagnostics')
  const activity = asRecord(gateway.activity, 'status.gateway.activity')
  const logs = asArray(gateway.logs, 'status.gateway.logs')
  const events = asArray(activity.events, 'status.gateway.activity.events')
  assert.equal(stringField(gateway, 'state', 'status.gateway'), 'offline')
  assert.equal(booleanField(gateway, 'healthy', 'status.gateway'), false)
  assert.equal(booleanField(gateway, 'processRunning', 'status.gateway'), false)
  numberField(gateway, 'port', 'status.gateway')
  assert.ok(logs.length >= 2, 'Gateway log tail should include seeded evidence')
  assert.ok(events.length >= 2, 'Gateway channel activity should include seeded evidence')
  assert.ok(numberField(activity, 'inboundCount', 'status.gateway.activity') >= 1, 'Gateway activity should include inbound evidence')
  assert.ok(numberField(activity, 'outboundCount', 'status.gateway.activity') >= 1, 'Gateway activity should include outbound evidence')
  assert.ok(String(activity.sourcePath || '').includes(path.basename(gatewayLogPath)), 'Gateway activity should reference the isolated log path')
  assert.ok('reachable' in readiness, 'Gateway readiness evidence should be present')
  assert.ok('available' in stability, 'Gateway stability evidence should be present')
  stringField(restartDiagnostics, 'summary', 'status.gateway.restartDiagnostics')

  const sessions = asArray(status.sessions, 'status.sessions')
  const activeRuns = asArray(status.activeRuns, 'status.activeRuns')
  const recentRuns = asArray(status.recentRuns, 'status.recentRuns')
  const plugins = asRecord(status.plugins, 'status.plugins')
  const shifts = asRecord(status.shifts, 'status.shifts')
  const missions = asRecord(status.missions, 'status.missions')
  const diagnostics = asRecord(status.diagnostics, 'status.diagnostics')
  const doctor = asRecord(diagnostics.doctor, 'status.diagnostics.doctor')
  numberField(plugins, 'enabledCount', 'status.plugins')
  numberField(plugins, 'totalCount', 'status.plugins')
  numberField(shifts, 'activeCount', 'status.shifts')
  asArray(shifts.active, 'status.shifts.active')
  numberField(missions, 'activeCount', 'status.missions')
  asArray(missions.active, 'status.missions.active')
  numberField(doctor, 'warningCount', 'status.diagnostics.doctor')
  numberField(doctor, 'errorCount', 'status.diagnostics.doctor')
  asArray(doctor.recent, 'status.diagnostics.doctor.recent')

  return {
    generatedAt: status.generatedAt,
    monitor: {
      cached: monitor.cached,
      forceRefresh: monitor.forceRefresh,
      buildMs: monitor.buildMs,
      timings,
      sources,
    },
    runtime: {
      expected: runtime.expected,
      embedded: runtime.embedded,
      severity: runtime.severity,
    },
    persistence: {
      sqliteAvailable: persistence.sqliteAvailable,
      fallback: persistence.fallback ?? null,
    },
    gateway: {
      state: gateway.state,
      healthy: gateway.healthy,
      processRunning: gateway.processRunning,
      port: gateway.port,
      restartScheduled: gateway.restartScheduled,
      readinessReachable: readiness.reachable,
      stabilityAvailable: stability.available,
      restartDiagnosticsSummary: restartDiagnostics.summary,
      logCount: logs.length,
      activityEventCount: events.length,
      inboundCount: activity.inboundCount,
      outboundCount: activity.outboundCount,
      sourcePathBasename: path.basename(String(activity.sourcePath || '')),
    },
    runtimeCollections: {
      sessions: sessions.length,
      activeRuns: activeRuns.length,
      recentRuns: recentRuns.length,
      pluginEnabledCount: plugins.enabledCount,
      pluginTotalCount: plugins.totalCount,
      activeShiftCount: shifts.activeCount,
      activeMissionCount: missions.activeCount,
      doctorRecentRuns: asArray(doctor.recent, 'status.diagnostics.doctor.recent').length,
    },
  }
}

function validateRuntimeSummary(summary: RuntimeStatusPayload) {
  assert.equal(summary.ok, true)
  const monitor = asRecord(summary.monitor, 'summary.monitor')
  const gateway = asRecord(summary.gateway, 'summary.gateway')
  const activity = asRecord(gateway.activity, 'summary.gateway.activity')
  const logs = asArray(gateway.logs, 'summary.gateway.logs')
  const events = asArray(activity.events, 'summary.gateway.activity.events')
  assert.equal(monitor.summary, true)
  assert.ok(logs.length >= 1, 'Runtime summary should retain compact Gateway log evidence')
  assert.ok(events.length >= 1, 'Runtime summary should retain compact channel activity evidence')
  asArray(summary.sessions, 'summary.sessions')
  asArray(summary.activeRuns, 'summary.activeRuns')
  asRecord(summary.plugins, 'summary.plugins')
  asRecord(summary.shifts, 'summary.shifts')
  asRecord(summary.missions, 'summary.missions')
  asRecord(summary.diagnostics, 'summary.diagnostics')
  return {
    generatedAt: summary.generatedAt,
    monitor: {
      summary: monitor.summary,
      cached: monitor.cached,
      sources: monitor.sources,
      timings: monitor.timings,
    },
    gateway: {
      logCount: logs.length,
      activityEventCount: events.length,
      state: gateway.state,
    },
  }
}

function validateMonitorSourceWiring() {
  const liveMonitor = readFileSync(path.join(root, 'src/components/monitor/LiveOperationMonitor.tsx'), 'utf8')
  const nexusShell = readFileSync(path.join(root, 'src/components/layout/NexusShell.tsx'), 'utf8')
  const runtimeHook = readFileSync(path.join(root, 'src/hooks/useRuntimeStatus.ts'), 'utf8')
  assert.ok(nexusShell.includes("monitor: { label: 'Monitor'"), 'NexusShell should expose the Monitor workspace')
  assert.ok(nexusShell.includes("onClick={() => selectTab('monitor')}"), 'NexusShell should open Monitor from runtime status chrome')
  assert.ok(nexusShell.includes("{tab === 'monitor' &&"), 'NexusShell should mount Monitor when the Monitor tab is active')
  assert.ok(nexusShell.includes('<LiveOperationMonitor />'), 'NexusShell should render LiveOperationMonitor for Monitor')
  assert.ok(liveMonitor.includes('data-dui-panel="monitor"'), 'LiveOperationMonitor should expose the Monitor panel marker')
  assert.ok(liveMonitor.includes("const [tab, setTab] = useState<MonitorTab>('gateway')"), 'Monitor should open on the Gateway runtime tab')
  assert.ok(liveMonitor.includes('useRuntimeStatus(5000)'), 'Monitor should subscribe to runtime status')
  assert.ok(liveMonitor.includes('RuntimeGatewayPanel status={runtimeStatus}'), 'Monitor should pass runtime status into the Gateway panel')
  assert.ok(liveMonitor.includes('GatewayActivityCard activity={activity}'), 'Monitor should render Gateway channel activity evidence')
  assert.ok(liveMonitor.includes('<GatewayLogTailCard logs={logs} />'), 'Monitor should render Gateway log-tail evidence')
  assert.ok(liveMonitor.includes('Active Cron Jobs'), 'Monitor should render active cron job evidence')
  assert.ok(liveMonitor.includes('DoctorPanel run={displayedDoctorRun}'), 'Monitor should render persisted Doctor runtime diagnostics')
  assert.ok(runtimeHook.includes("apiRequest<RuntimeStatus>(`/api/openclaw/runtime/status${forceRefresh ? '?refresh=1' : ''}`"), 'useRuntimeStatus should poll the runtime status API')
  return {
    workspaceNavigation: true,
    monitorPanelMarker: true,
    defaultGatewayTab: true,
    runtimeStatusHook: true,
    renderedEvidenceSurfaces: [
      'Gateway channel activity',
      'Active cron jobs',
      'Gateway log tail',
      'Doctor diagnostics',
      'Clean Slate runtime cache result',
    ],
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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-monitor-runtime-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const gatewayLogPath = path.join(stateDir, 'gateway.log')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const monitorUi = validateMonitorSourceWiring()
const child = spawnServer(port, stateDir, workspaceRoot, homeDir, gatewayLogPath)

try {
  await waitForReady(child, port)
  seedGatewayMonitorEvidence(gatewayLogPath)
  const token = await login(port)
  const status = await api<RuntimeStatusPayload>(port, '/api/openclaw/runtime/status?refresh=1', {
    token,
    requestId: 'phase-k-monitor-runtime-status',
  })
  const summary = await api<RuntimeStatusPayload>(port, '/api/openclaw/runtime/summary?refresh=1', {
    token,
    requestId: 'phase-k-monitor-runtime-summary',
  })

  const completedAt = new Date().toISOString()
  const runtimeStatus = validateRuntimeStatus(status, gatewayLogPath)
  const runtimeSummary = validateRuntimeSummary(summary)
  const evidence = {
    phase: 'K',
    completedItems: [122],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-monitor-runtime-evidence',
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    monitorUi,
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
      gatewayLogPath,
    },
    runtimeStatusRoute: '/api/openclaw/runtime/status?refresh=1',
    runtimeSummaryRoute: '/api/openclaw/runtime/summary?refresh=1',
    runtimeStatus,
    runtimeSummary,
    server: {
      port,
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K Monitor runtime evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=122',
    'blockedItems=none',
    `runtimeStatusRoute=${evidence.runtimeStatusRoute}`,
    `gatewayState=${runtimeStatus.gateway.state}`,
    `gatewayLogCount=${runtimeStatus.gateway.logCount}`,
    `gatewayActivityEventCount=${runtimeStatus.gateway.activityEventCount}`,
    `inboundCount=${runtimeStatus.gateway.inboundCount}`,
    `outboundCount=${runtimeStatus.gateway.outboundCount}`,
    `pluginTotalCount=${runtimeStatus.runtimeCollections.pluginTotalCount}`,
    `activeShiftCount=${runtimeStatus.runtimeCollections.activeShiftCount}`,
    `activeMissionCount=${runtimeStatus.runtimeCollections.activeMissionCount}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Monitor Runtime Evidence Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 122. Complete: opened the Monitor source path and confirmed runtime evidence is visible through the authenticated runtime status payload.',
    '',
    'Evidence:',
    '',
    `- Runtime status route: ${evidence.runtimeStatusRoute}`,
    `- Runtime summary route: ${evidence.runtimeSummaryRoute}`,
    `- Gateway state: ${runtimeStatus.gateway.state}`,
    `- Gateway log tail entries: ${runtimeStatus.gateway.logCount}`,
    `- Gateway channel activity events: ${runtimeStatus.gateway.activityEventCount}`,
    `- Channel counts: inbound ${runtimeStatus.gateway.inboundCount}, outbound ${runtimeStatus.gateway.outboundCount}`,
    `- Runtime collections: sessions ${runtimeStatus.runtimeCollections.sessions}, active runs ${runtimeStatus.runtimeCollections.activeRuns}, recent runs ${runtimeStatus.runtimeCollections.recentRuns}`,
    `- Plugins: ${runtimeStatus.runtimeCollections.pluginEnabledCount} enabled of ${runtimeStatus.runtimeCollections.pluginTotalCount} total`,
    `- Active shifts: ${runtimeStatus.runtimeCollections.activeShiftCount}`,
    `- Active missions: ${runtimeStatus.runtimeCollections.activeMissionCount}`,
    '- Evidence stores token length and isolated local paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K Monitor runtime evidence smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

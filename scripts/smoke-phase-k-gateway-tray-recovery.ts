import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const require = createRequire(import.meta.url)
const electronPath = require('electron') as string
const startedAt = new Date().toISOString()
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'gateway-tray-recovery-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'GATEWAY_TRAY_RECOVERY_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '12-gateway-tray-recovery-smoke.log')
const controlToken = 'phase-k-gateway-tray-recovery'

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

function terminateProcessTree(pid: number) {
  if (!Number.isFinite(pid)) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000,
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Best-effort cleanup after a failed smoke.
    }
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  let timedOut = false
  const status = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true
      if (child.pid) terminateProcessTree(child.pid)
    }, timeoutMs)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
  return { status, timedOut }
}

async function waitForRequiredOutput(
  child: ChildProcessWithoutNullStreams,
  getOutput: () => string,
  patterns: RegExp[],
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const output = getOutput()
    const missing = patterns.filter((pattern) => !pattern.test(output))
    if (!missing.length) return output
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before required output appeared; missing ${missing.join(', ')}\n${output}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const output = getOutput()
  const missing = patterns.filter((pattern) => !pattern.test(output))
  throw new Error(`Timed out waiting for Phase K tray Gateway recovery output; missing ${missing.join(', ')}\n${output}`)
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|sessionToken["']?\s*:\s*["'][^"']{8,}|controlToken["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

function readOptional(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

function validateSourcePins() {
  const electronMain = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
  const runtimeActionsSmoke = readFileSync(path.join(root, 'scripts/smoke-runtime-actions-control-plane.ts'), 'utf8')

  assert.ok(electronMain.includes("const shutdownLabel = gatewayShutdownInFlight && !isQuitting ? 'Shutting Gateway Off...' : 'Shut Gateway Off'"), 'tray menu should expose Shut Gateway Off')
  assert.ok(electronMain.includes("label: resetLabel"), 'tray menu should expose Restart Gateway through resetLabel')
  assert.ok(electronMain.includes('void stopGatewayCompletely()'), 'tray shutdown item should call stopGatewayCompletely')
  assert.ok(electronMain.includes('void resetGateway()'), 'tray restart item should call resetGateway')
  assert.ok(electronMain.includes("postControlApi('/api/openclaw/runtime/gateway/stop'"), 'tray shutdown should call the runtime Gateway stop API')
  assert.ok(electronMain.includes("postControlApi('/api/openclaw/runtime/gateway/restart'"), 'tray recovery should call the runtime Gateway restart API')
  assert.ok(electronMain.includes('GATEWAY_CONTROL_ACTION_TIMEOUT_MS'), 'tray Gateway controls should use the configurable action timeout')
  assert.ok(electronMain.includes('DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY'), 'Electron E2E should expose tray Gateway recovery assertions')
  assert.ok(electronMain.includes('tray-gateway-stop-ok'), 'Electron E2E should log tray Gateway shutdown success')
  assert.ok(electronMain.includes('tray-gateway-recovery-ok'), 'Electron E2E should log tray Gateway recovery success')
  assert.ok(runtimeActionsSmoke.includes('scripts/smoke-phase-k-gateway-tray-recovery.ts'), 'runtime action smoke should pin the Phase K tray recovery smoke')
  assert.ok(runtimeActionsSmoke.includes('DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY'), 'runtime action smoke should pin the tray recovery E2E flag')

  return {
    trayShutdownLabel: true,
    trayRestartLabel: true,
    trayStopApi: '/api/openclaw/runtime/gateway/stop',
    trayRecoverApi: '/api/openclaw/runtime/gateway/restart',
    electronE2eFlag: 'DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY',
  }
}

assert.ok(typeof electronPath === 'string' && electronPath.length > 0, 'Electron binary path must resolve from the electron package')
assert.ok(existsSync(path.join(root, 'dist', 'index.html')), 'Phase K tray recovery smoke requires dist/index.html; run npm run build:client first')
assert.ok(existsSync(path.join(root, 'dist-server', 'index.cjs')), 'Phase K tray recovery smoke requires dist-server/index.cjs; run npm run build:server first')

mkdirSync(phaseKEvidenceDir, { recursive: true })

const sourcePins = validateSourcePins()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-gateway-tray-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const workspaceRoot = path.join(tempRoot, 'workspace')
const gatewayLogPath = path.join(openclawDir, 'gateway.log')
const e2eLogPath = path.join(tempRoot, 'electron-e2e.log')
mkdirSync(userDataDir, { recursive: true })
mkdirSync(openclawDir, { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })

const apiPort = await freePort()
const frontendPort = await freePort()
const gatewayPort = await freePort()
const browserRelayPort = await freePort()

const env = {
  ...process.env,
  CONTROL_CENTER_PORT: String(apiPort),
  CONTROL_CENTER_FRONTEND_PORT: String(frontendPort),
  OPENCLAW_GATEWAY_PORT: String(gatewayPort),
  OPENCLAW_BROWSER_RELAY_PORT: String(browserRelayPort),
  CONTROL_CENTER_TOKEN: controlToken,
  CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
  CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
  CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
  CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
  CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
  CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
  CONTROL_CENTER_RUNTIME_STATUS_RESPONSE_TIMEOUT_MS: '15000',
  CONTROL_CENTER_RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS: '10000',
  CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS: '15000',
  CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_POLL_MS: '500',
  CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_GRACE_MS: '15000',
  DYSTOPAI_GATEWAY_CONTROL_ACTION_TIMEOUT_MS: '90000',
  DYSTOPAI_ELECTRON_E2E: '1',
  DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '0',
  DYSTOPAI_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
  DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR: '1',
  DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY: '1',
  DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_TRAY_ASSERTIONS: '0',
  DYSTOPAI_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
  DYSTOPAI_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
  DYSTOPAI_ELECTRON_E2E_LOG_PATH: e2eLogPath,
  DYSTOPAI_PIPE_SERVER_LOGS: '1',
  DYSTOPAI_USER_DATA_DIR: userDataDir,
  HOME: path.join(tempRoot, 'home'),
  USERPROFILE: path.join(tempRoot, 'home'),
  OPENCLAW_STATE_DIR: openclawDir,
  OPENCLAW_HOME: openclawDir,
  OPENCLAW_CONFIG_PATH: path.join(openclawDir, 'openclaw.json'),
  OPENCLAW_GATEWAY_LOG_PATH: gatewayLogPath,
  CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
}

mkdirSync(String(env.HOME), { recursive: true })
writeFileSync(String(env.OPENCLAW_CONFIG_PATH), '{}\n', 'utf8')

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
const append = (chunk: Buffer) => {
  output += chunk.toString('utf8')
}
child.stdout.on('data', append)
child.stderr.on('data', append)

try {
  const requiredOutput = [
    /\[dystopai-e2e\] server-ready/,
    /\[dystopai-e2e\] renderer-load:1/,
    /\[dystopai-e2e\] tray-visible-state-ok/,
    /\[dystopai-e2e\] tray-hide-on-close-ok/,
    /\[dystopai-e2e\] tray-click-restore-ok/,
    /\[dystopai-e2e\] tray-gateway-menu-ok/,
    /\[dystopai-e2e\] tray-gateway-stop-ok/,
    /\[dystopai-e2e\] tray-gateway-recovery-ok/,
  ]
  await waitForRequiredOutput(child, () => `${output}\n${readOptional(e2eLogPath)}`, requiredOutput, 120_000)
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (child.pid) terminateProcessTree(child.pid)
  const exitAfterTerminate = await waitForExit(child, 15_000)
  assert.equal(exitAfterTerminate.timedOut, false, `Phase K tray Gateway recovery process did not exit after cleanup\n${output}`)

  const e2eLog = readOptional(e2eLogPath)
  const gatewayLog = readOptional(gatewayLogPath)
  const combinedOutput = `${output}\n${e2eLog}`
  for (const pattern of requiredOutput) {
    assert.match(combinedOutput, pattern, `Phase K tray Gateway recovery output missing ${pattern}\n${combinedOutput}`)
  }
  assert.match(gatewayLog, /tray requested complete gateway shutdown/, 'Gateway lifecycle log should record tray shutdown')
  assert.match(gatewayLog, /tray requested gateway reset/, 'Gateway lifecycle log should record tray recovery reset')
  assert.match(gatewayLog, /gateway start requested through control API/, 'Gateway lifecycle log should record recovery start request')

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [124],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'electron-tray-gateway-stop-recover',
    sourcePins,
    auth: {
      controlTokenLength: controlToken.length,
    },
    isolatedState: {
      userDataDir,
      openclawDir,
      workspaceRoot,
      gatewayLogPath,
      e2eLogPath,
    },
    ports: {
      apiPort,
      frontendPort,
      gatewayPort,
      browserRelayPort,
    },
    trayAssertions: {
      visibleState: true,
      hideOnClose: true,
      trayClickRestore: true,
      gatewayMenu: true,
      gatewayStop: true,
      gatewayRecovery: true,
    },
    electronProcess: {
      terminatedAfterRecovery: true,
      cleanupMode: 'test-harness-process-tree-terminate-after-recovery-marker',
      exitedAfterTerminate: true,
    },
    gatewayLifecycleLog: {
      lineCount: gatewayLog.split(/\r?\n/u).filter(Boolean).length,
      hasTrayShutdownRequest: /tray requested complete gateway shutdown/u.test(gatewayLog),
      hasTrayResetRequest: /tray requested gateway reset/u.test(gatewayLog),
      hasControlApiRecoveryStart: /gateway start requested through control API/u.test(gatewayLog),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K tray Gateway recovery evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=124',
    'blockedItems=none',
    `trayStopApi=${sourcePins.trayStopApi}`,
    `trayRecoverApi=${sourcePins.trayRecoverApi}`,
    `gatewayLogLineCount=${evidence.gatewayLifecycleLog.lineCount}`,
    `hasTrayShutdownRequest=${evidence.gatewayLifecycleLog.hasTrayShutdownRequest}`,
    `hasTrayResetRequest=${evidence.gatewayLifecycleLog.hasTrayResetRequest}`,
    `hasControlApiRecoveryStart=${evidence.gatewayLifecycleLog.hasControlApiRecoveryStart}`,
    '',
    '[electron-e2e-output]',
    combinedOutput.trim(),
    '',
    '[gateway-lifecycle-log]',
    gatewayLog.trim(),
    '',
  ].join('\n'), 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Gateway Tray Recovery Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 124. Complete: stop Gateway from the tray/menu path and recover it through the same operator surface.',
    '',
    'Evidence:',
    '',
    `- Tray shutdown label: ${sourcePins.trayShutdownLabel ? 'present' : 'missing'}`,
    `- Tray restart label: ${sourcePins.trayRestartLabel ? 'present' : 'missing'}`,
    `- Stop API path: ${sourcePins.trayStopApi}`,
    `- Recovery API path: ${sourcePins.trayRecoverApi}`,
    `- Electron E2E flag: ${sourcePins.electronE2eFlag}`,
    '- Tray hide/show assertions passed before Gateway actions.',
    '- Tray Gateway shutdown assertion passed.',
    '- Tray Gateway recovery assertion passed.',
    `- Gateway lifecycle log rows: ${evidence.gatewayLifecycleLog.lineCount}`,
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '- Evidence stores token length and isolated local paths only; no bearer tokens or credential material are written.',
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K Gateway tray recovery smoke ok: ${evidenceJsonPath}`)
} finally {
  if (child.exitCode === null && child.pid) terminateProcessTree(child.pid)
  rmSync(tempRoot, { recursive: true, force: true })
}

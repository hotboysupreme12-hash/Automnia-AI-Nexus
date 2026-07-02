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
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'app-rehydration-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'APP_REHYDRATION_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '13-app-rehydration-smoke.log')

type RehydrationMode = 'seed' | 'verify'

type RehydrationResult = {
  mode: RehydrationMode
  tokenLength: number
  authenticated: true
  agentId: string
  identityName: string
  overviewWorkspaceMatches: boolean
  configWorkspaceMatches: boolean
  localStorageMarkerMatches: boolean
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
      // Process already exited; timeout cleanup is best-effort.
    }
  }
}

function readOptional(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|sessionToken["']?\s*:\s*["'][^"']{8,}|controlToken["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

function parseRehydrationResult(mode: RehydrationMode, combinedOutput: string): RehydrationResult {
  const match = combinedOutput.match(new RegExp(`app-rehydration-${mode}-ok:(\\{[^\\n]+\\})`))
  assert.ok(match, `Phase K app rehydration ${mode} output did not include structured result\n${combinedOutput}`)
  const parsed = JSON.parse(match[1]) as RehydrationResult
  assert.equal(parsed.mode, mode)
  assert.equal(parsed.authenticated, true)
  assert.ok(Number(parsed.tokenLength) >= 16, `${mode} session token length should be non-empty`)
  assert.equal(parsed.overviewWorkspaceMatches, true)
  assert.equal(parsed.configWorkspaceMatches, true)
  assert.equal(parsed.localStorageMarkerMatches, true)
  return parsed
}

function e2eLines(output: string) {
  const seen = new Set<string>()
  const lines = output
    .split(/\r?\n/u)
    .filter((line) => line.includes('[dystopai-e2e]'))
  return lines.filter((line) => {
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
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

async function runElectronRehydrationPass(options: {
  mode: RehydrationMode
  tempRoot: string
  userDataDir: string
  openclawDir: string
  homeDir: string
  workspaceRoot: string
  controlCenterTokenFile: string
  initialWorkspace: string
  editedWorkspace: string
  agentId: string
  marker: string
  ports: {
    apiPort: number
    frontendPort: number
    gatewayPort: number
    browserRelayPort: number
  }
}) {
  const e2eLogPath = path.join(options.tempRoot, `${options.mode}-electron-e2e.log`)
  const configPath = path.join(options.openclawDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n', 'utf8')

  const env = {
    ...process.env,
    CONTROL_CENTER_PORT: String(options.ports.apiPort),
    CONTROL_CENTER_FRONTEND_PORT: String(options.ports.frontendPort),
    OPENCLAW_GATEWAY_PORT: String(options.ports.gatewayPort),
    OPENCLAW_BROWSER_RELAY_PORT: String(options.ports.browserRelayPort),
    CONTROL_CENTER_TOKEN: '',
    CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
    CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
    CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
    CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
    CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
    CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
    CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
    CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
    CONTROL_CENTER_WORKSPACE_ROOT: options.workspaceRoot,
    DYSTOPAI_CONTROL_CENTER_TOKEN_FILE: options.controlCenterTokenFile,
    DYSTOPAI_ELECTRON_E2E: '1',
    DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '45000',
    DYSTOPAI_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
    DYSTOPAI_ELECTRON_E2E_ASSERT_APP_REHYDRATION: '1',
    DYSTOPAI_ELECTRON_E2E_APP_REHYDRATION_MODE: options.mode,
    DYSTOPAI_ELECTRON_E2E_APP_REHYDRATION_AGENT_ID: options.agentId,
    DYSTOPAI_ELECTRON_E2E_APP_REHYDRATION_INITIAL_WORKSPACE: options.initialWorkspace,
    DYSTOPAI_ELECTRON_E2E_APP_REHYDRATION_EDITED_WORKSPACE: options.editedWorkspace,
    DYSTOPAI_ELECTRON_E2E_APP_REHYDRATION_MARKER: options.marker,
    DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_APP_REHYDRATION: '1',
    DYSTOPAI_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
    DYSTOPAI_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
    DYSTOPAI_ELECTRON_E2E_LOG_PATH: e2eLogPath,
    DYSTOPAI_PIPE_SERVER_LOGS: '1',
    DYSTOPAI_USER_DATA_DIR: options.userDataDir,
    HOME: options.homeDir,
    USERPROFILE: options.homeDir,
    OPENCLAW_STATE_DIR: options.openclawDir,
    OPENCLAW_HOME: options.openclawDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_LOG_PATH: path.join(options.openclawDir, 'gateway.log'),
  }

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
    const exit = await waitForExit(child, 90_000)
    const combinedOutput = `${output}\n${readOptional(e2eLogPath)}`
    assert.equal(exit.timedOut, false, `Phase K app rehydration ${options.mode} pass timed out\n${combinedOutput}`)
    assert.equal(exit.status, 0, `Phase K app rehydration ${options.mode} pass exited ${exit.status}\n${combinedOutput}`)
    for (const pattern of [
      /\[dystopai-e2e\] port-cleanup-skipped/,
      /\[dystopai-e2e\] server-ready/,
      /\[dystopai-e2e\] navigation-policy-ok/,
      /\[dystopai-e2e\] renderer-load:1/,
      new RegExp(`\\[dystopai-e2e\\] app-rehydration-${options.mode}-ok:`),
      /\[dystopai-e2e\] quit-cleanup-complete/,
    ]) {
      assert.match(combinedOutput, pattern, `Phase K app rehydration ${options.mode} output missing ${pattern}\n${combinedOutput}`)
    }
    return {
      result: parseRehydrationResult(options.mode, combinedOutput),
      e2eLogPath,
      e2eLines: e2eLines(combinedOutput),
    }
  } finally {
    if (child.exitCode === null && child.pid) terminateProcessTree(child.pid)
  }
}

assert.ok(typeof electronPath === 'string' && electronPath.length > 0, 'Electron binary path must resolve from the electron package')
assert.ok(existsSync(path.join(root, 'dist', 'index.html')), 'Phase K app rehydration smoke requires dist/index.html; run npm run build:client first')
assert.ok(existsSync(path.join(root, 'dist-server', 'index.cjs')), 'Phase K app rehydration smoke requires dist-server/index.cjs; run npm run build:server first')
mkdirSync(phaseKEvidenceDir, { recursive: true })

const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-app-rehydration-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const homeDir = path.join(tempRoot, 'home')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const initialWorkspace = path.join(workspaceRoot, 'phase-k-rehydration-initial')
const editedWorkspace = path.join(workspaceRoot, 'phase-k-rehydration-edited')
const controlCenterTokenFile = path.join(userDataDir, 'auth', 'control-center-token.json')
const agentId = 'phase-k-rehydration-agent'
const marker = `phase-k-rehydration-${Date.now()}`
mkdirSync(userDataDir, { recursive: true })
mkdirSync(openclawDir, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(initialWorkspace, { recursive: true })
mkdirSync(editedWorkspace, { recursive: true })

const ports = {
  apiPort: await freePort(),
  frontendPort: await freePort(),
  gatewayPort: await freePort(),
  browserRelayPort: await freePort(),
}

try {
  const seed = await runElectronRehydrationPass({
    mode: 'seed',
    tempRoot,
    userDataDir,
    openclawDir,
    homeDir,
    workspaceRoot,
    controlCenterTokenFile,
    initialWorkspace,
    editedWorkspace,
    agentId,
    marker,
    ports,
  })
  assert.ok(existsSync(controlCenterTokenFile), 'first app launch should persist the local Control Center token file')
  const tokenFileAfterSeed = readFileSync(controlCenterTokenFile, 'utf8')
  const parsedTokenFile = JSON.parse(tokenFileAfterSeed) as { token?: string; scope?: string; source?: string }
  assert.equal(typeof parsedTokenFile.token, 'string')
  assert.ok((parsedTokenFile.token || '').length >= 16, 'persisted Control Center token should be non-empty')
  assert.equal(parsedTokenFile.scope, 'local-control-center')

  await new Promise((resolve) => setTimeout(resolve, 750))

  const verify = await runElectronRehydrationPass({
    mode: 'verify',
    tempRoot,
    userDataDir,
    openclawDir,
    homeDir,
    workspaceRoot,
    controlCenterTokenFile,
    initialWorkspace,
    editedWorkspace,
    agentId,
    marker,
    ports,
  })
  const tokenFileAfterVerify = readFileSync(controlCenterTokenFile, 'utf8')
  assert.equal(tokenFileAfterVerify, tokenFileAfterSeed, 'second app launch should reuse the persisted local Control Center token file')

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [125],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'electron-app-restart-state-rehydration',
    sourcePins: {
      electronE2eFlag: 'DYSTOPAI_ELECTRON_E2E_ASSERT_APP_REHYDRATION',
      seedMarker: 'app-rehydration-seed-ok',
      verifyMarker: 'app-rehydration-verify-ok',
      packageScript: 'smoke:phase-k-app-rehydration',
    },
    isolatedState: {
      userDataDir,
      openclawDir,
      homeDir,
      workspaceRoot,
      initialWorkspace,
      editedWorkspace,
      controlCenterTokenFile,
    },
    ports,
    auth: {
      launchTokenFileCreated: true,
      launchTokenFileReusedAcrossRestart: true,
      tokenFileSource: parsedTokenFile.source || 'generated',
      sessionTokenLengths: [seed.result.tokenLength, verify.result.tokenLength],
    },
    rehydration: {
      agentId,
      identityName: verify.result.identityName,
      firstLaunchSeededAgent: seed.result.agentId === agentId,
      secondLaunchReadAgent: verify.result.agentId === agentId,
      overviewWorkspaceMatches: verify.result.overviewWorkspaceMatches,
      configWorkspaceMatches: verify.result.configWorkspaceMatches,
      rendererLocalStorageRehydrated: verify.result.localStorageMarkerMatches,
    },
    logs: {
      seedLogPath: seed.e2eLogPath,
      verifyLogPath: verify.e2eLogPath,
      evidenceLogPath,
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K app rehydration evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=125',
    'blockedItems=none',
    `agentId=${agentId}`,
    `launchTokenFileCreated=${evidence.auth.launchTokenFileCreated}`,
    `launchTokenFileReusedAcrossRestart=${evidence.auth.launchTokenFileReusedAcrossRestart}`,
    `rendererLocalStorageRehydrated=${evidence.rehydration.rendererLocalStorageRehydrated}`,
    `overviewWorkspaceMatches=${evidence.rehydration.overviewWorkspaceMatches}`,
    `configWorkspaceMatches=${evidence.rehydration.configWorkspaceMatches}`,
    '',
    '[seed-e2e]',
    ...seed.e2eLines,
    '',
    '[verify-e2e]',
    ...verify.e2eLines,
    '',
  ].join('\n'), 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K App Rehydration Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 125. Complete: restart the app and confirm state rehydrates.',
    '',
    'Evidence:',
    '',
    '- First Electron launch bootstrapped a renderer session and seeded one recruited agent plus edited workspace state.',
    '- Second Electron launch reused the same isolated user-data, OpenClaw, and workspace roots.',
    '- Second launch bootstrapped a fresh renderer session and read the recruited agent from backend state.',
    '- Renderer localStorage marker persisted across the restart on the same loopback origin.',
    '- Local Control Center launch-token file was created on first launch and reused on second launch; only token lengths are recorded.',
    `- Agent: ${agentId}`,
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K app rehydration smoke ok: ${evidenceJsonPath}`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

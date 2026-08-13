import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const releaseRoot = path.join(root, 'release')
const unpackedRoot = path.join(releaseRoot, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const launcherPath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'Automnia AI Nexus.exe')
  : path.join(unpackedRoot, 'automnia')
const electronRuntimePath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'electron.exe')
  : launcherPath
const resourcesDir = path.join(unpackedRoot, 'resources')
const e2eEvidenceLogPath = path.join(phaseKEvidenceDir, '05-desktop-launch-bootstrap.log')
const e2eEvidenceJsonPath = path.join(phaseKEvidenceDir, 'desktop-launch-bootstrap.json')
const e2eEvidenceMarkdownPath = path.join(phaseKEvidenceDir, 'DESKTOP_LAUNCH_BOOTSTRAP.md')
const startedAt = new Date().toISOString()

const requiredPackagedFiles = [
  launcherPath,
  electronRuntimePath,
  path.join(resourcesDir, 'app.asar'),
  path.join(resourcesDir, 'dist', 'index.html'),
  path.join(resourcesDir, 'dist-server', 'index.cjs'),
  path.join(resourcesDir, 'toolchains', 'node'),
  path.join(resourcesDir, 'openclaw'),
]

for (const filePath of requiredPackagedFiles) {
  assert.ok(existsSync(filePath), `Phase K desktop launch smoke requires ${filePath}; run npm run package:desktop first`)
}
assert.ok(statSync(launcherPath).isFile(), 'packaged launcher must be a file')
assert.ok(statSync(electronRuntimePath).isFile(), 'packaged Electron runtime must be a file')
mkdirSync(phaseKEvidenceDir, { recursive: true })

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

function powerShellSingleQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function killPackagedElectronProcesses() {
  if (process.platform !== 'win32') return
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$target = ${powerShellSingleQuote(electronRuntimePath)}`,
    'Get-CimInstance Win32_Process |',
    '  Where-Object { $_.ExecutablePath -eq $target } |',
    '  ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }',
  ].join('; ')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
}

async function removeTempRootWithWindowsRetries(tempRootPath: string) {
  const attempts = process.platform === 'win32' ? 12 : 2
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(tempRootPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 250,
      })
      return
    } catch (error) {
      lastError = error
      killPackagedElectronProcesses()
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2000)))
    }
  }
  console.warn(`[phase-k-desktop-launch] could not remove temp directory after launch verification: ${tempRootPath}`)
  console.warn(lastError instanceof Error ? lastError.message : String(lastError))
}

async function waitForLogPatterns(logPath: string, patterns: RegExp[], timeoutMs = 75_000) {
  const found = new Set<number>()
  const start = Date.now()
  let content = ''
  while (Date.now() - start < timeoutMs) {
    if (existsSync(logPath)) {
      content = readFileSync(logPath, 'utf8')
      patterns.forEach((pattern, index) => {
        if (pattern.test(content)) found.add(index)
      })
      if (found.size === patterns.length) return content
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const missing = patterns
    .map((pattern, index) => (found.has(index) ? null : String(pattern)))
    .filter(Boolean)
    .join(', ')
  throw new Error(`Phase K desktop launch log did not contain ${missing}\n${content}`)
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-desktop-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const workspaceRoot = path.join(tempRoot, 'workspace')
const logPath = path.join(tempRoot, 'electron-e2e.log')
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
  CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
  CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
  CONTROL_CENTER_TOKEN: 'phase-k-desktop-launch',
  AUTOMNIA_ELECTRON_E2E: '1',
  AUTOMNIA_ELECTRON_E2E_LOG_PATH: logPath,
  AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS: '0',
  AUTOMNIA_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
  AUTOMNIA_ELECTRON_E2E_ASSERT_DESKTOP_BOOTSTRAP: '1',
  AUTOMNIA_ELECTRON_E2E_QUIT_AFTER_DESKTOP_BOOTSTRAP: '1',
  AUTOMNIA_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
  AUTOMNIA_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
  AUTOMNIA_USER_DATA_DIR: userDataDir,
  OPENCLAW_STATE_DIR: openclawDir,
  OPENCLAW_HOME: openclawDir,
  CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
}

let launcherStatus: number | null = null
let launcherOutput = ''
let logContent = ''

try {
  const launcher = spawn(launcherPath, [], {
    cwd: unpackedRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  launcher.stdout?.on('data', (chunk: Buffer) => { launcherOutput += chunk.toString('utf8') })
  launcher.stderr?.on('data', (chunk: Buffer) => { launcherOutput += chunk.toString('utf8') })

  launcherStatus = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      launcher.kill()
      reject(new Error(`Phase K desktop launcher did not exit within 10s\n${launcherOutput}`))
    }, 10_000)
    launcher.once('error', reject)
    launcher.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
  assert.equal(launcherStatus, 0, `Phase K desktop launcher exited ${launcherStatus}\n${launcherOutput}`)

  logContent = await waitForLogPatterns(logPath, [
    /\[automnia-e2e\] port-cleanup-skipped/,
    /\[automnia-e2e\] server-ready/,
    /\[automnia-e2e\] navigation-policy-ok/,
    /\[automnia-e2e\] renderer-load:1/,
    /\[automnia-e2e\] desktop-session-bootstrap-token-length:\d+/,
    /\[automnia-e2e\] desktop-session-bootstrap-ok/,
    /\[automnia-e2e\] quit-cleanup-complete/,
  ])
  copyFileSync(logPath, e2eEvidenceLogPath)

  const tokenLengthMatch = logContent.match(/desktop-session-bootstrap-token-length:(\d+)/)
  const evidence = {
    phase: 'K',
    completedItems: [112, 113],
    startedAt,
    completedAt: new Date().toISOString(),
    mode: 'packaged-production-dir',
    launcherPath,
    requiredPackagedFiles,
    isolatedState: {
      userDataDir,
      openclawDir,
      workspaceRoot,
    },
    ports: {
      controlCenter: apiPort,
      frontend: frontendPort,
      gateway: gatewayPort,
      browserRelay: browserRelayPort,
    },
    assertions: {
      packagedAppLaunched: true,
      controlPlaneReady: true,
      rendererLoaded: true,
      navigationPolicyChecked: true,
      desktopSessionBootstrapReturnedToken: true,
      bootstrapTokenAcceptedByAuthStatus: true,
      bootstrapTokenLength: tokenLengthMatch ? Number(tokenLengthMatch[1]) : null,
      quitCleanupComplete: true,
    },
    evidenceLog: e2eEvidenceLogPath,
  }
  writeFileSync(e2eEvidenceJsonPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  writeFileSync(e2eEvidenceMarkdownPath, [
    '# Phase K Desktop Launch And Bootstrap Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${evidence.completedAt}`,
    '',
    'Verified manual beta items:',
    '',
    '- 112. Launch desktop app.',
    '- 113. Confirm automatic desktop session bootstrap works.',
    '',
    'Assertions:',
    '',
    '- Packaged app launcher exited cleanly.',
    '- Control Center API reached ready state on loopback.',
    '- Renderer loaded from the packaged production app.',
    '- E2E navigation policy self-test passed.',
    '- Renderer invoked the narrow preload desktop-session bootstrap bridge.',
    '- The returned session token authenticated against `/api/auth/status`.',
    '- Quit cleanup completed without leaving the packaged runtime running.',
    '',
    `Evidence log: ${path.relative(root, e2eEvidenceLogPath)}`,
    `Evidence JSON: ${path.relative(root, e2eEvidenceJsonPath)}`,
    '',
  ].join('\n'), 'utf8')
} finally {
  killPackagedElectronProcesses()
  await removeTempRootWithWindowsRetries(tempRoot)
}

console.log(`Phase K desktop launch/bootstrap smoke ok: ${e2eEvidenceJsonPath}`)

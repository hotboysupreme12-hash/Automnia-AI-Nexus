import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const releaseRoot = path.join(root, 'release')
const productName = 'Automnia AI Nexus'

function resolveMacUnpackedRoot() {
  const candidates = [
    path.join(releaseRoot, process.arch === 'arm64' ? 'mac-arm64' : 'mac'),
    path.join(releaseRoot, 'mac-arm64'),
    path.join(releaseRoot, 'mac'),
  ]
  const unpackedRoot = candidates.find((candidate) => existsSync(path.join(candidate, `${productName}.app`)))
  assert.ok(unpackedRoot, `packaged launch smoke requires a macOS app bundle under ${candidates.join(' or ')}; run node scripts/package-desktop.cjs --dir first`)
  return unpackedRoot
}

const unpackedRoot = process.platform === 'darwin'
  ? resolveMacUnpackedRoot()
  : path.join(releaseRoot, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const macAppPath = path.join(unpackedRoot, `${productName}.app`)
const launcherPath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'Automnia AI Nexus.exe')
  : process.platform === 'darwin'
    ? path.join(macAppPath, 'Contents', 'MacOS', productName)
  : path.join(unpackedRoot, 'automnia')
const electronRuntimePath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'electron.exe')
  : launcherPath
const resourcesDir = process.platform === 'darwin'
  ? path.join(macAppPath, 'Contents', 'Resources')
  : path.join(unpackedRoot, 'resources')
const launcherCwd = process.platform === 'darwin' ? path.dirname(launcherPath) : unpackedRoot
const launcherExitTimeoutMs = process.platform === 'darwin' ? 30_000 : 10_000
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
  assert.ok(existsSync(filePath), `packaged launch smoke requires ${filePath}; run node scripts/package-desktop.cjs --dir first`)
}
assert.ok(statSync(launcherPath).isFile(), 'packaged launcher must be a file')
assert.ok(statSync(electronRuntimePath).isFile(), 'packaged Electron runtime must be a file')

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
    `$targets = @(${powerShellSingleQuote(electronRuntimePath)}, ${powerShellSingleQuote(launcherPath)})`,
    'Get-CimInstance Win32_Process |',
    '  Where-Object { $targets -contains $_.ExecutablePath } |',
    '  ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }',
  ].join('; ')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
}

function terminatePackagedLauncher(launcher: ReturnType<typeof spawn>) {
  if (process.platform === 'win32') {
    killPackagedElectronProcesses()
  }
  launcher.kill()
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
  console.warn(`[packaged-launch-smoke] could not remove temp directory after launch verification: ${tempRootPath}`)
  console.warn(lastError instanceof Error ? lastError.message : String(lastError))
}

async function waitForLogPatterns(logPath: string, patterns: RegExp[], timeoutMs = 60_000) {
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
  throw new Error(`packaged Electron launch log did not contain ${missing}\n${content}`)
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-packaged-launch-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const workspaceRoot = path.join(tempRoot, 'workspace')
const logPath = path.join(tempRoot, 'electron-e2e.log')

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
  CONTROL_CENTER_TOKEN: 'packaged-electron-e2e',
  AUTOMNIA_ELECTRON_E2E: '1',
  AUTOMNIA_ELECTRON_E2E_ALLOW_PARALLEL: '1',
  AUTOMNIA_ELECTRON_E2E_LOG_PATH: logPath,
  AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS: '1500',
  AUTOMNIA_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
  AUTOMNIA_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
  AUTOMNIA_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
  AUTOMNIA_USER_DATA_DIR: userDataDir,
  OPENCLAW_STATE_DIR: openclawDir,
  OPENCLAW_HOME: openclawDir,
  CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
}

try {
  const launcher = spawn(launcherPath, [], {
    cwd: launcherCwd,
    env,
    windowsHide: true,
    // Do not let descendant Electron processes inherit CI's stdout/stderr
    // handles; on Windows that can keep the PowerShell pipeline open after
    // the packaged launcher has completed its smoke-test work.
    stdio: ['ignore', 'ignore', 'ignore'],
  })

  const launcherStatus = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminatePackagedLauncher(launcher)
      const diagnostics = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : '(no launch log was created)'
      reject(new Error(`packaged launcher did not exit within ${launcherExitTimeoutMs / 1000}s\n${diagnostics}`))
    }, launcherExitTimeoutMs)
    launcher.once('error', reject)
    launcher.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
  assert.equal(launcherStatus, 0, `packaged launcher exited ${launcherStatus}`)

  await waitForLogPatterns(logPath, [
    /\[automnia-e2e\] port-cleanup-skipped/,
    /\[automnia-e2e\] server-ready/,
    /\[automnia-e2e\] navigation-policy-ok/,
    /\[automnia-e2e\] auto-quit/,
    /\[automnia-e2e\] quit-cleanup-complete/,
  ])

  assert.ok(existsSync(userDataDir), 'packaged startup must recreate a missing Automnia user-data directory')
  assert.ok(existsSync(openclawDir), 'packaged startup must recreate a missing OpenClaw state directory')

  const writableRuntimeParent = path.join(userDataDir, 'runtimes', 'openclaw')
  assert.ok(existsSync(writableRuntimeParent), 'packaged startup must stage OpenClaw under Automnia user data')
  const writableRuntimeName = readdirSync(writableRuntimeParent).find((entry) =>
    existsSync(path.join(writableRuntimeParent, entry, 'package.json')),
  )
  assert.ok(writableRuntimeName, 'packaged startup must create a complete writable OpenClaw runtime')
  const writableRuntimeRoot = path.join(writableRuntimeParent, writableRuntimeName)
  const bundledRuntimeRoot = path.join(resourcesDir, 'openclaw')
  assert.notEqual(path.resolve(writableRuntimeRoot), path.resolve(bundledRuntimeRoot), 'mutable OpenClaw files must not point into the packaged resources directory')

  const codexCliRelative = path.join('dist', 'extensions', 'codex', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  const bundledCodexCli = path.join(bundledRuntimeRoot, codexCliRelative)
  if (process.platform === 'win32' && existsSync(bundledCodexCli)) {
    const writableCodexCli = path.join(writableRuntimeRoot, codexCliRelative)
    assert.ok(existsSync(writableCodexCli), 'writable OpenClaw copy must include the bundled Codex executable')
    const descriptor = openSync(writableCodexCli, 'r+')
    closeSync(descriptor)
  }
} finally {
  killPackagedElectronProcesses()
  await removeTempRootWithWindowsRetries(tempRoot)
}

console.log('packaged electron launch smoke ok')

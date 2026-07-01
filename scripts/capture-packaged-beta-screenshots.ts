import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const releaseRoot = path.join(root, 'release')
const unpackedRoot = path.join(releaseRoot, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const launcherPath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'DystopAI.exe')
  : path.join(unpackedRoot, 'dystopai')
const electronRuntimePath = process.platform === 'win32'
  ? path.join(unpackedRoot, 'electron.exe')
  : launcherPath
const resourcesDir = path.join(unpackedRoot, 'resources')
const requiredPackagedFiles = [
  launcherPath,
  electronRuntimePath,
  path.join(resourcesDir, 'app.asar'),
  path.join(resourcesDir, 'dist', 'index.html'),
  path.join(resourcesDir, 'dist-server', 'index.cjs'),
]

for (const filePath of requiredPackagedFiles) {
  assert.ok(existsSync(filePath), `packaged screenshot capture requires ${filePath}; run npm run package:desktop first`)
  assert.ok(statSync(filePath).isFile(), `${filePath} must be a file`)
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

async function waitForLogPatterns(logPath: string, patterns: RegExp[], timeoutMs = 90_000) {
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
  throw new Error(`packaged screenshot log did not contain ${missing}\n${content}`)
}

function timestampSegment() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-packaged-screens-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const workspaceRoot = path.join(tempRoot, 'workspace')
const logPath = path.join(tempRoot, 'electron-screenshots.log')
const outputDir = path.join(root, 'output', 'packaged-beta-screenshots', timestampSegment())
mkdirSync(userDataDir, { recursive: true })
mkdirSync(openclawDir, { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(outputDir, { recursive: true })

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
  CONTROL_CENTER_TOKEN: 'packaged-beta-screenshots',
  DYSTOPAI_DISABLE_TRAY: '1',
  DYSTOPAI_ELECTRON_E2E: '1',
  DYSTOPAI_ELECTRON_E2E_LOG_PATH: logPath,
  DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '0',
  DYSTOPAI_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
  DYSTOPAI_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
  DYSTOPAI_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
  DYSTOPAI_ELECTRON_E2E_SCREENSHOT_DIR: outputDir,
  DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_SCREENSHOTS: '1',
  DYSTOPAI_USER_DATA_DIR: userDataDir,
  OPENCLAW_STATE_DIR: openclawDir,
  OPENCLAW_HOME: openclawDir,
  CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
}

try {
  const launcher = spawn(launcherPath, [], {
    cwd: unpackedRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let launcherOutput = ''
  launcher.stdout?.on('data', (chunk: Buffer) => { launcherOutput += chunk.toString('utf8') })
  launcher.stderr?.on('data', (chunk: Buffer) => { launcherOutput += chunk.toString('utf8') })

  const exitPromise = new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      launcher.kill()
      reject(new Error(`packaged screenshot capture did not exit within 120s\n${launcherOutput}`))
    }, 120_000)
    launcher.once('error', reject)
    launcher.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })

  await waitForLogPatterns(logPath, [
    /\[dystopai-e2e\] port-cleanup-skipped/,
    /\[dystopai-e2e\] server-ready/,
    /\[dystopai-e2e\] navigation-policy-ok/,
    /\[dystopai-e2e\] screenshots-ok:12/,
    /\[dystopai-e2e\] quit-cleanup-complete/,
  ])
  const exitCode = await exitPromise
  assert.equal(exitCode, 0, `packaged screenshot capture exited ${exitCode}\n${launcherOutput}`)

  const screenshots = readdirSync(outputDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => path.join(outputDir, name))
    .sort()
  assert.equal(screenshots.length, 12, `expected 12 packaged beta screenshots in ${outputDir}`)
  const manifestPath = path.join(outputDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    mode: 'packaged-production-dir',
    unpackedRoot,
    screenshots,
  }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, outputDir, manifestPath, screenshots }, null, 2))
} finally {
  killPackagedElectronProcesses()
}

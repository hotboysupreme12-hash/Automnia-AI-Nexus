const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const http = require('node:http')
const { randomBytes } = require('node:crypto')
const path = require('node:path')

const APP_PORT = Number(process.env.CONTROL_CENTER_PORT || 4050)
const DEV_FRONTEND_PORT = Number(process.env.CONTROL_CENTER_FRONTEND_PORT || 5173)
const GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789)
const BROWSER_RELAY_PORT = Number(process.env.OPENCLAW_BROWSER_RELAY_PORT || 18792)
const MANAGED_PORTS = Array.from(new Set([
  APP_PORT,
  DEV_FRONTEND_PORT,
  GATEWAY_PORT,
  BROWSER_RELAY_PORT,
  4050,
  18789,
  18792,
  4051,
  4052,
  ...Array.from({ length: 16 }, (_, index) => 5173 + index),
]))
function detectPackagedRuntime() {
  if (app.isPackaged) return true
  try {
    if (app.getAppPath().toLowerCase().endsWith('app.asar')) return true
  } catch {}
  return fs.existsSync(path.join(process.resourcesPath || '', 'dist-server', 'index.cjs'))
}
const isDev = !detectPackagedRuntime()
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || app.getPath('home')
const DYSTOPAI_USER_DATA_DIR = path.resolve(process.env.DYSTOPAI_USER_DATA_DIR || path.join(HOME_DIR, '.dystopai-control-center'))
app.setPath('userData', DYSTOPAI_USER_DATA_DIR)
const NPM_TOOLCHAIN_ROOT = path.join(DYSTOPAI_USER_DATA_DIR, 'toolchains', 'node')
const BUNDLED_NPM_TOOLCHAIN_ROOT = path.join(process.resourcesPath || '', 'toolchains', 'node')
const MIN_NPM_NODE_MAJOR = 22
const MIN_NPM_NODE_MINOR = 19
const WINDOWS_RENDERER_STABILITY = process.platform === 'win32' && process.env.DYSTOPAI_WINDOWS_RENDERER_STABILITY !== '0'
const WINDOWS_DISABLE_GPU = process.platform === 'win32' && (
  process.env.DYSTOPAI_WINDOWS_DISABLE_GPU === '1' ||
  process.env.DYSTOPAI_WINDOWS_SAFE_RENDERER === '1'
)
const WINDOWS_DIAGNOSTIC_SINGLE_PROCESS = process.platform === 'win32' &&
  isDev &&
  process.env.DYSTOPAI_WINDOWS_DIAGNOSTIC_SINGLE_PROCESS === '1' &&
  process.env.DYSTOPAI_ACK_UNSAFE_ELECTRON_SANDBOX_DIAGNOSTIC === '1'
process.env.OPENCLAW_SUPPRESS_EXTENSION_API_WARNING = process.env.OPENCLAW_SUPPRESS_EXTENSION_API_WARNING || '1'
if (WINDOWS_DISABLE_GPU) {
  app.disableHardwareAcceleration()
}
if (WINDOWS_DIAGNOSTIC_SINGLE_PROCESS) {
  console.warn('[dystopai] unsafe Electron single-process diagnostic mode is enabled for this development run only.')
  app.commandLine.appendSwitch('single-process')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
if (WINDOWS_RENDERER_STABILITY) {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling')
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

let mainWindow = null
let tray = null
let gatewayProcess = null
let serverProcess = null
let startupFailed = false
let startingUp = false
let isQuitting = false
let gatewayShutdownInFlight = null
let gatewayResetInFlight = null
let quitCleanupInFlight = null
let quitCleanupComplete = false
let controlServerEntry = null
let serverRestartTimer = null
let serverRestartAttempts = 0
let controlCenterLaunchToken = ''
const SERVER_RESTART_BASE_DELAY_MS = 1000
const SERVER_RESTART_MAX_DELAY_MS = 10_000

function appRoot() {
  return app.getAppPath()
}

function resourcePath(...parts) {
  if (isDev) return path.join(appRoot(), ...parts)
  return path.join(process.resourcesPath, ...parts)
}

function controlCenterOrigin() {
  return `http://127.0.0.1:${APP_PORT}`
}

function isTrustedRendererSender(event) {
  const frameUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
  try {
    const parsed = new URL(frameUrl)
    return parsed.origin === controlCenterOrigin() || parsed.origin === `http://localhost:${APP_PORT}`
  } catch {
    return false
  }
}

function ensureControlCenterLaunchToken() {
  if (!controlCenterLaunchToken) {
    controlCenterLaunchToken = process.env.CONTROL_CENTER_TOKEN || randomBytes(32).toString('base64url')
  }
  process.env.CONTROL_CENTER_TOKEN = controlCenterLaunchToken
  return controlCenterLaunchToken
}

function resolveDirectoryPickerStartPath(startPath) {
  const raw = typeof startPath === 'string' ? startPath.trim() : ''
  if (!raw || raw.includes('\0')) return app.getPath('documents')
  try {
    const resolved = path.resolve(raw)
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) return resolved
      if (stat.isFile()) return path.dirname(resolved)
    }
    let current = resolved
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = path.dirname(current)
      if (parent === current) break
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) return parent
      current = parent
    }
  } catch {}
  return app.getPath('documents')
}

ipcMain.handle('dystopai:pick-directory', async (event, input = {}) => {
  try {
    if (!isTrustedRendererSender(event)) {
      return { ok: false, error: 'Untrusted renderer origin', path: null }
    }
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined
    /** @type {import('electron').OpenDialogOptions} */
    const options = {
      title: 'Select Agent Workspace',
      defaultPath: resolveDirectoryPickerStartPath(input.startPath),
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return { ok: false, cancelled: true, path: null }
    const selected = result.filePaths[0]
    return selected ? { ok: true, path: selected } : { ok: false, cancelled: true, path: null }
  } catch (error) {
    return { ok: false, error: error?.message || String(error), path: null }
  }
})

ipcMain.handle('dystopai:get-control-center-token', async (event) => {
  if (!isTrustedRendererSender(event)) return null
  return ensureControlCenterLaunchToken()
})

function resolveServerEntry() {
  const candidates = [
    resourcePath('dist-server', 'index.cjs'),
    path.join(appRoot(), 'dist-server', 'index.cjs'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error(`Could not find bundled API server. Checked: ${candidates.join(', ')}`)
  return found
}

function resolveStaticDir() {
  const candidates = [resourcePath('dist'), path.join(appRoot(), 'dist')]
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'index.html')))
  if (!found) throw new Error(`Could not find bundled UI. Checked: ${candidates.join(', ')}`)
  return found
}

function openClawRuntimeCandidatesForDir(dir) {
  return process.platform === 'win32'
    ? [path.join(dir, 'openclaw.cmd'), path.join(dir, 'openclaw.mjs')]
    : [path.join(dir, 'openclaw.mjs')]
}

function releaseOpenClawRuntimeCandidates(root) {
  const releaseRoot = path.join(root, 'release')
  const candidates = [
    ...openClawRuntimeCandidatesForDir(path.join(releaseRoot, 'win-unpacked', 'resources', 'openclaw')),
  ]
  try {
    for (const entry of fs.readdirSync(releaseRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('win-unpacked')) continue
      candidates.push(...openClawRuntimeCandidatesForDir(path.join(releaseRoot, entry.name, 'resources', 'openclaw')))
    }
  } catch {
    // Source/dev release fallback is optional.
  }
  return candidates
}

function resolveOpenClawRuntime() {
  const root = appRoot()
  const candidates = process.platform === 'win32'
    ? [
        resourcePath('openclaw', 'openclaw.cmd'),
        resourcePath('openclaw', 'openclaw.mjs'),
        path.join(root, 'vendor', 'openclaw', 'openclaw.cmd'),
        path.join(root, 'vendor', 'openclaw', 'openclaw.mjs'),
        ...releaseOpenClawRuntimeCandidates(root),
      ]
    : [
        resourcePath('openclaw', 'openclaw.mjs'),
        path.join(root, 'vendor', 'openclaw', 'openclaw.mjs'),
        ...releaseOpenClawRuntimeCandidates(root),
      ]
  return candidates
    .find((c) => fs.existsSync(c)) || ''
}

function resolveAppIcon() {
  return [
    resourcePath('icon.png'),
    path.join(appRoot(), 'build', 'icon-graphite.png'),
    path.join(appRoot(), 'build', 'icon.png'),
  ].find((c) => fs.existsSync(c))
}

function resolveOpenClawHomeDir() {
  const configured = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || ''
  if (configured && !normalizeForMatch(configured).includes('/openclaw-control-center/openclaw')) {
    return path.resolve(configured)
  }
  const homeDir = process.env.USERPROFILE || process.env.HOME || app.getPath('home')
  return path.join(homeDir, '.openclaw')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeForMatch(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

function powerShellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function runPowerShellJson(script, timeout = 10_000) {
  if (process.platform !== 'win32') return []
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`,
  ], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) return []
  return parseJsonOutput(result.stdout)
}

function pathEnvKey(env = process.env) {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
}

function splitPathEnv(value) {
  return String(value || '').split(path.delimiter).map((entry) => entry.trim()).filter(Boolean)
}

function prependProcessPath(dir) {
  if (!dir || !fs.existsSync(dir)) return
  const key = pathEnvKey(process.env)
  const existing = splitPathEnv(process.env[key])
  const normalized = path.resolve(dir).toLowerCase()
  process.env[key] = [dir, ...existing.filter((entry) => path.resolve(entry).toLowerCase() !== normalized)].join(path.delimiter)
}

function isExecutableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function findNpmOnPath() {
  const names = process.platform === 'win32' ? ['npm.cmd', 'npm.exe'] : ['npm']
  for (const dir of splitPathEnv(process.env[pathEnvKey(process.env)])) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return ''
}

function npmBinInNodeDir(nodeDir) {
  return process.platform === 'win32' ? path.join(nodeDir, 'npm.cmd') : path.join(nodeDir, 'bin', 'npm')
}

function nodeBinInNodeDir(nodeDir) {
  return process.platform === 'win32' ? path.join(nodeDir, 'node.exe') : path.join(nodeDir, 'bin', 'node')
}

function existingNpmBinInToolchainRoot(root) {
  if (!root || !fs.existsSync(root)) return ''
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^node-v\d+\.\d+\.\d+-win-(?:x64|arm64)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => isExecutableFile(npmBinInNodeDir(dir)) && isExecutableFile(nodeBinInNodeDir(dir)))
    .sort((a, b) => b.localeCompare(a))
    .map(npmBinInNodeDir)[0] || ''
}

function existingBundledNpmBin() {
  return existingNpmBinInToolchainRoot(BUNDLED_NPM_TOOLCHAIN_ROOT)
}

function existingManagedNpmBin() {
  return existingNpmBinInToolchainRoot(NPM_TOOLCHAIN_ROOT)
}

function requestBuffer(url, timeoutMs = 30_000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        resolve(requestBuffer(new URL(res.headers.location, url).toString(), timeoutMs, redirects - 1))
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} from ${url}`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

async function downloadFile(url, targetPath, timeoutMs = 180_000, redirects = 3) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  await new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        downloadFile(new URL(res.headers.location, url).toString(), targetPath, timeoutMs, redirects - 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} from ${url}`))
        return
      }
      const file = fs.createWriteStream(targetPath)
      file.on('error', reject)
      file.on('finish', () => file.close(resolve))
      res.pipe(file)
    })
    req.on('timeout', () => req.destroy(new Error(`download timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim())
  if (!match) return null
  return { raw: match[0].startsWith('v') ? match[0] : `v${match[0]}`, major: Number(match[1]), minor: Number(match[2]) }
}

function isSupportedNpmNodeVersion(version) {
  return version && (version.major > MIN_NPM_NODE_MAJOR || (version.major === MIN_NPM_NODE_MAJOR && version.minor >= MIN_NPM_NODE_MINOR))
}

async function resolveNodeToolchainVersion() {
  const raw = await requestBuffer('https://nodejs.org/dist/index.json')
  const releases = JSON.parse(raw.toString('utf8'))
  if (!Array.isArray(releases)) throw new Error('Node release index did not return a list.')
  for (const release of releases) {
    const version = parseNodeVersion(release?.version)
    if (isSupportedNpmNodeVersion(version) && Array.isArray(release.files) && release.files.includes('win-x64')) {
      return version.raw
    }
  }
  throw new Error(`No Node.js ${MIN_NPM_NODE_MAJOR}.${MIN_NPM_NODE_MINOR}+ win-x64 release found.`)
}

function expandZip(zipPath, destination) {
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const script = [
    '$ErrorActionPreference = "Stop"',
    `Expand-Archive -LiteralPath ${powerShellQuote(zipPath)} -DestinationPath ${powerShellQuote(destination)} -Force`,
  ].join('; ')
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `Expand-Archive exited ${result.status}`)
  }
}

async function installManagedNodeToolchain() {
  if (process.platform !== 'win32') throw new Error('automatic npm provisioning is only implemented for Windows desktop builds')
  const version = await resolveNodeToolchainVersion()
  const archiveName = `node-${version}-win-x64`
  const finalDir = path.join(NPM_TOOLCHAIN_ROOT, archiveName)
  const finalNpm = npmBinInNodeDir(finalDir)
  if (isExecutableFile(finalNpm) && isExecutableFile(nodeBinInNodeDir(finalDir))) return finalNpm

  const downloadsDir = path.join(NPM_TOOLCHAIN_ROOT, '.downloads')
  const extractDir = path.join(downloadsDir, `extract-${process.pid}-${Date.now()}`)
  const zipPath = path.join(downloadsDir, `${archiveName}.zip`)
  await downloadFile(`https://nodejs.org/dist/${version}/${archiveName}.zip`, zipPath)
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  expandZip(zipPath, extractDir)
  const extractedDir = path.join(extractDir, archiveName)
  if (!isExecutableFile(npmBinInNodeDir(extractedDir)) || !isExecutableFile(nodeBinInNodeDir(extractedDir))) {
    throw new Error(`downloaded Node.js archive did not contain npm.cmd`)
  }
  fs.mkdirSync(NPM_TOOLCHAIN_ROOT, { recursive: true })
  if (!fs.existsSync(finalDir)) fs.renameSync(extractedDir, finalDir)
  fs.rmSync(extractDir, { recursive: true, force: true })
  return finalNpm
}

async function ensureNpmToolchainAvailable() {
  if (process.env.DYSTOPAI_AUTO_INSTALL_NPM === '0') return
  const configured = process.env.DYSTOPAI_NPM_BIN || process.env.NPM_BIN || ''
  if (configured && isExecutableFile(configured)) {
    prependProcessPath(path.dirname(configured))
    return
  }
  const pathNpm = findNpmOnPath()
  if (pathNpm) return

  const bundled = existingBundledNpmBin()
  if (bundled) {
    prependProcessPath(path.dirname(bundled))
    process.env.DYSTOPAI_NPM_BIN = bundled
    return
  }

  const managed = existingManagedNpmBin()
  if (managed) {
    prependProcessPath(path.dirname(managed))
    process.env.DYSTOPAI_NPM_BIN = managed
    return
  }

  if (process.platform !== 'win32') return
  try {
    console.log('[dystopai] npm not found; provisioning app-local Node/npm toolchain...')
    const npmBin = await installManagedNodeToolchain()
    prependProcessPath(path.dirname(npmBin))
    process.env.DYSTOPAI_NPM_BIN = npmBin
    console.log('[dystopai] npm toolchain ready:', npmBin)
  } catch (err) {
    console.warn('[dystopai] automatic npm provisioning failed:', err?.message || err)
  }
}

function appOwnershipRoots() {
  return [
    appRoot(),
    process.resourcesPath,
    path.dirname(process.execPath),
    DYSTOPAI_USER_DATA_DIR,
    NPM_TOOLCHAIN_ROOT,
    resolveOpenClawHomeDir(),
  ]
    .filter(Boolean)
    .map((entry) => normalizeForMatch(path.resolve(entry)))
    .filter((entry, index, list) => entry && list.indexOf(entry) === index)
}

function isAppOwnedCommand(commandLine) {
  const command = normalizeForMatch(commandLine)
  return appOwnershipRoots().some((root) => command.includes(root))
}

function isManagedHelperCommand(commandLine) {
  const command = normalizeForMatch(commandLine)
  const openClawRuntime = (
    command.includes('/openclaw.mjs') ||
    command.includes('/openclaw.cmd') ||
    command.includes('/openclaw ')
  )
  const openClawManagedCommand = openClawRuntime && /\b(?:agent|browser|cron|gateway|openclaw-gateway|mcp|plugins?)\b/.test(command)
  return (
    command.includes('/dystopai.exe') ||
    command.includes('/vite/bin/vite.js') ||
    (command.includes('/tsx/dist/cli.mjs') && command.includes('server/index.ts')) ||
    (command.includes('/tsx/dist/loader.mjs') && command.includes('server/index.ts')) ||
    command.includes('/dist-server/index.cjs') ||
    openClawManagedCommand ||
    (command.includes('/node_modules/vite/node_modules/@esbuild/') && command.includes('--service'))
  )
}

function listManagedHelperProcesses() {
  if (process.platform === 'win32') {
    const rows = runPowerShellJson(`
      @(Get-CimInstance Win32_Process |
        Where-Object {
          $_.CommandLine -and (
            $_.CommandLine -match 'vite\\\\bin\\\\vite\\.js' -or
            $_.CommandLine -match 'server/index\\.ts' -or
            $_.CommandLine -match 'dist-server[\\\\/]index\\.cjs' -or
            $_.CommandLine -match 'DystopAI\\.exe' -or
            $_.CommandLine -match 'openclaw\\.(?:mjs|cmd).*gateway' -or
            $_.CommandLine -match 'openclaw\\.(?:mjs|cmd).*(?:agent|browser|cron|mcp|plugins?)' -or
            $_.CommandLine -match 'esbuild\\.exe --service'
          )
        } |
        Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}}) |
        ConvertTo-Json -Depth 3 -Compress
    `)
    return rows
      .map((row) => ({ pid: Number(row.pid), commandLine: String(row.commandLine || '') }))
      .filter((row) => Number.isFinite(row.pid))
  }

  const result = spawnSync('sh', ['-c', "ps -axo pid=,command= | grep -E 'DystopAI\\.exe|vite/bin/vite\\.js|server/index\\.(ts|cjs)|openclaw\\.(mjs|cmd).*(agent|browser|cron|gateway|mcp|plugins?)|esbuild.*--service' | grep -v grep"], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error || result.status > 1) return []
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([\s\S]+)$/)
      return match ? { pid: Number(match[1]), commandLine: match[2] } : null
    })
    .filter(Boolean)
}

function listListeningProcesses(ports) {
  const uniquePorts = Array.from(new Set(ports.map((port) => Number(port)).filter(Number.isFinite)))
  if (!uniquePorts.length) return []

  if (process.platform === 'win32') {
    const portList = uniquePorts.join(',')
    return runPowerShellJson(`
      $ports = @(${portList});
      @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $ports -contains [int]$_.LocalPort } |
        Select-Object @{Name='port';Expression={$_.LocalPort}}, @{Name='pid';Expression={$_.OwningProcess}}) |
        ConvertTo-Json -Depth 3 -Compress
    `)
      .map((row) => ({ port: Number(row.port), pid: Number(row.pid) }))
      .filter((row) => Number.isFinite(row.port) && Number.isFinite(row.pid))
  }

  const rows = []
  for (const port of uniquePorts) {
    const result = spawnSync('sh', ['-c', `command -v lsof >/dev/null 2>&1 && lsof -tiTCP:${port} -sTCP:LISTEN || true`], {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.error) continue
    for (const pid of String(result.stdout || '').split(/\s+/).filter(Boolean)) {
      rows.push({ port, pid: Number(pid) })
    }
  }
  return rows.filter((row) => Number.isFinite(row.pid))
}

function listProcessDetails(pids) {
  const uniquePids = Array.from(new Set(pids.map((pid) => Number(pid)).filter(Number.isFinite)))
  if (!uniquePids.length) return []

  if (process.platform === 'win32') {
    return runPowerShellJson(`
      $ids = @(${uniquePids.join(',')});
      @(Get-CimInstance Win32_Process |
        Where-Object { $ids -contains [int]$_.ProcessId } |
        Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}}) |
        ConvertTo-Json -Depth 3 -Compress
    `)
      .map((row) => ({ pid: Number(row.pid), commandLine: String(row.commandLine || '') }))
      .filter((row) => Number.isFinite(row.pid))
  }

  const result = spawnSync('ps', ['-o', 'pid=', '-o', 'command=', '-p', uniquePids.join(',')], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error || result.status !== 0) return []
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([\s\S]+)$/)
      return match ? { pid: Number(match[1]), commandLine: match[2] } : null
    })
    .filter(Boolean)
}

function listDescendantProcesses(rootPid = process.pid) {
  const root = Number(rootPid)
  if (!Number.isFinite(root) || root <= 0) return []

  if (process.platform === 'win32') {
    return runPowerShellJson(`
      $root = ${Math.trunc(root)};
      $all = @(Get-CimInstance Win32_Process |
        Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='parentPid';Expression={$_.ParentProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}})
      $pending = @($root);
      $seen = @{};
      $out = @();
      while ($pending.Count -gt 0) {
        $next = @();
        foreach ($parent in $pending) {
          foreach ($proc in @($all | Where-Object { [int]$_.parentPid -eq [int]$parent })) {
            $key = [string]$proc.pid;
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true;
            $out += $proc;
            $next += [int]$proc.pid;
          }
        }
        $pending = $next;
      }
      @($out) | ConvertTo-Json -Depth 3 -Compress
    `)
      .map((row) => ({ pid: Number(row.pid), commandLine: String(row.commandLine || '') }))
      .filter((row) => Number.isFinite(row.pid))
  }

  const result = spawnSync('ps', ['-axo', 'pid=', '-o', 'ppid=', '-o', 'command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error || result.status !== 0) return []

  const rows = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([\s\S]+)$/)
      return match ? { pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] } : null
    })
    .filter(Boolean)
  const childrenByParent = new Map()
  for (const row of rows) {
    if (!childrenByParent.has(row.parentPid)) childrenByParent.set(row.parentPid, [])
    childrenByParent.get(row.parentPid).push(row)
  }
  const descendants = []
  const queue = [root]
  const seen = new Set()
  while (queue.length) {
    const parent = queue.shift()
    for (const child of childrenByParent.get(parent) || []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      descendants.push({ pid: child.pid, commandLine: child.commandLine })
      queue.push(child.pid)
    }
  }
  return descendants
}

function killProcessTree(pid, reason) {
  const id = Number(pid)
  if (!Number.isFinite(id) || id === process.pid) return false
  console.log(`[dystopai] stopping app-owned process pid=${id}: ${reason}`)
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', String(id), '/t', '/f'], {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    })
    return !result.error
  }

  try {
    process.kill(-id, 'SIGTERM')
  } catch {
    try { process.kill(id, 'SIGTERM') } catch { return false }
  }
  return true
}

async function cleanupAppOwnedHelpers(reason) {
  const helpers = listManagedHelperProcesses()
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => isAppOwnedCommand(entry.commandLine) && isManagedHelperCommand(entry.commandLine))

  const listeners = listListeningProcesses(MANAGED_PORTS)
  const listenerDetails = listProcessDetails(listeners.map((entry) => entry.pid))
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => isAppOwnedCommand(entry.commandLine) && isManagedHelperCommand(entry.commandLine))

  const descendants = listDescendantProcesses(process.pid)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => isAppOwnedCommand(entry.commandLine) && isManagedHelperCommand(entry.commandLine))

  const byPid = new Map()
  for (const entry of [...helpers, ...listenerDetails, ...descendants]) byPid.set(entry.pid, entry)
  const targets = Array.from(byPid.values()).sort((a, b) => a.pid - b.pid)

  for (const target of targets) {
    killProcessTree(target.pid, reason)
  }
  if (targets.length) await sleep(1200)
  return targets.length
}

async function ensurePortAvailable(port, label, reason = 'port repair') {
  let listeners = listListeningProcesses([port]).filter((entry) => entry.pid !== process.pid)
  if (!listeners.length) return

  const details = listProcessDetails(listeners.map((entry) => entry.pid))
  const appOwned = details.filter((entry) => isAppOwnedCommand(entry.commandLine) && isManagedHelperCommand(entry.commandLine))
  if (appOwned.length && appOwned.length === details.length) {
    for (const entry of appOwned) killProcessTree(entry.pid, `${reason}: ${label} port ${port} was held by stale app helper`)
    await sleep(1200)
    listeners = listListeningProcesses([port]).filter((entry) => entry.pid !== process.pid)
    if (!listeners.length) return
  }

  const blockers = listProcessDetails(listeners.map((entry) => entry.pid))
    .map((entry) => `PID ${entry.pid}: ${entry.commandLine || 'unknown command'}`)
    .join('\n')
  throw new Error(`${label} port ${port} is already in use by a process this app does not own.\n${blockers || 'Unknown owner.'}`)
}

async function prepareManagedPortsForStartup() {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await cleanupAppOwnedHelpers(`startup cleanup attempt ${attempt}`)
      await ensurePortAvailable(APP_PORT, 'Control Center API', `startup repair attempt ${attempt}`)
      await ensurePortAvailable(GATEWAY_PORT, 'OpenClaw Gateway', `startup repair attempt ${attempt}`)
      return
    } catch (err) {
      lastError = err
      if (!/this app does not own/i.test(String(err?.message || err))) {
        await sleep(500)
        continue
      }
      throw err
    }
  }
  throw lastError || new Error('Control Center API port repair failed.')
}

function createTrayIcon() {
  const iconPath = resolveAppIcon()
  if (!iconPath) return nativeImage.createEmpty()
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty() || process.platform !== 'win32') return image
  return image.resize({ width: 16, height: 16 })
}

function appendGatewayLog(stream, text) {
  const logPath = process.env.OPENCLAW_GATEWAY_LOG_PATH
  if (!logPath || !text) return
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const lines = String(text).replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length) return
    const body = lines.map((line) => `[${new Date().toISOString()}] [${stream}] ${line}`).join('\n') + '\n'
    fs.appendFileSync(logPath, body, 'utf-8')
  } catch {
    // Logging must never block app startup.
  }
}

async function startGateway() {
  appendGatewayLog('lifecycle', `gateway start requested through control API on port ${GATEWAY_PORT}`)
  try {
    await postControlApi('/api/openclaw/runtime/gateway/restart', 15_000)
  } catch (err) {
    appendGatewayLog('lifecycle', `gateway API start failed: ${err.message}`)
    throw err
  } finally {
    updateTrayMenu()
  }
}

function postControlApi(pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: APP_PORT,
      path: pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '2',
        Authorization: `Bearer ${ensureControlCenterLaunchToken()}`,
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body)
        } else {
          reject(new Error(`HTTP ${res.statusCode || 'unknown'} ${body}`))
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    req.end('{}')
  })
}

function waitForControlServer(timeoutMs = 15_000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: APP_PORT,
        path: '/',
        method: 'GET',
        timeout: 750,
      }, (res) => {
        res.resume()
        resolve()
      })
      req.on('timeout', () => {
        req.destroy(new Error('control server probe timed out'))
      })
      req.on('error', (err) => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Control Center API did not become ready on port ${APP_PORT}: ${err.message}`))
          return
        }
        setTimeout(check, 250)
      })
      req.end()
    }
    check()
  })
}

function pipeServerOutput(stream, chunk) {
  const text = String(chunk || '').replace(/\r/g, '')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const message = `[dystopai-server:${stream}] ${line}`
    if (stream === 'stderr') console.warn(message)
    else console.log(message)
  }
}

function scheduleControlServerRestart(reason) {
  if (isQuitting || startupFailed || startingUp || serverRestartTimer || !controlServerEntry) return

  serverRestartAttempts += 1
  const delay = Math.min(
    SERVER_RESTART_MAX_DELAY_MS,
    SERVER_RESTART_BASE_DELAY_MS * Math.max(1, serverRestartAttempts),
  )
  console.warn(`[dystopai] restarting API server in ${delay}ms: ${reason}`)
  serverRestartTimer = setTimeout(async () => {
    serverRestartTimer = null
    if (isQuitting || startupFailed || startingUp || !controlServerEntry) return
    try {
      const child = startControlServerProcess(controlServerEntry)
      await waitForSpawnedControlServer(child)
      serverRestartAttempts = 0
      console.log('[dystopai] API server restarted on port', APP_PORT)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache()
      }
      updateTrayMenu()
    } catch (error) {
      console.error('[dystopai] API server restart failed:', error?.message || error)
      scheduleControlServerRestart('previous restart attempt failed')
    }
  }, delay)
  serverRestartTimer.unref?.()
}

function startControlServerProcess(serverEntry) {
  if (serverProcess?.pid && serverProcess.exitCode === null && !serverProcess.killed) {
    return serverProcess
  }

  controlServerEntry = serverEntry
  const pipeLogs = isDev || process.env.DYSTOPAI_PIPE_SERVER_LOGS === '1'
  const child = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(process.execPath),
    env: {
      ...process.env,
      CONTROL_CENTER_EXIT_ON_PORT_ERROR: process.env.CONTROL_CENTER_EXIT_ON_PORT_ERROR || '1',
      DYSTOPAI_DESKTOP_SERVER_CHILD: '1',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: pipeLogs ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    windowsHide: true,
  })

  serverProcess = child
  child.stdout?.on('data', (chunk) => pipeServerOutput('stdout', chunk))
  child.stderr?.on('data', (chunk) => pipeServerOutput('stderr', chunk))
  child.once('error', (error) => {
    if (serverProcess === child) serverProcess = null
    console.error('[dystopai] API server process error:', error?.message || error)
  })
  child.once('exit', (code, signal) => {
    if (serverProcess === child) serverProcess = null
    if (!isQuitting && !startupFailed && !startingUp) {
      const reason = `unexpected exit (code=${code ?? 'unknown'}, signal=${signal || 'none'})`
      console.error(`[dystopai] API server ${reason}`)
      scheduleControlServerRestart(reason)
    }
  })

  return child
}

function waitForSpawnedControlServer(child, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const onExit = (code, signal) => {
      settle(reject, new Error(`Control Center API exited before it was ready (code=${code ?? 'unknown'}, signal=${signal || 'none'}).`))
    }
    const onError = (error) => {
      settle(reject, error instanceof Error ? error : new Error(String(error)))
    }

    child.once('exit', onExit)
    child.once('error', onError)
    waitForControlServer(timeoutMs).then(
      () => settle(resolve),
      (error) => settle(reject, error),
    )
  })
}

function waitForProcessExit(child, timeoutMs = 2000) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    child.once('exit', onExit)
  })
}

async function stopControlServerProcess(reason = 'control server cleanup') {
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer)
    serverRestartTimer = null
  }
  const child = serverProcess
  if (!child?.pid) {
    serverProcess = null
    return
  }

  const pid = child.pid
  serverProcess = null
  console.log(`[dystopai] stopping API server pid=${pid}: ${reason}`)

  if (process.platform !== 'win32') {
    try {
      child.kill('SIGTERM')
    } catch {
      // Process may have already exited after the shutdown API completed.
    }
    if (await waitForProcessExit(child, 2000)) return
  }

  killProcessTree(pid, reason)
  await waitForProcessExit(child, 1000)
}

function forceKillSpawnedGateway() {
  const child = gatewayProcess
  if (!child?.pid) {
    gatewayProcess = null
    return Promise.resolve()
  }

  const pid = child.pid
  appendGatewayLog('lifecycle', `force stopping spawned gateway pid=${pid}`)
  gatewayProcess = null

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
      return
    }

    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try { child.kill('SIGTERM') } catch {}
    }
    setTimeout(resolve, 500)
  })
}

async function stopGatewayCompletely() {
  if (gatewayShutdownInFlight) return gatewayShutdownInFlight
  gatewayShutdownInFlight = Promise.resolve().then(async () => {
    updateTrayMenu()
    appendGatewayLog('lifecycle', 'tray requested complete gateway shutdown')
    try {
      await postControlApi('/api/openclaw/runtime/gateway/stop', 7000)
    } catch (err) {
      appendGatewayLog('lifecycle', `gateway API stop failed: ${err.message}`)
    }
    await forceKillSpawnedGateway()
    updateTrayMenu()
  }).finally(() => {
    gatewayShutdownInFlight = null
  })
  return gatewayShutdownInFlight
}

async function stopRuntimeCompletelyForQuit() {
  appendGatewayLog('lifecycle', 'tray requested complete runtime shutdown')
  let runtimeShutdownOk = false
  try {
    await postControlApi('/api/openclaw/runtime/shutdown', 20_000)
    runtimeShutdownOk = true
  } catch (err) {
    appendGatewayLog('lifecycle', `runtime shutdown API failed: ${err?.message || err}`)
  }
  if (!runtimeShutdownOk) await stopGatewayCompletely()
  await stopControlServerProcess('desktop quit')
}

async function resetGateway() {
  if (gatewayResetInFlight) return gatewayResetInFlight
  gatewayResetInFlight = Promise.resolve().then(async () => {
    updateTrayMenu()
    appendGatewayLog('lifecycle', 'tray requested gateway reset')
    await startGateway()
    updateTrayMenu()
  }).finally(() => {
    gatewayResetInFlight = null
    updateTrayMenu()
  })
  return gatewayResetInFlight
}

async function performQuitCleanup() {
  if (quitCleanupInFlight) return quitCleanupInFlight
  isQuitting = true
  updateTrayMenu()
  quitCleanupInFlight = Promise.resolve().then(async () => {
    try {
      await stopRuntimeCompletelyForQuit()
    } catch (err) {
      console.warn('[dystopai] runtime cleanup failed:', err?.message || err)
    }
    try {
      await cleanupAppOwnedHelpers('quit cleanup')
      await sleep(500)
      await cleanupAppOwnedHelpers('quit cleanup final sweep')
    } catch (err) {
      console.warn('[dystopai] helper cleanup failed:', err?.message || err)
    }
    quitCleanupComplete = true
  }).finally(() => {
    quitCleanupInFlight = null
    updateTrayMenu()
  })
  return quitCleanupInFlight
}

function configureTextAssistance(win) {
  try {
    win.webContents.session.setSpellCheckerLanguages(['en-US'])
  } catch (err) {
    console.warn('[dystopai] spellchecker language setup failed:', err?.message || err)
  }

  win.webContents.on('context-menu', (_event, params) => {
    /** @type {import('electron').MenuItemConstructorOptions[]} */
    const template = []
    const editFlags = params.editFlags || {}
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim())

    if (params.isEditable) {
      const suggestions = Array.isArray(params.dictionarySuggestions)
        ? params.dictionarySuggestions.slice(0, 6)
        : []

      if (params.misspelledWord) {
        if (suggestions.length) {
          for (const suggestion of suggestions) {
            template.push({
              label: suggestion,
              click: () => win.webContents.replaceMisspelling(suggestion),
            })
          }
        } else {
          template.push({ label: 'No spelling suggestions', enabled: false })
        }

        template.push({
          label: 'Learn Spelling',
          click: () => {
            try {
              win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            } catch (err) {
              console.warn('[dystopai] add spelling dictionary word failed:', err?.message || err)
            }
          },
        })
        template.push({ type: 'separator' })
      }

      template.push(
        { role: 'undo', enabled: Boolean(editFlags.canUndo) },
        { role: 'redo', enabled: Boolean(editFlags.canRedo) },
        { type: 'separator' },
        { role: 'cut', enabled: Boolean(editFlags.canCut) },
        { role: 'copy', enabled: Boolean(editFlags.canCopy || hasSelection) },
        { role: 'paste', enabled: Boolean(editFlags.canPaste) },
        { type: 'separator' },
        { role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) },
      )
    } else if (hasSelection) {
      template.push({ role: 'copy', enabled: true })
    }

    if (isDev) {
      if (template.length) template.push({ type: 'separator' })
      template.push({
        label: 'Inspect Element',
        click: () => win.webContents.inspectElement(params.x, params.y),
      })
    }

    if (!template.length) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1100, minHeight: 720,
    backgroundColor: '#050607', title: 'DystopAI', show: false,
    ...(resolveAppIcon() ? { icon: resolveAppIcon() } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  })

  mainWindow = win
  configureTextAssistance(win)

  win.on('unresponsive', () => {
    console.warn('[dystopai] renderer became unresponsive')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[dystopai] renderer process gone:', details)
    if (isQuitting || win.isDestroyed()) return
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload()
    }, 750)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalAppUrl(url)) return
    event.preventDefault()
    openAllowedExternalUrl(url)
  })

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
    win.setSkipTaskbar(true)
    updateTrayMenu()
  })
  win.on('show', () => {
    win.setSkipTaskbar(false)
    updateTrayMenu()
  })
  win.on('hide', updateTrayMenu)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    updateTrayMenu()
  })
  win.once('ready-to-show', () => {
    if (!isQuitting) win.show()
  })
  win.loadURL(`http://127.0.0.1:${APP_PORT}`)
  return win
}

function openFrontend() {
  if (startupFailed || startingUp || isQuitting) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }
  mainWindow.setSkipTaskbar(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  updateTrayMenu()
}

function hideFrontend() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  mainWindow.setSkipTaskbar(true)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  const gatewayBusy = Boolean(gatewayShutdownInFlight || gatewayResetInFlight)
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  const uiLabel = windowVisible ? 'Hide UI' : 'Show UI'
  const resetLabel = gatewayResetInFlight ? 'Restarting Gateway...' : 'Restart Gateway'
  const shutdownLabel = gatewayShutdownInFlight && !isQuitting ? 'Shutting Gateway Off...' : 'Shut Gateway Off'
  const exitLabel = isQuitting ? 'Exiting Everything...' : 'Exit Everything'
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: uiLabel,
      click: windowVisible ? hideFrontend : openFrontend,
    },
    { type: 'separator' },
    {
      label: resetLabel,
      enabled: !gatewayBusy,
      click: () => {
        void resetGateway()
      },
    },
    {
      label: shutdownLabel,
      enabled: !gatewayBusy,
      click: () => {
        void stopGatewayCompletely()
      },
    },
    { type: 'separator' },
    {
      label: exitLabel,
      enabled: !gatewayBusy,
      click: async () => {
        isQuitting = true
        updateTrayMenu()
        await performQuitCleanup()
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.close()
        }
        app.exit(0)
      },
    },
  ]))
}

function createTray() {
  if (tray) return tray
  tray = new Tray(createTrayIcon())
  tray.setToolTip('DystopAI - gateway running in background')
  tray.on('click', openFrontend)
  tray.on('double-click', openFrontend)
  updateTrayMenu()
  return tray
}

function isInternalAppUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    const host = parsed.hostname.toLowerCase()
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    return (
      (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') &&
      (port === APP_PORT || port === DEV_FRONTEND_PORT)
    )
  } catch {
    return false
  }
}

function shouldOpenExternally(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    return parsed.protocol === 'https:' && !isInternalAppUrl(targetUrl)
  } catch {
    return false
  }
}

function openAllowedExternalUrl(targetUrl) {
  if (!shouldOpenExternally(targetUrl)) return false
  void shell.openExternal(targetUrl).catch((error) => {
    console.warn('[dystopai] failed to open external URL:', error?.message || error)
  })
  return true
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  if (startingUp || startupFailed) return
  startingUp = true

  try {
    // Set env vars before launching the server child process.
    const staticDir = resolveStaticDir()
    const openclawStateDir = resolveOpenClawHomeDir()
    const workspaceRoot = process.env.CONTROL_CENTER_WORKSPACE_ROOT || path.join(openclawStateDir, 'workspace')
    const openclawRuntime = resolveOpenClawRuntime()

    fs.mkdirSync(openclawStateDir, { recursive: true })
    fs.mkdirSync(workspaceRoot, { recursive: true })

    process.env.CONTROL_CENTER_PORT = String(APP_PORT)
    process.env.CONTROL_CENTER_APP_ROOT = appRoot()
    process.env.CONTROL_CENTER_STATIC_DIR = staticDir
    process.env.CONTROL_CENTER_WORKSPACE_ROOT = workspaceRoot
    ensureControlCenterLaunchToken()
    process.env.OPENCLAW_GATEWAY_PORT = String(GATEWAY_PORT)
    process.env.OPENCLAW_STATE_DIR = openclawStateDir
    process.env.OPENCLAW_HOME = openclawStateDir
    process.env.OPENCLAW_CONFIG_PATH = path.join(openclawStateDir, 'openclaw.json')
    process.env.OPENCLAW_GATEWAY_LOG_PATH = path.join(openclawStateDir, 'gateway.log')
    process.env.CONTROL_CENTER_AUTOSTART_GATEWAY = process.env.CONTROL_CENTER_AUTOSTART_GATEWAY || '1'
    if (openclawRuntime) process.env.OPENCLAW_BIN = openclawRuntime

    await ensureNpmToolchainAvailable()
    await prepareManagedPortsForStartup()

    const serverEntry = resolveServerEntry()
    console.log('[dystopai] starting server process:', serverEntry)

    // Keep backend work out of Electron's main process so the desktop UI stays responsive.
    const serverChild = startControlServerProcess(serverEntry)
    await waitForSpawnedControlServer(serverChild)
    serverRestartAttempts = 0

    console.log('[dystopai] server ready on port', APP_PORT)

    createTray()

  } catch (err) {
    startupFailed = true
    startingUp = false
    await stopControlServerProcess('startup failure').catch((cleanupError) => {
      console.warn('[dystopai] startup failure cleanup skipped:', cleanupError?.message || cleanupError)
    })
    dialog.showErrorBox('DystopAI — Startup Error', String(err))
    app.quit()
    return
  }

  try {
    createMainWindow()
    startingUp = false
  } catch (err) {
    startupFailed = true
    startingUp = false
    await stopRuntimeCompletelyForQuit().catch((cleanupError) => {
      console.warn('[dystopai] UI failure cleanup skipped:', cleanupError?.message || cleanupError)
    })
    dialog.showErrorBox('DystopAI — UI Error', String(err))
    app.quit()
  }
})

app.on('activate', () => {
  if (startupFailed || startingUp) return
  try {
    openFrontend()
  } catch (err) {
    startupFailed = true
    dialog.showErrorBox('DystopAI', String(err))
    app.quit()
  }
})

app.on('second-instance', () => {
  if (startupFailed || startingUp) return
  openFrontend()
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (quitCleanupComplete || startupFailed) return
  event.preventDefault()
  void performQuitCleanup().finally(() => {
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  // Keep the desktop process alive so the tray can restore the UI or stop the gateway.
})

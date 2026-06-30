const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const http = require('node:http')
const { randomBytes } = require('node:crypto')
const { assertTrustedHttpsUrl, parseSha256Manifest, sha256File } = require('./runtime-download-security.cjs')
const path = require('node:path')

const APP_PORT = Number(process.env.CONTROL_CENTER_PORT || 4050)
const DEV_FRONTEND_PORT = Number(process.env.CONTROL_CENTER_FRONTEND_PORT || 5173)
const GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789)
const BROWSER_RELAY_PORT = Number(process.env.OPENCLAW_BROWSER_RELAY_PORT || 18792)
const CONTROL_SERVER_STARTUP_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.CONTROL_CENTER_STARTUP_TIMEOUT_MS || 180_000) || 180_000,
)
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
const CONTROL_CENTER_TOKEN_FILE = path.resolve(
  process.env.DYSTOPAI_CONTROL_CENTER_TOKEN_FILE || path.join(DYSTOPAI_USER_DATA_DIR, 'auth', 'control-center-token.json'),
)
const CONTROL_CENTER_TOKEN_HELP_FILE = path.join(path.dirname(CONTROL_CENTER_TOKEN_FILE), 'README.txt')
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
const ELECTRON_E2E = process.env.DYSTOPAI_ELECTRON_E2E === '1'
const ELECTRON_E2E_AUTO_QUIT_MS = Math.max(0, Number(process.env.DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS || 0) || 0)
const WSLG_RUNTIME = process.platform === 'linux' && (
  Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) ||
  fs.existsSync('/mnt/wslg')
)
const TRAY_ENABLED = process.env.DYSTOPAI_DISABLE_TRAY !== '1' &&
  (!WSLG_RUNTIME || process.env.DYSTOPAI_ENABLE_WSLG_TRAY === '1')
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
let lastTrayMenuSnapshot = []
const SERVER_RESTART_BASE_DELAY_MS = 1000
const SERVER_RESTART_MAX_DELAY_MS = 10_000

function logE2e(message) {
  if (!ELECTRON_E2E) return
  const line = `[dystopai-e2e] ${message}`
  console.log(line)
  const logPath = process.env.DYSTOPAI_ELECTRON_E2E_LOG_PATH
  if (!logPath) return
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `${line}\n`, 'utf8')
  } catch {
    // E2E logging should not alter app behavior.
  }
}

function showBlockingError(title, message) {
  if (ELECTRON_E2E) {
    logE2e(`${title}: ${message}`)
    return
  }
  dialog.showErrorBox(title, message)
}

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
  if (!event?.sender || !mainWindow || mainWindow.isDestroyed()) return false
  if (event.sender !== mainWindow.webContents) return false
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) return false
  const frameUrl = event.senderFrame?.url || event.sender.getURL?.() || ''
  try {
    const parsed = new URL(frameUrl)
    return parsed.origin === controlCenterOrigin() || (isDev && parsed.origin === `http://localhost:${DEV_FRONTEND_PORT}`)
  } catch {
    return false
  }
}

function normalizePersistedControlCenterToken(value) {
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token || token.length < 16 || token.length > 512) return ''
  if (/[\0\r\n]/.test(token)) return ''
  return token
}

function readControlCenterTokenFile() {
  try {
    if (!fs.existsSync(CONTROL_CENTER_TOKEN_FILE)) return ''
    const raw = fs.readFileSync(CONTROL_CENTER_TOKEN_FILE, 'utf8')
    const trimmed = raw.trim()
    if (!trimmed) {
      quarantineInvalidControlCenterTokenFile('empty token file')
      return ''
    }
    const candidate = trimmed.startsWith('{') ? JSON.parse(trimmed)?.token : trimmed
    const token = normalizePersistedControlCenterToken(candidate)
    if (token) return token
    quarantineInvalidControlCenterTokenFile('token must be 16-512 characters with no line breaks')
  } catch (error) {
    quarantineInvalidControlCenterTokenFile(error?.message || String(error))
  }
  return ''
}

function quarantineInvalidControlCenterTokenFile(reason) {
  try {
    if (!fs.existsSync(CONTROL_CENTER_TOKEN_FILE)) return
    const suffix = new Date().toISOString().replace(/[:.]/g, '-')
    const invalidPath = `${CONTROL_CENTER_TOKEN_FILE}.invalid-${suffix}`
    fs.renameSync(CONTROL_CENTER_TOKEN_FILE, invalidPath)
    console.warn(`[dystopai] Ignored invalid saved Control Center token (${reason}). Moved it to: ${invalidPath}`)
  } catch (error) {
    console.warn(`[dystopai] Ignored invalid saved Control Center token (${reason}); could not move it aside: ${error?.message || error}`)
  }
}

function writeControlCenterTokenHelpFile() {
  const body = [
    'DystopAI Control Center local token',
    '',
    'This folder stores the desktop launch token for the local Control Center API on 127.0.0.1.',
    'Electron keeps this long-lived token in the main process and uses it to mint short session tokens for the app window.',
    'The preload layer and web page do not receive the long-lived token.',
    '',
    'To choose your own token, close DystopAI and edit the "token" field in control-center-token.json.',
    'Use a long random value with no line breaks. If the token file is deleted or invalid, DystopAI creates a fresh local token on the next start.',
    '',
  ].join('\n')
  try {
    fs.mkdirSync(path.dirname(CONTROL_CENTER_TOKEN_HELP_FILE), { recursive: true })
    fs.writeFileSync(CONTROL_CENTER_TOKEN_HELP_FILE, body, { encoding: 'utf8', mode: 0o600 })
    try { fs.chmodSync(CONTROL_CENTER_TOKEN_HELP_FILE, 0o600) } catch {}
  } catch (error) {
    console.warn('[dystopai] could not write Control Center token help file:', error?.message || error)
  }
}

function writeControlCenterTokenFile(token, source = 'generated') {
  const payload = JSON.stringify({
    token,
    source,
    createdAt: new Date().toISOString(),
    scope: 'local-control-center',
  }, null, 2) + '\n'
  const dir = path.dirname(CONTROL_CENTER_TOKEN_FILE)
  const tempPath = path.join(dir, `.control-center-token-${process.pid}-${Date.now()}.tmp`)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 })
    try { fs.chmodSync(tempPath, 0o600) } catch {}
    fs.renameSync(tempPath, CONTROL_CENTER_TOKEN_FILE)
    try { fs.chmodSync(CONTROL_CENTER_TOKEN_FILE, 0o600) } catch {}
    writeControlCenterTokenHelpFile()
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }) } catch {}
    console.warn('[dystopai] could not persist Control Center token; this run will continue with an in-memory token:', error?.message || error)
  }
}

function ensureControlCenterLaunchToken() {
  if (!controlCenterLaunchToken) {
    const configuredToken = typeof process.env.CONTROL_CENTER_TOKEN === 'string' ? process.env.CONTROL_CENTER_TOKEN.trim() : ''
    if (configuredToken) {
      controlCenterLaunchToken = configuredToken
    } else {
      controlCenterLaunchToken = readControlCenterTokenFile()
    }
    if (controlCenterLaunchToken && !configuredToken) {
      writeControlCenterTokenHelpFile()
    }
    if (!controlCenterLaunchToken) {
      controlCenterLaunchToken = randomBytes(32).toString('base64url')
      writeControlCenterTokenFile(controlCenterLaunchToken)
    }
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

ipcMain.handle('dystopai:bootstrap-control-center-session', async (event) => {
  if (!isTrustedRendererSender(event)) return null
  try {
    return await bootstrapControlCenterSession()
  } catch (error) {
    console.warn('[dystopai] desktop session bootstrap failed:', error?.message || error)
    return null
  }
})

function resolveServerEntry() {
  if (process.env.DYSTOPAI_ELECTRON_E2E_FORCE_MISSING_SERVER === '1') {
    throw new Error('E2E forced missing server')
  }
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

function safeRuntimeSegment(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown'
}

function packagedOpenClawRuntimeStamp(root) {
  const packageJson = path.join(root, 'package.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
    const stat = fs.statSync(packageJson)
    return [
      safeRuntimeSegment(parsed?.name || 'openclaw'),
      safeRuntimeSegment(parsed?.version || 'unknown'),
      `${Math.trunc(stat.mtimeMs)}-${stat.size}`,
    ].join('-')
  } catch {
    try {
      const stat = fs.statSync(root)
      return `openclaw-unknown-${Math.trunc(stat.mtimeMs)}-${stat.size}`
    } catch {
      return 'openclaw-unknown'
    }
  }
}

function ensureWritablePackagedOpenClawRuntime(bundledRuntime) {
  if (
    isDev ||
    !bundledRuntime ||
    process.platform === 'win32' ||
    process.env.DYSTOPAI_ENABLE_WRITABLE_OPENCLAW_RUNTIME !== '1'
  ) return bundledRuntime
  const bundledRoot = path.dirname(path.resolve(bundledRuntime))
  const required = [
    bundledRuntime,
    path.join(bundledRoot, 'package.json'),
    path.join(bundledRoot, 'dist'),
  ]
  if (!required.every((candidate) => fs.existsSync(candidate))) return bundledRuntime

  const stamp = packagedOpenClawRuntimeStamp(bundledRoot)
  const targetRoot = path.join(DYSTOPAI_USER_DATA_DIR, 'runtimes', 'openclaw', stamp)
  const targetRuntime = path.join(targetRoot, path.basename(bundledRuntime))
  const readyMarker = path.join(targetRoot, '.dystopai-runtime-ready')
  if (fs.existsSync(targetRuntime) && fs.existsSync(readyMarker)) return targetRuntime

  const parent = path.dirname(targetRoot)
  const tempRoot = path.join(parent, `.${path.basename(targetRoot)}.tmp-${process.pid}-${Date.now()}`)
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true })
    fs.mkdirSync(parent, { recursive: true })
    fs.mkdirSync(tempRoot, { recursive: true })
    for (const entry of fs.readdirSync(bundledRoot, { withFileTypes: true })) {
      const source = path.join(bundledRoot, entry.name)
      const target = path.join(tempRoot, entry.name)
      if (entry.name === 'dist') {
        fs.cpSync(source, target, { recursive: true, force: true })
      } else {
        fs.symlinkSync(source, target, entry.isDirectory() ? 'dir' : 'file')
      }
    }
    for (const candidate of openClawRuntimeCandidatesForDir(tempRoot)) {
      if (!fs.existsSync(candidate)) continue
      try {
        fs.chmodSync(candidate, 0o755)
      } catch {}
    }
    fs.writeFileSync(path.join(tempRoot, '.dystopai-runtime-ready'), `${new Date().toISOString()}\n`, 'utf8')
    fs.rmSync(targetRoot, { recursive: true, force: true })
    fs.renameSync(tempRoot, targetRoot)
    console.log(`[dystopai] hydrated writable OpenClaw runtime -> ${targetRoot}`)
    return targetRuntime
  } catch (error) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {}
    console.warn('[dystopai] writable OpenClaw runtime hydration failed:', error?.message || error)
    return bundledRuntime
  }
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
  const found = candidates.find((c) => fs.existsSync(c)) || ''
  return ensureWritablePackagedOpenClawRuntime(found)
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

const NODE_DOWNLOAD_HOSTS = ['nodejs.org']
const NODE_METADATA_MAX_BYTES = 5 * 1024 * 1024

function trustedNodeDownloadUrl(url) {
  return assertTrustedHttpsUrl(url, NODE_DOWNLOAD_HOSTS)
}

function requestBuffer(url, timeoutMs = 30_000, redirects = 3, maxBytes = NODE_METADATA_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = trustedNodeDownloadUrl(url)
    } catch (error) {
      reject(error)
      return
    }
    const req = https.get(parsed, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const redirected = new URL(res.headers.location, parsed)
        requestBuffer(redirected, timeoutMs, redirects - 1, maxBytes).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} from ${parsed.href}`))
        return
      }
      const chunks = []
      let totalBytes = 0
      res.on('data', (chunk) => {
        const bytes = Buffer.from(chunk)
        totalBytes += bytes.length
        if (totalBytes > maxBytes) {
          req.destroy(new Error(`response exceeded ${maxBytes} bytes from ${parsed.href}`))
          return
        }
        chunks.push(bytes)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

function downloadFileToPath(url, targetPath, timeoutMs = 180_000, redirects = 3) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = trustedNodeDownloadUrl(url)
    } catch (error) {
      reject(error)
      return
    }
    const req = https.get(parsed, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const redirected = new URL(res.headers.location, parsed)
        downloadFileToPath(redirected, targetPath, timeoutMs, redirects - 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} from ${parsed.href}`))
        return
      }
      const file = fs.createWriteStream(targetPath, { flags: 'w' })
      const fail = (error) => {
        file.destroy()
        fs.rmSync(targetPath, { force: true })
        reject(error)
      }
      file.on('error', fail)
      res.on('error', fail)
      file.on('finish', () => file.close(resolve))
      res.pipe(file)
    })
    req.on('timeout', () => req.destroy(new Error(`download timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

async function downloadFile(url, targetPath, timeoutMs = 180_000, redirects = 3) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  const partialPath = `${targetPath}.partial-${process.pid}-${Date.now()}`
  try {
    await downloadFileToPath(url, partialPath, timeoutMs, redirects)
    fs.rmSync(targetPath, { force: true })
    fs.renameSync(partialPath, targetPath)
  } finally {
    fs.rmSync(partialPath, { force: true })
  }
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
  const archiveFileName = `${archiveName}.zip`
  const zipPath = path.join(downloadsDir, archiveFileName)
  const checksumManifest = await requestBuffer(
    `https://nodejs.org/dist/${version}/SHASUMS256.txt`,
    30_000,
    3,
    2 * 1024 * 1024,
  )
  const expectedSha256 = parseSha256Manifest(checksumManifest.toString('utf8')).get(archiveFileName)
  if (!expectedSha256) throw new Error(`Node.js checksum manifest did not include ${archiveFileName}`)
  await downloadFile(`https://nodejs.org/dist/${version}/${archiveFileName}`, zipPath)
  const actualSha256 = sha256File(zipPath)
  if (actualSha256 !== expectedSha256) {
    fs.rmSync(zipPath, { force: true })
    throw new Error(`Node.js archive checksum mismatch for ${archiveFileName}`)
  }
  console.log(`[dystopai] verified Node.js archive ${archiveFileName} against the published SHA-256 manifest`)
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
  fs.rmSync(zipPath, { force: true })
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
  const roots = ELECTRON_E2E
    ? [
        DYSTOPAI_USER_DATA_DIR,
        NPM_TOOLCHAIN_ROOT,
        resolveOpenClawHomeDir(),
      ]
    : [
        appRoot(),
        process.resourcesPath,
        path.dirname(process.execPath),
        DYSTOPAI_USER_DATA_DIR,
        NPM_TOOLCHAIN_ROOT,
        resolveOpenClawHomeDir(),
      ]
  return roots
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

function bootstrapControlCenterSession(timeoutMs = 5000) {
  const body = JSON.stringify({ token: ensureControlCenterLaunchToken() })
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: APP_PORT,
      path: '/api/auth/login',
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let responseBody = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { responseBody += chunk })
      res.on('end', () => {
        try {
          const payload = JSON.parse(responseBody || '{}')
          const sessionToken = payload?.ok === true ? payload?.data?.token : null
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && typeof sessionToken === 'string' && sessionToken) {
            resolve(sessionToken)
            return
          }
          reject(new Error(`Desktop session bootstrap failed: HTTP ${res.statusCode || 'unknown'}`))
        } catch (error) {
          reject(new Error(`Desktop session bootstrap returned invalid JSON: ${error?.message || error}`))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`desktop session bootstrap timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
    req.end(body)
  })
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

function waitForControlServer(timeoutMs = CONTROL_SERVER_STARTUP_TIMEOUT_MS) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    let settled = false
    let retryTimer = null
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      if (retryTimer) clearTimeout(retryTimer)
      callback(value)
    }
    const retry = () => {
      if (settled) return
      retryTimer = setTimeout(check, 250)
      retryTimer.unref?.()
    }
    const check = () => {
      if (settled) return
      const req = http.request({
        hostname: '127.0.0.1',
        port: APP_PORT,
        path: '/api/ready',
        method: 'GET',
        timeout: 1000,
        headers: {
          Accept: 'application/json',
        },
      }, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          finish(resolve)
          return
        }
        if (Date.now() - startedAt >= timeoutMs) {
          finish(reject, new Error(`Control Center API did not become ready on port ${APP_PORT}: HTTP ${res.statusCode || 'unknown'}`))
          return
        }
        retry()
      })
      req.on('timeout', () => {
        req.destroy(new Error('control server probe timed out'))
      })
      req.on('error', (err) => {
        if (Date.now() - startedAt >= timeoutMs) {
          finish(reject, new Error(`Control Center API did not become ready on port ${APP_PORT}: ${err.message}`))
          return
        }
        retry()
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

function waitForSpawnedControlServer(child, timeoutMs = CONTROL_SERVER_STARTUP_TIMEOUT_MS) {
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
    logE2e('quit-cleanup-complete')
  }).finally(() => {
    quitCleanupInFlight = null
    updateTrayMenu()
  })
  return quitCleanupInFlight
}

function configureRendererPermissionPolicy(win) {
  const rendererSession = win.webContents.session
  rendererSession.setPermissionCheckHandler(() => false)
  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (typeof rendererSession.setDevicePermissionHandler === 'function') {
    rendererSession.setDevicePermissionHandler(() => false)
  }
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
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  })

  mainWindow = win
  configureRendererPermissionPolicy(win)
  configureTextAssistance(win)
  let e2eRendererLoadCount = 0
  let e2eRendererGone = false
  let e2eExternalAssertionsComplete = false
  let e2eRendererCrashRequested = false
  let e2eTrayAssertionsStarted = false
  let e2eRendererJourneyStarted = false

  win.on('unresponsive', () => {
    console.warn('[dystopai] renderer became unresponsive')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[dystopai] renderer process gone:', details)
    logE2e(`renderer-process-gone:${details?.reason || 'unknown'}`)
    e2eRendererGone = true
    if (isQuitting || win.isDestroyed()) return
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload()
    }, 750)
  })
  win.webContents.on('did-finish-load', () => {
    if (!ELECTRON_E2E) return
    e2eRendererLoadCount += 1
    logE2e(`renderer-load:${e2eRendererLoadCount}`)

    if (
      process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_JOURNEY === '1' &&
      !e2eRendererJourneyStarted
    ) {
      e2eRendererJourneyStarted = true
      setTimeout(() => {
        void runElectronE2eRendererJourney(win).then(() => {
          logE2e('renderer-journey-ok')
          if (process.env.DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_RENDERER_JOURNEY === '1') app.quit()
        }).catch((error) => {
          logE2e(`renderer-journey-failed:${error?.message || error}`)
          process.exit(6)
        })
      }, 250)
      return
    }

    if (
      process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR === '1' &&
      !e2eTrayAssertionsStarted
    ) {
      e2eTrayAssertionsStarted = true
      setTimeout(() => {
        void runElectronE2eTraySelfTest(win).catch((error) => {
          logE2e(`tray-behavior-failed:${error?.message || error}`)
          process.exit(5)
        })
      }, 250)
      return
    }

    const assertRendererExternals = process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_EXTERNALS === '1'
    const assertRendererRecovery = process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_RECOVERY === '1'
    const quitAfterRendererAssertions = process.env.DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_RENDERER_ASSERTIONS === '1'
    const requestRendererCrash = () => {
      if (!assertRendererRecovery || e2eRendererCrashRequested || win.isDestroyed()) return
      e2eRendererCrashRequested = true
      logE2e('renderer-crash-requested')
      win.webContents.forcefullyCrashRenderer()
    }

    if (e2eRendererLoadCount === 1 && assertRendererExternals) {
      void win.webContents.executeJavaScript(`
        (() => {
          window.open('https://example.com/dystopai-e2e-window-open', '_blank', 'noopener,noreferrer');
          setTimeout(() => {
            window.location.href = 'https://example.com/dystopai-e2e-navigation';
          }, 25);
          return true;
        })()
      `).catch((error) => {
        logE2e(`renderer-external-policy-failed:${error?.message || error}`)
        process.exit(4)
      })
      setTimeout(() => {
        e2eExternalAssertionsComplete = true
        logE2e('renderer-external-policy-ok')
        requestRendererCrash()
      }, 600)
      return
    }

    if (e2eRendererLoadCount === 1) {
      e2eExternalAssertionsComplete = !assertRendererExternals
      requestRendererCrash()
      return
    }

    if (assertRendererRecovery && e2eRendererGone && e2eRendererLoadCount >= 2) {
      logE2e('renderer-recovered')
      if ((!assertRendererExternals || e2eExternalAssertionsComplete) && quitAfterRendererAssertions) {
        app.quit()
      }
    }
  })
  win.webContents.setWindowOpenHandler(handleWindowOpen)
  win.webContents.on('will-navigate', handleWillNavigate)
  win.webContents.on('will-redirect', handleWillNavigate)

  win.on('close', (event) => {
    if (!TRAY_ENABLED) return
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
  if (!TRAY_ENABLED) return
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
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
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
  ]
  lastTrayMenuSnapshot = template
    .filter((item) => item && item.type !== 'separator')
    .map((item) => ({
      label: String(item.label || ''),
      enabled: item.enabled !== false,
    }))
  if (ELECTRON_E2E && process.env.DYSTOPAI_ELECTRON_E2E_LOG_TRAY_MENU === '1') {
    logE2e(`tray-menu:${lastTrayMenuSnapshot.map((item) => `${item.label}:${item.enabled ? 'enabled' : 'disabled'}`).join('|')}`)
  }
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  if (!TRAY_ENABLED) return null
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
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return false
    const host = parsed.hostname.toLowerCase()
    const port = Number(parsed.port || 80)
    const allowedPort = port === APP_PORT || (isDev && port === DEV_FRONTEND_PORT)
    return (
      (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') &&
      allowedPort
    )
  } catch {
    return false
  }
}

function shouldOpenExternally(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !isInternalAppUrl(targetUrl)
  } catch {
    return false
  }
}

function openAllowedExternalUrl(targetUrl) {
  if (!shouldOpenExternally(targetUrl)) return false
  if (process.env.DYSTOPAI_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL === '1') {
    logE2e(`external-open:${targetUrl}`)
    return true
  }
  void shell.openExternal(targetUrl).catch((error) => {
    console.warn('[dystopai] failed to open external URL:', error?.message || error)
  })
  return true
}

/**
 * @param {{ url: string }} details
 * @returns {import('electron').WindowOpenHandlerResponse}
 */
function handleWindowOpen({ url }) {
  openAllowedExternalUrl(url)
  return { action: 'deny' }
}

/**
 * @param {{ preventDefault: () => void }} event
 * @param {string} url
 */
function handleWillNavigate(event, url) {
  if (isInternalAppUrl(url)) return
  event.preventDefault()
  openAllowedExternalUrl(url)
}

function assertElectronE2e(condition, message) {
  if (!condition) throw new Error(`Electron E2E policy assertion failed: ${message}`)
}

async function waitForElectronE2e(condition, label, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await sleep(50)
  }
  throw new Error(`Electron E2E timed out waiting for ${label}`)
}

function runElectronE2ePolicySelfTest() {
  if (!ELECTRON_E2E || process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_NAVIGATION !== '1') return

  const allowedExternal = 'https://example.com/docs'
  const deniedExternal = 'http://example.com/docs'
  const popupResult = handleWindowOpen({ url: allowedExternal })
  assertElectronE2e(popupResult?.action === 'deny', 'all popup windows must be denied')

  const deniedPopupResult = handleWindowOpen({ url: deniedExternal })
  assertElectronE2e(deniedPopupResult?.action === 'deny', 'non-HTTPS popup windows must be denied')

  let prevented = false
  handleWillNavigate({ preventDefault: () => { prevented = true } }, allowedExternal)
  assertElectronE2e(prevented, 'external navigations must be prevented before opening externally')

  prevented = false
  handleWillNavigate({ preventDefault: () => { prevented = true } }, controlCenterOrigin())
  assertElectronE2e(!prevented, 'internal control-center navigation must remain allowed')

  logE2e('navigation-policy-ok')
}

async function runElectronE2eRendererJourney(win) {
  if (!ELECTRON_E2E || process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_JOURNEY !== '1') return
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFor = async (predicate, label, timeoutMs = 15000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const nav = await waitFor(
        () => document.querySelector('nav[aria-label="Primary navigation"]'),
        'primary navigation',
      );
      const main = document.querySelector('#dystopai-main');
      const skip = document.querySelector('a.dy-skip-link[href="#dystopai-main"]');
      if (!main || !skip) throw new Error('Main landmark or skip link is missing');

      const visited = [];
      for (const label of ['Missions', 'Monitor', 'Plugins', 'Agents']) {
        const button = [...nav.querySelectorAll('button')]
          .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(label + ' '));
        if (!button) throw new Error('Missing navigation button for ' + label);
        button.click();
        await waitFor(
          () => button.getAttribute('aria-current') === 'page',
          label + ' navigation state',
        );
        await waitFor(
          () => document.querySelector('#dystopai-workspace-title')?.textContent?.trim() === label,
          label + ' workspace title',
        );
        await waitFor(
          () => document.querySelector('[role="region"][aria-label="' + label + ' workspace"]'),
          label + ' workspace region',
        );
        visited.push(label);
      }
      return { ok: true, visited };
    })()
  `, true)
  assertElectronE2e(Boolean(result?.ok), 'renderer journey must finish successfully')
  assertElectronE2e(Array.isArray(result?.visited) && result.visited.join(',') === 'Missions,Monitor,Plugins,Agents', 'renderer journey must visit every primary workspace')
}

async function runElectronE2eTraySelfTest(win) {
  if (!ELECTRON_E2E || process.env.DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR !== '1') return
  const menuHas = (label) => lastTrayMenuSnapshot.some((item) => item.label === label && item.enabled)

  assertElectronE2e(Boolean(tray), 'tray must be created before renderer tray assertions run')
  if (!win.isDestroyed() && !win.isVisible()) {
    win.setSkipTaskbar(false)
    win.show()
    win.focus()
  }
  await waitForElectronE2e(() => !win.isDestroyed() && win.isVisible(), 'main window to become visible')
  updateTrayMenu()
  assertElectronE2e(menuHas('Hide UI'), 'visible window tray menu must offer Hide UI')
  logE2e('tray-visible-state-ok')

  win.close()
  await waitForElectronE2e(() => !win.isDestroyed() && !win.isVisible(), 'main window to hide after close')
  updateTrayMenu()
  assertElectronE2e(menuHas('Show UI'), 'hidden window tray menu must offer Show UI')
  logE2e('tray-hide-on-close-ok')

  tray.emit('click')
  await waitForElectronE2e(() => !win.isDestroyed() && win.isVisible(), 'tray click to restore main window')
  updateTrayMenu()
  assertElectronE2e(menuHas('Hide UI'), 'restored window tray menu must offer Hide UI')
  logE2e('tray-click-restore-ok')

  if (process.env.DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_TRAY_ASSERTIONS === '1') app.quit()
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
    if (process.env.DYSTOPAI_ELECTRON_E2E_SKIP_PORT_CLEANUP === '1') {
      logE2e('port-cleanup-skipped')
    } else {
      await prepareManagedPortsForStartup()
    }

    const serverEntry = resolveServerEntry()
    console.log('[dystopai] starting server process:', serverEntry)

    // Keep backend work out of Electron's main process so the desktop UI stays responsive.
    const serverChild = startControlServerProcess(serverEntry)
    await waitForSpawnedControlServer(serverChild)
    serverRestartAttempts = 0

    console.log('[dystopai] server ready on port', APP_PORT)
    logE2e('server-ready')
    runElectronE2ePolicySelfTest()

    createTray()

  } catch (err) {
    startupFailed = true
    startingUp = false
    await stopControlServerProcess('startup failure').catch((cleanupError) => {
      console.warn('[dystopai] startup failure cleanup skipped:', cleanupError?.message || cleanupError)
    })
    showBlockingError('DystopAI - Startup Error', String(err))
    if (ELECTRON_E2E) {
      app.quit()
      return
    }
    app.quit()
    return
  }

  try {
    createMainWindow()
    if (ELECTRON_E2E_AUTO_QUIT_MS > 0) {
      const timer = setTimeout(() => {
        logE2e('auto-quit')
        app.quit()
      }, ELECTRON_E2E_AUTO_QUIT_MS)
      if (typeof timer.unref === 'function') timer.unref()
    }
    startingUp = false
  } catch (err) {
    startupFailed = true
    startingUp = false
    await stopRuntimeCompletelyForQuit().catch((cleanupError) => {
      console.warn('[dystopai] UI failure cleanup skipped:', cleanupError?.message || cleanupError)
    })
    showBlockingError('DystopAI - UI Error', String(err))
    if (ELECTRON_E2E) {
      process.exit(3)
      return
    }
    app.quit()
  }
})

app.on('activate', () => {
  if (startupFailed || startingUp) return
  try {
    openFrontend()
  } catch (err) {
    startupFailed = true
    showBlockingError('DystopAI', String(err))
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
  if (!TRAY_ENABLED) app.quit()
})

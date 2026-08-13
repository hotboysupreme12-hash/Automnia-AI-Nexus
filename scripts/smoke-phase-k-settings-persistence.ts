import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const require = createRequire(import.meta.url)
const electronPath = require('electron') as string
const startedAt = new Date().toISOString()
const distDir = path.join(root, 'dist')
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'settings-persistence-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'SETTINGS_PERSISTENCE_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '18-settings-persistence-smoke.log')
const evidenceScreenshotPath = path.join(phaseKEvidenceDir, 'settings-persistence-smoke.png')
const uiSmokeSessionToken = 'settings-persistence-session-token'

type SettingsSnapshot = {
  settingsPanelPresent: boolean
  settingsNavAriaCurrent: string
  densitySelectValue: string
  motionSelectValue: string
  rootDensity: string
  rootMotion: string
  storedDensity: string
  storedMotion: string
  noticeText: string
}

type ElectronSettingsSmokeResult = {
  ok: boolean
  seed: SettingsSnapshot
  verify: SettingsSnapshot
  screenshotPath: string
  checkedAt: string
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

function sendJson(response: import('node:http').ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function fileForRequest(requestUrl: string | undefined) {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1')
  const rawPath = decodeURIComponent(url.pathname)
  const normalizedPath = rawPath === '/' ? '/index.html' : rawPath
  const candidate = path.normalize(path.join(distDir, normalizedPath))

  if (!isInside(distDir, candidate)) return { status: 403, filePath: null as string | null }
  if (existsSync(candidate) && (await stat(candidate)).isFile()) return { status: 200, filePath: candidate }
  if (!path.extname(candidate)) return { status: 200, filePath: path.join(distDir, 'index.html') }
  return { status: 404, filePath: null as string | null }
}

function uiSmokeRuntimeStatus() {
  const now = new Date().toISOString()
  return {
    ok: true,
    generatedAt: now,
    runtime: {
      ok: true,
      current: 'settings-smoke',
      expected: 'settings-smoke',
      embedded: true,
      bin: 'settings-smoke-openclaw',
      node: process.execPath,
      severity: 'info',
      message: 'Settings persistence smoke runtime stub is healthy.',
    },
    gateway: {
      state: 'offline',
      healthy: false,
      processRunning: false,
      restartScheduled: false,
      logs: [],
      activity: { active: false, inboundCount: 0, outboundCount: 0, systemCount: 0, events: [] },
      chat: { activeRuns: 0, activeObservers: 0 },
    },
    sessions: [],
    activeRuns: [],
    recentRuns: [],
    plugins: { enabledCount: 0, totalCount: 0, all: [], enabled: [], communication: [] },
    shifts: { activeCount: 0, active: [] },
    missions: { activeCount: 0, active: [] },
    diagnostics: { doctor: { recent: [], warningCount: 0, errorCount: 0 } },
  }
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      const requestPath = requestUrl.pathname
      if (requestPath === '/api/auth/login') {
        sendJson(response, 200, { token: uiSmokeSessionToken })
        return
      }
      if (requestPath === '/api/auth/status') {
        const authorization = request.headers.authorization || ''
        sendJson(response, 200, {
          authenticated: authorization === `Bearer ${uiSmokeSessionToken}`,
        })
        return
      }
      if (requestPath === '/api/party/overview') {
        sendJson(response, 200, { party: [] })
        return
      }
      if (requestPath === '/api/missions/projection') {
        sendJson(response, 200, { missions: [], reports: [], feed: [] })
        return
      }
      if (requestPath === '/api/openclaw/runtime/status' || requestPath === '/api/openclaw/runtime/summary') {
        sendJson(response, 200, uiSmokeRuntimeStatus())
        return
      }
      if (requestPath === '/api/shifts') {
        sendJson(response, 200, { shifts: [] })
        return
      }
      if (requestPath === '/api/shifts/defaults') {
        sendJson(response, 200, {
          defaults: {
            every: '15m',
            durationMinutes: 60,
            message: 'Settings persistence smoke heartbeat.',
            thinking: 'off',
            timeoutSeconds: 720,
          },
        })
        return
      }
      if (requestPath === '/api/openclaw/clawtalk-console/stream') {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/event-stream; charset=utf-8',
        })
        response.end('event: settings-smoke\ndata: {}\n\n')
        return
      }
      if (requestPath.startsWith('/api/')) {
        sendJson(response, 404, {
          error: 'settings_persistence_static_api_stub',
          detail: `${request.method || 'GET'} ${requestPath} is not served by the Settings persistence smoke harness.`,
        })
        return
      }

      const { status, filePath } = await fileForRequest(request.url)
      if (!filePath) {
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(status === 403 ? 'Forbidden' : 'Not found')
        return
      }

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
      })
      createReadStream(filePath).pipe(response)
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : String(error))
    }
  })

  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate local settings-smoke server port.'))
        return
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function writeElectronRunner(runnerAppDir: string) {
  mkdirSync(runnerAppDir, { recursive: true })
  writeFileSync(path.join(runnerAppDir, 'package.json'), JSON.stringify({
    name: 'automnia-settings-persistence-smoke',
    private: true,
    main: 'main.cjs',
  }, null, 2), 'utf8')
  writeFileSync(path.join(runnerAppDir, 'preload.cjs'), String.raw`
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('automniaDesktop', {
  bootstrapControlCenterSession: () => ${JSON.stringify(uiSmokeSessionToken)},
})
`, 'utf8')
  writeFileSync(path.join(runnerAppDir, 'main.cjs'), String.raw`
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const targetUrl = process.env.AUTOMNIA_SETTINGS_SMOKE_URL
const screenshotPath = process.env.AUTOMNIA_SETTINGS_SMOKE_SCREENSHOT
if (!targetUrl || !screenshotPath) {
  throw new Error('AUTOMNIA_SETTINGS_SMOKE_URL and AUTOMNIA_SETTINGS_SMOKE_SCREENSHOT are required.')
}

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling')
app.commandLine.appendSwitch('no-sandbox')
app.setPath('userData', path.join(path.dirname(screenshotPath), 'settings-smoke-electron-user-data'))

process.on('uncaughtException', (error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForLoad(window) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Settings smoke renderer load.')), 15000)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function changeSettings(window) {
  const script = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const waitFor = async (predicate, timeout = 8000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  const setSelect = (select, value) => {",
    "    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set",
    "    if (setter) setter.call(select, value)",
    "    else select.value = value",
    "    select.dispatchEvent(new Event('input', { bubbles: true }))",
    "    select.dispatchEvent(new Event('change', { bubbles: true }))",
    "  }",
    "  const snapshot = () => {",
    "    const panel = document.querySelector('[data-dui-panel=\"settings\"]')",
    "    const densitySelect = panel ? panel.querySelector('select[data-dui-setting=\"density\"]') : null",
    "    const motionSelect = panel ? panel.querySelector('select[data-dui-setting=\"motion\"]') : null",
    "    const stored = JSON.parse(window.localStorage.getItem('automnia-ui-settings-v1') || '{}')",
    "    const notice = panel ? panel.querySelector('.dui-settings-status') : null",
    "    return {",
    "      settingsPanelPresent: Boolean(panel),",
    "      settingsNavAriaCurrent: document.querySelector('#nexus-nav-settings')?.getAttribute('aria-current') || '',",
    "      densitySelectValue: densitySelect ? densitySelect.value : '',",
    "      motionSelectValue: motionSelect ? motionSelect.value : '',",
    "      rootDensity: document.documentElement.dataset.duiDensity || '',",
    "      rootMotion: document.documentElement.dataset.duiMotion || '',",
    "      storedDensity: stored.density || '',",
    "      storedMotion: stored.motion || '',",
    "      noticeText: notice ? notice.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "    }",
    "  }",
    "  return (async () => {",
    "    window.localStorage.removeItem('automnia-ui-settings-v1')",
    "    const settingsNavItem = await waitFor(() => document.querySelector('#nexus-nav-settings'))",
    "    if (!settingsNavItem) return snapshot()",
    "    settingsNavItem.click()",
    "    const panel = await waitFor(() => document.querySelector('[data-dui-panel=\"settings\"]'))",
    "    const densitySelect = panel ? panel.querySelector('select[data-dui-setting=\"density\"]') : null",
    "    const motionSelect = panel ? panel.querySelector('select[data-dui-setting=\"motion\"]') : null",
    "    if (!panel || !densitySelect || !motionSelect) return snapshot()",
    "    setSelect(densitySelect, 'spacious')",
    "    await waitFor(() => document.documentElement.dataset.duiDensity === 'spacious')",
    "    setSelect(motionSelect, 'reduced')",
    "    await waitFor(() => document.documentElement.dataset.duiMotion === 'reduced')",
    "    await waitFor(() => {",
    "      const stored = JSON.parse(window.localStorage.getItem('automnia-ui-settings-v1') || '{}')",
    "      return stored.density === 'spacious' && stored.motion === 'reduced'",
    "    })",
    "    return snapshot()",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(script)
}

async function verifySettings(window) {
  const script = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const waitFor = async (predicate, timeout = 8000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  const snapshot = () => {",
    "    const panel = document.querySelector('[data-dui-panel=\"settings\"]')",
    "    const densitySelect = panel ? panel.querySelector('select[data-dui-setting=\"density\"]') : null",
    "    const motionSelect = panel ? panel.querySelector('select[data-dui-setting=\"motion\"]') : null",
    "    const stored = JSON.parse(window.localStorage.getItem('automnia-ui-settings-v1') || '{}')",
    "    const notice = panel ? panel.querySelector('.dui-settings-status') : null",
    "    return {",
    "      settingsPanelPresent: Boolean(panel),",
    "      settingsNavAriaCurrent: document.querySelector('#nexus-nav-settings')?.getAttribute('aria-current') || '',",
    "      densitySelectValue: densitySelect ? densitySelect.value : '',",
    "      motionSelectValue: motionSelect ? motionSelect.value : '',",
    "      rootDensity: document.documentElement.dataset.duiDensity || '',",
    "      rootMotion: document.documentElement.dataset.duiMotion || '',",
    "      storedDensity: stored.density || '',",
    "      storedMotion: stored.motion || '',",
    "      noticeText: notice ? notice.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "    }",
    "  }",
    "  return (async () => {",
    "    await waitFor(() => document.documentElement.dataset.duiDensity === 'spacious' && document.documentElement.dataset.duiMotion === 'reduced')",
    "    const settingsNavItem = await waitFor(() => document.querySelector('#nexus-nav-settings'))",
    "    if (settingsNavItem) settingsNavItem.click()",
    "    await waitFor(() => document.querySelector('[data-dui-panel=\"settings\"] select[data-dui-setting=\"density\"]')?.value === 'spacious')",
    "    await waitFor(() => document.querySelector('[data-dui-panel=\"settings\"] select[data-dui-setting=\"motion\"]')?.value === 'reduced')",
    "    return snapshot()",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(script)
}

function assertSnapshot(snapshot, label) {
  if (!snapshot.settingsPanelPresent) throw new Error(label + ' settings panel was not present')
  if (snapshot.settingsNavAriaCurrent !== 'page') throw new Error(label + ' settings navigation was not active')
  for (const key of ['densitySelectValue', 'rootDensity', 'storedDensity']) {
    if (snapshot[key] !== 'spacious') throw new Error(label + ' expected ' + key + ' to be spacious but got ' + snapshot[key])
  }
  for (const key of ['motionSelectValue', 'rootMotion', 'storedMotion']) {
    if (snapshot[key] !== 'reduced') throw new Error(label + ' expected ' + key + ' to be reduced but got ' + snapshot[key])
  }
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    backgroundColor: '#030303',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })
  await window.loadURL(targetUrl)
  await wait(1200)
  const seed = await changeSettings(window)
  assertSnapshot(seed, 'seed')
  const reload = waitForLoad(window)
  window.webContents.reloadIgnoringCache()
  await reload
  await wait(900)
  const verify = await verifySettings(window)
  assertSnapshot(verify, 'verify')
  const image = await window.webContents.capturePage()
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.writeFileSync(screenshotPath, image.toPNG())
  const result = {
    ok: true,
    seed,
    verify,
    screenshotPath,
    checkedAt: new Date().toISOString(),
  }
  console.log(JSON.stringify(result, null, 2))
  window.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})
`, 'utf8')
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  let timedOut = false
  const status = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
  return { status, timedOut }
}

async function runElectronSettingsSmoke(url: string, runnerAppDir: string) {
  writeElectronRunner(runnerAppDir)
  const child = spawn(electronPath, [runnerAppDir], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      ELECTRON_ENABLE_LOGGING: '0',
      AUTOMNIA_SETTINGS_SMOKE_URL: url,
      AUTOMNIA_SETTINGS_SMOKE_SCREENSHOT: evidenceScreenshotPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const exit = await waitForExit(child, 45_000)
  const combinedOutput = `${stdout}\n${stderr}`
  assert.equal(exit.timedOut, false, `Phase K Settings persistence smoke timed out\n${combinedOutput}`)
  assert.equal(exit.status, 0, `Phase K Settings persistence smoke exited ${exit.status}\n${combinedOutput}`)

  const output = stdout.trim()
  const jsonStart = output.indexOf('{')
  const jsonEnd = output.lastIndexOf('}')
  const jsonText = jsonStart >= 0 && jsonEnd > jsonStart ? output.slice(jsonStart, jsonEnd + 1) : ''
  assert.ok(jsonText, `Phase K Settings persistence smoke did not print JSON output\n${combinedOutput}`)
  const payload = JSON.parse(jsonText) as ElectronSettingsSmokeResult
  assert.equal(payload.ok, true)
  return { payload, stdout, stderr }
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|sessionToken["']?\s*:\s*["'][^"']{8,}|controlToken["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

assert.ok(typeof electronPath === 'string' && electronPath.length > 0, 'Electron binary path must resolve from the electron package')
assert.ok(existsSync(path.join(distDir, 'index.html')), 'Phase K Settings persistence smoke requires dist/index.html; run npm run build:client first')
mkdirSync(phaseKEvidenceDir, { recursive: true })

const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-settings-persistence-'))
const runnerAppDir = path.join(tempRoot, 'settings-smoke-electron-app')

const { server, url } = await startStaticServer()
try {
  const { payload, stdout, stderr } = await runElectronSettingsSmoke(url, runnerAppDir)
  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [130],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'settings-density-motion-persistence',
    sourcePins: {
      packageScript: 'smoke:phase-k-settings-persistence',
      settingsPanelSelectors: ['select[data-dui-setting="density"]', 'select[data-dui-setting="motion"]'],
      storageKey: 'automnia-ui-settings-v1',
      rootDatasets: ['data-dui-density', 'data-dui-motion'],
    },
    check: {
      changedThroughSettingsPanel: payload.seed.settingsPanelPresent,
      densityChangedTo: payload.seed.densitySelectValue,
      motionChangedTo: payload.seed.motionSelectValue,
      rootDatasetUpdatedImmediately: payload.seed.rootDensity === 'spacious' && payload.seed.rootMotion === 'reduced',
      localStorageUpdated: payload.seed.storedDensity === 'spacious' && payload.seed.storedMotion === 'reduced',
      rehydratedAfterReload: payload.verify.rootDensity === 'spacious'
        && payload.verify.rootMotion === 'reduced'
        && payload.verify.densitySelectValue === 'spacious'
        && payload.verify.motionSelectValue === 'reduced',
      settingsNavigationActive: payload.verify.settingsNavAriaCurrent === 'page',
    },
    snapshots: {
      seed: payload.seed,
      verify: payload.verify,
    },
    artifacts: {
      screenshotPath: payload.screenshotPath,
      evidenceLogPath,
      evidenceMarkdownPath,
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K Settings persistence evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=130',
    'blockedItems=none',
    `densitySeed=${payload.seed.densitySelectValue}`,
    `motionSeed=${payload.seed.motionSelectValue}`,
    `densityAfterReload=${payload.verify.densitySelectValue}`,
    `motionAfterReload=${payload.verify.motionSelectValue}`,
    `rootDatasetUpdatedImmediately=${evidence.check.rootDatasetUpdatedImmediately}`,
    `localStorageUpdated=${evidence.check.localStorageUpdated}`,
    `rehydratedAfterReload=${evidence.check.rehydratedAfterReload}`,
    `screenshotPath=${payload.screenshotPath}`,
    '',
    '[electron-stdout]',
    stdout.trim(),
    '',
    '[electron-stderr]',
    stderr.trim(),
    '',
  ].join('\n'), 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Settings Persistence Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 130. Complete: use Settings to change UI density or motion and confirm persistence.',
    '',
    'Evidence:',
    '',
    '- Opened the built desktop UI through an Electron static harness.',
    '- Used the real Settings panel controls to set density to `spacious` and motion to `reduced`.',
    '- Confirmed the root `data-dui-density` and `data-dui-motion` attributes updated immediately.',
    '- Confirmed `automnia-ui-settings-v1` stored the selected density and motion values.',
    '- Reloaded the renderer and confirmed both root attributes and Settings select values rehydrated from storage.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    `- Screenshot: ${path.relative(root, evidenceScreenshotPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K Settings persistence smoke ok: ${evidenceJsonPath}`)
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(tempRoot, { recursive: true, force: true })
}

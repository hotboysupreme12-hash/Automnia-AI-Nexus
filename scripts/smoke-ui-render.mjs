import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = path.join(repoRoot, 'dist')
const outputDir = path.join(repoRoot, 'output', 'playwright')
const tmpDir = path.join(repoRoot, '.tmp')
const runnerAppDir = path.join(tmpDir, 'ui-smoke-electron-app')
const runnerPath = path.join(runnerAppDir, 'main.cjs')
const runnerPreloadPath = path.join(runnerAppDir, 'preload.cjs')
const electronPath = require('electron')
const uiSmokeLaunchToken = 'ui-smoke-launch-token'
const uiSmokeSessionToken = 'ui-smoke-session-token'

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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function assertBuildExists() {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Missing dist/index.html. Run npm run build:client before npm run smoke:ui.')
  }
}

function uiSmokeRuntimeStatus() {
  const now = new Date().toISOString()
  return {
    ok: true,
    generatedAt: now,
    runtime: {
      ok: true,
      current: 'ui-smoke',
      expected: 'ui-smoke',
      embedded: true,
      bin: 'ui-smoke-openclaw',
      node: process.execPath,
      severity: 'info',
      message: 'UI smoke runtime stub is healthy.',
    },
    gateway: {
      state: 'running',
      healthy: true,
      processRunning: true,
      pid: 4242,
      port: 58288,
      restartCount: 0,
      restartScheduled: false,
      ensureInFlight: false,
      lastStartedAt: now,
      lastHealthyAt: now,
      lastExitAt: null,
      lastExitCode: null,
      uptimeMs: 120000,
      logs: [
        { id: 1, timestamp: now, stream: 'gateway', message: 'UI smoke gateway ready.', level: 'info', source: 'ui-smoke' },
      ],
      activity: {
        active: true,
        lastEventAt: now,
        sourcePath: 'ui-smoke',
        inboundCount: 1,
        outboundCount: 1,
        systemCount: 1,
        events: [],
      },
      stability: {
        available: true,
        source: 'diagnostics.stability',
        generatedAt: now,
        count: 1,
        dropped: 0,
        lastSeq: 1,
        summary: {
          byType: { ready: 1 },
          active: 0,
          waiting: 0,
          queued: 0,
          maxQueueDepth: 0,
          warningCount: 0,
          latestEventType: 'ready',
          latestEventAt: now,
          recentWarnings: [],
        },
        events: [],
      },
      chat: {
        activeRuns: 0,
        activeObservers: 0,
        oldestRunAgeMs: 0,
        oldestObserverAgeMs: 0,
      },
    },
    sessions: [],
    activeRuns: [],
    recentRuns: [],
    plugins: {
      enabledCount: 0,
      totalCount: 0,
      all: [],
      enabled: [],
      communication: [],
      cache: { source: 'ui-smoke', refreshedAt: Date.now(), refreshing: false },
    },
    shifts: {
      activeCount: 0,
      active: [],
    },
    missions: {
      activeCount: 0,
      active: [],
    },
    diagnostics: {
      doctor: {
        lastRun: null,
        recent: [],
        warningCount: 0,
        errorCount: 0,
        lastRunAt: null,
      },
    },
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function fileForRequest(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1')
  const rawPath = decodeURIComponent(url.pathname)
  const normalizedPath = rawPath === '/' ? '/index.html' : rawPath
  const candidate = path.normalize(path.join(distDir, normalizedPath))

  if (!isInside(distDir, candidate) && candidate !== path.join(distDir, 'index.html')) {
    return { status: 403, filePath: null }
  }

  if (existsSync(candidate) && (await stat(candidate)).isFile()) {
    return { status: 200, filePath: candidate }
  }

  if (!path.extname(candidate)) {
    return { status: 200, filePath: path.join(distDir, 'index.html') }
  }

  return { status: 404, filePath: null }
}

function startStaticServer() {
  const agentTurnStreamStats = { opened: 0, closed: 0 }
  const runtimeMonitorClearStats = { calls: 0, failures: 0, failNext: false }
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
          authenticated: authorization === `Bearer ${uiSmokeSessionToken}` || authorization === `Bearer ${uiSmokeLaunchToken}`,
        })
        return
      }
      if (requestPath === '/api/missions/projection') {
        sendJson(response, 200, { missions: [], reports: [], feed: [] })
        return
      }
      if (requestPath === '/api/party/overview') {
        sendJson(response, 200, { party: [] })
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
            message: 'UI smoke heartbeat.',
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
        response.end('event: ui-smoke\ndata: {}\n\n')
        return
      }
      if (requestPath === '/api/ui-smoke/agent-turn-stream-stats') {
        sendJson(response, 200, agentTurnStreamStats)
        return
      }
      if (requestPath === '/api/ui-smoke/runtime-monitor-clear-stats') {
        sendJson(response, 200, runtimeMonitorClearStats)
        return
      }
      if (requestPath === '/api/ui-smoke/runtime-monitor-clear-mode') {
        runtimeMonitorClearStats.failNext = requestUrl.searchParams.get('mode') === 'fail'
        sendJson(response, 200, { ok: true, failNext: runtimeMonitorClearStats.failNext })
        return
      }
      if (requestPath === '/api/openclaw/runtime/monitor/clear') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method_not_allowed' })
          return
        }
        runtimeMonitorClearStats.calls += 1
        if (runtimeMonitorClearStats.failNext) {
          runtimeMonitorClearStats.failNext = false
          runtimeMonitorClearStats.failures += 1
          sendJson(response, 503, {
            error: 'ui_smoke_monitor_clear_failed',
            detail: 'simulated Clean Slate failure',
          })
          return
        }
        sendJson(response, 200, {
          ok: true,
          clearedAt: new Date().toISOString(),
          cleared: {
            gatewayLogs: 3,
            gatewayLogTailSnapshots: 2,
            recentRuns: 4,
          },
          activeRuns: 1,
          sessionLockCleanup: {
            scanned: 5,
            removed: 1,
            errors: 0,
          },
        })
        return
      }
      if (requestPath === '/api/openclaw/agent-turn/stream') {
        agentTurnStreamStats.opened += 1
        response.writeHead(200, {
          'Cache-Control': 'no-cache, no-transform',
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Accel-Buffering': 'no',
        })
        response.write(': connected\n\n')
        response.write('event: status\ndata: {"transport":"gateway-chat","mode":"progress","label":"OpenClaw session","message":"UI smoke accepted the live chat run.","agent":"hn-commander","sessionKey":"agent:hn-commander:control-center:ui-smoke","runId":"ui-smoke-run","liveTokens":true}\n\n')
        response.write('event: progress\ndata: {"transport":"gateway-chat","text":"UI smoke keeps this run active so the stop control can render. api_key=sk-ui-smoke-secret-123456 +15555550123 user@example.com","agent":"hn-commander","runId":"ui-smoke-run","liveTokens":true}\n\n')
        const keepAlive = setInterval(() => {
          response.write(': keepalive\n\n')
        }, 1000)
        let closed = false
        request.once('close', () => {
          if (closed) return
          closed = true
          agentTurnStreamStats.closed += 1
          clearInterval(keepAlive)
          response.end()
        })
        return
      }
      if (requestPath.startsWith('/api/')) {
        sendJson(response, 404, {
          error: 'ui_smoke_static_api_stub',
          detail: `${request.method || 'GET'} ${requestPath} is not served by the static UI smoke harness.`,
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

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate local smoke-test server port.'))
        return
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function writeElectronRunner() {
  mkdirSync(runnerAppDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(path.join(runnerAppDir, 'package.json'), JSON.stringify({
    name: 'dystopai-ui-smoke',
    private: true,
    main: 'main.cjs',
  }, null, 2), 'utf8')
  writeFileSync(runnerPreloadPath, String.raw`
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('dystopaiDesktop', {
  bootstrapControlCenterSession: () => ${JSON.stringify(uiSmokeSessionToken)},
})
`, 'utf8')
  writeFileSync(runnerPath, String.raw`
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const targetUrl = process.env.DYSTOPAI_UI_SMOKE_URL
const outputDir = process.env.DYSTOPAI_UI_SMOKE_OUTPUT_DIR
if (!targetUrl || !outputDir) {
  throw new Error('DYSTOPAI_UI_SMOKE_URL and DYSTOPAI_UI_SMOKE_OUTPUT_DIR are required.')
}
const checks = [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'wide', width: 2048, height: 1152 },
  { label: 'mobile', width: 390, height: 844 },
]

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling')
app.commandLine.appendSwitch('no-sandbox')
fs.mkdirSync(path.join(outputDir, 'electron-user-data'), { recursive: true })
app.setPath('userData', path.join(outputDir, 'electron-user-data'))

process.on('uncaughtException', (error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

function bitmapStats(image) {
  const bitmap = image.toBitmap()
  let sampled = 0
  let nonBlank = 0
  const step = Math.max(4, Math.floor(bitmap.length / 2000 / 4) * 4)
  for (let index = 0; index < bitmap.length; index += step) {
    const blue = bitmap[index]
    const green = bitmap[index + 1]
    const red = bitmap[index + 2]
    const alpha = bitmap[index + 3]
    sampled += 1
    if (alpha > 0 && (red > 12 || green > 12 || blue > 12)) nonBlank += 1
  }
  return { sampled, nonBlank, nonBlankRatio: sampled ? nonBlank / sampled : 0 }
}

async function inspectWorkspaceTabs(window) {
  const tabScript = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const summarizePanel = (panel) => {",
    "    const panelRect = panel ? panel.getBoundingClientRect() : null",
    "    const panelText = panel ? panel.innerText.replace(/\\s+/g, ' ').trim() : ''",
    "    return {",
    "      panelTextLength: panelText.length,",
    "      panelTextSample: panelText.slice(0, 180),",
    "      panelRect: panelRect ? { width: Math.round(panelRect.width), height: Math.round(panelRect.height) } : null,",
    "      activeLoaders: panel ? panel.querySelectorAll('[class*=\"animate-pulse\"]').length : 0,",
    "    }",
    "  }",
    "  const inspectCommandConsole = (panel) => {",
    "    const commandConsole = panel ? panel.querySelector('[data-dui-panel=\"command-console\"]') : null",
    "    const textarea = commandConsole ? commandConsole.querySelector('textarea') : null",
    "    const sendButton = commandConsole ? commandConsole.querySelector('button[aria-label=\"Send message\"]') : null",
    "    const attachButton = commandConsole ? commandConsole.querySelector('button[aria-label=\"Attach file\"]') : null",
    "    const stopButton = commandConsole ? commandConsole.querySelector('button.dy-command-stop-run') : null",
    "    const busyIndicator = commandConsole ? commandConsole.querySelector('.dy-command-busy') : null",
    "    const busyStatus = commandConsole ? commandConsole.querySelector('.dy-command-busy-status') : null",
    "    const traceChip = commandConsole ? commandConsole.querySelector('button.dy-command-message-chip.is-trace') : null",
    "    const evidencePreview = commandConsole ? commandConsole.querySelector('.dy-command-evidence-preview') : null",
    "    const evidenceRows = evidencePreview ? Array.from(evidencePreview.querySelectorAll('[data-evidence-key]')).map((row) => ({",
    "      key: row.getAttribute('data-evidence-key') || '',",
    "      text: row.textContent.replace(/\\s+/g, ' ').trim(),",
    "    })) : []",
    "    const messages = commandConsole ? commandConsole.querySelector('.dy-command-messages') : null",
    "    const messagesRect = messages ? messages.getBoundingClientRect() : null",
    "    const stopRect = stopButton ? stopButton.getBoundingClientRect() : null",
    "    return {",
    "      present: Boolean(commandConsole),",
    "      textLength: commandConsole ? commandConsole.innerText.replace(/\\s+/g, ' ').trim().length : 0,",
    "      hasTextarea: Boolean(textarea),",
    "      textareaAriaLabel: textarea ? textarea.getAttribute('aria-label') || '' : '',",
    "      textareaPlaceholder: textarea ? textarea.getAttribute('placeholder') || '' : '',",
    "      sendButtonPresent: Boolean(sendButton),",
    "      sendDisabledWhenEmpty: sendButton ? Boolean(sendButton.disabled) : false,",
    "      attachButtonPresent: Boolean(attachButton),",
    "      stopButtonPresent: Boolean(stopButton),",
    "      stopButtonAriaLabel: stopButton ? stopButton.getAttribute('aria-label') || '' : '',",
    "      stopButtonText: stopButton ? stopButton.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "      stopButtonRect: stopRect ? { width: Math.round(stopRect.width), height: Math.round(stopRect.height) } : null,",
    "      busyIndicatorText: busyIndicator ? busyIndicator.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "      busyStatusRole: busyStatus ? busyStatus.getAttribute('role') || '' : '',",
    "      busyStatusAriaLive: busyStatus ? busyStatus.getAttribute('aria-live') || '' : '',",
    "      busyStatusAriaLabel: busyStatus ? busyStatus.getAttribute('aria-label') || '' : '',",
    "      traceChipPresent: Boolean(traceChip),",
    "      traceChipTagName: traceChip ? traceChip.tagName : '',",
    "      traceChipText: traceChip ? traceChip.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "      traceChipTitle: traceChip ? traceChip.getAttribute('title') || '' : '',",
    "      traceChipAriaLabel: traceChip ? traceChip.getAttribute('aria-label') || '' : '',",
    "      evidencePreviewPresent: Boolean(evidencePreview),",
    "      evidencePreviewOpen: evidencePreview ? Boolean(evidencePreview.open) : false,",
    "      evidencePreviewAriaLabel: evidencePreview ? evidencePreview.getAttribute('aria-label') || '' : '',",
    "      evidenceSummaryText: evidencePreview ? evidencePreview.querySelector('summary')?.textContent.replace(/\\s+/g, ' ').trim() || '' : '',",
    "      evidenceRows,",
      "      messagesRole: messages ? messages.getAttribute('role') || '' : '',",
    "      messagesAriaLive: messages ? messages.getAttribute('aria-live') || '' : '',",
    "      messagesAriaRelevant: messages ? messages.getAttribute('aria-relevant') || '' : '',",
    "      messagesAriaLabel: messages ? messages.getAttribute('aria-label') || '' : '',",
    "      messagesRect: messagesRect ? { width: Math.round(messagesRect.width), height: Math.round(messagesRect.height) } : null,",
    "    }",
    "  }",
    "  const inspectMonitorTabs = async () => {",
    "    const monitorTabs = Array.from(document.querySelectorAll('[role=\"tab\"][id^=\"monitor-tab-\"]'))",
    "    const monitorResults = []",
    "    for (const monitorTab of monitorTabs) {",
    "      monitorTab.click()",
    "      await wait(700)",
    "      const controls = monitorTab.getAttribute('aria-controls')",
    "      const panel = controls ? document.getElementById(controls) : null",
    "      monitorResults.push({",
    "        id: monitorTab.id,",
    "        label: monitorTab.textContent.replace(/\\s+/g, ' ').trim(),",
    "        controls,",
    "        selected: monitorTab.getAttribute('aria-selected') === 'true',",
    "        ...summarizePanel(panel),",
    "      })",
    "    }",
    "    return monitorResults",
    "  }",
    "  return (async () => {",
    "    const tabs = Array.from(document.querySelectorAll('[role=\"tab\"][id^=\"nexus-tab-\"]'))",
    "    const results = []",
    "    for (const tab of tabs) {",
    "      tab.click()",
    "      await wait(1200)",
    "      const controls = tab.getAttribute('aria-controls')",
    "      const panel = controls ? document.getElementById(controls) : null",
    "      const result = {",
    "        id: tab.id,",
    "        label: tab.textContent.replace(/\\s+/g, ' ').trim(),",
    "        controls,",
    "        selected: tab.getAttribute('aria-selected') === 'true',",
    "        ...summarizePanel(panel),",
    "      }",
    "      if (tab.id === 'nexus-tab-agents') result.commandConsole = inspectCommandConsole(panel)",
    "      if (tab.id === 'nexus-tab-monitor') result.monitorTabs = await inspectMonitorTabs()",
    "      results.push(result)",
    "    }",
    "    if (tabs[0]) {",
    "      tabs[0].click()",
    "      await wait(500)",
    "    }",
    "    return results",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(tabScript)
}

async function seedRunningCommandConsole(window) {
  const seedScript = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const waitFor = async (predicate, timeout = 5000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  return (async () => {",
    "    const agentsTab = document.querySelector('#nexus-tab-agents')",
    "    if (agentsTab) {",
    "      agentsTab.click()",
    "      await wait(700)",
    "    }",
    "    const commandConsole = document.querySelector('[data-dui-panel=\"command-console\"]')",
    "    const textarea = commandConsole ? commandConsole.querySelector('textarea[aria-label=\"Command console message\"]') : null",
    "    const sendButton = commandConsole ? commandConsole.querySelector('button[aria-label=\"Send message\"]') : null",
    "    if (!commandConsole || !textarea || !sendButton) {",
    "      return { attempted: false, reason: 'command-console-controls-missing' }",
    "    }",
    "    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set",
    "    if (setter) setter.call(textarea, 'UI smoke: keep a Command Console run active.')",
    "    else textarea.value = 'UI smoke: keep a Command Console run active.'",
    "    textarea.dispatchEvent(new Event('input', { bubbles: true }))",
    "    await waitFor(() => !sendButton.disabled, 3000)",
    "    const sendEnabled = !sendButton.disabled",
    "    if (!sendEnabled) return { attempted: false, reason: 'send-button-stayed-disabled' }",
    "    sendButton.click()",
    "    const stopButton = await waitFor(() => commandConsole.querySelector('button.dy-command-stop-run'), 5000)",
    "    const busyIndicator = commandConsole.querySelector('.dy-command-busy')",
    "    const busyStatus = commandConsole.querySelector('.dy-command-busy-status')",
    "    const rect = stopButton ? stopButton.getBoundingClientRect() : null",
    "    return {",
    "      attempted: true,",
    "      stopButtonPresent: Boolean(stopButton),",
    "      stopButtonAriaLabel: stopButton ? stopButton.getAttribute('aria-label') || '' : '',",
    "      stopButtonText: stopButton ? stopButton.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "      stopButtonRect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,",
    "      busyIndicatorText: busyIndicator ? busyIndicator.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "      busyStatusRole: busyStatus ? busyStatus.getAttribute('role') || '' : '',",
    "      busyStatusAriaLive: busyStatus ? busyStatus.getAttribute('aria-live') || '' : '',",
    "      busyStatusAriaLabel: busyStatus ? busyStatus.getAttribute('aria-label') || '' : '',",
    "    }",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(seedScript)
}

async function stopRunningCommandConsole(window) {
  const stopScript = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const readStats = async () => {",
    "    const response = await fetch('/api/ui-smoke/agent-turn-stream-stats', { cache: 'no-store' })",
    "    return response.json()",
    "  }",
    "  const waitFor = async (predicate, timeout = 5000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = await predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  return (async () => {",
    "    const commandConsole = document.querySelector('[data-dui-panel=\"command-console\"]')",
    "    const stopButton = commandConsole ? commandConsole.querySelector('button.dy-command-stop-run') : null",
    "    const beforeStats = await readStats().catch(() => ({ opened: 0, closed: 0 }))",
    "    if (!commandConsole || !stopButton) {",
    "      return { attempted: false, reason: 'stop-button-missing', beforeStats }",
    "    }",
    "    stopButton.click()",
    "    const closedStats = await waitFor(async () => {",
    "      const stats = await readStats().catch(() => null)",
    "      return stats && stats.closed > beforeStats.closed ? stats : null",
    "    }, 5000)",
    "    const cleared = await waitFor(() => !commandConsole.querySelector('.dy-command-busy'), 5000)",
    "    const afterStats = await readStats().catch(() => closedStats || beforeStats)",
    "    const statusText = commandConsole.innerText.replace(/\\s+/g, ' ').trim()",
    "    return {",
    "      attempted: true,",
    "      clicked: true,",
    "      beforeStats,",
    "      afterStats,",
    "      streamClosed: Boolean(closedStats),",
    "      busyCleared: Boolean(cleared),",
    "      stopButtonPresentAfterClick: Boolean(commandConsole.querySelector('button.dy-command-stop-run')),",
    "      statusTextSample: statusText.slice(0, 220),",
    "    }",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(stopScript)
}

async function copyCommandConsoleTrace(window) {
  const copyScript = [
    "(() => {",
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const waitFor = async (predicate, timeout = 5000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  return (async () => {",
    "    const commandConsole = document.querySelector('[data-dui-panel=\"command-console\"]')",
    "    const traceButton = commandConsole ? commandConsole.querySelector('button.dy-command-message-chip.is-trace') : null",
    "    const status = commandConsole ? commandConsole.querySelector('.dy-command-trace-copy-status') : null",
    "    if (!commandConsole || !traceButton) return { attempted: false, reason: 'trace-button-missing' }",
    "    try {",
    "      Object.defineProperty(window.navigator, 'clipboard', {",
    "        configurable: true,",
    "        value: {",
    "          writeText: async (text) => {",
    "            window.__dyCopiedTraceText = String(text)",
    "          },",
    "        },",
    "      })",
    "    } catch {",
    "      window.__dyCopiedTraceText = ''",
    "    }",
    "    traceButton.click()",
    "    const copiedText = await waitFor(() => window.__dyCopiedTraceText || '', 1500)",
    "    await waitFor(() => traceButton.getAttribute('data-copy-state') === 'copied', 1500)",
    "    return {",
    "      attempted: true,",
    "      clicked: true,",
    "      copiedText: copiedText || '',",
    "      traceButtonTextAfterClick: traceButton.textContent.replace(/\\s+/g, ' ').trim(),",
    "      traceButtonCopyState: traceButton.getAttribute('data-copy-state') || '',",
    "      traceStatusText: status ? status.textContent.replace(/\\s+/g, ' ').trim() : '',",
    "    }",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(copyScript)
}

async function cleanSlateMonitor(window, mode = 'success') {
  const cleanSlateScript = [
    "(() => {",
    "  const mode = " + JSON.stringify(mode),
    "  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "  const readStats = async () => {",
    "    const response = await fetch('/api/ui-smoke/runtime-monitor-clear-stats', { cache: 'no-store' })",
    "    return response.json()",
    "  }",
    "  const setMode = async () => {",
    "    const response = await fetch('/api/ui-smoke/runtime-monitor-clear-mode?mode=' + encodeURIComponent(mode), { method: 'POST' })",
    "    return response.json().catch(() => null)",
    "  }",
    "  const waitFor = async (predicate, timeout = 5000) => {",
    "    const started = Date.now()",
    "    while (Date.now() - started < timeout) {",
    "      const value = await predicate()",
    "      if (value) return value",
    "      await wait(100)",
    "    }",
    "    return null",
    "  }",
    "  return (async () => {",
    "    const monitorTab = document.querySelector('#nexus-tab-monitor')",
    "    if (!monitorTab) return { attempted: false, reason: 'monitor-tab-missing' }",
    "    monitorTab.click()",
    "    await wait(700)",
    "    const monitorPanel = document.querySelector('[data-dui-panel=\"monitor\"]')",
    "    const cleanButton = Array.from(document.querySelectorAll('button.dy-monitor-tool-button')).find((button) => /Clean Slate|Cleaning/i.test(button.textContent || ''))",
    "    const beforeStats = await readStats().catch(() => ({ calls: 0 }))",
    "    if (!monitorPanel || !cleanButton) {",
    "      return { attempted: false, reason: 'clean-slate-button-missing', beforeStats }",
    "    }",
    "    const modeResult = await setMode().catch(() => null)",
    "    const buttonTitle = cleanButton.getAttribute('title') || ''",
    "    cleanButton.click()",
    "    const statusSelector = mode === 'fail' ? '[role=\"alert\"]' : '[role=\"status\"]'",
    "    const statusPattern = mode === 'fail' ? /Clean Slate failed:/ : /Clean Slate complete\\./",
    "    const status = await waitFor(() => Array.from(monitorPanel.querySelectorAll(statusSelector)).find((element) => statusPattern.test(element.textContent || '')), 5000)",
    "    const afterStats = await readStats().catch(() => beforeStats)",
    "    const statusText = status ? status.textContent.replace(/\\s+/g, ' ').trim() : ''",
    "    return {",
      "      attempted: true,",
      "      clicked: true,",
      "      mode,",
      "      modeResult,",
      "      endpointCalled: afterStats.calls > beforeStats.calls,",
      "      beforeStats,",
      "      afterStats,",
      "      buttonTitle,",
      "      statusPresent: Boolean(status),",
      "      statusRole: status ? status.getAttribute('role') || '' : '',",
      "      statusAriaLive: status ? status.getAttribute('aria-live') || '' : '',",
      "      statusText,",
      "      successTextStillPresent: /Clean Slate complete\\./.test(monitorPanel.textContent || ''),",
    "    }",
    "  })()",
    "})()",
  ].join('\n')
  return window.webContents.executeJavaScript(cleanSlateScript)
}

async function inspectViewport(viewport) {
  const failures = []
  const consoleErrors = []
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    show: false,
    backgroundColor: '#030303',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })

  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame) failures.push({ code, description, url: validatedUrl })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    failures.push({ code: 'render-process-gone', description: details.reason })
  })

  await window.loadURL(targetUrl)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const commandConsoleStopSeed = await seedRunningCommandConsole(window)

  const inspectScript = [
    "(() => {",
    "  const root = document.querySelector('#root')",
    "  const main = document.querySelector('#dystopai-main')",
    "  const workspaceContext = document.querySelector('.dy-workspace-context')",
    "  const rootRect = root ? root.getBoundingClientRect() : null",
    "  const mainRect = main ? main.getBoundingClientRect() : null",
    "  const workspaceContextRect = workspaceContext ? workspaceContext.getBoundingClientRect() : null",
    "  const text = document.body.innerText.replace(/\\s+/g, ' ').trim()",
    "  const tabs = Array.from(document.querySelectorAll('[role=\"tab\"]')).map((element) => element.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean)",
    "  const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {",
    "    const rect = button.getBoundingClientRect()",
    "    return rect.width > 0 && rect.height > 0",
    "  }).length",
    "  const brokenImages = Array.from(document.images).filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.getAttribute('src') || image.currentSrc)",
    "  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)",
    "  return {",
    "    title: document.title,",
    "    textLength: text.length,",
    "    textSample: text.slice(0, 220),",
    "    rootRect: rootRect ? { width: Math.round(rootRect.width), height: Math.round(rootRect.height) } : null,",
    "    mainRect: mainRect ? { left: Math.round(mainRect.left), right: Math.round(mainRect.right), width: Math.round(mainRect.width), height: Math.round(mainRect.height) } : null,",
    "    workspaceContextRect: workspaceContextRect ? { left: Math.round(workspaceContextRect.left), right: Math.round(workspaceContextRect.right), width: Math.round(workspaceContextRect.width), height: Math.round(workspaceContextRect.height) } : null,",
    "    tabs,",
    "    visibleButtonCount: buttons,",
    "    brokenImages,",
    "    viewport: { width: window.innerWidth, height: window.innerHeight },",
    "    horizontalOverflowPx: Math.max(0, scrollWidth - window.innerWidth),",
    "  }",
    "})()",
  ].join('\n')
  const dom = await window.webContents.executeJavaScript(inspectScript)
  const workspaceTabs = await inspectWorkspaceTabs(window)
  const commandConsoleTraceCopy = await copyCommandConsoleTrace(window)

  const image = await window.webContents.capturePage()
  const screenshotPath = path.join(outputDir, 'ui-smoke-' + viewport.label + '.png')
  fs.writeFileSync(screenshotPath, image.toPNG())
  const commandConsoleStopClick = await stopRunningCommandConsole(window)
  const monitorCleanSlate = await cleanSlateMonitor(window)
  const monitorCleanSlateFailure = await cleanSlateMonitor(window, 'fail')
  window.destroy()

  const bitmap = bitmapStats(image)
  const shellFillsViewport = viewport.label === 'mobile'
    || (
      dom.mainRect?.right >= dom.viewport.width - 2
      && dom.workspaceContextRect?.right >= dom.viewport.width - 24
    )
  const workspaceTabsOk = workspaceTabs.length >= 4 && workspaceTabs.every((workspaceTab) => (
    workspaceTab.selected
      && workspaceTab.panelTextLength > 80
      && workspaceTab.panelRect?.width > 0
      && workspaceTab.panelRect?.height > 0
  ))
  const agentsTab = workspaceTabs.find((workspaceTab) => workspaceTab.id === 'nexus-tab-agents')
  const commandConsoleOk = Boolean(agentsTab?.commandConsole?.present)
    && agentsTab.commandConsole.hasTextarea
    && agentsTab.commandConsole.textareaAriaLabel === 'Command console message'
    && agentsTab.commandConsole.sendButtonPresent
    && agentsTab.commandConsole.sendDisabledWhenEmpty
    && agentsTab.commandConsole.attachButtonPresent
    && agentsTab.commandConsole.stopButtonPresent
    && agentsTab.commandConsole.stopButtonAriaLabel.startsWith('Stop ')
    && agentsTab.commandConsole.stopButtonText === 'Stop'
    && agentsTab.commandConsole.stopButtonRect?.width > 0
    && agentsTab.commandConsole.stopButtonRect?.height > 0
    && /running/.test(agentsTab.commandConsole.busyIndicatorText)
    && agentsTab.commandConsole.busyStatusRole === 'status'
    && agentsTab.commandConsole.busyStatusAriaLive === 'polite'
    && /^\d+ Command Console runs? running$/.test(agentsTab.commandConsole.busyStatusAriaLabel)
    && agentsTab.commandConsole.traceChipPresent
    && agentsTab.commandConsole.traceChipTagName === 'BUTTON'
    && /run ui-smoke-run/.test(agentsTab.commandConsole.traceChipText)
    && /Session key: agent:hn-commander:control-center:ui-smoke/.test(agentsTab.commandConsole.traceChipTitle)
    && agentsTab.commandConsole.traceChipAriaLabel.startsWith('Copy Command Console trace')
    && agentsTab.commandConsole.evidencePreviewPresent
    && !agentsTab.commandConsole.evidencePreviewOpen
    && agentsTab.commandConsole.evidencePreviewAriaLabel === 'Command Console run evidence'
    && agentsTab.commandConsole.evidenceSummaryText === 'Evidence'
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'agent' && /hn-commander/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'state' && /streaming/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'run' && /ui-smoke-run/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'session' && /ui-smoke/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'transport' && /Gateway Chat/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'progress' && /OpenClaw session/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'latest' && /UI smoke keeps this run active/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'latest' && /api_key=\[redacted\]/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'latest' && /\[redacted-phone\]/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'latest' && /\[redacted-email\]/.test(row.text))
    && !agentsTab.commandConsole.evidenceRows.some((row) => /sk-ui-smoke-secret|\+15555550123|user@example\.com/.test(row.text))
    && agentsTab.commandConsole.evidenceRows.some((row) => row.key === 'content' && /omitted/.test(row.text))
    && agentsTab.commandConsole.messagesRole === 'log'
    && agentsTab.commandConsole.messagesAriaLive === 'polite'
    && agentsTab.commandConsole.messagesAriaRelevant === 'additions text'
    && agentsTab.commandConsole.messagesAriaLabel === 'Command console responses'
    && agentsTab.commandConsole.messagesRect?.width > 0
    && agentsTab.commandConsole.messagesRect?.height > 0
  const monitorTab = workspaceTabs.find((workspaceTab) => workspaceTab.id === 'nexus-tab-monitor')
  const monitorTabsOk = Array.isArray(monitorTab?.monitorTabs)
    && monitorTab.monitorTabs.length >= 4
    && monitorTab.monitorTabs.every((innerTab) => (
      innerTab.selected
        && (
          innerTab.panelTextLength > 60
          || (innerTab.id === 'monitor-tab-logs' && innerTab.panelTextSample === 'No activity recorded.')
        )
        && innerTab.panelRect?.width > 0
        && innerTab.panelRect?.height > 0
    ))
  const ok = failures.length === 0
    && dom.textLength > 120
    && dom.rootRect?.width > 0
    && dom.rootRect?.height > 0
    && shellFillsViewport
    && dom.tabs.length >= 4
    && workspaceTabsOk
    && commandConsoleOk
    && commandConsoleTraceCopy.attempted
    && commandConsoleTraceCopy.clicked
    && /runId=ui-smoke-run/.test(commandConsoleTraceCopy.copiedText)
    && /agentId=hn-commander/.test(commandConsoleTraceCopy.copiedText)
    && /status=streaming/.test(commandConsoleTraceCopy.copiedText)
    && /sessionKey=agent:hn-commander:control-center:ui-smoke/.test(commandConsoleTraceCopy.copiedText)
    && /transport=gateway-chat/.test(commandConsoleTraceCopy.copiedText)
    && /progressLabel=OpenClaw session/.test(commandConsoleTraceCopy.copiedText)
    && /latestProgress=UI smoke keeps this run active/.test(commandConsoleTraceCopy.copiedText)
    && /api_key=\[redacted\]/.test(commandConsoleTraceCopy.copiedText)
    && /\[redacted-phone\]/.test(commandConsoleTraceCopy.copiedText)
    && /\[redacted-email\]/.test(commandConsoleTraceCopy.copiedText)
    && !/sk-ui-smoke-secret/.test(commandConsoleTraceCopy.copiedText)
    && !/\+15555550123/.test(commandConsoleTraceCopy.copiedText)
    && !/user@example\.com/.test(commandConsoleTraceCopy.copiedText)
    && /content=omitted/.test(commandConsoleTraceCopy.copiedText)
    && commandConsoleTraceCopy.traceButtonCopyState === 'copied'
    && commandConsoleTraceCopy.traceStatusText === 'Command Console trace copied.'
    && commandConsoleStopClick.attempted
    && commandConsoleStopClick.clicked
    && commandConsoleStopClick.streamClosed
    && commandConsoleStopClick.busyCleared
    && !commandConsoleStopClick.stopButtonPresentAfterClick
    && monitorCleanSlate.attempted
    && monitorCleanSlate.clicked
    && monitorCleanSlate.endpointCalled
    && monitorCleanSlate.statusPresent
    && monitorCleanSlate.statusRole === 'status'
    && monitorCleanSlate.statusAriaLive === 'polite'
    && /Clean Slate complete\./.test(monitorCleanSlate.statusText)
    && /Cleared 3 gateway log entries, 2 log tail snapshots, and 4 completed runtime calls\./.test(monitorCleanSlate.statusText)
    && /1 active run was left running\./.test(monitorCleanSlate.statusText)
    && /Session lock sweep scanned 5 locks and removed 1 stale lock\./.test(monitorCleanSlate.statusText)
    && /durable OpenClaw transcripts and active Gateway work were preserved\./.test(monitorCleanSlate.statusText)
    && /without stopping active Gateway runs/.test(monitorCleanSlate.buttonTitle)
    && monitorCleanSlate.successTextStillPresent
    && monitorCleanSlateFailure.attempted
    && monitorCleanSlateFailure.clicked
    && monitorCleanSlateFailure.mode === 'fail'
    && monitorCleanSlateFailure.endpointCalled
    && monitorCleanSlateFailure.afterStats.failures > monitorCleanSlateFailure.beforeStats.failures
    && monitorCleanSlateFailure.statusPresent
    && monitorCleanSlateFailure.statusRole === 'alert'
    && /Clean Slate failed:/.test(monitorCleanSlateFailure.statusText)
    && /ui_smoke_monitor_clear_failed/.test(monitorCleanSlateFailure.statusText)
    && /simulated Clean Slate failure/.test(monitorCleanSlateFailure.statusText)
    && !monitorCleanSlateFailure.successTextStillPresent
    && monitorTabsOk
    && bitmap.nonBlankRatio > 0.02

  return {
    label: viewport.label,
    ok,
    failures,
    consoleErrors: consoleErrors.slice(0, 8),
    screenshotPath,
    bitmap,
    shellFillsViewport,
    dom,
    commandConsoleStopSeed,
    commandConsoleTraceCopy,
    commandConsoleStopClick,
    monitorCleanSlate,
    monitorCleanSlateFailure,
    workspaceTabs,
  }
}

app.whenReady().then(async () => {
  console.error('[ui-smoke] Electron ready; loading ' + targetUrl)
  const results = []
  for (const viewport of checks) {
    console.error('[ui-smoke] Checking ' + viewport.label + ' viewport')
    results.push(await inspectViewport(viewport))
  }

  const payload = {
    ok: results.every((result) => result.ok),
    url: targetUrl,
    checkedAt: new Date().toISOString(),
    results,
  }
  console.log(JSON.stringify(payload, null, 2))
  app.exit(payload.ok ? 0 : 1)
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  app.exit(1)
})
`, 'utf8')
}

function runElectronSmoke(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [runnerAppDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: '0',
        DYSTOPAI_UI_SMOKE_OUTPUT_DIR: outputDir,
        DYSTOPAI_UI_SMOKE_URL: url,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (stderr.trim()) console.error(stderr.trim())
      const output = stdout.trim()
      const jsonStart = output.indexOf('{')
      const jsonEnd = output.lastIndexOf('}')
      const jsonText = jsonStart >= 0 && jsonEnd > jsonStart ? output.slice(jsonStart, jsonEnd + 1) : ''
      let payload = null
      if (jsonText) {
        try {
          payload = JSON.parse(jsonText)
        } catch {}
      }

      if (payload) console.log(JSON.stringify(payload, null, 2))
      if (code !== 0) {
        reject(new Error(`Electron UI smoke failed with exit code ${code}.`))
      } else if (!payload?.ok) {
        reject(new Error('Electron UI smoke did not produce a passing JSON payload.'))
      } else {
        resolve()
      }
    })
  })
}

assertBuildExists()
writeElectronRunner()

const { server, url } = await startStaticServer()
try {
  await runElectronSmoke(url)
} finally {
  await new Promise((resolve) => server.close(resolve))
}

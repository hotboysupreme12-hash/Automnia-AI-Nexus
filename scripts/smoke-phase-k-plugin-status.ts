import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

import {
  pluginPageState,
  summarizePluginPageStates,
  type PluginPageEntry,
} from '../src/components/plugins/pluginStateProjection'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-plugin-status'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'plugin-status-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'PLUGIN_STATUS_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '14-plugin-status-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type PluginCacheSummary = {
  source?: string
  refreshedAt?: number
  refreshing?: boolean
}

type PluginsPayload = {
  plugins?: PluginPageEntry[]
  configPath?: string
  cliError?: string
  cache?: PluginCacheSummary
}

type RuntimePluginSummary = {
  id?: string
  name?: string
  category?: string
  status?: string
  enabled?: boolean
  runtimeLoaded?: boolean
  configuredEnabled?: boolean | null
  channels?: string[]
  providers?: string[]
  commands?: string[]
  missingDependencies?: string[]
  restartRequired?: boolean
}

type RuntimeStatusPayload = {
  ok?: boolean
  generatedAt?: string
  monitor?: Record<string, unknown>
  plugins?: {
    enabledCount?: number
    totalCount?: number
    all?: RuntimePluginSummary[]
    enabled?: RuntimePluginSummary[]
    communication?: RuntimePluginSummary[]
    cache?: PluginCacheSummary
    cliError?: string
  }
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
      if (response.ok) return
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
  options: { method?: string; token?: string; body?: unknown; requestId?: string; timeoutMs?: number } = {},
) {
  const requestId = options.requestId || `phase-k-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({ 'X-Request-Id': requestId })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const payload = await response.json() as ApiEnvelope<T>
    assert.equal(response.headers.get('x-request-id'), requestId)
    assert.equal(payload.requestId, requestId)
    if (!response.ok || !payload.ok) {
      const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
      throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
    }
    return payload.data
  } finally {
    clearTimeout(timeout)
  }
}

async function login(port: number) {
  const data = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-plugin-status-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

function compactText(value: unknown, maxLength = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text
}

function countBy<T>(values: T[], keyFor: (value: T) => string) {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const key = keyFor(value) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function cacheSummary(cache: PluginCacheSummary | undefined) {
  assert.ok(cache && typeof cache === 'object', 'plugin status cache summary should be present')
  assert.ok(cache.source === 'openclaw' || cache.source === 'bundled', 'plugin cache source should be openclaw or bundled')
  assert.equal(typeof cache.refreshedAt, 'number', 'plugin cache refreshedAt should be numeric')
  assert.equal(typeof cache.refreshing, 'boolean', 'plugin cache refreshing should be boolean')
  return {
    source: cache.source,
    refreshedAt: cache.refreshedAt,
    refreshing: cache.refreshing,
  }
}

function validatePluginEntry(plugin: PluginPageEntry) {
  assert.equal(typeof plugin.id, 'string', 'plugin id should be a string')
  assert.match(plugin.id, /^[a-z0-9][a-z0-9._-]{0,79}$/, `plugin id should match the public plugin id pattern: ${plugin.id}`)
  assert.equal(typeof plugin.name, 'string', `${plugin.id} name should be a string`)
  assert.equal(typeof plugin.description, 'string', `${plugin.id} description should be a string`)
  assert.equal(typeof plugin.status, 'string', `${plugin.id} status should be a string`)
  assert.equal(typeof plugin.enabled, 'boolean', `${plugin.id} enabled should be boolean`)
  assert.ok(
    typeof plugin.configuredEnabled === 'boolean' || plugin.configuredEnabled === null,
    `${plugin.id} configuredEnabled should be boolean or null`,
  )
  for (const [field, value] of Object.entries({
    commands: plugin.commands,
    providers: plugin.providers,
    channels: plugin.channels,
    missingDependencies: plugin.missingDependencies,
    configFields: plugin.configFields,
    guidance: plugin.guidance,
  })) {
    assert.ok(Array.isArray(value), `${plugin.id} ${field} should be an array`)
  }
  assert.equal(typeof plugin.needsSetup, 'boolean', `${plugin.id} needsSetup should be boolean`)
  assert.equal(typeof plugin.restartRequired, 'boolean', `${plugin.id} restartRequired should be boolean`)
}

function summarizePluginStatus(payload: PluginsPayload, label: string) {
  const plugins = payload.plugins || []
  assert.ok(plugins.length > 0, `${label} should return at least one plugin`)
  for (const plugin of plugins) validatePluginEntry(plugin)

  const stateSummary = summarizePluginPageStates(plugins)
  const pageStateCounts = countBy(plugins, (plugin) => pluginPageState(plugin).key)
  const statusCounts = countBy(plugins, (plugin) => plugin.status.trim().toLowerCase() || 'unknown')
  const categoryCounts = countBy(plugins, (plugin) => plugin.category || 'unknown')
  const originCounts = countBy(plugins, (plugin) => plugin.origin || 'unknown')
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length
  const runtimeLoadedCount = plugins.filter((plugin) => plugin.runtimeLoaded).length
  const needsSetupCount = plugins.filter((plugin) => plugin.needsSetup).length
  const restartRequiredCount = plugins.filter((plugin) => plugin.restartRequired).length
  const communicationCount = plugins.filter((plugin) => plugin.category === 'communications' || plugin.channels.length > 0).length
  const withProviderCount = plugins.filter((plugin) => plugin.providers.length > 0).length
  const withCommandCount = plugins.filter((plugin) => plugin.commands.length > 0).length
  const sample = plugins.slice(0, 12).map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    status: plugin.status,
    pageState: pluginPageState(plugin).key,
    enabled: plugin.enabled,
    configuredEnabled: plugin.configuredEnabled,
    category: plugin.category,
    origin: plugin.origin,
    channels: plugin.channels.slice(0, 4),
    providers: plugin.providers.slice(0, 4),
    commands: plugin.commands.slice(0, 4),
    needsSetup: plugin.needsSetup,
    restartRequired: plugin.restartRequired,
  }))

  assert.ok(Object.values(pageStateCounts).reduce((sum, count) => sum + count, 0) === plugins.length, `${label} page states should cover every plugin`)
  assert.ok(Object.values(statusCounts).reduce((sum, count) => sum + count, 0) === plugins.length, `${label} status counts should cover every plugin`)

  return {
    totalCount: plugins.length,
    enabledCount,
    runtimeLoadedCount,
    needsSetupCount,
    restartRequiredCount,
    communicationCount,
    withProviderCount,
    withCommandCount,
    cache: cacheSummary(payload.cache),
    hasCliWarning: Boolean(payload.cliError),
    cliWarning: payload.cliError ? compactText(payload.cliError) : null,
    configPathBasename: payload.configPath ? path.basename(payload.configPath) : null,
    pageStateSummary: stateSummary,
    pageStateCounts,
    statusCounts,
    categoryCounts,
    originCounts,
    sample,
  }
}

function validateRuntimePlugins(runtimeStatus: RuntimeStatusPayload, plugins: PluginPageEntry[]) {
  assert.equal(runtimeStatus.ok, true)
  assert.ok(runtimeStatus.generatedAt && !Number.isNaN(Date.parse(runtimeStatus.generatedAt)), 'runtime status should include generatedAt')
  assert.ok(runtimeStatus.plugins && typeof runtimeStatus.plugins === 'object', 'runtime status should include plugins')
  const runtimePlugins = runtimeStatus.plugins
  assert.equal(runtimePlugins.totalCount, plugins.length, 'runtime plugin total should match /api/plugins')
  const expectedEnabledCount = plugins.filter((plugin) => {
    const status = plugin.status.trim().toLowerCase()
    return plugin.enabled || plugin.runtimeLoaded || status === 'loaded'
  }).length
  assert.equal(runtimePlugins.enabledCount, expectedEnabledCount, 'runtime plugin enabled count should match plugin status projection')
  assert.ok(Array.isArray(runtimePlugins.all), 'runtime plugin status should include all plugin summaries')
  assert.ok(Array.isArray(runtimePlugins.enabled), 'runtime plugin status should include enabled plugin summaries')
  assert.ok(Array.isArray(runtimePlugins.communication), 'runtime plugin status should include communication plugin summaries')
  assert.equal(runtimePlugins.all.length, runtimePlugins.totalCount, 'runtime plugin all summaries should match totalCount')
  assert.equal(runtimePlugins.enabled.length, Math.min(expectedEnabledCount, 24), 'runtime enabled plugin summaries should be bounded at 24')

  const pluginIds = new Set(plugins.map((plugin) => plugin.id))
  for (const summary of runtimePlugins.all) {
    assert.ok(summary.id && pluginIds.has(summary.id), `runtime plugin summary should map to /api/plugins: ${summary.id || 'missing'}`)
  }

  return {
    generatedAt: runtimeStatus.generatedAt,
    monitorPluginSource: runtimeStatus.monitor?.sources && typeof runtimeStatus.monitor.sources === 'object'
      ? (runtimeStatus.monitor.sources as Record<string, unknown>).plugins || null
      : null,
    totalCount: runtimePlugins.totalCount,
    enabledCount: runtimePlugins.enabledCount,
    allSummaryCount: runtimePlugins.all.length,
    enabledSummaryCount: runtimePlugins.enabled.length,
    communicationSummaryCount: runtimePlugins.communication.length,
    cache: cacheSummary(runtimePlugins.cache),
    hasCliWarning: Boolean(runtimePlugins.cliError),
    cliWarning: runtimePlugins.cliError ? compactText(runtimePlugins.cliError) : null,
    sample: runtimePlugins.all.slice(0, 8).map((plugin) => ({
      id: plugin.id,
      status: plugin.status,
      enabled: plugin.enabled,
      runtimeLoaded: plugin.runtimeLoaded,
      category: plugin.category,
      channels: plugin.channels?.slice(0, 4) || [],
      providers: plugin.providers?.slice(0, 4) || [],
    })),
  }
}

function validatePluginStatusSourceWiring() {
  const pluginsApi = readFileSync(path.join(root, 'src/api/plugins.ts'), 'utf8')
  const pluginsPanel = readFileSync(path.join(root, 'src/components/plugins/PluginsPanel.tsx'), 'utf8')
  const pluginStateProjection = readFileSync(path.join(root, 'src/components/plugins/pluginStateProjection.ts'), 'utf8')
  const pluginRoutes = readFileSync(path.join(root, 'server/routes/pluginRoutes.ts'), 'utf8')
  const runtimeStatusService = readFileSync(path.join(root, 'server/services/runtime/runtimeStatusService.ts'), 'utf8')

  assert.ok(pluginsApi.includes("options.force ? '/api/plugins?refresh=1' : '/api/plugins'"), 'renderer plugin API should own force-refresh status loading')
  assert.ok(pluginsPanel.includes('const loadPlugins = useCallback'), 'PluginsPanel should own the loadPlugins UI action')
  assert.ok(pluginsPanel.includes('fetchPlugins({ force: options.force })'), 'PluginsPanel should load plugin status through src/api/plugins.ts')
  assert.ok(pluginsPanel.includes('summarizePluginPageStates(plugins)'), 'PluginsPanel should render plugin status summary counts')
  assert.ok(pluginStateProjection.includes('export function pluginPageState'), 'pluginStateProjection should own page status classification')
  assert.ok(pluginStateProjection.includes('export function summarizePluginPageStates'), 'pluginStateProjection should own page status summaries')
  assert.ok(pluginRoutes.includes("app.get('/api/plugins'"), 'plugin routes should expose the plugin status endpoint')
  assert.ok(pluginRoutes.includes('options.listPluginControls({ forceRefresh })'), 'plugin status route should delegate force refresh through plugin inventory')
  assert.ok(runtimeStatusService.includes('totalCount: pluginControls.plugins.length'), 'runtime status should project plugin totals from plugin controls')
  assert.ok(runtimeStatusService.includes('all: pluginControls.plugins.map'), 'runtime status should expose all plugin summaries for Monitor checks')

  return {
    rendererApiForceRefresh: true,
    pluginsPanelLoadAction: true,
    pluginsPanelSummary: true,
    stateProjection: true,
    pluginRoute: '/api/plugins?refresh=1',
    runtimeProjection: '/api/openclaw/runtime/status?refresh=1',
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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-phase-k-plugin-status-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const gatewayLogPath = path.join(stateDir, 'gateway.log')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const pluginStatusSource = validatePluginStatusSourceWiring()
const child = spawnServer(port, stateDir, workspaceRoot, homeDir, gatewayLogPath)

try {
  await waitForReady(child, port)
  const token = await login(port)
  const refreshedPlugins = await api<PluginsPayload>(port, '/api/plugins?refresh=1', {
    token,
    requestId: 'phase-k-plugin-status-refresh',
    timeoutMs: 60_000,
  })
  const runtimeStatus = await api<RuntimeStatusPayload>(port, '/api/openclaw/runtime/status?refresh=1', {
    token,
    requestId: 'phase-k-plugin-status-runtime',
    timeoutMs: 60_000,
  })
  const cachedPlugins = await api<PluginsPayload>(port, '/api/plugins', {
    token,
    requestId: 'phase-k-plugin-status-cached',
    timeoutMs: 45_000,
  })

  const completedAt = new Date().toISOString()
  const refreshedStatus = summarizePluginStatus(refreshedPlugins, 'refreshed plugin status')
  const cachedStatus = summarizePluginStatus(cachedPlugins, 'cached plugin status')
  const runtimePlugins = validateRuntimePlugins(runtimeStatus, cachedPlugins.plugins || [])
  assert.equal(
    refreshedStatus.totalCount,
    cachedStatus.totalCount,
    'cached plugin status should preserve the refreshed plugin total during the check',
  )

  const evidence = {
    phase: 'K',
    completedItems: [126],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-plugin-status',
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    pluginStatusSource,
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
      gatewayLogPath,
    },
    routes: {
      refreshedPluginStatus: '/api/plugins?refresh=1',
      cachedPluginStatus: '/api/plugins',
      runtimeStatus: '/api/openclaw/runtime/status?refresh=1',
    },
    refreshedStatus,
    cachedStatus,
    runtimePlugins,
    server: {
      port,
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K plugin-status evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=126',
    'blockedItems=none',
    `pluginRoute=${evidence.routes.refreshedPluginStatus}`,
    `runtimeStatusRoute=${evidence.routes.runtimeStatus}`,
    `pluginTotalCount=${cachedStatus.totalCount}`,
    `pluginEnabledCount=${cachedStatus.enabledCount}`,
    `pluginPageStates=${JSON.stringify(cachedStatus.pageStateCounts)}`,
    `runtimePluginTotalCount=${runtimePlugins.totalCount}`,
    `runtimePluginEnabledCount=${runtimePlugins.enabledCount}`,
    `pluginCacheSource=${cachedStatus.cache.source}`,
    `pluginCacheRefreshing=${cachedStatus.cache.refreshing}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Plugin Status Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 126. Complete: ran an authenticated plugin status check and cross-checked the Plugins page data source with runtime status projection.',
    '',
    'Evidence:',
    '',
    `- Plugin status route: ${evidence.routes.refreshedPluginStatus}`,
    `- Runtime status route: ${evidence.routes.runtimeStatus}`,
    `- Plugins: ${cachedStatus.enabledCount} enabled of ${cachedStatus.totalCount} total`,
    `- Page states: ${JSON.stringify(cachedStatus.pageStateCounts)}`,
    `- Categories: ${JSON.stringify(cachedStatus.categoryCounts)}`,
    `- Runtime projection: ${runtimePlugins.enabledCount} enabled of ${runtimePlugins.totalCount} total`,
    `- Plugin cache: source=${cachedStatus.cache.source}, refreshing=${String(cachedStatus.cache.refreshing)}`,
    '- Evidence stores token length, status counts, and isolated local paths only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K plugin status smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

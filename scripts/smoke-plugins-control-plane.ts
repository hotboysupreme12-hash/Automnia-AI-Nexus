import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function routeBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `Missing route marker: ${marker}`)
  const remaining = source.slice(start + marker.length)
  const nextMatch = /\n\s+app\./.exec(remaining)
  const next = nextMatch ? start + marker.length + nextMatch.index : -1
  return source.slice(start, next >= 0 ? next : source.length)
}

const server = readWorkspaceFile('server/controlPlane.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const pluginRoutes = readWorkspaceFile('server/routes/pluginRoutes.ts')
const pluginRouteTests = readWorkspaceFile('tests/pluginRoutes.test.ts')
const pluginInventoryTests = readWorkspaceFile('tests/pluginInventoryService.test.ts')
const pluginPanelStateTests = readWorkspaceFile('tests/pluginsPanelStateProjection.test.ts')
const pluginsPanel = readWorkspaceFile('src/components/plugins/PluginsPanel.tsx')
const pluginsApi = readWorkspaceFile('src/api/plugins.ts')
const pluginStateProjection = readWorkspaceFile('src/components/plugins/pluginStateProjection.ts')
const pluginInventoryService = readWorkspaceFile('server/services/plugins/pluginInventoryService.ts')
const phaseKPluginStatusSmoke = readWorkspaceFile('scripts/smoke-phase-k-plugin-status.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

const pluginRouteMarkers = [
  "app.get('/api/plugins'",
  "app.get('/api/plugins/search'",
  "app.post('/api/plugins/install'",
  "app.post('/api/plugins/update-all'",
  "app.post('/api/plugins/gateway/restart'",
  "app.post('/api/plugins/clawtalk/setup'",
  "app.post('/api/plugins/:pluginId/update'",
  "app.post('/api/plugins/:pluginId/uninstall'",
  "app.post('/api/plugins/:pluginId/inspect'",
  "app.post('/api/plugins/:pluginId/config'",
  "app.post('/api/plugins/setup-terminal'",
  "app.post('/api/plugins/setup-terminal/:sessionId/input'",
  "app.post('/api/plugins/setup-terminal/:sessionId/resize'",
  "app.delete('/api/plugins/setup-terminal/:sessionId'",
  "app.post('/api/plugins/:pluginId'",
]

for (const code of ['plugin_command_failed', 'plugin_not_found', 'plugin_operation_failed', 'plugin_terminal_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

assert(server.includes('function pluginErrorStatus'), 'Plugin routes should share command-error status mapping')
assert(server.includes('function pluginErrorDetail'), 'Plugin routes should share redaction-safe error details')
assert(server.includes('registerPluginRoutes(app, {'), 'server index should register extracted plugin routes')

for (const marker of pluginRouteMarkers) {
  assert(!server.includes(marker), `server index should not inline plugin route ${marker}`)
  const block = routeBlock(pluginRoutes, marker)
  assert(block.includes('apiSuccess(res') || marker.includes('/:sessionId/input') || marker.includes('/:sessionId/resize'), `${marker} should return canonical success envelopes`)
  assert(block.includes('apiFailure(res'), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
  assert(!/\bok:\s*true\b/.test(block), `${marker} should put success data under apiSuccess, not inline ok=true`)
}

const streamBlock = routeBlock(pluginRoutes, "app.get('/api/plugins/setup-terminal/:sessionId/stream'")
assert(streamBlock.includes("'text/event-stream; charset=utf-8'"), 'Plugin setup terminal stream must remain SSE')
assert(streamBlock.includes('writeSseEvent'), 'Plugin setup terminal stream must emit SSE events')

assert(pluginsApi.includes("import { apiErrorMessage, apiRequest, type ApiRequestOptions } from './client'"), 'plugin API module should use the shared API client')
assert(pluginsApi.includes('async function pluginApiData'), 'plugin API module should centralize API-client response handling')
assert(pluginsPanel.includes("from '../../api/plugins'"), 'PluginsPanel should consume plugin API helpers')
assert(!pluginsPanel.includes("from '../../api/client'"), 'PluginsPanel should not import the shared API client directly')
assert(!/\bapiRequest(?:<|\s*\()/.test(pluginsPanel), 'PluginsPanel should not own JSON API request calls')
assert(!pluginsPanel.includes('async function pluginApiData'), 'PluginsPanel should not own plugin API response handling')
assert(!pluginsPanel.includes('fetchJsonWithTimeout'), 'PluginsPanel should not keep a local timeout fetch helper')
assert(!/\bfetch\s*\(/.test(pluginsPanel), 'PluginsPanel should not call fetch directly')
assert(!pluginsPanel.includes('body: JSON.stringify'), 'PluginsPanel should pass structured JSON bodies to apiRequest')
assert(!pluginsPanel.includes("'Content-Type': 'application/json'"), 'PluginsPanel should let apiRequest set JSON headers')

for (const helper of [
  'runOpenClawPluginCommand',
  'setupClawTalkPlugin',
  'savePluginSetup',
  'searchOpenClawPlugins',
  'installOpenClawPlugin',
  'fetchPlugins',
  'setPluginEnabled',
  'updateOpenClawPlugin',
  'updateAllOpenClawPlugins',
  'inspectOpenClawPluginRuntime',
  'restartPluginGateway',
  'uninstallOpenClawPlugin',
]) {
  assert(pluginsPanel.includes(helper), `PluginsPanel should call plugin API helper ${helper}`)
  assert(pluginsApi.includes(`function ${helper}`), `src/api/plugins.ts should export ${helper}`)
}

const expectedClientEndpoints = [
  '/api/openclaw/command',
  '/api/plugins/clawtalk/setup',
  '/api/plugins/search',
  '/api/plugins/install',
  '/api/plugins?refresh=1',
  '/api/plugins/update-all',
  '/api/plugins/gateway/restart',
]

for (const endpoint of expectedClientEndpoints) {
  assert(pluginsApi.includes(endpoint), `src/api/plugins.ts is missing API-client endpoint ${endpoint}`)
  assert(!pluginsPanel.includes(endpoint), `PluginsPanel should not own API-client endpoint ${endpoint}`)
}

for (const fragment of [
  '`/api/plugins/${encodeURIComponent(pluginId)}/config`',
  '`/api/plugins/${encodeURIComponent(pluginId)}`',
  '`/api/plugins/${encodeURIComponent(pluginId)}/update`',
  '`/api/plugins/${encodeURIComponent(pluginId)}/inspect`',
  '`/api/plugins/${encodeURIComponent(pluginId)}/uninstall`',
]) {
  assert(pluginsApi.includes(fragment), `src/api/plugins.ts is missing dynamic plugin endpoint fragment ${fragment}`)
  assert(!pluginsPanel.includes(fragment), `PluginsPanel should not own dynamic plugin endpoint fragment ${fragment}`)
}

assert(
  pluginRouteTests.includes('plugin routes redact command and operation errors across remaining plugin APIs'),
  'pluginRoutes.test.ts should cover redacted plugin errors across remaining plugin APIs',
)
for (const route of [
  '/api/plugins/search?q=known',
  '/api/plugins/update-all',
  '/api/plugins/gateway/restart',
  '/api/plugins/clawtalk/setup',
  '/api/plugins/known/update',
  '/api/plugins/known/uninstall',
  '/api/plugins/known/inspect',
  '/api/plugins/known/config',
  '/api/plugins/setup-terminal',
  '/api/plugins/known',
]) {
  assert(pluginRouteTests.includes(route), `pluginRoutes.test.ts should pin redacted error coverage for ${route}`)
}
for (const secretMarker of [
  'sk-route-redaction-secret',
  'route-secret-token',
  'cc_test_',
]) {
  assert(pluginRouteTests.includes(secretMarker), `pluginRoutes.test.ts should assert redaction for ${secretMarker}`)
}

assert(
  pluginRouteTests.includes('plugin routes preserve disabled plugin state and enable known disabled plugins'),
  'pluginRoutes.test.ts should cover disabled plugin state through the route boundary',
)
for (const disabledStateFragment of [
  'disabled-one',
  "status: 'disabled'",
  '/api/plugins/disabled-one',
  'Disabled by operator policy.',
]) {
  assert(pluginRouteTests.includes(disabledStateFragment), `pluginRoutes.test.ts should pin disabled plugin coverage for ${disabledStateFragment}`)
}

for (const disabledUiFragment of [
  'PLUGIN_FILTERS',
  "pluginMatchesFilter(plugin, filter)",
  'summarizePluginPageStates(plugins)',
  "{stateSummary.disabled} disabled",
  "plugin.enabled ? 'Stop' : 'Start'",
  'plugin.icon',
  'plugin.packageName',
  'plugin.installSpec',
]) {
  assert(pluginsPanel.includes(disabledUiFragment), `PluginsPanel should preserve disabled plugin UI state: ${disabledUiFragment}`)
}

assert(
  pluginRouteTests.includes('plugin routes preserve unavailable channel plugin state'),
  'pluginRoutes.test.ts should cover unavailable channel plugin state through the route boundary',
)
for (const unavailableRouteFragment of [
  'channel-unavailable',
  "status: 'unavailable'",
  "category: 'communications'",
  "channels: ['voice', 'sms', 'clawtalk.websocket']",
  'Channel unavailable until Gateway reports websocket readiness.',
  '/api/plugins/channel-unavailable/inspect',
]) {
  assert(
    pluginRouteTests.includes(unavailableRouteFragment),
    `pluginRoutes.test.ts should pin unavailable channel plugin coverage for ${unavailableRouteFragment}`,
  )
}

for (const unavailableUiFragment of [
  'pluginPageState(plugin)',
  "status === 'unavailable'",
  '{stateSummary.unavailable} unavailable',
  'systemImage',
]) {
  assert(
    (pluginsPanel + pluginStateProjection).includes(unavailableUiFragment),
    `PluginsPanel should preserve unavailable plugin UI state: ${unavailableUiFragment}`,
  )
}

for (const catalogFragment of [
  'official-external-plugin-catalog.json',
  'official-external-provider-catalog.json',
  'official-external-channel-catalog.json',
  'pluginRawFromExternalCatalogEntry',
  "origin: 'official-catalog'",
  'mediaUnderstandingProviderIds',
  'videoGenerationProviderIds',
]) {
  assert(pluginInventoryService.includes(catalogFragment), `Plugin inventory should preserve OpenClaw 2026.6.11 catalog support: ${catalogFragment}`)
}

for (const catalogTestFragment of [
  '@openclaw/brave-plugin',
  '@openclaw/zai-provider',
  '@openclaw/mattermost-plugin',
  'https://cdn.simpleicons.org/chrome',
  'bubble.left.and.bubble.right',
]) {
  assert(pluginInventoryTests.includes(catalogTestFragment), `Plugin tests should pin OpenClaw catalog metadata: ${catalogTestFragment}`)
}

assert(
  pluginPanelStateTests.includes('plugins page projection distinguishes beta plugin states'),
  'pluginsPanelStateProjection.test.ts should cover Plugins page beta state projection',
)
for (const stateFragment of [
  "'configured'",
  "'missing-auth'",
  "'unavailable'",
  "'failed'",
  "'disabled'",
]) {
  assert(pluginStateProjection.includes(stateFragment), `pluginStateProjection.ts should model state ${stateFragment}`)
  assert(pluginPanelStateTests.includes(stateFragment), `pluginsPanelStateProjection.test.ts should assert state ${stateFragment}`)
}

for (const pageStateFragment of [
  "{ id: 'configured', label: 'Configured' }",
  "{ id: 'missing-auth', label: 'Missing Auth' }",
  "{ id: 'unavailable', label: 'Unavailable' }",
  "{ id: 'failed', label: 'Failed' }",
  "{ id: 'disabled', label: 'Disabled' }",
  '{stateSummary.configured} configured',
  '{stateSummary.missingAuth} missing auth',
  '{stateSummary.failed} failed',
  'pluginPageState(plugin).label',
]) {
  assert(
    (pluginsPanel + pluginStateProjection).includes(pageStateFragment),
    `Plugins page should distinguish beta state fragment ${pageStateFragment}`,
  )
}

assert(phaseKPluginStatusSmoke.includes('completedItems: [126]'), 'Phase K plugin status smoke should record item 126 completion')
assert(phaseKPluginStatusSmoke.includes('/api/plugins?refresh=1'), 'Phase K plugin status smoke should force-refresh plugin status')
assert(phaseKPluginStatusSmoke.includes('/api/openclaw/runtime/status?refresh=1'), 'Phase K plugin status smoke should cross-check runtime plugin projection')
assert(phaseKPluginStatusSmoke.includes('summarizePluginPageStates'), 'Phase K plugin status smoke should reuse Plugins page state summaries')
assert(phaseKPluginStatusSmoke.includes('validateRuntimePlugins'), 'Phase K plugin status smoke should verify runtime plugin counts')
assert(phaseKPluginStatusSmoke.includes('evidenceHasSecretMaterial'), 'Phase K plugin status smoke should guard evidence redaction')

assert(
  packageJson.scripts?.['smoke:plugins-control-plane'] === 'tsx scripts/smoke-plugins-control-plane.ts',
  'package.json should expose smoke:plugins-control-plane',
)
assert(
  packageJson.scripts?.['smoke:phase-k-plugin-status'] === 'tsx scripts/smoke-phase-k-plugin-status.ts',
  'package.json should expose smoke:phase-k-plugin-status',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugins-control-plane'),
  'test:ci should run the plugin control-plane smoke',
)

console.log('Plugin control-plane canonical-envelope smoke checks passed.')

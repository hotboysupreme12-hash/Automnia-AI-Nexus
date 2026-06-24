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

const server = readWorkspaceFile('server/index.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const pluginRoutes = readWorkspaceFile('server/routes/pluginRoutes.ts')
const pluginsPanel = readWorkspaceFile('src/components/plugins/PluginsPanel.tsx')
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

assert(
  pluginsPanel.includes("import { apiErrorMessage, apiRequest, type ApiRequestOptions } from '../../api/client'"),
  'PluginsPanel should use the shared API client',
)
assert(pluginsPanel.includes('async function pluginApiData'), 'PluginsPanel should centralize API-client response handling')
assert(!pluginsPanel.includes('fetchJsonWithTimeout'), 'PluginsPanel should not keep a local timeout fetch helper')
assert(!/\bfetch\s*\(/.test(pluginsPanel), 'PluginsPanel should not call fetch directly')
assert(!pluginsPanel.includes('body: JSON.stringify'), 'PluginsPanel should pass structured JSON bodies to apiRequest')
assert(!pluginsPanel.includes("'Content-Type': 'application/json'"), 'PluginsPanel should let apiRequest set JSON headers')

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
  assert(pluginsPanel.includes(endpoint), `PluginsPanel is missing API-client endpoint ${endpoint}`)
}

for (const fragment of [
  '}/config`',
  '`/api/plugins/${encodeURIComponent(plugin.id)}`',
  '}/update`',
  '}/inspect`',
  '}/uninstall`',
]) {
  assert(pluginsPanel.includes(fragment), `PluginsPanel is missing dynamic plugin endpoint fragment ${fragment}`)
}

assert(
  packageJson.scripts?.['smoke:plugins-control-plane'] === 'tsx scripts/smoke-plugins-control-plane.ts',
  'package.json should expose smoke:plugins-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugins-control-plane'),
  'test:ci should run the plugin control-plane smoke',
)

console.log('Plugin control-plane canonical-envelope smoke checks passed.')

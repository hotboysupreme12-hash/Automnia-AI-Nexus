import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function routeBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `Missing route marker: ${marker}`)
  const remaining = source.slice(start + marker.length)
  const nextMatch = /\n\s+app\./.exec(remaining)
  const next = nextMatch ? start + marker.length + nextMatch.index : -1
  return source.slice(start, next >= 0 ? next : source.length)
}

function assertCanonicalRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(source), `${name} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(source), `${name} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(source), `${name} should not return raw status JSON errors`)
}

const server = readWorkspaceFile('server/controlPlane.ts')
const partyCoordinationRoutes = readWorkspaceFile('server/routes/partyCoordinationRoutes.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const openclawCommandRoutes = readWorkspaceFile('server/routes/openclawCommandRoutes.ts')
const pluginsPanel = readWorkspaceFile('src/components/plugins/PluginsPanel.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'openclaw_command_failed',
  'openclaw_summary_failed',
  'party_coordination_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const summaryBlock = routeBlock(openclawCommandRoutes, "app.get('/api/openclaw/summary'")
const commandBlock = routeBlock(openclawCommandRoutes, "app.post('/api/openclaw/command'")
const parallelHealthBlock = routeBlock(partyCoordinationRoutes, "app.post('/api/party/parallel-health'")

assertCanonicalRoute('/api/openclaw/summary', summaryBlock)
assertCanonicalRoute('/api/openclaw/command', commandBlock)
assertCanonicalRoute('/api/party/parallel-health', parallelHealthBlock)

assert(!server.includes("app.get('/api/openclaw/summary'"), 'OpenClaw summary route should be owned by server/routes/openclawCommandRoutes.ts')
assert(!server.includes("app.post('/api/openclaw/command'"), 'OpenClaw command route should be owned by server/routes/openclawCommandRoutes.ts')
assert(server.includes('registerOpenClawCommandRoutes(app, {'), 'server/index.ts should register extracted OpenClaw command routes')
assert(server.includes('openclawConfigPath: OPENCLAW_CONFIG_PATH'), 'server/index.ts should inject the OpenClaw config path')
assert(
  server.includes("import { registerPartyCoordinationRoutes } from './routes/partyCoordinationRoutes'"),
  'server should import party coordination routes',
)
assert(server.includes('registerPartyCoordinationRoutes(app, {'), 'server should register party coordination routes')
assert(!server.includes("app.post('/api/party/parallel-health'"), 'server should not inline parallel-health route')

assert(commandBlock.includes('pluginCommandResult(args, result)'), 'OpenClaw command route should preserve command result evidence')
assert(commandBlock.includes('ok: result.code === 0'), 'OpenClaw command route should preserve command success data')
assert(commandBlock.includes('listPluginControls({ forceRefresh: true })'), 'OpenClaw command route should preserve optional plugin refresh')
assert(server.includes('registerRuntimeRoutes(app, {'), 'OpenClaw command smoke should allow extracted runtime route registration')
assert(parallelHealthBlock.includes('looksParallel'), 'parallel-health should preserve parallel timing diagnostics')
assert(parallelHealthBlock.includes('parallelEfficiency'), 'parallel-health should preserve efficiency diagnostics')

assert(pluginsPanel.includes("'/api/openclaw/command'"), 'PluginsPanel should expose the OpenClaw command endpoint')
assert(pluginsPanel.includes('pluginApiData<PluginApiPayload>'), 'PluginsPanel should use shared plugin API handling for OpenClaw command')
assert(!/\bfetch\s*\(/.test(pluginsPanel), 'PluginsPanel should not bypass the canonical API client')

assert(
  packageJson.scripts?.['smoke:openclaw-command-control-plane'] === 'tsx scripts/smoke-openclaw-command-control-plane.ts',
  'package.json should expose smoke:openclaw-command-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:openclaw-command-control-plane'),
  'test:ci should run the OpenClaw command control-plane smoke',
)

console.log('openclaw command control-plane contract ok')

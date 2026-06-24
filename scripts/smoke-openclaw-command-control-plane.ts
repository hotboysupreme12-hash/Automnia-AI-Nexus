import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert(start >= 0, `Missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert(end >= 0, `Missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

function assertCanonicalRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(source), `${name} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(source), `${name} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(source), `${name} should not return raw status JSON errors`)
}

const server = readWorkspaceFile('server/index.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const pluginsPanel = readWorkspaceFile('src/components/plugins/PluginsPanel.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'openclaw_command_failed',
  'openclaw_summary_failed',
  'party_coordination_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const summaryBlock = sliceBetween(server, "app.get('/api/openclaw/summary'", 'function clearRuntimeMonitorHistory')
const commandBlock = sliceBetween(server, "app.post('/api/openclaw/command'", 'async function buildRuntimeStatusPayload')
const parallelHealthBlock = sliceBetween(server, "app.post('/api/party/parallel-health'", "app.get('/api/missions'")

assertCanonicalRoute('/api/openclaw/summary', summaryBlock)
assertCanonicalRoute('/api/openclaw/command', commandBlock)
assertCanonicalRoute('/api/party/parallel-health', parallelHealthBlock)

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

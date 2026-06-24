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
  const nextCandidates = ['\napp.', '\n  app.']
    .map((needle) => source.indexOf(needle, start + marker.length))
    .filter((index) => index >= 0)
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1
  return source.slice(start, next >= 0 ? next : source.length)
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert(start >= 0, `Missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert(end >= 0, `Missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

function assertNoRawJsonResponse(name: string, source: string) {
  assert(!/\breturn\s+res\.json\s*\(/.test(source), `${name} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(source), `${name} should not return raw status JSON payloads`)
}

function assertCanonicalRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(source), `${name} should return canonical error envelopes`)
  assertNoRawJsonResponse(name, source)
}

const server = readWorkspaceFile('server/index.ts')
const agentTurnRoutes = readWorkspaceFile('server/routes/agentTurnRoutes.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const store = readWorkspaceFile('src/store/nexusStore.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['agent_turn_failed', 'clawtalk_console_failed', 'party_handoff_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const clawTalkFinalBlock = routeBlock(server, "app.post('/api/openclaw/clawtalk-console/final'")
const streamBlock = sliceBetween(
  agentTurnRoutes,
  "app.post('/api/openclaw/agent-turn/stream'",
  "app.post('/api/openclaw/agent-turn'",
)
const agentTurnBlock = routeBlock(agentTurnRoutes, "app.post('/api/openclaw/agent-turn'")
const browserPreflightBlock = sliceBetween(
  server,
  "app.get('/api/browser/preflight'",
  'type StartShiftPayload',
)
const runBufferedBlock = sliceBetween(
  server,
  'async function runBufferedAgentTurnForStream',
  'async function runGatewayAgentTurnForStream',
)

assert(server.includes("import { registerAgentTurnRoutes } from './routes/agentTurnRoutes'"), 'server should import agent-turn route module')
assert(server.includes('registerAgentTurnRoutes(app, {'), 'server should register agent-turn routes')
assert(!server.includes("app.post('/api/openclaw/agent-turn/stream'"), 'server should not inline the agent-turn stream route')
assert(!server.includes("app.post('/api/openclaw/agent-turn'"), 'server should not inline the buffered agent-turn route')

assertCanonicalRoute('/api/openclaw/clawtalk-console/final', clawTalkFinalBlock)
assert(clawTalkFinalBlock.includes('isValidAgentId(agentId)'), 'ClawTalk final should validate agent ids')
assert(clawTalkFinalBlock.includes('isRetiredAgentId(agentId)'), 'ClawTalk final should reject retired agents')
assert(clawTalkFinalBlock.includes("'clawtalk_console_failed'"), 'ClawTalk final should use typed infrastructure errors')
assert(clawTalkFinalBlock.includes('deduped: !emitted'), 'ClawTalk final should preserve dedupe evidence')

assert(streamBlock.includes('initializeSseResponse(res)'), 'agent-turn stream route should remain an SSE endpoint')
assert(streamBlock.includes("emit('final'"), 'agent-turn stream route should still emit final SSE frames')
assert(!streamBlock.includes('apiSuccess(res, compactHttpJsonPayload'), 'agent-turn stream route should not become a buffered JSON route')

assertCanonicalRoute('/api/openclaw/agent-turn', agentTurnBlock)
assert(agentTurnBlock.includes("'invalid_payload'"), 'agent-turn should type invalid payload failures')
assert(agentTurnBlock.includes("'agent_turn_failed'"), 'agent-turn should type pre-reply infrastructure failures')
assert(agentTurnBlock.includes("'party_handoff_failed'"), 'agent-turn should type delegation policy failures')
assert(agentTurnBlock.includes('return apiSuccess(res, compactHttpJsonPayload({'), 'agent-turn final payload should be canonical data')
assert(agentTurnBlock.includes('return apiSuccess(res, {'), 'agent-turn compatibility branches should return canonical data')
assert(agentTurnBlock.includes('preflight,'), 'agent-turn should preserve browser preflight evidence in data')
assert(agentTurnBlock.includes('handoffOk'), 'agent-turn should preserve handoff outcome evidence')
assert(agentTurnBlock.includes('runtimeContext: agentRuntimeContextPayload(agent, context)'), 'agent-turn should preserve runtime context evidence')
assert(agentTurnBlock.includes('compactHttpJsonPayload({'), 'agent-turn should compact large diagnostics before returning them')

assert(/apiSuccess\s*\(\s*res/.test(browserPreflightBlock), '/api/browser/preflight should return a canonical success envelope')
assertNoRawJsonResponse('/api/browser/preflight', browserPreflightBlock)
assert(browserPreflightBlock.includes('ok: preflight.ok'), '/api/browser/preflight should preserve preflight.ok as data')

assert(runBufferedBlock.includes('unwrapCanonicalApiPayload(JSON.parse(text) as unknown)'), 'stream fallback should unwrap canonical agent-turn data')
assert(runBufferedBlock.includes("typeof parsedPayload === 'object'"), 'stream fallback should guard parsed canonical payload shape')
assert(runBufferedBlock.includes('!Array.isArray(parsedPayload)'), 'stream fallback should reject array payloads as agent-turn data')

assert(
  store.includes("apiRequest<AT>('/api/openclaw/agent-turn'"),
  'renderer should continue calling non-SSE agent-turn through the canonical API client',
)
assert(
  store.includes("fetch(apiUrl('/api/openclaw/agent-turn/stream')"),
  'renderer should preserve direct fetch only for the SSE agent-turn stream',
)

assert(
  packageJson.scripts?.['smoke:agent-turn-control-plane'] === 'tsx scripts/smoke-agent-turn-control-plane.ts',
  'package.json should expose smoke:agent-turn-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:agent-turn-control-plane'),
  'test:ci should run the agent-turn control-plane smoke',
)

console.log('agent-turn control-plane contract ok')

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

const server = readWorkspaceFile('server/controlPlane.ts')
const agentTurnRoutes = readWorkspaceFile('server/routes/agentTurnRoutes.ts')
const partyManagementRoutes = readWorkspaceFile('server/routes/partyManagementRoutes.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const store = readWorkspaceFile('src/store/nexusStore.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'agent_preflight_failed',
  'agent_retire_failed',
  'agent_session_operation_failed',
  'party_operation_failed',
  'recruit_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/party/overview'",
  "app.post('/api/party/recruit'",
  "app.delete('/api/party/agent/:agentId'",
]) {
  const block = routeBlock(partyManagementRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

for (const marker of [
  "app.post('/api/openclaw/agent-preflight'",
  "app.post('/api/openclaw/agent-turn/sessions/clear'",
]) {
  const block = routeBlock(agentTurnRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

assert(server.includes("import { registerPartyManagementRoutes } from './routes/partyManagementRoutes'"), 'server should import party management route module')
assert(server.includes('registerPartyManagementRoutes(app, partyManagementRoutesContext)'), 'server should register party management routes')
assert(server.includes("import { registerAgentTurnRoutes } from './routes/agentTurnRoutes'"), 'server should import agent-turn route module')
assert(server.includes('registerAgentTurnRoutes(app, {'), 'server should register agent-turn routes')

assert(store.includes("apiRequest<AgentRuntimePreflightPayload>('/api/openclaw/agent-preflight'"), 'preflight should use apiRequest')
assert(store.includes("apiRequest<AT>('/api/openclaw/agent-turn'"), 'buffered agent-turn fallback should use apiRequest')
assert(store.includes("apiRequest<PartyOverviewPayload>('/api/party/overview'"), 'party overview should use apiRequest')
assert(store.includes("apiRequest<RecruitAgentPayload>('/api/party/recruit'"), 'recruit should use apiRequest')
assert(store.includes('apiRequest(`/api/party/agent/${encodeURIComponent(agentId)}/config`'), 'post-recruit config save should use apiRequest')
assert(store.includes('apiRequest(`/api/party/agent/${encodeURIComponent(normalized)}`'), 'retire should use apiRequest')
assert(store.includes("apiRequest<AgentTurnSessionClearPayload>('/api/openclaw/agent-turn/sessions/clear'"), 'session clear should use apiRequest')

for (const legacyFragment of [
  "fetch(apiUrl('/api/openclaw/agent-preflight')",
  "fetch(apiUrl('/api/openclaw/agent-turn')",
  "fetch('/api/party/overview')",
  "fetch('/api/party/recruit')",
  'fetch(`/api/party/agent/${agentId}/config`',
  'fetch(apiUrl(`/api/party/agent/${encodeURIComponent(normalized)}`)',
  "fetch('/api/openclaw/agent-turn/sessions/clear'",
]) {
  assert(!store.includes(legacyFragment), `nexusStore should not use legacy ${legacyFragment}`)
}

const directFetchMatches = [...store.matchAll(/\bfetch\s*\(/g)]
assert(directFetchMatches.length === 1, `nexusStore should keep exactly one direct fetch for SSE, found ${directFetchMatches.length}`)
assert(
  store.includes("fetch(apiUrl('/api/openclaw/agent-turn/stream')"),
  'the remaining direct fetch should be the SSE agent-turn stream',
)
assert(store.includes("contentType.includes('text/event-stream')"), 'SSE route should still require event-stream parsing')
assert(store.includes('parseControlStream(res)'), 'SSE route should still use the streaming parser')

assert(
  packageJson.scripts?.['smoke:nexus-control-plane'] === 'tsx scripts/smoke-nexus-control-plane.ts',
  'package.json should expose smoke:nexus-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:nexus-control-plane'),
  'test:ci should run the nexus control-plane smoke',
)

console.log('nexus control-plane contract ok')

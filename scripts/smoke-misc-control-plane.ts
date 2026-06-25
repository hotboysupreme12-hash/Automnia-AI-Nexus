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

function assertNoRawJsonResponse(name: string, source: string) {
  assert(!/\breturn\s+res\.json\s*\(/.test(source), `${name} should not return raw res.json payloads`)
  assert(!/\bres\.json\s*\(/.test(source), `${name} should not call res.json directly`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(source), `${name} should not return raw status JSON payloads`)
}

function assertCanonicalRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(source), `${name} should return canonical error envelopes`)
  assertNoRawJsonResponse(name, source)
}

function assertCanonicalSuccessRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assertNoRawJsonResponse(name, source)
}

const server = readWorkspaceFile('server/controlPlane.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const diagnosticsRoutes = readWorkspaceFile('server/routes/diagnosticsRoutes.ts')
const partyManagementRoutes = readWorkspaceFile('server/routes/partyManagementRoutes.ts')
const agentConfigRoutes = readWorkspaceFile('server/routes/agentConfigRoutes.ts')
const pluginRoutes = readWorkspaceFile('server/routes/pluginRoutes.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'agent_config_sync_failed',
  'avatar_preview_failed',
  'plugin_terminal_failed',
  'party_operation_failed',
  'recruit_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

assert(server.includes('registerDiagnosticsRoutes(app, {'), 'server index should register extracted diagnostics routes')
assert(server.includes('registerPartyManagementRoutes(app, partyManagementRoutesContext)'), 'control plane should register party management routes')
assert(server.includes('registerAgentConfigRoutes(app, agentConfigRoutesContext)'), 'control plane should register agent config routes')
assert(!server.includes("app.get('/api/health'"), 'server index should not inline the health route')
assert(!server.includes("app.get('/api/runtime/version-check'"), 'server index should not inline the runtime version-check route')
assert(!server.includes("app.post('/api/doctor/run'"), 'server index should not inline the doctor run route')

for (const marker of [
  "app.get('/api/health'",
  "app.get('/api/runtime/version-check'",
] ) {
  assertCanonicalSuccessRoute(marker, routeBlock(diagnosticsRoutes, marker))
}

for (const marker of [
  "app.post('/api/doctor/run'",
  "app.get('/api/doctor/recent'",
]) {
  assertCanonicalRoute(marker, routeBlock(diagnosticsRoutes, marker))
}

for (const marker of [
  "app.put('/api/party/profile/:agentId'",
  "app.post('/api/party/identity'",
  "app.post('/api/party/recruit/auto-markdown'",
  "app.post('/api/party/workspace'",
  "app.post('/api/party/provision-resources'",
  "app.post('/api/party/workspace/cleanup-doctrine'",
]) {
  assertCanonicalRoute(marker, routeBlock(partyManagementRoutes, marker))
}
assertCanonicalRoute(
  "app.post('/api/party/configs/sync'",
  routeBlock(agentConfigRoutes, "app.post('/api/party/configs/sync'"),
)

const pluginSetupStreamBlock = routeBlock(pluginRoutes, "app.get('/api/plugins/setup-terminal/:sessionId/stream'")
assertNoRawJsonResponse('/api/plugins/setup-terminal/:sessionId/stream', pluginSetupStreamBlock)
assert(pluginSetupStreamBlock.includes("apiFailure(res, 404, 'plugin_not_found'"), 'setup-terminal stream should return canonical not-found errors before SSE starts')
assert(pluginSetupStreamBlock.includes("'Content-Type': 'text/event-stream; charset=utf-8'"), 'setup-terminal stream should preserve SSE transport')
assert(pluginSetupStreamBlock.includes("writeSseEvent(res, 'snapshot'"), 'setup-terminal stream should preserve snapshot SSE events')

const avatarPreviewBlock = routeBlock(partyManagementRoutes, "app.get('/api/party/avatar/:agentId'")
assertNoRawJsonResponse('/api/party/avatar/:agentId', avatarPreviewBlock)
assert(avatarPreviewBlock.includes("apiFailure(res, 404, 'avatar_preview_failed'"), 'avatar preview should return canonical not-found errors')
assert(avatarPreviewBlock.includes("apiFailure(res, 400, 'avatar_preview_failed'"), 'avatar preview should return canonical unsupported-avatar errors')
assert(avatarPreviewBlock.includes('res.redirect(agent.avatar)'), 'avatar preview should preserve external URL redirects')
assert(avatarPreviewBlock.includes('return res.send(bytes)'), 'avatar preview should preserve binary image responses')

const workspaceBlock = routeBlock(partyManagementRoutes, "app.post('/api/party/workspace'")
assert(workspaceBlock.includes('apiSuccess(res, await workspaceAccessFailurePayload(error, normalizedWorkspace))'), 'workspace validation should preserve suggested-workspace payloads as canonical data')
assert(workspaceBlock.includes("'agent_not_found'"), 'workspace updates should type missing-agent errors')
assert(workspaceBlock.includes("'party_operation_failed'"), 'workspace updates should type persistence failures')

const autoMarkdownBlock = routeBlock(partyManagementRoutes, "app.post('/api/party/recruit/auto-markdown'")
assert(autoMarkdownBlock.includes("'invalid_payload'"), 'Auto Forge should type malformed input')
assert(autoMarkdownBlock.includes("'recruit_failed'"), 'Auto Forge should type provider/model generation failures')
assert(autoMarkdownBlock.includes('personalityDepth: normalizeRecruitPersonalityDepth'), 'Auto Forge should preserve personality-depth evidence')
assert(autoMarkdownBlock.includes('files: markdownFiles'), 'Auto Forge should preserve generated file evidence')

const identityBlock = routeBlock(partyManagementRoutes, "app.post('/api/party/identity'")
assert(identityBlock.includes('ok: result.code === 0'), 'identity route should preserve OpenClaw CLI result ok evidence in data')
assert(identityBlock.includes('stdout: result.stdout'), 'identity route should preserve stdout evidence')
assert(identityBlock.includes('stderr: result.stderr'), 'identity route should preserve stderr evidence')

assert(
  packageJson.scripts?.['smoke:misc-control-plane'] === 'tsx scripts/smoke-misc-control-plane.ts',
  'package.json should expose smoke:misc-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:misc-control-plane'),
  'test:ci should run the misc control-plane smoke',
)

console.log('misc control-plane contract ok')

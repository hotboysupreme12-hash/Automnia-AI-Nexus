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
  const next = source.indexOf('\napp.', start + marker.length)
  return source.slice(start, next >= 0 ? next : source.length)
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
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['party_dispatch_failed', 'party_handoff_failed', 'party_coordination_failed']) {
  assert(server.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const dispatchBlock = routeBlock(server, "app.post('/api/party/dispatch'")
const handoffBlock = routeBlock(server, "app.post('/api/party/agent-to-agent'")
const delegationCompatibilityBlock = sliceBetween(
  server,
  "const handoffResponse: { ok: boolean; status: number; json: () => Promise<unknown> } = await fetch(`http://127.0.0.1:${PORT}/api/party/agent-to-agent`",
  'const context = await resolveAgentRunContext(agent)',
)

assertCanonicalRoute('/api/party/dispatch', dispatchBlock)
assertCanonicalRoute('/api/party/agent-to-agent', handoffBlock)

assert(dispatchBlock.includes("'party_dispatch_failed'"), 'dispatch route should use a typed dispatch infrastructure error')
assert(dispatchBlock.includes("'agent_not_found'"), 'dispatch route should reject missing party agents before running')
assert(dispatchBlock.includes('Invalid or retired agent id'), 'dispatch route should reject invalid or retired assignment agents')
assert(dispatchBlock.includes('outputs.every((item) => item.ok)'), 'dispatch route should preserve execution success evidence in data.ok')
assert(dispatchBlock.includes('parallelEfficiency'), 'dispatch route should preserve parallel timing telemetry')
assert(dispatchBlock.includes('writeTeamSyncSnapshot'), 'dispatch route should keep TEAM_SYNC state updates')

assert(handoffBlock.includes("'party_handoff_failed'"), 'handoff route should use a typed handoff infrastructure/policy error')
assert(handoffBlock.includes("'agent_not_found'"), 'handoff route should reject missing party agents canonically')
assert(handoffBlock.includes('Agent-to-agent policy denies this route'), 'handoff route should preserve policy denial detail')
assert(handoffBlock.includes('ok: false'), 'handoff route should preserve failed handoff execution as data')
assert(handoffBlock.includes('from:'), 'handoff route should preserve upstream agent evidence')
assert(handoffBlock.includes('to:'), 'handoff route should preserve downstream agent evidence')

assert(server.includes('function unwrapCanonicalApiPayload'), 'server should include canonical payload unwrapping for internal compatibility callers')
assert(delegationCompatibilityBlock.includes('unwrapCanonicalApiPayload(rawPayload)'), 'agent-turn delegation should unwrap canonical handoff data')
assert(delegationCompatibilityBlock.includes('handoffPayload.ok !== false'), 'agent-turn delegation should honor handoff data.ok failures')
assert(
  delegationCompatibilityBlock.includes('return apiSuccess(res, {'),
  'agent-turn delegation should preserve canonical data evidence instead of throwing away failed handoff payloads',
)

assert(
  packageJson.scripts?.['smoke:party-coordination-control-plane'] === 'tsx scripts/smoke-party-coordination-control-plane.ts',
  'package.json should expose smoke:party-coordination-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:party-coordination-control-plane'),
  'test:ci should run the party coordination control-plane smoke',
)

console.log('party coordination control-plane contract ok')

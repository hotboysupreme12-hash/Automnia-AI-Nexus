import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const NEXUS_STORE_MAX_LINES = 4_274
const NEXUS_STORE_MAX_API_REQUEST_CALLS = 3
const NEXUS_STORE_MAX_API_PATH_LINES = 4

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const store = readWorkspaceFile('src/store/nexusStore.ts')
const apiClient = readWorkspaceFile('src/api/client.ts')
const partyApi = readWorkspaceFile('src/api/party.ts')
const agentTurnsApi = readWorkspaceFile('src/api/agentTurns.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }
const lines = store.split(/\r?\n/)
const apiRequestCallLines = lines.filter((line) => /\bapiRequest(?:<|\s*\()/.test(line))
const apiPathLines = lines.filter((line) => /['"`]\/api\//.test(line))
const directFetchMatches = [...store.matchAll(/\bfetch\s*\(/g)]

assert.ok(
  lines.length <= NEXUS_STORE_MAX_LINES,
  `src/store/nexusStore.ts grew past the Phase H item 76 budget: ${lines.length}/${NEXUS_STORE_MAX_LINES} lines. Move API calls or projection state into src/api/* or focused renderer services before adding store code.`,
)
assert.ok(
  apiRequestCallLines.length <= NEXUS_STORE_MAX_API_REQUEST_CALLS,
  `src/store/nexusStore.ts added API request calls: ${apiRequestCallLines.length}/${NEXUS_STORE_MAX_API_REQUEST_CALLS}. Move new backend calls into src/api/* modules first.`,
)
assert.ok(
  apiPathLines.length <= NEXUS_STORE_MAX_API_PATH_LINES,
  `src/store/nexusStore.ts added API path literals: ${apiPathLines.length}/${NEXUS_STORE_MAX_API_PATH_LINES}. Move new backend endpoints into src/api/* modules first.`,
)
assert.equal(directFetchMatches.length, 1, `nexusStore should keep exactly one direct fetch for SSE, found ${directFetchMatches.length}`)
assert.match(
  store,
  /fetch\s*\(\s*apiUrl\('\/api\/openclaw\/agent-turn\/stream'\)/,
  'the remaining nexusStore direct fetch should be the SSE agent-turn stream',
)
assert.match(store, /contentType\.includes\('text\/event-stream'\)/, 'SSE route should still require event-stream parsing')
assert.match(store, /parseControlStream\(res\)/, 'SSE route should still use the streaming parser')
assert.match(apiClient, /export async function apiRequest/, 'renderer API client should remain the JSON request boundary')
assert.match(partyApi, /export function fetchPartyOverview/, 'party API module should own party overview requests')
assert.match(partyApi, /apiRequest<PartyOverviewPayload>\('\/api\/party\/overview'/, 'party overview endpoint should live in src/api/party.ts')
assert.match(partyApi, /export function saveAgentConfig/, 'party API module should own agent config saves')
assert.match(partyApi, /apiRequest<AgentConfigSavePayload>\(`\/api\/party\/agent\/\$\{encodeURIComponent\(agentId\)\}\/config`/, 'agent config endpoint should live in src/api/party.ts')
assert.match(partyApi, /export function recruitPartyAgent/, 'party API module should own recruit requests')
assert.match(partyApi, /apiRequest<RecruitAgentPayload>\('\/api\/party\/recruit'/, 'recruit endpoint should live in src/api/party.ts')
assert.match(partyApi, /export function saveAgentResource/, 'party API module should own agent resource saves')
assert.match(partyApi, /apiRequest<AgentResourceSavePayload>\(`\/api\/party\/resources\/\$\{encodeURIComponent\(agentId\)\}\/\$\{encodeURIComponent\(file\)\}`/, 'agent resource endpoint should live in src/api/party.ts')
assert.match(partyApi, /export function retirePartyAgent/, 'party API module should own retire requests')
assert.match(agentTurnsApi, /export function preflightAgentRuntime/, 'agent-turn API module should own runtime preflight requests')
assert.match(agentTurnsApi, /apiRequest<AgentRuntimePreflightPayload>\('\/api\/openclaw\/agent-preflight'/, 'agent preflight endpoint should live in src/api/agentTurns.ts')
assert.match(agentTurnsApi, /export function sendBufferedAgentTurn/, 'agent-turn API module should own buffered turn requests')
assert.match(agentTurnsApi, /apiRequest<AgentTurnPayload>\('\/api\/openclaw\/agent-turn'/, 'buffered agent-turn endpoint should live in src/api/agentTurns.ts')
assert.match(agentTurnsApi, /export function clearAgentTurnSessions/, 'agent-turn API module should own session clear requests')
assert.match(agentTurnsApi, /apiRequest<AgentTurnSessionClearPayload>\('\/api\/openclaw\/agent-turn\/sessions\/clear'/, 'session clear endpoint should live in src/api/agentTurns.ts')
assert.match(store, /from '..\/api\/party'/, 'nexusStore should consume party API helpers')
assert.match(store, /from '..\/api\/agentTurns'/, 'nexusStore should consume agent-turn API helpers')
assert.equal(
  packageJson.scripts?.['smoke:renderer-store-boundary'],
  'tsx scripts/smoke-renderer-store-boundary.ts',
  'package.json should expose smoke:renderer-store-boundary',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:renderer-store-boundary'),
  'test:ci should run the renderer store boundary smoke',
)

console.log(
  `renderer store boundary ok (${lines.length}/${NEXUS_STORE_MAX_LINES} nexusStore lines, ${apiRequestCallLines.length}/${NEXUS_STORE_MAX_API_REQUEST_CALLS} apiRequest calls, ${directFetchMatches.length} direct SSE fetch)`,
)

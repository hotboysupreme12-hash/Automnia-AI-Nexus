import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const apiClient = read('src/api/client.ts')
const partyApi = read('src/api/party.ts')
const providerAuthApi = read('src/api/providerAuth.ts')
const store = read('src/store/nexusStore.ts')
const runtimeProjectionState = read('src/store/runtimeProjectionState.ts')
const editor = read('src/components/editor/AgentEditorModal.tsx')
const modelSelector = read('src/components/party/ModelSelectorModal.tsx')
const providerAuth = read('src/components/auth/ProviderAuthModal.tsx')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(apiClient, /export async function apiRequest/, 'canonical API client must expose apiRequest')
assert.match(apiClient, /X-Request-Id/, 'API client must attach request IDs')
assert.match(apiClient, /Authorization/, 'API client must attach bearer authentication when available')
assert.match(apiClient, /timeoutMs/, 'API client must support request timeouts')
assert.match(apiClient, /redactDiagnosticText/, 'API client diagnostics must use shared redaction')
assert.match(apiClient, /apiUrl\(path\)/, 'API client must resolve dev/prod API base URLs through apiUrl')
assert.match(partyApi, /export function saveAgentConfig/, 'party API module must expose the extracted config save helper')
assert.match(partyApi, /apiRequest<AgentConfigSavePayload>\(`\/api\/party\/agent\/\$\{encodeURIComponent\(agentId\)\}\/config`/, 'agent config saves must use the canonical API client in src/api/party.ts')

const heartbeatPersist = store.slice(
  store.indexOf('function persistHeartbeatConfig'),
  store.indexOf('function persistRuntimePolicy'),
)
const runtimePersist = store.slice(
  store.indexOf('function persistRuntimePolicy'),
  store.indexOf('function normalizeOperatorPrompt'),
)
const storeConfigActionStart = store.lastIndexOf('updateCoreAttributes:')
const storeConfigActionEnd = store.indexOf('/* --- coordination actions', storeConfigActionStart)
assert.notEqual(storeConfigActionStart, -1, 'store config action implementation must be present')
assert.notEqual(storeConfigActionEnd, -1, 'store coordination boundary must be present')
const storeConfigActions = store.slice(storeConfigActionStart, storeConfigActionEnd)

assert.match(store, /agentConfigSaveStatus/, 'store must expose agent config save lifecycle state')
assert.match(store, /from '\.\/runtimeProjectionState'/, 'store must consume config save projection helpers from runtimeProjectionState')
assert.match(runtimeProjectionState, /export type AgentConfigSaveScope = 'heartbeat' \| 'runtime' \| 'profile' \| 'policy' \| 'mds' \| 'skills'/, 'save lifecycle must cover profile, policy, MDS, and skills scopes')
assert.match(runtimeProjectionState, /export type AgentConfigSaveReporter/, 'runtime projection state module must expose config save reporter typing')
assert.match(runtimeProjectionState, /export function updateAgentConfigSaveStatus/, 'runtime projection state module must own config save status projection updates')
assert.doesNotMatch(store, /type AgentConfigSaveScope =/, 'config save scope ownership should stay out of nexusStore after Phase H item 82')
assert.match(heartbeatPersist, /saveAgentConfig/, 'heartbeat persistence must use the extracted config API helper')
assert.match(runtimePersist, /saveAgentConfig/, 'runtime policy persistence must use the extracted config API helper')
assert.match(store, /function persistAgentConfigPatch/, 'store must have a canonical config patch persistence helper')
assert.doesNotMatch(heartbeatPersist, /catch\(\(\)\s*=>\s*\{\}\)/, 'heartbeat persistence must not swallow save failures')
assert.doesNotMatch(runtimePersist, /catch\(\(\)\s*=>\s*\{\}\)/, 'runtime policy persistence must not swallow save failures')
assert.doesNotMatch(storeConfigActions, /catch\(\(\)\s*=>\s*\{\}\)/, 'agent config actions must not swallow save failures')
assert.match(heartbeatPersist, /configSaveEntry\('failed'/, 'heartbeat persistence must report failed saves')
assert.match(runtimePersist, /configSaveEntry\('failed'/, 'runtime persistence must report failed saves')
assert.match(storeConfigActions, /persistConfigPatch\(aid, 'profile'/, 'profile updates must use lifecycle config persistence')
assert.match(storeConfigActions, /persistConfigPatch\(aid, 'mds'/, 'MDS updates must use lifecycle config persistence')
assert.match(storeConfigActions, /persistConfigPatch\(aid, 'skills'/, 'skill updates must use lifecycle config persistence')
assert.match(storeConfigActions, /save failed/, 'agent config action failures must be reported')
assert.match(heartbeatPersist, /heartbeatConfigSaveSeq/, 'heartbeat persistence must keep stale-save sequencing')
assert.match(runtimePersist, /runtimePolicySaveSeq/, 'runtime persistence must keep stale-save sequencing')

assert.match(editor, /agentConfigSaveStatus/, 'agent editor must read save lifecycle state')
assert.match(editor, /role=\{heartbeatSaveStatus\?\.phase === 'failed' \? 'alert' : 'status'\}/, 'heartbeat save status must be accessible')
assert.match(editor, /Failed to save runtime policy/, 'runtime auto-save failures must surface in the editor')
assert.match(editor, /apiRequest/, 'agent editor config writes should use the canonical API client')
assert.match(editor, /apiRequest<[\s\S]*\/api\/party\/agent\/\$\{encodeURIComponent\(agent\.id\)\}\/config/, 'agent editor model and policy saves must use the canonical API client')
assert.match(editor, /apiRequest<[\s\S]*\/api\/party\/workspace/, 'agent editor workspace saves must use the canonical API client')
assert.match(editor, /apiRequest<[\s\S]*\/api\/party\/resources\/\$\{encodeURIComponent\(agent\.id\)\}/, 'agent editor file saves must use the canonical API client')
assert.match(providerAuthApi, /export function saveProviderApiKey/, 'provider auth API module must expose provider key saves')
assert.match(providerAuthApi, /apiRequest\(`\/api\/auth\/providers\/\$\{encodeURIComponent\(provider\)\}`/, 'provider auth API module saves must use the canonical API client')
assert.match(editor, /saveProviderApiKey\(authModalProvider\.provider, apiKey\)/, 'agent editor provider auth saves must use the provider auth API module')
assert.match(modelSelector, /apiRequest/, 'model selector requests must use the canonical API client')
assert.doesNotMatch(modelSelector, /fetch\(/, 'model selector must not bypass the canonical API client')
assert.match(providerAuthApi, /fetchProviderAuthStatuses[\s\S]*apiRequest<ProviderAuthStatusesPayload>/, 'provider auth status requests must use the canonical API client')
assert.match(providerAuth, /fetchProviderAuthStatuses/, 'provider auth modal requests must use the provider auth API module')
assert.doesNotMatch(providerAuth, /fetch\(/, 'provider auth modal must not bypass the canonical API client')

assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:config-save/, 'test:ci must include config save lifecycle smoke')

console.log('config save lifecycle contract ok')

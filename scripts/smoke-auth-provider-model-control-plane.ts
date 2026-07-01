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

const server = readWorkspaceFile('server/controlPlane.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const providerAuthRoutes = readWorkspaceFile('server/routes/providerAuthRoutes.ts')
const agentConfigRoutes = readWorkspaceFile('server/routes/agentConfigRoutes.ts')
const providerCatalog = readWorkspaceFile('server/catalogs/providerCatalog.ts')
const modelCatalogService = readWorkspaceFile('server/services/providers/modelCatalogService.ts')
const providerAuthService = readWorkspaceFile('server/services/providers/providerAuthService.ts')
const oauthCallbackService = readWorkspaceFile('server/services/providers/oauthCallbackService.ts')
const providerSetupService = readWorkspaceFile('server/services/providers/providerSetupService.ts')
const providerAuthApi = readWorkspaceFile('src/api/providerAuth.ts')
const providerModal = readWorkspaceFile('src/components/auth/ProviderAuthModal.tsx')
const editor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const recruit = readWorkspaceFile('src/components/recruit/RecruitAgentModal.tsx')
const modelSelector = readWorkspaceFile('src/components/party/ModelSelectorModal.tsx')
const phaseKProviderAgentSmoke = readWorkspaceFile('scripts/smoke-phase-k-provider-agent.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }
const staleCodexSparkId = `codex-${3}-spark`
const unavailableModelsBlock = modelCatalogService.slice(
  modelCatalogService.indexOf('export const KNOWN_UNAVAILABLE_MODEL_IDS'),
  modelCatalogService.indexOf('export const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS'),
)
const suppressedModelsBlock = modelCatalogService.slice(
  modelCatalogService.indexOf('export const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS'),
  modelCatalogService.indexOf('const PINNED_MODEL_IDS'),
)

for (const code of [
  'auth_provider_failed',
  'model_auth_required',
  'model_catalog_failed',
  'model_operation_failed',
  'oauth_operation_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/auth/providers'",
  "app.post('/api/auth/providers/:provider'",
  "app.delete('/api/auth/providers/:provider'",
  "app.post('/api/auth/providers/:provider/oauth/start'",
  "app.get('/api/auth/providers/:provider/oauth/session/:sessionId'",
  "app.post('/api/auth/providers/:provider/oauth/session/:sessionId/manual'",
]) {
  const block = routeBlock(providerAuthRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\bres\.json\s*\(/.test(block), `${marker} should not return unwrapped JSON payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

for (const marker of [
  "app.get('/api/models/available'",
  "app.get('/api/party/agent/:agentId/model'",
  "app.post('/api/party/agent/:agentId/model'",
]) {
  const source = marker.includes('/api/party/') ? agentConfigRoutes : providerAuthRoutes
  const block = routeBlock(source, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\bres\.json\s*\(/.test(block), `${marker} should not return unwrapped JSON payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

assert(/import \{ registerProviderAuthRoutes \} from '\.\/routes\/providerAuthRoutes'/.test(server), 'server index must import the extracted provider auth route module')
assert(/registerProviderAuthRoutes\(app, \{/.test(server), 'server index must register extracted provider auth routes')
assert(server.includes('ensureProviderAuthReady: ensureLocalAuthStoreLoaded'), 'provider auth routes must wait for local auth store hydration')
assert(server.includes("from './services/providers/modelCatalogService'"), 'control plane must import the extracted model catalog service')
assert(server.includes('createModelCatalogService({'), 'control plane must compose the model catalog service')
assert(server.includes("from './services/providers/providerAuthService'"), 'control plane must import the extracted provider auth service')
assert(server.includes('createProviderAuthService({'), 'control plane must compose the provider auth service')
assert(server.includes("from './services/providers/oauthCallbackService'"), 'control plane must import the extracted OAuth callback service')
assert(server.includes('createOAuthCallbackService({'), 'control plane must compose the OAuth callback service')
assert(server.includes("from './services/providers/providerSetupService'"), 'control plane must import the extracted provider setup service')
assert(server.includes('createProviderSetupService({'), 'control plane must compose the provider setup service')
assert(server.includes('const ensureLocalAuthStoreLoaded = providerAuthService.ensureLocalAuthStoreLoaded'), 'control plane must delegate credential-store hydration through providerAuthService')
assert(server.includes('const persistProviderAuth = providerAuthService.persistProviderAuth'), 'control plane must delegate provider auth saves through providerAuthService')
assert(server.includes('const providerAuthStatus = providerAuthService.providerAuthStatus'), 'control plane must delegate provider status shaping through providerAuthService')
assert(server.includes('const invalidateAvailableModelsForAuthChange = modelCatalogService.invalidateAvailableModelsForAuthChange'), 'provider auth changes must invalidate the service-owned model catalog cache')
assert(providerAuthService.includes('options.invalidateAvailableModelsForAuthChange()'), 'provider auth saves/removals must schedule model catalog refresh from the service')
assert(providerAuthService.includes('await ensureLocalAuthStoreLoaded()'), 'provider auth mutations must wait for local auth store hydration inside the service')
assert(/registerAgentConfigRoutes\(app, agentConfigRoutesContext\)/.test(server), 'control plane must register extracted agent config routes')
assert(server.includes("from './catalogs/providerCatalog'"), 'control plane must import the extracted provider catalog')
assert(!server.includes('const AUTH_PROVIDER_CATALOG:'), 'provider catalog data should not remain inline in the control plane')
assert(providerCatalog.includes('export const AUTH_PROVIDER_CATALOG'), 'provider catalog module should own provider metadata')
assert(providerCatalog.includes('export const AUTH_ENV_MAP'), 'provider catalog module should derive the provider environment map')
assert(modelCatalogService.includes('export const FALLBACK_MODELS'), 'model catalog service should own fallback model metadata')
assert(modelCatalogService.includes('export const KNOWN_UNAVAILABLE_MODEL_IDS'), 'model catalog service should own unavailable model metadata')
assert(modelCatalogService.includes('export function createModelCatalogService'), 'model catalog service should expose a factory')
assert(modelCatalogService.includes('function ensureConfiguredModelAllowlist'), 'model catalog service should own configured model allowlist normalization')
assert(modelCatalogService.includes('function ensureOpenRouterModelCatalogAllowlist'), 'model catalog service should own OpenRouter catalog allowlist normalization')
assert(modelCatalogService.includes('async function loadAvailableModelsFromOpenClaw'), 'model catalog service should own OpenClaw model catalog loading')
assert(providerAuthService.includes('export function createProviderAuthService'), 'provider auth service should expose a factory')
assert(providerAuthService.includes('async function ensureLocalAuthStoreLoaded'), 'provider auth service should own credential-store hydration')
assert(providerAuthService.includes('async function persistProviderAuth'), 'provider auth service should own provider API-key persistence')
assert(providerAuthService.includes('async function persistProviderOAuth'), 'provider auth service should own provider OAuth persistence')
assert(providerAuthService.includes('async function removeProviderAuth'), 'provider auth service should own provider auth removal')
assert(providerAuthService.includes('function providerAuthStatus'), 'provider auth service should own provider status shaping')
assert(providerAuthService.includes('function modelAuthProblem'), 'provider auth service should own missing-auth model checks')
assert(providerAuthService.includes('async function writeProviderApiKeyAuthProfiles'), 'provider auth service should own OpenClaw API-key auth profile writes')
assert(providerAuthService.includes('async function writeProviderOAuthAuthProfiles'), 'provider auth service should own OpenClaw OAuth auth profile writes')
assert(oauthCallbackService.includes('export function createOAuthCallbackService'), 'OAuth callback service should expose a factory')
assert(oauthCallbackService.includes('const oauthSessions = new Map<string, ProviderOAuthSession>()'), 'OAuth callback service should own OAuth session storage')
assert(oauthCallbackService.includes('async function startGoogleOAuthSession'), 'OAuth callback service should own Google OAuth starts')
assert(oauthCallbackService.includes('async function startOpenAICodexOAuthSession'), 'OAuth callback service should own OpenAI Codex OAuth starts')
assert(oauthCallbackService.includes('function parseOpenAICodexAuthorizationInput'), 'OAuth callback service should own manual Codex code parsing')
assert(oauthCallbackService.includes('async function completeOpenAICodexOAuthSession'), 'OAuth callback service should own Codex OAuth completion')
assert(oauthCallbackService.includes('async function closeOAuthCallbackServersForShutdown'), 'OAuth callback service should own shutdown cleanup')
assert(providerSetupService.includes('export function createProviderSetupService'), 'provider setup service should expose a factory')
assert(providerSetupService.includes('function googleVertexGcloudStatus'), 'provider setup service should own Google Vertex readiness checks')
assert(providerSetupService.includes('function resolveGoogleOAuthClientConfig'), 'provider setup service should own Google OAuth client setup checks')
assert(providerSetupService.includes('async function resolveProviderRequestAuth'), 'provider setup service should own provider request auth checks')
assert(providerSetupService.includes('async function importOpenAICodexOAuthModule'), 'provider setup service should own OpenAI Codex OAuth runtime setup checks')
assert(!/\bfunction\s+loadAvailableModelsFromOpenClaw\b/.test(server), 'control plane should not own model catalog loading')
assert(!/\bfunction\s+fallbackAvailableModels\b/.test(server), 'control plane should not own fallback model catalog shaping')
assert(!/\bfunction\s+ensureConfiguredProviderModel\b/.test(server), 'control plane should not own provider model normalization')
assert(!/\basync function\s+ensureLocalAuthStoreLoaded\b/.test(server), 'control plane should not own credential-store hydration')
assert(!/\basync function\s+persistProviderAuth\b/.test(server), 'control plane should not own provider auth persistence')
assert(!/\basync function\s+persistProviderOAuth\b/.test(server), 'control plane should not own provider OAuth persistence')
assert(!/\basync function\s+removeProviderAuth\b/.test(server), 'control plane should not own provider auth removal')
assert(!/\bfunction\s+providerAuthStatus\b/.test(server), 'control plane should not own provider status shaping')
assert(!/\bfunction\s+modelAuthProblem\b/.test(server), 'control plane should not own missing-auth model checks')
assert(!/\basync function\s+startGoogleOAuthSession\b/.test(server), 'control plane should not own Google OAuth callback start')
assert(!/\basync function\s+startOpenAICodexOAuthSession\b/.test(server), 'control plane should not own OpenAI Codex OAuth callback start')
assert(!/\bfunction\s+parseOpenAICodexAuthorizationInput\b/.test(server), 'control plane should not own manual Codex OAuth parsing')
assert(!/\basync function\s+closeOAuthCallbackServersForShutdown\b/.test(server), 'control plane should not own OAuth callback shutdown')
assert(!/\bfunction\s+googleVertexGcloudStatus\b/.test(server), 'control plane should not own Google Vertex readiness checks')
assert(!/\bfunction\s+resolveGoogleOAuthClientConfig\b/.test(server), 'control plane should not own Google OAuth setup checks')
assert(!/\basync function\s+resolveProviderRequestAuth\b/.test(server), 'control plane should not own provider request auth checks')
assert(!/\basync function\s+importOpenAICodexOAuthModule\b/.test(server), 'control plane should not own OpenAI Codex OAuth runtime setup')
assert(providerAuthRoutes.includes('ensureProviderAuthReady'), 'provider auth routes must await credential-store readiness before reads and writes')
assert(
  server.indexOf('registerProviderAuthRoutes(app, {') < server.indexOf('registerSkillRoutes(app, {'),
  'provider auth routes should stay registered before skills routes',
)
for (const inlineMarker of [
  "app.get('/api/auth/providers'",
  "app.post('/api/auth/providers/:provider'",
  "app.delete('/api/auth/providers/:provider'",
  "app.post('/api/auth/providers/:provider/oauth/start'",
  "app.get('/api/auth/providers/:provider/oauth/session/:sessionId'",
  "app.post('/api/auth/providers/:provider/oauth/session/:sessionId/manual'",
  "app.get('/api/models/available'",
]) {
  assert(!server.includes(inlineMarker), `server index should not inline ${inlineMarker}`)
}

assert(providerAuthApi.includes('export function fetchProviderAuthStatuses'), 'renderer provider auth API should expose provider status loading')
assert(providerAuthApi.includes("apiRequest<ProviderAuthStatusesPayload>(options.refresh ? '/api/auth/providers?refresh=1' : '/api/auth/providers'"), 'renderer provider auth API should own provider status endpoints')
assert(providerAuthApi.includes('export function saveProviderApiKey'), 'renderer provider auth API should expose API-key saves')
assert(providerAuthApi.includes('apiRequest(`/api/auth/providers/${encodeURIComponent(provider)}`'), 'renderer provider auth API should own provider API-key endpoint')
assert(providerAuthApi.includes('export function startProviderOAuthSession'), 'renderer provider auth API should expose OAuth start')
assert(providerAuthApi.includes('apiRequest<OAuthStartPayload>(`/api/auth/providers/${encodeURIComponent(provider)}/oauth/start`'), 'renderer provider auth API should own OAuth start endpoint')
assert(providerAuthApi.includes('export function fetchProviderOAuthSession'), 'renderer provider auth API should expose OAuth polling')
assert(providerAuthApi.includes('apiRequest<OAuthSessionPayload>('), 'renderer provider auth API should poll OAuth through apiRequest')
assert(providerAuthApi.includes('export function submitProviderOAuthManual'), 'renderer provider auth API should expose manual OAuth completion')
assert(providerAuthApi.includes('`/api/auth/providers/${encodeURIComponent(provider)}/oauth/session/${encodeURIComponent(sessionId)}/manual`'), 'renderer provider auth API should own manual OAuth endpoint')
assert(providerModal.includes('fetchProviderAuthStatuses({ refresh: true, timeoutMs: 30_000 })'), 'ProviderAuthModal should refresh provider status through the provider auth API module')
assert(providerModal.includes("setStatus('Saved. Verifying provider readiness...')"), 'ProviderAuthModal should verify readiness immediately after saving a key')
assert(providerModal.includes("setApiKey('')"), 'ProviderAuthModal should clear pasted key material after save')
assert(providerModal.includes('startProviderOAuthSession(provider'), 'ProviderAuthModal should start OAuth through the provider auth API module')
assert(providerModal.includes('fetchProviderOAuthSession(provider, sessionId'), 'ProviderAuthModal should poll OAuth through the provider auth API module')
assert(providerModal.includes('submitProviderOAuthManual(provider, manualSessionId'), 'ProviderAuthModal should submit manual OAuth codes through the provider auth API module')
assert(!providerModal.includes('fetchJsonWithTimeout'), 'ProviderAuthModal should not keep a legacy JSON fetch shim')
assert(!providerModal.includes('new Response'), 'ProviderAuthModal should not synthesize Response objects for API errors')
assert(!/\bfetch\s*\(/.test(providerModal), 'ProviderAuthModal should not bypass the canonical API client')

assert(editor.includes('fetchProviderAuthStatuses({ refresh: force'), 'AgentEditorModal should load auth providers through the provider auth API module')
assert(recruit.includes('fetchProviderAuthStatuses({'), 'RecruitAgentModal should load auth providers through the provider auth API module')
assert(modelSelector.includes('fetchProviderAuthStatuses({ refresh: force'), 'ModelSelectorModal should load auth providers through the provider auth API module')
assert(modelSelector.includes('saveProviderApiKey(authModalProvider.provider, apiKey)'), 'ModelSelectorModal provider key save should use the provider auth API module')
assert(editor.includes('saveProviderApiKey(authModalProvider.provider, apiKey)'), 'AgentEditorModal provider key save should use the provider auth API module')
assert(recruit.includes('saveProviderApiKey(authModalProvider.provider, apiKey)'), 'RecruitAgentModal provider key save should use the provider auth API module')
for (const [name, content] of [
  ['ProviderAuthModal', providerModal],
  ['AgentEditorModal', editor],
  ['RecruitAgentModal', recruit],
  ['ModelSelectorModal', modelSelector],
] as const) {
  assert(!content.includes('/api/auth/providers'), `${name} should not own provider auth endpoint literals after renderer API extraction`)
}
assert(editor.includes("const CODEX_5_3_SPARK_MODEL_ID = 'openai/gpt-5.3-codex-spark'"), 'AgentEditorModal should seed the canonical Codex 5.3 Spark model id')
assert(editor.includes("name: 'Codex 5.3 Spark'"), 'AgentEditorModal should label the seeded Codex model as 5.3 Spark')
assert(!editor.includes(staleCodexSparkId), 'AgentEditorModal should not expose the stale pre-5.3 Spark id')
assert(modelCatalogService.includes("{ id: 'openai/gpt-5.3-codex-spark', alias: 'gpt-5.3-codex-spark' }"), 'Fallback model catalog should expose Codex 5.3 Spark for save/reload consistency')
assert(modelSelector.includes("const CODEX_5_3_SPARK_MODEL_ID = 'openai/gpt-5.3-codex-spark'"), 'ModelSelectorModal should seed the canonical Codex 5.3 Spark model id')
assert(modelSelector.includes("name: 'Codex 5.3 Spark'"), 'ModelSelectorModal should label the seeded Codex model as 5.3 Spark')
assert(modelSelector.includes('const seededCatalog = catalog.some((model) => model.id === CODEX_5_3_SPARK_MODEL_ID)'), 'ModelSelectorModal should keep Codex 5.3 Spark in the selectable catalog')
assert(providerAuthApi.includes('export function effectiveAuthStatusForProvider'), 'renderer provider auth API should own effective provider auth status for Codex subscription models')
assert(providerAuthApi.includes("const openAiStatus = authStatusForProvider(providers, 'openai')"), 'renderer provider auth API should accept the canonical OpenAI auth route for OpenAI Codex model saves')
assert(editor.includes('configLoadSeqRef.current += 1'), 'AgentEditorModal model save should invalidate stale config loads before applying the save result')
assert(modelSelector.includes('effectiveAuthStatusForProvider(authProviders, primaryProvider)'), 'ModelSelectorModal should use effective provider auth status for Codex subscription models')
assert(modelSelector.includes('const providerStatus = effectiveAuthStatusForProvider(authProviders, primaryProvider)'), 'ModelSelectorModal save should use effective provider auth status')
assert(!unavailableModelsBlock.includes('openai/gpt-5.3-codex-spark'), 'Codex 5.3 Spark should not be classified as unavailable')
assert(!suppressedModelsBlock.includes('openai/gpt-5.3-codex-spark'), 'Codex 5.3 Spark should be allowed through saved OpenClaw config normalization')

assert(
  packageJson.scripts?.['smoke:auth-provider-model'] === 'tsx scripts/smoke-auth-provider-model-control-plane.ts',
  'package.json should expose smoke:auth-provider-model',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:auth-provider-model'),
  'test:ci should run the auth/provider/model smoke',
)
assert(
  packageJson.scripts?.['smoke:provider-setup-service'] === 'tsx scripts/smoke-provider-setup-service.ts',
  'package.json should expose smoke:provider-setup-service',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:provider-setup-service'),
  'test:ci should run the provider setup service smoke',
)
assert(
  packageJson.scripts?.['smoke:phase-k-provider-agent'] === 'tsx scripts/smoke-phase-k-provider-agent.ts',
  'package.json should expose the Phase K provider/agent smoke',
)
assert(phaseKProviderAgentSmoke.includes("'/api/auth/providers'"), 'Phase K smoke should capture provider status through the backend route')
assert(phaseKProviderAgentSmoke.includes("'/api/party/recruit'"), 'Phase K smoke should recruit through the backend route')
assert(phaseKProviderAgentSmoke.includes("'/api/party/workspace'"), 'Phase K smoke should edit workspace through the backend route')
assert(phaseKProviderAgentSmoke.includes('providerStatusHasSecretMaterial'), 'Phase K smoke should guard provider evidence redaction')
assert(phaseKProviderAgentSmoke.includes('completedItems = providerItemBlocked ? [115, 116] : [114, 115, 116]'), 'Phase K smoke should complete item 114 only when a provider is configured')

console.log('auth provider/model control-plane contract ok')

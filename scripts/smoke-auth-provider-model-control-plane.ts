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
const providerModal = readWorkspaceFile('src/components/auth/ProviderAuthModal.tsx')
const editor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const recruit = readWorkspaceFile('src/components/recruit/RecruitAgentModal.tsx')
const modelSelector = readWorkspaceFile('src/components/party/ModelSelectorModal.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }
const staleCodexSparkId = `codex-${3}-spark`
const unavailableModelsBlock = server.slice(
  server.indexOf('const KNOWN_UNAVAILABLE_MODEL_IDS'),
  server.indexOf('const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS'),
)
const suppressedModelsBlock = server.slice(
  server.indexOf('const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS'),
  server.indexOf('const PINNED_MODEL_IDS'),
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
assert(/registerAgentConfigRoutes\(app, agentConfigRoutesContext\)/.test(server), 'control plane must register extracted agent config routes')
assert(server.includes("from './catalogs/providerCatalog'"), 'control plane must import the extracted provider catalog')
assert(!server.includes('const AUTH_PROVIDER_CATALOG:'), 'provider catalog data should not remain inline in the control plane')
assert(providerCatalog.includes('export const AUTH_PROVIDER_CATALOG'), 'provider catalog module should own provider metadata')
assert(providerCatalog.includes('export const AUTH_ENV_MAP'), 'provider catalog module should derive the provider environment map')
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

assert(providerModal.includes("apiRequest<{ providers?: AuthProviderStatus[] }>('/api/auth/providers?refresh=1'"), 'ProviderAuthModal should refresh provider status through apiRequest')
assert(providerModal.includes('apiRequest<OAuthStartPayload>(`/api/auth/providers/${provider}/oauth/start`'), 'ProviderAuthModal should start OAuth through apiRequest')
assert(providerModal.includes('apiRequest<OAuthSessionPayload>(`/api/auth/providers/${provider}/oauth/session/${sessionId}`'), 'ProviderAuthModal should poll OAuth through apiRequest')
assert(providerModal.includes('apiRequest(`/api/auth/providers/${provider}/oauth/session/${manualSessionId}/manual`'), 'ProviderAuthModal should submit manual OAuth codes through apiRequest')
assert(!providerModal.includes('fetchJsonWithTimeout'), 'ProviderAuthModal should not keep a legacy JSON fetch shim')
assert(!providerModal.includes('new Response'), 'ProviderAuthModal should not synthesize Response objects for API errors')
assert(!/\bfetch\s*\(/.test(providerModal), 'ProviderAuthModal should not bypass the canonical API client')

assert(editor.includes("apiRequest<{providers:AuthProviderStatus[]}>('/api/auth/providers'"), 'AgentEditorModal should load auth providers through apiRequest')
assert(recruit.includes("apiRequest<{ providers?: unknown }>('/api/auth/providers'"), 'RecruitAgentModal should load auth providers through apiRequest')
assert(modelSelector.includes("apiRequest<{ providers: AuthProviderStatus[] }>('/api/auth/providers'"), 'ModelSelectorModal should load auth providers through apiRequest')
assert(modelSelector.includes('apiRequest(`/api/auth/providers/${encodeURIComponent(authModalProvider.provider)}`'), 'ModelSelectorModal provider key save should use apiRequest')
assert(editor.includes('apiRequest(`/api/auth/providers/${encodeURIComponent(authModalProvider.provider)}`'), 'AgentEditorModal provider key save should use apiRequest')
assert(recruit.includes('apiRequest(`/api/auth/providers/${encodeURIComponent(authModalProvider.provider)}`'), 'RecruitAgentModal provider key save should use apiRequest')
assert(editor.includes("const CODEX_5_3_SPARK_MODEL_ID = 'openai/gpt-5.3-codex-spark'"), 'AgentEditorModal should seed the canonical Codex 5.3 Spark model id')
assert(editor.includes("name: 'Codex 5.3 Spark'"), 'AgentEditorModal should label the seeded Codex model as 5.3 Spark')
assert(!editor.includes(staleCodexSparkId), 'AgentEditorModal should not expose the stale pre-5.3 Spark id')
assert(server.includes("{ id: 'openai/gpt-5.3-codex-spark', alias: 'gpt-5.3-codex-spark' }"), 'Fallback model catalog should expose Codex 5.3 Spark for save/reload consistency')
assert(modelSelector.includes("const CODEX_5_3_SPARK_MODEL_ID = 'openai/gpt-5.3-codex-spark'"), 'ModelSelectorModal should seed the canonical Codex 5.3 Spark model id')
assert(modelSelector.includes("name: 'Codex 5.3 Spark'"), 'ModelSelectorModal should label the seeded Codex model as 5.3 Spark')
assert(modelSelector.includes('const seededCatalog = catalog.some((model) => model.id === CODEX_5_3_SPARK_MODEL_ID)'), 'ModelSelectorModal should keep Codex 5.3 Spark in the selectable catalog')
assert(editor.includes('const effectiveAuthStatusForProvider = (providers: AuthProviderStatus[], provider: string) =>'), 'AgentEditorModal should use effective provider auth status for Codex subscription models')
assert(editor.includes("const openAiStatus = authStatusForProvider(providers, 'openai')"), 'AgentEditorModal should accept the canonical OpenAI auth route for OpenAI Codex model saves')
assert(editor.includes('configLoadSeqRef.current += 1'), 'AgentEditorModal model save should invalidate stale config loads before applying the save result')
assert(modelSelector.includes('const effectiveAuthStatusForProvider = (providers: AuthProviderStatus[], provider: string) =>'), 'ModelSelectorModal should use effective provider auth status for Codex subscription models')
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

console.log('auth provider/model control-plane contract ok')

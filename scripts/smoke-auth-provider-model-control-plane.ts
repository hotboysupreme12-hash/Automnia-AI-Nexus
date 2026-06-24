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

const server = readWorkspaceFile('server/index.ts')
const providerModal = readWorkspaceFile('src/components/auth/ProviderAuthModal.tsx')
const editor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const recruit = readWorkspaceFile('src/components/recruit/RecruitAgentModal.tsx')
const modelSelector = readWorkspaceFile('src/components/party/ModelSelectorModal.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'auth_provider_failed',
  'model_auth_required',
  'model_operation_failed',
  'oauth_operation_failed',
]) {
  assert(server.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/auth/providers'",
  "app.post('/api/auth/providers/:provider'",
  "app.delete('/api/auth/providers/:provider'",
  "app.post('/api/auth/providers/:provider/oauth/start'",
  "app.get('/api/auth/providers/:provider/oauth/session/:sessionId'",
  "app.post('/api/auth/providers/:provider/oauth/session/:sessionId/manual'",
  "app.get('/api/party/agent/:agentId/model'",
  "app.post('/api/party/agent/:agentId/model'",
]) {
  const block = routeBlock(server, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\bres\.json\s*\(/.test(block), `${marker} should not return unwrapped JSON payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
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

assert(
  packageJson.scripts?.['smoke:auth-provider-model'] === 'tsx scripts/smoke-auth-provider-model-control-plane.ts',
  'package.json should expose smoke:auth-provider-model',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:auth-provider-model'),
  'test:ci should run the auth/provider/model smoke',
)

console.log('auth provider/model control-plane contract ok')

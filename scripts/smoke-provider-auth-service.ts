import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const service = read('server/services/providers/providerAuthService.ts')
const providerRoutes = read('server/routes/providerAuthRoutes.ts')
const tests = read('tests/providerAuthService.test.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(service, /export function createProviderAuthService/, 'provider auth service must expose a factory')
assert.match(service, /\bconst localAuthStore: LocalAuthStore = \{ providers: \{\} \}/, 'provider auth service must own the local auth store')
assert.match(service, /\basync function\s+ensureLocalAuthStoreLoaded\b/, 'provider auth service must own store hydration')
assert.match(service, /\basync function\s+persistProviderAuth\b/, 'provider auth service must own API-key saves')
assert.match(service, /\basync function\s+persistProviderOAuth\b/, 'provider auth service must own OAuth saves')
assert.match(service, /\basync function\s+removeProviderAuth\b/, 'provider auth service must own auth removal')
assert.match(service, /\basync function\s+syncStoredProviderAuthProfiles\b/, 'provider auth service must own startup auth-profile sync')
assert.match(service, /\basync function\s+writeProviderApiKeyAuthProfiles\b/, 'provider auth service must own OpenClaw API-key profile writes')
assert.match(service, /\basync function\s+writeProviderOAuthAuthProfiles\b/, 'provider auth service must own OpenClaw OAuth profile writes')
assert.match(service, /\bfunction\s+providerAuthStatus\b/, 'provider auth service must own provider status shaping')
assert.match(service, /\bfunction\s+modelAuthProblem\b/, 'provider auth service must own missing-auth model checks')
assert.match(service, /options\.invalidateAvailableModelsForAuthChange\(\)/, 'provider auth changes must invalidate model catalog cache from the service')
assert.match(service, /options\.ensureOpenRouterPluginEnabledForProviderAuth\(nextConfig\)/, 'OpenRouter auth save must repair plugin enablement from the service')
assert.match(service, /options\.ensureOpenRouterModelCatalogAllowlist\(nextConfig\)/, 'OpenRouter auth save must repair model catalog allowlist from the service')
assert.match(service, /copyToAgents: true/, 'OAuth profile writes must preserve copy-to-agent behavior')

assert.match(controlPlane, /from '\.\/services\/providers\/providerAuthService'/, 'control plane must import providerAuthService')
assert.match(controlPlane, /createProviderAuthService\(\{/, 'control plane must compose providerAuthService')
assert.match(controlPlane, /const ensureLocalAuthStoreLoaded = providerAuthService\.ensureLocalAuthStoreLoaded/, 'control plane must delegate auth readiness through providerAuthService')
assert.match(controlPlane, /const getAgentAuthEnv = providerAuthService\.getAgentAuthEnv/, 'control plane must delegate agent auth env through providerAuthService')
assert.match(controlPlane, /const isProviderConfigured = providerAuthService\.isProviderConfigured/, 'control plane must delegate provider configured checks through providerAuthService')
assert.match(controlPlane, /const modelAuthProblem = providerAuthService\.modelAuthProblem/, 'control plane must delegate missing-auth checks through providerAuthService')
assert.match(controlPlane, /const providerAuthStatus = providerAuthService\.providerAuthStatus/, 'control plane must delegate provider status through providerAuthService')

assert.doesNotMatch(controlPlane, /\bconst localAuthStore\b/, 'control plane must not own local auth store state')
assert.doesNotMatch(controlPlane, /\basync function\s+ensureLocalAuthStoreLoaded\b/, 'control plane must not own local auth hydration')
assert.doesNotMatch(controlPlane, /\basync function\s+persistProviderAuth\b/, 'control plane must not own API-key save logic')
assert.doesNotMatch(controlPlane, /\basync function\s+persistProviderOAuth\b/, 'control plane must not own OAuth save logic')
assert.doesNotMatch(controlPlane, /\basync function\s+removeProviderAuth\b/, 'control plane must not own provider auth removal')
assert.doesNotMatch(controlPlane, /\bfunction\s+providerAuthStatus\b/, 'control plane must not own provider auth status shaping')
assert.doesNotMatch(controlPlane, /\bfunction\s+modelAuthProblem\b/, 'control plane must not own missing-auth model checks')
assert.doesNotMatch(controlPlane, /\basync function\s+writeProviderApiKeyAuthProfiles\b/, 'control plane must not own OpenClaw API-key profile writes')
assert.doesNotMatch(controlPlane, /\basync function\s+writeProviderOAuthAuthProfiles\b/, 'control plane must not own OpenClaw OAuth profile writes')

assert.match(providerRoutes, /ensureProviderAuthReady/, 'provider auth routes must await service-backed readiness')
assert.match(providerRoutes, /persistProviderAuth: \(provider: string, apiKey: string\) => Promise<unknown>/, 'provider auth route API-key save seam must stay explicit')
assert.match(providerRoutes, /providerAuthStatus: \(provider: string, options\?: \{ probeGcloud\?: boolean \}\) => unknown/, 'provider auth route status seam must stay explicit')
assert.match(providerRoutes, /removeProviderAuth: \(provider: string\) => Promise<unknown>/, 'provider auth route removal seam must stay explicit')

assert.match(tests, /persists API keys to local auth and agent auth profiles/, 'provider auth service tests must cover API-key persistence')
assert.match(tests, /persists OpenAI Codex OAuth into OpenAI-compatible auth profile/, 'provider auth service tests must cover OAuth profile persistence')
assert.match(tests, /removes provider credentials from local auth and propagated auth profiles/, 'provider auth service tests must cover removal')
assert.match(tests, /openrouter saves enable plugin\/catalog repair/, 'provider auth service tests must cover OpenRouter repair')
assert.match(tests, /assert\.doesNotMatch\(encodedStatus, \/sk-deepseek-secret\//, 'provider auth status tests must prove API-key redaction')
assert.match(tests, /assert\.doesNotMatch\(JSON\.stringify\(status\), \/codex-access-token\|codex-refresh-token\//, 'provider auth status tests must prove OAuth token redaction')

assert.equal(packageJson.scripts?.['smoke:provider-auth-service'], 'tsx scripts/smoke-provider-auth-service.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:provider-auth-service'), 'test:ci must run provider auth service smoke')

console.log('provider auth service contract ok')

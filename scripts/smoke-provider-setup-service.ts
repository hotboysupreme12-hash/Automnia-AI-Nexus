import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const providerSetupService = read('server/services/providers/providerSetupService.ts')
const providerAuthService = read('server/services/providers/providerAuthService.ts')
const oauthCallbackService = read('server/services/providers/oauthCallbackService.ts')
const tests = read('tests/providerSetupService.test.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(providerSetupService, /export function createProviderSetupService/, 'provider setup service must expose a factory')
assert.match(providerSetupService, /function googleCloudSdkRootCandidates/, 'provider setup service must own Google Cloud SDK discovery')
assert.match(providerSetupService, /function runGcloud/, 'provider setup service must own gcloud command probing')
assert.match(providerSetupService, /function googleVertexGcloudStatus/, 'provider setup service must own Google Vertex readiness shaping')
assert.match(providerSetupService, /function resolveGoogleVertexProjectId/, 'provider setup service must own Google Vertex project resolution')
assert.match(providerSetupService, /function resolveGoogleVertexAccessTokenForProcessEnv/, 'provider setup service must own Vertex access-token projection')
assert.match(providerSetupService, /function resolveGoogleOAuthClientConfig/, 'provider setup service must own Google OAuth client config discovery')
assert.match(providerSetupService, /function googleOAuthClientConfigStatus/, 'provider setup service must own Google OAuth config status')
assert.match(providerSetupService, /async function resolveProviderRequestAuth/, 'provider setup service must own provider request-auth resolution')
assert.match(providerSetupService, /async function importOpenAICodexOAuthModule/, 'provider setup service must own OpenAI Codex OAuth runtime loading')
assert.match(providerSetupService, /function openAICodexOAuthTesting/, 'provider setup service must own OpenAI Codex callback helper validation')
assert.match(providerSetupService, /GOOGLE_CLOUD_CLI_INSTALL_URL/, 'provider setup service must own Google Cloud CLI operator guidance')

assert.match(controlPlane, /from '\.\/services\/providers\/providerSetupService'/, 'controlPlane.ts must import provider setup service')
assert.match(controlPlane, /const providerSetupService = createProviderSetupService\(\{/, 'controlPlane.ts must compose provider setup service')
assert.match(controlPlane, /const getGoogleVertexProcessEnv = providerSetupService\.getGoogleVertexProcessEnv/, 'controlPlane.ts must delegate Vertex process env projection')
assert.match(controlPlane, /const googleOAuthClientConfigStatus = providerSetupService\.googleOAuthClientConfigStatus/, 'controlPlane.ts must delegate Google OAuth setup status')
assert.match(controlPlane, /const googleVertexGcloudStatus = providerSetupService\.googleVertexGcloudStatus/, 'controlPlane.ts must delegate Vertex gcloud status')
assert.match(controlPlane, /const resolveProviderRequestAuth = providerSetupService\.resolveProviderRequestAuth/, 'controlPlane.ts must delegate provider request auth')
assert.match(controlPlane, /createOpenAICodexAuthorizationFlow: providerSetupService\.createOpenAICodexAuthorizationFlow/, 'OAuth callback composition must use setup-service Codex flow creation')
assert.match(controlPlane, /refreshOpenAICodexToken: providerSetupService\.refreshOpenAICodexToken/, 'OAuth callback composition must use setup-service Codex refresh')
assert.match(controlPlane, /resolveGoogleOAuthClientConfig: providerSetupService\.resolveGoogleOAuthClientConfig/, 'OAuth callback composition must use setup-service Google OAuth config resolution')

for (const forbidden of [
  /\bfunction\s+googleVertexGcloudStatus\b/,
  /\bfunction\s+resolveGoogleOAuthClientConfig\b/,
  /\bfunction\s+googleOAuthClientConfigStatus\b/,
  /\bfunction\s+resolveGoogleProjectId\b/,
  /\basync function\s+resolveProviderRequestAuth\b/,
  /\basync function\s+importOpenAICodexOAuthModule\b/,
  /\bfunction\s+openAICodexOAuthTesting\b/,
  /\bfunction\s+runGcloud\b/,
  /\bfunction\s+spawnGcloud\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts must not own provider setup helper ${forbidden}`)
}

assert.match(providerAuthService, /googleOAuthClientConfigStatus: \(\) => \{ available: boolean; missing: string\[\] \}/, 'provider auth service should receive Google OAuth setup status through options')
assert.match(providerAuthService, /googleVertexGcloudStatus: \(options\?: ProviderAuthStatusOptions\) => unknown/, 'provider auth service should receive Vertex readiness through options')
assert.match(oauthCallbackService, /resolveGoogleOAuthClientConfig: \(\) => GoogleOAuthClientConfig/, 'OAuth callback service should receive Google OAuth config through options')

for (const expected of [
  'resolves Google OAuth client setup from env and client_secret files',
  'reports fast Google Vertex readiness from local OAuth',
  'probes gcloud for Google Vertex project',
  'resolves provider request auth through env keys and refreshed OAuth credentials',
  'loads OpenAI Codex OAuth runtime helpers',
]) {
  assert.ok(tests.includes(expected), `provider setup tests must cover: ${expected}`)
}

assert.equal(packageJson.scripts?.['smoke:provider-setup-service'], 'tsx scripts/smoke-provider-setup-service.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:provider-setup-service'), 'test:ci must run provider setup service smoke')

console.log('provider setup service contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const providerRoutes = read('server/routes/providerAuthRoutes.ts')
const oauthCallbackService = read('server/services/providers/oauthCallbackService.ts')
const tests = read('tests/oauthCallbackService.test.ts')
const runtimeRecoveryService = read('server/services/runtime/runtimeRecoveryService.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(oauthCallbackService, /export function createOAuthCallbackService/, 'OAuth callback service must expose a factory')
assert.match(oauthCallbackService, /const oauthSessions = new Map<string, ProviderOAuthSession>\(\)/, 'OAuth sessions must be service-owned')
assert.match(oauthCallbackService, /function cancelOAuthSession/, 'OAuth callback service must support explicit cancellation for recoverable browser-close flows')
assert.match(oauthCallbackService, /server\.listen\(googleCallbackPort, '127\.0\.0\.1'/, 'Google OAuth callback listener must bind loopback only')
assert.match(oauthCallbackService, /server\.listen\(openAiCodexCallbackPort, '127\.0\.0\.1'/, 'OpenAI Codex OAuth callback listener must bind loopback only')
assert.match(oauthCallbackService, /function failPendingOAuthSessionsForShutdown/, 'OAuth service must own pending-session shutdown failure')
assert.match(oauthCallbackService, /async function closeOAuthCallbackServersForShutdown/, 'OAuth service must own async callback listener shutdown')
assert.match(oauthCallbackService, /function closeOAuthCallbackServersForProcessExit/, 'OAuth service must own process-exit callback listener cleanup')
assert.match(oauthCallbackService, /function parseOpenAICodexAuthorizationInput/, 'OAuth service must own manual OpenAI Codex code parsing')
assert.match(oauthCallbackService, /async function completeOpenAICodexOAuthSession/, 'OAuth service must own OpenAI Codex callback completion')
assert.match(oauthCallbackService, /async function refreshGoogleOAuthCredential/, 'OAuth service must own Google OAuth refresh')
assert.match(oauthCallbackService, /async function refreshOpenAICodexOAuthCredential/, 'OAuth service must own OpenAI Codex OAuth refresh')
assert.match(oauthCallbackService, /safeErrorText\(err, redactSensitiveText\)/, 'OAuth callback errors must cross the redaction boundary')
assert.match(oauthCallbackService, /sessionTimeoutMs/, 'OAuth service must own session timeout behavior')

assert.match(controlPlane, /from '\.\/services\/providers\/oauthCallbackService'/, 'controlPlane.ts must import OAuth callback service')
assert.match(controlPlane, /const oauthCallbackService = createOAuthCallbackService\(\{/, 'controlPlane.ts must compose OAuth callback service')
assert.match(controlPlane, /const oauthSessions = oauthCallbackService\.oauthSessions/, 'controlPlane.ts must delegate OAuth session storage through the service')
assert.match(controlPlane, /const startGoogleOAuthSession = oauthCallbackService\.startGoogleOAuthSession/, 'controlPlane.ts must delegate Google OAuth session starts')
assert.match(controlPlane, /const startOpenAICodexOAuthSession = oauthCallbackService\.startOpenAICodexOAuthSession/, 'controlPlane.ts must delegate OpenAI Codex OAuth session starts')
assert.match(controlPlane, /const closeOAuthCallbackServersForShutdown = oauthCallbackService\.closeOAuthCallbackServersForShutdown/, 'controlPlane.ts must delegate OAuth shutdown cleanup')
assert.doesNotMatch(controlPlane, /\basync function\s+startGoogleOAuthSession\b/, 'controlPlane.ts must not own Google OAuth session starts')
assert.doesNotMatch(controlPlane, /\basync function\s+startOpenAICodexOAuthSession\b/, 'controlPlane.ts must not own OpenAI Codex OAuth session starts')
assert.doesNotMatch(controlPlane, /\bfunction\s+failPendingOAuthSessionsForShutdown\b/, 'controlPlane.ts must not own pending OAuth shutdown failure')
assert.doesNotMatch(controlPlane, /\basync function\s+closeOAuthCallbackServersForShutdown\b/, 'controlPlane.ts must not own OAuth callback listener shutdown')
assert.doesNotMatch(controlPlane, /server\.listen\(1455, '127\.0\.0\.1'/, 'fixed-port OAuth listeners must not live in controlPlane.ts')

assert.match(providerRoutes, /import type \{ ProviderOAuthSession \} from '..\/services\/providers\/oauthCallbackService'/, 'provider routes must share the service OAuth session contract')
assert.match(providerRoutes, /oauthSessions: Pick<Map<string, ProviderOAuthSession>, 'get'>/, 'provider routes must receive OAuth sessions through an explicit option')
assert.match(runtimeRecoveryService, /closeOAuthCallbackServersForShutdown\(reason\)/, 'runtime recovery shutdown must close OAuth callback servers')
assert.match(runtimeRecoveryService, /closeOAuthCallbackServersForProcessExit\(reason\)/, 'process-exit cleanup must close OAuth callback servers synchronously')

for (const expected of [
  'completes Google OAuth through a loopback-only callback listener',
  'completes OpenAI Codex manual OAuth input',
  'marks pending OAuth sessions as timed out',
  'redacts callback exchange failures',
  'shutdown closes callback listeners',
]) {
  assert.ok(tests.includes(expected), `OAuth callback tests must cover: ${expected}`)
}

assert.equal(packageJson.scripts?.['smoke:oauth-callback-service'], 'tsx scripts/smoke-oauth-callback-service.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:oauth-callback-service'), 'test:ci should run the OAuth callback service smoke')

console.log('OAuth callback service contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const providerAuthTests = read('tests/providerAuthService.test.ts')
const oauthTests = read('tests/oauthCallbackService.test.ts')
const providerAuthService = read('server/services/providers/providerAuthService.ts')
const oauthCallbackService = read('server/services/providers/oauthCallbackService.ts')
const providerModal = read('src/components/auth/ProviderAuthModal.tsx')
const agentConsole = read('src/components/monitor/AgentResponseConsole.tsx')
const agentEditor = read('src/components/editor/AgentEditorModal.tsx')
const modelSelector = read('src/components/party/ModelSelectorModal.tsx')
const recruitModal = read('src/components/recruit/RecruitAgentModal.tsx')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(
  providerAuthTests,
  /reports missing credential states for API-key, OAuth, and Vertex providers without leaking credential markers/,
  'provider auth tests must cover missing API-key, OAuth, and Vertex credential states',
)
assert.match(
  providerAuthTests,
  /assert\.doesNotMatch\(JSON\.stringify\(deepSeekStatus\), \/sk-deepseek-should-not-leak\|SecretRef\//,
  'provider auth missing-state tests must prove SecretRef/key markers are redacted from status',
)
assert.match(
  providerAuthTests,
  /blocks unconfigured model providers while allowing configured and optional-auth selections/,
  'provider auth tests must cover missing-auth model selection decisions',
)
assert.match(
  providerAuthTests,
  /modelAuthProblem\('deepseek\/deepseek-v4-pro'\)/,
  'missing-auth model coverage must include a non-Codex provider model',
)
assert.match(
  providerAuthTests,
  /modelAuthProblem\('ollama\/llama3\.2'\)/,
  'missing-auth model coverage must prove optional-auth local providers are not blocked',
)
assert.match(
  providerAuthTests,
  /modelAuthProblem\('openai\/gpt-5\.3-codex-spark'\)/,
  'missing-auth model coverage must preserve the OpenAI Codex subscription case',
)
assert.match(
  providerAuthService,
  /function\s+modelAuthProblem\b/,
  'missing-auth model decisions must stay in providerAuthService',
)

assert.match(
  oauthTests,
  /marks pending OAuth sessions as timed out/,
  'OAuth callback tests must cover pending-session timeout cleanup',
)
assert.match(
  oauthTests,
  /completes Google OAuth through a loopback-only callback listener/,
  'OAuth callback tests must cover Google loopback binding',
)
assert.match(
  oauthTests,
  /completes OpenAI Codex OAuth through a loopback-only callback listener/,
  'OAuth callback tests must cover OpenAI Codex loopback binding',
)
assert.match(
  oauthTests,
  /assert\.equal\(snapshot\.openAiCodex\.address, '127\.0\.0\.1'\)/,
  'OpenAI Codex OAuth test must assert a loopback-only listener address',
)
assert.match(
  oauthCallbackService,
  /server\.listen\(googleCallbackPort, '127\.0\.0\.1'/,
  'Google OAuth listener must bind to loopback only',
)
assert.match(
  oauthCallbackService,
  /server\.listen\(openAiCodexCallbackPort, '127\.0\.0\.1'/,
  'OpenAI Codex OAuth listener must bind to loopback only',
)

assert.match(
  providerModal,
  /<h3[^>]*>Connect \{label\}<\/h3>/,
  'provider auth modal must title the path as connecting the provider',
)
assert.match(
  providerModal,
  /Connect with your \$\{label\} account/,
  'provider auth modal must explain OAuth as a provider connection action',
)
assert.match(
  providerModal,
  /setStatus\('Saved\. Verifying provider readiness\.\.\.'\)/,
  'provider auth modal must verify readiness immediately after saving local credentials',
)
assert.doesNotMatch(providerModal, /\bfetch\s*\(/, 'provider auth modal must use the canonical API client')

assert.match(
  agentConsole,
  /case 'auth_missing':[^\n]*\n\s+case 'auth_expired':[\s\S]*label: 'Connect provider'/,
  'Monitor command-console failures must show a Connect provider CTA for missing or expired auth',
)
assert.match(
  agentEditor,
  /Connect this provider to finish autosave\./,
  'Agent editor model autosave must stop on missing provider auth before runtime work starts',
)
assert.match(
  agentEditor,
  /setAuthModalProvider\(providerStatus\)/,
  'Agent editor must open the provider auth modal for missing model credentials',
)
assert.match(
  modelSelector,
  /Connect this provider before saving\./,
  'Model selector save must stop on missing provider auth before runtime work starts',
)
assert.match(
  modelSelector,
  /Connect it before using this model\./,
  'Model selector must show an inline connect-provider prompt for unavailable model auth',
)
assert.match(
  recruitModal,
  /Connect \$\{selectedProviderAuth\.label \|\| selectedProviderAuth\.provider\} before recruiting with this model\./,
  'Recruit flow must block agent creation with a connect-provider prompt when model auth is missing',
)
assert.match(
  recruitModal,
  /Connect \$\{selectedProviderAuth\.label \|\| selectedProviderAuth\.provider\} before running Auto Forge\./,
  'Recruit Auto Forge must block inference with a connect-provider prompt when model auth is missing',
)
assert.match(
  recruitModal,
  /title=\{`Connect \$\{selectedProviderAuth\.label \|\| selectedProviderAuth\.provider\} authentication`\}/,
  'Recruit flow must expose a connect-provider auth button near missing model credentials',
)

assert.equal(
  packageJson.scripts?.['smoke:provider-auth-beta'],
  'tsx scripts/smoke-provider-auth-beta-coverage.ts',
  'package.json should expose smoke:provider-auth-beta',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:provider-auth-beta'),
  'test:ci should run the provider auth beta coverage smoke',
)

console.log('provider auth beta coverage contract ok')

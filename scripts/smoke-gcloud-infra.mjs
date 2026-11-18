import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const infra = path.join(root, 'infra', 'gcloud')
const requiredFiles = [
  'Common.ps1',
  'config.psd1',
  'configure-domain.ps1',
  'deploy.ps1',
  'export-firestore.ps1',
  'firestore.indexes.json',
  'health.ps1',
  'import-firestore.ps1',
  'initialize-firestore.ps1',
  'migrate-firestore.ps1',
  'README.md',
  'rollback.ps1',
  'shopify-plan-mappings.json',
  'switch-traffic.ps1',
  'verify.ps1',
  'service/Dockerfile',
  'service/geminiThinking.js',
  'service/relayModelPolicy.js',
  'service/tokenOptimization.js',
  'service/package-lock.json',
  'service/package.json',
  'service/server.js',
  'tools/firestore-snapshot.mjs',
  'tools/live-billing-test.mjs',
  'tools/plan-hash.mjs',
  'tools/smoke-service.mjs',
]

for (const relative of requiredFiles) assert.equal(existsSync(path.join(infra, relative)), true, `missing ${relative}`)

const mappings = JSON.parse(readFileSync(path.join(infra, 'shopify-plan-mappings.json'), 'utf8'))
const config = readFileSync(path.join(infra, 'config.psd1'), 'utf8')
assert.match(config, /TokensPerCredit\s*=\s*1000/, 'gcloud config must keep the 1,000-token credit ratio explicit')
assert.equal(mappings.length, 9, 'the production catalog contains six paid refills, two subscriptions, and one BYOK license')
assert.equal(mappings.every((entry) => Number.isSafeInteger(entry.initialTokens) && entry.initialTokens >= 0), true, 'Shopify grants must be declared in raw tokens')
assert.deepEqual(
  Object.fromEntries(mappings.filter((entry) => entry.kind === 'subscription' && entry.tier === 'starter').map((entry) => [entry.tier, entry.initialTokens])),
  { starter: 22000000 },
)
assert.deepEqual(
  Object.fromEntries(mappings.filter((entry) => entry.tier === 'pro').map((entry) => [entry.tier, entry.initialTokens])),
  { pro: 55000000 },
)
assert.deepEqual(
  Object.fromEntries(mappings.filter((entry) => entry.kind === 'subscription').map((entry) => [entry.tier, entry.planPriceCents])),
  { starter: 1999, pro: 2999 },
  'Starter and Pro must use their approved monthly subscription prices',
)
assert.deepEqual(
  mappings.filter((entry) => entry.mode === 'byok').map((entry) => ({ kind: entry.kind, planPriceCents: entry.planPriceCents, permanentAccess: entry.permanentAccess })),
  [{ kind: 'license', planPriceCents: 2999, permanentAccess: true }],
  'BYOK must remain a one-time permanent-access product',
)
assert.equal(mappings.some((entry) => entry.skus.some((sku) => /qa|free|test/i.test(sku))), false, 'free QA and test products must not be part of the production catalog')
const configuredVariantIds = mappings.flatMap((entry) => entry.variantIds).filter(Boolean)
assert.equal(new Set(configuredVariantIds).size, configuredVariantIds.length, 'configured variant IDs must be unique')
assert.equal(new Set(mappings.flatMap((entry) => entry.skus)).size, 9, 'SKUs must be unique')
assert.equal(mappings.filter((entry) => entry.kind === 'topup').length, 6)

const indexConfig = JSON.parse(readFileSync(path.join(infra, 'firestore.indexes.json'), 'utf8'))
assert.ok(Array.isArray(indexConfig.indexes))
assert.ok(Array.isArray(indexConfig.fieldOverrides))

const service = readFileSync(path.join(infra, 'service', 'server.js'), 'utf8')
assert.doesNotMatch(service, /groovy-iris|336625531977|idkndr7vfq-ue\.a\.run\.app/)
assert.match(service, /id="mac-arch-note"/, 'download page must tell Mac customers to select Intel or Apple silicon manually')
assert.match(service, /if\(\/Mac\/i\.test\(ua\)\)\{const note=/, 'download page must show explicit architecture guidance on Mac')
assert.doesNotMatch(service, /\/Mac\/i\.test\(ua\)\?'macos-arm64'/, 'download page must not guess that every Mac uses Apple silicon')
for (const contract of [
  "app.get('/health'",
  "app.get('/ready'",
  "app.post('/api/verify'",
  "app.post('/api/activate', requireWritesEnabled",
  "app.post('/api/ai/generate', requireWritesEnabled",
  "app.post('/shopify/webhooks/:webhookName', requireWritesEnabled",
  'planMappingHash',
  'schemaVersion',
  'writeMode',
]) assert.match(service, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.match(service, /vertexInlineImagePart/)
assert.match(service, /vertexPartsFromOpenAiContent/)
assert.match(service, /functionResponse/)
assert.match(service, /thought_signature/)
assert.match(service, /tool_calls/)
assert.doesNotMatch(service, /Runtime tool request:.*Arguments:/s)
assert.match(service, /function pooledCreditBalance\(record\)/, 'account hosted-credit pooling must remain explicit')
assert.match(service, /const TOKENS_PER_CREDIT/, 'hosted billing must have an explicit token-to-credit ratio')
assert.match(service, /function tokensToCredits\(tokens\)/, 'hosted billing must convert token usage into display credits')
assert.match(service, /geminiThinkingConfigFromOpenAiRequest/, 'the relay must translate OpenAI-compatible thinking levels')
assert.match(service, /automniaRelayModel/, 'the relay must expose an explicit billable Vertex primary model')
assert.match(service, /aiRelayModel: automniaRelayModel/, 'health must report the billable Vertex model')
assert.match(service, /generateVertexContentWithHostedFallback/, 'the hosted relay must fail over across Automnia models')
assert.match(service, /resolveAutomniaRelayModel/, 'the hosted relay must enforce its bounded model allowlist')
assert.match(service, /compactOpenAiMessages/, 'the hosted relay must compact conversation context before Vertex')
assert.match(service, /compactOpenAiTools/, 'the hosted relay must compact tool schemas before Vertex')
assert.match(service, /persistHostedResponse/, 'the hosted relay must persist idempotent responses for replay')
assert.match(service, /resolveRelayOutputTokenBudget/, 'the hosted relay must apply an automatic output budget')
assert.match(service, /thinkingConfig/, 'the relay must forward Gemini thinking configuration to Vertex')
assert.match(service, /creditBalance: pooledCreditBalance\(record\)/, 'license responses must expose the pooled wallet')
assert.match(service, /record\?\.mode === 'byok'\s*&&\s*pooledCreditBalance\(record\)\s*<=\s*0\s*\?\s*'provider_first'\s*:\s*'automnia_only'/, 'BYOK with a pooled balance must not be forced to provider-first')
assert.match(service, /tokenBalanceForSource\(record\) \+ grant/, 'upgrades must add new tokens without resetting the current wallet')
assert.match(service, /for \(const candidate of \[record, \.\.\.candidates\]\)/, 'the canonical upgraded entitlement must remain first in wallet allocation')
assert.match(service, /creditSourcesFor\(canonical\)/, 'relay deductions must use every non-revoked wallet source')

const servicePackage = JSON.parse(readFileSync(path.join(infra, 'service', 'package.json'), 'utf8'))
for (const dependency of ['@google-cloud/firestore', 'express', 'google-auth-library']) assert.ok(servicePackage.dependencies[dependency])

const serverCloudConfig = readFileSync(path.join(root, 'server', 'config', 'automniaCloud.ts'), 'utf8')
const rendererCloudConfig = readFileSync(path.join(root, 'src', 'config', 'gcloudConfig.ts'), 'utf8')
for (const source of [serverCloudConfig, rendererCloudConfig]) {
  assert.match(source, /https:\/\/api\.automnia\.app/)
  assert.doesNotMatch(source, /automnia-shopify-provisioner-[a-z0-9-]+\.a\.run\.app|api\.automnia\.ai|licenseKey|creditBalance|@gmail\.com/)
}

const licenseService = readFileSync(path.join(root, 'server', 'services', 'license', 'licenseService.ts'), 'utf8')
const controlPlane = readFileSync(path.join(root, 'server', 'controlPlane.ts'), 'utf8')
assert.match(licenseService, /DEFAULT_LICENSE_API_URL = AUTOMNIA_PUBLIC_CLOUD_URL/)
assert.doesNotMatch(controlPlane, /streamAutomniaCloudRelay|AUTOMNIA_CLOUD_RELAY_URL/)
assert.match(controlPlane, /AUTOMNIA_OPENCLAW_PROVIDER_ID = AUTOMNIA_CREDITS_PROVIDER_ID/)
assert.match(controlPlane, /reasoning: true,\s*thinkingLevelMap: bareModelId === 'gemini-4-hydrogen'\s*\? AUTOMNIA_GEMINI_4_HYDROGEN_OPENCLAW_THINKING_LEVEL_MAP\s*:/s, 'Automnia Gemini must expose the supported Gemini 4 thinking levels to OpenClaw')
assert.match(controlPlane, /synchronizeOpenClawBillingRouteForAgentRun/, 'agent turns must repair a stale hosted Gemini thinking profile before dispatch')
assert.match(licenseService, /AUTOMNIA_PUBLIC_CLOUD_URL/)
assert.match(serverCloudConfig, /api\.automnia\.app/)

const verification = readFileSync(path.join(infra, 'verify.ps1'), 'utf8')
for (const gate of [
  'customer-count',
  'credit-balance-total',
  'firestore-indexes-source-target',
  'shopify-plan-mappings-source-target',
  'live-billing-tests',
  'secret:',
]) assert.ok(verification.includes(gate), `verification gate missing: ${gate}`)

const cutover = readFileSync(path.join(infra, 'switch-traffic.ps1'), 'utf8')
const deployment = readFileSync(path.join(infra, 'deploy.ps1'), 'utf8')
const firestoreMigration = readFileSync(path.join(infra, 'migrate-firestore.ps1'), 'utf8')
assert.match(deployment, /MIGRATION_WRITE_MODE: '\$migrationWriteMode'/, 'staged deployment must explicitly select read-only mode')
assert.match(deployment, /if \(-not \$RouteImmediately -and \$existing\) \{\s*\$arguments \+= '--no-traffic'\s*\}/, 'later staged revisions must use zero traffic while initial service creation bootstraps read-only')
assert.match(deployment, /Cloud Run rejects --no-traffic when creating a service for the first/, 'first-time staged service creation must work with Cloud Run')
assert.match(firestoreMigration, /MIGRATION_WRITE_MODE=read_only/, 'full staging refreshes must preserve read-only mode')
assert.match(firestoreMigration, /-ExpectedWriteMode read_only/, 'full staging refresh health checks must require read-only mode')
assert.match(cutover, /finalVerification = &\s*\(Join-Path \$PSScriptRoot 'verify\.ps1'\)/, 'cutover must verify after the final delta')
assert.match(cutover, /-ExpectedWriteMode read_only/, 'final parity must be verified while the target is read-only')
assert.match(cutover, /MIGRATION_WRITE_MODE=active[\s\S]*?--no-traffic[\s\S]*?--tag=candidate/, 'cutover must check an active candidate before routing it')
assert.match(cutover, /MIGRATION_WRITE_MODE=read_only/)
assert.match(cutover, /migrate-firestore\.ps1/)
assert.match(cutover, /Remove-DomainMapping/)

const rollback = readFileSync(path.join(infra, 'rollback.ps1'), 'utf8')
assert.match(rollback, /migrate-firestore\.ps1/)
assert.match(rollback, /verify\.ps1/)
assert.match(rollback, /-ExpectedWriteMode read_only/)
assert.match(rollback, /MIGRATION_WRITE_MODE=active[\s\S]*?--no-traffic[\s\S]*?--tag=candidate/, 'rollback must check an active candidate before routing it')
assert.match(rollback, /MIGRATION_WRITE_MODE=read_only/)

for (const relative of ['service/server.js', 'service/geminiThinking.js', 'service/relayModelPolicy.js', 'service/tokenOptimization.js', 'tools/firestore-snapshot.mjs', 'tools/live-billing-test.mjs', 'tools/plan-hash.mjs', 'tools/smoke-service.mjs']) {
  const checked = spawnSync(process.execPath, ['--check', path.join(infra, relative)], { encoding: 'utf8' })
  assert.equal(checked.status, 0, `${relative} syntax error: ${checked.stderr}`)
}

if (process.platform === 'win32') {
  const escaped = infra.replaceAll("'", "''")
  const parseCommand = `$errors=@(); Get-ChildItem -LiteralPath '${escaped}' -Filter *.ps1 -File | ForEach-Object { $tokens=$null; $parseErrors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$parseErrors); $errors += @($parseErrors) }; if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}`
  const parsed = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', parseCommand], { encoding: 'utf8' })
  assert.equal(parsed.status, 0, `PowerShell parse errors: ${parsed.stdout}\n${parsed.stderr}`)
}

console.log(`gcloud infrastructure smoke passed (${requiredFiles.length} files, ${readdirSync(infra).length} top-level entries)`)

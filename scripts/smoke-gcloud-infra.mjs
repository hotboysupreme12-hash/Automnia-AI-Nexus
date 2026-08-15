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
assert.equal(mappings.length, 12, 'the production catalog has twelve mappings')
assert.deepEqual(
  Object.fromEntries(mappings.filter((entry) => entry.kind === 'subscription' && entry.tier === 'starter').map((entry) => [entry.tier, entry.initialCredits])),
  { starter: 500000 },
)
assert.equal(new Set(mappings.flatMap((entry) => entry.variantIds)).size, 12, 'variant IDs must be unique')
assert.equal(new Set(mappings.flatMap((entry) => entry.skus)).size, 12, 'SKUs must be unique')
assert.equal(mappings.filter((entry) => entry.kind === 'topup').length, 8)
assert.equal(mappings.find((entry) => entry.mode === 'byok')?.initialCredits, 0)

const indexConfig = JSON.parse(readFileSync(path.join(infra, 'firestore.indexes.json'), 'utf8'))
assert.ok(Array.isArray(indexConfig.indexes))
assert.ok(Array.isArray(indexConfig.fieldOverrides))

const service = readFileSync(path.join(infra, 'service', 'server.js'), 'utf8')
assert.doesNotMatch(service, /groovy-iris|336625531977|idkndr7vfq-ue\.a\.run\.app/)
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
assert.match(service, /creditBalance: pooledCreditBalance\(record\)/, 'license responses must expose the pooled wallet')
assert.match(service, /record\?\.mode === 'byok' && pooledCreditBalance\(record\) <= 0 \? 'provider_first' : 'automnia_first'/, 'BYOK with a pooled balance must not be forced to provider-first')
assert.match(service, /creditBalance: \(record\.creditBalance \|\| 0\) \+ grant/, 'upgrades must add new credits without resetting the current wallet')
assert.match(service, /for \(const candidate of \[record, \.\.\.candidates\]\)/, 'the canonical upgraded entitlement must remain first in wallet allocation')
assert.match(service, /creditSourcesFor\(canonical\)/, 'relay deductions must use every non-revoked wallet source')

const servicePackage = JSON.parse(readFileSync(path.join(infra, 'service', 'package.json'), 'utf8'))
for (const dependency of ['@google-cloud/firestore', 'express', 'google-auth-library']) assert.ok(servicePackage.dependencies[dependency])

const serverCloudConfig = readFileSync(path.join(root, 'server', 'config', 'automniaCloud.ts'), 'utf8')
const rendererCloudConfig = readFileSync(path.join(root, 'src', 'config', 'gcloudConfig.ts'), 'utf8')
for (const source of [serverCloudConfig, rendererCloudConfig]) {
  assert.match(source, /https:\/\/automnia-shopify-provisioner-idkndr7vfq-ue\.a\.run\.app/)
  assert.doesNotMatch(source, /api\.automnia\.ai|licenseKey|creditBalance|@gmail\.com/)
}

const licenseService = readFileSync(path.join(root, 'server', 'services', 'license', 'licenseService.ts'), 'utf8')
const controlPlane = readFileSync(path.join(root, 'server', 'controlPlane.ts'), 'utf8')
assert.match(licenseService, /DEFAULT_LICENSE_API_URL = AUTOMNIA_PUBLIC_CLOUD_URL/)
assert.doesNotMatch(controlPlane, /streamAutomniaCloudRelay|AUTOMNIA_CLOUD_RELAY_URL/)
assert.match(controlPlane, /AUTOMNIA_OPENCLAW_PROVIDER_ID = 'automnia-cloud'/)
assert.match(licenseService, /AUTOMNIA_PUBLIC_CLOUD_URL/)
assert.match(serverCloudConfig, /automnia-shopify-provisioner-idkndr7vfq-ue\.a\.run\.app/)

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
assert.ok((cutover.match(/verify\.ps1/g) || []).length >= 2, 'cutover must verify before and after the final delta')
assert.match(cutover, /MIGRATION_WRITE_MODE=read_only/)
assert.match(cutover, /migrate-firestore\.ps1/)
assert.match(cutover, /Remove-DomainMapping/)

const rollback = readFileSync(path.join(infra, 'rollback.ps1'), 'utf8')
assert.match(rollback, /migrate-firestore\.ps1/)
assert.match(rollback, /verify\.ps1/)
assert.match(rollback, /MIGRATION_WRITE_MODE=read_only/)

for (const relative of ['service/server.js', 'tools/firestore-snapshot.mjs', 'tools/live-billing-test.mjs', 'tools/plan-hash.mjs', 'tools/smoke-service.mjs']) {
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

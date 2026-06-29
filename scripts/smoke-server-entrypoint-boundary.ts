import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const entry = read('server/index.ts')
const controlPlane = read('server/controlPlane.ts')
const shiftRoutes = read('server/routes/shiftRoutes.ts')
const partyManagementRoutes = read('server/routes/partyManagementRoutes.ts')
const agentConfigRoutes = read('server/routes/agentConfigRoutes.ts')
const browserRoutes = read('server/routes/browserRoutes.ts')
const staticUi = read('server/staticUi.ts')
const providerCatalog = read('server/catalogs/providerCatalog.ts')
const routingHelpers = read('server/integrations/agentRoutingHelpers.ts')
const reporter = read('scripts/report-server-index-architecture.mjs')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

const entryLines = entry.split(/\r?\n/).length
const controlPlaneLines = controlPlane.split(/\r?\n/).length
const inlineRoutes = [...controlPlane.matchAll(/\bapp\.(?:get|post|put|patch|delete|options|head)\(\s*['"]\/api\//g)]

assert.ok(entryLines <= 20, `server/index.ts must remain a tiny executable facade, found ${entryLines} lines`)
assert.match(entry, /import ['"]\.\/controlPlane['"]/, 'entrypoint should import the control-plane composition root')
assert.doesNotMatch(entry, /\bexpress\b|process\.env|\bapp\.(?:get|post|use)\(|['"]\/api\//, 'entrypoint must not own runtime or route policy')
assert.ok(controlPlaneLines <= 27_600, `controlPlane.ts exceeded the current extraction budget: ${controlPlaneLines} lines`)
assert.equal(inlineRoutes.length, 0, `controlPlane.ts must not own inline API routes: ${inlineRoutes.length}`)
assert.match(controlPlane, /prepareSourceOpenClawVendorIfMissing/, 'controlPlane.ts should self-heal source OpenClaw vendor artifacts before runtime resolution')

for (const contract of [
  ["import { registerBrowserRoutes } from './routes/browserRoutes'", 'browser route import'],
  ["import { registerShiftRoutes } from './routes/shiftRoutes'", 'shift route import'],
  ["import { registerPartyManagementRoutes } from './routes/partyManagementRoutes'", 'party management route import'],
  ["import { registerAgentConfigRoutes } from './routes/agentConfigRoutes'", 'agent config route import'],
  ["import { registerStaticUi } from './staticUi'", 'static UI import'],
  ["from './catalogs/providerCatalog'", 'provider catalog import'],
  ["from './integrations/agentRoutingHelpers'", 'routing patch import'],
  ['registerBrowserRoutes(app, { checkBrowserPreflight })', 'browser route registration'],
  ['registerShiftRoutes(app, {', 'shift route registration'],
  ['registerPartyManagementRoutes(app, partyManagementRoutesContext)', 'party management route registration'],
  ['registerAgentConfigRoutes(app, agentConfigRoutesContext)', 'agent config route registration'],
  ['registerStaticUi(app, {', 'static UI registration'],
] as const) {
  assert.ok(controlPlane.includes(contract[0]), `controlPlane.ts is missing ${contract[1]}`)
}

assert.doesNotMatch(controlPlane, /\bapp\.(?:get|post|put|patch|delete|options|head)\(\s*['"]\/api\//, 'all API endpoints must remain outside controlPlane.ts')
assert.doesNotMatch(controlPlane, /app\.(?:get|post)\(['"]\/api\/shifts/, 'shift endpoints must remain outside controlPlane.ts')
assert.doesNotMatch(controlPlane, /app\.get\(['"]\/api\/browser\/preflight/, 'browser preflight must remain outside controlPlane.ts')
assert.match(shiftRoutes, /export function registerShiftRoutes/, 'shift route module should expose a typed registration boundary')
assert.match(browserRoutes, /export function registerBrowserRoutes/, 'browser route module should expose a typed registration boundary')
assert.match(partyManagementRoutes, /export function registerPartyManagementRoutes/, 'party management route module should expose a typed registration boundary')
assert.match(agentConfigRoutes, /export function registerAgentConfigRoutes/, 'agent config route module should expose a typed registration boundary')
for (const route of [
  '/api/party/overview',
  '/api/party/recruit',
  '/api/party/workspace',
  '/api/party/avatar-upload/:agentId',
]) {
  assert.ok(partyManagementRoutes.includes(route), `party management route module is missing ${route}`)
}
for (const route of [
  '/api/party/agent/:agentId/config',
  '/api/party/configs/sync',
  '/api/party/agent/:agentId/model',
]) {
  assert.ok(agentConfigRoutes.includes(route), `agent config route module is missing ${route}`)
}
assert.match(staticUi, /export function registerStaticUi/, 'static UI module should expose a registration boundary')
assert.match(providerCatalog, /export const AUTH_PROVIDER_CATALOG/, 'provider catalog should remain extracted')
assert.match(routingHelpers, /export const CLAWTALK_CORE_BRIDGE_ROUTING_HELPER/, 'ClawTalk patch source should remain extracted')
assert.match(reporter, /server', 'controlPlane\.ts'/, 'architecture reporter should analyze the composition root')

for (const script of ['dev:server', 'build:server', 'start']) {
  assert.ok(packageJson.scripts?.[script]?.includes('server/index.ts'), `${script} should continue targeting the executable facade`)
}
assert.equal(packageJson.scripts?.['smoke:server-architecture'], 'tsx scripts/smoke-server-entrypoint-boundary.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:server-architecture'))

console.log(`server architecture contract ok (${entryLines} entry lines, ${controlPlaneLines} composition lines, ${inlineRoutes.length} inline routes)`)

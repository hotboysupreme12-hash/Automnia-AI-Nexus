import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const pluginRoutes = read('server/routes/pluginRoutes.ts')
const pluginInventoryService = read('server/services/plugins/pluginInventoryService.ts')
const pluginInventoryTests = read('tests/pluginInventoryService.test.ts')
const architectureSmoke = read('scripts/smoke-server-entrypoint-boundary.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

for (const marker of [
  'export function createPluginInventoryService',
  'export const PLUGIN_ID_PATTERN',
  'export const PLUGIN_CATALOG',
  'function loadBundledPluginManifestList',
  'function readPluginListDiskCache',
  'function writePluginListDiskCache',
  'async function refreshPluginListCache',
  'async function getPluginList',
  'async function listPluginControls',
  'function buildPluginControlEntry',
  'function knownPluginConfigFields',
  'function pluginGuidance',
  'export function parsePluginList',
  'export function sanitizePluginCliError',
  'export function pluginCliWarningFromOutput',
]) {
  assert.ok(pluginInventoryService.includes(marker), `pluginInventoryService.ts is missing ${marker}`)
}

for (const marker of [
  "from './services/plugins/pluginInventoryService'",
  'let pluginInventoryService: PluginInventoryService | null = null',
  'function activePluginInventoryService()',
  'function getPluginList(options?: { forceRefresh?: boolean })',
  'function listPluginControls(options?: { forceRefresh?: boolean })',
  'function refreshPluginListCache()',
  'activePluginInventoryService().listPluginControls(options)',
  'createPluginInventoryService({',
  'pluginInventoryService = createPluginInventoryService({',
  'providerAuthStatus,',
  'readPluginRuntimeState,',
  'pluginListCacheStateKey: CONTROL_CENTER_STATE_KEYS.pluginListCache',
]) {
  assert.ok(controlPlane.includes(marker), `controlPlane.ts is missing plugin inventory wiring: ${marker}`)
}

for (const forbidden of [
  /\bfunction\s+loadBundledPluginManifestList\b/,
  /\bfunction\s+readPluginListDiskCache\b/,
  /\bfunction\s+writePluginListDiskCache\b/,
  /\basync function\s+refreshPluginListCache\b/,
  /\bfunction\s+refreshPluginListCacheInBackground\b/,
  /\basync function\s+getPluginList\b/,
  /\basync function\s+listPluginControls\b/,
  /\bfunction\s+buildPluginControlEntry\b/,
  /\bfunction\s+knownPluginConfigFields\b/,
  /\bfunction\s+pluginGuidance\b/,
  /\bfunction\s+parsePluginList\b/,
  /\blet\s+pluginListCache\b/,
  /\blet\s+pluginListRefreshPromise\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts still owns plugin inventory internals: ${forbidden}`)
}

assert.match(pluginRoutes, /listPluginControls: \(options\?: \{ forceRefresh\?: boolean \}\) => Promise<PluginControlsPayload>/, 'plugin routes should receive plugin inventory through options')
assert.ok(pluginRoutes.includes("app.get('/api/plugins'"), 'plugin list route should remain in pluginRoutes.ts')
assert.ok(pluginRoutes.includes('options.listPluginControls({ forceRefresh })'), 'plugin list route should delegate inventory reads through options')

for (const coverage of [
  'plugin inventory lists configured, missing-auth, unavailable, failed, managed, and disabled states',
  'plugin inventory falls back to bundled manifests and redacts CLI warnings',
  'plugin inventory force refresh returns cached controls while background refresh runs',
]) {
  assert.ok(pluginInventoryTests.includes(coverage), `pluginInventoryService.test.ts is missing coverage: ${coverage}`)
}

assert.ok(architectureSmoke.includes("read('server/services/plugins/pluginInventoryService.ts')"), 'architecture smoke should load plugin inventory service')
assert.equal(
  packageJson.scripts?.['smoke:plugin-inventory-service'],
  'tsx scripts/smoke-plugin-inventory-service.ts',
  'package.json should expose smoke:plugin-inventory-service',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugin-inventory-service'),
  'test:ci should run smoke:plugin-inventory-service',
)

console.log('plugin inventory service boundary ok')

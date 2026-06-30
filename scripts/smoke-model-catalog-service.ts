import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const providerAuthRoutes = read('server/routes/providerAuthRoutes.ts')
const agentConfigRoutes = read('server/routes/agentConfigRoutes.ts')
const partyManagementRoutes = read('server/routes/partyManagementRoutes.ts')
const modelCatalogService = read('server/services/providers/modelCatalogService.ts')
const modelCatalogTest = read('tests/modelCatalogService.test.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

for (const marker of [
  'export const FALLBACK_MODELS',
  'export const KNOWN_UNAVAILABLE_MODEL_IDS',
  'export const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS',
  'export function canonicalAgentModelId',
  'export function isOpenAiCodexSubscriptionModel',
  'export function isModelSafeForOpenClawConfig',
  'export function createModelCatalogService',
  'function ensureConfiguredModelAllowlist',
  'function ensureOpenRouterModelCatalogAllowlist',
  'async function loadAvailableModelsFromOpenClaw',
  'function refreshAvailableModelsCache',
  'function getFastAvailableModelsCatalog',
]) {
  assert.ok(modelCatalogService.includes(marker), `modelCatalogService.ts is missing ${marker}`)
}

for (const marker of [
  "from './services/providers/modelCatalogService'",
  'createModelCatalogService({',
  'const ensureConfiguredModelAllowlist = (config: OpenClawConfigFile, modelIds: string[]) =>',
  'const fallbackAvailableModels = modelCatalogService.fallbackAvailableModels',
  'const getFastAvailableModelsCatalog = modelCatalogService.getFastAvailableModelsCatalog',
  'const invalidateAvailableModelsForAuthChange = modelCatalogService.invalidateAvailableModelsForAuthChange',
  'const refreshAvailableModelsCache = modelCatalogService.refreshAvailableModelsCache',
  'modelCatalogService.invalidateAvailableModels()',
  'modelCatalogService.clearRefreshTimer()',
]) {
  assert.ok(controlPlane.includes(marker), `controlPlane.ts is missing model catalog service wiring: ${marker}`)
}

for (const forbidden of [
  /\bfunction\s+loadAvailableModelsFromOpenClaw\b/,
  /\bfunction\s+fallbackAvailableModels\b/,
  /\bfunction\s+mergeAvailableModels\b/,
  /\bfunction\s+orderAvailableModels\b/,
  /\bfunction\s+ensureConfiguredProviderModel\b/,
  /\bfunction\s+ensureModelAllowlistEntry\b/,
  /\blet\s+availableModelsCache\b/,
  /\blet\s+availableModelsRefreshPromise\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts still owns model catalog internals: ${forbidden}`)
}

assert.ok(providerAuthRoutes.includes('getFastAvailableModelsCatalog'), 'provider auth routes should receive model catalog fast reads through options')
assert.ok(providerAuthRoutes.includes('refreshAvailableModelsCache'), 'provider auth routes should receive model catalog refresh through options')
assert.ok(agentConfigRoutes.includes('ensureConfiguredModelAllowlist'), 'agent config routes should receive model allowlist normalization through options')
assert.ok(partyManagementRoutes.includes('ensureConfiguredModelAllowlist'), 'party management routes should receive model allowlist normalization through options')

for (const coverage of [
  'fallback catalog canonicalizes Codex subscription models',
  'refresh loads OpenClaw catalog and normalizes OpenRouter allowlist',
  'refresh falls back to configured models',
  'configured model allowlist normalizes provider entries',
]) {
  assert.ok(modelCatalogTest.includes(coverage), `modelCatalogService.test.ts is missing coverage: ${coverage}`)
}

assert.equal(
  packageJson.scripts?.['smoke:model-catalog-service'],
  'tsx scripts/smoke-model-catalog-service.ts',
  'package.json should expose smoke:model-catalog-service',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:model-catalog-service'),
  'test:ci should run smoke:model-catalog-service',
)

console.log('model catalog service boundary ok')

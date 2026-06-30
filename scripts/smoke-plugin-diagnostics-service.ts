import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const pluginRoutes = read('server/routes/pluginRoutes.ts')
const pluginDiagnosticsService = read('server/services/plugins/pluginDiagnosticsService.ts')
const pluginDiagnosticsTests = read('tests/pluginDiagnosticsService.test.ts')
const architectureSmoke = read('scripts/smoke-server-entrypoint-boundary.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

for (const marker of [
  'export function createPluginDiagnosticsService',
  'function normalizeClawTalkApiKeyInput',
  'function normalizeClawTalkServerInput',
  'function clawTalkDoctorStatusFromLine',
  'function parseClawTalkDoctorSummary',
  'async function runClawTalkDoctorOnce',
  'async function waitForClawTalkDoctor',
  'async function waitForClawTalkRuntimeInspect',
  'async function setupClawTalkPlugin',
  'options.redactSensitiveText',
  "options.runOpenClaw(args, 75_000)",
  "options.tryRestartGatewayService({ force: true, reason: 'ClawTalk setup requested gateway restart' })",
]) {
  assert.ok(pluginDiagnosticsService.includes(marker), `pluginDiagnosticsService.ts is missing ${marker}`)
}

for (const marker of [
  "from './services/plugins/pluginDiagnosticsService'",
  'let pluginDiagnosticsService: PluginDiagnosticsService | null = null',
  'function activePluginDiagnosticsService()',
  "const setupClawTalkPlugin: PluginDiagnosticsService['setupClawTalkPlugin']",
  'pluginDiagnosticsService = createPluginDiagnosticsService({',
  'saveClawTalkSetupConfig,',
  'repairClawTalkPluginManifestContracts,',
  'inspectOpenClawPluginRuntime,',
  'pluginRuntimeInspectReady,',
]) {
  assert.ok(controlPlane.includes(marker), `controlPlane.ts is missing plugin diagnostics wiring: ${marker}`)
}

for (const forbidden of [
  /\bfunction\s+normalizeClawTalkApiKeyInput\b/,
  /\bfunction\s+normalizeClawTalkServerInput\b/,
  /\bfunction\s+clawTalkDoctorStatusFromLine\b/,
  /\bfunction\s+parseClawTalkDoctorSummary\b/,
  /\basync function\s+runClawTalkDoctorOnce\b/,
  /\basync function\s+waitForClawTalkDoctor\b/,
  /\basync function\s+waitForClawTalkRuntimeInspect\b/,
  /\basync function\s+setupClawTalkPlugin\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts still owns plugin diagnostics internals: ${forbidden}`)
}

assert.match(
  pluginRoutes,
  /setupClawTalkPlugin: \(params: \{[\s\S]*?\}\) => Promise<ClawTalkSetupResult>/,
  'plugin routes should receive ClawTalk setup through options',
)
assert.match(
  pluginRoutes,
  /const result = await options\.setupClawTalkPlugin\(parsed\.data\)/,
  'plugin routes should delegate ClawTalk setup through route options',
)

for (const coverage of [
  'plugin diagnostics service configures installed ClawTalk and redacts doctor output',
  'plugin diagnostics service installs missing ClawTalk before setup verification',
  'plugin diagnostics service rejects invalid setup input and missing install approval',
  'plugin diagnostics service reports verification failures from runtime and doctor checks',
]) {
  assert.ok(pluginDiagnosticsTests.includes(coverage), `pluginDiagnosticsService.test.ts is missing coverage: ${coverage}`)
}

assert.ok(architectureSmoke.includes("read('server/services/plugins/pluginDiagnosticsService.ts')"), 'architecture smoke should load plugin diagnostics service')
assert.equal(
  packageJson.scripts?.['smoke:plugin-diagnostics-service'],
  'tsx scripts/smoke-plugin-diagnostics-service.ts',
  'package.json should expose smoke:plugin-diagnostics-service',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugin-diagnostics-service'),
  'test:ci should run smoke:plugin-diagnostics-service',
)

console.log('plugin diagnostics service boundary ok')

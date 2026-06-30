import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const pluginRoutes = read('server/routes/pluginRoutes.ts')
const pluginRuntimeService = read('server/services/plugins/pluginRuntimeService.ts')
const pluginRuntimeTests = read('tests/pluginRuntimeService.test.ts')
const architectureSmoke = read('scripts/smoke-server-entrypoint-boundary.ts')
const runtimeActionsSmoke = read('scripts/smoke-runtime-actions-control-plane.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

for (const marker of [
  'export function createPluginRuntimeService',
  'async function inspectOpenClawPluginRuntime',
  'function summarizePluginRuntimeInspect',
  'function startPluginSetupTerminalSession',
  'function attachPluginSetupTerminalClient',
  'function writePluginSetupTerminalInput',
  'function resizePluginSetupTerminalSession',
  'function stopPluginSetupTerminalSession',
  'function stopAllPluginSetupTerminalSessions',
  'options.runOpenClaw(args, 120_000)',
  'pluginCommandResult(args, command, options.redactSensitiveText)',
  'options.terminateProcessTree(session.pid, reason, true)',
]) {
  assert.ok(pluginRuntimeService.includes(marker), `pluginRuntimeService.ts is missing ${marker}`)
}

for (const marker of [
  "from './services/plugins/pluginRuntimeService'",
  'let pluginRuntimeService: PluginRuntimeService | null = null',
  'function activePluginRuntimeService()',
  "const inspectOpenClawPluginRuntime: PluginRuntimeService['inspectOpenClawPluginRuntime']",
  "const pluginRuntimeInspectReady: PluginRuntimeService['pluginRuntimeInspectReady']",
  "const stopAllPluginSetupTerminalSessions: PluginRuntimeService['stopAllPluginSetupTerminalSessions']",
  'pluginRuntimeService = createPluginRuntimeService({',
  'openClawProcessEnv,',
  'openClawSpawnSpec,',
  'terminateProcessTree,',
  'pluginRuntime: activePluginRuntimeService()',
]) {
  assert.ok(controlPlane.includes(marker), `controlPlane.ts is missing plugin runtime wiring: ${marker}`)
}

for (const forbidden of [
  /\basync function\s+inspectOpenClawPluginRuntime\b/,
  /\bfunction\s+summarizePluginRuntimeInspect\b/,
  /\bfunction\s+pluginInspectSurfaceValues\b/,
  /\bfunction\s+pluginInspectNestedRecord\b/,
  /\bfunction\s+startPluginSetupTerminalSession\b/,
  /\bfunction\s+stopPluginSetupTerminalSession\b/,
  /\bfunction\s+stopAllPluginSetupTerminalSessions\b/,
  /\bconst\s+pluginSetupTerminalSessions\s*=/,
  /\bfunction\s+loadPtyModule\b/,
  /\bfunction\s+createPlainProcessTerminalModule\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts still owns plugin runtime internals: ${forbidden}`)
}

assert.match(
  pluginRoutes,
  /pluginRuntime: PluginRuntimeService/,
  'plugin routes should receive plugin runtime behavior through a service option',
)
for (const routeMarker of [
  'options.pluginRuntime.inspectOpenClawPluginRuntime(pluginId)',
  'options.pluginRuntime.startPluginSetupTerminalSession(parsed.data)',
  'options.pluginRuntime.attachPluginSetupTerminalClient',
  'options.pluginRuntime.writePluginSetupTerminalInput',
  'options.pluginRuntime.resizePluginSetupTerminalSession',
  'options.pluginRuntime.stopPluginSetupTerminalSession',
]) {
  assert.ok(pluginRoutes.includes(routeMarker), `plugin routes should use runtime service: ${routeMarker}`)
}
assert.doesNotMatch(pluginRoutes, /\.process\.(?:write|resize|kill)\(/, 'plugin routes should not mutate terminal processes directly')
assert.doesNotMatch(pluginRoutes, /\.clients\.(?:add|delete|clear)\(/, 'plugin routes should not own terminal client sets')

for (const coverage of [
  'plugin runtime service inspects runtime state, summarizes surfaces, and redacts command output',
  'plugin runtime service rejects invalid ids and redacts failed inspect output',
  'plugin runtime service owns setup terminal command lifecycle and client events',
  'plugin runtime service reports missing/not-running terminal operations and stops sessions for shutdown',
]) {
  assert.ok(pluginRuntimeTests.includes(coverage), `pluginRuntimeService.test.ts is missing coverage: ${coverage}`)
}

assert.ok(architectureSmoke.includes("read('server/services/plugins/pluginRuntimeService.ts')"), 'architecture smoke should load plugin runtime service')
assert.ok(runtimeActionsSmoke.includes('stopAllPluginSetupTerminalSessions'), 'runtime action smoke should still pin terminal shutdown cleanup')
assert.equal(
  packageJson.scripts?.['smoke:plugin-runtime-service'],
  'tsx scripts/smoke-plugin-runtime-service.ts',
  'package.json should expose smoke:plugin-runtime-service',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugin-runtime-service'),
  'test:ci should run smoke:plugin-runtime-service',
)

console.log('plugin runtime service boundary ok')

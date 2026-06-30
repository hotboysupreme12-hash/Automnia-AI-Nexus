import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const pluginRoutes = read('server/routes/pluginRoutes.ts')
const pluginInstallService = read('server/services/plugins/pluginInstallService.ts')
const pluginInstallTests = read('tests/pluginInstallService.test.ts')
const architectureSmoke = read('scripts/smoke-server-entrypoint-boundary.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

for (const marker of [
  'export function createPluginInstallService',
  'async function installOpenClawPlugin',
  'async function updateOpenClawPlugin',
  'async function updateAllOpenClawPlugins',
  'async function uninstallOpenClawPlugin',
  'function recordPluginInstallRuntimeState',
  'function touchPluginManagedRuntimeState',
  'function forgetPluginRuntimeState',
  'function parsePluginInstallInput',
  'function repairPluginInstallRenameFailure',
  'options.schedulePluginGatewayRestart()',
  'options.refreshPluginListCache()',
  'options.redactSensitiveText',
  'options.pauseGatewayForPluginInstallRepair(actions)',
  'options.resumeGatewayAfterPluginInstallRepair',
]) {
  assert.ok(pluginInstallService.includes(marker), `pluginInstallService.ts is missing ${marker}`)
}

for (const marker of [
  "from './services/plugins/pluginInstallService'",
  'let pluginInstallService: PluginInstallService | null = null',
  'function activePluginInstallService()',
  "const installOpenClawPlugin: PluginInstallService['installOpenClawPlugin']",
  "const updateOpenClawPlugin: PluginInstallService['updateOpenClawPlugin']",
  "const updateAllOpenClawPlugins: PluginInstallService['updateAllOpenClawPlugins']",
  "const uninstallOpenClawPlugin: PluginInstallService['uninstallOpenClawPlugin']",
  'pluginInstallService = createPluginInstallService({',
  'pauseGatewayForPluginInstallRepair: (actions) => gatewayLifecycle.pauseForPluginInstallRepair(actions)',
  'resumeGatewayAfterPluginInstallRepair: (actions) => gatewayLifecycle.resumeAfterPluginInstallRepair(actions)',
  'renamePath: renameWithLockRetry',
  'schedulePluginGatewayRestart,',
  'refreshPluginListCache,',
  'listPluginControls,',
  'writePluginRuntimeState,',
]) {
  assert.ok(controlPlane.includes(marker), `controlPlane.ts is missing plugin install wiring: ${marker}`)
}

for (const forbidden of [
  /\basync function\s+installOpenClawPlugin\b/,
  /\basync function\s+updateOpenClawPlugin\b/,
  /\basync function\s+updateAllOpenClawPlugins\b/,
  /\basync function\s+uninstallOpenClawPlugin\b/,
  /\basync function\s+recordPluginInstallRuntimeState\b/,
  /\basync function\s+touchPluginManagedRuntimeState\b/,
  /\basync function\s+forgetPluginRuntimeState\b/,
  /\bfunction\s+parsePluginInstallInput\b/,
  /\bfunction\s+pluginInstallSpecIsLocalPath\b/,
  /\bfunction\s+isCodexPluginInstallRequest\b/,
  /\bfunction\s+repairPluginInstallRenameFailure\b/,
  /\bfunction\s+parsePluginInstallRenameFailure\b/,
  /\bfunction\s+quarantinePluginInstallPath\b/,
]) {
  assert.doesNotMatch(controlPlane, forbidden, `controlPlane.ts still owns plugin install internals: ${forbidden}`)
}

assert.match(
  pluginRoutes,
  /installOpenClawPlugin: \(params: \{[\s\S]*?\}\) => Promise<PluginInstallResult>/,
  'plugin routes should receive plugin install through options',
)
assert.match(
  pluginRoutes,
  /updateAllOpenClawPlugins: \(restartRequested: boolean\) => Promise<PluginCommandResult>/,
  'plugin routes should receive plugin update-all through options',
)
assert.match(
  pluginRoutes,
  /uninstallOpenClawPlugin: \(pluginId: string, options: \{ keepFiles: boolean; force: boolean; restart: boolean \}\) => Promise<PluginCommandResult>/,
  'plugin routes should receive plugin uninstall through options',
)

for (const coverage of [
  'plugin install service installs, enables, refreshes controls, schedules restart, and records runtime state',
  'plugin install service repairs Windows stage rename failure and retries with force',
  'plugin install service updates, update-all touches, and uninstall forgets managed runtime state',
  'plugin install service redacts plugin command failures',
  'plugin install input parser accepts pasted OpenClaw install commands only with safe flags',
]) {
  assert.ok(pluginInstallTests.includes(coverage), `pluginInstallService.test.ts is missing coverage: ${coverage}`)
}

assert.ok(architectureSmoke.includes("read('server/services/plugins/pluginInstallService.ts')"), 'architecture smoke should load plugin install service')
assert.equal(
  packageJson.scripts?.['smoke:plugin-install-service'],
  'tsx scripts/smoke-plugin-install-service.ts',
  'package.json should expose smoke:plugin-install-service',
)
assert.ok(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:plugin-install-service'),
  'test:ci should run smoke:plugin-install-service',
)

console.log('plugin install service boundary ok')

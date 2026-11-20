import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  codexPluginAvailableForRuntime,
  codexPluginNeedsRepair,
  codexPluginVersionNeedsUpdate,
  codexProjectsNeedUpdate,
  newerInstalledCodexVersion,
  requireGatewayForCodexPreflight,
  OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC,
} from '../server/services/plugins/codexPluginHealth'
import type { PluginControlEntry } from '../server/services/plugins/pluginInventoryService'

function plugin(overrides: Partial<PluginControlEntry> = {}): PluginControlEntry {
  return {
    id: 'codex',
    name: 'Codex',
    description: 'Codex',
    origin: 'openclaw',
    status: 'loaded',
    enabled: true,
    configuredEnabled: true,
    runtimeLoaded: true,
    category: 'providers',
    commands: [],
    providers: [],
    channels: [],
    missingDependencies: [],
    configFields: [],
    guidance: [],
    needsSetup: false,
    restartRequired: false,
    ...overrides,
  }
}

test('marks degraded Codex entries for automatic repair', () => {
  assert.equal(codexPluginNeedsRepair(plugin({ status: 'degraded', runtimeLoaded: false })), true)
  assert.equal(codexPluginNeedsRepair(plugin({ missingDependencies: ['ws'] })), true)
  assert.equal(codexPluginNeedsRepair(plugin()), false)
})

test('repairs a loaded Codex plugin when the installed release is older than the pin', () => {
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.5' })), true)
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.6' })), false)
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.7' })), false)
  assert.equal(codexPluginVersionNeedsUpdate('unrecognized', '2026.11.6'), false)
  assert.equal(codexProjectsNeedUpdate(['2026.11.5'], '2026.11.6'), true)
  assert.equal(codexProjectsNeedUpdate(['2026.11.5', '2026.11.6'], '2026.11.6'), false)
  assert.equal(codexProjectsNeedUpdate(['unrecognized'], '2026.11.6'), false)
})

test('waits for Gateway startup before inspecting or repairing Codex', async () => {
  let waits = 0
  await requireGatewayForCodexPreflight({
    isHealthy: async () => false,
    waitForStartup: async () => { waits += 1; return { waited: true, healthy: true } },
  })
  assert.equal(waits, 1)
})

test('defers Codex repair when Gateway startup has not succeeded', async () => {
  await assert.rejects(requireGatewayForCodexPreflight({
    isHealthy: async () => false,
    waitForStartup: async () => ({ waited: true, healthy: false }),
  }), /repair was deferred/)
})

test('does not wait when the Gateway is already healthy', async () => {
  await requireGatewayForCodexPreflight({
    isHealthy: async () => true,
    waitForStartup: async () => { throw new Error('must not wait') },
  })
})

test('protects a newer or unrecognized installed version from automatic downgrade', () => {
  assert.equal(newerInstalledCodexVersion(['2026.11.7'], '2026.11.6'), '2026.11.7')
  assert.equal(newerInstalledCodexVersion(['2026.11.6', '2026.9.2'], '2026.11.6'), undefined)
  assert.equal(newerInstalledCodexVersion(['2026.11.7-rc.1'], '2026.11.6'), '2026.11.7-rc.1')
  assert.equal(newerInstalledCodexVersion(['2026.11.6'], ''), '2026.11.6')
})

test('does not treat a degraded installed entry as runtime-ready', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'error', runtimeLoaded: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'loaded' }), ''), true)
  assert.equal(codexPluginAvailableForRuntime(undefined, 'C:\\bundled\\codex'), true)
})

test('requires enabled state before declaring Codex available', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ enabled: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ configuredEnabled: false }), 'C:\\bundled\\codex'), false)
})

test('automatic Codex installation uses the exact official package supported by this OpenClaw runtime', () => {
  const readinessSource = readFileSync(new URL('../scripts/post-upgrade-openclaw-readiness.mjs', import.meta.url), 'utf8')
  const releaseVersion = /export const CODEX_PLUGIN_VERSION = '([^']+)'/.exec(readinessSource)?.[1]
  const controlPlaneSource = readFileSync(new URL('../server/controlPlane.ts', import.meta.url), 'utf8')

  assert.ok(releaseVersion, 'post-upgrade readiness must pin the Codex plugin release')
  assert.equal(OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC, `npm:@openclaw/codex@${releaseVersion}`)
  assert.match(controlPlaneSource, /spec:\s*bundledCodexSource\s*\|\|\s*OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC/)
  assert.match(controlPlaneSource, /codexProjectsNeedUpdate\(packageVersions, repairVersion\)/)
  assert.match(controlPlaneSource, /installedVersions\.includes\(repairVersion\)/)
  assert.doesNotMatch(controlPlaneSource, /spec:\s*bundledCodexSource\s*\|\|\s*'codex'/)
})

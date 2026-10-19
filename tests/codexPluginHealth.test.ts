import assert from 'node:assert/strict'
import test from 'node:test'
import { codexPluginAvailableForRuntime, codexPluginNeedsRepair } from '../server/services/plugins/codexPluginHealth'
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

test('does not treat a degraded installed entry as runtime-ready', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'error', runtimeLoaded: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'loaded' }), ''), true)
  assert.equal(codexPluginAvailableForRuntime(undefined, 'C:\\bundled\\codex'), true)
})

test('requires enabled state before declaring Codex available', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ enabled: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ configuredEnabled: false }), 'C:\\bundled\\codex'), false)
})

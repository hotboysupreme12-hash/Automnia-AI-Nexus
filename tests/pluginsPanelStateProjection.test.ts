import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLUGIN_FILTERS,
  pluginMatchesFilter,
  pluginPageState,
  pluginStatusClass,
  summarizePluginPageStates,
  type PluginPageEntry,
} from '../src/components/plugins/pluginStateProjection'

function pluginEntry(id: string, overrides: Partial<PluginPageEntry> = {}): PluginPageEntry {
  const enabled = typeof overrides.enabled === 'boolean' ? overrides.enabled : true
  const status = typeof overrides.status === 'string' ? overrides.status : enabled ? 'enabled' : 'disabled'
  return {
    id,
    name: id,
    description: `${id} plugin`,
    origin: 'openclaw',
    status,
    enabled,
    configuredEnabled: enabled,
    category: 'runtime',
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

test('plugins page projection distinguishes beta plugin states', () => {
  const plugins = [
    pluginEntry('configured-only', {
      origin: 'config',
      status: 'configured',
      guidance: ['Configured in OpenClaw config.'],
    }),
    pluginEntry('google-auth', {
      status: 'enabled',
      configFields: [{
        key: 'provider:google',
        label: 'Google API key',
        envVar: 'GOOGLE_API_KEY',
        providerId: 'google',
        secret: true,
        required: true,
        present: false,
        acceptsDirectSave: true,
      }],
      guidance: ['Paste Google API key and refresh.'],
      needsSetup: true,
    }),
    pluginEntry('channel-unavailable', {
      status: 'unavailable',
      category: 'communications',
      channels: ['voice', 'sms', 'clawtalk.websocket'],
      guidance: ['Channel unavailable until Gateway reports websocket readiness.'],
      restartRequired: true,
    }),
    pluginEntry('websearch-failed', {
      status: 'failed',
      missingDependencies: ['playwright'],
      guidance: ['Missing dependencies: playwright.'],
      needsSetup: true,
    }),
    pluginEntry('disabled-one', {
      enabled: false,
      configuredEnabled: false,
      status: 'disabled',
      guidance: ['Disabled by operator policy.'],
    }),
    pluginEntry('perplexity', {
      enabled: false,
      configuredEnabled: null,
      origin: 'official-catalog',
      status: 'available',
      installSpec: '@openclaw/perplexity-plugin',
      installable: true,
      guidance: ['Install official plugin @openclaw/perplexity-plugin.'],
    }),
  ]

  const states = new Map(plugins.map((plugin) => [plugin.id, pluginPageState(plugin)]))
  assert.deepEqual(states.get('configured-only'), { key: 'configured', label: 'configured', tone: 'configured' })
  assert.deepEqual(states.get('google-auth'), { key: 'missing-auth', label: 'missing auth', tone: 'setup' })
  assert.deepEqual(states.get('channel-unavailable'), { key: 'unavailable', label: 'unavailable', tone: 'unavailable' })
  assert.deepEqual(states.get('websearch-failed'), { key: 'failed', label: 'failed', tone: 'failed' })
  assert.deepEqual(states.get('disabled-one'), { key: 'disabled', label: 'disabled', tone: 'disabled' })
  assert.deepEqual(states.get('perplexity'), { key: 'disabled', label: 'available', tone: 'disabled' })

  assert.deepEqual(PLUGIN_FILTERS.map((option) => option.label), ['Active', 'Needs attention', 'All', 'Enabled', 'Disabled'])
  assert.equal(pluginMatchesFilter(plugins[0], 'all'), true)
  assert.equal(pluginMatchesFilter(plugins[0], 'active'), true)
  assert.equal(pluginMatchesFilter(plugins[1], 'attention'), true)
  assert.equal(pluginMatchesFilter(plugins[2], 'attention'), true)
  assert.equal(pluginMatchesFilter(plugins[3], 'attention'), true)
  assert.equal(pluginMatchesFilter(plugins[4], 'attention'), false)
  assert.equal(pluginMatchesFilter(plugins[0], 'enabled'), true)
  assert.equal(pluginMatchesFilter(plugins[1], 'enabled'), true)
  assert.equal(pluginMatchesFilter(plugins[2], 'enabled'), true)
  assert.equal(pluginMatchesFilter(plugins[3], 'enabled'), true)
  assert.equal(pluginMatchesFilter(plugins[4], 'disabled'), true)
  assert.equal(pluginMatchesFilter(plugins[4], 'enabled'), false)
  assert.equal(pluginMatchesFilter(plugins[5], 'disabled'), true)
  assert.equal(pluginMatchesFilter(plugins[5], 'enabled'), false)
  assert.equal(pluginMatchesFilter(plugins[0], 'disabled'), false)

  assert.match(pluginStatusClass(plugins[0]), /cyan/)
  assert.match(pluginStatusClass(plugins[1]), /amber/)
  assert.match(pluginStatusClass(plugins[2]), /amber/)
  assert.match(pluginStatusClass(plugins[3]), /rose/)
  assert.match(pluginStatusClass(plugins[4]), /slate/)
  assert.match(pluginStatusClass(plugins[5]), /slate/)

  assert.deepEqual(summarizePluginPageStates(plugins), {
    configured: 1,
    disabled: 2,
    enabled: 4,
    failed: 1,
    missingAuth: 1,
    setup: 2,
    unavailable: 1,
  })
})

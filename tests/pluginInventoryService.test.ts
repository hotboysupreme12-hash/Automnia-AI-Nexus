import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createPluginInventoryService,
  displayPluginName,
  parsePluginList,
  pluginCliWarningFromOutput,
  pluginIdFromPackageName,
  pluginStringArray,
  sanitizePluginCliError,
  type PluginInventoryOpenClawConfig,
  type PluginRuntimeState,
} from '../server/services/plugins/pluginInventoryService'

type HarnessOptions = {
  config?: PluginInventoryOpenClawConfig
  runtimeState?: PluginRuntimeState
  providerConfigured?: string[]
  runResult?: {
    code: number
    stdout: string
    stderr: string
  }
  workspaceRoot?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function redact(value: string) {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
}

function createHarness(options: HarnessOptions = {}) {
  const state = {
    config: clone(options.config || { plugins: { entries: {} } }),
    runtimeState: clone(options.runtimeState || {}),
    providerConfigured: new Set(options.providerConfigured || []),
    records: new Map<string, unknown>(),
    writes: [] as Array<{ key: string; value: unknown; sourcePath?: string }>,
    warnings: [] as string[],
    runCount: 0,
  }
  const workspaceRoot = options.workspaceRoot || process.cwd()
  const service = createPluginInventoryService({
    cacheMs: 100,
    configPath: path.join(workspaceRoot, 'openclaw.json'),
    listCachePath: path.join(workspaceRoot, 'plugin-list-cache.json'),
    openclawBin: path.join(workspaceRoot, 'openclaw'),
    pluginListCacheStateKey: 'pluginListCache',
    providerAuthStatus: (providerId) => ({ configured: state.providerConfigured.has(providerId) }),
    readControlCenterStateRecord: (key) => (state.records.has(key) ? state.records.get(key) : null) as never,
    readOpenclawConfig: async () => state.config,
    readPluginRuntimeState: async () => state.runtimeState,
    redactSensitiveText: redact,
    runOpenClaw: async () => {
      state.runCount += 1
      return options.runResult || { code: 0, stdout: JSON.stringify({ plugins: [] }), stderr: '' }
    },
    warn: (message) => state.warnings.push(message),
    workspaceRoot,
    writeControlCenterStateRecord: (key, value, sourcePath) => {
      state.records.set(key, clone(value))
      state.writes.push({ key, value: clone(value), sourcePath })
      return true
    },
  })

  return { service, state }
}

test('plugin inventory lists configured, missing-auth, unavailable, failed, managed, and disabled states', async () => {
  const rawPlugins = [
    {
      id: 'google',
      name: '@openclaw/google-provider',
      status: 'enabled',
      enabled: true,
      setup: { providers: [{ id: 'google', envVars: ['GOOGLE_API_KEY'] }] },
      providerAuthChoices: [{ provider: 'google', method: 'api-key', choiceLabel: 'Google API key' }],
    },
    {
      id: 'websearch',
      name: 'websearch-plugin',
      status: 'failed',
      enabled: true,
      dependencyStatus: { missing: [{ name: 'playwright' }] },
      commands: ['web.search'],
    },
    {
      id: 'voice',
      name: 'voice-plugin',
      status: 'unavailable',
      enabled: true,
      channels: ['voice'],
    },
    {
      id: 'blocked',
      name: 'blocked-plugin',
      status: 'enabled',
      enabled: true,
    },
  ]
  const { service } = createHarness({
    config: {
      plugins: {
        deny: ['blocked'],
        entries: {
          'configured-only': { enabled: true },
        },
      },
    },
    runtimeState: {
      managed: {
        'managed-off': { enabled: false, updatedAt: '2026-06-30T12:00:00.000Z' },
      },
    },
    runResult: { code: 0, stdout: JSON.stringify({ plugins: rawPlugins }), stderr: '' },
  })

  await service.refreshPluginListCache()
  const controls = await service.listPluginControls()
  const byId = new Map(controls.plugins.map((plugin) => [plugin.id, plugin]))

  const google = byId.get('google')
  assert.equal(google?.enabled, true)
  assert.equal(google?.needsSetup, true)
  assert.equal(google?.configFields[0]?.key, 'provider:google')
  assert.equal(google?.configFields[0]?.present, false)
  assert.match(google?.guidance.join(' ') || '', /Paste Google API key/)

  const failed = byId.get('websearch')
  assert.equal(failed?.status, 'failed')
  assert.deepEqual(failed?.missingDependencies, ['playwright'])
  assert.equal(failed?.needsSetup, true)

  const unavailable = byId.get('voice')
  assert.equal(unavailable?.status, 'unavailable')
  assert.equal(unavailable?.enabled, true)
  assert.equal(unavailable?.channels.includes('voice'), true)

  const blocked = byId.get('blocked')
  assert.equal(blocked?.enabled, false)
  assert.equal(blocked?.status, 'disabled')

  const configuredOnly = byId.get('configured-only')
  assert.equal(configuredOnly?.origin, 'config')
  assert.equal(configuredOnly?.status, 'configured')

  const managedOff = byId.get('managed-off')
  assert.equal(managedOff?.origin, 'managed')
  assert.equal(managedOff?.managed, true)
  assert.equal(managedOff?.status, 'disabled')
})

test('plugin inventory falls back to bundled manifests and redacts CLI warnings', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dystopai-plugin-inventory-'))
  try {
    const pluginRoot = path.join(workspaceRoot, 'vendor', 'openclaw', 'dist', 'extensions', 'browser')
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'openclaw.plugin.json'),
      `${JSON.stringify({
        id: 'browser',
        channels: ['browser'],
        commandAliases: [{ name: 'browser.open' }],
        contracts: { tools: ['browser.open'] },
      }, null, 2)}\n`,
      'utf-8',
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      `${JSON.stringify({
        name: '@openclaw/browser-plugin',
        version: '1.0.0',
        description: 'Browser automation',
      }, null, 2)}\n`,
      'utf-8',
    )

    const { service, state } = createHarness({
      workspaceRoot,
      runResult: {
        code: 1,
        stdout: '',
        stderr: 'registry failed with sk-secret-token',
      },
    })

    const cache = await service.refreshPluginListCache()
    assert.equal(cache.source, 'bundled')
    assert.equal(cache.rawPlugins[0]?.id, 'browser')
    assert.match(cache.cliError || '', /\[REDACTED\]/)
    assert.doesNotMatch(cache.cliError || '', /sk-secret-token/)

    const controls = await service.listPluginControls()
    assert.equal(controls.cache.source, 'bundled')
    assert.equal(controls.plugins[0]?.id, 'browser')
    assert.equal(controls.plugins[0]?.category, 'automation')
    assert.equal(state.writes.length >= 1, true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('plugin inventory force refresh returns cached controls while background refresh runs', async () => {
  const { service, state } = createHarness({
    runResult: {
      code: 0,
      stdout: JSON.stringify({ plugins: [{ id: 'codex', name: 'codex-plugin', enabled: true }] }),
      stderr: '',
    },
  })

  await service.refreshPluginListCache()
  const forced = await service.getPluginList({ forceRefresh: true })

  assert.equal(forced.refreshing, true)
  assert.equal(forced.rawPlugins[0]?.id, 'codex')
  assert.equal(state.runCount >= 1, true)
})

test('plugin inventory helpers normalize arrays, ids, names, JSON output, and CLI warnings', () => {
  assert.deepEqual(pluginStringArray(['alpha', '', ' beta ', 42, null]), ['alpha', ' beta '])
  assert.equal(pluginIdFromPackageName('@openclaw/weather-provider'), 'weather')
  assert.equal(pluginIdFromPackageName(42), '')
  assert.equal(displayPluginName('custom-search', 'custom-search-plugin'), 'Custom-Search Plugin')
  assert.equal(displayPluginName('browser', ''), 'Browser Control')
  assert.deepEqual(
    parsePluginList('noise\n\u001b[32m{"plugins":[{"id":"weather"},{"id":42},{"name":"missing-id"}]}\u001b[0m\nmore'),
    [{ id: 'weather' }, { id: 42 }, { name: 'missing-id' }],
  )
  assert.deepEqual(parsePluginList('not json'), [])
  assert.equal(sanitizePluginCliError('', redact), '')
  assert.match(
    sanitizePluginCliError(
      JSON.stringify({ diagnostics: [{ level: 'warning', message: 'token sk-inventory-secret', code: 'W1' }] }),
      redact,
    ),
    /token \[REDACTED\] \(W1\)/,
  )
  assert.equal(
    pluginCliWarningFromOutput({ code: 0, stdout: JSON.stringify({ plugins: [] }), stderr: '' }, 'openclaw plugins list', redact),
    '',
  )
  assert.equal(
    pluginCliWarningFromOutput({ code: 5, stdout: '', stderr: '' }, 'openclaw plugins list', redact),
    'openclaw plugins list exited 5.',
  )
})

test('plugin inventory derives schema fields, categories, allow/global disabled states, and guidance', async () => {
  const rawPlugins = [
    {
      id: 'schemed',
      name: 'schemed-plugin',
      enabled: true,
      configSchema: {
        required: ['apiKey'],
        properties: {
          api_key: { description: 'API key for Schemed' },
          optionalMode: { description: 'Not required' },
          'bad key': { description: 'Ignored unsafe key' },
        },
      },
      uiHints: {
        api_key: { label: 'Schemed token', sensitive: true, help: 'Paste Schemed token.' },
      },
    },
    {
      id: 'slackbridge',
      name: 'slackbridge-plugin',
      enabled: true,
      channels: ['slack'],
      gatewayMethods: ['chat.post'],
    },
    {
      id: 'vector-memory',
      name: 'vector-memory-plugin',
      enabled: true,
      memoryEmbeddingProviderIds: ['openai'],
    },
    {
      id: 'scraper',
      name: 'scraper-plugin',
      enabled: true,
      commands: ['scrape.run'],
      restartRequired: true,
    },
    {
      id: 'searcher',
      name: 'searcher-plugin',
      enabled: true,
    },
    {
      id: 'allowed',
      name: 'allowed-plugin',
      enabled: true,
    },
    {
      id: 'globally-disabled',
      name: 'globally-disabled-plugin',
      enabled: true,
    },
  ]
  const { service } = createHarness({
    config: {
      plugins: {
        enabled: false,
        allow: ['allowed'],
        entries: {
          schemed: {
            enabled: true,
            config: { api_key: 'present' },
          },
          'globally-disabled': { enabled: true },
        },
      },
    },
    runResult: { code: 0, stdout: JSON.stringify({ plugins: rawPlugins }), stderr: '' },
  })

  await service.refreshPluginListCache()
  const controls = await service.listPluginControls()
  const byId = new Map(controls.plugins.map((plugin) => [plugin.id, plugin]))

  const schemed = byId.get('schemed')
  assert.equal(schemed?.enabled, false)
  assert.equal(schemed?.status, 'disabled')
  assert.equal(schemed?.configFields.length, 1)
  assert.equal(schemed?.configFields[0]?.label, 'Schemed token')
  assert.equal(schemed?.configFields[0]?.present, true)
  assert.equal(schemed?.needsSetup, false)

  assert.equal(byId.get('slackbridge')?.category, 'communications')
  assert.deepEqual(byId.get('slackbridge')?.channels, ['slack', 'chat.post'])
  assert.equal(byId.get('vector-memory')?.category, 'memory')
  assert.equal(byId.get('scraper')?.category, 'automation')
  assert.equal(byId.get('scraper')?.restartRequired, true)
  assert.equal(byId.get('searcher')?.category, 'web')
  assert.equal(byId.get('allowed')?.status, 'disabled')
  assert.equal(byId.get('globally-disabled')?.status, 'disabled')
})

test('plugin inventory reports disabled missing-config guidance for setup fields', async () => {
  const { service } = createHarness({
    config: {
      plugins: {
        entries: {
          schemed: { enabled: false, config: {} },
        },
      },
    },
    runResult: {
      code: 0,
      stdout: JSON.stringify({
        plugins: [{
          id: 'schemed',
          name: 'schemed-plugin',
          enabled: true,
          configSchema: {
            required: ['api_key'],
            properties: {
              api_key: { description: 'API key for Schemed' },
            },
          },
        }],
      }),
      stderr: '',
    },
  })

  await service.refreshPluginListCache()
  const plugin = (await service.listPluginControls()).plugins[0]

  assert.equal(plugin?.enabled, false)
  assert.equal(plugin?.needsSetup, false)
  assert.match(plugin?.guidance.join(' ') || '', /Enable after adding Api Key/)
})

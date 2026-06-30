import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express, { type Express } from 'express'
import { registerPluginRoutes } from '../server/routes/pluginRoutes'
import type { PluginRuntimeService } from '../server/services/plugins/pluginRuntimeService'

function pluginEntry(id: string, overrides: Partial<PluginControlEntryLike> = {}): PluginControlEntryLike {
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

function controlsPayload(entries: Array<string | PluginControlEntryLike>) {
  return {
    plugins: entries.map((entry) => typeof entry === 'string' ? pluginEntry(entry) : entry),
    configPath: '/tmp/openclaw.json',
    cache: { source: 'openclaw', refreshedAt: Date.now(), refreshing: false },
  }
}

type RouteError = Error & { code?: number }

type PluginRouteErrorSurface =
  | 'clawTalkSetup'
  | 'config'
  | 'gatewayRestart'
  | 'inspect'
  | 'install'
  | 'list'
  | 'search'
  | 'terminalStart'
  | 'toggle'
  | 'uninstall'
  | 'update'
  | 'updateAll'

function createRuntimeStub(
  calls: Record<string, number>,
  errors: Partial<Record<PluginRouteErrorSurface, RouteError>> = {},
): PluginRuntimeService {
  return {
    inspectOpenClawPluginRuntime: async (pluginId) => {
      calls.inspect += 1
      if (errors.inspect) throw errors.inspect
      return {
        pluginId,
        command: { command: `openclaw plugins inspect ${pluginId} --runtime --json`, code: 0, stdout: '', stderr: '', output: '' },
        raw: {},
        status: 'loaded',
        runtimeLoaded: true,
        surfaces: [],
      }
    },
    pluginRuntimeInspectReady: (inspect) => inspect.runtimeLoaded !== false,
    startPluginSetupTerminalSession: (params) => {
      calls.terminal += 1
      if (errors.terminalStart) throw errors.terminalStart
      return {
        id: 'setup-1',
        command: params.command,
        commandLine: 'openclaw plugins doctor',
        title: 'Plugin doctor',
        pluginId: params.pluginId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        pid: 1234,
      }
    },
    getPluginSetupTerminalSnapshot: () => null,
    attachPluginSetupTerminalClient: () => null,
    writePluginSetupTerminalInput: () => ({ ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }),
    resizePluginSetupTerminalSession: () => ({ ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }),
    stopPluginSetupTerminalSession: () => ({ ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }),
    stopAllPluginSetupTerminalSessions: () => 0,
  }
}

type PluginRoutesHarnessOptions = {
  errors?: Partial<Record<PluginRouteErrorSurface, RouteError>>
  installError?: RouteError
}

function createPluginRoutesHarness(pluginEntries: Array<string | PluginControlEntryLike>, options: PluginRoutesHarnessOptions = {}) {
  const errors = options.errors || {}
  let currentPluginEntries = controlsPayload(pluginEntries).plugins
  const currentControls = () => controlsPayload(currentPluginEntries)
  const calls = {
    config: 0,
    install: 0,
    inspect: 0,
    list: 0,
    terminal: 0,
    toggle: 0,
    uninstall: 0,
    update: 0,
    updateAll: 0,
  }
  const redactSensitiveText = (value: string) => value
    .replace(/apiKey=[^\s"'&]+/g, 'apiKey=[redacted]')
    .replace(/token=[^\s"'&]+/gi, 'token=[redacted]')
    .replace(/cc_(?:live|test)_[A-Za-z0-9_-]+/g, '[redacted-clawtalk-key]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
  const app = express()
  app.use(express.json())
  registerPluginRoutes(app, {
    clawTalkPluginId: 'clawtalk',
    invalidateRuntimeStatusCache: () => undefined,
    installOpenClawPlugin: async () => {
      calls.install += 1
      if (errors.install || options.installError) throw errors.install || options.installError
      throw new Error('install should not run in this harness')
    },
    listPluginControls: async () => {
      calls.list += 1
      if (errors.list) throw errors.list
      return currentControls()
    },
    pluginErrorDetail: (error) => redactSensitiveText(error instanceof Error ? error.message : String(error)),
    pluginErrorStatus: (error) => typeof (error as Error & { code?: unknown }).code === 'number' ? 502 : 500,
    pluginIdPattern: /^[a-z0-9][a-z0-9._-]{0,79}$/,
    pluginRuntime: createRuntimeStub(calls, errors),
    pluginRuntimeStatePath: '/tmp/plugins-runtime.json',
    redactSensitiveText,
    savePluginDirectConfig: async () => {
      calls.config += 1
      if (errors.config) throw errors.config
    },
    schedulePluginGatewayRestart: () => ({ restarted: false, scheduled: true, detail: 'gateway restart queued' }),
    searchOpenClawPlugins: async () => {
      if (errors.search) throw errors.search
      return { results: [] }
    },
    setOpenClawPluginEnabledForControlCenter: async (pluginId, enabled) => {
      calls.toggle += 1
      if (errors.toggle) throw errors.toggle
      currentPluginEntries = currentPluginEntries.map((entry) =>
        entry.id === pluginId
          ? {
              ...entry,
              enabled,
              configuredEnabled: enabled,
              status: enabled ? 'enabled' : 'disabled',
            }
          : entry,
      )
      const controls = currentControls()
      return {
        command: { command: `openclaw plugins ${enabled ? 'enable' : 'disable'} ${pluginId}`, code: 0, stdout: '', stderr: '', output: '' },
        plugin: controls.plugins.find((plugin) => plugin.id === pluginId) || null,
        restart: { restarted: false, scheduled: false, detail: 'gateway restart skipped' },
        registryRefresh: { scheduled: false, detail: 'registry refresh skipped' },
        controls,
      }
    },
    setupClawTalkPlugin: async () => {
      if (errors.clawTalkSetup) throw errors.clawTalkSetup
      throw new Error('setup should not run in this harness')
    },
    tryRestartGatewayService: async () => {
      if (errors.gatewayRestart) throw errors.gatewayRestart
      return { restarted: false, detail: 'gateway restart skipped' }
    },
    uninstallOpenClawPlugin: async (pluginId) => {
      calls.uninstall += 1
      if (errors.uninstall) throw errors.uninstall
      return {
        command: { command: `openclaw plugins uninstall ${pluginId}`, code: 0, stdout: '', stderr: '', output: '' },
        plugin: null,
        restart: { restarted: false, scheduled: false, detail: 'gateway restart skipped' },
        controls: currentControls(),
      }
    },
    updateAllOpenClawPlugins: async () => {
      calls.updateAll += 1
      if (errors.updateAll) throw errors.updateAll
      return {
        command: { command: 'openclaw plugins update --all', code: 0, stdout: '', stderr: '', output: '' },
        restart: { restarted: false, scheduled: false, detail: 'gateway restart skipped' },
        controls: currentControls(),
      }
    },
    updateOpenClawPlugin: async (pluginId) => {
      calls.update += 1
      if (errors.update) throw errors.update
      const controls = currentControls()
      return {
        command: { command: `openclaw plugins update ${pluginId}`, code: 0, stdout: '', stderr: '', output: '' },
        plugin: controls.plugins.find((plugin) => plugin.id === pluginId) || null,
        restart: { restarted: false, scheduled: false, detail: 'gateway restart skipped' },
        controls,
      }
    },
    writeSseEvent: (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  })
  return { app, calls }
}

function routeError(surface: PluginRouteErrorSurface, code?: number): RouteError {
  const error = new Error(`${surface} failed apiKey=sk-route-redaction-secret token=route-secret-token cc_test_${'r'.repeat(24)}`) as RouteError
  if (typeof code === 'number') error.code = code
  return error
}

async function withRouteServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function requestJson(baseUrl: string, method: string, route: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    status: response.status,
    text: await response.text(),
  }
}

test('plugin routes return redacted canonical envelope for plugin install failure', async () => {
  const installError = new Error('openclaw plugins install failed: apiKey=sk-install-route-secret')
  ;(installError as Error & { code?: number }).code = 41
  const { app, calls } = createPluginRoutesHarness(['known'], { installError })

  await withRouteServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, 'POST', '/api/plugins/install', {
      spec: 'clawhub:weather',
      pluginId: 'weather',
      pin: true,
      enable: true,
      force: false,
      restart: true,
    })

    assert.equal(result.status, 502)
    assert.doesNotMatch(result.text, /sk-install-route-secret/)
    assert.doesNotMatch(result.text, /clawhub:weather/)
    const payload = JSON.parse(result.text) as {
      ok: boolean
      error: { code: string; message: string; status: number; detail?: string }
    }
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'plugin_command_failed')
    assert.equal(payload.error.message, 'Plugin install failed')
    assert.equal(payload.error.status, 502)
    assert.match(payload.error.detail || '', /apiKey=\[redacted\]/)
  })

  assert.equal(calls.install, 1)
})

test('plugin routes redact command and operation errors across remaining plugin APIs', async () => {
  const clawTalkKey = `cc_test_${'r'.repeat(24)}`
  const cases: Array<{
    body?: unknown
    expectedCode: string
    expectedMessage: string
    expectedStatus: number
    method: 'GET' | 'POST'
    route: string
    surface: PluginRouteErrorSurface
  }> = [
    {
      expectedCode: 'plugin_operation_failed',
      expectedMessage: 'Failed to list plugins',
      expectedStatus: 500,
      method: 'GET',
      route: '/api/plugins',
      surface: 'list',
    },
    {
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Plugin search failed',
      expectedStatus: 502,
      method: 'GET',
      route: '/api/plugins/search?q=known',
      surface: 'search',
    },
    {
      body: { restart: true },
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Plugin update failed',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/update-all',
      surface: 'updateAll',
    },
    {
      body: {},
      expectedCode: 'plugin_operation_failed',
      expectedMessage: 'Gateway restart failed',
      expectedStatus: 500,
      method: 'POST',
      route: '/api/plugins/gateway/restart',
      surface: 'gatewayRestart',
    },
    {
      body: { apiKey: clawTalkKey, server: 'https://api.clawtalk.test/setup/', install: true, restart: true },
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'ClawTalk setup failed',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/clawtalk/setup',
      surface: 'clawTalkSetup',
    },
    {
      body: { restart: true },
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Plugin update failed',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/known/update',
      surface: 'update',
    },
    {
      body: { keepFiles: false, force: true, restart: true },
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Plugin uninstall failed',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/known/uninstall',
      surface: 'uninstall',
    },
    {
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Plugin runtime inspect failed',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/known/inspect',
      surface: 'inspect',
    },
    {
      body: {
        values: { apiKey: 'sk-route-redaction-secret' },
        providerAuth: { openai: 'sk-route-redaction-secret' },
        restart: true,
      },
      expectedCode: 'plugin_operation_failed',
      expectedMessage: 'Failed to save plugin config',
      expectedStatus: 500,
      method: 'POST',
      route: '/api/plugins/known/config',
      surface: 'config',
    },
    {
      body: { command: 'doctor', pluginId: 'known' },
      expectedCode: 'plugin_terminal_failed',
      expectedMessage: 'Failed to start setup terminal',
      expectedStatus: 500,
      method: 'POST',
      route: '/api/plugins/setup-terminal',
      surface: 'terminalStart',
    },
    {
      body: { enabled: false, restart: true },
      expectedCode: 'plugin_command_failed',
      expectedMessage: 'Failed to update plugin',
      expectedStatus: 502,
      method: 'POST',
      route: '/api/plugins/known',
      surface: 'toggle',
    },
  ]

  for (const item of cases) {
    const errors: Partial<Record<PluginRouteErrorSurface, RouteError>> = {
      [item.surface]: routeError(item.surface, item.expectedStatus === 502 ? 42 : undefined),
    }
    const { app } = createPluginRoutesHarness(['known', 'clawtalk'], { errors })

    await withRouteServer(app, async (baseUrl) => {
      const result = await requestJson(baseUrl, item.method, item.route, item.body)
      assert.equal(result.status, item.expectedStatus, item.route)
      assert.doesNotMatch(result.text, /sk-route-redaction-secret/)
      assert.doesNotMatch(result.text, /route-secret-token/)
      assert.doesNotMatch(result.text, new RegExp(clawTalkKey))
      const payload = JSON.parse(result.text) as {
        ok: boolean
        error: { code: string; detail?: string; message: string; status: number }
      }
      assert.equal(payload.ok, false, item.route)
      assert.equal(payload.error.code, item.expectedCode, item.route)
      assert.equal(payload.error.message, item.expectedMessage, item.route)
      assert.equal(payload.error.status, item.expectedStatus, item.route)
      assert.match(payload.error.detail || '', /\[redacted/, item.route)
    })
  }
})

test('plugin routes return canonical not-found before mutating missing plugins', async () => {
  const { app, calls } = createPluginRoutesHarness(['known'])
  const missingCases: Array<{ route: string; body?: unknown }> = [
    { route: '/api/plugins/missing/update', body: {} },
    { route: '/api/plugins/missing/uninstall', body: {} },
    { route: '/api/plugins/missing/inspect' },
    { route: '/api/plugins/missing/config', body: { values: { apiKey: 'sk-route-secret' }, providerAuth: {}, restart: true } },
    { route: '/api/plugins/missing', body: { enabled: true, restart: true } },
    { route: '/api/plugins/setup-terminal', body: { command: 'doctor', pluginId: 'missing' } },
  ]

  await withRouteServer(app, async (baseUrl) => {
    for (const item of missingCases) {
      const result = await requestJson(baseUrl, 'POST', item.route, item.body)
      assert.equal(result.status, 404, item.route)
      assert.doesNotMatch(result.text, /sk-route-secret/)
      const payload = JSON.parse(result.text) as {
        ok: boolean
        error: { code: string; message: string; detail?: { pluginId?: string } }
      }
      assert.equal(payload.ok, false)
      assert.equal(payload.error.code, 'plugin_not_found')
      assert.equal(payload.error.message, 'Plugin not found')
      assert.equal(payload.error.detail?.pluginId, 'missing')
    }
  })

  assert.equal(calls.update, 0)
  assert.equal(calls.uninstall, 0)
  assert.equal(calls.inspect, 0)
  assert.equal(calls.config, 0)
  assert.equal(calls.toggle, 0)
  assert.equal(calls.terminal, 0)
})

test('plugin routes preserve disabled plugin state and enable known disabled plugins', async () => {
  const { app, calls } = createPluginRoutesHarness([
    pluginEntry('disabled-one', {
      enabled: false,
      configuredEnabled: false,
      status: 'disabled',
      guidance: ['Disabled by operator policy.'],
    }),
  ])

  await withRouteServer(app, async (baseUrl) => {
    const listResult = await requestJson(baseUrl, 'GET', '/api/plugins')
    assert.equal(listResult.status, 200)
    const listed = JSON.parse(listResult.text) as {
      ok: boolean
      data: { plugins: Array<{ id: string; enabled: boolean; status: string; guidance: string[] }> }
    }
    assert.equal(listed.ok, true)
    assert.equal(listed.data.plugins[0]?.id, 'disabled-one')
    assert.equal(listed.data.plugins[0]?.enabled, false)
    assert.equal(listed.data.plugins[0]?.status, 'disabled')
    assert.deepEqual(listed.data.plugins[0]?.guidance, ['Disabled by operator policy.'])

    const toggleResult = await requestJson(baseUrl, 'POST', '/api/plugins/disabled-one', {
      enabled: true,
      restart: false,
    })
    assert.equal(toggleResult.status, 200)
    const toggled = JSON.parse(toggleResult.text) as {
      ok: boolean
      data: {
        plugin?: { id?: string; enabled?: boolean; configuredEnabled?: boolean; status?: string }
        plugins: Array<{ id: string; enabled: boolean; configuredEnabled: boolean; status: string }>
        runtimeStatePath: string
      }
    }
    assert.equal(toggled.ok, true)
    assert.equal(toggled.data.plugin?.id, 'disabled-one')
    assert.equal(toggled.data.plugin?.enabled, true)
    assert.equal(toggled.data.plugin?.configuredEnabled, true)
    assert.equal(toggled.data.plugin?.status, 'enabled')
    assert.equal(toggled.data.plugins[0]?.enabled, true)
    assert.equal(toggled.data.plugins[0]?.status, 'enabled')
    assert.equal(toggled.data.runtimeStatePath, '/tmp/plugins-runtime.json')
  })

  assert.equal(calls.toggle, 1)
  assert.equal(calls.inspect, 0)
  assert.ok(calls.list >= 2)
})

test('plugin routes preserve unavailable channel plugin state', async () => {
  const { app, calls } = createPluginRoutesHarness([
    pluginEntry('channel-unavailable', {
      name: 'Channel Unavailable',
      status: 'unavailable',
      enabled: true,
      configuredEnabled: true,
      category: 'communications',
      channels: ['voice', 'sms', 'clawtalk.websocket'],
      guidance: ['Channel unavailable until Gateway reports websocket readiness.'],
      restartRequired: true,
    }),
  ])

  await withRouteServer(app, async (baseUrl) => {
    const listResult = await requestJson(baseUrl, 'GET', '/api/plugins')
    assert.equal(listResult.status, 200)
    const listed = JSON.parse(listResult.text) as {
      ok: boolean
      data: {
        plugins: Array<{
          id: string
          category: string
          channels: string[]
          configuredEnabled: boolean | null
          enabled: boolean
          guidance: string[]
          restartRequired: boolean
          status: string
        }>
      }
    }
    const plugin = listed.data.plugins[0]
    assert.equal(listed.ok, true)
    assert.equal(plugin?.id, 'channel-unavailable')
    assert.equal(plugin?.enabled, true)
    assert.equal(plugin?.configuredEnabled, true)
    assert.equal(plugin?.status, 'unavailable')
    assert.equal(plugin?.category, 'communications')
    assert.deepEqual(plugin?.channels, ['voice', 'sms', 'clawtalk.websocket'])
    assert.deepEqual(plugin?.guidance, ['Channel unavailable until Gateway reports websocket readiness.'])
    assert.equal(plugin?.restartRequired, true)

    const inspectResult = await requestJson(baseUrl, 'POST', '/api/plugins/channel-unavailable/inspect')
    assert.equal(inspectResult.status, 200)
    const inspected = JSON.parse(inspectResult.text) as {
      ok: boolean
      data: { plugin?: { id?: string; status?: string; channels?: string[] }; inspect?: { pluginId?: string } }
    }
    assert.equal(inspected.ok, true)
    assert.equal(inspected.data.inspect?.pluginId, 'channel-unavailable')
    assert.equal(inspected.data.plugin?.id, 'channel-unavailable')
    assert.equal(inspected.data.plugin?.status, 'unavailable')
    assert.deepEqual(inspected.data.plugin?.channels, ['voice', 'sms', 'clawtalk.websocket'])
  })

  assert.equal(calls.inspect, 1)
  assert.ok(calls.list >= 2)
})

test('plugin routes still run known plugin mutations after the not-found guard', async () => {
  const { app, calls } = createPluginRoutesHarness(['known'])

  await withRouteServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, 'POST', '/api/plugins/known/update', { restart: false })
    assert.equal(result.status, 200)
    const payload = JSON.parse(result.text) as { ok: boolean; data: { plugin?: { id?: string } } }
    assert.equal(payload.ok, true)
    assert.equal(payload.data.plugin?.id, 'known')
  })

  assert.equal(calls.update, 1)
  assert.ok(calls.list >= 1)
})

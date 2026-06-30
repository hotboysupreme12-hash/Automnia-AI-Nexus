import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPluginDiagnosticsService,
  type PluginClawTalkSetupParams,
} from '../server/services/plugins/pluginDiagnosticsService'
import type { PluginControlEntry, PluginControlsPayload } from '../server/services/plugins/pluginInventoryService'
import type { PluginInstallResult, PluginOpenClawResult } from '../server/services/plugins/pluginInstallService'
import type { PluginRuntimeInspectResult } from '../server/services/plugins/pluginRuntimeService'

function pluginEntry(id: string, status: 'enabled' | 'disabled' | 'missing' = 'enabled'): PluginControlEntry {
  return {
    id,
    name: id,
    description: `${id} plugin`,
    origin: status === 'missing' ? 'known' : 'openclaw',
    status,
    enabled: status === 'enabled',
    configuredEnabled: status === 'enabled',
    category: 'communication',
    commands: [],
    providers: [],
    channels: [],
    missingDependencies: [],
    configFields: [],
    guidance: [],
    needsSetup: false,
    restartRequired: false,
  }
}

function controlsPayload(plugins: PluginControlEntry[]): PluginControlsPayload {
  return {
    plugins,
    configPath: '/tmp/openclaw.json',
    cache: { source: 'test', refreshedAt: Date.now(), refreshing: false },
  }
}

function runtimeInspect(runtimeLoaded = true): PluginRuntimeInspectResult {
  return {
    pluginId: 'clawtalk',
    command: {
      command: 'openclaw plugins inspect clawtalk --json',
      code: 0,
      stdout: '',
      stderr: '',
      output: '',
    },
    raw: { loaded: runtimeLoaded },
    status: runtimeLoaded ? 'loaded' : 'missing',
    runtimeLoaded,
    surfaces: [],
  }
}

function openClawResult(stdout: string, stderr = '', code = 0): PluginOpenClawResult {
  return { stdout, stderr, code, elapsedMs: 7 }
}

function createInstallResult(controls: PluginControlsPayload): PluginInstallResult {
  return {
    install: { code: 0, stdout: 'installed', stderr: '' },
    plugin: controls.plugins.find((plugin) => plugin.id === 'clawtalk') || null,
    restart: { restarted: false, scheduled: false, detail: 'restart skipped' },
    controls,
  }
}

function redact(value: string) {
  return value
    .replace(/cc_(?:live|test)_[A-Za-z0-9_-]+/g, '[redacted-clawtalk-key]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
}

function createHarness(options: {
  controls?: PluginControlsPayload[]
  doctorResults?: PluginOpenClawResult[]
  inspectResults?: PluginRuntimeInspectResult[]
  repairManifests?: string[]
} = {}) {
  const controlsQueue = [...(options.controls || [controlsPayload([pluginEntry('clawtalk')])])]
  const doctorQueue = [...(options.doctorResults || [
    openClawResult('api_key pass\nbot_connected pass\nwebsocket_server pass'),
  ])]
  const inspectQueue = [...(options.inspectResults || [runtimeInspect(true)])]
  const state = {
    nowMs: 0,
    delays: [] as number[],
    installCalls: [] as Array<{ spec: string; pluginId?: string; restart: boolean }>,
    savedConfigs: [] as Array<{ apiKey: string; server: string }>,
    registryReasons: [] as string[],
    restartCalls: [] as string[],
    runCalls: [] as Array<{ args: string[]; timeoutMs: number }>,
  }
  const nextControls = () => controlsQueue.length > 1 ? controlsQueue.shift()! : controlsQueue[0]!
  const service = createPluginDiagnosticsService({
    clawTalkPluginId: 'clawtalk',
    defaultServer: 'https://api.clawtalk.test/',
    delayMs: async (ms) => {
      state.delays.push(ms)
      state.nowMs += ms
    },
    nowMs: () => state.nowMs,
    isRealInstalledPluginEntry: (plugin) => Boolean(plugin && plugin.origin === 'openclaw' && plugin.status !== 'missing'),
    installOpenClawPlugin: async (params) => {
      state.installCalls.push({ spec: params.spec, pluginId: params.pluginId, restart: params.restart })
      const controls = controlsPayload([pluginEntry('clawtalk')])
      return createInstallResult(controls)
    },
    listPluginControls: async () => nextControls(),
    saveClawTalkSetupConfig: async (apiKey, server) => {
      state.savedConfigs.push({ apiKey, server })
    },
    refreshOpenClawPluginRegistry: async (reason) => {
      state.registryReasons.push(reason)
      return openClawResult('registry refreshed')
    },
    repairClawTalkPluginManifestContracts: async () => options.repairManifests || [],
    inspectOpenClawPluginRuntime: async () => inspectQueue.length > 1 ? inspectQueue.shift()! : inspectQueue[0]!,
    pluginRuntimeInspectReady: (inspect) => inspect.runtimeLoaded === true,
    runOpenClaw: async (args, timeoutMs) => {
      state.runCalls.push({ args, timeoutMs })
      return doctorQueue.length > 1 ? doctorQueue.shift()! : doctorQueue[0]!
    },
    tryRestartGatewayService: async (restart) => {
      state.restartCalls.push(restart.reason || '')
      return { restarted: true, scheduled: true, detail: 'gateway restarted' }
    },
    redactSensitiveText: redact,
  })
  return { service, state }
}

const validSetup: PluginClawTalkSetupParams = {
  apiKey: `cc_test_${'a'.repeat(24)}`,
  server: 'https://api.clawtalk.test/setup/',
  install: true,
  restart: true,
}

test('plugin diagnostics service configures installed ClawTalk and redacts doctor output', async () => {
  const harness = createHarness({
    doctorResults: [openClawResult(`api_key pass ${validSetup.apiKey}\nbot_connected pass\nwebsocket_server pass\nsk-secret`)],
  })

  const result = await harness.service.setupClawTalkPlugin(validSetup)

  assert.equal(result.installResult, null)
  assert.equal(result.setup.ready, true)
  assert.equal(result.doctor.ok, true)
  assert.equal(result.doctor.command.stdout, '')
  assert.equal(result.doctor.command.stderr, '')
  assert.equal(result.doctor.command.output, 'bot_connected=pass; websocket_server=pass')
  assert.equal(result.restart.restarted, true)
  assert.deepEqual(harness.state.savedConfigs, [{ apiKey: validSetup.apiKey, server: 'https://api.clawtalk.test/setup' }])
  assert.deepEqual(harness.state.runCalls, [{ args: ['clawtalk', 'doctor'], timeoutMs: 75_000 }])
})

test('plugin diagnostics service installs missing ClawTalk before setup verification', async () => {
  const harness = createHarness({
    controls: [controlsPayload([pluginEntry('clawtalk', 'missing')]), controlsPayload([pluginEntry('clawtalk')])],
    repairManifests: ['openclaw.plugin.json'],
  })

  const result = await harness.service.setupClawTalkPlugin(validSetup)

  assert.equal(result.setup.installed, true)
  assert.deepEqual(harness.state.installCalls, [{ spec: 'clawtalk', pluginId: 'clawtalk', restart: false }])
  assert.deepEqual(harness.state.registryReasons, ['clawtalk-setup-repair'])
  assert.ok(result.setup.actions.includes('installed ClawTalk plugin'))
  assert.ok(result.setup.actions.includes('repaired ClawTalk plugin manifest contracts'))
})

test('plugin diagnostics service rejects invalid setup input and missing install approval', async () => {
  const invalid = createHarness()
  await assert.rejects(
    () => invalid.service.setupClawTalkPlugin({ ...validSetup, apiKey: 'sk-not-a-clawtalk-key' }),
    /valid ClawTalk API key/,
  )

  const missing = createHarness({
    controls: [controlsPayload([pluginEntry('clawtalk', 'missing')])],
  })
  await assert.rejects(
    () => missing.service.setupClawTalkPlugin({ ...validSetup, install: false }),
    /ClawTalk is not installed/,
  )
})

test('plugin diagnostics service reports verification failures from runtime and doctor checks', async () => {
  const harness = createHarness({
    inspectResults: [runtimeInspect(false)],
    doctorResults: [openClawResult('bot_connected fail\nwebsocket_server warn', 'failure detail', 1)],
  })

  await assert.rejects(
    () => harness.service.setupClawTalkPlugin({ ...validSetup, restart: false }),
    /runtime load, bot connection, websocket server/,
  )
  assert.equal(harness.state.delays[0], 750)
  assert.ok(harness.state.delays.includes(2500))
})

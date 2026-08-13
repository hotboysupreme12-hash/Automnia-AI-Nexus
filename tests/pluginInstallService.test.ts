import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createPluginInstallService,
  parsePluginInstallInput,
  pluginCommandResult,
  splitPluginCommandLine,
  type PluginOpenClawResult,
} from '../server/services/plugins/pluginInstallService'
import type {
  PluginControlEntry,
  PluginControlsPayload,
  PluginRuntimeState,
} from '../server/services/plugins/pluginInventoryService'

type HarnessOptions = {
  controls?: PluginControlsPayload[]
  openClawConfigNeedsCodexPlugin?: (config: Record<string, unknown>) => boolean
  readOpenclawConfig?: () => Promise<Record<string, unknown>>
  refreshOpenClawPluginRegistry?: (reason: string) => Promise<PluginOpenClawResult>
  repairClawTalkPluginManifestContracts?: () => Promise<string[]>
  repairCodexPluginPostInstallState?: (options: {
    runCliEnable: boolean
    verifyRoutes: boolean
    bundledSource?: string
  }) => Promise<{
    applied: boolean
    reason: string
    actions: string[]
    warnings?: string[]
    bundledSource?: string
    commands?: ReturnType<typeof pluginCommandResult>[]
  }>
  runtimeState?: PluginRuntimeState
  runResults?: PluginOpenClawResult[]
  resolveBundledCodexPluginRoot?: () => string
  tempRoot?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function redact(value: string) {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
}

function pluginEntry(id: string, enabled = true): PluginControlEntry {
  return {
    id,
    name: id,
    description: `${id} plugin`,
    origin: 'openclaw',
    status: enabled ? 'enabled' : 'disabled',
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
  }
}

function controlsPayload(plugins: PluginControlEntry[]): PluginControlsPayload {
  return {
    plugins,
    configPath: '/tmp/openclaw.json',
    cache: {
      source: 'openclaw',
      refreshedAt: Date.now(),
      refreshing: false,
    },
  }
}

function createHarness(options: HarnessOptions = {}) {
  const root = options.tempRoot || os.tmpdir()
  const controlsQueue = (options.controls || [controlsPayload([])]).map(clone)
  const runQueue = [...(options.runResults || [])]
  const state = {
    runtimeState: clone(options.runtimeState || {}),
    runs: [] as Array<{ args: string[]; timeoutMs: number }>,
    refreshCount: 0,
    restartCount: 0,
    enabledCalls: [] as Array<{ pluginId: string; enabled: boolean }>,
    persistedAllowlist: [] as unknown[][],
    pauseCount: 0,
    resumeCount: 0,
    registryReasons: [] as string[],
    codexRepairCalls: [] as Array<{ runCliEnable: boolean; verifyRoutes: boolean; bundledSource?: string }>,
    clawTalkRepairCount: 0,
    warnings: [] as string[],
  }
  const nextControls = () => {
    if (controlsQueue.length > 1) return clone(controlsQueue.shift()!)
    return clone(controlsQueue[0] || controlsPayload([]))
  }
  const service = createPluginInstallService({
    clawTalkPluginId: 'clawtalk',
    configPath: path.join(root, 'openclaw.json'),
    installRepairDir: path.join(root, 'tmp', 'plugin-install-repair'),
    openclawBin: path.join(root, 'openclaw'),
    pluginExtensionsDir: path.join(root, 'extensions'),
    stateRoot: root,
    delayMs: async () => undefined,
    listPluginControls: async () => nextControls(),
    openClawConfigNeedsCodexPlugin: options.openClawConfigNeedsCodexPlugin || (() => false),
    pauseGatewayForPluginInstallRepair: async (actions) => {
      state.pauseCount += 1
      actions.push('paused Gateway for plugin install repair')
    },
    persistTrustedPluginAllowlist: async (...extraIds) => {
      state.persistedAllowlist.push(extraIds)
    },
    readOpenclawConfig: options.readOpenclawConfig || (async () => ({})),
    readPluginRuntimeState: async () => state.runtimeState,
    redactSensitiveText: redact,
    refreshOpenClawPluginRegistry: async (reason) => {
      state.registryReasons.push(reason)
      return options.refreshOpenClawPluginRegistry
        ? options.refreshOpenClawPluginRegistry(reason)
        : { code: 0, stdout: '', stderr: '' }
    },
    refreshPluginListCache: async () => {
      state.refreshCount += 1
    },
    repairClawTalkPluginManifestContracts: async () => {
      state.clawTalkRepairCount += 1
      return options.repairClawTalkPluginManifestContracts
        ? options.repairClawTalkPluginManifestContracts()
        : []
    },
    repairCodexPluginPostInstallState: async (repairOptions) => {
      state.codexRepairCalls.push({ ...repairOptions })
      return options.repairCodexPluginPostInstallState
        ? options.repairCodexPluginPostInstallState(repairOptions)
        : { applied: false, reason: '', actions: [] }
    },
    resolveBundledCodexPluginRoot: options.resolveBundledCodexPluginRoot || (() => ''),
    resumeGatewayAfterPluginInstallRepair: (actions) => {
      state.resumeCount += 1
      actions.push('resumed Gateway after plugin install repair')
    },
    runOpenClaw: async (args, timeoutMs) => {
      state.runs.push({ args: [...args], timeoutMs })
      return runQueue.shift() || { code: 0, stdout: '', stderr: '' }
    },
    schedulePluginGatewayRestart: () => {
      state.restartCount += 1
      return { restarted: false, scheduled: true, detail: 'gateway restart queued in 750ms' }
    },
    setOpenClawPluginEnabled: async (pluginId, enabled) => {
      state.enabledCalls.push({ pluginId, enabled })
    },
    warn: (message) => state.warnings.push(message),
    writePluginRuntimeState: async (runtimeState) => {
      state.runtimeState = clone(runtimeState)
    },
  })

  return { service, state }
}

test('plugin install service installs, enables, refreshes controls, schedules restart, and records runtime state', async () => {
  const { service, state } = createHarness({
    controls: [
      controlsPayload([]),
      controlsPayload([pluginEntry('weather')]),
      controlsPayload([pluginEntry('weather')]),
      controlsPayload([pluginEntry('weather')]),
    ],
    runResults: [
      { code: 0, stdout: 'installed with sk-install-secret', stderr: '' },
      { code: 0, stdout: 'enabled', stderr: '' },
    ],
  })

  const result = await service.installOpenClawPlugin({
    spec: 'clawhub:@openclaw/weather-plugin@1.2.3',
    pin: true,
    enable: true,
    force: false,
    restart: true,
  })

  assert.deepEqual(state.runs.map((run) => run.args), [
    ['plugins', 'install', 'clawhub:@openclaw/weather-plugin@1.2.3', '--pin'],
    ['plugins', 'enable', 'weather'],
  ])
  assert.equal(result.install.stdout.includes('sk-install-secret'), false)
  assert.match(result.install.stdout, /\[REDACTED\]/)
  assert.equal(result.plugin?.id, 'weather')
  assert.equal(result.restart.scheduled, true)
  assert.equal(state.refreshCount, 1)
  assert.deepEqual(state.enabledCalls, [{ pluginId: 'weather', enabled: true }])
  assert.deepEqual(state.persistedAllowlist, [['weather']])
  assert.equal(state.runtimeState.managed?.weather?.enabled, true)
  assert.equal(state.runtimeState.installs?.weather?.spec, 'clawhub:@openclaw/weather-plugin@1.2.3')
  assert.equal(state.runtimeState.installs?.weather?.packageName, '@openclaw/weather-plugin')
  assert.equal(state.runtimeState.installs?.weather?.version, '1.2.3')
  assert.equal(state.runtimeState.installs?.weather?.installedBy, 'control-center')
})

test('plugin install service repairs Windows stage rename failure and retries with force', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-plugin-install-'))
  try {
    const extensionsDir = path.join(tempRoot, 'extensions')
    const sourcePath = path.join(extensionsDir, '.openclaw-install-stage-weather')
    const targetPath = path.join(extensionsDir, 'weather')
    const stalePath = path.join(extensionsDir, '.openclaw-install-stage-old')
    await mkdir(sourcePath, { recursive: true })
    await mkdir(targetPath, { recursive: true })
    await mkdir(stalePath, { recursive: true })

    const { service, state } = createHarness({
      tempRoot,
      controls: [
        controlsPayload([]),
        controlsPayload([pluginEntry('weather')]),
        controlsPayload([pluginEntry('weather')]),
        controlsPayload([pluginEntry('weather')]),
      ],
      runResults: [
        {
          code: 1,
          stdout: '',
          stderr: `failed to copy plugin: rename '${sourcePath}' -> '${targetPath}' EPERM sk-install-secret`,
        },
        { code: 0, stdout: 'installed after repair', stderr: '' },
        { code: 0, stdout: 'enabled', stderr: '' },
      ],
    })

    const result = await service.installOpenClawPlugin({
      spec: 'weather',
      pluginId: 'weather',
      pin: true,
      enable: true,
      force: false,
      restart: false,
    })

    assert.deepEqual(state.runs[0]?.args, ['plugins', 'install', 'weather', '--pin'])
    assert.deepEqual(state.runs[1]?.args, ['plugins', 'install', 'weather', '--pin', '--force'])
    assert.equal(result.repair?.applied, true)
    assert.equal(result.repair?.retryArgs?.includes('--force'), true)
    assert.equal(state.pauseCount, 1)
    assert.equal(state.resumeCount, 1)
    assert.equal(result.restart.scheduled, false)
    const quarantined = await readdir(path.join(tempRoot, 'tmp', 'plugin-install-repair'))
    assert.equal(quarantined.some((entry) => entry.startsWith('previous-weather-weather-')), true)
    assert.equal(quarantined.some((entry) => entry.startsWith('failed-stage-weather-.openclaw-install-stage-weather-')), true)
    assert.equal(quarantined.some((entry) => entry.startsWith('stale-stage-.openclaw-install-stage-old-')), true)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('plugin install service updates, update-all touches, and uninstall forgets managed runtime state', async () => {
  const { service, state } = createHarness({
    runtimeState: {
      managed: {
        alpha: { enabled: true, updatedAt: '2026-06-30T00:00:00.000Z' },
      },
      installs: {
        alpha: {
          pluginId: 'alpha',
          spec: 'alpha',
          source: 'auto',
          enabled: true,
          installedAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
          stateRoot: '/tmp',
          configPath: '/tmp/openclaw.json',
          openclawBin: '/tmp/openclaw',
          installedBy: 'control-center',
        },
      },
      secrets: {
        alpha: { apiKey: 'secret' },
      },
    },
    controls: [
      controlsPayload([pluginEntry('alpha', false)]),
      controlsPayload([pluginEntry('alpha', false)]),
      controlsPayload([pluginEntry('alpha', true), pluginEntry('beta', false)]),
      controlsPayload([pluginEntry('beta', false)]),
    ],
    runResults: [
      { code: 0, stdout: 'updated alpha', stderr: '' },
      { code: 0, stdout: 'updated all', stderr: '' },
      { code: 0, stdout: 'uninstalled alpha', stderr: '' },
    ],
  })

  const update = await service.updateOpenClawPlugin('alpha', false)
  assert.deepEqual(state.runs[0]?.args, ['plugins', 'update', 'alpha'])
  assert.equal(update.restart.scheduled, false)
  assert.equal(state.runtimeState.managed?.alpha?.enabled, false)
  assert.equal(state.runtimeState.installs?.alpha?.enabled, false)

  const updateAll = await service.updateAllOpenClawPlugins(true)
  assert.deepEqual(state.runs[1]?.args, ['plugins', 'update', '--all'])
  assert.equal(updateAll.restart.scheduled, true)
  assert.equal(state.runtimeState.managed?.alpha?.enabled, true)
  assert.equal(state.runtimeState.managed?.beta?.enabled, false)

  const uninstall = await service.uninstallOpenClawPlugin('alpha', { keepFiles: true, force: true, restart: true })
  assert.deepEqual(state.runs[2]?.args, ['plugins', 'uninstall', 'alpha', '--keep-files', '--force'])
  assert.equal(uninstall.restart.scheduled, true)
  assert.equal(state.runtimeState.managed?.alpha, undefined)
  assert.equal(state.runtimeState.installs?.alpha, undefined)
  assert.equal(state.runtimeState.secrets?.alpha, undefined)
})

test('plugin install service redacts plugin command failures', async () => {
  const { service } = createHarness({
    runResults: [
      { code: 23, stdout: 'partial sk-command-secret', stderr: 'failed sk-command-secret' },
    ],
  })

  await assert.rejects(
    () => service.updateOpenClawPlugin('weather', true),
    (error: unknown) => {
      assert.equal((error as Error & { code?: number }).code, 23)
      assert.doesNotMatch(String(error), /sk-command-secret/)
      assert.match(String(error), /\[REDACTED\]/)
      return true
    },
  )
})

test('plugin install input parser accepts pasted OpenClaw install commands only with safe flags', () => {
  assert.deepEqual(
    parsePluginInstallInput('openclaw plugins install clawhub:weather --marketplace public --force'),
    {
      spec: 'clawhub:weather',
      fromCommand: true,
      installArgs: ['--marketplace', 'public', '--force'],
    },
  )
  assert.throws(
    () => parsePluginInstallInput('openclaw plugins install weather --postinstall-script curl'),
    /Unsupported plugin install flag/,
  )
})

test('plugin install parser covers quoted commands, direct specs, values, and rejected shapes', () => {
  assert.deepEqual(splitPluginCommandLine('openclaw plugins install "clawhub:@openclaw/weather" --marketplace public'), [
    'openclaw',
    'plugins',
    'install',
    'clawhub:@openclaw/weather',
    '--marketplace',
    'public',
  ])
  assert.deepEqual(splitPluginCommandLine('openclaw plugins install "quoted\\\\path"'), [
    'openclaw',
    'plugins',
    'install',
    'quoted\\path',
  ])
  assert.deepEqual(parsePluginInstallInput('weather'), {
    spec: 'weather',
    fromCommand: false,
    installArgs: [],
  })
  assert.deepEqual(
    parsePluginInstallInput('openclaw.cmd plugins install weather --marketplace=public --pin -l'),
    {
      spec: 'weather',
      fromCommand: true,
      installArgs: ['--marketplace=public', '--pin', '-l'],
    },
  )
  assert.throws(() => splitPluginCommandLine('openclaw plugins install "weather'), /unterminated quote/)
  assert.throws(() => parsePluginInstallInput('openclaw plugins install weather --marketplace'), /needs a value/)
  assert.throws(() => parsePluginInstallInput('openclaw plugins install weather extra'), /Unexpected extra/)
  assert.throws(() => parsePluginInstallInput('node plugins install weather'), /Paste an OpenClaw/)
  assert.throws(() => parsePluginInstallInput(''), /Install spec is required/)
  assert.throws(() => parsePluginInstallInput('a'.repeat(321)), /too long/)
  assert.throws(() => parsePluginInstallInput('weather\nnext'), /control characters/)
})

test('plugin command result quotes spaced args, strips ANSI, redacts output, and preserves elapsed time', () => {
  const result = pluginCommandResult(
    ['plugins', 'install', 'C:\\Plugin Dir\\weather'],
    {
      code: 0,
      stdout: '\u001b[31minstalled sk-output-secret\u001b[0m',
      stderr: 'warning sk-output-secret',
      elapsedMs: 42,
    },
    redact,
  )

  assert.match(result.command, /^openclaw plugins install "/)
  assert.equal(result.code, 0)
  assert.equal(result.elapsedMs, 42)
  assert.doesNotMatch(result.stdout, /sk-output-secret/)
  assert.doesNotMatch(result.output, new RegExp(String.fromCharCode(27)))
  assert.match(result.output, /\[REDACTED\]/)
})

test('plugin install service uses bundled Codex source and records post-install repair evidence', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-plugin-codex-'))
  try {
    const bundledRoot = path.join(tempRoot, 'bundled-codex')
    await mkdir(bundledRoot, { recursive: true })
    await import('node:fs/promises').then(({ writeFile }) => writeFile(
      path.join(bundledRoot, 'package.json'),
      `${JSON.stringify({ version: '2.4.6' })}\n`,
      'utf-8',
    ))
    const { service, state } = createHarness({
      controls: [
        controlsPayload([]),
        controlsPayload([pluginEntry('codex')]),
        controlsPayload([pluginEntry('codex')]),
        controlsPayload([pluginEntry('codex')]),
      ],
      runResults: [
        { code: 0, stdout: 'installed codex', stderr: '' },
        { code: 0, stdout: 'enabled codex', stderr: '' },
      ],
      resolveBundledCodexPluginRoot: () => bundledRoot,
      openClawConfigNeedsCodexPlugin: () => true,
      repairCodexPluginPostInstallState: async (repairOptions) => ({
        applied: true,
        reason: repairOptions.verifyRoutes ? 'routes repaired' : 'routes ok',
        actions: ['codex manifest repaired'],
        bundledSource: repairOptions.bundledSource,
      }),
      tempRoot,
    })

    const result = await service.installOpenClawPlugin({
      spec: 'openclaw plugins install clawhub:@openclaw/codex@9.9.9 --pin',
      pluginId: 'codex',
      pin: true,
      enable: true,
      force: false,
      restart: false,
    })

    assert.deepEqual(state.runs.map((run) => run.args), [
      ['plugins', 'install', bundledRoot],
      ['plugins', 'enable', 'codex'],
    ])
    assert.deepEqual(state.codexRepairCalls, [{
      runCliEnable: false,
      verifyRoutes: true,
      bundledSource: bundledRoot,
    }])
    assert.equal(result.postInstallRepair?.applied, true)
    assert.equal(result.restart.scheduled, false)
    assert.equal(state.runtimeState.installs?.codex?.spec, 'clawhub:@openclaw/codex@9.9.9')
    assert.equal(state.runtimeState.installs?.codex?.packageName, '@openclaw/codex')
    assert.equal(state.runtimeState.installs?.codex?.version, '2.4.6')
    assert.deepEqual(state.persistedAllowlist, [['codex']])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('plugin install service refreshes OpenClaw registry after ClawTalk manifest repair', async () => {
  const { service, state } = createHarness({
    controls: [
      controlsPayload([]),
      controlsPayload([pluginEntry('clawtalk')]),
      controlsPayload([pluginEntry('clawtalk')]),
      controlsPayload([pluginEntry('clawtalk')]),
    ],
    runResults: [
      { code: 0, stdout: 'installed clawtalk', stderr: '' },
      { code: 0, stdout: 'enabled clawtalk', stderr: '' },
    ],
    repairClawTalkPluginManifestContracts: async () => ['openclaw.plugin.json'],
  })

  const result = await service.installOpenClawPlugin({
    spec: 'clawtalk',
    pluginId: 'clawtalk',
    pin: true,
    enable: true,
    force: false,
    restart: true,
  })

  assert.equal(state.clawTalkRepairCount, 1)
  assert.deepEqual(state.registryReasons, ['clawtalk-post-install-repair'])
  assert.equal(result.restart.scheduled, true)
  assert.equal(result.plugin?.id, 'clawtalk')
  assert.deepEqual(state.persistedAllowlist, [['clawtalk']])
})

test('plugin install service returns disabled managed state when install is not activated', async () => {
  const { service, state } = createHarness({
    controls: [
      controlsPayload([]),
      controlsPayload([pluginEntry('local-plugin', false)]),
      controlsPayload([pluginEntry('local-plugin', false)]),
    ],
    runResults: [
      { code: 0, stdout: 'installed local path', stderr: '' },
    ],
  })

  const result = await service.installOpenClawPlugin({
    spec: '.\\plugins\\local-plugin',
    pluginId: 'local-plugin',
    pin: true,
    enable: false,
    force: true,
    restart: true,
  })

  assert.deepEqual(state.runs.map((run) => run.args), [
    ['plugins', 'install', '.\\plugins\\local-plugin', '--force'],
  ])
  assert.equal(result.restart.scheduled, false)
  assert.equal(state.runtimeState.managed?.['local-plugin']?.enabled, false)
  assert.equal(state.runtimeState.installs?.['local-plugin']?.source, 'path')
  assert.deepEqual(state.persistedAllowlist, [])
})

test('plugin install service redacts install and activation failures', async () => {
  const failedInstall = createHarness({
    runResults: [
      { code: 9, stdout: 'partial sk-install-fail', stderr: 'failed sk-install-fail' },
    ],
  })

  await assert.rejects(
    () => failedInstall.service.installOpenClawPlugin({
      spec: 'weather',
      pin: false,
      enable: false,
      force: false,
      restart: false,
    }),
    (error: unknown) => {
      assert.equal((error as Error & { code?: number }).code, 9)
      assert.doesNotMatch(String(error), /sk-install-fail/)
      assert.match(String(error), /\[REDACTED\]/)
      return true
    },
  )

  const failedActivation = createHarness({
    controls: [
      controlsPayload([]),
      controlsPayload([pluginEntry('weather')]),
    ],
    runResults: [
      { code: 0, stdout: 'installed weather', stderr: '' },
      { code: 7, stdout: 'activation sk-activation-fail', stderr: '' },
    ],
  })

  await assert.rejects(
    () => failedActivation.service.installOpenClawPlugin({
      spec: 'weather',
      pluginId: 'weather',
      pin: false,
      enable: true,
      force: false,
      restart: false,
    }),
    (error: unknown) => {
      assert.equal((error as Error & { code?: number }).code, 7)
      assert.doesNotMatch(String(error), /sk-activation-fail/)
      assert.match(String(error), /Plugin installed, but activation failed/)
      assert.match(String(error), /\[REDACTED\]/)
      return true
    },
  )
})

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import type { ChildProcess } from 'node:child_process'
import {
  buildGatewayRunArgs,
  createGatewayLifecycleService,
  type GatewayLifecycleServiceOptions,
  type GatewayLogEntry,
  type GatewaySpawnSpec,
} from '../server/services/gateway/gatewayLifecycleService'

type HarnessOptions = {
  healthSequence?: boolean[]
  runtimeAvailable?: boolean
  listenerPid?: number | null
  portBusy?: boolean
  portBusySequence?: boolean[]
  releaseResult?: { released: boolean; detail: string }
  repairClawTalkResult?: string[]
  repairTelegramResult?: string[]
  onClawTalkRepair?: () => Promise<void> | void
  onTelegramRepair?: () => Promise<void> | void
  onSpawn?: (child: ChildProcess) => void
}

function fakeChildProcess(onSpawn?: (child: ChildProcess) => void): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
    stdio: [],
    killed: false,
    connected: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: 'openclaw',
    kill: () => true,
    ref: () => child,
    unref: () => child,
  }) as ChildProcess
  onSpawn?.(child)
  return child
}

function createHarness(config: HarnessOptions = {}) {
  const logs: GatewayLogEntry[] = []
  const lifecycleEvents: Record<string, unknown>[] = []
  const spawnSpecs: GatewaySpawnSpec[] = []
  const envOverrides: Record<string, string | undefined>[] = []
  const registryRefreshReasons: string[] = []
  const startupRepairSummaries: unknown[] = []
  let healthCalls = 0
  let releaseCalls = 0
  let clawTalkRepairCalls = 0
  let telegramRepairCalls = 0
  let spawnCalls = 0
  const healthSequence = config.healthSequence ? [...config.healthSequence] : [false]
  const portBusySequence = config.portBusySequence ? [...config.portBusySequence] : null
  const spawnedChildren: ChildProcess[] = []

  const options: GatewayLifecycleServiceOptions = {
    gatewayHttpPort: 19999,
    controlCenterPort: 13337,
    openClawConfigPath: 'test-openclaw.json',
    openClawStateRoot: 'test-state',
    startupHealthGraceMs: 15_000,
    startupHealthConfirmTimeoutMs: 50,
    startupHealthPollMs: 1,
    isShuttingDown: () => false,
    isOpenClawRuntimeAvailable: () => config.runtimeAvailable !== false,
    openClawRuntimeUnavailableMessage: () => 'missing-runtime',
    openClawSpawnSpec: (args) => {
      const spec = { command: 'openclaw', args: [...args], shell: false }
      spawnSpecs.push(spec)
      return spec
    },
    openClawProcessEnv: (overrides) => {
      envOverrides.push(overrides)
      return { ...process.env, ...overrides }
    },
    openClawRuntimeCwd: () => process.cwd(),
    spawnText: async () => ({
      stdout: config.listenerPid ? String(config.listenerPid) : '',
      stderr: '',
      code: 0,
      timedOut: false,
    }),
    spawnProcess: () => {
      spawnCalls += 1
      return fakeChildProcess((child) => {
        spawnedChildren.push(child)
        config.onSpawn?.(child)
        process.nextTick(() => {
          child.stdout?.emit('data', Buffer.from('http server listening\n'))
        })
      })
    },
    terminateProcessTree: async () => ({ ok: true, detail: 'terminated' }),
    checkTcpPort: async () => {
      if (portBusySequence && portBusySequence.length) return portBusySequence.shift() === true
      return config.portBusy === true
    },
    tryReleaseGatewayPort: async () => {
      releaseCalls += 1
      return config.releaseResult || { released: true, detail: 'released' }
    },
    isPidAlive: (pid) => pid > 0,
    delayMs: async () => undefined,
    appendBoundedRuntimeOutput: (current, chunk) => `${current}${String(chunk)}`,
    compactGatewayLogMessage: (value, max = 220) => value.slice(0, max),
    redactSensitiveText: (value) => value.replace(/secret/gi, '[redacted]'),
    stripAnsi: (value) => value,
    sanitizeGatewayStartupMessage: (message, max = 220) => message.slice(0, max),
    formatGatewayProcessOutput: () => '',
    pushGatewayLog: (stream, message, level) => {
      logs.push({
        id: logs.length + 1,
        timestamp: new Date().toISOString(),
        stream,
        message,
        ...(level ? { level } : {}),
      })
    },
    appendGatewayLifecycleEvent: (entry) => {
      lifecycleEvents.push(entry)
    },
    getGatewayLogs: () => logs,
    isRuntimeMonitorEntryVisible: () => true,
    invalidateRuntimeStatusCache: () => undefined,
    gatewayStabilityUnavailable: (source) => ({
      summary: {
        active: null,
        waiting: null,
        queued: null,
        maxQueueDepth: null,
        recentWarnings: source === 'diagnostics.stability' ? ['diagnostic unavailable'] : [],
      },
    }),
    fetchGatewayHealthPayload: async () => {
      const index = Math.min(healthCalls, healthSequence.length - 1)
      healthCalls += 1
      return { healthy: healthSequence[index] === true, payload: {} }
    },
    repairClawTalkPluginManifestContracts: async () => {
      clawTalkRepairCalls += 1
      await config.onClawTalkRepair?.()
      return config.repairClawTalkResult || []
    },
    repairTelegramAgentRoutingRuntime: async () => {
      telegramRepairCalls += 1
      await config.onTelegramRepair?.()
      return config.repairTelegramResult || []
    },
    refreshOpenClawPluginRegistry: async (reason) => {
      registryRefreshReasons.push(reason)
      return { code: 0 }
    },
    ensureGatewayStartupPluginDefaults: async (repairSummary) => {
      startupRepairSummaries.push(repairSummary || null)
    },
    prepareOpenClawConfigForGatewayStartup: async () => true,
    isInvalidOpenClawConfigText: () => false,
    scheduleOpenClawSessionLockSweep: () => undefined,
    sweepOpenClawSessionLocks: async () => undefined,
    stopControlCenterGatewayClient: () => undefined,
    log: {
      info: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  }

  const service = createGatewayLifecycleService(options)
  return {
    envOverrides,
    registryRefreshReasons,
    startupRepairSummaries,
    get healthCalls() {
      return healthCalls
    },
    lifecycleEvents,
    logs,
    service,
    spawnedChildren,
    spawnSpecs,
    get releaseCalls() {
      return releaseCalls
    },
    get clawTalkRepairCalls() {
      return clawTalkRepairCalls
    },
    get telegramRepairCalls() {
      return telegramRepairCalls
    },
    get spawnCalls() {
      return spawnCalls
    },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

test('buildGatewayRunArgs constructs the OpenClaw gateway command', () => {
  assert.deepEqual(buildGatewayRunArgs(18789), ['gateway', 'run', '--port', '18789', '--allow-unconfigured'])
})

test('ensureGatewayRunning records unavailable runtime without spawning', async () => {
  const harness = createHarness({ runtimeAvailable: false, healthSequence: [false, false] })

  await harness.service.ensureGatewayRunning()

  assert.equal(harness.spawnCalls, 0)
  assert.match(harness.logs.map((entry) => entry.message).join('\n'), /failed to start: Error: missing-runtime/)
  assert.equal(harness.service.gatewayStatusSnapshot(false).state, 'offline')
})

test('tryRestartGatewayService does not take over an external listener unless allowed', async () => {
  const harness = createHarness({ healthSequence: [false], listenerPid: 4321 })

  const result = await harness.service.tryRestartGatewayService({ reason: 'unit external listener' })
  harness.service.stopGatewayHealthMonitor()

  assert.equal(result.restarted, false)
  assert.match(result.detail, /external gateway listener pid=4321 left running/)
  assert.equal(harness.releaseCalls, 0)
  assert.equal(harness.spawnCalls, 0)
  assert.equal(harness.service.lifecycleSnapshot().lastRestartOutcome, 'skipped')
})

test('ensureGatewayRunning releases an unhealthy stale listener before starting a replacement', async () => {
  const harness = createHarness({
    healthSequence: [false, false, true],
    portBusySequence: [true],
  })

  await harness.service.ensureGatewayRunning()
  harness.service.stopGatewayHealthMonitor()

  assert.equal(harness.releaseCalls, 1)
  assert.equal(harness.spawnCalls, 1)
  assert.deepEqual(harness.spawnSpecs[0]?.args, ['gateway', 'run', '--port', '19999', '--allow-unconfigured'])
  assert.equal(harness.service.gatewayStatusSnapshot(true).state, 'healthy')
})

test('ensureGatewayRunning starts independent plugin repairs in parallel', async () => {
  const clawTalkRepair = deferred()
  const telegramRepair = deferred()
  const repairStarts: string[] = []
  const harness = createHarness({
    healthSequence: [false, false, true],
    onClawTalkRepair: async () => {
      repairStarts.push('clawtalk')
      await clawTalkRepair.promise
    },
    onTelegramRepair: async () => {
      repairStarts.push('telegram')
      await telegramRepair.promise
    },
  })

  const ensure = harness.service.ensureGatewayRunning()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(repairStarts.sort(), ['clawtalk', 'telegram'])
  clawTalkRepair.resolve()
  telegramRepair.resolve()
  await ensure
  harness.service.stopGatewayHealthMonitor()

  assert.equal(harness.clawTalkRepairCalls, 1)
  assert.equal(harness.telegramRepairCalls, 1)
  assert.equal(harness.spawnCalls, 1)
})

test('ensureGatewayRunning passes startup repair results into defaults without duplicate registry refresh', async () => {
  const harness = createHarness({
    healthSequence: [false, false, true],
    repairClawTalkResult: ['clawtalk-root'],
    repairTelegramResult: ['telegram-runtime'],
  })

  await harness.service.ensureGatewayRunning()
  harness.service.stopGatewayHealthMonitor()

  assert.equal(harness.clawTalkRepairCalls, 1)
  assert.equal(harness.telegramRepairCalls, 1)
  assert.deepEqual(harness.registryRefreshReasons, ['clawtalk-startup-repair', 'gateway-startup'])
  assert.deepEqual(harness.startupRepairSummaries[0], {
    repairedClawTalkManifests: ['clawtalk-root'],
    repairedTelegramRuntimes: ['telegram-runtime'],
    clawTalkRegistryRefreshed: true,
  })
})

test('ensureGatewayRunning does not spawn over a stale listener that remains busy after release fails', async () => {
  const harness = createHarness({
    healthSequence: [false, false],
    portBusySequence: [true, true],
    releaseResult: { released: false, detail: 'still listening' },
  })

  await harness.service.ensureGatewayRunning()
  harness.service.stopGatewayHealthMonitor()

  assert.equal(harness.releaseCalls, 1)
  assert.equal(harness.spawnCalls, 0)
  assert.equal(harness.service.gatewayStatusSnapshot(false).state, 'offline')
})

test('forced restart releases the port and starts the gateway with Control Center stream URLs', async () => {
  const harness = createHarness({ healthSequence: [false, false, true, true] })

  const result = await harness.service.tryRestartGatewayService({ force: true, reason: 'unit forced restart' })
  harness.service.stopGatewayHealthMonitor()

  assert.equal(result.restarted, true)
  assert.equal(harness.releaseCalls, 1)
  assert.equal(harness.spawnCalls, 1)
  assert.deepEqual(harness.spawnSpecs[0]?.args, ['gateway', 'run', '--port', '19999', '--allow-unconfigured'])
  assert.equal(harness.envOverrides[0]?.CONTROL_CENTER_AGENT_TURN_STREAM_URL, 'http://127.0.0.1:13337/api/openclaw/agent-turn/stream')
  assert.equal(harness.envOverrides[0]?.CLAWTALK_CONTROL_CENTER_AGENT_TURN_STREAM_URL, 'http://127.0.0.1:13337/api/openclaw/agent-turn/stream')
  assert.equal(harness.envOverrides[0]?.CLAWTALK_CONTROL_CENTER_CONSOLE_FINAL_URL, 'http://127.0.0.1:13337/api/openclaw/clawtalk-console/final')
  assert.equal(harness.service.lifecycleSnapshot().lastRestartOutcome, 'succeeded')
})

test('gatewayStatusSnapshot exposes Monitor healthy, offline, and restarting states', async () => {
  const offlineHarness = createHarness({ healthSequence: [false] })
  assert.equal(offlineHarness.service.gatewayStatusSnapshot(false).state, 'offline')

  const restartingHarness = createHarness({ healthSequence: [false, false, true, false] })
  await restartingHarness.service.ensureGatewayRunning()
  assert.equal(restartingHarness.service.gatewayStatusSnapshot(true).state, 'healthy')

  restartingHarness.spawnedChildren[0]?.emit('close', 1)
  await new Promise((resolve) => setImmediate(resolve))

  const restartingSnapshot = restartingHarness.service.gatewayStatusSnapshot(false)
  assert.equal(restartingSnapshot.state, 'restarting')
  assert.equal(restartingSnapshot.restartScheduled, true)
  assert.equal(restartingSnapshot.lastRestartOutcome, 'scheduled')
  assert.match(String(restartingSnapshot.lastRestartReason), /gateway process exited while health probe was unhealthy/)
  restartingHarness.service.clearRestartTimer()
  restartingHarness.service.stopGatewayHealthMonitor()
})

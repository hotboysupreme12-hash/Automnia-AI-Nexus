import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process'
import {
  buildGatewayRunArgs,
  createGatewayLifecycleService,
  type GatewayLifecycleServiceOptions,
} from '../server/services/gateway/gatewayLifecycleService'

class FakeGatewayProcess extends EventEmitter {
  pid = 4242
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  kill() {
    return true
  }
}

type LifecycleContextOptions = {
  healthSequence?: boolean[]
  listenerPid?: number | null
  spawnReadyOutput?: string
  processAlive?: (pid: number) => boolean
  portBusySequence?: boolean[]
  releaseResult?: { released: boolean; detail: string }
  onSpawn?: (child: FakeGatewayProcess) => void
}

function createLifecycleContext(contextOptions: LifecycleContextOptions = {}) {
  const logs: string[] = []
  const ledgerEvents: Record<string, unknown>[] = []
  const spawnSpecArgs: string[][] = []
  const spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }> = []
  const terminated: Array<{ pid: number | undefined; reason?: string; force?: boolean }> = []
  const stoppedClients: string[] = []
  const sweeps: string[] = []
  const spawnedChildren: FakeGatewayProcess[] = []
  let healthChecks = 0
  let invalidations = 0
  let releaseCalls = 0

  const healthSequence = contextOptions.healthSequence || [false]
  const portBusySequence = contextOptions.portBusySequence ? [...contextOptions.portBusySequence] : null
  const options: GatewayLifecycleServiceOptions = {
    gatewayHttpPort: 4567,
    controlCenterPort: 4050,
    openClawConfigPath: 'C:/dystopai/openclaw.json',
    openClawStateRoot: 'C:/dystopai/state',
    startupHealthGraceMs: 50,
    startupHealthConfirmTimeoutMs: 50,
    startupHealthPollMs: 1,
    isShuttingDown: () => false,
    isOpenClawRuntimeAvailable: () => true,
    openClawRuntimeUnavailableMessage: () => 'OpenClaw runtime unavailable',
    openClawSpawnSpec: (args) => {
      spawnSpecArgs.push(args)
      return { command: 'openclaw', args, shell: false }
    },
    openClawProcessEnv: (overrides) => ({
      OPENCLAW_STATE_DIR: 'C:/dystopai/state',
      ...overrides,
    }),
    openClawRuntimeCwd: () => 'C:/dystopai/openclaw',
    spawnText: async () => ({
      stdout: contextOptions.listenerPid ? `${contextOptions.listenerPid}\n` : '',
      stderr: '',
      code: 0,
      timedOut: false,
    }),
    spawnProcess: (command, args, spawnOptions) => {
      spawnCalls.push({ command, args, options: spawnOptions })
      const child = new FakeGatewayProcess()
      spawnedChildren.push(child)
      contextOptions.onSpawn?.(child)
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(contextOptions.spawnReadyOutput || 'http server listening\n'))
      }, 0)
      return child as unknown as ChildProcessWithoutNullStreams
    },
    terminateProcessTree: async (pid, reason, force) => {
      terminated.push({ pid, reason, force })
      return { ok: true, detail: `terminated ${pid ?? 'missing'}` }
    },
    checkTcpPort: async () => {
      if (portBusySequence && portBusySequence.length) return portBusySequence.shift() === true
      return false
    },
    tryReleaseGatewayPort: async () => {
      releaseCalls += 1
      return contextOptions.releaseResult || { released: true, detail: 'PORT_CLEAR' }
    },
    isPidAlive: contextOptions.processAlive || ((pid) => pid === 4242),
    delayMs: async () => undefined,
    appendBoundedRuntimeOutput: (current, chunk) => `${current}${String(chunk)}`,
    compactGatewayLogMessage: (value, max = 640) => value.slice(0, max),
    redactSensitiveText: (value) => value,
    stripAnsi: (value) => value,
    sanitizeGatewayStartupMessage: (message, max = 220) => message.slice(0, max),
    formatGatewayProcessOutput: () => '',
    pushGatewayLog: (stream, message, level) => {
      logs.push(`${stream}:${level || 'info'}:${message}`)
    },
    appendGatewayLifecycleEvent: (entry) => {
      ledgerEvents.push(entry)
    },
    getGatewayLogs: () => [],
    isRuntimeMonitorEntryVisible: () => true,
    invalidateRuntimeStatusCache: () => {
      invalidations += 1
    },
    gatewayStabilityUnavailable: () => ({
      summary: {
        recentWarnings: [],
      },
    }),
    fetchGatewayHealthPayload: async () => {
      const index = Math.min(healthChecks, healthSequence.length - 1)
      healthChecks += 1
      return { healthy: healthSequence[index] || false, payload: null }
    },
    repairClawTalkPluginManifestContracts: async () => [],
    repairTelegramAgentRoutingRuntime: async () => [],
    refreshOpenClawPluginRegistry: async () => ({ code: 0 }),
    ensureGatewayStartupPluginDefaults: async () => undefined,
    prepareOpenClawConfigForGatewayStartup: async () => true,
    isInvalidOpenClawConfigText: (value) => /\binvalid config\b/i.test(value),
    scheduleOpenClawSessionLockSweep: (reason) => {
      sweeps.push(reason)
    },
    sweepOpenClawSessionLocks: async (reason) => {
      sweeps.push(reason)
      return {}
    },
    stopControlCenterGatewayClient: (reason) => {
      stoppedClients.push(reason)
    },
    log: {
      info: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  }

  return {
    service: createGatewayLifecycleService(options),
    logs,
    ledgerEvents,
    releaseCalls: () => releaseCalls,
    spawnSpecArgs,
    spawnCalls,
    spawnedChildren,
    stoppedClients,
    sweeps,
    terminated,
    invalidations: () => invalidations,
  }
}

assert.deepEqual(
  buildGatewayRunArgs(18789),
  ['gateway', 'run', '--port', '18789', '--allow-unconfigured'],
  'Gateway lifecycle service should construct the documented gateway run command',
)

const startContext = createLifecycleContext({ healthSequence: [false, false, true] })
await startContext.service.ensureGatewayRunning()
assert.deepEqual(startContext.spawnSpecArgs[0], ['gateway', 'run', '--port', '4567', '--allow-unconfigured'])
assert.equal(startContext.spawnCalls.length, 1, 'ensureGatewayRunning should spawn the Gateway once')
assert.equal(startContext.spawnCalls[0].command, 'openclaw')
assert.equal(startContext.spawnCalls[0].options.cwd, 'C:/dystopai/openclaw')
assert.equal(
  (startContext.spawnCalls[0].options.env as NodeJS.ProcessEnv).CONTROL_CENTER_AGENT_TURN_STREAM_URL,
  'http://127.0.0.1:4050/api/openclaw/agent-turn/stream',
)
assert.equal(
  (startContext.spawnCalls[0].options.env as NodeJS.ProcessEnv).CLAWTALK_CONTROL_CENTER_CONSOLE_FINAL_URL,
  'http://127.0.0.1:4050/api/openclaw/clawtalk-console/final',
)
assert.equal(startContext.service.lifecycleSnapshot().lastStartedAt !== null, true)
const startedSnapshot = startContext.service.gatewayStatusSnapshot(true)
assert.equal(startedSnapshot.state, 'healthy')
assert.equal(startedSnapshot.pid, 4242)
assert.equal(startedSnapshot.ownedByControlCenter, true)

const staleListenerContext = createLifecycleContext({
  healthSequence: [false, false, true],
  portBusySequence: [true],
})
await staleListenerContext.service.ensureGatewayRunning()
assert.equal(staleListenerContext.releaseCalls(), 1, 'stale unhealthy listener should be released before replacement spawn')
assert.equal(staleListenerContext.spawnCalls.length, 1, 'released stale listener should allow a replacement Gateway spawn')
assert.equal(staleListenerContext.service.gatewayStatusSnapshot(true).state, 'healthy')
staleListenerContext.service.stopGatewayHealthMonitor()

const blockedStaleListenerContext = createLifecycleContext({
  healthSequence: [false, false],
  portBusySequence: [true, true],
  releaseResult: { released: false, detail: 'STILL_BUSY' },
})
await blockedStaleListenerContext.service.ensureGatewayRunning()
assert.equal(blockedStaleListenerContext.releaseCalls(), 1, 'stale listener release should be attempted once')
assert.equal(blockedStaleListenerContext.spawnCalls.length, 0, 'busy listener after failed release should block replacement spawn')
assert.equal(blockedStaleListenerContext.service.gatewayStatusSnapshot(false).state, 'offline')
blockedStaleListenerContext.service.stopGatewayHealthMonitor()

const restartingContext = createLifecycleContext({ healthSequence: [false, false, true, false] })
await restartingContext.service.ensureGatewayRunning()
assert.equal(restartingContext.service.gatewayStatusSnapshot(true).state, 'healthy')
restartingContext.spawnedChildren[0]?.emit('close', 1)
await new Promise((resolve) => setImmediate(resolve))
const restartingSnapshot = restartingContext.service.gatewayStatusSnapshot(false)
assert.equal(restartingSnapshot.state, 'restarting')
assert.equal(restartingSnapshot.restartScheduled, true)
assert.equal(restartingSnapshot.lastRestartOutcome, 'scheduled')
restartingContext.service.clearRestartTimer()
restartingContext.service.stopGatewayHealthMonitor()

const externalContext = createLifecycleContext({
  healthSequence: [false],
  listenerPid: 777,
  processAlive: (pid) => pid === 777,
})
const externalRestart = await externalContext.service.tryRestartGatewayService({
  force: true,
  reason: 'smoke external gateway restart',
})
externalContext.service.stopGatewayHealthMonitor()
assert.equal(externalRestart.restarted, false)
assert.match(externalRestart.detail, /external gateway listener pid=777/)
assert.equal(externalContext.spawnCalls.length, 0, 'external listener restart refusal should not spawn a replacement')
externalContext.service.stopGatewayHealthMonitor()

const stopResult = await startContext.service.stopGatewayRuntime('smoke stop')
assert.equal(stopResult.stopped, true)
assert.equal(stopResult.port, 4567)
assert.equal(stopResult.pid, 4242)
assert.equal(stopResult.detail, 'PORT_CLEAR')
assert.deepEqual(startContext.stoppedClients, ['smoke stop: gateway runtime stop'])
assert.equal(startContext.terminated.some((entry) => entry.pid === 4242), true)
assert.equal(startContext.sweeps.includes('gateway stop'), true)
assert.equal(startContext.invalidations() > 0, true)
startContext.service.stopGatewayHealthMonitor()

console.log('gateway lifecycle service contract ok')

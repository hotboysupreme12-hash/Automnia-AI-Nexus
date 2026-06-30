import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPluginRuntimeService,
  type PluginRuntimePtyModule,
  type PluginRuntimePtyProcess,
} from '../server/services/plugins/pluginRuntimeService'
import type { PluginOpenClawResult } from '../server/services/plugins/pluginInstallService'

class FakeTerminalProcess implements PluginRuntimePtyProcess {
  pid: number
  writes: string[] = []
  resizeCalls: Array<{ cols: number; rows: number }> = []
  killed = false
  private dataCallbacks = new Set<(data: string) => void>()
  private exitCallbacks = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(pid: number) {
    this.pid = pid
  }

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.resizeCalls.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }

  onData(callback: (data: string) => void) {
    this.dataCallbacks.add(callback)
    return {
      dispose: () => {
        this.dataCallbacks.delete(callback)
      },
    }
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void) {
    this.exitCallbacks.add(callback)
    return {
      dispose: () => {
        this.exitCallbacks.delete(callback)
      },
    }
  }

  emitData(data: string) {
    for (const callback of this.dataCallbacks) callback(data)
  }

  emitExit(exitCode: number) {
    for (const callback of this.exitCallbacks) callback({ exitCode })
  }
}

function redactSecrets(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/apiKey=[^\s]+/g, 'apiKey=[redacted]')
}

function createHarness(results: PluginOpenClawResult[] = []) {
  const runCalls: Array<{ args: string[]; timeoutMs: number }> = []
  const spawnCalls: Array<{ command: string; args: string[]; options: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string> } }> = []
  const processes: FakeTerminalProcess[] = []
  const terminateCalls: Array<{ pid: number | undefined; reason?: string; force?: boolean }> = []
  const warnings: Array<{ message: string; error?: unknown }> = []
  let pid = 4100

  const ptyModule: PluginRuntimePtyModule = {
    spawn(command, args, options) {
      const processHandle = new FakeTerminalProcess(pid++)
      processes.push(processHandle)
      spawnCalls.push({ command, args, options })
      return processHandle
    },
  }

  const service = createPluginRuntimeService({
    listPluginControls: async () => ({
      plugins: [],
      configPath: 'C:/state/config.json',
      cache: { source: 'openclaw', refreshedAt: Date.now(), refreshing: false },
    }),
    openClawProcessEnv: (overrides = {}) => ({
      OPENCLAW_BIN: 'openclaw-test',
      KEEP_ME: '1',
      ...overrides,
    }),
    openClawSpawnSpec: (args) => ({ command: 'openclaw-test', args: ['--state', 'test', ...args] }),
    redactSensitiveText: redactSecrets,
    runOpenClaw: async (args, timeoutMs) => {
      runCalls.push({ args, timeoutMs })
      return results.shift() || { stdout: '{}', stderr: '', code: 0 }
    },
    terminateProcessTree: async (pidValue, reason, force) => {
      terminateCalls.push({ pid: pidValue, reason, force })
      return { ok: true, detail: 'terminated' }
    },
    workspaceRoot: 'C:/workspace',
    loadPtyModule: () => ptyModule,
    warn: (message, error) => warnings.push({ message, error }),
  })

  return { processes, runCalls, service, spawnCalls, terminateCalls, warnings }
}

test('plugin runtime service inspects runtime state, summarizes surfaces, and redacts command output', async () => {
  const harness = createHarness([{
    code: 0,
    elapsedMs: 42,
    stdout: [
      'OpenClaw warning banner',
      JSON.stringify({
        runtime: {
          loaded: true,
          status: 'loaded',
          tools: ['browser.open', { id: 'shell.exec' }],
          gatewayMethods: [{ method: 'sms.send' }],
          channels: [{ id: 'sms' }],
        },
      }),
    ].join('\n'),
    stderr: 'apiKey=sk-live-secret',
  }])

  const inspect = await harness.service.inspectOpenClawPluginRuntime('SMS')

  assert.deepEqual(harness.runCalls[0], {
    args: ['plugins', 'inspect', 'sms', '--runtime', '--json'],
    timeoutMs: 120_000,
  })
  assert.equal(inspect.pluginId, 'sms')
  assert.equal(inspect.status, 'loaded')
  assert.equal(inspect.runtimeLoaded, true)
  assert.equal(inspect.command.command, 'openclaw plugins inspect sms --runtime --json')
  assert.equal(inspect.command.elapsedMs, 42)
  assert.doesNotMatch(inspect.command.stderr, /sk-live-secret/)
  assert.match(inspect.command.stderr, /apiKey=\[redacted\]/)
  assert.deepEqual(
    inspect.surfaces.map((surface) => [surface.label, surface.values]),
    [
      ['Tools', ['browser.open', 'shell.exec']],
      ['Gateway', ['sms.send']],
      ['Channels', ['sms']],
    ],
  )
  assert.equal(harness.service.pluginRuntimeInspectReady(inspect), true)
})

test('plugin runtime service rejects invalid ids and redacts failed inspect output', async () => {
  const invalid = createHarness()
  await assert.rejects(
    () => invalid.service.inspectOpenClawPluginRuntime('../escape'),
    /Invalid plugin id/,
  )

  const harness = createHarness([{
    code: 33,
    stdout: 'load failed for sk-super-secret',
    stderr: 'apiKey=sk-another-secret',
  }])

  await assert.rejects(
    () => harness.service.inspectOpenClawPluginRuntime('codex'),
    (error) => {
      const commandError = error as Error & { code?: number }
      assert.equal(commandError.code, 33)
      assert.doesNotMatch(commandError.message, /sk-super-secret|sk-another-secret/)
      assert.match(commandError.message, /\[redacted-key\]/)
      assert.match(commandError.message, /apiKey=\[redacted\]/)
      return true
    },
  )
})

test('plugin runtime service owns setup terminal command lifecycle and client events', () => {
  const harness = createHarness()
  const session = harness.service.startPluginSetupTerminalSession({
    command: 'doctor',
    pluginId: 'sms',
    cols: 220,
    rows: 4,
  })
  const processHandle = harness.processes[0]

  assert.equal(session.command, 'doctor')
  assert.equal(session.commandLine, 'openclaw plugins doctor')
  assert.equal(session.title, 'Plugin doctor: sms')
  assert.equal(session.status, 'running')
  assert.deepEqual(harness.spawnCalls[0].args, ['--state', 'test', 'plugins', 'doctor'])
  assert.equal(harness.spawnCalls[0].options.cols, 180)
  assert.equal(harness.spawnCalls[0].options.rows, 10)
  assert.equal(harness.spawnCalls[0].options.cwd, 'C:/workspace')
  assert.equal(harness.spawnCalls[0].options.env?.TERM, 'xterm-256color')

  const events: Array<{ event: string; payload: unknown }> = []
  const attachment = harness.service.attachPluginSetupTerminalClient(session.id, (event, payload) => {
    events.push({ event, payload })
  })
  assert.ok(attachment)
  assert.equal(attachment.output, '')

  processHandle.emitData('hello terminal\n')
  assert.equal(harness.service.getPluginSetupTerminalSnapshot(session.id)?.status, 'running')
  assert.deepEqual(events[0], { event: 'data', payload: { data: 'hello terminal\n' } })

  const input = harness.service.writePluginSetupTerminalInput(session.id, 'y\r')
  assert.equal(input.ok, true)
  assert.deepEqual(processHandle.writes, ['y\r'])

  const resized = harness.service.resizePluginSetupTerminalSession(session.id, 120, 30)
  assert.equal(resized.ok, true)
  assert.deepEqual(processHandle.resizeCalls, [{ cols: 120, rows: 30 }])

  processHandle.emitExit(0)
  const completed = harness.service.getPluginSetupTerminalSnapshot(session.id)
  assert.equal(completed?.status, 'completed')
  assert.equal(completed?.exitCode, 0)
  assert.equal(events.at(-1)?.event, 'status')

  attachment.detach()
  processHandle.emitData('after detach')
  assert.equal(events.filter((entry) => entry.event === 'data').length, 1)
})

test('plugin runtime service reports missing/not-running terminal operations and stops sessions for shutdown', () => {
  const harness = createHarness()
  assert.deepEqual(harness.service.writePluginSetupTerminalInput('missing', 'x'), {
    ok: false,
    reason: 'not_found',
    message: 'Setup terminal session not found.',
  })

  const first = harness.service.startPluginSetupTerminalSession({ command: 'plugins' })
  const second = harness.service.startPluginSetupTerminalSession({ command: 'registry' })
  harness.processes[1].emitExit(1)

  const stopped = harness.service.stopPluginSetupTerminalSession(first.id, 'operator stop')
  assert.equal(stopped.ok, true)
  assert.equal(stopped.ok && stopped.session.status, 'stopped')
  assert.equal(harness.processes[0].killed, true)
  assert.deepEqual(harness.terminateCalls[0], { pid: harness.processes[0].pid, reason: 'operator stop', force: true })

  const notRunning = harness.service.writePluginSetupTerminalInput(second.id, 'x')
  assert.equal(notRunning.ok, false)
  assert.equal(!notRunning.ok && notRunning.reason, 'not_running')

  const third = harness.service.startPluginSetupTerminalSession({ command: 'model' })
  assert.equal(harness.service.stopAllPluginSetupTerminalSessions('shutdown'), 1)
  assert.equal(harness.service.getPluginSetupTerminalSnapshot(third.id), null)
})

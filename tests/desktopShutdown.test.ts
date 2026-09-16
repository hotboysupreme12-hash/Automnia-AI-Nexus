import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'

const main = readFileSync('electron/main.cjs', 'utf8')
const server = readFileSync('server/controlPlane.ts', 'utf8')
function section(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}

test('desktop escalates the owned process group even after its leader exits', async () => {
  const signals: Array<[number, string]> = []
  const context = vm.createContext({
    serverRestartTimer: null,
    serverProcess: { pid: 12345 },
    console: { log() {} },
    process: { platform: 'linux', kill: (pid: number, signal: string) => signals.push([pid, signal]) },
    waitForProcessExit: async () => true,
  })
  vm.runInContext(section(main, 'async function stopControlServerProcess(', 'function forceKillSpawnedGateway('), context)
  await vm.runInContext('stopControlServerProcess()', context)
  assert.deepEqual(signals, [[-12345, 'SIGTERM'], [-12345, 'SIGKILL']])
})

test('SIGTERM after runtime API shutdown still closes and exits the server', async () => {
  const calls: string[] = []
  const context = vm.createContext({
    desktopParentWatchdogTimer: null,
    shuttingDown: true,
    signalShutdownInFlight: false,
    console: { log() {}, warn() {} },
    setTimeout, clearTimeout,
    closeControlServerForShutdown: async () => { calls.push('close') },
    runtimeRecoveryService: { shutdownControlCenterRuntime: async () => { calls.push('cleanup') } },
    process: { exitCode: undefined, exit: () => calls.push('exit') },
  })
  const handler = section(server, 'function handleControlCenterShutdown(', "process.on('SIGTERM'")
    .replace("signalName: 'SIGTERM' | 'SIGINT' | 'SIGHUP' | 'process exit'", 'signalName')
  vm.runInContext(handler, context)
  vm.runInContext("handleControlCenterShutdown('SIGTERM')", context)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['close', 'cleanup', 'exit'])
})

test('startup failures receive full quit cleanup; second instances do not touch the running app', () => {
  for (const hasLock of [true, false]) {
    let prevented = false
    let cleanups = 0
    const context = vm.createContext({
      appendDesktopDiagnostic() {}, gpuRecoveryRelaunchRequested: false,
      startupFailed: true, isQuitting: false, quitCleanupComplete: false,
      hasSingleInstanceLock: hasLock, ELECTRON_E2E: false,
      performQuitCleanup: () => { cleanups++; return Promise.resolve() },
      app: { on: (_event: string, handler: (event: unknown) => void) => handler({ preventDefault: () => { prevented = true } }), exit() {} },
    })
    vm.runInContext(section(main, "app.on('before-quit'", "app.on('window-all-closed'"), context)
    assert.equal(prevented, hasLock)
    assert.equal(cleanups, hasLock ? 1 : 0)
  }
})

test('captured process identity rejects PID reuse before forced cleanup', () => {
  const details = new Map<number, { pid: number; commandLine: string; startedAt: string }>([
    [41, { pid: 41, commandLine: 'node.exe owned-worker.js', startedAt: '2026-09-16T12:00:00.000Z' }],
    [42, { pid: 42, commandLine: 'node.exe replacement-worker.js', startedAt: '2026-09-16T12:01:00.000Z' }],
  ])
  const context = vm.createContext({
    process: { pid: 10 },
    normalizeForMatch: (value: unknown) => String(value || '').replace(/\\/g, '/').toLowerCase(),
    listProcessDetails: (pids: number[]) => pids.map((pid) => details.get(pid)).filter(Boolean),
    isProcessAlive: () => false,
  })
  vm.runInContext(section(main, 'function sameProcessInstance(', 'function captureAppOwnedDescendants('), context)
  const captured = [
    { pid: 41, commandLine: 'node.exe owned-worker.js', startedAt: '2026-09-16T12:00:00.000Z' },
    { pid: 42, commandLine: 'node.exe old-worker.js', startedAt: '2026-09-16T11:59:00.000Z' },
  ]
  context.captured = captured
  const matches = vm.runInContext('matchingCapturedProcesses(captured)', context) as Array<{ pid: number }>
  assert.deepEqual(matches.map((entry) => entry.pid), [41])
})

test('quit cleanup does not capture Electron-managed Chromium children', () => {
  const context = vm.createContext({
    process: { pid: 10 },
    normalizeForMatch: (value: unknown) => String(value || '').replace(/\\/g, '/').toLowerCase(),
    listDescendantProcesses: () => [
      { pid: 20, commandLine: '/opt/automnia/electron --type=gpu-process --user-data-dir=/tmp/automnia' },
      { pid: 21, commandLine: 'node /tmp/automnia/dist-server/index.cjs' },
      { pid: 22, commandLine: 'node /tmp/automnia/worker.js' },
    ],
  })
  vm.runInContext(section(main, 'function isElectronManagedChildProcess(', 'function isProcessAlive('), context)
  const captured = vm.runInContext('captureAppOwnedDescendants()', context) as Array<{ pid: number }>
  assert.deepEqual(captured.map((entry) => entry.pid), [21, 22])
})

test('quit cleanup stops captured generic Node descendants without targeting unrelated Node processes', async () => {
  const stopped: number[] = []
  let capturedStillRunning = true
  const captured = [{ pid: 71, commandLine: 'node.exe arbitrary-background-task.js', startedAt: 'owned-start' }]
  const context = vm.createContext({
    process: { pid: 10 },
    MANAGED_PORTS: [],
    listManagedHelperProcesses: () => [
      { pid: 72, commandLine: 'node.exe unrelated-project.js' },
    ],
    listListeningProcesses: () => [],
    listProcessDetails: () => [],
    listDescendantProcesses: () => [],
    isAppOwnedCommand: () => false,
    isManagedHelperCommand: () => false,
    matchingCapturedProcesses: () => capturedStillRunning ? captured : [],
    remainingCapturedProcesses: () => capturedStillRunning ? captured : [],
    killProcessTree: (pid: number) => {
      stopped.push(pid)
      capturedStillRunning = false
      return true
    },
    sleep: async () => undefined,
    Map,
  })
  vm.runInContext(section(main, 'async function cleanupAppOwnedHelpers(', 'async function ensurePortAvailable('), context)
  context.captured = captured
  const result = await vm.runInContext("cleanupAppOwnedHelpers('quit cleanup', captured)", context)
  assert.deepEqual(stopped, [71])
  assert.equal(result.attempted, 1)
  assert.equal(result.stopped, 1)
  assert.deepEqual(result.remainingCaptured, [])
})


test('full cleanup kills a real worker that ignores SIGTERM after its parent exits', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const workerSource = "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"
  const parentSource = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(workerSource)}], { stdio: ['ignore', 'inherit', 'inherit'] }); setInterval(() => {}, 1000)`
  const child = spawn(process.execPath, ['-e', parentSource], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await once(child.stdout!, 'data')
    const closed = once(child, 'close')
    const context = vm.createContext({
      serverRestartTimer: null, serverProcess: child, process,
      console: { log() {} }, setTimeout, clearTimeout,
    })
    vm.runInContext(section(main, 'function waitForProcessExit(', 'function forceKillSpawnedGateway('), context)
    await vm.runInContext('stopControlServerProcess()', context)
    await closed
    assert.notEqual(child.signalCode, null)
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* Group already exited. */ }
    }
  }
})

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

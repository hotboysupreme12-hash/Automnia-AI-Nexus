import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const require = createRequire(import.meta.url)
const electronPath = require('electron') as string

assert.ok(existsSync(path.join(root, 'dist', 'index.html')), 'Electron E2E requires dist/index.html; run npm run build:client first')
assert.ok(existsSync(path.join(root, 'dist-server', 'index.cjs')), 'Electron E2E requires dist-server/index.cjs; run npm run build:server first')
assert.ok(typeof electronPath === 'string' && electronPath.length > 0, 'Electron binary path must resolve from the electron package')

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not allocate a local TCP port'))
      })
    })
  })
}

function terminateProcessTree(pid: number) {
  if (!Number.isFinite(pid)) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000,
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process already exited; timeout cleanup is best-effort.
    }
  }
}

type ElectronCaseOptions = {
  name: string
  expectedStatus: number
  env?: Record<string, string>
  timeoutMs?: number
  requiredOutput: RegExp[]
}

async function runElectronCase(options: ElectronCaseOptions) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), `dystopai-electron-${options.name}-`))
  const userDataDir = path.join(tempRoot, 'user-data')
  const openclawDir = path.join(tempRoot, 'openclaw')
  const workspaceRoot = path.join(tempRoot, 'workspace')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(openclawDir, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })

  const apiPort = await freePort()
  const frontendPort = await freePort()
  const gatewayPort = await freePort()
  const browserRelayPort = await freePort()
  const timeoutMs = options.timeoutMs ?? 45_000

  const env = {
    ...process.env,
    CONTROL_CENTER_PORT: String(apiPort),
    CONTROL_CENTER_FRONTEND_PORT: String(frontendPort),
    OPENCLAW_GATEWAY_PORT: String(gatewayPort),
    OPENCLAW_BROWSER_RELAY_PORT: String(browserRelayPort),
    CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
    CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
    CONTROL_CENTER_TOKEN: `electron-e2e-${options.name}`,
    DYSTOPAI_ELECTRON_E2E: '1',
    DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '1500',
    DYSTOPAI_ELECTRON_E2E_ASSERT_NAVIGATION: '1',
    DYSTOPAI_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
    DYSTOPAI_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
    DYSTOPAI_PIPE_SERVER_LOGS: '1',
    DYSTOPAI_USER_DATA_DIR: userDataDir,
    OPENCLAW_STATE_DIR: openclawDir,
    OPENCLAW_HOME: openclawDir,
    CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
    ...options.env,
  }

  const child = spawn(electronPath, ['.'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let timedOut = false
  const append = (chunk: Buffer) => {
    output += chunk.toString('utf8')
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)

  const status = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true
      if (child.pid) terminateProcessTree(child.pid)
    }, timeoutMs)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })

  try {
    assert.equal(timedOut, false, `${options.name} Electron E2E timed out after ${timeoutMs}ms\n${output}`)
    assert.equal(status, options.expectedStatus, `${options.name} Electron E2E exited ${status}; expected ${options.expectedStatus}\n${output}`)
    for (const pattern of options.requiredOutput) {
      assert.match(output, pattern, `${options.name} Electron E2E output missing ${pattern}\n${output}`)
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  return output
}

await runElectronCase({
  name: 'startup',
  expectedStatus: 0,
  requiredOutput: [
    /\[dystopai-e2e\] port-cleanup-skipped/,
    /\[dystopai-e2e\] server-ready/,
    /\[dystopai-e2e\] navigation-policy-ok/,
    /\[dystopai-e2e\] auto-quit/,
    /\[dystopai-e2e\] quit-cleanup-complete/,
  ],
})

await runElectronCase({
  name: 'tray-behavior',
  expectedStatus: 0,
  env: {
    DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '10000',
    DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR: '1',
    DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_TRAY_ASSERTIONS: '1',
  },
  requiredOutput: [
    /\[dystopai-e2e\] port-cleanup-skipped/,
    /\[dystopai-e2e\] server-ready/,
    /\[dystopai-e2e\] renderer-load:1/,
    /\[dystopai-e2e\] tray-visible-state-ok/,
    /\[dystopai-e2e\] tray-hide-on-close-ok/,
    /\[dystopai-e2e\] tray-click-restore-ok/,
    /\[dystopai-e2e\] quit-cleanup-complete/,
  ],
})

await runElectronCase({
  name: 'renderer-recovery',
  expectedStatus: 0,
  env: {
    DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '10000',
    DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_EXTERNALS: '1',
    DYSTOPAI_ELECTRON_E2E_ASSERT_RENDERER_RECOVERY: '1',
    DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_RENDERER_ASSERTIONS: '1',
  },
  requiredOutput: [
    /\[dystopai-e2e\] port-cleanup-skipped/,
    /\[dystopai-e2e\] server-ready/,
    /\[dystopai-e2e\] renderer-load:1/,
    /\[dystopai-e2e\] external-open:https:\/\/example\.com\/dystopai-e2e-window-open/,
    /\[dystopai-e2e\] external-open:https:\/\/example\.com\/dystopai-e2e-navigation/,
    /\[dystopai-e2e\] renderer-external-policy-ok/,
    /\[dystopai-e2e\] renderer-crash-requested/,
    /\[dystopai-e2e\] renderer-process-gone:/,
    /\[dystopai-e2e\] renderer-load:2/,
    /\[dystopai-e2e\] renderer-recovered/,
    /\[dystopai-e2e\] quit-cleanup-complete/,
  ],
})

await runElectronCase({
  name: 'startup-failure',
  expectedStatus: 0,
  env: {
    DYSTOPAI_ELECTRON_E2E_FORCE_MISSING_SERVER: '1',
    DYSTOPAI_ELECTRON_E2E_AUTO_QUIT_MS: '0',
  },
  requiredOutput: [
    /\[dystopai-e2e\] port-cleanup-skipped/,
    /\[dystopai-e2e\] DystopAI - Startup Error: Error: E2E forced missing server/,
  ],
})

console.log('electron e2e smoke ok')

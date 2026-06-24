import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const require = createRequire(import.meta.url)

function electronPlatformPath(platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`)
  }
}

function downloadFile(url: string, destination: string, redirects = 0): Promise<void> {
  if (redirects > 5) throw new Error(`Too many redirects while downloading ${url}`)

  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (response) => {
      const statusCode = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume()
        const nextUrl = new URL(location, url).toString()
        void downloadFile(nextUrl, destination, redirects + 1).then(resolve, reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`Download failed ${statusCode} for ${url}`))
        return
      }

      const file = createWriteStream(destination)
      file.on('error', reject)
      file.on('finish', () => file.close((error) => (error ? reject(error) : resolve())))
      response.on('error', reject)
      response.pipe(file)
    })

    request.setTimeout(180_000, () => request.destroy(new Error(`Timed out downloading ${url}`)))
    request.on('error', reject)
  })
}

function sha256File(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

async function ensureElectronBinary() {
  const electronPackageDir = path.dirname(require.resolve('electron/package.json'))
  const platformPath = electronPlatformPath()
  const pathFile = path.join(electronPackageDir, 'path.txt')
  const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronPackageDir, 'dist')
  const executablePath = path.join(distPath, platformPath)

  if (existsSync(pathFile) && existsSync(executablePath)) return
  if (existsSync(executablePath)) {
    writeFileSync(pathFile, platformPath)
    return
  }

  const extract = require('extract-zip') as (zipPath: string, options: { dir: string }) => Promise<void>
  const { version } = require(path.join(electronPackageDir, 'package.json')) as { version: string }
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform
  const arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch
  const artifactName = `electron-v${version}-${platform}-${arch}.zip`
  const checksums = require(path.join(electronPackageDir, 'checksums.json')) as Record<string, string>
  const expectedChecksum = checksums[artifactName]
  assert.ok(expectedChecksum, `Electron checksum is missing for ${artifactName}`)
  const zipPath = path.join(tmpdir(), artifactName)
  const artifactUrl = `https://github.com/electron/electron/releases/download/v${version}/${artifactName}`

  await downloadFile(artifactUrl, zipPath)
  assert.equal(sha256File(zipPath), expectedChecksum, `Electron checksum mismatch for ${artifactName}`)

  rmSync(distPath, { recursive: true, force: true })
  mkdirSync(distPath, { recursive: true })
  await extract(zipPath, { dir: distPath })

  const srcTypeDefPath = path.join(distPath, 'electron.d.ts')
  const targetTypeDefPath = path.join(electronPackageDir, 'electron.d.ts')
  if (existsSync(srcTypeDefPath) && !existsSync(targetTypeDefPath)) {
    renameSync(srcTypeDefPath, targetTypeDefPath)
  }

  writeFileSync(pathFile, platformPath)
  assert.ok(existsSync(executablePath), `Electron binary was not installed at ${executablePath}`)
}

await ensureElectronBinary()
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

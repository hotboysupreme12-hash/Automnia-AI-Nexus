import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const require = createRequire(import.meta.url)
const productName = 'Automnia AI Nexus'
const unpackedRoot = path.join(root, 'release', process.platform === 'win32' ? 'win-unpacked' : 'unsupported')
const launcherPath = path.join(unpackedRoot, `${productName}.exe`)
const resourcesDir = path.join(unpackedRoot, 'resources')
const codexCliRelative = path.join('dist', 'extensions', 'codex', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
const smokeLicenseKey = 'SMOKE-ONLY-NOT-A-REAL-LICENSE'
const smokeProviderKey = 'SMOKE-ONLY-NOT-A-REAL-PROVIDER-KEY'

assert.equal(process.platform, 'win32', 'packaged OpenClaw recovery smoke currently targets the Windows installer runtime')
assert.ok(existsSync(launcherPath), `packaged gateway smoke requires ${launcherPath}; run npm run package:desktop:unsigned first`)

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

function seedHostedCreditsLicense(stateRoot: string) {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (databasePath: string) => {
      exec(sql: string): void
      prepare(sql: string): { run(...params: unknown[]): unknown }
      close(): void
    }
  }
  const ledgerDir = path.join(stateRoot, 'control-center-ledger')
  mkdirSync(ledgerDir, { recursive: true })
  const database = new DatabaseSync(path.join(ledgerDir, 'control-center.sqlite'))
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS control_center_state (
        namespace TEXT NOT NULL,
        state_key TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        source_path TEXT,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (namespace, state_key)
      )
    `)
    const now = new Date().toISOString()
    const license = {
      active: true,
      email: 'packaged-smoke@example.test',
      licenseKey: smokeLicenseKey,
      tier: 'pro',
      mode: 'hosted_credits',
      usagePriority: 'automnia_only',
      subscriptionStatus: 'active',
      creditBalance: 500,
      permanentAccess: false,
      byokAllowed: true,
      activatedAt: now,
      verifiedAt: now,
    }
    database.prepare(`
      INSERT INTO control_center_state
        (namespace, state_key, updated_at, updated_at_ms, source_path, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, state_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        updated_at_ms = excluded.updated_at_ms,
        source_path = excluded.source_path,
        payload_json = excluded.payload_json
    `).run('control-center', 'license:activation', now, Date.now(), null, JSON.stringify(license))
  } finally {
    database.close()
  }
}

function packagedProcessCommandLine(pid: number) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object -ExpandProperty CommandLine`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-packaged-openclaw-gateway-'))
const userDataDir = path.join(tempRoot, 'user-data')
const openclawDir = path.join(tempRoot, 'openclaw')
const workspaceRoot = path.join(tempRoot, 'workspace')
const desktopLogPath = path.join(tempRoot, 'desktop-e2e.log')
const desktopLifecyclePath = path.join(userDataDir, 'diagnostics', 'desktop-lifecycle.jsonl')
const apiPort = await freePort()
const frontendPort = await freePort()
const gatewayPort = await freePort()
const browserRelayPort = await freePort()
const controlToken = 'packaged-openclaw-gateway-smoke-token'

// Preserve a previous provider choice so the license route update changes the
// live OpenClaw route while its first Gateway process is still starting.
mkdirSync(openclawDir, { recursive: true })
writeFileSync(path.join(openclawDir, 'openclaw.json'), `${JSON.stringify({
  models: {
    providers: {
      openai: {
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: smokeProviderKey,
        models: [{ id: 'gpt-4o-mini', name: 'Smoke provider model' }],
      },
    },
  },
  agents: { defaults: { model: { primary: 'openai/gpt-4o-mini' } } },
}, null, 2)}\n`, 'utf8')
seedHostedCreditsLicense(openclawDir)

const env = {
  ...process.env,
  CONTROL_CENTER_PORT: String(apiPort),
  CONTROL_CENTER_FRONTEND_PORT: String(frontendPort),
  CONTROL_CENTER_TOKEN: controlToken,
  CONTROL_CENTER_AUTOSTART_GATEWAY: '1',
  CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '1',
  CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
  OPENCLAW_GATEWAY_PORT: String(gatewayPort),
  OPENCLAW_BROWSER_RELAY_PORT: String(browserRelayPort),
  OPENCLAW_STATE_DIR: openclawDir,
  OPENCLAW_HOME: openclawDir,
  OPENCLAW_CONFIG_PATH: path.join(openclawDir, 'openclaw.json'),
  OPENCLAW_GATEWAY_LOG_PATH: path.join(openclawDir, 'gateway.log'),
  AUTOMNIA_USER_DATA_DIR: userDataDir,
  AUTOMNIA_ELECTRON_E2E: '1',
  AUTOMNIA_ELECTRON_E2E_ALLOW_PARALLEL: '1',
  AUTOMNIA_ELECTRON_E2E_LOG_PATH: desktopLogPath,
  AUTOMNIA_ELECTRON_E2E_SKIP_PORT_CLEANUP: '1',
  AUTOMNIA_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL: '1',
  CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
  CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
  CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
  CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
  CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
  CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
  CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS: '45000',
  HOME: tempRoot,
  USERPROFILE: tempRoot,
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: '',
  TELEGRAM_BOT_TOKEN: '',
  DISCORD_BOT_TOKEN: '',
  SLACK_BOT_TOKEN: '',
  SLACK_APP_TOKEN: '',
  CLAWTALK_API_KEY: '',
}

let output = ''
let launcher: ReturnType<typeof spawn> | null = null

function refreshOutputFromDesktopLog() {
  for (const filePath of [desktopLogPath, desktopLifecyclePath]) {
    if (!existsSync(filePath)) continue
    try {
      output = `${output}\n${readFileSync(filePath, 'utf8')}`.slice(-500_000)
    } catch {
      // The E2E and lifecycle logs are supplemental startup traces.
    }
  }
}

function electronMainPidFromDiagnostics() {
  if (!existsSync(desktopLifecyclePath)) return null
  const rows = readFileSync(desktopLifecyclePath, 'utf8').split(/\r?\n/u).filter(Boolean).reverse()
  for (const row of rows) {
    try {
      const event = JSON.parse(row) as { event?: string; pid?: number }
      if (event.event === 'renderer-presented' && Number.isInteger(event.pid)) return Number(event.pid)
    } catch {
      // Ignore partial diagnostic rows written during app shutdown.
    }
  }
  return null
}

function terminateOwnedElectronProcess(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return
  const expectedPath = path.join(unpackedRoot, 'electron.exe').replaceAll("'", "''")
  const command = [
    `$expected = '${expectedPath}'`,
    `$target = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue`,
    'if ($target -and $target.ExecutablePath -eq $expected) { taskkill.exe /PID $target.ProcessId /T /F | Out-Null }',
  ].join('; ')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
}

function terminateLauncherProcess(launcherProcess: ReturnType<typeof spawn>) {
  if (!launcherProcess.pid) return
  const expectedPath = launcherPath.replaceAll("'", "''")
  const command = [
    `$expected = '${expectedPath}'`,
    `$target = Get-CimInstance Win32_Process -Filter 'ProcessId = ${launcherProcess.pid}' -ErrorAction SilentlyContinue`,
    'if ($target -and $target.ExecutablePath -eq $expected) { taskkill.exe /PID $target.ProcessId /T /F | Out-Null }',
  ].join('; ')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
}

async function waitForGatewayHealth(timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/health`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return await response.json()
    } catch {
      // The Gateway can take a while to migrate a brand-new state directory.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('packaged Gateway did not become healthy before the smoke-test deadline')
}

try {
  launcher = spawn(launcherPath, [], {
    cwd: unpackedRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const appendOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-500_000)
  }
  launcher.stdout.on('data', appendOutput)
  launcher.stderr.on('data', appendOutput)

  const readyDeadline = Date.now() + 45_000
  while (Date.now() < readyDeadline) {
    refreshOutputFromDesktopLog()
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/ready`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) break
    } catch {
      // Keep waiting while Electron stages its writable OpenClaw runtime.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(Date.now() < readyDeadline, 'packaged Control Center API did not become ready')
  assert.ok(existsSync(userDataDir), 'packaged startup must create a missing Automnia user-data directory')
  assert.ok(existsSync(openclawDir), 'packaged startup must create a missing OpenClaw state directory')

  const routeResponse = await fetch(`http://127.0.0.1:${apiPort}/api/license/usage-priority`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usagePriority: 'provider_first' }),
    signal: AbortSignal.timeout(180_000),
  })
  const routeBody = await routeResponse.json().catch(() => null) as { ok?: boolean; data?: { usagePriority?: string }; error?: string } | null
  assert.equal(routeResponse.status, 200, `packaged billing route update failed: ${JSON.stringify(routeBody)}`)
  assert.equal(routeBody?.data?.usagePriority, 'provider_first')

  const healthPayload = await waitForGatewayHealth(90_000) as { ok?: boolean; status?: string }
  assert.equal(healthPayload?.ok, true, 'packaged Gateway /health must report ok after route reconciliation')
  assert.doesNotMatch(output, /Another gateway \(pid \d+\) already owns this state directory/i, 'route reconciliation must not launch a second Gateway during first-start migrations')
  assert.doesNotMatch(output, /OpenClaw route changed but the Gateway did not become ready/i)
  assert.doesNotMatch(output, /EPERM: operation not permitted, open .*resources\\openclaw\\dist\\extensions\\codex/i)

  const runtimeParent = path.join(userDataDir, 'runtimes', 'openclaw')
  const runtimeName = readdirSync(runtimeParent).find((entry) =>
    existsSync(path.join(runtimeParent, entry, 'openclaw.mjs')),
  )
  assert.ok(runtimeName, 'packaged startup must stage a runnable OpenClaw runtime in user data')
  const writableRuntimeRoot = path.join(runtimeParent, runtimeName)
  const writableCodexCli = path.join(writableRuntimeRoot, codexCliRelative)
  assert.ok(existsSync(writableCodexCli), 'staged runtime must include the Codex plugin entry that failed with EPERM')
  const descriptor = openSync(writableCodexCli, 'r+')
  closeSync(descriptor)

  const statusResponse = await fetch(`http://127.0.0.1:${apiPort}/api/openclaw/runtime/status?refresh=1`, {
    headers: { Authorization: `Bearer ${controlToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  const statusBody = await statusResponse.json().catch(() => null) as { data?: { gateway?: { healthy?: boolean; pid?: number | null; logs?: Array<{ message?: string }> } } } | null
  assert.equal(statusResponse.status, 200, 'runtime status must remain available after the Gateway recovery')
  assert.equal(statusBody?.data?.gateway?.healthy, true, 'runtime status must confirm the Gateway is healthy')
  const gatewayLogs = statusBody?.data?.gateway?.logs?.map((entry) => entry.message || '').join('\n') || ''
  assert.doesNotMatch(gatewayLogs, /Another gateway \(pid \d+\) already owns this state directory/i)
  const gatewayPid = Number(statusBody?.data?.gateway?.pid)
  assert.ok(Number.isInteger(gatewayPid) && gatewayPid > 0, 'Gateway startup log must identify the managed process')
  const gatewayCommandLine = packagedProcessCommandLine(gatewayPid)
  assert.ok(gatewayCommandLine.toLowerCase().includes(path.join(runtimeParent, runtimeName).toLowerCase()), 'Gateway must run from the staged per-user OpenClaw runtime')
  assert.ok(!gatewayCommandLine.toLowerCase().includes(path.join(resourcesDir, 'openclaw').toLowerCase()), 'Gateway must not run its writable Codex plugin from immutable packaged resources')
} catch (error) {
  const safeOutput = output
    .replaceAll(smokeLicenseKey, '[redacted test license]')
    .replaceAll(smokeProviderKey, '[redacted test provider key]')
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`${message}\n${safeOutput.slice(-18_000)}`)
} finally {
  if (launcher) {
    terminateOwnedElectronProcess(electronMainPidFromDiagnostics() || 0)
    terminateLauncherProcess(launcher)
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  try {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch (error) {
    console.warn(`[packaged-openclaw-smoke] temporary test state cleanup failed: ${String(error)}`)
  }
}

console.log('packaged OpenClaw gateway recovery smoke ok')

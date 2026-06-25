import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTROL_TOKEN = 'integration-control-token'

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status: number; detail?: unknown }; requestId: string }

type MissionView = {
  id: string
  title: string
  status: string
  idempotencyKey?: string
  scheduler?: {
    status?: string
    jobs?: unknown[]
  }
}

type MissionStartData = {
  deduped: boolean
  idempotencyKey: string | null
  mission: MissionView
}

type MissionStopData = {
  mission: MissionView
  cleanup: {
    attempted: number
    removed: number
    disabled: number
    failed: number
  }
}

type MissionProjectionData = {
  missions: MissionView[]
  projection: {
    missionCount: number
    activeMissionCount: number
  }
}

async function reservePort() {
  const { createServer } = await import('node:net')
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function spawnServer(port: number, workspaceRoot: string, stateDir: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const openClawConfigPath = path.join(stateDir, 'openclaw.json')
  writeFileSync(openClawConfigPath, '{}\n', 'utf-8')

  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONTROL_CENTER_PORT: String(port),
      CONTROL_CENTER_TOKEN: CONTROL_TOKEN,
      CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
      CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
      CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
      CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
      CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
      CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
      CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
      CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
      CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: openClawConfigPath,
      OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
    },
    windowsHide: true,
  })
}

function waitForServer(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Control Center integration server did not start on port ${port}.\n${output.slice(-3000)}`))
    }, 30_000)
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes(`http://127.0.0.1:${port}`)) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`Control Center integration server exited before readiness (code=${code}, signal=${signal}).\n${output.slice(-3000)}`))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function request<T>(
  port: number,
  method: string,
  apiPath: string,
  options: {
    token?: string
    body?: unknown
    rawBody?: string
    origin?: string
    requestId?: string
  } = {},
) {
  const requestId = options.requestId || `int-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({
    'X-Request-Id': requestId,
  })
  if (options.body !== undefined || options.rawBody !== undefined) headers.set('Content-Type', 'application/json')
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.origin) headers.set('Origin', options.origin)
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method,
    headers,
    body: options.rawBody !== undefined ? options.rawBody : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json() as ApiEnvelope<T>
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(payload.requestId, requestId)
  assert.equal(typeof payload.ok, 'boolean')
  return { response, payload, requestId }
}

function assertError<T>(payload: ApiEnvelope<T>, code: string, status: number) {
  assert.equal(payload.ok, false)
  if (payload.ok) return
  assert.equal(payload.error.code, code)
  assert.equal(payload.error.status, status)
  assert.equal(typeof payload.error.message, 'string')
  assert.ok(payload.error.message.length > 0)
}

function assertSuccess<T>(payload: ApiEnvelope<T>): T {
  assert.equal(payload.ok, true)
  assert.ok(payload.ok)
  assert.ok(payload.data && typeof payload.data === 'object')
  return payload.data
}

async function main() {
  const port = await reservePort()
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-api-workspace-'))
  const stateDir = mkdtempSync(path.join(tmpdir(), 'dystopai-api-state-'))
  const homeDir = mkdtempSync(path.join(tmpdir(), 'dystopai-api-home-'))
  const child = spawnServer(port, workspaceRoot, stateDir, homeDir)

  try {
    await waitForServer(child, port)

    const invalidJson = await request(port, 'POST', '/api/auth/login', {
      rawBody: '{"token":',
      requestId: 'integration-invalid-json',
    })
    assert.equal(invalidJson.response.status, 400)
    assertError(invalidJson.payload, 'invalid_json', 400)

    const badLogin = await request(port, 'POST', '/api/auth/login', {
      body: { token: 'wrong-token' },
      requestId: 'integration-bad-login',
    })
    assert.equal(badLogin.response.status, 401)
    assertError(badLogin.payload, 'invalid_token', 401)

    const login = await request<{ token: string; expiresAt: string }>(port, 'POST', '/api/auth/login', {
      body: { token: CONTROL_TOKEN },
      requestId: 'integration-login',
    })
    assert.equal(login.response.status, 200)
    const { token: sessionToken, expiresAt } = assertSuccess(login.payload)
    assert.match(sessionToken, /^[A-Za-z0-9_-]{40,}$/)
    assert.ok(Date.parse(expiresAt) > Date.now(), 'session expiry must be a future timestamp')

    const status = await request<{ authenticated: boolean }>(port, 'GET', '/api/auth/status', {
      token: sessionToken,
      requestId: 'integration-status',
    })
    assert.equal(status.response.status, 200)
    assert.equal(assertSuccess(status.payload).authenticated, true)

    const unauthenticatedProjection = await request(port, 'GET', '/api/missions/projection', {
      requestId: 'integration-missing-auth',
    })
    assert.equal(unauthenticatedProjection.response.status, 401)
    assertError(unauthenticatedProjection.payload, 'auth_required', 401)

    const blockedOrigin = await request(port, 'GET', '/api/missions/projection', {
      token: sessionToken,
      origin: 'https://evil.example',
      requestId: 'integration-blocked-origin',
    })
    assert.equal(blockedOrigin.response.status, 403)
    assertError(blockedOrigin.payload, 'origin_not_allowed', 403)

    const invalidMission = await request(port, 'POST', '/api/missions/start', {
      token: sessionToken,
      body: { title: '' },
      requestId: 'integration-invalid-mission',
    })
    assert.equal(invalidMission.response.status, 400)
    assertError(invalidMission.payload, 'invalid_payload', 400)

    const launchBody = {
      idempotencyKey: 'integration-launch-key-0001',
      title: 'Integration mission',
      brief: 'Verify authenticated mission launch and idempotency under scheduler dry-run.',
      party: ['agent-a'],
      mode: 'continuous',
      missionType: 'planning',
      collaborationMode: 'parallel',
      complexity: 10,
      riskTolerance: 10,
      cadenceSeconds: 60,
    }
    const launched = await request<MissionStartData>(port, 'POST', '/api/missions/start', {
      token: sessionToken,
      body: launchBody,
      requestId: 'integration-mission-launch',
    })
    assert.equal(launched.response.status, 200)
    const launchData = assertSuccess(launched.payload)
    assert.equal(launchData.deduped, false)
    assert.equal(launchData.idempotencyKey, launchBody.idempotencyKey)
    assert.equal(launchData.mission.idempotencyKey, launchBody.idempotencyKey)
    assert.equal(launchData.mission.status, 'active')
    assert.equal(launchData.mission.scheduler?.status, 'waiting')
    assert.deepEqual(launchData.mission.scheduler?.jobs, [])

    const duplicate = await request<MissionStartData>(port, 'POST', '/api/missions/start', {
      token: sessionToken,
      body: launchBody,
      requestId: 'integration-mission-duplicate',
    })
    assert.equal(duplicate.response.status, 200)
    const duplicateData = assertSuccess(duplicate.payload)
    assert.equal(duplicateData.deduped, true)
    assert.equal(duplicateData.mission.id, launchData.mission.id)

    const projection = await request<MissionProjectionData>(port, 'GET', '/api/missions/projection', {
      token: sessionToken,
      requestId: 'integration-projection',
    })
    assert.equal(projection.response.status, 200)
    const projectionData = assertSuccess(projection.payload)
    assert.ok(projectionData.projection.missionCount >= 1)
    assert.ok(projectionData.projection.activeMissionCount >= 1)
    assert.ok(projectionData.missions.some((mission) => mission.id === launchData.mission.id))

    const stopped = await request<MissionStopData>(port, 'POST', '/api/missions/stop', {
      token: sessionToken,
      body: { missionId: launchData.mission.id, reason: 'integration test cleanup' },
      requestId: 'integration-mission-stop',
    })
    assert.equal(stopped.response.status, 200)
    const stopData = assertSuccess(stopped.payload)
    assert.equal(stopData.mission.id, launchData.mission.id)
    assert.equal(stopData.mission.status, 'cancelled')
    assert.equal(stopData.cleanup.attempted, 0)
    assert.equal(stopData.cleanup.failed, 0)

    const stoppedAgain = await request(port, 'POST', '/api/missions/stop', {
      token: sessionToken,
      body: { missionId: launchData.mission.id },
      requestId: 'integration-mission-stop-again',
    })
    assert.equal(stoppedAgain.response.status, 400)
    assertError(stoppedAgain.payload, 'mission_invalid_state', 400)

    const missionRecordLedger = path.join(stateDir, 'control-center-ledger', 'mission-records.jsonl')
    assert.ok(existsSync(missionRecordLedger), 'mission record ledger should be written under the temp OpenClaw state root')
    assert.match(readFileSync(missionRecordLedger, 'utf-8'), new RegExp(launchData.mission.id))

    const logout = await request<{ revoked: boolean }>(port, 'POST', '/api/auth/logout', {
      token: sessionToken,
      requestId: 'integration-logout',
    })
    assert.equal(logout.response.status, 200)
    assert.equal(assertSuccess(logout.payload).revoked, true)

    const loggedOutStatus = await request<{ authenticated: boolean }>(port, 'GET', '/api/auth/status', {
      token: sessionToken,
      requestId: 'integration-status-after-logout',
    })
    assert.equal(loggedOutStatus.response.status, 200)
    assert.equal(assertSuccess(loggedOutStatus.payload).authenticated, false)

    const revokedSessionRequest = await request(port, 'GET', '/api/missions/projection', {
      token: sessionToken,
      requestId: 'integration-revoked-session',
    })
    assert.equal(revokedSessionRequest.response.status, 401)
    assertError(revokedSessionRequest.payload, 'auth_required', 401)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(undefined)
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

await main()
console.log('api integration contract ok')

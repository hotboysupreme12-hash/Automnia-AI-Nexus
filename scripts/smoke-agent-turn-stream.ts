import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTROL_CENTER_STATE_KEYS,
  createRuntimeLedgerStore,
  runtimeLedgerPathsForStateRoot,
} from '../server/state/runtimeLedgerStore'
import { createSseFrameParser } from '../src/utils/sseStream'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeAuthToken = 'agent-turn-stream-smoke-token'

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

function spawnServer(port: number, stateDir: string) {
  const env = {
    ...process.env,
    CONTROL_CENTER_PORT: String(port),
    CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
    CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
    CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
    CONTROL_CENTER_TOKEN: smokeAuthToken,
    CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK: '1',
    CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
    CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
    CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
    CONTROL_CENTER_WORKSPACE_ROOT: root,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: path.join(stateDir, 'openclaw.json'),
    OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
  }

  writeFileSync(env.OPENCLAW_CONFIG_PATH, '{}\n', 'utf-8')

  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env,
    windowsHide: true,
  })
}

function streamHeaders(smokeMode?: '1' | 'abort') {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${smokeAuthToken}`,
    ...(smokeMode ? { 'x-control-center-stream-smoke': smokeMode } : {}),
  }
}

function waitForServer(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Control Center test server did not start on port ${port}.\n${output.slice(-2000)}`))
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
      reject(new Error(`Control Center test server exited before readiness (code=${code}, signal=${signal}).\n${output.slice(-2000)}`))
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

async function readSseFrames(response: Response) {
  assert.ok(response.body, 'Expected streaming response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseFrameParser()
  const frames = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    frames.push(...parser.push(decoder.decode(value, { stream: true })))
  }

  frames.push(...parser.push(decoder.decode()))
  frames.push(...parser.flush())
  return frames
}

async function readFirstSseFrame(response: Response) {
  assert.ok(response.body, 'Expected streaming response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseFrameParser()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return null
      const frames = parser.push(decoder.decode(value, { stream: true }))
      if (frames[0]) return frames[0]
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function assertStreamHeaders(response: Response) {
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream\b/)
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform')
  assert.equal(response.headers.get('x-accel-buffering'), 'no')
}

async function waitForFile(filePath: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function main() {
  const port = await reservePort()
  const stateDir = mkdtempSync(path.join(tmpdir(), 'automnia-stream-smoke-'))
  const runtimeLedgerStore = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(stateDir))
  try {
    const seededAt = '2026-08-11T12:00:00.000Z'
    assert.equal(runtimeLedgerStore.writeControlCenterState(CONTROL_CENTER_STATE_KEYS.licenseActivation, {
      active: true,
      email: 'agent-stream@example.test',
      licenseKey: 'AUT-AGENT-STREAM-0001',
      tier: 'founding_beta_byok',
      mode: 'byok',
      usagePriority: 'provider_first',
      creditBalance: 0,
      creditBalanceUpdatedAt: null,
      activatedAt: seededAt,
      verifiedAt: seededAt,
    }), true, 'agent-turn stream fixture must persist an active license before the server starts')
  } finally {
    runtimeLedgerStore.close()
  }
  const child = spawnServer(port, stateDir)

  try {
    await waitForServer(child, port)
    const response = await fetch(`http://127.0.0.1:${port}/api/openclaw/agent-turn/stream`, {
      method: 'POST',
      headers: streamHeaders(),
      body: JSON.stringify({
        agent: 'invalid agent id',
        message: 'Smoke test the stream contract.',
        forceOpenClawRuntime: true,
      }),
    })

    assertStreamHeaders(response)

    const frames = await readSseFrames(response)
    assert.deepEqual(frames.map((frame) => frame.event), ['error', 'final'])
    const errorPayload = JSON.parse(frames[0].data) as { message?: unknown; failureKind?: unknown }
    const finalPayload = JSON.parse(frames[1].data) as { ok?: unknown; streaming?: { transport?: unknown; liveTokens?: unknown } }

    assert.equal(errorPayload.message, 'Invalid or retired agent id.')
    assert.equal(errorPayload.failureKind, 'validation')
    assert.equal(finalPayload.ok, false)
    assert.equal(finalPayload.streaming?.transport, 'control-center-sse')
    assert.equal(finalPayload.streaming?.liveTokens, false)

    const successResponse = await fetch(`http://127.0.0.1:${port}/api/openclaw/agent-turn/stream`, {
      method: 'POST',
      headers: streamHeaders('1'),
      body: JSON.stringify({
        agent: 'hn-architect',
        message: 'Smoke test the successful stream contract.',
        sessionKey: 'agent:hn-architect:control-center:smoke',
        forceOpenClawRuntime: true,
      }),
    })

    assertStreamHeaders(successResponse)
    const successFrames = await readSseFrames(successResponse)
    assert.deepEqual(successFrames.map((frame) => frame.event), ['status', 'progress', 'delta', 'delta', 'final'])

    const statusPayload = JSON.parse(successFrames[0].data) as { transport?: unknown; liveTokens?: unknown; message?: unknown }
    const progressPayload = JSON.parse(successFrames[1].data) as { transport?: unknown; text?: unknown }
    const firstDelta = JSON.parse(successFrames[2].data) as { text?: unknown; replace?: unknown }
    const replacementDelta = JSON.parse(successFrames[3].data) as { text?: unknown; replace?: unknown }
    const successFinal = JSON.parse(successFrames[4].data) as { ok?: unknown; reply?: unknown; streaming?: { transport?: unknown; liveTokens?: unknown } }

    assert.equal(statusPayload.transport, 'gateway-chat')
    assert.equal(statusPayload.liveTokens, true)
    assert.equal(statusPayload.message, 'Command accepted; opening the Gateway-backed OpenClaw session.')
    assert.equal(progressPayload.transport, 'gateway-chat')
    assert.equal(progressPayload.text, 'Runtime ready; dispatching through Gateway chat.')
    assert.equal(firstDelta.text, 'Draft gateway reply.')
    assert.equal(firstDelta.replace, undefined)
    assert.equal(replacementDelta.text, 'Mock gateway reply complete.')
    assert.equal(replacementDelta.replace, true)
    assert.equal(successFinal.ok, true)
    assert.equal(successFinal.reply, 'Mock gateway reply complete.')
    assert.equal(successFinal.streaming?.transport, 'gateway-chat')
    assert.equal(successFinal.streaming?.liveTokens, true)

    const abortResponse = await fetch(`http://127.0.0.1:${port}/api/openclaw/agent-turn/stream`, {
      method: 'POST',
      headers: streamHeaders('abort'),
      body: JSON.stringify({
        agent: 'hn-architect',
        message: 'Smoke test stream abort handling.',
        sessionKey: 'agent:hn-architect:control-center:smoke-abort',
        forceOpenClawRuntime: true,
      }),
    })

    assertStreamHeaders(abortResponse)
    const abortFrame = await readFirstSseFrame(abortResponse)
    assert.equal(abortFrame?.event, 'status')
    const abortStatus = JSON.parse(abortFrame.data) as {
      agent?: unknown
      message?: unknown
      runId?: unknown
      sessionKey?: unknown
      transport?: unknown
      liveTokens?: unknown
    }
    assert.equal(abortStatus.agent, 'hn-architect')
    assert.equal(abortStatus.transport, 'gateway-chat')
    assert.equal(abortStatus.liveTokens, true)
    assert.equal(abortStatus.message, 'Gateway accepted the live chat run.')
    assert.equal(abortStatus.sessionKey, 'agent:hn-architect:control-center:smoke-abort')
    assert.equal(typeof abortStatus.runId, 'string')
    assert.match(String(abortStatus.runId), /^[0-9a-f-]{36}$/i)

    const abortMarkerPath = path.join(stateDir, 'agent-turn-stream-smoke-abort.json')
    await waitForFile(abortMarkerPath)
    const abortMarker = JSON.parse(readFileSync(abortMarkerPath, 'utf-8')) as {
      aborted?: unknown
      agent?: unknown
      closed?: unknown
      reason?: unknown
      runId?: unknown
      sessionKey?: unknown
      transport?: unknown
    }
    assert.equal(abortMarker.aborted, true)
    assert.equal(abortMarker.closed, true)
    assert.equal(abortMarker.reason, 'client-close')
    assert.equal(abortMarker.agent, 'hn-architect')
    assert.equal(abortMarker.runId, abortStatus.runId)
    assert.equal(abortMarker.sessionKey, 'agent:hn-architect:control-center:smoke-abort')
    assert.equal(abortMarker.transport, 'gateway-chat')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
    rmSync(stateDir, { recursive: true, force: true })
  }
}

await main()
console.log('Agent turn SSE endpoint smoke checks passed.')

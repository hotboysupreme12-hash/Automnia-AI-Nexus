import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

import { createSseFrameParser } from '../src/utils/sseStream'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-redacted-failed-command'
const AGENT_ID = 'hn-commander'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'redacted-failed-command-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'REDACTED_FAILED_COMMAND_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '16-redacted-failed-command-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type LoginPayload = {
  token: string
}

type SseFrameRecord = {
  event: string
  data: string
}

type FailedCommandResult = {
  requestId: string
  sessionKey: string
  events: string[]
  statusMessage: string
  progressText: string
  errorMessage: string
  finalReply: string
  finalStderr: string
  finalOk: boolean
  finalCode: number
  failureKind: string
  transport: string
  liveTokens: boolean
  redactionMarkers: {
    apiKey: boolean
    bearer: boolean
    email: boolean
    phone: boolean
    userProfile: boolean
    cookie: boolean
  }
}

const rawSecretPatterns = [
  /phasek-failed-command-key/i,
  /phase-k-failed-command-bearer/i,
  /phasek\.operator@example\.com/i,
  /555[)\s.-]*010[\s.-]*1280/i,
  /Users\\PhaseK/i,
  /dystopai_session/i,
  /phase-k-failed-command-cookie/i,
]

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

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const configPath = path.join(stateDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n', 'utf8')
  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONTROL_CENTER_PORT: String(port),
      CONTROL_CENTER_TOKEN: CONTROL_TOKEN,
      CONTROL_CENTER_LOGIN_MAX_ATTEMPTS: '3',
      CONTROL_CENTER_LOGIN_BASE_LOCKOUT_MS: '1000',
      CONTROL_CENTER_LOGIN_MAX_LOCKOUT_MS: '4000',
      CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
      CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
      CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
      CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
      CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK: '1',
      CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
      CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
      CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
      CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
      CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_HOME: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function waitForReady(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Control Center exited ${child.exitCode}\n${output.slice(-3000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
      if (response.ok) return output
    } catch {
      // Retry until startup either succeeds or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Control Center did not become ready\n${output.slice(-3000)}`)
}

async function api<T>(
  port: number,
  apiPath: string,
  options: { method?: string; token?: string; body?: unknown; requestId?: string } = {},
) {
  const requestId = options.requestId || `phase-k-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({ 'X-Request-Id': requestId })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json() as ApiEnvelope<T>
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(payload.requestId, requestId)
  if (!response.ok || !payload.ok) {
    const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
    throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
  }
  return payload.data
}

async function login(port: number) {
  const data = await api<LoginPayload>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-redacted-failed-command-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

async function readSseFrames(response: Response) {
  assert.ok(response.body, 'Expected streaming response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseFrameParser()
  const frames: SseFrameRecord[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    frames.push(...parser.push(decoder.decode(value, { stream: true })))
  }

  frames.push(...parser.push(decoder.decode()))
  frames.push(...parser.flush())
  return frames
}

function assertNoRawSecretMaterial(label: string, value: unknown) {
  const encoded = JSON.stringify(value)
  for (const pattern of rawSecretPatterns) {
    assert.doesNotMatch(encoded, pattern, `${label} leaked raw secret pattern ${pattern}`)
  }
}

function redactionMarkers(value: string) {
  return {
    apiKey: /api_key=\[redacted]/i.test(value),
    bearer: /Authorization=\[redacted]/i.test(value),
    email: /\[redacted-email]/i.test(value),
    phone: /\[redacted-phone]/i.test(value),
    userProfile: /%USERPROFILE%\\AppData\\Local\\DystopAI\\secret\.txt/i.test(value),
    cookie: /Cookie=\[redacted]/i.test(value),
  }
}

function assertRedactedCommandFailure(label: string, value: string) {
  assert.match(value, /Gateway transport error: simulated Command Console failure\./, `${label} should preserve the operational failure summary`)
  const markers = redactionMarkers(value)
  for (const [key, present] of Object.entries(markers)) {
    assert.equal(present, true, `${label} should include ${key} redaction marker`)
  }
  assertNoRawSecretMaterial(label, value)
  return markers
}

async function sendFailedCommand(port: number, token: string): Promise<FailedCommandResult> {
  const requestId = 'phase-k-redacted-failed-command-stream'
  const sessionKey = 'phase-k-redacted-failed-command'
  const response = await fetch(`http://127.0.0.1:${port}/api/openclaw/agent-turn/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'x-control-center-stream-smoke': 'failure',
    },
    body: JSON.stringify({
      agent: AGENT_ID,
      message: 'Phase K beta smoke: trigger a failed Command Console turn and verify redaction.',
      thinking: 'off',
      timeoutSeconds: 30,
      promptProfile: 'fast',
      sessionKey,
      forceOpenClawRuntime: true,
    }),
  })
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream\b/)

  const frames = await readSseFrames(response)
  assert.deepEqual(frames.map((frame) => frame.event), ['status', 'progress', 'error', 'final'])

  const statusPayload = JSON.parse(frames[0].data) as { message?: unknown; transport?: unknown; liveTokens?: unknown }
  const progressPayload = JSON.parse(frames[1].data) as { text?: unknown; transport?: unknown }
  const errorPayload = JSON.parse(frames[2].data) as { message?: unknown; failureKind?: unknown; transport?: unknown; liveTokens?: unknown }
  const finalPayload = JSON.parse(frames[3].data) as {
    ok?: unknown
    reply?: unknown
    stderr?: unknown
    code?: unknown
    failureKind?: unknown
    streaming?: { transport?: unknown; liveTokens?: unknown }
  }

  assert.equal(statusPayload.message, 'Command accepted; opening the Gateway-backed OpenClaw session.')
  assert.equal(statusPayload.transport, 'gateway-chat')
  assert.equal(statusPayload.liveTokens, true)
  assert.equal(progressPayload.text, 'Runtime ready; dispatching through Gateway chat.')
  assert.equal(progressPayload.transport, 'gateway-chat')
  assert.equal(finalPayload.ok, false)
  assert.equal(finalPayload.code, 1)
  assert.equal(errorPayload.failureKind, 'gateway_disconnect')
  assert.equal(finalPayload.failureKind, 'gateway_disconnect')
  assert.equal(errorPayload.transport, 'gateway-chat')
  assert.equal(finalPayload.streaming?.transport, 'gateway-chat')
  assert.equal(finalPayload.streaming?.liveTokens, false)

  const errorMessage = String(errorPayload.message || '')
  const finalReply = String(finalPayload.reply || '')
  const finalStderr = String(finalPayload.stderr || '')
  const markers = assertRedactedCommandFailure('SSE error payload', errorMessage)
  assert.deepEqual(assertRedactedCommandFailure('SSE final reply', finalReply), markers)
  assert.deepEqual(assertRedactedCommandFailure('SSE final stderr', finalStderr), markers)
  assertNoRawSecretMaterial('SSE frame collection', frames)

  return {
    requestId,
    sessionKey,
    events: frames.map((frame) => frame.event),
    statusMessage: String(statusPayload.message || ''),
    progressText: String(progressPayload.text || ''),
    errorMessage,
    finalReply,
    finalStderr,
    finalOk: finalPayload.ok === true,
    finalCode: Number(finalPayload.code),
    failureKind: String(finalPayload.failureKind || ''),
    transport: String(finalPayload.streaming?.transport || ''),
    liveTokens: finalPayload.streaming?.liveTokens === true,
    redactionMarkers: markers,
  }
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ])
  if (child.exitCode === null && child.pid && process.platform !== 'win32') child.kill('SIGKILL')
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|sessionToken["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
    || rawSecretPatterns.some((pattern) => pattern.test(encoded))
}

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-redacted-failed-command-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  const startupOutput = await waitForReady(child, port)
  const token = await login(port)
  const failedCommand = await sendFailedCommand(port, token)

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [128],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-redacted-failed-command-smoke',
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
    },
    failedCommand: {
      item: 128,
      streamRoute: '/api/openclaw/agent-turn/stream',
      smokeHeader: 'x-control-center-stream-smoke: failure',
      agentId: AGENT_ID,
      ...failedCommand,
      rawSecretLeakDetected: false,
    },
    uiRenderSmoke: 'npm run smoke:ui asserts the rendered failed Command Console response stays redacted.',
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K redacted failed-command evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=128',
    'blockedItems=none',
    `agentId=${AGENT_ID}`,
    `events=${failedCommand.events.join(',')}`,
    `failureKind=${failedCommand.failureKind}`,
    `transport=${failedCommand.transport}`,
    `redactionMarkers=${Object.entries(failedCommand.redactionMarkers).map(([key, value]) => `${key}:${value}`).join(',')}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Redacted Failed Command Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 128. Complete: triggered a failed Command Console turn and verified redacted error output.',
    '',
    'Evidence:',
    '',
    `- Agent: ${AGENT_ID}`,
    `- Stream events: ${failedCommand.events.join(', ')}`,
    `- Failure kind: ${failedCommand.failureKind}`,
    `- Transport: ${failedCommand.transport}`,
    `- Redaction markers: ${Object.entries(failedCommand.redactionMarkers).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    '- Evidence stores token length, redacted error text, and marker booleans only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K redacted failed-command smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

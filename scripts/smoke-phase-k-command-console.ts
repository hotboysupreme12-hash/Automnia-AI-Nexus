import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

import { createSseFrameParser } from '../src/utils/sseStream'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-command-console'
const AGENT_ID = 'hn-commander'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'command-console-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'COMMAND_CONSOLE_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '07-command-console-smoke.log')
const startedAt = new Date().toISOString()

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type LoginPayload = {
  token: string
}

type CommandConsoleUploadAttachment = {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  kind: 'image' | 'file'
}

type CommandConsoleUploadPayload = {
  attachment?: CommandConsoleUploadAttachment
}

type SseFrameRecord = {
  event: string
  data: string
}

type StreamCommandResult = {
  requestId: string
  sessionKey: string
  events: string[]
  statusMessage: string
  progressText: string
  finalReply: string
  finalOk: boolean
  transport: string
  liveTokens: boolean
  attachmentsSent: number
}

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

function isPathInsideOrSame(baseDir: string, targetPath: string) {
  const base = path.resolve(baseDir)
  const target = path.resolve(targetPath)
  const normalizedBase = process.platform === 'win32' ? base.toLowerCase() : base
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  const baseWithSeparator = normalizedBase.endsWith(path.sep) ? normalizedBase : `${normalizedBase}${path.sep}`
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(baseWithSeparator)
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
    requestId: 'phase-k-command-console-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
}

async function uploadAttachment(port: number, token: string, bytes: Buffer) {
  const requestId = 'phase-k-command-console-upload'
  const response = await fetch(
    `http://127.0.0.1:${port}/api/files/upload?name=${encodeURIComponent('phase-k-command-note.md')}&mimeType=${encodeURIComponent('text/markdown')}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Type': 'text/markdown',
        'X-Request-Id': requestId,
      },
      body: bytes,
    },
  )
  const payload = await response.json() as ApiEnvelope<CommandConsoleUploadPayload>
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(payload.requestId, requestId)
  assert.equal(response.ok, true)
  assert.equal(payload.ok, true)
  assert.ok(payload.data.attachment, 'upload should return an attachment record')
  const attachment = payload.data.attachment
  assert.equal(attachment.name, 'phase-k-command-note.md')
  assert.equal(attachment.mimeType, 'text/markdown')
  assert.equal(attachment.kind, 'file')
  assert.equal(attachment.size, bytes.length)
  return { requestId, attachment }
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

async function sendCommand(
  port: number,
  token: string,
  params: { requestId: string; sessionKey: string; message: string; attachments?: CommandConsoleUploadAttachment[] },
): Promise<StreamCommandResult> {
  const response = await fetch(`http://127.0.0.1:${port}/api/openclaw/agent-turn/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Id': params.requestId,
      'x-control-center-stream-smoke': '1',
    },
    body: JSON.stringify({
      agent: AGENT_ID,
      message: params.message,
      thinking: 'off',
      timeoutSeconds: 30,
      promptProfile: 'fast',
      sessionKey: params.sessionKey,
      attachments: params.attachments,
      forceOpenClawRuntime: true,
    }),
  })
  assert.equal(response.headers.get('x-request-id'), params.requestId)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream\b/)

  const frames = await readSseFrames(response)
  assert.deepEqual(frames.map((frame) => frame.event), ['status', 'progress', 'delta', 'delta', 'final'])

  const statusPayload = JSON.parse(frames[0].data) as { message?: unknown; transport?: unknown; liveTokens?: unknown }
  const progressPayload = JSON.parse(frames[1].data) as { text?: unknown; transport?: unknown }
  const finalPayload = JSON.parse(frames[4].data) as {
    ok?: unknown
    reply?: unknown
    streaming?: { transport?: unknown; liveTokens?: unknown }
  }

  assert.equal(statusPayload.message, 'Command accepted; opening the Gateway-backed OpenClaw session.')
  assert.equal(statusPayload.transport, 'gateway-chat')
  assert.equal(statusPayload.liveTokens, true)
  assert.equal(progressPayload.text, 'Runtime ready; dispatching through Gateway chat.')
  assert.equal(progressPayload.transport, 'gateway-chat')
  assert.equal(finalPayload.ok, true)
  assert.equal(finalPayload.reply, 'Mock gateway reply complete.')
  assert.equal(finalPayload.streaming?.transport, 'gateway-chat')
  assert.equal(finalPayload.streaming?.liveTokens, true)

  return {
    requestId: params.requestId,
    sessionKey: params.sessionKey,
    events: frames.map((frame) => frame.event),
    statusMessage: String(statusPayload.message || ''),
    progressText: String(progressPayload.text || ''),
    finalReply: String(finalPayload.reply || ''),
    finalOk: finalPayload.ok === true,
    transport: String(finalPayload.streaming?.transport || ''),
    liveTokens: finalPayload.streaming?.liveTokens === true,
    attachmentsSent: params.attachments?.length || 0,
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
}

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-command-console-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const uploadRoot = path.join(workspaceRoot, '.openclaw', 'command-console-uploads')
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  const startupOutput = await waitForReady(child, port)
  const token = await login(port)
  const simpleCommand = await sendCommand(port, token, {
    requestId: 'phase-k-command-console-simple',
    sessionKey: 'phase-k-command-console-simple',
    message: 'Phase K beta smoke: confirm a simple command can be sent.',
  })

  const uploadBytes = Buffer.from('# Phase K command attachment\n\nThis is a local beta smoke attachment.\n', 'utf8')
  const uploaded = await uploadAttachment(port, token, uploadBytes)
  assert.ok(isPathInsideOrSame(uploadRoot, uploaded.attachment.path), 'uploaded file should stay inside the command-console upload root')
  assert.ok(isPathInsideOrSame(workspaceRoot, uploaded.attachment.path), 'uploaded file should stay inside the isolated workspace root')

  const attachmentCommand = await sendCommand(port, token, {
    requestId: 'phase-k-command-console-attachment',
    sessionKey: 'phase-k-command-console-attachment',
    message: [
      'Phase K beta smoke: review the attached command note.',
      '',
      'Attached file(s):',
      `- ${uploaded.attachment.name}: ${uploaded.attachment.path}`,
    ].join('\n'),
    attachments: [uploaded.attachment],
  })
  assert.equal(attachmentCommand.attachmentsSent, 1)

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [117, 118],
    blockedItems: [],
    startedAt,
    completedAt,
    mode: 'isolated-control-plane-stream-smoke',
    auth: {
      loginRoute: '/api/auth/login',
      sessionTokenLength: token.length,
    },
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
      uploadRoot,
    },
    simpleCommand: {
      item: 117,
      route: '/api/openclaw/agent-turn/stream',
      agentId: AGENT_ID,
      ...simpleCommand,
    },
    attachmentCommand: {
      item: 118,
      uploadRoute: '/api/files/upload',
      streamRoute: '/api/openclaw/agent-turn/stream',
      agentId: AGENT_ID,
      uploadRequestId: uploaded.requestId,
      attachment: {
        idLength: uploaded.attachment.id.length,
        name: uploaded.attachment.name,
        mimeType: uploaded.attachment.mimeType,
        size: uploaded.attachment.size,
        kind: uploaded.attachment.kind,
        pathIsUnderUploadRoot: isPathInsideOrSame(uploadRoot, uploaded.attachment.path),
        pathIsUnderWorkspaceRoot: isPathInsideOrSame(workspaceRoot, uploaded.attachment.path),
      },
      ...attachmentCommand,
    },
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K command-console evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=117,118',
    'blockedItems=none',
    `agentId=${AGENT_ID}`,
    `simpleEvents=${simpleCommand.events.join(',')}`,
    `attachmentEvents=${attachmentCommand.events.join(',')}`,
    `attachmentName=${uploaded.attachment.name}`,
    `attachmentSize=${uploaded.attachment.size}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Command Console Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta items covered:',
    '',
    '- 117. Complete: sent one simple command through the authenticated Command Console stream route.',
    '- 118. Complete: uploaded one file attachment and sent a command carrying that attachment metadata.',
    '',
    'Evidence:',
    '',
    `- Agent: ${AGENT_ID}`,
    `- Simple command events: ${simpleCommand.events.join(', ')}`,
    `- Attachment command events: ${attachmentCommand.events.join(', ')}`,
    `- Uploaded attachment: ${uploaded.attachment.name} (${uploaded.attachment.size} bytes, ${uploaded.attachment.mimeType})`,
    '- Evidence stores token length and attachment metadata only; no bearer tokens or credential material are written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K command-console smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

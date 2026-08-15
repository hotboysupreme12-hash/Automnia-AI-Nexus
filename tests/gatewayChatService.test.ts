import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGatewayChatService,
  gatewayPayloadChatState,
  type GatewayClientLike,
  type GatewayChatFailureKind,
  type GatewayChatRunStatus,
  type LightweightGatewayClientOptions,
} from '../server/services/gateway/gatewayChatService'

type RequestLog = {
  method: string
  params: unknown
  timeoutMs?: number | null
}

type FinishLog = {
  record: Record<string, unknown>
  status: GatewayChatRunStatus
  output: { stdout?: string; stderr?: string; code?: number; failureKind?: GatewayChatFailureKind }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (predicate()) return
    await delay(5)
  }
  throw new Error('condition was not met before timeout')
}

function createHarness(options: {
  history?: unknown
  messageGet?: unknown
  finalPayload?: Record<string, unknown> | ((runId: string) => Record<string, unknown>)
  suppressFinal?: boolean
  sendError?: Error
  attachments?: Record<string, unknown>[]
  now?: () => number
} = {}) {
  const requests: RequestLog[] = []
  const finishes: FinishLog[] = []
  const logs: Array<{ stream: string; message: string; level?: string }> = []
  let clientOptions: LightweightGatewayClientOptions | null = null
  let stopped = false
  let ensuredGateway = 0
  let healthChecks = 0

  const service = createGatewayChatService({
    gatewayHttpPort: 18789,
    clientVersion: '0.0.6',
    gatewayAgentSessionsEnabled: true,
    gatewayChatClientEnabled: true,
    forceLocalAgentRuntime: false,
    toolsEffectiveDiagnostic: false,
    fastAutoOnSeconds: 60,
    getGatewayAuthEnv: () => ({ OPENCLAW_GATEWAY_TOKEN: 'test-token' }),
    isShuttingDown: () => false,
    ensureGatewayRunning: async () => {
      ensuredGateway += 1
    },
    startGatewayHealthMonitor: () => undefined,
    isGatewayHealthy: async () => {
      healthChecks += 1
      return true
    },
    getOpenClawAgentRunDefaultsReady: () => true,
    ensureOpenclawAgentRunConfigDefaults: async () => undefined,
    gatewayChatAttachmentsFromTurnAttachments: async () => options.attachments || [],
    normalizeFastMode: (value) => value === 'auto' ? 'auto' : value === 'on' ? true : null,
    beginGatewayChatRun: (params) => ({ ...params }),
    finishGatewayChatRun: (record, status, output) => {
      finishes.push({ record, status, output })
    },
    classifyFailureKind: (text, status) => {
      if (status === 'aborted' || /aborted|abort/i.test(text)) return 'aborted'
      if (status === 'timeout' || /timeout|timed out/i.test(text)) return 'timeout'
      if (/gateway/i.test(text)) return 'gateway_disconnect'
      return 'unknown'
    },
    sanitizeUserVisibleRuntimeText: (text) => text.replace(/\[hidden\].*?\[\/hidden\]/gsu, '').trim(),
    redactHiddenReasoningAndSecrets: (text) => text.replace(/\[hidden\].*?\[\/hidden\]/gsu, ''),
    redactSensitiveText: (text) => text.replace(/secret-[a-z0-9-]+/giu, '[redacted]'),
    pushGatewayLog: (stream, message, level) => {
      logs.push({ stream, message, level })
    },
    now: options.now,
    readyTimeoutMs: 100,
    requestTimeoutMs: 100,
    finalExtraTimeoutMs: 25,
    clientFactory: (createdOptions) => {
      clientOptions = createdOptions
      const client: GatewayClientLike = {
        start: () => {
          queueMicrotask(() => createdOptions.onHelloOk?.({ ok: true }))
        },
        stop: () => {
          stopped = true
        },
        request: async (method, params, requestOptions) => {
          requests.push({ method, params, timeoutMs: requestOptions?.timeoutMs })
          if (method === 'chat.send') {
            if (options.sendError) throw options.sendError
            const runId = isRecord(params) && typeof params.idempotencyKey === 'string' ? params.idempotencyKey : ''
            if (!options.suppressFinal) {
              setTimeout(() => {
                createdOptions.onEvent?.({
                  event: 'session.tool',
                  payload: { runId, toolName: 'files.search', state: 'started' },
                })
                createdOptions.onEvent?.({
                  event: 'chat',
                  payload: { runId, state: 'delta', deltaText: 'Live ' },
                })
                createdOptions.onEvent?.({
                  event: 'chat',
                  payload: typeof options.finalPayload === 'function'
                    ? options.finalPayload(runId)
                    : options.finalPayload || { runId, state: 'final', message: { text: 'ok' } },
                })
              }, 0)
            }
            return { accepted: true }
          }
          if (method === 'chat.history') {
            return options.history ?? {
              messages: [
                { role: 'user', text: 'hello' },
                { role: 'assistant', text: 'History final' },
              ],
            }
          }
          if (method === 'chat.message.get') {
            return options.messageGet ?? { ok: true, message: { text: 'Full final' } }
          }
          if (method === 'chat.abort') return { ok: true }
          throw new Error(`unexpected method ${method}`)
        },
      }
      return client
    },
  })

  return {
    service,
    requests,
    finishes,
    logs,
    get clientOptions() {
      return clientOptions
    },
    get stopped() {
      return stopped
    },
    get ensuredGateway() {
      return ensuredGateway
    },
    get healthChecks() {
      return healthChecks
    },
  }
}

test('runTurn sends Gateway chat payloads and uses a visible terminal reply without a history round trip', async () => {
  const harness = createHarness({
    attachments: [{ type: 'image', content: 'abc', mimeType: 'image/png' }],
    finalPayload: (runId) => ({ runId, state: 'final', message: { text: 'Terminal final' } }),
  })
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const stream = harness.service.registerStreamObserver((event, data) => events.push({ event, data }))

  const result = await harness.service.runTurn({
    agentId: 'agent-alpha',
    agentName: 'Marcus',
    message: 'hello',
    attachments: [{ id: 'upload-1' }],
    sessionId: 'session-1',
    requestedSessionKey: 'console',
    thinking: 'low',
    fastMode: 'auto',
    timeoutMs: 100,
    cwd: process.cwd(),
    streamObserverId: stream.observer.id,
  })

  const send = harness.requests.find((request) => request.method === 'chat.send')
  assert.ok(send)
  assert.equal(harness.ensuredGateway, 0, 'healthy Gateway should not be started again')
  assert.equal(harness.healthChecks, 1)
  assert.equal(harness.clientOptions?.clientName, 'gateway-client')
  assert.equal(harness.clientOptions?.mode, 'backend')
  assert.ok(harness.clientOptions?.scopes.includes('operator.talk.secrets'))
  assert.equal(isRecord(send.params) && send.params.sessionKey, 'agent:agent-alpha:console')
  assert.equal(isRecord(send.params) && send.params.message, 'hello')
  assert.equal(isRecord(send.params) && send.params.fastMode, 'auto')
  assert.equal(isRecord(send.params) && send.params.fastAutoOnSeconds, 60)
  assert.equal(isRecord(send.params) && 'deliver' in send.params, false)
  assert.equal(isRecord(send.params) && 'suppressCommandInterpretation' in send.params, false)
  assert.equal(Array.isArray(isRecord(send.params) && send.params.attachments), true)

  assert.equal(harness.requests.some((request) => request.method === 'chat.history'), false)

  const parsed = JSON.parse(result.stdout) as Record<string, unknown>
  assert.equal(result.code, 0)
  assert.equal(result.runtimeTransport, 'gateway-chat')
  assert.equal(parsed.text, 'Terminal final')
  assert.equal(parsed.toolEventCount, 1)
  assert.equal(harness.finishes.at(-1)?.status, 'completed')
  assert.equal(harness.finishes.at(-1)?.output.stdout, 'Terminal final')
  assert.equal(events.some((entry) => entry.event === 'delta' && entry.data.text === 'Live '), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.text === 'Marcus is using files.search.'), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.agentName === 'Marcus'), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && /Gateway agent event/.test(String(entry.data.text))), false)
})

test('runTurn falls back to chat.message.get for placeholder history rows', async () => {
  const harness = createHarness({
    finalPayload: (runId) => ({ runId, state: 'final' }),
    history: {
      messages: [
        {
          role: 'assistant',
          text: '[chat.history omitted: message too large]',
          __openclaw: { id: 'msg-123' },
        },
      ],
    },
    messageGet: { ok: true, message: { text: 'Expanded final text' } },
  })

  const result = await harness.service.runTurn({
    agentId: 'agent-beta',
    message: 'summarize',
    sessionId: 'session-2',
    thinking: 'off',
    // This path performs the send, history lookup, and placeholder expansion
    // round trips; keep enough headroom for the full suite's event-loop load.
    timeoutMs: 1_000,
    cwd: process.cwd(),
  })

  const messageGet = harness.requests.find((request) => request.method === 'chat.message.get')
  assert.ok(messageGet)
  assert.equal(isRecord(messageGet.params) && messageGet.params.messageId, 'msg-123')
  assert.equal(isRecord(messageGet.params) && messageGet.params.maxChars, 1_000_000)
  assert.equal(JSON.parse(result.stdout).text, 'Expanded final text')
  assert.equal(harness.finishes.at(-1)?.status, 'completed')
})

test('runTurn isolates fresh Gateway chat turns from stable requested session keys', async () => {
  const harness = createHarness()

  await harness.service.runTurn({
    agentId: 'agent-fresh',
    message: 'who are you?',
    sessionId: 'fresh-session-1',
    requestedSessionKey: 'control-center:console',
    freshSession: true,
    thinking: 'off',
    timeoutMs: 100,
    cwd: process.cwd(),
  })

  const send = harness.requests.find((request) => request.method === 'chat.send')
  assert.ok(send)
  assert.equal(
    isRecord(send.params) && send.params.sessionKey,
    'agent:agent-fresh:control-center:console:fresh:fresh-session-1',
  )
})

test('runTurn aborts pending Gateway chat when the request signal is cancelled', async () => {
  const harness = createHarness({ suppressFinal: true })
  const controller = new AbortController()
  const pending = harness.service.runTurn({
    agentId: 'agent-gamma',
    message: 'wait',
    sessionId: 'session-3',
    thinking: 'low',
    timeoutMs: 500,
    cwd: process.cwd(),
    signal: controller.signal,
  })

  await waitUntil(() => harness.requests.some((request) => request.method === 'chat.send'))
  controller.abort()

  await assert.rejects(pending, /gateway chat run aborted/)
  assert.ok(harness.requests.some((request) => request.method === 'chat.abort'))
  assert.equal(harness.finishes.at(-1)?.status, 'aborted')
  assert.equal(harness.finishes.at(-1)?.output.failureKind, 'aborted')
})

test('runTurn redacts Gateway send failures before recording or throwing them', async () => {
  const harness = createHarness({
    sendError: new Error('Gateway rejected token secret-send-token'),
  })

  await assert.rejects(
    harness.service.runTurn({
      agentId: 'agent-delta',
      message: 'fail before accept',
      sessionId: 'session-4',
      thinking: 'low',
      timeoutMs: 100,
      cwd: process.cwd(),
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.equal(String((error as Error).message).includes('secret-send-token'), false)
      assert.equal(String((error as Error).message).includes('[redacted]'), true)
      return true
    },
  )

  const finish = harness.finishes.at(-1)
  assert.equal(finish?.status, 'failed')
  assert.equal(finish?.output.stderr?.includes('secret-send-token'), false)
  assert.equal(finish?.output.stderr?.includes('[redacted]'), true)
})

test('runTurn redacts terminal Gateway error payloads returned to callers', async () => {
  const harness = createHarness({
    history: { messages: [] },
    finalPayload: (runId) => ({
      runId,
      state: 'error',
      errorMessage: 'provider failed with secret-final-token',
      details: {
        authorization: 'Bearer secret-authorization-token',
        nested: ['secret-nested-token'],
      },
    }),
  })

  const result = await harness.service.runTurn({
    agentId: 'agent-epsilon',
    message: 'fail after accept',
    sessionId: 'session-5',
    thinking: 'low',
    timeoutMs: 100,
    cwd: process.cwd(),
  })
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>

  assert.equal(result.code, 1)
  assert.equal(result.stderr.includes('secret-final-token'), false)
  assert.equal(result.stderr.includes('[redacted]'), true)
  assert.equal(JSON.stringify(parsed).includes('secret-final-token'), false)
  assert.equal(JSON.stringify(parsed).includes('secret-authorization-token'), false)
  assert.equal(JSON.stringify(parsed).includes('secret-nested-token'), false)
  assert.equal(harness.finishes.at(-1)?.output.stderr?.includes('secret-final-token'), false)
})

test('abortStaleWaiters aborts aged Gateway chat runs and records recovery evidence', async () => {
  let now = 1_000
  const harness = createHarness({
    suppressFinal: true,
    now: () => now,
  })
  const pending = harness.service.runTurn({
    agentId: 'agent-zeta',
    message: 'hang',
    sessionId: 'session-6',
    thinking: 'low',
    timeoutMs: 500,
    cwd: process.cwd(),
  })

  await waitUntil(() => harness.requests.some((request) => request.method === 'chat.send'))
  now = 32_000
  const recovery = harness.service.abortStaleWaiters(30_000, 'operator stale cleanup')

  await assert.rejects(pending, /operator/)
  assert.equal(recovery.aborted.length, 1)
  assert.equal(recovery.minAgeMs, 30_000)
  assert.ok(harness.requests.some((request) => request.method === 'chat.abort'))
  assert.equal(harness.service.runtimeSnapshot(now).recentRecoveries[0]?.reason, 'operator stale cleanup')
  assert.equal(harness.finishes.at(-1)?.status, 'aborted')
})

test('abortRun closes an active Gateway waiter for an explicit operator stop', async () => {
  const harness = createHarness({ suppressFinal: true })
  const pending = harness.service.runTurn({
    agentId: 'agent-stop',
    message: 'stop me',
    sessionId: 'session-stop',
    thinking: 'low',
    timeoutMs: 500,
    cwd: process.cwd(),
  })

  await waitUntil(() => harness.requests.some((request) => request.method === 'chat.send'))
  const send = harness.requests.find((request) => request.method === 'chat.send')
  const runId = isRecord(send?.params) && typeof send.params.idempotencyKey === 'string'
    ? send.params.idempotencyKey
    : ''
  assert.equal(runId.length > 0, true)
  assert.equal(harness.service.abortRun(runId, 'operator button stop'), true)

  await assert.rejects(pending, /stopped by operator/)
  assert.ok(harness.requests.some((request) => request.method === 'chat.abort'))
  assert.equal(harness.service.runtimeSnapshot().activeRuns, 0)
  assert.equal(harness.finishes.at(-1)?.status, 'aborted')
})

test('Gateway disconnect interrupts the visible run and clears its active record', async () => {
  const harness = createHarness({ suppressFinal: true })
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const stream = harness.service.registerStreamObserver((event, data) => events.push({ event, data }))
  const pending = harness.service.runTurn({
    agentId: 'agent-disconnect',
    message: 'disconnect me',
    sessionId: 'session-disconnect',
    thinking: 'low',
    timeoutMs: 500,
    cwd: process.cwd(),
    streamObserverId: stream.observer.id,
  })

  await waitUntil(() => harness.requests.some((request) => request.method === 'chat.send'))
  harness.clientOptions?.onClose?.(1006, 'gateway starting')

  await assert.rejects(pending, /gateway client disconnected: gateway starting/)
  assert.equal(harness.service.runtimeSnapshot().activeRuns, 0)
  assert.equal(harness.finishes.at(-1)?.status, 'failed')
  assert.equal(events.some((entry) => entry.event === 'status' && entry.data.type === 'interrupted'), true)
  assert.match(String(events.find((entry) => entry.event === 'status' && entry.data.type === 'interrupted')?.data.message), /retry only after Gateway is healthy/)
})

test('gatewayPayloadChatState normalizes Gateway terminal and delta states', () => {
  assert.equal(gatewayPayloadChatState({ state: 'chat.delta' }), 'delta')
  assert.equal(gatewayPayloadChatState({ status: 'completed' }), 'final')
  assert.equal(gatewayPayloadChatState({ phase: 'failed' }), 'error')
  assert.equal(gatewayPayloadChatState({ canceled: true }), 'aborted')
  assert.equal(gatewayPayloadChatState({ status: 'working' }), '')
})

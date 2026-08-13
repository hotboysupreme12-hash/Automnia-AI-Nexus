import { randomUUID } from 'node:crypto'

export type GatewayChatFailureKind =
  | 'timeout'
  | 'rate_limit'
  | 'gateway_disconnect'
  | 'runtime_unavailable'
  | 'auth_expired'
  | 'auth_missing'
  | 'plugin_loader_error'
  | 'stale_lock'
  | 'disk_low'
  | 'provider_unsupported'
  | 'sandbox_unavailable'
  | 'network_error'
  | 'process_error'
  | 'aborted'
  | 'interrupted'
  | 'unknown'

export type GatewayChatRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted'
export type GatewayChatThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type GatewayChatFastModePreference = 'auto' | 'on' | 'off'
export type GatewayChatOpenClawFastMode = 'auto' | true

export type GatewayChatTurnResult = {
  stdout: string
  stderr: string
  code: number
  runtimeTransport: 'gateway-chat'
}

export type GatewayClientLike = {
  start: () => void
  stop: () => void
  request: (method: string, params?: unknown, options?: { timeoutMs?: number | null; signal?: AbortSignal }) => Promise<unknown>
}

export type LightweightGatewayClientOptions = {
  url: string
  token?: string
  password?: string
  clientName: string
  clientDisplayName: string
  clientVersion: string
  platform: string
  mode: string
  role: string
  scopes: string[]
  caps: string[]
  deviceIdentity?: null | Record<string, unknown>
  instanceId: string
  minProtocol: number
  maxProtocol: number
  requestTimeoutMs: number
  preauthHandshakeTimeoutMs?: number
  onHelloOk?: (hello: unknown) => void
  onEvent?: (evt: { event?: unknown; payload?: unknown; seq?: unknown; stateVersion?: unknown }) => void
  onConnectError?: (error: Error & { gatewayCode?: string; details?: unknown; retryable?: boolean; retryAfterMs?: number }) => void
  onClose?: (code: number, reason: string) => void
  onReconnectPaused?: (info: unknown) => void
  onGap?: (info: { expected: number; received: number }) => void
}

type LightweightGatewayPendingRequest = {
  method: string
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  onAbort?: () => void
}

export type GatewayClientState = {
  client: GatewayClientLike
  ready: boolean
  readyPromise: Promise<void>
  resolveReady?: () => void
  rejectReady?: (error: Error) => void
  lastHello?: unknown
  generation: number
}

export type GatewayChatStreamEmitter = (event: string, data: Record<string, unknown>) => void

export type GatewayChatStreamObserver = {
  id: string
  emit: GatewayChatStreamEmitter
  createdAt: number
  textStreamed: boolean
  closed: boolean
}

export type GatewayChatRecoveryEvent = {
  id: string
  timestamp: string
  reason: string
  minAgeMs: number
  abortedCount: number
  skippedCount: number
  aborted: Array<{ runId: string; ageMs: number; hadStreamObserver: boolean }>
}

type GatewayChatRunWaiter = {
  runId: string
  sessionKey: string
  startedAt: number
  toolEvents: unknown[]
  streamObserverId?: string
  streamedText: string
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type GatewayHistoryReply = {
  text: string
  messageId: string
  placeholder: boolean
}

export type GatewayChatServiceOptions<RunRecord> = {
  gatewayHttpPort: number
  clientVersion: string
  gatewayAgentSessionsEnabled: boolean
  gatewayChatClientEnabled: boolean
  forceLocalAgentRuntime: boolean
  toolsEffectiveDiagnostic: boolean
  fastAutoOnSeconds: number
  getGatewayAuthEnv: () => Record<string, string>
  isShuttingDown: () => boolean
  ensureGatewayRunning: () => Promise<void>
  startGatewayHealthMonitor: () => void
  isGatewayHealthy: () => Promise<boolean>
  getOpenClawAgentRunDefaultsReady: () => boolean
  ensureOpenclawAgentRunConfigDefaults: () => Promise<void>
  gatewayChatAttachmentsFromTurnAttachments: (attachments: unknown[] | undefined) => Promise<Record<string, unknown>[]>
  normalizeFastMode: (value: GatewayChatFastModePreference | undefined) => GatewayChatOpenClawFastMode | null
  beginGatewayChatRun: (params: {
    runId: string
    agentId: string
    sessionId: string
    sessionKey: string
    cwd: string
    timeoutMs: number
  }) => RunRecord
  finishGatewayChatRun: (
    record: RunRecord,
    status: GatewayChatRunStatus,
    output: { stdout?: string; stderr?: string; code?: number; failureKind?: GatewayChatFailureKind },
  ) => void
  classifyFailureKind: (text: string, status?: GatewayChatRunStatus | null) => GatewayChatFailureKind | undefined
  sanitizeUserVisibleRuntimeText: (text: string) => string
  redactHiddenReasoningAndSecrets: (text: string) => string
  redactSensitiveText: (text: string) => string
  pushGatewayLog: (stream: 'stdout' | 'stderr' | 'lifecycle' | 'gateway' | 'channel', message: string, level?: string) => void
  log?: Pick<typeof console, 'log' | 'warn'>
  clientFactory?: (options: LightweightGatewayClientOptions) => GatewayClientLike
  now?: () => number
  connectTimeoutMs?: number
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  finalExtraTimeoutMs?: number
  historyLimit?: number
  historyMaxChars?: number
  messageGetMaxChars?: number
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimText(value: string, max: number) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function gatewayFrameText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf-8')
  if (Buffer.isBuffer(data)) return data.toString('utf-8')
  return String(data || '')
}

function gatewayRequestError(error: unknown): Error & { gatewayCode?: string; details?: unknown; retryable?: boolean; retryAfterMs?: number } {
  const record = isLooseRecord(error) ? error : {}
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : typeof error === 'string'
      ? error
      : 'Gateway request failed'
  const next = new Error(message) as Error & { gatewayCode?: string; details?: unknown; retryable?: boolean; retryAfterMs?: number }
  if (typeof record.code === 'string') next.gatewayCode = record.code
  if (record.details !== undefined) next.details = record.details
  if (typeof record.retryable === 'boolean') next.retryable = record.retryable
  if (typeof record.retryAfterMs === 'number') next.retryAfterMs = record.retryAfterMs
  return next
}

type LightweightWebSocket = {
  readyState: number
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data?: unknown }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void
  send(data: string): void
  close(): void
}

type LightweightWebSocketConstructor = new (url: string) => LightweightWebSocket

export function gatewayChatAbortError(message = 'gateway chat run aborted') {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

export class LightweightGatewayClient implements GatewayClientLike {
  private ws: LightweightWebSocket | null = null
  private closed = false
  private pending = new Map<string, LightweightGatewayPendingRequest>()
  private lastSeq: number | null = null
  private connectRetryTimer: NodeJS.Timeout | null = null
  private readonly options: LightweightGatewayClientOptions

  constructor(options: LightweightGatewayClientOptions) {
    this.options = options
  }

  start(): void {
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: LightweightWebSocketConstructor }).WebSocket
    if (!WebSocketCtor) {
      this.options.onConnectError?.(new Error('global WebSocket is not available in this Node runtime'))
      return
    }
    this.closed = false
    const ws = new WebSocketCtor(this.options.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      this.sendConnect()
    })
    ws.addEventListener('message', (event: { data?: unknown }) => {
      this.handleFrameData(event.data)
    })
    ws.addEventListener('error', (event: unknown) => {
      this.options.onConnectError?.(new Error(`gateway websocket error: ${String(event)}`))
    })
    ws.addEventListener('close', (event: { code?: number; reason?: string }) => {
      const code = typeof event.code === 'number' ? event.code : 0
      const reason = typeof event.reason === 'string' ? event.reason : ''
      this.rejectAll(new Error(`gateway client disconnected: ${reason || `code ${code}`}`))
      if (!this.closed) this.options.onClose?.(code, reason)
    })
  }

  stop(): void {
    this.closed = true
    if (this.connectRetryTimer) {
      clearTimeout(this.connectRetryTimer)
      this.connectRetryTimer = null
    }
    this.rejectAll(gatewayChatAbortError('gateway client stopped'))
    try {
      this.ws?.close?.()
    } catch {
      // Best-effort shutdown.
    }
    this.ws = null
  }

  request(method: string, params?: unknown, options: { timeoutMs?: number | null; signal?: AbortSignal } = {}): Promise<unknown> {
    if (options.signal?.aborted) return Promise.reject(gatewayChatAbortError('gateway request aborted'))
    const id = randomUUID()
    const timeoutMs = options.timeoutMs === null ? this.options.requestTimeoutMs : options.timeoutMs || this.options.requestTimeoutMs
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(Object.assign(new Error(`gateway request timed out: ${method}`), { name: 'TimeoutError' }))
      }, timeoutMs)
      timer.unref?.()
      const pending: LightweightGatewayPendingRequest = { method, resolve, reject, timer, signal: options.signal }
      if (options.signal) {
        pending.onAbort = () => {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(gatewayChatAbortError(`gateway request aborted: ${method}`))
        }
        options.signal.addEventListener('abort', pending.onAbort, { once: true })
      }
      this.pending.set(id, pending)
      try {
        this.sendFrame({ type: 'req', id, method, ...(params === undefined ? {} : { params }) })
      } catch (error) {
        this.pending.delete(id)
        this.clearPendingRequest(pending)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private sendConnect() {
    if (this.closed) return
    this.request('connect', {
      minProtocol: this.options.minProtocol,
      maxProtocol: this.options.maxProtocol,
      client: {
        id: this.options.clientName,
        displayName: this.options.clientDisplayName,
        version: this.options.clientVersion,
        platform: this.options.platform,
        mode: this.options.mode,
        instanceId: this.options.instanceId,
      },
      role: this.options.role,
      scopes: this.options.scopes,
      caps: this.options.caps,
      commands: [],
      permissions: {},
      auth: {
        ...(this.options.token ? { token: this.options.token } : {}),
        ...(this.options.password ? { password: this.options.password } : {}),
      },
      locale: 'en-US',
      userAgent: `automnia-ai-nexus/${this.options.clientVersion}`,
    }, { timeoutMs: this.options.requestTimeoutMs }).catch((error) => {
      const retryAfterMs = typeof (error as Error & { retryAfterMs?: unknown }).retryAfterMs === 'number'
        ? Math.max(250, Math.min(10_000, Number((error as Error & { retryAfterMs?: number }).retryAfterMs)))
        : 0
      if (this.closed) return
      if ((error as Error & { retryable?: boolean }).retryable && retryAfterMs > 0) {
        if (this.connectRetryTimer) clearTimeout(this.connectRetryTimer)
        this.connectRetryTimer = setTimeout(() => {
          this.connectRetryTimer = null
          this.sendConnect()
        }, retryAfterMs)
        this.connectRetryTimer.unref?.()
        return
      }
      this.options.onConnectError?.(error as Error)
    })
  }

  private handleFrameData(data: unknown) {
    const text = gatewayFrameText(data)
    if (!text.trim()) return
    let frame: unknown
    try {
      frame = JSON.parse(text)
    } catch {
      this.options.onConnectError?.(new Error('Gateway sent a non-JSON frame'))
      return
    }
    if (!isLooseRecord(frame)) return
    if (frame.type === 'event') {
      this.handleEventFrame(frame)
      return
    }
    if (frame.type === 'res') {
      this.handleResponseFrame(frame)
    }
  }

  private handleEventFrame(frame: Record<string, unknown>) {
    const seq = typeof frame.seq === 'number' ? frame.seq : null
    if (seq !== null) {
      if (this.lastSeq !== null && seq !== this.lastSeq + 1) this.options.onGap?.({ expected: this.lastSeq + 1, received: seq })
      this.lastSeq = seq
    }
    this.options.onEvent?.({
      event: frame.event,
      payload: frame.payload,
      seq: frame.seq,
      stateVersion: frame.stateVersion,
    })
  }

  private handleResponseFrame(frame: Record<string, unknown>) {
    const id = typeof frame.id === 'string' ? frame.id : ''
    const pending = id ? this.pending.get(id) : null
    if (!pending) return
    this.pending.delete(id)
    this.clearPendingRequest(pending)
    if (frame.ok === true) {
      if (pending.method === 'connect') {
        this.options.onHelloOk?.(frame.payload)
      }
      pending.resolve(frame.payload)
      return
    }
    const error = gatewayRequestError(frame.error)
    pending.reject(error)
  }

  private sendFrame(frame: Record<string, unknown>) {
    if (this.closed) throw gatewayChatAbortError('gateway client is closed')
    if (!this.ws || this.ws.readyState !== 1) throw new Error('gateway websocket is not open')
    this.ws.send(JSON.stringify(frame))
  }

  private clearPendingRequest(pending: LightweightGatewayPendingRequest) {
    clearTimeout(pending.timer)
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      this.clearPendingRequest(pending)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function isRetryableGatewayStartupUnavailableError(error: unknown) {
  if (!isLooseRecord(error)) return false
  const code = typeof error.gatewayCode === 'string' ? error.gatewayCode : error.code
  const details = isLooseRecord(error.details) ? error.details : null
  return code === 'UNAVAILABLE' && error.retryable === true && details?.reason === 'startup-sidecars'
}

export function gatewayPayloadChatState(payload: Record<string, unknown>): 'delta' | 'final' | 'error' | 'aborted' | '' {
  const candidates = [
    payload.state,
    payload.status,
    payload.type,
    payload.phase,
    payload.event,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())
  for (const value of candidates) {
    if (value === 'delta' || value.endsWith('.delta')) return 'delta'
    if (value === 'final' || value === 'done' || value === 'complete' || value === 'completed' || value === 'finished' || value === 'success' || value === 'ok' || value.endsWith('.final')) return 'final'
    if (value === 'error' || value === 'failed' || value === 'failure' || value.endsWith('.error') || value.endsWith('.failed')) return 'error'
    if (value === 'aborted' || value === 'abort' || value === 'cancelled' || value === 'canceled' || value.endsWith('.aborted')) return 'aborted'
  }
  if (payload.done === true || payload.completed === true) return 'final'
  if (payload.aborted === true || payload.cancelled === true || payload.canceled === true) return 'aborted'
  if (payload.error || payload.errorMessage) return 'error'
  return ''
}

function gatewayPayloadRunId(payload: unknown): string {
  if (!isLooseRecord(payload)) return ''
  const runId = payload.runId
  if (typeof runId === 'string' && runId.trim()) return runId.trim()
  const clientRunId = payload.clientRunId
  return typeof clientRunId === 'string' && clientRunId.trim() ? clientRunId.trim() : ''
}

function gatewayChatMessageText(message: unknown): string {
  if (typeof message === 'string') return message.trim()
  if (!isLooseRecord(message)) return ''
  const directText = typeof message.text === 'string' ? message.text.trim() : ''
  if (directText) return directText
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (!isLooseRecord(block)) return ''
      if (typeof block.text === 'string') return block.text
      return ''
    })
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function gatewayChatMessageId(message: unknown): string {
  if (!isLooseRecord(message)) return ''
  const metadata = isLooseRecord(message.__openclaw) ? message.__openclaw : null
  const id = metadata?.id
  return typeof id === 'string' && id.trim() ? id.trim() : ''
}

function isGatewayHistoryPlaceholder(text: string) {
  return /\[(?:chat\.history|sessions_history) omitted: message too large\]/i.test(text.trim())
}

function isVisibleGatewayAssistantText(text: string) {
  const clean = text.trim()
  return Boolean(clean) && !/^(?:NO_REPLY|no_reply|HEARTBEAT_OK)$/u.test(clean)
}

function isGatewayProtocolStatusText(text: string) {
  return /^(?:ok|started|in_flight|done|complete|completed|success|finished)$/iu.test(text.trim())
}

function isSensitiveGatewayDiagnosticKey(key: string) {
  return /(?:token|authorization|api[-_]?key|secret|cookie|code|verifier|password|credential)/iu.test(key)
}

export function createGatewayChatService<RunRecord>(options: GatewayChatServiceOptions<RunRecord>) {
  const log = options.log || console
  const nowMs = options.now || (() => Date.now())
  const connectTimeoutMs = options.connectTimeoutMs ?? 20_000
  const readyTimeoutMs = options.readyTimeoutMs ?? Math.max(
    connectTimeoutMs,
    Math.min(
      120_000,
      Number.isFinite(Number(process.env.CONTROL_CENTER_GATEWAY_CLIENT_READY_TIMEOUT_MS))
        ? Number(process.env.CONTROL_CENTER_GATEWAY_CLIENT_READY_TIMEOUT_MS)
        : 45_000,
    ),
  )
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  const finalExtraTimeoutMs = options.finalExtraTimeoutMs ?? 20_000
  // A terminal chat event normally already carries the visible reply. When it
  // does not, the last two transcript entries are enough to recover the final
  // assistant message without serializing the whole recent conversation.
  const historyLimit = options.historyLimit ?? 2
  const historyMaxChars = options.historyMaxChars ?? 12_000
  const messageGetMaxChars = options.messageGetMaxChars ?? 1_000_000

  let gatewayClientState: GatewayClientState | null = null
  let gatewayClientConnectPromise: Promise<GatewayClientState> | null = null
  let gatewayClientGeneration = 0
  let prewarmPromise: Promise<void> | null = null
  let prewarmTimer: NodeJS.Timeout | null = null
  let prewarmedAt = ''

  const gatewayChatRunWaiters = new Map<string, GatewayChatRunWaiter>()
  const gatewayChatStreamObservers = new Map<string, GatewayChatStreamObserver>()
  const gatewayChatRecoveryEvents: GatewayChatRecoveryEvent[] = []

  function redactedGatewayErrorText(error: unknown, fallback = 'gateway chat failed') {
    const raw = error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error || '')
    return options.redactSensitiveText(raw.trim() || fallback)
  }

  function redactedGatewayError(error: unknown, fallback = 'gateway chat failed') {
    const message = redactedGatewayErrorText(error, fallback)
    const next = new Error(message)
    if (error instanceof Error && error.name) next.name = error.name
    return next
  }

  function redactedGatewayDiagnosticValue(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return options.redactSensitiveText(value)
    if (!value || typeof value !== 'object' || depth > 8) return value
    if (Array.isArray(value)) return value.map((entry) => redactedGatewayDiagnosticValue(entry, depth + 1))
    if (!isLooseRecord(value)) return value
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      next[key] = isSensitiveGatewayDiagnosticKey(key)
        ? '[redacted]'
        : redactedGatewayDiagnosticValue(entry, depth + 1)
    }
    return next
  }

  function controlCenterGatewayUrl() {
    return `ws://127.0.0.1:${options.gatewayHttpPort}`
  }

  function recordGatewayChatRecoveryEvent(event: Omit<GatewayChatRecoveryEvent, 'id' | 'timestamp'>) {
    gatewayChatRecoveryEvents.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    })
    gatewayChatRecoveryEvents.splice(8)
  }

  function runtimeSnapshot(now = nowMs()) {
    let oldestRunAgeMs = 0
    for (const waiter of gatewayChatRunWaiters.values()) {
      oldestRunAgeMs = Math.max(oldestRunAgeMs, Math.max(0, now - waiter.startedAt))
    }

    let activeObservers = 0
    let oldestObserverAgeMs = 0
    for (const observer of gatewayChatStreamObservers.values()) {
      if (observer.closed) continue
      activeObservers += 1
      oldestObserverAgeMs = Math.max(oldestObserverAgeMs, Math.max(0, now - observer.createdAt))
    }

    return {
      activeRuns: gatewayChatRunWaiters.size,
      activeObservers,
      oldestRunAgeMs,
      oldestObserverAgeMs,
      recentRecoveries: gatewayChatRecoveryEvents.slice(0, 5),
    }
  }

  function streamObserver(id?: string) {
    if (!id) return null
    const observer = gatewayChatStreamObservers.get(id)
    return observer && !observer.closed ? observer : null
  }

  function requestGatewayChatAbort(
    client: GatewayClientLike,
    sessionKey: string,
    runId: string,
    reason: string,
  ) {
    const cleanReason = reason.trim() || 'unknown'
    options.pushGatewayLog('lifecycle', `Gateway chat abort requested for run ${runId} (${cleanReason}).`)
    void client
      .request('chat.abort', { sessionKey, runId }, { timeoutMs: 2_000 })
      .catch((error) =>
        options.pushGatewayLog(
          'stderr',
          `Gateway chat abort failed for run ${runId}: ${options.redactSensitiveText(error instanceof Error ? error.message : String(error))}`,
        ),
      )
  }

  function requestAbortIfClient(sessionKey: string, runId: string, reason: string) {
    const client = gatewayClientState?.client
    if (!client) return false
    requestGatewayChatAbort(client, sessionKey, runId, reason)
    return true
  }

  function abortStaleWaiters(minAgeMs: number, reason: string) {
    const now = nowMs()
    const minAge = Math.max(30_000, Math.min(24 * 60 * 60_000, Math.round(minAgeMs)))
    const client = gatewayClientState?.client
    const aborted: Array<{ runId: string; ageMs: number; hadStreamObserver: boolean }> = []

    for (const waiter of Array.from(gatewayChatRunWaiters.values())) {
      const ageMs = Math.max(0, now - waiter.startedAt)
      if (ageMs < minAge) continue

      gatewayChatRunWaiters.delete(waiter.runId)
      clearTimeout(waiter.timer)
      if (client) {
        requestGatewayChatAbort(client, waiter.sessionKey, waiter.runId, reason)
      } else {
        options.pushGatewayLog('stderr', `Gateway chat abort requested for run ${waiter.runId}, but the gateway client is unavailable.`)
      }
      const observer = streamObserver(waiter.streamObserverId)
      observer?.emit('status', {
        type: 'aborted',
        runId: waiter.runId,
        message: `Gateway chat run aborted after ${Math.round(ageMs / 1000)}s.`,
      })
      waiter.reject(Object.assign(new Error(`gateway chat run aborted by operator after ${ageMs}ms`), { name: 'AbortError' }))
      aborted.push({
        runId: waiter.runId,
        ageMs,
        hadStreamObserver: Boolean(waiter.streamObserverId),
      })
    }

    if (aborted.length) {
      options.pushGatewayLog('lifecycle', `aborted ${aborted.length} stale gateway chat run(s) older than ${minAge}ms`)
    }
    recordGatewayChatRecoveryEvent({
      reason,
      minAgeMs: minAge,
      abortedCount: aborted.length,
      skippedCount: gatewayChatRunWaiters.size,
      aborted,
    })

    return {
      minAgeMs: minAge,
      aborted,
      skipped: gatewayChatRunWaiters.size,
      chat: runtimeSnapshot(),
    }
  }

  function registerStreamObserver(emit: GatewayChatStreamEmitter, signal?: AbortSignal) {
    const observer: GatewayChatStreamObserver = {
      id: randomUUID(),
      emit,
      createdAt: nowMs(),
      textStreamed: false,
      closed: false,
    }
    gatewayChatStreamObservers.set(observer.id, observer)
    const dispose = () => {
      observer.closed = true
      gatewayChatStreamObservers.delete(observer.id)
      signal?.removeEventListener('abort', dispose)
    }
    signal?.addEventListener('abort', dispose, { once: true })
    return { observer, dispose }
  }

  function gatewayStreamPayload(waiter: GatewayChatRunWaiter, eventName: string, payload: Record<string, unknown>) {
    const state = typeof payload.state === 'string' ? payload.state.trim() : ''
    const phase = typeof payload.phase === 'string' ? payload.phase.trim() : ''
    const status = typeof payload.status === 'string' ? payload.status.trim() : ''
    const stream = typeof payload.stream === 'string' ? payload.stream.trim() : ''
    const toolName = typeof payload.toolName === 'string'
      ? payload.toolName.trim()
      : typeof payload.tool === 'string'
        ? payload.tool.trim()
        : typeof payload.name === 'string'
          ? payload.name.trim()
          : ''
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = payload[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }
    const compactValue = (value: unknown, max = 360) => {
      const redacted = redactedGatewayDiagnosticValue(value)
      const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted)
      return text ? trimText(text, max) : ''
    }
    const toolAction = pick('action', 'operation', 'verb')
    const command = pick('command', 'cmd', 'commandLine', 'shellCommand')
    const toolInput = compactValue(payload.args ?? payload.arguments ?? payload.input ?? payload.params)
    const toolOutput = compactValue(payload.output ?? payload.result ?? payload.commandOutput)
    const activityType = gatewayActivityType(eventName, payload)
    return {
      transport: 'gateway-chat',
      liveTokens: true,
      runId: waiter.runId,
      sessionKey: waiter.sessionKey,
      gatewayEvent: eventName,
      ...(state ? { state } : {}),
      ...(phase ? { phase } : {}),
      ...(status ? { status } : {}),
      ...(stream ? { stream } : {}),
      ...(toolName ? { toolName } : {}),
      ...(activityType ? { activityType } : {}),
      ...(toolAction ? { toolAction: trimText(toolAction, 120) } : {}),
      ...(command ? { command: compactValue(command, 360) } : {}),
      ...(toolInput ? { toolInput } : {}),
      ...(toolOutput ? { toolOutput } : {}),
    }
  }

  function gatewayActivityType(eventName: string, payload: Record<string, unknown>) {
    const state = [payload.state, payload.status, payload.phase, payload.type]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .toLowerCase() || ''
    const stream = [payload.stream, payload.type]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .toLowerCase() || ''
    if (eventName === 'session.tool') {
      if (/\b(start|started|begin|running|pending|call)\b/.test(state)) return 'tool.started'
      if (/\b(error|failed|failure|blocked|denied)\b/.test(state)) return 'tool.error'
      if (/\b(done|complete|completed|finished|success|ok)\b/.test(state)) return 'tool.finished'
      return 'tool.progress'
    }
    if (eventName === 'agent') {
      if (/command|exec|shell/.test(stream)) {
        if (/\b(error|failed|failure)\b/.test(state)) return 'command.failed'
        if (/\b(done|complete|completed|finished|success|ok)\b/.test(state)) return 'command.finished'
        return 'command.output'
      }
      if (/tool/.test(stream)) return 'tool.progress'
      return 'agent.working'
    }
    return ''
  }

  function gatewayEventProgressText(eventName: string, payload: Record<string, unknown>) {
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = payload[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }
    const state = pick('state', 'phase', 'status')
    if (eventName === 'session.tool') {
      const toolName = pick('toolName', 'tool', 'name', 'displayName')
      if (toolName && state) return `Tool ${toolName} ${state}.`
      if (toolName) return `Tool ${toolName} activity.`
      return state ? `Tool activity: ${state}.` : 'Tool activity received.'
    }
    if (eventName === 'agent') {
      const stream = pick('stream', 'phase', 'type')
      if (['assistant', 'item'].includes(stream.toLowerCase())) return ''
      const message = pick('message', 'summary', 'title', 'text', 'output', 'command')
      if (message) return trimText(message, 180)
      if (stream.toLowerCase() === 'tool' && !state) return ''
      if (stream.toLowerCase() === 'command_output') return 'Exec output received.'
      return stream || state ? `Gateway agent event: ${stream || state}.` : ''
    }
    return ''
  }

  function emitGatewayProgress(waiter: GatewayChatRunWaiter, eventName: string, payload: Record<string, unknown>) {
    const observer = streamObserver(waiter.streamObserverId)
    if (!observer) return
    const text = gatewayEventProgressText(eventName, payload)
    if (!text) return
    const streamPayload = gatewayStreamPayload(waiter, eventName, payload)
    observer.emit('progress', {
      ...streamPayload,
      text,
    })
  }

  function gatewayChatDeltaFromPayload(waiter: GatewayChatRunWaiter, payload: Record<string, unknown>) {
    const replace = payload.replace === true
    const deltaText = typeof payload.deltaText === 'string' ? payload.deltaText : ''
    if (deltaText) {
      const text = options.redactHiddenReasoningAndSecrets(deltaText)
      waiter.streamedText = replace ? text : `${waiter.streamedText}${text}`
      return { text, replace }
    }

    const snapshot = options.redactHiddenReasoningAndSecrets(gatewayChatMessageText(payload.message))
    if (!snapshot) return { text: '', replace: false }
    const previous = waiter.streamedText
    if (snapshot.startsWith(previous)) {
      const text = snapshot.slice(previous.length)
      waiter.streamedText = snapshot
      return { text, replace: false }
    }
    if (snapshot !== previous) {
      waiter.streamedText = snapshot
      return { text: snapshot, replace: true }
    }
    return { text: '', replace: false }
  }

  function emitGatewayChatDelta(waiter: GatewayChatRunWaiter, payload: Record<string, unknown>) {
    const observer = streamObserver(waiter.streamObserverId)
    if (!observer) return
    const delta = gatewayChatDeltaFromPayload(waiter, payload)
    if (!delta.text) return
    observer.textStreamed = true
    observer.emit('delta', {
      ...gatewayStreamPayload(waiter, 'chat', payload),
      text: delta.text,
      ...(delta.replace ? { replace: true } : {}),
    })
  }

  function emitGatewayChatStart(waiter: GatewayChatRunWaiter) {
    const observer = streamObserver(waiter.streamObserverId)
    if (!observer) return
    observer.emit('start', {
      transport: 'gateway-chat',
      liveTokens: true,
      runId: waiter.runId,
      sessionKey: waiter.sessionKey,
      label: 'Gateway chat',
    })
    observer.emit('status', {
      transport: 'gateway-chat',
      liveTokens: true,
      runId: waiter.runId,
      sessionKey: waiter.sessionKey,
      label: 'Gateway chat',
      mode: 'progress',
      message: 'Gateway accepted the live chat run.',
    })
  }

  function resetGatewayReadyPromise(state: GatewayClientState) {
    state.ready = false
    state.readyPromise = new Promise((resolve, reject) => {
      state.resolveReady = resolve
      state.rejectReady = reject
    })
  }

  function resetGatewayReadyPromiseAfterFailure(state: GatewayClientState, error: Error) {
    const rejectReady = state.rejectReady
    resetGatewayReadyPromise(state)
    rejectReady?.(error)
  }

  function rejectGatewayChatWaiters(error: Error) {
    for (const waiter of gatewayChatRunWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    gatewayChatRunWaiters.clear()
  }

  function rejectGatewayChatWaiter(runId: string, error: Error) {
    const waiter = gatewayChatRunWaiters.get(runId)
    if (!waiter) return
    gatewayChatRunWaiters.delete(runId)
    clearTimeout(waiter.timer)
    waiter.reject(error)
  }

  function abortAndRejectGatewayChatWaiters(reason: string) {
    const error = gatewayChatAbortError(reason)
    const client = gatewayClientState?.client
    for (const waiter of Array.from(gatewayChatRunWaiters.values())) {
      gatewayChatRunWaiters.delete(waiter.runId)
      clearTimeout(waiter.timer)
      if (client) requestGatewayChatAbort(client, waiter.sessionKey, waiter.runId, reason)
      const observer = streamObserver(waiter.streamObserverId)
      try {
        observer?.emit('status', {
          type: 'aborted',
          runId: waiter.runId,
          message: 'Gateway chat run stopped during runtime shutdown.',
        })
      } catch {
        // The renderer may already have disconnected during shutdown.
      }
      waiter.reject(error)
    }
  }

  function closeGatewayChatStreamObservers(reason: string) {
    for (const observer of Array.from(gatewayChatStreamObservers.values())) {
      if (!observer.closed) {
        try {
          observer.emit('status', {
            type: 'aborted',
            message: reason,
          })
        } catch {
          // The response stream may already be closed.
        }
      }
      observer.closed = true
      gatewayChatStreamObservers.delete(observer.id)
    }
  }

  function handleGatewayClientEvent(evt: { event?: unknown; payload?: unknown }) {
    const eventName = typeof evt.event === 'string' ? evt.event : ''
    const payload = isLooseRecord(evt.payload) ? evt.payload : null
    if (!eventName || !payload) return
    const runId = gatewayPayloadRunId(payload)
    if (!runId) return
    const waiter = gatewayChatRunWaiters.get(runId)
    if (!waiter) return
    if (eventName === 'session.tool' || eventName === 'agent') {
      waiter.toolEvents.push(payload)
      emitGatewayProgress(waiter, eventName, payload)
      return
    }
    if (eventName !== 'chat') return
    const state = gatewayPayloadChatState(payload)
    if (state === 'delta') {
      emitGatewayChatDelta(waiter, payload)
      return
    }
    if (!state) return
    if (state === 'final') emitGatewayChatDelta(waiter, payload)
    gatewayChatRunWaiters.delete(runId)
    clearTimeout(waiter.timer)
    waiter.resolve(payload)
  }

  function waitForGatewayReady(state: GatewayClientState, timeoutMs: number, signal?: AbortSignal) {
    if (state.ready) return Promise.resolve()
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('gateway client connection aborted'), { name: 'AbortError' }))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`gateway client connection timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      const onAbort = () => {
        cleanup()
        reject(Object.assign(new Error('gateway client connection aborted'), { name: 'AbortError' }))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      state.readyPromise.then(
        () => {
          cleanup()
          resolve()
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
    })
  }

  function stopStaleClient() {
    if (!gatewayClientState || gatewayClientState.ready) return
    try {
      gatewayClientState.client.stop()
    } catch {
      // Best-effort cleanup before replacing a poisoned startup client.
    }
    gatewayClientState = null
  }

  function stopClient(reason = 'control center shutdown') {
    const error = gatewayChatAbortError(reason)
    abortAndRejectGatewayChatWaiters(reason)
    closeGatewayChatStreamObservers(reason)
    const state = gatewayClientState
    gatewayClientState = null
    gatewayClientConnectPromise = null
    prewarmPromise = null
    if (prewarmTimer) {
      clearTimeout(prewarmTimer)
      prewarmTimer = null
    }
    if (!state) return
    try {
      state.rejectReady?.(error)
    } catch {
      // Ready waiters may already have settled.
    }
    try {
      state.client.stop()
    } catch {
      // Best-effort shutdown.
    }
  }

  function waitForGatewayClientConnect(promise: Promise<GatewayClientState>, signal?: AbortSignal) {
    if (!signal) return promise
    if (signal.aborted) {
      return Promise.reject(Object.assign(new Error('gateway client connection aborted'), { name: 'AbortError' }))
    }
    return new Promise<GatewayClientState>((resolve, reject) => {
      const onAbort = () => {
        cleanup()
        reject(Object.assign(new Error('gateway client connection aborted'), { name: 'AbortError' }))
      }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (state) => {
          cleanup()
          resolve(state)
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
    })
  }

  async function startClient(): Promise<GatewayClientState> {
    if (options.isShuttingDown()) throw gatewayChatAbortError('control center is shutting down')
    options.startGatewayHealthMonitor()
    if (!(await options.isGatewayHealthy())) {
      await options.ensureGatewayRunning()
      if (!(await options.isGatewayHealthy())) {
        throw new Error(`gateway not healthy on port ${options.gatewayHttpPort}`)
      }
    }

    stopStaleClient()
    if (options.isShuttingDown()) throw gatewayChatAbortError('control center is shutting down')

    const gatewayAuth = options.getGatewayAuthEnv()
    const state = {} as GatewayClientState
    state.generation = ++gatewayClientGeneration
    resetGatewayReadyPromise(state)
    const client = (options.clientFactory || ((clientOptions) => new LightweightGatewayClient(clientOptions)))({
      url: controlCenterGatewayUrl(),
      token: gatewayAuth.OPENCLAW_GATEWAY_TOKEN,
      password: gatewayAuth.OPENCLAW_GATEWAY_PASSWORD,
      clientName: 'gateway-client',
      clientDisplayName: 'Automnia Control Center',
      clientVersion: options.clientVersion,
      platform: process.platform,
      mode: 'backend',
      role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.talk.secrets'],
      caps: ['tool-events'],
      deviceIdentity: null,
      instanceId: randomUUID(),
      minProtocol: 4,
      maxProtocol: 4,
      requestTimeoutMs,
      preauthHandshakeTimeoutMs: connectTimeoutMs,
      onHelloOk: (hello: unknown) => {
        if (gatewayClientState?.generation !== state.generation) return
        state.lastHello = hello
        state.ready = true
        state.resolveReady?.()
      },
      onEvent: handleGatewayClientEvent,
      onConnectError: (error: Error) => {
        if (gatewayClientState?.generation !== state.generation) return
        if (isRetryableGatewayStartupUnavailableError(error)) {
          const retryAfterMs = typeof (error as Error & { retryAfterMs?: unknown }).retryAfterMs === 'number'
            ? (error as Error & { retryAfterMs?: number }).retryAfterMs
            : 0
          options.pushGatewayLog(
            'gateway',
            `control center gateway client waiting for startup sidecars${retryAfterMs ? `; retrying in ${retryAfterMs}ms` : ''}`,
            'warning',
          )
          return
        }
        if (!state.ready) resetGatewayReadyPromiseAfterFailure(state, error)
        options.pushGatewayLog('gateway', `control center gateway client connect error: ${options.redactSensitiveText(String(error))}`, 'warning')
      },
      onClose: (_code: number, reason: string) => {
        if (gatewayClientState?.generation !== state.generation) return
        const error = new Error(`gateway client disconnected: ${reason || 'no reason'}`)
        resetGatewayReadyPromiseAfterFailure(state, error)
        rejectGatewayChatWaiters(error)
      },
      onReconnectPaused: (info: unknown) => {
        if (gatewayClientState?.generation !== state.generation) return
        options.pushGatewayLog('gateway', `control center gateway client reconnect paused: ${options.redactSensitiveText(JSON.stringify(info))}`, 'warning')
      },
      onGap: (info: unknown) => {
        if (gatewayClientState?.generation !== state.generation) return
        options.pushGatewayLog('gateway', `control center gateway event gap: ${options.redactSensitiveText(JSON.stringify(info))}`, 'warning')
      },
    })
    state.client = client
    gatewayClientState = state

    client.start()
    if (options.isShuttingDown()) {
      state.client.stop()
      gatewayClientState = null
      throw gatewayChatAbortError('control center is shutting down')
    }

    try {
      await waitForGatewayReady(state, readyTimeoutMs)
      return state
    } catch (error) {
      if (gatewayClientState?.generation === state.generation && !state.ready) {
        try {
          state.client.stop()
        } catch {
          // Best-effort cleanup after a failed startup attempt.
        }
        gatewayClientState = null
      }
      throw error
    }
  }

  async function ensureClient(signal?: AbortSignal): Promise<GatewayClientState> {
    if (gatewayClientState?.ready) return gatewayClientState
    if (!gatewayClientConnectPromise) {
      gatewayClientConnectPromise = startClient().finally(() => {
        gatewayClientConnectPromise = null
      })
    }
    return waitForGatewayClientConnect(gatewayClientConnectPromise, signal)
  }

  function prewarm(reason = 'startup') {
    if (options.isShuttingDown()) return Promise.resolve()
    if (!options.gatewayAgentSessionsEnabled || options.forceLocalAgentRuntime || !options.gatewayChatClientEnabled) {
      return Promise.resolve()
    }
    if (gatewayClientState?.ready && options.getOpenClawAgentRunDefaultsReady()) return Promise.resolve()
    if (prewarmPromise) return prewarmPromise

    prewarmPromise = (async () => {
      const startedAt = nowMs()
      await options.ensureOpenclawAgentRunConfigDefaults()
      if (options.isShuttingDown()) return
      await options.ensureGatewayRunning()
      if (options.isShuttingDown()) return
      options.startGatewayHealthMonitor()
      if (!(await options.isGatewayHealthy())) {
        throw new Error('gateway health check failed during prewarm')
      }
      await ensureClient()
      prewarmedAt = new Date().toISOString()
      const elapsedMs = nowMs() - startedAt
      log.log(`[gateway] control center chat prewarmed (${reason}) in ${elapsedMs}ms`)
      options.pushGatewayLog('gateway', `control center chat prewarmed (${reason}) in ${elapsedMs}ms`)
    })().catch((error) => {
      log.warn(`[gateway] control center chat prewarm skipped (${reason}): ${options.redactSensitiveText(String(error))}`)
    }).finally(() => {
      prewarmPromise = null
    })

    return prewarmPromise
  }

  function schedulePrewarm(reason = 'startup', delayMs = 1500) {
    if (prewarmTimer) clearTimeout(prewarmTimer)
    prewarmTimer = setTimeout(() => {
      prewarmTimer = null
      if (options.isShuttingDown()) return
      void prewarm(reason)
    }, Math.max(0, delayMs))
    prewarmTimer.unref?.()
  }

  function gatewayChatHistoryReply(history: unknown): GatewayHistoryReply {
    if (!isLooseRecord(history) || !Array.isArray(history.messages)) return { text: '', messageId: '', placeholder: false }
    for (const message of [...history.messages].reverse()) {
      if (!isLooseRecord(message)) continue
      const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : ''
      if (role !== 'assistant') continue
      const text = gatewayChatMessageText(message)
      if (isVisibleGatewayAssistantText(text)) {
        const sanitized = options.sanitizeUserVisibleRuntimeText(text)
        return {
          text: sanitized,
          messageId: gatewayChatMessageId(message),
          placeholder: isGatewayHistoryPlaceholder(sanitized),
        }
      }
    }
    return { text: '', messageId: '', placeholder: false }
  }

  function gatewayChatSessionKey(agentId: string, sessionId: string, requestedSessionKey?: string | null, freshSession = false) {
    const requested = requestedSessionKey?.trim()
    if (requested) {
      const base = requested.startsWith('agent:') ? requested : `agent:${agentId}:${requested}`
      return freshSession ? `${base}:fresh:${sessionId}` : base
    }
    return `agent:${agentId}:control-center:${sessionId}`
  }

  async function readGatewayChatMessageText(params: {
    client: GatewayClientLike
    sessionKey: string
    agentId: string
    messageId: string
    signal?: AbortSignal
  }) {
    if (!params.messageId) return ''
    const response = await params.client.request('chat.message.get', {
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      messageId: params.messageId,
      maxChars: messageGetMaxChars,
    }, { timeoutMs: 10_000, signal: params.signal }).catch(() => null)
    if (!isLooseRecord(response) || response.ok !== true) return ''
    const text = options.sanitizeUserVisibleRuntimeText(gatewayChatMessageText(response.message))
    return isVisibleGatewayAssistantText(text) && !isGatewayHistoryPlaceholder(text) ? text : ''
  }

  function waitForGatewayChatRun(params: {
    client: GatewayClientLike
    runId: string
    sessionKey: string
    timeoutMs: number
    streamObserverId?: string
    signal?: AbortSignal
  }): Promise<{ payload: Record<string, unknown>; toolEvents: unknown[] }> {
    if (params.signal?.aborted) {
      return Promise.reject(Object.assign(new Error('gateway chat run aborted'), { name: 'AbortError' }))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        gatewayChatRunWaiters.delete(params.runId)
        requestGatewayChatAbort(params.client, params.sessionKey, params.runId, 'waiter timeout')
        waiter.reject(new Error(`gateway chat run timed out after ${params.timeoutMs}ms`))
      }, params.timeoutMs)
      timer.unref?.()
      const waiter: GatewayChatRunWaiter = {
        runId: params.runId,
        sessionKey: params.sessionKey,
        startedAt: nowMs(),
        toolEvents: [],
        streamObserverId: params.streamObserverId,
        streamedText: '',
        timer,
        resolve: (payload) => {
          cleanup()
          resolve({ payload, toolEvents: waiter.toolEvents })
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }
      const onAbort = () => {
        gatewayChatRunWaiters.delete(params.runId)
        requestGatewayChatAbort(params.client, params.sessionKey, params.runId, 'request cancellation')
        waiter.reject(Object.assign(new Error('gateway chat run aborted'), { name: 'AbortError' }))
      }
      const cleanup = () => {
        clearTimeout(timer)
        params.signal?.removeEventListener('abort', onAbort)
      }
      params.signal?.addEventListener('abort', onAbort, { once: true })
      gatewayChatRunWaiters.set(params.runId, waiter)
    })
  }

  async function runTurn(params: {
    agentId: string
    message: string
    attachments?: unknown[]
    sessionId: string
    requestedSessionKey?: string
    freshSession?: boolean
    thinking: GatewayChatThinkingLevel
    fastMode?: GatewayChatFastModePreference
    timeoutMs: number
    cwd: string
    streamObserverId?: string
    signal?: AbortSignal
  }): Promise<GatewayChatTurnResult> {
    const state = await ensureClient(params.signal)
    const runId = randomUUID()
    const sessionKey = gatewayChatSessionKey(params.agentId, params.sessionId, params.requestedSessionKey, params.freshSession)
    const attachments = await options.gatewayChatAttachmentsFromTurnAttachments(params.attachments)
    streamObserver(params.streamObserverId)?.emit('progress', {
      transport: 'gateway-chat',
      liveTokens: true,
      text: attachments.length ? 'Sending message and image attachment through Gateway chat.' : 'Sending message through Gateway chat.',
      agent: params.agentId,
      sessionKey,
      runId,
    })
    const runRecord = options.beginGatewayChatRun({
      runId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
    })
    const finalPromise = waitForGatewayChatRun({
      client: state.client,
      runId,
      sessionKey,
      timeoutMs: params.timeoutMs + finalExtraTimeoutMs,
      streamObserverId: params.streamObserverId,
      signal: params.signal,
    })
    // chat.send can fail before this function reaches the normal final await.
    // Observe early rejection so request aborts do not become unhandled rejections.
    void finalPromise.catch(() => undefined)
    let ack: unknown
    const fastMode = options.normalizeFastMode(params.fastMode)
    try {
      ack = await state.client.request('chat.send', {
        sessionKey,
        sessionId: params.sessionId,
        agentId: params.agentId,
        message: params.message,
        ...(attachments.length ? { attachments } : {}),
        thinking: params.thinking,
        ...(fastMode ? {
          fastMode,
          ...(fastMode === 'auto' ? { fastAutoOnSeconds: options.fastAutoOnSeconds } : {}),
        } : {}),
        timeoutMs: params.timeoutMs,
        idempotencyKey: runId,
      }, {
        timeoutMs: requestTimeoutMs,
        signal: params.signal,
      })
      const waiter = gatewayChatRunWaiters.get(runId)
      if (waiter) emitGatewayChatStart(waiter)
    } catch (error) {
      const shapedError = params.signal?.aborted
        ? gatewayChatAbortError(redactedGatewayErrorText(error, 'gateway chat run aborted'))
        : redactedGatewayError(error, 'gateway chat send failed')
      const stderr = shapedError.message
      rejectGatewayChatWaiter(runId, shapedError)
      options.finishGatewayChatRun(runRecord, params.signal?.aborted ? 'aborted' : 'failed', {
        stderr,
        code: 1,
        failureKind: params.signal?.aborted ? 'aborted' : options.classifyFailureKind(stderr, 'failed'),
      })
      throw shapedError
    }

    if (options.toolsEffectiveDiagnostic) {
      void state.client.request('tools.effective', {
        sessionKey,
        agentId: params.agentId,
      }, { timeoutMs: 5_000 }).catch((error) => ({ error: String(error) }))
    }

    try {
      const final = await finalPromise
      const finalPayload = final.payload
      const finalState = gatewayPayloadChatState(finalPayload) || 'final'
      const finalText = options.sanitizeUserVisibleRuntimeText(gatewayChatMessageText(finalPayload.message))
      const finalTextIsVisible = isVisibleGatewayAssistantText(finalText) && !isGatewayProtocolStatusText(finalText)
      // The Gateway's terminal event is the fastest authoritative reply when
      // present. Keep chat.history as a bounded recovery path for older or
      // partial terminal payloads, where it supplies the display-normalized
      // transcript entry and a possible chat.message.get expansion.
      const shouldReadHistory = !finalTextIsVisible
      const history = shouldReadHistory
        ? await state.client.request('chat.history', {
            sessionKey,
            agentId: params.agentId,
            limit: historyLimit,
            maxChars: historyMaxChars,
          }, { timeoutMs: 10_000 }).catch(() => null)
        : null
      const historyReply = gatewayChatHistoryReply(history)
      const fullHistoryText = historyReply.placeholder || !historyReply.text
        ? await readGatewayChatMessageText({
            client: state.client,
            sessionKey,
            agentId: params.agentId,
            messageId: historyReply.messageId,
            signal: params.signal,
          })
        : ''
      const historyText = fullHistoryText || historyReply.text
      const finalTextLooksLikeStatus = !historyText && isGatewayProtocolStatusText(finalText)
      const finalReplyText = finalTextLooksLikeStatus ? '' : finalText
      const errorMessage = typeof finalPayload.errorMessage === 'string' ? options.redactSensitiveText(finalPayload.errorMessage) : ''
      const reply = options.redactSensitiveText(options.sanitizeUserVisibleRuntimeText(historyText || finalReplyText || (finalState === 'error' ? errorMessage : '')))
      const completedWithoutAssistant = finalState === 'final' && !reply
      const ok = finalState !== 'error' && finalState !== 'aborted' && !completedWithoutAssistant
      const stderr = ok
        ? ''
        : completedWithoutAssistant
          ? `Gateway completed run ${runId} without a visible assistant transcript.`
          : errorMessage || options.redactSensitiveText(JSON.stringify(redactedGatewayDiagnosticValue(finalPayload)))
      const runStatus: GatewayChatRunStatus = ok ? 'completed' : finalState === 'aborted' ? 'aborted' : 'failed'
      options.finishGatewayChatRun(runRecord, runStatus, {
        stdout: reply,
        stderr,
        code: ok ? 0 : 1,
        failureKind: ok ? undefined : finalState === 'aborted' ? 'aborted' : options.classifyFailureKind(stderr || reply, 'failed'),
      })

      return {
        stdout: JSON.stringify({
          status: ok ? 'ok' : finalState === 'aborted' ? 'aborted' : 'error',
          text: reply,
          transport: 'gateway-chat',
          runId,
          sessionKey,
          sessionId: params.sessionId,
          ack: redactedGatewayDiagnosticValue(ack),
          final: redactedGatewayDiagnosticValue(finalPayload),
          toolEventCount: final.toolEvents.length,
          toolsEffective: { status: options.toolsEffectiveDiagnostic ? 'deferred' : 'skipped' },
        }),
        stderr,
        code: ok ? 0 : 1,
        runtimeTransport: 'gateway-chat',
      }
    } catch (error) {
      const wasAborted = params.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
      const shapedError = wasAborted
        ? gatewayChatAbortError(redactedGatewayErrorText(error, 'gateway chat run aborted'))
        : redactedGatewayError(error, 'gateway chat run failed')
      const text = shapedError.message
      const status: GatewayChatRunStatus = wasAborted
        ? 'aborted'
        : /timed out|timeout/i.test(text)
          ? 'timeout'
          : 'failed'
      options.finishGatewayChatRun(runRecord, status, {
        stderr: text,
        code: 1,
        failureKind: status === 'aborted' ? 'aborted' : status === 'timeout' ? 'timeout' : options.classifyFailureKind(text, 'failed'),
      })
      throw shapedError
    }
  }

  return {
    abortStaleWaiters,
    ensureClient,
    getReadyClient: () => gatewayClientState?.ready ? gatewayClientState.client : null,
    prewarm,
    prewarmedAt: () => prewarmedAt || null,
    prewarming: () => Boolean(prewarmPromise),
    ready: () => gatewayClientState?.ready === true,
    registerStreamObserver,
    requestAbortIfClient,
    runTurn,
    runtimeSnapshot,
    schedulePrewarm,
    stopClient,
    streamObserver,
  }
}

export type GatewayChatService = ReturnType<typeof createGatewayChatService>

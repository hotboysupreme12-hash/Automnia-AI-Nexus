export type GatewayHealthPayload = {
  ok?: boolean
  status?: string
  plugins?: {
    loaded?: unknown[]
    errors?: unknown[]
  }
  [key: string]: unknown
}

export type GatewayReadinessEventLoop = {
  degraded: boolean
  reasons: string[]
  intervalMs?: number
  delayP99Ms?: number
  delayMaxMs?: number
  utilization?: number
  cpuCoreRatio?: number
}

export type GatewayReadinessPayload = {
  ready?: boolean
  ok?: boolean
  status?: string
  failing?: unknown[]
  uptimeMs?: unknown
  eventLoop?: unknown
  [key: string]: unknown
}

export type GatewayReadinessSummary = {
  reachable: boolean
  ready: boolean
  degraded: boolean
  checkedAt: string | null
  httpStatus?: number
  status?: string
  failing: string[]
  uptimeMs: number | null
  eventLoop: GatewayReadinessEventLoop | null
  error?: string
}

export type GatewayStabilityEventSnapshot = {
  seq?: number
  ts?: string
  type: string
  level?: string
  source?: string
  reason?: string
  outcome?: string
  action?: string
  phase?: string
  toolName?: string
  activeWorkKind?: string
  active?: number
  waiting?: number
  queued?: number
  queueDepth?: number
  queueSize?: number
  waitMs?: number
  ageMs?: number
  durationMs?: number
  eventLoopDelayP99Ms?: number
  eventLoopDelayMaxMs?: number
  eventLoopUtilization?: number
  cpuCoreRatio?: number
}

export type GatewayStabilityStatus = {
  available: boolean
  source: 'diagnostics.stability' | 'gateway-client-not-ready'
  generatedAt: string | null
  count: number
  dropped: number
  lastSeq: number | null
  summary: {
    byType: Record<string, number>
    active: number | null
    waiting: number | null
    queued: number | null
    maxQueueDepth: number | null
    warningCount: number
    latestEventType: string | null
    latestEventAt: string | null
    recentWarnings: string[]
  }
  events: GatewayStabilityEventSnapshot[]
  error?: string
}

export type GatewayDiagnosticsHttpResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type GatewayDiagnosticsFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<GatewayDiagnosticsHttpResponse>

export type GatewayDiagnosticsClient = {
  request: (method: string, params?: unknown, options?: { timeoutMs?: number | null; signal?: AbortSignal }) => Promise<unknown>
}

export type GatewayDiagnosticsServiceOptions = {
  gatewayHttpPort: number
  fetch?: GatewayDiagnosticsFetch
  getGatewayClient: () => GatewayDiagnosticsClient | null
  sanitizeGatewayMessage: (message: string, max?: number) => string
  redactSensitiveText: (value: string) => string
  onHealthy?: () => void
  healthTimeoutMs?: number
  readinessTimeoutMs?: number
  stabilityTimeoutMs?: number
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimGatewayText(value: string, max: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteGatewayStabilityNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function gatewayStabilityTimestamp(value: unknown): string | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

export function createGatewayDiagnosticsService(options: GatewayDiagnosticsServiceOptions) {
  const fetchImpl: GatewayDiagnosticsFetch = options.fetch ?? (async (url, init) => fetch(url, init))
  const healthTimeoutMs = options.healthTimeoutMs ?? 3_000
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 3_000
  const stabilityTimeoutMs = options.stabilityTimeoutMs ?? 2_500

  function sanitize(message: string, max = 180) {
    return options.sanitizeGatewayMessage(message, max)
  }

  function gatewayReadinessEventLoop(payload: GatewayReadinessPayload | null): GatewayReadinessEventLoop | null {
    const eventLoop = isLooseRecord(payload?.eventLoop) ? payload.eventLoop : null
    if (!eventLoop) return null
    const reasons = Array.isArray(eventLoop.reasons)
      ? eventLoop.reasons.map((reason) => sanitize(String(reason), 120)).filter(Boolean).slice(0, 6)
      : []
    return {
      degraded: eventLoop.degraded === true,
      reasons,
      ...(numberFromRecord(eventLoop, 'intervalMs') !== undefined ? { intervalMs: numberFromRecord(eventLoop, 'intervalMs') } : {}),
      ...(numberFromRecord(eventLoop, 'delayP99Ms') !== undefined ? { delayP99Ms: numberFromRecord(eventLoop, 'delayP99Ms') } : {}),
      ...(numberFromRecord(eventLoop, 'delayMaxMs') !== undefined ? { delayMaxMs: numberFromRecord(eventLoop, 'delayMaxMs') } : {}),
      ...(numberFromRecord(eventLoop, 'utilization') !== undefined ? { utilization: numberFromRecord(eventLoop, 'utilization') } : {}),
      ...(numberFromRecord(eventLoop, 'cpuCoreRatio') !== undefined ? { cpuCoreRatio: numberFromRecord(eventLoop, 'cpuCoreRatio') } : {}),
    }
  }

  function gatewayReadinessFailures(payload: GatewayReadinessPayload | null): string[] {
    const failing = Array.isArray(payload?.failing) ? payload.failing : []
    return failing.map((entry) => sanitize(
      typeof entry === 'string' ? entry : JSON.stringify(entry),
      160,
    )).filter(Boolean).slice(0, 8)
  }

  function gatewayReadinessUnavailable(error?: string): GatewayReadinessSummary {
    return {
      reachable: false,
      ready: false,
      degraded: false,
      checkedAt: null,
      failing: [],
      uptimeMs: null,
      eventLoop: null,
      ...(error ? { error: sanitize(error, 180) } : {}),
    }
  }

  function gatewayStabilityUnavailable(source: GatewayStabilityStatus['source'], error?: string): GatewayStabilityStatus {
    return {
      available: false,
      source,
      generatedAt: null,
      count: 0,
      dropped: 0,
      lastSeq: null,
      summary: {
        byType: {},
        active: null,
        waiting: null,
        queued: null,
        maxQueueDepth: null,
        warningCount: 0,
        latestEventType: null,
        latestEventAt: null,
        recentWarnings: [],
      },
      events: [],
      ...(error ? { error } : {}),
    }
  }

  function safeGatewayStabilityText(value: unknown, max = 140): string | undefined {
    if (typeof value !== 'string') return undefined
    const clean = options.redactSensitiveText(value).replace(/\s+/g, ' ').trim()
    return clean ? trimGatewayText(clean, max) : undefined
  }

  function gatewayStabilityEventSnapshot(value: unknown): GatewayStabilityEventSnapshot | null {
    if (!isLooseRecord(value)) return null
    const type = safeGatewayStabilityText(value.type, 120)
    if (!type) return null
    const event: GatewayStabilityEventSnapshot = { type }
    const ts = gatewayStabilityTimestamp(value.ts)
    const assignNumber = (key: keyof GatewayStabilityEventSnapshot) => {
      const next = finiteGatewayStabilityNumber(value[key])
      if (next !== undefined) event[key] = next as never
    }
    const assignText = (key: keyof GatewayStabilityEventSnapshot) => {
      const next = safeGatewayStabilityText(value[key])
      if (next) event[key] = next as never
    }

    assignNumber('seq')
    if (ts) event.ts = ts
    assignText('level')
    assignText('source')
    assignText('reason')
    assignText('outcome')
    assignText('action')
    assignText('phase')
    assignText('toolName')
    assignText('activeWorkKind')
    assignNumber('active')
    assignNumber('waiting')
    assignNumber('queued')
    assignNumber('queueDepth')
    assignNumber('queueSize')
    assignNumber('waitMs')
    assignNumber('ageMs')
    assignNumber('durationMs')
    assignNumber('eventLoopDelayP99Ms')
    assignNumber('eventLoopDelayMaxMs')
    assignNumber('eventLoopUtilization')
    assignNumber('cpuCoreRatio')
    return event
  }

  function gatewayStabilityEventWarning(event: GatewayStabilityEventSnapshot) {
    const warningType = /(?:stalled|stuck|liveness|memory\.pressure|payload\.large|recovery|dropped)/iu.test(event.type)
    return event.level === 'warning' || warningType
  }

  function gatewayStabilityWarningLabel(event: GatewayStabilityEventSnapshot) {
    return [
      event.type,
      event.reason ? `reason ${event.reason}` : '',
      event.queueDepth !== undefined ? `queue ${event.queueDepth}` : '',
      event.queued !== undefined ? `queued ${event.queued}` : '',
    ].filter(Boolean).join(' / ')
  }

  function normalizeGatewayStabilityPayload(payload: unknown, limit: number): GatewayStabilityStatus {
    if (!isLooseRecord(payload)) return gatewayStabilityUnavailable('diagnostics.stability', 'empty diagnostics response')
    const rawEvents = Array.isArray(payload.events) ? payload.events : []
    const events = rawEvents
      .map(gatewayStabilityEventSnapshot)
      .filter((event): event is GatewayStabilityEventSnapshot => Boolean(event))
      .slice(-Math.max(1, limit))
    const summary = isLooseRecord(payload.summary) ? payload.summary : {}
    const rawByType = isLooseRecord(summary.byType) ? summary.byType : {}
    const byType: Record<string, number> = {}
    for (const [key, value] of Object.entries(rawByType)) {
      const count = finiteGatewayStabilityNumber(value)
      if (count !== undefined) byType[key] = count
    }
    for (const event of events) {
      byType[event.type] ??= 0
    }

    const workloadEvent = [...events].reverse().find((event) => (
      event.active !== undefined || event.waiting !== undefined || event.queued !== undefined
    ))
    const latestEvent = events.at(-1)
    const warningEvents = events.filter(gatewayStabilityEventWarning)
    const queueDepths = events
      .flatMap((event) => [event.queueDepth, event.queueSize, event.queued])
      .filter((value): value is number => value !== undefined && Number.isFinite(value))
    const generatedAtMs = typeof payload.generatedAt === 'string' ? Date.parse(payload.generatedAt) : NaN
    const generatedAt = Number.isFinite(generatedAtMs) ? new Date(generatedAtMs).toISOString() : null

    return {
      available: true,
      source: 'diagnostics.stability',
      generatedAt,
      count: finiteGatewayStabilityNumber(payload.count) ?? events.length,
      dropped: finiteGatewayStabilityNumber(payload.dropped) ?? 0,
      lastSeq: finiteGatewayStabilityNumber(payload.lastSeq) ?? latestEvent?.seq ?? null,
      summary: {
        byType,
        active: workloadEvent?.active ?? null,
        waiting: workloadEvent?.waiting ?? null,
        queued: workloadEvent?.queued ?? null,
        maxQueueDepth: queueDepths.length ? Math.max(...queueDepths) : null,
        warningCount: warningEvents.length,
        latestEventType: latestEvent?.type ?? null,
        latestEventAt: latestEvent?.ts ?? null,
        recentWarnings: warningEvents.slice(-3).map(gatewayStabilityWarningLabel),
      },
      events,
    }
  }

  async function fetchGatewayHealthPayload(): Promise<{ healthy: boolean; payload: GatewayHealthPayload | null }> {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${options.gatewayHttpPort}/health`, {
        signal: AbortSignal.timeout(healthTimeoutMs),
      })
      if (!res.ok) return { healthy: false, payload: null }
      const text = await res.text()
      try {
        const body = JSON.parse(text) as GatewayHealthPayload
        const healthy = body.ok === true || /^ok$/i.test(String(body.status || ''))
        if (healthy) options.onHealthy?.()
        return { healthy, payload: body }
      } catch {
        const healthy = /\bok\b/i.test(text)
        if (healthy) options.onHealthy?.()
        return { healthy, payload: null }
      }
    } catch {
      // Gateway may be offline or still starting; callers surface the structured status.
    }
    return { healthy: false, payload: null }
  }

  async function fetchGatewayReadinessPayload(): Promise<GatewayReadinessSummary> {
    const checkedAt = new Date().toISOString()
    try {
      const res = await fetchImpl(`http://127.0.0.1:${options.gatewayHttpPort}/readyz`, {
        signal: AbortSignal.timeout(readinessTimeoutMs),
      })
      const text = await res.text()
      let payload: GatewayReadinessPayload | null = null
      try {
        payload = JSON.parse(text) as GatewayReadinessPayload
      } catch {
        payload = null
      }
      const status = typeof payload?.status === 'string' ? payload.status : undefined
      const eventLoop = gatewayReadinessEventLoop(payload)
      const failing = gatewayReadinessFailures(payload)
      const uptimeMs = typeof payload?.uptimeMs === 'number' && Number.isFinite(payload.uptimeMs) ? payload.uptimeMs : null
      const bodyReady = payload?.ready === true || payload?.ok === true || /^(ready|ok)$/iu.test(String(status || ''))
      const ready = res.ok && bodyReady
      return {
        reachable: true,
        ready,
        degraded: Boolean(eventLoop?.degraded) || failing.length > 0,
        checkedAt,
        httpStatus: res.status,
        ...(status ? { status } : {}),
        failing,
        uptimeMs,
        eventLoop,
      }
    } catch (error) {
      return gatewayReadinessUnavailable(String(error))
    }
  }

  async function readGatewayStabilitySnapshot(limit = 12): Promise<GatewayStabilityStatus> {
    const client = options.getGatewayClient()
    if (!client) return gatewayStabilityUnavailable('gateway-client-not-ready')

    try {
      const payload = await client.request('diagnostics.stability', { limit }, { timeoutMs: stabilityTimeoutMs })
      return normalizeGatewayStabilityPayload(payload, limit)
    } catch (error) {
      return gatewayStabilityUnavailable('diagnostics.stability', options.redactSensitiveText(String(error)))
    }
  }

  return {
    fetchGatewayHealthPayload,
    fetchGatewayReadinessPayload,
    gatewayReadinessUnavailable,
    gatewayStabilityUnavailable,
    normalizeGatewayStabilityPayload,
    readGatewayStabilitySnapshot,
  }
}

export type GatewayDiagnosticsService = ReturnType<typeof createGatewayDiagnosticsService>

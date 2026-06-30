import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGatewayDiagnosticsService,
  type GatewayDiagnosticsClient,
  type GatewayDiagnosticsFetch,
} from '../server/services/gateway/gatewayDiagnosticsService'

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

function createService(options: {
  fetch?: GatewayDiagnosticsFetch
  client?: GatewayDiagnosticsClient | null
  onHealthy?: () => void
} = {}) {
  return createGatewayDiagnosticsService({
    gatewayHttpPort: 19998,
    fetch: options.fetch || (async () => response(404, 'not found')),
    getGatewayClient: () => options.client ?? null,
    sanitizeGatewayMessage: (message, max = 180) => message.replace(/secret-[a-z0-9-]+/giu, '[redacted]').slice(0, max),
    redactSensitiveText: (value) => value.replace(/secret-[a-z0-9-]+/giu, '[redacted]'),
    onHealthy: options.onHealthy,
    healthTimeoutMs: 50,
    readinessTimeoutMs: 50,
    stabilityTimeoutMs: 50,
  })
}

test('fetchGatewayHealthPayload marks healthy JSON responses', async () => {
  let markedHealthy = 0
  const urls: string[] = []
  const service = createService({
    fetch: async (url) => {
      urls.push(url)
      return response(200, JSON.stringify({ ok: true, plugins: { loaded: ['sms'] } }))
    },
    onHealthy: () => {
      markedHealthy += 1
    },
  })

  const result = await service.fetchGatewayHealthPayload()

  assert.equal(urls[0], 'http://127.0.0.1:19998/health')
  assert.equal(result.healthy, true)
  assert.deepEqual(result.payload?.plugins?.loaded, ['sms'])
  assert.equal(markedHealthy, 1)
})

test('fetchGatewayReadinessPayload normalizes degraded readiness details', async () => {
  const service = createService({
    fetch: async () => response(503, JSON.stringify({
      ready: false,
      status: 'starting',
      uptimeMs: 1234,
      failing: ['provider secret-alpha failed'],
      eventLoop: {
        degraded: true,
        reasons: ['queue secret-beta pressure'],
        intervalMs: 100,
        delayP99Ms: 42,
      },
    })),
  })

  const result = await service.fetchGatewayReadinessPayload()

  assert.equal(result.reachable, true)
  assert.equal(result.ready, false)
  assert.equal(result.degraded, true)
  assert.equal(result.httpStatus, 503)
  assert.deepEqual(result.failing, ['provider [redacted] failed'])
  assert.equal(result.eventLoop?.degraded, true)
  assert.deepEqual(result.eventLoop?.reasons, ['queue [redacted] pressure'])
  assert.equal(result.eventLoop?.delayP99Ms, 42)
})

test('readGatewayStabilitySnapshot returns unavailable when the Gateway client is missing', async () => {
  const service = createService()

  const result = await service.readGatewayStabilitySnapshot()

  assert.equal(result.available, false)
  assert.equal(result.source, 'gateway-client-not-ready')
  assert.deepEqual(result.summary.recentWarnings, [])
})

test('readGatewayStabilitySnapshot redacts warning details and request failures', async () => {
  const requested: Array<{ method: string; params: unknown; timeoutMs?: number | null }> = []
  const service = createService({
    client: {
      request: async (method, params, options) => {
        requested.push({ method, params, timeoutMs: options?.timeoutMs })
        return {
          generatedAt: '2026-06-30T00:00:00.000Z',
          count: 2,
          lastSeq: 2,
          events: [
            { type: 'ready', seq: 1, active: 1 },
            { type: 'payload.large', seq: 2, level: 'warning', reason: 'secret-gateway-token', queueDepth: 5, queued: 3 },
          ],
        }
      },
    },
  })

  const result = await service.readGatewayStabilitySnapshot(8)

  assert.equal(requested[0]?.method, 'diagnostics.stability')
  assert.deepEqual(requested[0]?.params, { limit: 8 })
  assert.equal(requested[0]?.timeoutMs, 50)
  assert.equal(result.available, true)
  assert.equal(result.summary.latestEventType, 'payload.large')
  assert.equal(result.summary.active, null)
  assert.equal(result.summary.queued, 3)
  assert.equal(result.summary.maxQueueDepth, 5)
  assert.deepEqual(result.summary.recentWarnings, ['payload.large / reason [redacted] / queue 5 / queued 3'])

  const failingService = createService({
    client: {
      request: async () => {
        throw new Error('secret-gateway-token failed')
      },
    },
  })
  const failure = await failingService.readGatewayStabilitySnapshot()
  assert.equal(failure.available, false)
  assert.equal(failure.error, 'Error: [redacted] failed')
})

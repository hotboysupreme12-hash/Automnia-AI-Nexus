import assert from 'node:assert/strict'
import test from 'node:test'

type FetchResult = Response | Error | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)

const responseBody = JSON.stringify({
  ok: false,
  error: {
    code: 'oauth_operation_failed',
    message: 'No active Automnia license is linked to this Google account email.',
    status: 400,
  },
  requestId: 'request-id-for-diagnostics-only',
})

const queuedFetchResults: FetchResult[] = []
const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

function queueFetchResult(...results: FetchResult[]): void {
  queuedFetchResults.push(...results)
}

async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  fetchCalls.push({ input, init })
  const result = queuedFetchResults.shift()
  if (!result) throw new Error('The API client test fetch queue is empty.')
  if (result instanceof Error) throw result
  if (typeof result === 'function') return result(input, init)
  return result
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    clearTimeout,
    fetch: mockFetch,
    location: new URL('http://127.0.0.1:4050/'),
    setTimeout,
  },
})

const { apiErrorMessage, apiRequest } = await import('../src/api/client')

test('structured API failures keep login errors human-readable', async () => {
  queueFetchResult(new Response(responseBody, {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'server-request-id' },
  }))
  const result = await apiRequest('/api/auth/account/google/session/test', { authToken: '' })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.detail, undefined)
  assert.equal(result.requestId, 'server-request-id')
  assert.equal(apiErrorMessage(result.error), 'No active Automnia license is linked to this Google account email.')
})

test('legacy raw API envelopes are also hidden from user-facing messages', () => {
  assert.equal(apiErrorMessage({
    code: 'oauth_operation_failed',
    message: 'No active Automnia license is linked to this Google account email.',
    detail: responseBody,
    status: 400,
    requestId: 'request-id',
    url: '/api/auth/account/google/session/test',
  }), 'No active Automnia license is linked to this Google account email.')
})

test('successful API envelopes unwrap data and serialize JSON request bodies', async () => {
  queueFetchResult(new Response(JSON.stringify({ ok: true, data: { saved: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'server-success-id' },
  }))

  const result = await apiRequest<{ saved: boolean }>('/api/settings', {
    method: 'POST',
    body: { enabled: true },
    authToken: 'test-token',
    requestId: 'client-request-id',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.data, { saved: true })
  assert.equal(result.requestId, 'server-success-id')
  const request = fetchCalls.at(-1)
  assert.equal(request?.init?.body, JSON.stringify({ enabled: true }))
  assert.equal(new Headers(request?.init?.headers).get('Content-Type'), 'application/json')
  assert.equal(new Headers(request?.init?.headers).get('Authorization'), 'Bearer test-token')
  assert.equal(new Headers(request?.init?.headers).get('X-Request-Id'), 'client-request-id')
})

test('successful API responses preserve raw payloads and empty bodies', async () => {
  queueFetchResult(
    new Response('plain response', { status: 200 }),
    new Response(null, { status: 204 }),
  )

  const raw = await apiRequest<string>('/api/raw', { body: null })
  const empty = await apiRequest('/api/empty')

  assert.equal(raw.ok, true)
  if (raw.ok) assert.equal(raw.data, 'plain response')
  assert.equal(empty.ok, true)
  if (empty.ok) assert.equal(empty.data, undefined)
  assert.equal(fetchCalls.at(-2)?.init?.body, null)
})

test('API failures use nested and plain-text error details without exposing envelopes', async () => {
  queueFetchResult(
    new Response(JSON.stringify({
      ok: false,
      error: { detail: { reason: 'invalid setting' } },
      message: 'Settings request failed',
      code: 'settings_failed',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    new Response('upstream unavailable', { status: 502, statusText: 'Bad Gateway' }),
  )

  const explicitFailure = await apiRequest('/api/settings')
  const plainFailure = await apiRequest('/api/upstream', {
    body: new URLSearchParams({ source: 'gateway' }),
  })

  assert.equal(explicitFailure.ok, false)
  if (!explicitFailure.ok) {
    assert.equal(explicitFailure.error.code, 'settings_failed')
    assert.equal(explicitFailure.error.message, 'Settings request failed')
    assert.equal(explicitFailure.error.detail, '{"reason":"invalid setting"}')
  }
  assert.equal(plainFailure.ok, false)
  if (!plainFailure.ok) {
    assert.equal(plainFailure.error.code, 'http_error')
    assert.equal(plainFailure.error.message, 'Bad Gateway')
    assert.equal(plainFailure.error.detail, 'upstream unavailable')
  }
})

test('API client preserves supported body types and caller content types', async () => {
  const bodies: BodyInit[] = [
    'raw text',
    new Blob(['blob body'], { type: 'text/plain' }),
    new FormData(),
    new URLSearchParams({ q: 'test' }),
    new TextEncoder().encode('binary body').buffer,
  ]
  queueFetchResult(...bodies.map(() => new Response('{}', { status: 200 })))

  for (const body of bodies) {
    const result = await apiRequest('/api/body', { body })
    assert.equal(result.ok, true)
  }

  queueFetchResult(new Response('{}', { status: 200 }))
  await apiRequest('/api/body', {
    body: { already: 'typed' },
    headers: { 'Content-Type': 'application/custom+json' },
  })
  assert.equal(new Headers(fetchCalls.at(-1)?.init?.headers).get('Content-Type'), 'application/custom+json')
})

test('API client reports network, cancellation, and timeout failures distinctly', async () => {
  queueFetchResult(new Error('gateway connection refused'))
  const networkFailure = await apiRequest('/api/network')
  assert.equal(networkFailure.ok, false)
  if (!networkFailure.ok) {
    assert.equal(networkFailure.error.code, 'network_error')
    assert.equal(networkFailure.error.message, 'gateway connection refused')
  }

  const pendingFetch: FetchResult = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const rejectAborted = () => reject(init?.signal?.reason || new DOMException('The request was aborted.', 'AbortError'))
    if (init?.signal?.aborted) rejectAborted()
    else init?.signal?.addEventListener('abort', rejectAborted, { once: true })
  })
  queueFetchResult(pendingFetch)
  const controller = new AbortController()
  controller.abort()
  const aborted = await apiRequest('/api/aborted', { signal: controller.signal })
  assert.equal(aborted.ok, false)
  if (!aborted.ok) assert.equal(aborted.error.code, 'aborted')

  queueFetchResult(pendingFetch)
  const timedOut = await apiRequest('/api/timeout', { timeoutMs: 1 })
  assert.equal(timedOut.ok, false)
  if (!timedOut.ok) assert.equal(timedOut.error.code, 'timeout')
})

test('apiErrorMessage handles auth recovery, useful detail, and envelope-shaped detail', () => {
  const base = {
    code: 'request_failed',
    message: 'Request failed',
    status: 500,
    requestId: 'request-id',
    url: '/api/test',
  }

  assert.match(apiErrorMessage({ ...base, code: 'auth_required' }), /local runtime session needs to reconnect/)
  assert.equal(apiErrorMessage({ ...base, detail: '' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: 'Request failed' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: 'try again later' }), 'Request failed: try again later')
  assert.equal(apiErrorMessage({ ...base, detail: '{not valid json' }), 'Request failed: {not valid json')
  assert.equal(apiErrorMessage({ ...base, detail: '{"ok":false}' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: '{"ok":true}' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: '{"requestId":"server-id"}' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: '{"error":{"code":"bad_request"}}' }), 'Request failed')
  assert.equal(apiErrorMessage({ ...base, detail: '["not an envelope"]' }), 'Request failed: ["not an envelope"]')
})

test('apiErrorMessage turns browser transport failures into an actionable local-runtime message', () => {
  const base = {
    message: 'TypeError: Failed to fetch',
    status: 0,
    requestId: 'request-id',
    url: 'http://127.0.0.1:4050/api/auth/account/google/start',
  }

  assert.match(apiErrorMessage({ ...base, code: 'network_error' }), /could not reach the local Control Center/)
  assert.match(apiErrorMessage({ ...base, code: 'timeout' }), /took too long to respond/)
})

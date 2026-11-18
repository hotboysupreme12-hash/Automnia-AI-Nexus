import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundedHttpRequest,
  BoundedHttpRequestError,
  type BoundedHttpResponse,
} from '../server/services/http/boundedHttpRequest'

function streamedResponse(chunks: string[], headers?: Record<string, string>): BoundedHttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers?.[name.toLowerCase()] ?? null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
    text: async () => chunks.join(''),
  }
}

test('bounded HTTP request reads streamed response bodies within the byte limit', async () => {
  const result = await boundedHttpRequest(
    'https://provider.invalid/probe',
    { method: 'GET' },
    { timeoutMs: 100, maxResponseBytes: 9, fetch: async () => streamedResponse(['safe', ' body']) },
  )

  assert.equal(result.response.status, 200)
  assert.equal(result.text, 'safe body')
})

test('bounded HTTP request rejects oversized content length before reading a body', async () => {
  let reads = 0
  await assert.rejects(
    boundedHttpRequest(
      'https://gateway.invalid/readyz',
      {},
      {
        timeoutMs: 100,
        maxResponseBytes: 8,
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: { get: (name) => name.toLowerCase() === 'content-length' ? '9' : null },
          body: null,
          text: async () => { reads += 1; return 'too large' },
        }),
      },
    ),
    (error: unknown) => error instanceof BoundedHttpRequestError && error.code === 'response_too_large',
  )
  assert.equal(reads, 0)
})

test('bounded HTTP request stops streamed bodies as soon as they exceed the byte limit', async () => {
  let cancelled = false
  await assert.rejects(
    boundedHttpRequest(
      'https://gateway.invalid/healthz',
      {},
      {
        timeoutMs: 100,
        maxResponseBytes: 4,
        fetch: async () => ({
          ...streamedResponse(['123', '45']),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('123'))
              controller.enqueue(new TextEncoder().encode('45'))
            },
            cancel() { cancelled = true },
          }),
        }),
      },
    ),
    (error: unknown) => error instanceof BoundedHttpRequestError && error.code === 'response_too_large',
  )
  assert.equal(cancelled, true)
})

test('bounded HTTP request enforces timeout even when its fetch implementation ignores abort', async () => {
  await assert.rejects(
    boundedHttpRequest(
      'https://provider.invalid/slow',
      {},
      { timeoutMs: 5, maxResponseBytes: 16, fetch: async () => new Promise<BoundedHttpResponse>(() => undefined) },
    ),
    (error: unknown) => error instanceof BoundedHttpRequestError && error.code === 'timeout',
  )
})

test('bounded HTTP request honors caller cancellation', async () => {
  const controller = new AbortController()
  const request = boundedHttpRequest(
    'https://provider.invalid/slow',
    { signal: controller.signal },
    { timeoutMs: 1_000, maxResponseBytes: 16, fetch: async () => new Promise<BoundedHttpResponse>(() => undefined) },
  )
  controller.abort()
  await assert.rejects(request, (error: unknown) => error instanceof BoundedHttpRequestError && error.code === 'aborted')
})

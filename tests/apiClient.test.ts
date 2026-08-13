import assert from 'node:assert/strict'
import test from 'node:test'

const responseBody = JSON.stringify({
  ok: false,
  error: {
    code: 'oauth_operation_failed',
    message: 'No active Automnia license is linked to this Google account email.',
    status: 400,
  },
  requestId: 'request-id-for-diagnostics-only',
})

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    clearTimeout,
    fetch: async () => new Response(responseBody, {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
    location: new URL('http://127.0.0.1:4050/'),
    setTimeout,
  },
})

const { apiErrorMessage, apiRequest } = await import('../src/api/client')

test('structured API failures keep login errors human-readable', async () => {
  const result = await apiRequest('/api/auth/account/google/session/test', { authToken: '' })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.detail, undefined)
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

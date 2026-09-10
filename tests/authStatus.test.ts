import assert from 'node:assert/strict'
import test from 'node:test'
import { authStatusDecision } from '../src/api/authStatus'
import type { ApiResult } from '../src/api/client'

function failure(status: number): ApiResult<{ authenticated: boolean }> {
  return {
    ok: false, status, requestId: 'test',
    error: { code: 'test', message: 'test', status, requestId: 'test', url: '/api/auth/status' },
  }
}

test('server interruptions and timeouts do not reject a saved login', () => {
  for (const status of [0, 429, 500, 502, 503, 504]) {
    assert.equal(authStatusDecision(failure(status)), 'unavailable')
  }
})

test('only a definitive authentication result changes login state', () => {
  assert.equal(authStatusDecision(failure(401)), 'rejected')
  for (const authenticated of [true, false]) {
    assert.equal(authStatusDecision({
      ok: true, data: { authenticated }, status: 200, requestId: 'test', response: new Response(),
    }), authenticated ? 'authenticated' : 'rejected')
  }
})

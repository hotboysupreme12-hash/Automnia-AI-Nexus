import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionTokenStore, secureTokenEqual } from '../server/sessionTokenStore'

test('session tokens expire, revoke, evict, clear, and compare safely', () => {
  let now = 10_000
  const store = createSessionTokenStore({ now: () => now, ttlMs: 60_000, maxSessions: 2 })
  const first = store.issue()
  const second = store.issue()
  assert.equal(store.has(first.token), true)
  assert.equal(store.has(second.token), true)
  const third = store.issue()
  assert.equal(store.has(first.token), false)
  assert.equal(store.has(third.token), true)
  assert.equal(store.revoke(second.token), true)
  assert.equal(store.revoke(''), false)
  assert.equal(store.has(''), false)
  assert.equal(store.has(second.token), false)
  now += 60_001
  assert.equal(store.has(third.token), false)
  assert.equal(store.size(), 0)
  store.issue()
  store.clear()
  assert.equal(store.size(), 0)
  assert.equal(secureTokenEqual('abc', 'abc'), true)
  assert.equal(secureTokenEqual('abc', 'abcd'), false)
  assert.equal(secureTokenEqual('', 'abc'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

test('session tokens survive a Control Center process restart without persisting raw tokens', () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'automnia-session-store-'))
  const persistPath = path.join(temporaryDirectory, 'control-center', 'sessions.json')
  try {
    const firstStore = createSessionTokenStore({ persistPath, ttlMs: 60_000, now: () => 10_000 })
    const issued = firstStore.issue()

    const restartedStore = createSessionTokenStore({ persistPath, ttlMs: 60_000, now: () => 10_000 })
    assert.equal(restartedStore.has(issued.token), true)
    assert.equal(restartedStore.revoke(issued.token), true)

    const persistedState = readFileSync(persistPath, 'utf8')
    assert.doesNotMatch(persistedState, new RegExp(issued.token))

    const secondRestartStore = createSessionTokenStore({ persistPath, ttlMs: 60_000, now: () => 10_000 })
    assert.equal(secondRestartStore.has(issued.token), false)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

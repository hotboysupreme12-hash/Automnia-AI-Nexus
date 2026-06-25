import assert from 'node:assert/strict'
import { createSessionTokenStore, secureTokenEqual } from '../server/sessionTokenStore'

let now = 1_700_000_000_000
const store = createSessionTokenStore({ ttlMs: 60_000, maxSessions: 2, now: () => now })

const first = store.issue()
assert.equal(store.has(first.token), true, 'issued session token must be active')
assert.match(first.token, /^[A-Za-z0-9_-]{40,}$/, 'session token must contain at least 256 bits of URL-safe entropy')
assert.equal(store.size(), 1)

const second = store.issue()
const third = store.issue()
assert.equal(store.size(), 2, 'session store must enforce its maximum live-session bound')
assert.equal(store.has(first.token), false, 'oldest session must be evicted when the store is full')
assert.equal(store.has(second.token), true)
assert.equal(store.revoke(second.token), true, 'logout must revoke a live session')
assert.equal(store.has(second.token), false)
assert.equal(store.has(third.token), true)

now += 60_001
assert.equal(store.has(third.token), false, 'expired sessions must fail closed')
assert.equal(store.size(), 0, 'expired sessions must be pruned')

assert.equal(secureTokenEqual('same-token', 'same-token'), true)
assert.equal(secureTokenEqual('same-token', 'other-token'), false)
assert.equal(secureTokenEqual('short', 'longer-token'), false)
assert.equal(secureTokenEqual('', ''), false)

console.log('session token store contract ok')

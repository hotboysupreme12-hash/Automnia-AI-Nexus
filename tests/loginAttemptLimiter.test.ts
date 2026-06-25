import test from 'node:test'
import assert from 'node:assert/strict'
import { createLoginAttemptLimiter } from '../server/loginAttemptLimiter'

test('login attempt limiter backs off, resets, expires, clears, and stays bounded', () => {
  let now = 1_000
  const limiter = createLoginAttemptLimiter({
    now: () => now,
    maxAttempts: 3,
    baseLockoutMs: 1_000,
    maxLockoutMs: 8_000,
    windowMs: 10_000,
    maxEntries: 8,
  })

  assert.equal(limiter.check('').allowed, true)
  assert.equal(limiter.recordFailure('operator').allowed, true)
  assert.equal(limiter.recordFailure('operator').allowed, true)
  const blocked = limiter.recordFailure('operator')
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterMs, 1_000)

  now += 999
  assert.equal(limiter.check('operator').allowed, false)
  now += 1
  assert.equal(limiter.check('operator').allowed, true)
  assert.equal(limiter.recordFailure('operator').retryAfterMs, 2_000)

  limiter.recordSuccess('operator')
  assert.equal(limiter.check('operator').failures, 0)

  for (let index = 0; index < 30; index += 1) limiter.recordFailure(`key-${index}`)
  assert.ok(limiter.size() <= 8)
  limiter.clear()
  assert.equal(limiter.size(), 0)

  limiter.recordFailure('expired')
  now += 20_000
  assert.equal(limiter.size(), 0)
})

test('invalid limiter options fall back to safe bounded defaults', () => {
  const limiter = createLoginAttemptLimiter({
    windowMs: Number.NaN,
    maxAttempts: Number.POSITIVE_INFINITY,
    baseLockoutMs: -5,
    maxLockoutMs: -5,
    maxEntries: 1,
  })
  assert.equal(limiter.check('operator').allowed, true)
  for (let index = 0; index < 5; index += 1) limiter.recordFailure('operator')
  assert.equal(limiter.check('operator').allowed, false)
})

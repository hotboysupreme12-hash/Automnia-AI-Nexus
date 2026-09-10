import assert from 'node:assert/strict'
import test from 'node:test'
import { usageBaseline, formatUsageRemaining } from '../src/utils/usageRemaining'

test('any starting balance represents 100%, with proportional depletion', () => {
  for (const balance of [100, 1000, 9_602_250]) {
    assert.equal(formatUsageRemaining(balance, usageBaseline(balance, null, null)), '100%')
    assert.equal(formatUsageRemaining(balance / 2, balance), '50%')
  }
  assert.equal(formatUsageRemaining(90, 100), '90%')
  assert.equal(formatUsageRemaining(990, 1000), '99%')
  assert.equal(formatUsageRemaining(9_602_250, 10_000_000), '96.02%')
  assert.equal(formatUsageRemaining(9_597_983, 10_000_000), '95.98%')
})

test('spending and refresh preserve baseline, refills reset it', () => {
  assert.equal(usageBaseline(800, 1000, 1000), 1000)
  assert.equal(usageBaseline(800, 800, 1000), 1000)
  assert.equal(usageBaseline(900, 800, 1000), 900)
  assert.equal(usageBaseline(0, 800, 1000), 1000)
  assert.equal(usageBaseline(null, 800, 1000), 1000)
})

test('empty, unknown and tiny balances remain truthful', () => {
  assert.equal(formatUsageRemaining(0, 0), '0%')
  assert.equal(formatUsageRemaining(null, 1000), 'Awaiting usage confirmation')
  assert.equal(formatUsageRemaining(1, 1000000), '<0.01%')
  assert.equal(formatUsageRemaining(999999, 1000000), '99.99%')
})

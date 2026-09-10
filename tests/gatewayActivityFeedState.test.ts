import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileGatewayActivityFeed } from '../src/hooks/gatewayActivityFeedState'
import type { GatewayActivityFeed } from '../src/hooks/useGatewayActivityFeed'

const makeFeed = (message: string, level = 'info'): GatewayActivityFeed => ({
  generatedAt: '2026-09-10T12:00:00Z', storage: 'durable-ledger',
  entries: [{ id: 1, timestamp: '2026-09-10T12:00:00Z', stream: 'gateway', message, level }],
})

test('log updates survive repeated React updater evaluations without mutating previous state', () => {
  const previous = { feed: makeFeed('old'), error: '' }
  const feed = makeFeed('new')
  const first = reconcileGatewayActivityFeed(previous, feed)
  const second = reconcileGatewayActivityFeed(previous, feed)
  assert.equal(first.feed, feed)
  assert.equal(second.feed, feed)
  assert.equal(previous.feed.entries[0].message, 'old')
  assert.equal(reconcileGatewayActivityFeed({ feed: null, error: '' }, feed).feed, feed)
})

test('unchanged log polls preserve identity and clear errors without replacing the feed', () => {
  const previous = { feed: makeFeed('same'), error: '' }
  assert.equal(reconcileGatewayActivityFeed(previous, { ...makeFeed('same'), generatedAt: 'later' }), previous)
  const recovered = reconcileGatewayActivityFeed({ ...previous, error: 'offline' }, makeFeed('same'))
  assert.equal(recovered.feed, previous.feed)
  assert.equal(recovered.error, '')
})

test('delimiters in log fields cannot hide changed entries', () => {
  const previous = { feed: makeFeed('a|b', 'c'), error: '' }
  const changed = makeFeed('a', 'b|c')
  assert.equal(reconcileGatewayActivityFeed(previous, changed).feed, changed)
})

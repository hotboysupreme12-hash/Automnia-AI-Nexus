import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commandConsoleQueueCancellation,
  commandConsoleQueueCancellationPatch,
  commandConsoleQueueCancellationForFollowup,
  commandConsoleQueueAgeMs,
  isCommandConsoleQueueStale,
  STALE_COMMAND_CONSOLE_QUEUE_AGE_MS,
} from '../src/store/commandConsoleState'

test('command console queue becomes stale at its bounded operator review threshold', () => {
  const queuedAtMs = 1_800_000_000_000
  const queuedAt = new Date(queuedAtMs).toISOString()

  assert.equal(commandConsoleQueueAgeMs(queuedAt, queuedAtMs), 0)
  assert.equal(isCommandConsoleQueueStale(queuedAt, queuedAtMs + STALE_COMMAND_CONSOLE_QUEUE_AGE_MS - 1), false)
  assert.equal(isCommandConsoleQueueStale(queuedAt, queuedAtMs + STALE_COMMAND_CONSOLE_QUEUE_AGE_MS), true)
})

test('invalid queue timestamps do not create a stale warning and future timestamps have zero age', () => {
  assert.equal(commandConsoleQueueAgeMs(undefined, 1_800_000_000_000), null)
  assert.equal(commandConsoleQueueAgeMs('not-a-date', 1_800_000_000_000), null)
  assert.equal(isCommandConsoleQueueStale('not-a-date', 1_800_000_000_000), false)
  assert.equal(commandConsoleQueueAgeMs(new Date(1_800_000_000_001).toISOString(), 1_800_000_000_000), 0)
})

test('operator cancellation includes a stale wait reason only after the threshold', () => {
  assert.deepEqual(commandConsoleQueueCancellation(STALE_COMMAND_CONSOLE_QUEUE_AGE_MS - 1), {
    stale: false,
    message: 'Queued Command Console follow-up was cancelled before it started.',
  })
  assert.deepEqual(commandConsoleQueueCancellation(STALE_COMMAND_CONSOLE_QUEUE_AGE_MS), {
    stale: true,
    message: 'Stale queued Command Console follow-up cancelled by operator after waiting 15 minutes.',
  })
})

test('follow-up cancellation summary preserves wait age and agent in feed receipt', () => {
  const now = 1_800_000_000_000
  const recent = commandConsoleQueueCancellationForFollowup(new Date(now - 1_000).toISOString(), now - 1_000, 'agent-a', now)
  assert.equal(recent.stale, false)
  assert.equal(recent.feedMessage, 'Queued Command Console follow-up cancelled for agent-a.')

  const stale = commandConsoleQueueCancellationForFollowup(new Date(now - STALE_COMMAND_CONSOLE_QUEUE_AGE_MS).toISOString(), now, 'agent-b', now)
  assert.equal(stale.stale, true)
  assert.match(stale.message, /after waiting 15 minutes/)
  assert.equal(stale.feedMessage, 'Stale queued Command Console follow-up cancelled by operator for agent-b after waiting 15 minutes.')
  assert.deepEqual(commandConsoleQueueCancellationPatch(stale, new Date(now).toISOString()), {
    response: stale.message,
    ok: false,
    streaming: false,
    failureKind: 'aborted',
    completedAt: new Date(now).toISOString(),
    queuePosition: undefined,
    queueDepth: undefined,
    progressLabel: 'Cancelled',
    progressLines: [stale.message],
    progressUpdatedAt: new Date(now).toISOString(),
  })
})

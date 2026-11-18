import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY,
  commandConsoleQueueCancellation,
  commandConsoleQueueCancellationPatch,
  commandConsoleQueueCancellationForFollowup,
  commandConsoleQueueAgeMs,
  expireCommandConsoleFollowup,
  interruptQueuedCommandConsoleFollowups,
  isCommandConsoleQueueStale,
  makeCommandConsoleResponseState,
  readCommandConsoleQueueReceipts,
  STALE_COMMAND_CONSOLE_QUEUE_AGE_MS,
  writeCommandConsoleQueueReceipt,
  type CommandConsoleQueueReceipt,
  type CommandConsoleQueueReceiptStorage,
} from '../src/store/commandConsoleState'

function makeReceiptStorage(): CommandConsoleQueueReceiptStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

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

test('queue expiration writes a reason receipt and stops the visible queued row', () => {
  const storage = makeReceiptStorage()
  const queuedAt = new Date(1_800_000_000_000).toISOString()
  const completedAt = new Date(1_800_000_000_100).toISOString()
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []

  expireCommandConsoleFollowup(
    { id: 'expired-1', queuedAt },
    'agent-a',
    (id, patch) => updates.push({ id, patch }),
    completedAt,
    storage,
  )

  assert.deepEqual(readCommandConsoleQueueReceipts(storage), [{
    id: 'expired-1',
    agentId: 'agent-a',
    queuedAt,
    status: 'expired',
    reason: 'Queued Command Console turn expired after waiting 6h for the lane to become free.',
    completedAt,
  }])
  assert.equal(updates[0]?.patch.failureKind, 'timeout')
  assert.equal(updates[0]?.patch.streaming, false)
})

test('clearing queued work records interrupted receipts without storing executable payloads', () => {
  const storage = makeReceiptStorage()
  const queuedAt = new Date(1_800_000_000_000).toISOString()
  const completedAt = new Date(1_800_000_000_100).toISOString()
  const queued = {
    id: 'interrupted-1',
    agentId: 'agent-a',
    prompt: 'private prompt',
    visiblePrompt: 'private prompt',
    options: { token: 'private-option' },
    queuedAt,
    createdAt: Date.parse(queuedAt),
  }
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []

  interruptQueuedCommandConsoleFollowups(
    new Map([['agent-a', [queued]]]),
    (id, patch) => updates.push({ id, patch }),
    completedAt,
    storage,
  )

  assert.equal(readCommandConsoleQueueReceipts(storage)[0]?.status, 'interrupted')
  assert.match(readCommandConsoleQueueReceipts(storage)[0]?.reason || '', /not replayed/)
  assert.equal(updates[0]?.patch.failureKind, 'interrupted')
  assert.equal(updates[0]?.patch.streaming, false)
  const raw = storage.values.get(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY) || ''
  assert.equal(raw.includes('private prompt'), false)
  assert.equal(raw.includes('private-option'), false)
})

test('queue receipts persist capped metadata only and strip prompts/options', () => {
  const storage = makeReceiptStorage()
  const now = 1_800_000_000_000
  for (let index = 0; index <= 80; index += 1) {
    writeCommandConsoleQueueReceipt({
      id: `queued-${index}`,
      agentId: 'agent-a',
      queuedAt: new Date(now + index).toISOString(),
      status: 'queued',
      prompt: 'private prompt',
      options: { attachments: [{ name: 'private-file.png' }] },
    } as CommandConsoleQueueReceipt, storage)
  }

  const raw = storage.values.get(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY) || ''
  const receipts = readCommandConsoleQueueReceipts(storage)
  assert.equal(receipts.length, 80)
  assert.equal(receipts[0]?.id, 'queued-1')
  assert.equal(receipts.at(-1)?.id, 'queued-80')
  assert.equal(raw.includes('private prompt'), false)
  assert.equal(raw.includes('private-file.png'), false)
  assert.deepEqual(Object.keys(receipts[0] || {}).sort(), ['agentId', 'id', 'queuedAt', 'status'])
})

test('reload converts queued receipts into interrupted, non-runnable response rows', () => {
  const storage = makeReceiptStorage()
  const queuedAt = new Date(1_800_000_000_000).toISOString()
  writeCommandConsoleQueueReceipt({ id: 'queued-1', agentId: 'agent-a', queuedAt, status: 'queued' }, storage)

  const restored = makeCommandConsoleResponseState(storage, Date.parse(queuedAt) + 5000)
  const response = restored.agentResponses[0]
  assert.equal(response?.id, 'queued-1')
  assert.equal(response?.prompt, 'Queued Command Console turn')
  assert.equal(response?.streaming, false)
  assert.equal(response?.failureKind, 'interrupted')
  assert.match(response?.response || '', /not replayed/)
  assert.equal('options' in (response || {}), false)
  assert.equal(restored.busyAgentIds.length, 0)
  assert.equal(readCommandConsoleQueueReceipts(storage)[0]?.status, 'interrupted')
  assert.match(storage.values.get(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY) || '', /not replayed/)
})

test('reload restores cancellation reasons and marks a started receipt interrupted without restoring work', () => {
  const storage = makeReceiptStorage()
  const queuedAt = new Date(1_800_000_000_000).toISOString()
  const cancelledAt = new Date(1_800_000_000_100).toISOString()
  storage.values.set(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY, JSON.stringify([
    { id: 'cancelled-1', agentId: 'agent-a', queuedAt, status: 'cancelled', reason: 'Cancelled by operator after 20 minutes.', completedAt: cancelledAt },
    { id: 'started-1', agentId: 'agent-a', queuedAt, status: 'started' },
    { id: 'malformed-1', agentId: 'agent-a', queuedAt: 'not-a-date', status: 'failed' },
  ]))

  const restored = makeCommandConsoleResponseState(storage)
  assert.equal(restored.agentResponses.length, 2)
  const cancelled = restored.agentResponses.find((entry) => entry.id === 'cancelled-1')
  const started = restored.agentResponses.find((entry) => entry.id === 'started-1')
  assert.equal(cancelled?.failureKind, 'aborted')
  assert.equal(cancelled?.response, 'Cancelled by operator after 20 minutes.')
  assert.equal(cancelled?.streaming, false)
  assert.equal(started?.failureKind, 'interrupted')
  assert.equal(started?.streaming, false)
  assert.match(started?.response || '', /not restored or replayed/)
  assert.equal(restored.agentResponses.some((entry) => entry.id === 'malformed-1'), false)
  assert.equal(readCommandConsoleQueueReceipts(storage).find((entry) => entry.id === 'started-1')?.status, 'interrupted')
})

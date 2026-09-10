import assert from 'node:assert/strict'
import test from 'node:test'
import { ConsoleRunSnapshots } from '../server/services/agents/consoleRunSnapshots'

const frame = (event: string, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), responseId: 'message-1', clawTalkRunId: 'run-1',
  agentId: 'architect', timestamp: '2026-09-08T01:00:00Z', event, ...extra,
})

test('reload restores quiet active turns and complete text beyond the event ring', () => {
  const cache = new ConsoleRunSnapshots()
  cache.record(frame('start', { prompt: 'Build it' }))
  for (let i = 0; i < 350; i++) cache.record(frame('delta', { text: 'hello ' }))
  cache.record(frame('status', { message: 'Running tests', label: 'Testing' }))
  const [restored] = cache.values()
  assert.equal(restored.text, 'hello '.repeat(350))
  assert.equal(restored.prompt, 'Build it')
  assert.equal(restored.progressText, 'Running tests')
  assert.equal(restored.label, 'Testing')
  assert.equal(restored.snapshot, true)
  assert.equal(restored.responseId, 'message-1')
})

test('absolute snapshots make repeated reconnects idempotent and preserve compacted finals', () => {
  const cache = new ConsoleRunSnapshots()
  cache.record(frame('delta', { text: 'old' }))
  const replacement = cache.record(frame('delta', { text: 'Full reply', replace: true }))
  assert.equal(replacement.text, 'Full reply')
  cache.record(frame('final', { reply: 'Full…', sseCompacted: true, ok: true }))
  assert.equal(cache.values()[0].text, 'Full reply')
  assert.deepEqual(cache.values(), cache.values())
  assert.equal(cache.values()[0].event, 'final')
})

test('retention evicts completed turns while preserving active runs and clear respects agent scope', () => {
  const cache = new ConsoleRunSnapshots(2)
  cache.record(frame('start'))
  for (let i = 0; i < 4; i++) cache.record(frame('final', { responseId: `done-${i}`, agentId: 'other', reply: 'Done' }))
  assert.equal(cache.values().length, 3)
  assert.equal(cache.values()[0].responseId, 'message-1')
  cache.clear('architect')
  assert.equal(cache.values().length, 2)
  cache.clear()
  assert.equal(cache.values().length, 0)
})

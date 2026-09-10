import assert from 'node:assert/strict'
import test from 'node:test'
import { indexResponseActivity, responseMatchesQuery } from '../src/store/responseHistoryIndex'
import type { AgentResponse } from '../src/types/nexus'

test('large history indexing retains the newest live response and counts each agent queue once', () => {
  const entries: AgentResponse[] = Array.from({ length: 800 }, (_, index) => ({ id: String(index), agentId: `agent-${index % 4}`, prompt: `Task ${index}`, response: `Answer ${index}`, ok: true, streaming: index < 400, transport: index % 3 === 0 ? 'command-console-queue' : 'gateway', timestamp: '2026-09-07T12:00:00Z', durationMs: 0 }))
  const result = indexResponseActivity(entries)
  assert.equal(result.queuedResponseCount, 134)
  assert.equal(result.activeResponseByAgent.get('agent-1'), entries[1])
  assert.equal(result.activeResponseByAgent.get('agent-0'), entries[4])
  assert.equal(entries[0].id, '0')
  assert.equal(entries[799].id, '799')
  assert.equal(responseMatchesQuery(entries[799], 'answer 799', 'Operator'), true)
  assert.equal(responseMatchesQuery(entries[799], 'operator', 'Operator'), true)
  assert.equal(responseMatchesQuery(entries[799], 'missing', 'Operator'), false)
  const changed = { ...entries[799], response: 'New result' }
  assert.equal(responseMatchesQuery(changed, 'new result', 'Operator'), true)
  assert.equal(responseMatchesQuery(entries[799], 'answer 799', 'Operator'), true)
})

test('search and older history pages bound rendering while keeping every match reachable', async () => {
  const { selectResponseHistory } = await import('../src/store/responseHistoryIndex')
  const entries: AgentResponse[] = Array.from({ length: 800 }, (_, index) => ({
    id: String(index), agentId: 'agent', prompt: `Task ${index}`, response: 'Answer',
    ok: true, timestamp: '2026-09-07T12:00:00Z', durationMs: 0,
  }))
  const first = selectResponseHistory(entries, ' ANSWER ', () => 'Operator', 60)
  assert.equal(first.total, 800)
  assert.equal(first.entries.length, 60)
  assert.equal(first.entries[0].id, '59')
  assert.equal(first.entries.at(-1)?.id, '0')
  const older = selectResponseHistory(entries, 'answer', () => 'Operator', 120)
  assert.equal(older.entries.length, 120)
  assert.deepEqual(older.entries.slice(-60), first.entries)
  const all = selectResponseHistory(entries, 'operator', () => 'Operator', 840)
  assert.equal(all.entries.length, 800)
  assert.equal(selectResponseHistory(entries, 'missing', () => 'Operator', 60).total, 0)
  assert.equal(selectResponseHistory(entries, '', () => 'Operator', 60).entries.length, 60)
  assert.equal(entries[0].id, '0', 'selection must not reorder store history')
})

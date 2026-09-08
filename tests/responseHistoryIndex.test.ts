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

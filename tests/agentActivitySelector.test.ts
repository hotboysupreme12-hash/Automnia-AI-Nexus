import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentActivitySelector } from '../src/store/agentActivitySelector'
import type { AgentResponse } from '../src/types/nexus'

test('streamed answer text does not invalidate roster summaries; tool changes do', () => {
  const select = createAgentActivitySelector()
  const first = { id: 'a', agentId: 'alpha', streaming: true, response: 'Hello', activity: [{ type: 'message.partial', label: '5 characters' }] } as AgentResponse
  const original = select({ agentResponses: [first] })
  assert.equal(select({ agentResponses: [{ ...first, response: 'Hello again', activity: [{ type: 'message.partial', label: '11 characters' }] } as AgentResponse] }), original)
  const tooling = select({ agentResponses: [{ ...first, activity: [{ type: 'tool.started', label: 'Reading file' }] } as AgentResponse] })
  assert.notEqual(tooling, original)
  assert.equal(tooling.get('alpha')?.label, 'Using tools')
  assert.equal(select({ agentResponses: [{ ...first, streaming: false }] }).size, 0)
})

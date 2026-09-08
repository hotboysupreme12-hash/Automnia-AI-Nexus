import assert from 'node:assert/strict'
import test from 'node:test'
import { boundConversationMessages, CONVERSATION_TRUNCATION_MARKER } from '../server/services/agents/conversationBudgetService'

test('oversized final message pairs obey the aggregate context budget without mutating originals', () => {
  const messages = [
    { role: 'user' as const, content: 'Objective: ' + 'x'.repeat(100000) + ' final instruction' },
    { role: 'assistant' as const, content: 'Result: ' + 'y'.repeat(100000) + ' final result', reasoningContent: 'z'.repeat(100000) },
  ]
  const result = boundConversationMessages(messages, 8, 32000)
  assert.equal(result.reduce((sum, entry) => sum + entry.content.length + (entry.reasoningContent?.length || 0), 0), 32000)
  assert.equal(result.every((entry) => entry.content.includes(CONVERSATION_TRUNCATION_MARKER)), true)
  assert.match(result[0].content, /^Objective: /)
  assert.match(result[0].content, /final instruction$/)
  assert.equal(messages[0].content.length > 100000, true)
})

test('all small and normal context budgets remain hard limits, including a single message', () => {
  for (const limit of [1, 2, 8, CONVERSATION_TRUNCATION_MARKER.length, CONVERSATION_TRUNCATION_MARKER.length + 1, 32000]) {
    const result = boundConversationMessages([{ role: 'user', content: 'q'.repeat(100000) }], 8, limit)
    assert.equal(result[0].content.length <= limit, true)
  }
})

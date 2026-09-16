import assert from 'node:assert/strict'
import test from 'node:test'

import { describeAgentModel } from '../src/utils/agentModelDisplay'

test('agent cards use customer-facing Automnia model classes', () => {
  const cases = [
    ['automnia-cloud/gemini-3.8-flash', 'Automnia Prime'],
    ['automnia-cloud/gemini-3.7-flash', 'Automnia Balanced'],
    ['automnia-cloud/gemini-3.6-flash', 'Automnia Swift'],
    ['automnia-cloud/gemini-2.5-flash', 'Automnia Classic'],
  ] as const

  for (const [modelId, expected] of cases) {
    const display = describeAgentModel(modelId)
    assert.equal(display.providerLabel, 'Automnia')
    assert.equal(display.modelLabel, expected)
    assert.equal(display.cardLabel, expected)
    assert.doesNotMatch(display.cardLabel, /gemini/i)
    assert.equal(display.isAutomnia, true)
  }
})

test('agent cards identify Codex while preserving the selected model', () => {
  assert.deepEqual(describeAgentModel('openai/gpt-5.6-luna'), {
    providerLabel: 'Codex',
    modelLabel: 'GPT 5.6 Luna',
    cardLabel: 'Codex · GPT 5.6 Luna',
    title: 'Codex · GPT 5.6 Luna',
    isAutomnia: false,
  })
  assert.equal(describeAgentModel('openai-codex/gpt-5.6-terra').cardLabel, 'Codex · GPT 5.6 Terra')
})

test('agent cards retain the selected model name for other providers', () => {
  const display = describeAgentModel('anthropic/claude-fable-5-1')
  assert.equal(display.providerLabel, 'Anthropic Claude')
  assert.equal(display.modelLabel, 'Claude Fable 5.1')
  assert.equal(display.cardLabel, 'Anthropic Claude · Claude Fable 5.1')
})

test('agent cards use an explicit unassigned state when no model is configured', () => {
  assert.equal(describeAgentModel(undefined).cardLabel, 'Unassigned')
  assert.equal(describeAgentModel('').title, 'No primary model assigned')
})

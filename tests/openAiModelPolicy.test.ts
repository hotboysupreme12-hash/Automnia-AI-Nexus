import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isOpenAiAstraModel,
  isOpenAiLunaModel,
  isOpenAiReasoningModel,
  openAiChatCompletionsReasoningPatch,
  openAiReasoningEffortForModel,
  openAiResponsesReasoningPatch,
  openAiThinkingForRuntime,
} from '../server/services/providers/openAiModelPolicy'

test('GPT-6 Astra is recognized across provider-qualified model IDs', () => {
  assert.equal(isOpenAiAstraModel('gpt-6-astra'), true)
  assert.equal(isOpenAiAstraModel('openai/gpt-6-astra'), true)
  assert.equal(isOpenAiAstraModel('gpt-5.6-sol'), false)
  assert.equal(isOpenAiReasoningModel('openai/gpt-6-astra'), true)
  assert.equal(isOpenAiReasoningModel('openai/gpt-6.1-sol'), true)
  assert.equal(isOpenAiReasoningModel('openai/gpt-6-luna'), true)
})

test('GPT-6 Astra maps broad app thinking choices to supported reasoning efforts', () => {
  assert.equal(openAiReasoningEffortForModel('gpt-6-astra', 'off'), 'low')
  assert.equal(openAiReasoningEffortForModel('gpt-6-astra', 'minimal'), 'low')
  assert.equal(openAiReasoningEffortForModel('gpt-6-astra', 'medium'), 'medium')
  assert.equal(openAiReasoningEffortForModel('gpt-6-astra', 'xhigh'), 'xhigh')
  assert.equal(openAiThinkingForRuntime('openai/gpt-6-astra', 'off'), 'low')
  assert.equal(openAiThinkingForRuntime('openai/gpt-6-astra', 'minimal'), 'low')
  assert.deepEqual(openAiResponsesReasoningPatch('openai/gpt-6-astra', 'minimal'), {
    reasoning: { effort: 'low' },
  })
  assert.deepEqual(openAiChatCompletionsReasoningPatch('openai/gpt-6-astra', 'high'), {
    reasoning_effort: 'high',
  })
})

test('GPT-5.6 Luna is clamped to its Gateway-supported off-only reasoning mode', () => {
  assert.equal(isOpenAiLunaModel('openai/gpt-5.6-luna'), true)
  assert.equal(isOpenAiLunaModel('openai/gpt-6-luna'), false)
  assert.equal(openAiThinkingForRuntime('openai/gpt-5.6-luna', 'low'), 'off')
  assert.equal(openAiThinkingForRuntime('openai/gpt-5.6-luna', 'high'), 'off')
  assert.equal(openAiReasoningEffortForModel('openai/gpt-5.6-luna', 'low'), 'none')
})

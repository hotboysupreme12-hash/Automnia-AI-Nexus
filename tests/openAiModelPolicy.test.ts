import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isOpenAiAstraModel,
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

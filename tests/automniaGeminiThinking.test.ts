import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP,
  thinkingForAutomniaGeminiRuntimeModel,
} from '../server/services/providers/automniaGeminiThinking'
import {
  geminiThinkingConfigFromOpenAiRequest,
} from '../infra/gcloud/service/geminiThinking.js'

test('Automnia Gemini 3.7 runtime clamps app choices to supported thinking levels', () => {
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.7-flash', 'off'), 'low')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.7-flash', 'minimal'), 'low')
  for (const level of ['low', 'medium', 'high'] as const) {
    assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.7-flash', level), level)
  }
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.7-flash', 'xhigh'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.7-flash', 'max'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('google/gemini-3.6-flash', 'max'), 'max')
})

test('Automnia Gemini config keeps every app thinking choice on a supported relay level', () => {
  assert.deepEqual(AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP, {
    off: 'low',
    minimal: 'low',
    xhigh: 'high',
    max: 'high',
  })
  assert.deepEqual(AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT.reasoningEffortMap, {
    off: 'low',
    minimal: 'low',
    none: 'low',
    xhigh: 'high',
    max: 'high',
  })
})

test('Automnia relay maps every app thinking choice to a Gemini 3.7 native level', () => {
  const expectations = {
    off: 'LOW',
    none: 'LOW',
    minimal: 'LOW',
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
    xhigh: 'HIGH',
    max: 'HIGH',
  }
  for (const [requested, expected] of Object.entries(expectations)) {
    assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: requested }, 'gemini-3.7-flash'), { thinkingLevel: expected })
  }
  assert.equal(geminiThinkingConfigFromOpenAiRequest({}), undefined)
  assert.equal(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'invalid' }, 'gemini-3.7-flash'), undefined)
  assert.equal(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'high' }, 'gemini-2.5-flash'), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTOMNIA_GEMINI_36_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_36_OPENCLAW_THINKING_LEVEL_MAP,
  thinkingForAutomniaGeminiRuntimeModel,
} from '../server/services/providers/automniaGeminiThinking'
import {
  gemini36ThinkingConfigFromOpenAiRequest,
} from '../infra/gcloud/service/geminiThinking.js'

test('Automnia Gemini runtime clamps only unsupported extended thinking levels', () => {
  for (const level of ['off', 'minimal', 'low', 'medium', 'high'] as const) {
    assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.6-flash', level), level)
  }
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.6-flash', 'xhigh'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.6-flash', 'max'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('google/gemini-3.6-flash', 'max'), 'max')
})

test('Automnia Gemini config keeps every app thinking choice on a supported relay level', () => {
  assert.deepEqual(AUTOMNIA_GEMINI_36_OPENCLAW_THINKING_LEVEL_MAP, {
    off: 'minimal',
    xhigh: 'high',
    max: 'high',
  })
  assert.deepEqual(AUTOMNIA_GEMINI_36_OPENAI_REASONING_COMPAT.reasoningEffortMap, {
    off: 'minimal',
    none: 'minimal',
    xhigh: 'high',
    max: 'high',
  })
})

test('Automnia relay maps every app thinking choice to a Gemini 3.6 native level', () => {
  const expectations = {
    off: 'MINIMAL',
    none: 'MINIMAL',
    minimal: 'MINIMAL',
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
    xhigh: 'HIGH',
    max: 'HIGH',
  }
  for (const [requested, expected] of Object.entries(expectations)) {
    assert.deepEqual(gemini36ThinkingConfigFromOpenAiRequest({ reasoning_effort: requested }), { thinkingLevel: expected })
  }
  assert.equal(gemini36ThinkingConfigFromOpenAiRequest({}), undefined)
  assert.equal(gemini36ThinkingConfigFromOpenAiRequest({ reasoning_effort: 'invalid' }), undefined)
})

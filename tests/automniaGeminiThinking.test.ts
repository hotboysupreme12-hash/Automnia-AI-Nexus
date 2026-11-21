import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTOMNIA_GEMINI_4_HYDROGEN_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP,
  automniaThinkingDefaultForModel,
  thinkingForAutomniaGeminiRuntimeModel,
} from '../server/services/providers/automniaGeminiThinking'
import {
  geminiThinkingConfigFromOpenAiRequest,
} from '../infra/gcloud/service/geminiThinking.js'

test('Automnia Gemini runtime clamps app choices to supported thinking levels', () => {
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-hydrogen', 'off'), 'low')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-hydrogen', 'minimal'), 'low')
  for (const level of ['low', 'medium', 'high'] as const) {
    assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-hydrogen', level), level)
  }
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-hydrogen', 'xhigh'), 'xhigh')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-hydrogen', 'max'), 'xhigh')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-neon', 'minimal'), 'low')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-neon', 'xhigh'), 'xhigh')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-neon', 'max'), 'xhigh')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('google/gemini-3.6-flash', 'max'), 'max')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.8-flash', 'off'), 'low')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-3.8-flash', 'max'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-argon', 'off'), 'low')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-argon', 'max'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-carbon', 'xhigh'), 'high')
  assert.equal(thinkingForAutomniaGeminiRuntimeModel('automnia-cloud/gemini-4-carbon', 'max'), 'high')
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
  assert.deepEqual(AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT.supportedReasoningEfforts, ['low', 'medium', 'high'])
  assert.deepEqual(AUTOMNIA_GEMINI_4_HYDROGEN_OPENAI_REASONING_COMPAT.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh'])
  assert.equal(automniaThinkingDefaultForModel('automnia-cloud/gemini-4-hydrogen'), 'high')
  assert.equal(automniaThinkingDefaultForModel('automnia-cloud/gemini-4-neon'), 'high')
  assert.equal(automniaThinkingDefaultForModel('automnia-cloud/gemini-4-argon'), 'medium')
  assert.equal(automniaThinkingDefaultForModel('automnia-cloud/gemini-4-carbon'), 'medium')
  assert.equal(automniaThinkingDefaultForModel('automnia-cloud/gemini-3.8-flash'), 'medium')
})

test('Automnia relay maps thinking effort to the supported Gemini 4 and 3.8 levels', () => {
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
    assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: requested }, 'gemini-3.8-flash'), { thinkingLevel: expected })
    assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: requested }, 'gemini-4-argon'), { thinkingLevel: expected })
    assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: requested }, 'gemini-4-carbon'), { thinkingLevel: expected })
  }
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'xhigh' }, 'gemini-4-hydrogen'), { thinkingLevel: 'XHIGH' })
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'xhigh' }, 'gemini-4-neon'), { thinkingLevel: 'XHIGH' })
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'max' }, 'gemini-4-neon'), { thinkingLevel: 'XHIGH' })
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'minimal' }, 'gemini-4-neon'), { thinkingLevel: 'LOW' })
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'max' }, 'gemini-4-hydrogen'), { thinkingLevel: 'XHIGH' })
  assert.deepEqual(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'minimal' }, 'gemini-4-hydrogen'), { thinkingLevel: 'LOW' })
  assert.equal(geminiThinkingConfigFromOpenAiRequest({}), undefined)
  assert.equal(geminiThinkingConfigFromOpenAiRequest({ reasoning_effort: 'invalid' }, 'gemini-4-hydrogen'), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  googleGeminiModelDisallowsCustomSampling,
  googleGeminiThinkingForModel,
  isGoogleGemini31ProModel,
  isGoogleGemini35FlashLiteModel,
  isGoogleGemini38FlashModel,
  isGoogleGemini37FlashModel,
  isGoogleGemini4ArgonModel,
  isGoogleGemini4CarbonModel,
  isGoogleGemini4HydrogenModel,
} from '../server/services/providers/googleGeminiModelPolicy'

test('Gemini 3.7 Flash normalizes app thinking choices to supported levels', () => {
  assert.equal(isGoogleGemini31ProModel('google/gemini-3.1-pro-preview'), true)
  assert.equal(isGoogleGemini31ProModel('gemini-3.1-pro-preview-customtools'), true)
  assert.equal(isGoogleGemini35FlashLiteModel('google-vertex/gemini-3.5-flash-lite'), true)
  assert.equal(isGoogleGemini37FlashModel('gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('models/gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('google-vertex/gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('gemini-3.6-flash'), false)
  assert.equal(isGoogleGemini38FlashModel('gemini-3.8-flash'), true)
  assert.equal(isGoogleGemini38FlashModel('google/gemini-3.7-flash'), false)
  assert.equal(isGoogleGemini4HydrogenModel('google/gemini-4-hydrogen'), true)
  assert.equal(isGoogleGemini4ArgonModel('publishers/google/models/gemini-4-argon'), true)
  assert.equal(isGoogleGemini4CarbonModel('models/gemini-4-carbon'), true)

  assert.equal(googleGeminiThinkingForModel('google/gemini-3.7-flash', 'off'), 'low')
  assert.equal(googleGeminiThinkingForModel('google-vertex/gemini-3.7-flash', 'minimal'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'low'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'medium'), 'medium')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'high'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'xhigh'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'max'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.8-flash', 'off'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.8-flash', 'max'), 'high')
  assert.equal(googleGeminiThinkingForModel('google/gemini-3.1-pro-preview', 'off'), 'low')
  assert.equal(googleGeminiThinkingForModel('google-vertex/gemini-3.1-pro-preview', 'minimal'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.1-pro-preview', 'max'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.5-flash-lite', 'minimal'), 'minimal')
  assert.equal(googleGeminiThinkingForModel('gemini-3.6-flash', 'minimal'), 'minimal')
  assert.equal(googleGeminiThinkingForModel('gemini-4-hydrogen', 'max'), 'xhigh')
  assert.equal(googleGeminiThinkingForModel('gemini-4-hydrogen', 'xhigh'), 'xhigh')
  assert.equal(googleGeminiThinkingForModel('gemini-4-hydrogen', 'off'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-4-argon', 'max'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-4-carbon', 'xhigh'), 'high')
})

test('Gemini Flash contracts omit custom sampling where Google disallows it', () => {
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.5-flash-lite'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.6-flash'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('publishers/google/models/gemini-3.7-flash'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.8-flash'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-4-hydrogen'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('google/gemini-4-argon'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('publishers/google/models/gemini-4-carbon'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.5-flash'), false)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.6-pro'), false)
})

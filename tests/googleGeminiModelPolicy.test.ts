import assert from 'node:assert/strict'
import test from 'node:test'

import {
  googleGeminiModelDisallowsCustomSampling,
  googleGeminiThinkingForModel,
  isGoogleGemini37FlashModel,
} from '../server/services/providers/googleGeminiModelPolicy'

test('Gemini 3.7 Flash normalizes app thinking choices to supported levels', () => {
  assert.equal(isGoogleGemini37FlashModel('gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('models/gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('google-vertex/gemini-3.7-flash'), true)
  assert.equal(isGoogleGemini37FlashModel('gemini-3.6-flash'), false)

  assert.equal(googleGeminiThinkingForModel('google/gemini-3.7-flash', 'off'), 'low')
  assert.equal(googleGeminiThinkingForModel('google-vertex/gemini-3.7-flash', 'minimal'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'low'), 'low')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'medium'), 'medium')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'high'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'xhigh'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.7-flash', 'max'), 'high')
  assert.equal(googleGeminiThinkingForModel('gemini-3.6-flash', 'minimal'), 'minimal')
})

test('Gemini 3.6 and 3.7 Flash direct artifact requests omit custom sampling', () => {
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.6-flash'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('publishers/google/models/gemini-3.7-flash'), true)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.5-flash'), false)
  assert.equal(googleGeminiModelDisallowsCustomSampling('gemini-3.6-pro'), false)
})

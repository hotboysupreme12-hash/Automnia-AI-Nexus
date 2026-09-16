import assert from 'node:assert/strict'
import test from 'node:test'

import { groupAvailableModels, isSelectableModelId, modelProviderLabel } from '../src/utils/modelGrouping'

test('Gemini 3.7 Flash is selectable in both Google provider groups', () => {
  const models = [
    { id: 'google/gemini-3.7-flash', alias: 'Gemini 3.7 Flash (GA)', provider: 'google', name: 'gemini-3.7-flash' },
    { id: 'google-vertex/gemini-3.7-flash', alias: 'Vertex Gemini 3.7 Flash (GA)', provider: 'google-vertex', name: 'gemini-3.7-flash' },
  ]

  assert.equal(isSelectableModelId('google/gemini-3.7-flash'), true)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.7-flash'), true)

  const groups = groupAvailableModels(models)
  assert.deepEqual(groups.map((group) => group.key), ['google', 'google-vertex'])
  assert.deepEqual(groups.map((group) => group.models[0]?.id), [
    'google/gemini-3.7-flash',
    'google-vertex/gemini-3.7-flash',
  ])
})

test('current Astra, Fable, and Gemini Flash-Lite models retain their provider grouping', () => {
  const groups = groupAvailableModels([
    { id: 'openai/gpt-6-astra', alias: 'GPT-6 Astra (flagship)', provider: 'openai', name: 'gpt-6-astra' },
    { id: 'anthropic/claude-fable-5-1', alias: 'Claude Fable 5.1 (flagship)', provider: 'anthropic', name: 'claude-fable-5-1' },
    { id: 'google/gemini-3.5-flash-lite', alias: 'Gemini 3.5 Flash-Lite (GA)', provider: 'google', name: 'gemini-3.5-flash-lite' },
    { id: 'google-vertex/gemini-3.5-flash-lite', alias: 'Vertex Gemini 3.5 Flash-Lite (GA)', provider: 'google-vertex', name: 'gemini-3.5-flash-lite' },
  ])

  assert.deepEqual(groups.map((group) => group.key), ['openai', 'anthropic', 'google', 'google-vertex'])
  assert.equal(groups.every((group) => group.models.length === 1), true)
})

test('Only Gemini 3.7 Flash is selectable for the Google 3.7 model family', () => {
  assert.equal(isSelectableModelId('google/gemini-3.7-reasoning'), false)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.7-reasoning'), false)
})

test('Automnia is a provider with a managed default model', () => {
  const groups = groupAvailableModels([
    { id: 'openai/gpt-5.6', provider: 'openai', name: 'gpt-5.6' },
    { id: 'automnia-cloud/gemini-3.7-flash', provider: 'automnia-cloud', name: 'Gemini 3.7 Flash' },
  ])

  assert.equal(modelProviderLabel('automnia-cloud'), 'Automnia')
  assert.deepEqual(groups.map((group) => group.key), ['openai', 'automnia-cloud'])
  assert.deepEqual(groups.find((group) => group.key === 'automnia-cloud')?.models.map((model) => model.id), [
    'automnia-cloud/gemini-3.7-flash',
  ])
})

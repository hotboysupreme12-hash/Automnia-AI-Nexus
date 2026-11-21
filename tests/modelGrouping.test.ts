import assert from 'node:assert/strict'
import test from 'node:test'

import { groupAvailableModels, isSelectableModelId, modelProviderLabel } from '../src/utils/modelGrouping'

test('current Gemini models are selectable while superseded Google models are hidden', () => {
  const models = [
    { id: 'google/gemini-3.8-flash', alias: 'Gemini 3.8 Flash', provider: 'google', name: 'gemini-3.8-flash' },
    { id: 'google-vertex/gemini-3.8-flash', alias: 'Vertex Gemini 3.8 Flash', provider: 'google-vertex', name: 'gemini-3.8-flash' },
    { id: 'google/gemini-4-hydrogen', alias: 'Gemini 4 Hydrogen', provider: 'google', name: 'gemini-4-hydrogen' },
    { id: 'google-vertex/gemini-4-argon', alias: 'Vertex Gemini 4 Argon', provider: 'google-vertex', name: 'gemini-4-argon' },
    { id: 'google/gemini-3.7-flash', alias: 'Gemini 3.7 Flash (legacy)', provider: 'google', name: 'gemini-3.7-flash' },
  ]

  assert.equal(isSelectableModelId('google/gemini-3.8-flash'), true)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.8-flash'), true)
  assert.equal(isSelectableModelId('google/gemini-4-hydrogen'), true)
  assert.equal(isSelectableModelId('google-vertex/gemini-4-argon'), true)
  assert.equal(isSelectableModelId('google/gemini-3.7-flash'), false)

  const groups = groupAvailableModels(models)
  assert.deepEqual(groups.map((group) => group.key), ['google', 'google-vertex'])
  assert.deepEqual(groups.map((group) => group.models.map((model) => model.id)), [
    ['google/gemini-3.8-flash', 'google/gemini-4-hydrogen'],
    ['google-vertex/gemini-3.8-flash', 'google-vertex/gemini-4-argon'],
  ])
})

test('current Astra, Fable, and Hydrogen models retain their provider grouping', () => {
  const groups = groupAvailableModels([
    { id: 'openai/gpt-6.2-astra', alias: 'GPT-6.2 Astra (frontier)', provider: 'openai', name: 'gpt-6.2-astra' },
    { id: 'anthropic/claude-fable-5-2', alias: 'Claude Fable 5.2 (frontier)', provider: 'anthropic', name: 'claude-fable-5-2' },
    { id: 'google/gemini-4-hydrogen', alias: 'Gemini 4 Hydrogen (balanced)', provider: 'google', name: 'gemini-4-hydrogen' },
    { id: 'google-vertex/gemini-4-hydrogen', alias: 'Vertex Gemini 4 Hydrogen (balanced)', provider: 'google-vertex', name: 'gemini-4-hydrogen' },
  ])

  assert.deepEqual(groups.map((group) => group.key), ['openai', 'anthropic', 'google', 'google-vertex'])
  assert.equal(groups.every((group) => group.models.length === 1), true)
})

test('superseded Google Gemini generations are not selectable', () => {
  assert.equal(isSelectableModelId('google/gemini-3.7-reasoning'), false)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.7-flash'), false)
  assert.equal(isSelectableModelId('google/gemini-3.6-flash'), false)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.5-flash-lite'), false)
})

test('Automnia exposes only current hosted tier model IDs', () => {
  const groups = groupAvailableModels([
    { id: 'openai/gpt-5.6', provider: 'openai', name: 'gpt-5.6' },
    { id: 'automnia-cloud/gemini-4-hydrogen', provider: 'automnia-cloud', name: 'Gemini 4 Hydrogen' },
    { id: 'automnia-cloud/gemini-4-neon', provider: 'automnia-cloud', name: 'Gemini 4 Neon' },
    { id: 'automnia-cloud/gemini-4-argon', provider: 'automnia-cloud', name: 'Gemini 4 Argon' },
    { id: 'automnia-cloud/gemini-3.7-flash', provider: 'automnia-cloud', name: 'Gemini 3.7 Flash' },
  ])

  assert.equal(modelProviderLabel('automnia-cloud'), 'Automnia')
  assert.deepEqual(groups.map((group) => group.key), ['openai', 'automnia-cloud'])
  assert.deepEqual(groups.find((group) => group.key === 'automnia-cloud')?.models.map((model) => model.id), [
    'automnia-cloud/gemini-4-hydrogen',
    'automnia-cloud/gemini-4-neon',
  ])
  assert.equal(isSelectableModelId('automnia-cloud/gemini-3.6-flash'), false)
  assert.equal(isSelectableModelId('automnia-cloud/gemini-4-argon'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { groupAvailableModels, isSelectableModelId } from '../src/utils/modelGrouping'

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

test('Only Gemini 3.7 Flash is selectable for the Google 3.7 model family', () => {
  assert.equal(isSelectableModelId('google/gemini-3.7-reasoning'), false)
  assert.equal(isSelectableModelId('google-vertex/gemini-3.7-reasoning'), false)
})

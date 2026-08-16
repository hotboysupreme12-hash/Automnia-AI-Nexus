import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_CREDITS_MODEL_ID,
  creditsOnlyModelSelection,
  filterCreditsOnlyModels,
  isAutomniaCreditsModelId,
} from '../server/services/license/creditsOnlyModelPolicy'

test('credits-only policy exposes exactly the Automnia credits model', () => {
  assert.deepEqual(creditsOnlyModelSelection(), { primary: AUTOMNIA_CREDITS_MODEL_ID })
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_MODEL_ID), true)
  assert.equal(isAutomniaCreditsModelId('google/gemini-3.7-pro'), false)
  assert.deepEqual(
    filterCreditsOnlyModels([
      { id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' },
      { id: 'openai/gpt-5.5', name: 'Provider model' },
    ]),
    [{ id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' }],
  )
})

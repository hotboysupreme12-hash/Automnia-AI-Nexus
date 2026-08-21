import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_CREDITS_MODEL_IDS,
  creditsOnlyModelSelection,
  filterCreditsOnlyModels,
  isAutomniaCreditsModelId,
} from '../server/services/license/creditsOnlyModelPolicy'

test('credits-only policy exposes a bounded Automnia-hosted fallback chain', () => {
  assert.deepEqual(creditsOnlyModelSelection(), {
    primary: AUTOMNIA_CREDITS_MODEL_ID,
    fallbacks: [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS],
  })
  assert.deepEqual(AUTOMNIA_CREDITS_MODEL_IDS, [AUTOMNIA_CREDITS_MODEL_ID, ...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS])
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_MODEL_ID), true)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0]), true)
  assert.equal(isAutomniaCreditsModelId('automnia-cloud/not-an-allowed-model'), false)
  assert.equal(isAutomniaCreditsModelId('google/gemini-2.5-pro'), false)
  assert.deepEqual(
    filterCreditsOnlyModels([
      { id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' },
      { id: AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0], name: 'Automnia fallback' },
      { id: 'openai/gpt-5.5', name: 'Provider model' },
    ]),
    [
      { id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' },
      { id: AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0], name: 'Automnia fallback' },
    ],
  )
})

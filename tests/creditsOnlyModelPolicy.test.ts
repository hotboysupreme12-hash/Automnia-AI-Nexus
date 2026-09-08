import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_CREDITS_MODEL_IDS,
  AUTOMNIA_RELAY_MODEL_LABELS,
  creditsOnlyModelSelection,
  filterCreditsOnlyModels,
  isAutomniaCreditsModelId,
  isAutomniaRelayModelId,
} from '../server/services/license/creditsOnlyModelPolicy'

test('credits-only policy exposes a bounded Automnia-hosted fallback chain', () => {
  assert.deepEqual(creditsOnlyModelSelection(), {
    primary: AUTOMNIA_CREDITS_MODEL_ID,
    fallbacks: [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS],
  })
  assert.deepEqual(AUTOMNIA_CREDITS_MODEL_IDS, [AUTOMNIA_CREDITS_MODEL_ID, ...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS])
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_MODEL_ID), true)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0]), true)
  assert.equal(isAutomniaRelayModelId('automnia-cloud/gemini-3.8-flash'), true)
  assert.equal(isAutomniaCreditsModelId('automnia-cloud/gemini-3.8-flash'), false)
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS['automnia-cloud/gemini-3.8-flash'], 'Automnia Prime')
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

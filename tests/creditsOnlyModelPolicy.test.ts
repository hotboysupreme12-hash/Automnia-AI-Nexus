import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_CREDITS_MODEL_IDS,
  AUTOMNIA_FRONTIER_MODEL_ID,
  AUTOMNIA_PRO_MODEL_ID,
  AUTOMNIA_RELAY_MODEL_LABELS,
  AUTOMNIA_SWIFT_MODEL_ID,
  automniaHostedModelIdsForTier,
  creditsOnlyModelSelection,
  filterCreditsOnlyModels,
  isAutomniaCreditsModelId,
  isAutomniaFrontierModelId,
  isAutomniaProModelId,
  isAutomniaFrontierEligibleTier,
  isAutomniaFrontierTier,
  isAutomniaRelayModelId,
} from '../server/services/license/creditsOnlyModelPolicy'

test('credits-only policy exposes a bounded Automnia-hosted fallback chain', () => {
  assert.deepEqual(creditsOnlyModelSelection(), {
    primary: AUTOMNIA_CREDITS_MODEL_ID,
    fallbacks: [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS],
  })
  assert.equal(AUTOMNIA_CREDITS_MODEL_ID, 'automnia-cloud/gemini-4-hydrogen')
  assert.deepEqual(AUTOMNIA_CREDITS_MODEL_IDS, [AUTOMNIA_CREDITS_MODEL_ID, AUTOMNIA_SWIFT_MODEL_ID])
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_MODEL_ID), true)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0]), true)
  assert.equal(isAutomniaRelayModelId(AUTOMNIA_SWIFT_MODEL_ID), true)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_SWIFT_MODEL_ID), true)
  assert.equal(AUTOMNIA_PRO_MODEL_ID, 'automnia-cloud/gemini-4-argon')
  assert.equal(isAutomniaProModelId(AUTOMNIA_PRO_MODEL_ID), true)
  assert.equal(AUTOMNIA_FRONTIER_MODEL_ID, 'automnia-cloud/gemini-4-carbon')
  assert.equal(isAutomniaFrontierModelId(AUTOMNIA_FRONTIER_MODEL_ID), true)
  assert.equal(isAutomniaFrontierTier('Automnia Frontier'), true)
  assert.equal(isAutomniaFrontierEligibleTier('pro'), true)
  assert.equal(isAutomniaFrontierEligibleTier('enterprise'), true)
  assert.equal(isAutomniaFrontierEligibleTier('starter'), false)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_FRONTIER_MODEL_ID), false)
  assert.equal(isAutomniaCreditsModelId(AUTOMNIA_PRO_MODEL_ID), false)
  assert.equal(isAutomniaRelayModelId(AUTOMNIA_FRONTIER_MODEL_ID), true)
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS[AUTOMNIA_FRONTIER_MODEL_ID], 'Automnia Frontier')
  assert.deepEqual(automniaHostedModelIdsForTier('pro').includes(AUTOMNIA_FRONTIER_MODEL_ID), true)
  assert.deepEqual(automniaHostedModelIdsForTier('enterprise').includes(AUTOMNIA_FRONTIER_MODEL_ID), true)
  assert.deepEqual(automniaHostedModelIdsForTier('starter').includes(AUTOMNIA_FRONTIER_MODEL_ID), false)
  assert.deepEqual(automniaHostedModelIdsForTier('frontier').includes(AUTOMNIA_FRONTIER_MODEL_ID), true)
  assert.deepEqual(automniaHostedModelIdsForTier('pro').includes(AUTOMNIA_PRO_MODEL_ID), true)
  assert.deepEqual(automniaHostedModelIdsForTier('starter').includes(AUTOMNIA_PRO_MODEL_ID), false)
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS[AUTOMNIA_CREDITS_MODEL_ID], 'Automnia Balanced')
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS[AUTOMNIA_PRO_MODEL_ID], 'Automnia Pro')
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS[AUTOMNIA_SWIFT_MODEL_ID], 'Automnia Swift')
  assert.equal(AUTOMNIA_RELAY_MODEL_LABELS[AUTOMNIA_FRONTIER_MODEL_ID], 'Automnia Frontier')
  assert.equal(isAutomniaCreditsModelId('automnia-cloud/not-an-allowed-model'), false)
  assert.equal(isAutomniaCreditsModelId('google/gemini-2.5-pro'), false)
  assert.deepEqual(
    filterCreditsOnlyModels([
      { id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' },
      { id: AUTOMNIA_SWIFT_MODEL_ID, name: 'Automnia Swift' },
      { id: AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0], name: 'Automnia fallback' },
      { id: 'openai/gpt-5.5', name: 'Provider model' },
    ]),
    [
      { id: AUTOMNIA_CREDITS_MODEL_ID, name: 'Automnia credits' },
      { id: AUTOMNIA_SWIFT_MODEL_ID, name: 'Automnia Swift' },
      { id: AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS[0], name: 'Automnia fallback' },
    ],
  )
})

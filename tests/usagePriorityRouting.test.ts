import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyUsagePriorityModelOrder,
  withUsagePriorityChannelDefault,
} from '../server/services/license/usagePriorityRouting'

const AUTOMNIA = 'automnia-cloud/gemini-3.6-flash'

test('Telegram channel defaults mirror the selected billing route without replacing explicit chats', () => {
  const providerFirst = applyUsagePriorityModelOrder(
    { primary: AUTOMNIA, fallbacks: ['google/gemini-2.5-pro'] },
    'provider_first',
    [],
    AUTOMNIA,
  )
  assert.deepEqual(
    withUsagePriorityChannelDefault({ '123456789': 'openai/gpt-5.5' }, providerFirst),
    { '123456789': 'openai/gpt-5.5', '*': 'google/gemini-2.5-pro' },
  )

  const automniaOnly = applyUsagePriorityModelOrder(
    { primary: 'google/gemini-2.5-pro' },
    'automnia_only',
    [],
    AUTOMNIA,
  )
  assert.deepEqual(
    withUsagePriorityChannelDefault(undefined, automniaOnly),
    { '*': AUTOMNIA },
  )
})

test('Automnia credits falls back to the provider when the confirmed balance is zero', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: 'google/gemini-2.5-pro', fallbacks: [AUTOMNIA, 'openai/gpt-5', 'google/gemini-2.0-flash'] },
    'automnia_only',
    ['openai/gpt-5.5'],
    AUTOMNIA,
    { automniaCreditBalance: 0 },
  )

  assert.deepEqual(selection, { primary: 'google/gemini-2.5-pro' })
})

test('Automnia remains primary while credits are available', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: 'google/gemini-2.5-pro', fallbacks: [AUTOMNIA] },
    'automnia_only',
    [],
    AUTOMNIA,
    { automniaCreditBalance: 250 },
  )

  assert.deepEqual(selection, { primary: AUTOMNIA })
})

test('credits-only entitlements do not gain a provider fallback at zero balance', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: 'google/gemini-2.5-pro', fallbacks: [AUTOMNIA] },
    'automnia_only',
    ['google/gemini-2.5-pro'],
    AUTOMNIA,
    { automniaCreditBalance: 0, allowProviderFallbackWhenCreditsExhausted: false },
  )

  assert.deepEqual(selection, { primary: AUTOMNIA })
})

test('provider-first is exactly provider followed by Automnia', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: AUTOMNIA, fallbacks: ['google/gemini-2.5-pro', 'openai/gpt-5'] },
    'provider_first',
    ['openai/gpt-5.5'],
    AUTOMNIA,
  )

  assert.deepEqual(selection, {
    primary: 'google/gemini-2.5-pro',
    fallbacks: [AUTOMNIA],
  })
})

test('the combined route can run Automnia first with the provider as fallback', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: 'google/gemini-2.5-pro', fallbacks: [AUTOMNIA, 'openai/gpt-5'] },
    'automnia_first_with_provider_fallback',
    [],
    AUTOMNIA,
  )

  assert.deepEqual(selection, {
    primary: AUTOMNIA,
    fallbacks: ['google/gemini-2.5-pro'],
  })
})

test('provider-first removes an exhausted Automnia fallback from the live route', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: AUTOMNIA, fallbacks: ['google/gemini-2.5-pro'] },
    'provider_first',
    [],
    AUTOMNIA,
    { automniaCreditBalance: 0 },
  )

  assert.deepEqual(selection, { primary: 'google/gemini-2.5-pro' })
})

test('BYOK-only contains one provider model and never Automnia or old retries', () => {
  const selection = applyUsagePriorityModelOrder(
    { primary: AUTOMNIA, fallbacks: ['google/gemini-2.5-pro', 'openai/gpt-5'] },
    'byok_only',
    ['openai/gpt-5.5'],
    AUTOMNIA,
  )

  assert.deepEqual(selection, { primary: 'google/gemini-2.5-pro' })
})

test('provider-plus-Automnia policies fail closed when no provider model is available', () => {
  assert.equal(
    applyUsagePriorityModelOrder({ primary: AUTOMNIA }, 'provider_first', [], AUTOMNIA),
    undefined,
  )
  assert.equal(
    applyUsagePriorityModelOrder({ primary: AUTOMNIA }, 'byok_only', [], AUTOMNIA),
    undefined,
  )
  assert.deepEqual(
    applyUsagePriorityModelOrder({ primary: 'google/gemini-2.5-pro' }, 'automnia_first', [], AUTOMNIA),
    { primary: AUTOMNIA },
  )
})

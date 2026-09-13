import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_PRO_TOKENS,
  AUTOMNIA_STARTER_TOKENS,
  AUTOMNIA_TOKENS_PER_CREDIT,
  formatAutomniaCreditsFromTokens,
} from '../src/utils/creditDisplay'

test('plan token allocations are displayed as compact credits', () => {
  assert.equal(AUTOMNIA_TOKENS_PER_CREDIT, 1_000)
  assert.equal(formatAutomniaCreditsFromTokens(AUTOMNIA_STARTER_TOKENS, ''), '22,000')
  assert.equal(formatAutomniaCreditsFromTokens(AUTOMNIA_PRO_TOKENS, ''), '55,000')
})

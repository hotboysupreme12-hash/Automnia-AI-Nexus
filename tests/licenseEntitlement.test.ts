import assert from 'node:assert/strict'
import test from 'node:test'

import type { LicenseInfo } from '../src/context/licenseContextValue'
import { mergeHostedCreditBalance, resolveLicenseEntitlement } from '../src/utils/licenseEntitlement'

function license(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    active: true,
    email: 'customer@example.test',
    tier: 'starter',
    mode: 'hosted_credits',
    usagePriority: 'automnia_first',
    creditBalance: 500_000,
    creditBalanceUpdatedAt: '2026-08-11T12:00:00.000Z',
    activatedAt: '2026-08-11T10:00:00.000Z',
    verifiedAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

test('presents every hosted tier as its active subscription and Automnia credit route', () => {
  for (const [tier, expected] of [
    ['starter', 'Starter Subscription'],
    ['pro', 'Pro Subscription'],
    ['enterprise', 'Enterprise Subscription'],
  ] as const) {
    const entitlement = resolveLicenseEntitlement(license({ tier }))
    assert.equal(entitlement.tierLabel, expected)
    assert.equal(entitlement.isHosted, true)
    assert.equal(entitlement.isByok, false)
    assert.equal(entitlement.billingLabel, 'Cloud Subscription — Automnia Credits')
    assert.equal(entitlement.statusLabel, 'Credits first active')
    assert.equal(entitlement.defaultRouteLabel, 'Automnia credits first → My connected provider fallback')
  }
})

test('presents a hosted member provider-first preference without changing the entitlement', () => {
  const entitlement = resolveLicenseEntitlement(license({ tier: 'pro', usagePriority: 'provider_first' }))
  assert.equal(entitlement.tierLabel, 'Pro Subscription')
  assert.equal(entitlement.isHosted, true)
  assert.equal(entitlement.statusLabel, 'Provider first active')
  assert.equal(entitlement.defaultRouteLabel, 'My connected provider first → Automnia credits fallback')
})

test('presents current and legacy BYOK tiers as one-time provider-billed access', () => {
  for (const tier of ['byok', 'founding_beta_byok']) {
    const entitlement = resolveLicenseEntitlement(license({ tier, mode: 'byok', creditBalance: null }))
    assert.equal(entitlement.tierLabel, 'BYOK One-Time Access')
    assert.equal(entitlement.isHosted, false)
    assert.equal(entitlement.isByok, true)
    assert.equal(entitlement.statusLabel, 'One-time access active')
  }
})

test('presents a refill-only hosted entitlement as credits without inventing a subscription tier', () => {
  for (const tier of ['credit_pack_topup', 'credit_refill']) {
    const entitlement = resolveLicenseEntitlement(license({ tier }))
    assert.equal(entitlement.tierLabel, 'Hosted Credit Refill')
    assert.equal(entitlement.kind, 'hosted_refill')
    assert.equal(entitlement.isHosted, true)
    assert.equal(entitlement.isSubscription, false)
    assert.equal(entitlement.billingLabel, 'Hosted Credits — Automnia Refill Balance')
  }
})

test('falls back safely for inactive and older active license records', () => {
  assert.equal(resolveLicenseEntitlement(null).tierLabel, 'No active license')
  assert.equal(resolveLicenseEntitlement(license({ tier: 'custom_team', mode: null })).tierLabel, 'Custom Team Subscription')
  assert.equal(resolveLicenseEntitlement(license({ tier: 'legacy_byok', mode: null })).tierLabel, 'BYOK One-Time Access')
})

test('merges a hosted balance without changing the active tier or access mode', () => {
  const current = license({ tier: 'pro', creditBalance: 2_000_000 })
  const next = mergeHostedCreditBalance(current, 1_999_791, '2026-08-11T12:01:00.000Z')
  assert.equal(next?.creditBalance, 1_999_791)
  assert.equal(next?.creditBalanceUpdatedAt, '2026-08-11T12:01:00.000Z')
  assert.equal(next?.tier, 'pro')
  assert.equal(next?.mode, 'hosted_credits')
})

test('never applies hosted-credit events to BYOK or malformed balances', () => {
  const byok = license({ tier: 'byok', mode: 'byok', creditBalance: null })
  assert.equal(mergeHostedCreditBalance(byok, 10, '2026-08-11T12:01:00.000Z'), byok)
  const hosted = license()
  assert.equal(mergeHostedCreditBalance(hosted, Number.NaN, '2026-08-11T12:01:00.000Z'), hosted)
  assert.equal(mergeHostedCreditBalance(hosted, -1, '2026-08-11T12:01:00.000Z'), hosted)
})

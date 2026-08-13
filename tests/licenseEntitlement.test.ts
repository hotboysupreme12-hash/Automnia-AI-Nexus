import assert from 'node:assert/strict'
import test from 'node:test'

import type { LicenseInfo } from '../src/context/licenseContextValue'
import { isStarterSubscriptionOnly, mergeHostedCreditBalance, resolveAgentRoutePresentation, resolveLicenseEntitlement } from '../src/utils/licenseEntitlement'

function license(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    active: true,
    email: 'customer@example.test',
    tier: 'starter',
    mode: 'hosted_credits',
    planPriceCents: 1_999,
    byokAllowed: false,
    permanentAccess: false,
    usagePriority: 'automnia_first',
    creditBalance: 500_000,
    creditBalanceUpdatedAt: '2026-08-11T12:00:00.000Z',
    activatedAt: '2026-08-11T10:00:00.000Z',
    verifiedAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

test('presents permanent hosted tiers as their highest account access and Automnia credit route', () => {
  for (const [tier, expected] of [
    ['pro', 'Pro Access'],
    ['enterprise', 'Enterprise Access'],
  ] as const) {
    const entitlement = resolveLicenseEntitlement(license({ tier }))
    assert.equal(entitlement.tierLabel, expected)
    assert.equal(entitlement.isHosted, true)
    assert.equal(entitlement.isByok, false)
    assert.equal(entitlement.billingLabel, 'Permanent Automnia access — Credits')
    assert.equal(entitlement.statusLabel, 'Permanent access active')
    assert.equal(entitlement.defaultRouteLabel, 'Subscription Relay')
  }
})

test('presents a hosted member provider-first preference without changing the entitlement', () => {
  const entitlement = resolveLicenseEntitlement(license({ tier: 'pro', usagePriority: 'provider_first' }))
  assert.equal(entitlement.tierLabel, 'Pro Access')
  assert.equal(entitlement.isHosted, true)
  assert.equal(entitlement.statusLabel, 'Provider first · relay available')
  assert.equal(entitlement.defaultRouteLabel, 'My connected provider → Subscription Relay')
})

test('presents Automnia as the managed agent model for a permanent hosted tier', () => {
  const managed = resolveAgentRoutePresentation(license({ tier: 'pro', permanentAccess: true, byokAllowed: true }))
  assert.equal(managed.routeLabel, 'Subscription Relay')
  assert.equal(managed.modelLabel, 'Automnia')
  assert.equal(managed.managedRoute, true)

  const providerFirst = resolveAgentRoutePresentation(license({ tier: 'pro', permanentAccess: true, byokAllowed: true, usagePriority: 'provider_first' }))
  assert.equal(providerFirst.modelLabel, 'Primary Provider Model')
  assert.equal(providerFirst.managedRoute, false)
  assert.equal(providerFirst.providerFirst, true)
})

test('keeps provider-only permanent-tier settings visible as provider settings', () => {
  const entitlement = resolveLicenseEntitlement(license({ tier: 'pro', usagePriority: 'byok_only' }))
  assert.equal(entitlement.defaultRouteLabel, 'My connected provider')
  assert.equal(resolveAgentRoutePresentation(license({ tier: 'pro', usagePriority: 'byok_only' })).providerOnly, true)
})

test('keeps Starter subscription hosted and without BYOK while higher tiers allow it', () => {
  const starter = resolveLicenseEntitlement(license({ usagePriority: 'provider_first' }))
  assert.equal(isStarterSubscriptionOnly(license()), true)
  assert.equal(starter.usagePriorityLocked, true)
  assert.equal(starter.byokAllowed, false)
  assert.equal(starter.defaultRouteLabel, 'Subscription Relay')

  const higherPricedStarter = resolveLicenseEntitlement(license({ planPriceCents: 2_999, usagePriority: 'provider_first' }))
  assert.equal(higherPricedStarter.usagePriorityLocked, true)
  assert.equal(higherPricedStarter.byokAllowed, false)
  assert.equal(higherPricedStarter.permanentAccess, false)
  assert.equal(higherPricedStarter.defaultRouteLabel, 'Subscription Relay')

  for (const tier of ['pro', 'enterprise', 'custom_team']) {
    assert.equal(resolveLicenseEntitlement(license({ tier, mode: 'hosted_credits', byokAllowed: false })).byokAllowed, true, tier)
  }
  for (const tier of ['credit_refill']) {
    assert.equal(resolveLicenseEntitlement(license({ tier, byokAllowed: false })).byokAllowed, false, tier)
  }
})

test('keeps the grandfathered BYOK entitlement permanent while exposing managed priority', () => {
  const entitlement = resolveLicenseEntitlement(license({ tier: 'byok', mode: 'byok', planPriceCents: null, byokAllowed: true, usagePriority: 'provider_first' }))
  assert.equal(isStarterSubscriptionOnly({ ...license({ tier: 'byok', mode: 'byok', planPriceCents: 1_999 }) }), false)
  assert.equal(entitlement.isByok, true)
  assert.equal(entitlement.byokAllowed, true)
  assert.equal(entitlement.usagePriorityLocked, false)
  assert.equal(entitlement.defaultRouteLabel, 'Your connected provider → Automnia credits fallback')
})

test('presents current and legacy BYOK tiers as permanent provider-billed access', () => {
  for (const tier of ['byok', 'founding_beta_byok']) {
    const entitlement = resolveLicenseEntitlement(license({ tier, mode: 'byok', creditBalance: null }))
    assert.equal(entitlement.tierLabel, 'BYOK Access')
    assert.equal(entitlement.isHosted, false)
    assert.equal(entitlement.isByok, true)
    assert.equal(entitlement.statusLabel, 'Permanent access active')
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
  assert.equal(resolveLicenseEntitlement(license({ tier: 'legacy_byok', mode: null })).tierLabel, 'BYOK Access')
})

test('merges a hosted balance without changing the active tier or access mode', () => {
  const current = license({ tier: 'pro', creditBalance: 2_000_000 })
  const next = mergeHostedCreditBalance(current, 1_999_791, '2026-08-11T12:01:00.000Z')
  assert.equal(next?.creditBalance, 1_999_791)
  assert.equal(next?.creditBalanceUpdatedAt, '2026-08-11T12:01:00.000Z')
  assert.equal(next?.tier, 'pro')
  assert.equal(next?.mode, 'hosted_credits')
})

test('applies pooled-credit events to BYOK and rejects malformed balances', () => {
  const byok = license({ tier: 'byok', mode: 'byok', creditBalance: null })
  assert.equal(mergeHostedCreditBalance(byok, 10, '2026-08-11T12:01:00.000Z')?.creditBalance, 10)
  const hosted = license()
  assert.equal(mergeHostedCreditBalance(hosted, Number.NaN, '2026-08-11T12:01:00.000Z'), hosted)
  assert.equal(mergeHostedCreditBalance(hosted, -1, '2026-08-11T12:01:00.000Z'), hosted)
})

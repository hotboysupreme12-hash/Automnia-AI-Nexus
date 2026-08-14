import assert from 'node:assert/strict'
import test from 'node:test'

import { createLicenseService, type LicenseServiceOptions } from '../server/services/license/licenseService'

function createHarness(options: {
  responses?: Array<Record<string, unknown>>
  failuresByRequest?: Record<number, 'network' | 'service_unavailable'>
} = {}) {
  const values = new Map<string, unknown>()
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const responses = [...(options.responses || [])]
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    })
    const failure = options.failuresByRequest?.[requests.length]
    if (failure === 'network') throw new Error('simulated network failure')
    if (failure === 'service_unavailable') {
      return new Response(JSON.stringify({ ok: false, error: 'simulated provisioner outage' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const next = responses.shift() || { ok: true, active: true, mode: 'hosted_credits' }
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof globalThis.fetch

  const service = createLicenseService({
    read: <T>(key: string) => (values.get(key) as T | undefined) || null,
    write: (key: string, value: unknown) => {
      values.set(key, value)
      return true
    },
    remove: (key: string) => values.delete(key),
    apiUrl: 'https://provisioner.example.test/',
    fetch,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  } satisfies LicenseServiceOptions)

  return { service, values, requests }
}

test('persists the provisioner-confirmed hosted-credit balance on activation and successful relay usage', async () => {
  const harness = createHarness({
    responses: [{
      ok: true,
      active: true,
      email: 'customer@example.test',
      tier: 'pro',
      mode: 'hosted_credits',
      creditBalance: 2_000,
      activatedAt: '2026-08-01T00:00:00.000Z',
    }],
  })

  const activated = await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-0001' })
  assert.equal(activated.creditBalance, 2_000)
  assert.equal(activated.usagePriority, 'automnia_first')
  assert.equal(activated.byokAllowed, true)
  assert.equal(activated.creditBalanceUpdatedAt, '2026-08-11T12:00:00.000Z')
  assert.equal(harness.requests[0]?.url, 'https://provisioner.example.test/api/activate')
  assert.deepEqual(harness.requests[0]?.body, { email: 'customer@example.test', licenseKey: 'AUT-TEST-0001' })

  const updated = harness.service.recordHostedCreditBalance(1_731)
  assert.equal(updated?.creditBalance, 1_731)
  assert.equal(updated?.creditBalanceUpdatedAt, '2026-08-11T12:00:00.000Z')
  assert.equal(harness.service.getStatus().creditBalance, 1_731)

  const stored = harness.values.get('license:activation') as Record<string, unknown>
  assert.equal(stored.licenseKey, 'AUT-TEST-0001')
  assert.equal(stored.creditBalance, 1_731)
})

test('replaces a legacy local key with the provisioner canonical account key', async () => {
  const harness = createHarness({
    responses: [{
      ok: true,
      active: true,
      email: 'customer@example.test',
      tier: 'pro',
      mode: 'hosted_credits',
      permanentAccess: true,
      canonicalLicenseKey: 'AUT-CANONICAL-0001',
      creditBalance: 2_000,
    }],
  })

  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-LEGACY-0001' })
  const stored = harness.values.get('license:activation') as Record<string, unknown>
  assert.equal(stored.licenseKey, 'AUT-CANONICAL-0001')
})

test('persists hosted usage priority across balance updates and provisioner refreshes', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 500 },
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 700 },
    ],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-PRIORITY' })

  const providerFirst = harness.service.setUsagePriority('provider_first')
  assert.equal(providerFirst.usagePriority, 'provider_first')
  assert.equal(harness.service.getActiveRelayCredentials()?.usagePriority, 'provider_first')
  assert.equal(harness.service.recordHostedCreditBalance(450)?.usagePriority, 'provider_first')
  assert.equal((await harness.service.refresh()).usagePriority, 'provider_first')
  assert.equal(harness.service.getStatus().creditBalance, 700)
})

test('locks the $19.99 Starter subscription to Automnia credits', async () => {
  const harness = createHarness({
    responses: [{
      ok: true,
      active: true,
      email: 'customer@example.test',
      tier: 'starter',
      mode: 'hosted_credits',
      planPriceCents: 1_999,
      byokAllowed: true,
      permanentAccess: true,
      usagePriority: 'provider_first',
      creditBalance: 1_000,
    }],
  })

  const activated = await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-STARTER' })
  assert.equal(activated.planPriceCents, 1_999)
  assert.equal(activated.byokAllowed, false)
  assert.equal(activated.permanentAccess, false)
  assert.equal(activated.usagePriority, 'automnia_first')
  assert.equal(harness.service.isUsagePriorityLocked(), true)
  assert.equal(harness.service.setUsagePriority('provider_first').usagePriority, 'automnia_first')
  assert.equal(harness.service.getActiveRelayCredentials()?.usagePriority, 'automnia_first')

  const higherPricedStarter = createHarness({
    responses: [{ ok: true, active: true, email: 'customer@example.test', tier: 'starter', mode: 'hosted_credits', planPriceCents: 2_999, byokAllowed: true }],
  })
  const higherPricedStatus = await higherPricedStarter.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-STARTER-HIGHER' })
  assert.equal(higherPricedStatus.usagePriority, 'automnia_first')
  assert.equal(higherPricedStatus.byokAllowed, false)
  assert.equal(higherPricedStatus.permanentAccess, false)
  assert.equal(higherPricedStarter.service.isUsagePriorityLocked(), true)
  assert.equal(higherPricedStarter.service.setUsagePriority('provider_first').usagePriority, 'automnia_first')
})

test('keeps a managed priority when the account changes between permanent and hosted modes', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'founding_beta_byok', mode: 'byok' },
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 700 },
    ],
  })

  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-MODE-SWITCH' })
  assert.equal(harness.service.getStatus().usagePriority, 'provider_first')

  const refreshed = await harness.service.refresh()
  assert.equal(refreshed.mode, 'hosted_credits')
  assert.equal(refreshed.usagePriority, 'provider_first')
})

test('does not invent or accept malformed hosted-credit balances', async () => {
  const harness = createHarness({
    responses: [{ ok: true, active: true, mode: 'hosted_credits', creditBalance: 90 }],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-0002' })

  assert.equal(harness.service.recordHostedCreditBalance(Number.NaN), null)
  assert.equal(harness.service.recordHostedCreditBalance(-1), null)
  assert.equal(harness.service.getStatus().creditBalance, 90)
})

test('refresh reconciles a balance changed outside the desktop app without exposing the license key', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 100 },
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 450 },
    ],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-0003' })

  const refreshed = await harness.service.refresh()
  assert.equal(refreshed.creditBalance, 450)
  assert.equal(refreshed.creditBalanceUpdatedAt, '2026-08-11T12:00:00.000Z')
  assert.equal('licenseKey' in refreshed, false)
  assert.equal(harness.requests.length, 2)
  assert.deepEqual(harness.requests[1]?.body, { email: 'customer@example.test', licenseKey: 'AUT-TEST-0003' })
})

test('refresh retries transient relay-license transport failures before reporting success', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 100 },
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 125 },
    ],
    failuresByRequest: { 2: 'network', 3: 'service_unavailable' },
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-RETRY' })

  const refreshed = await harness.service.refresh()
  assert.equal(refreshed.creditBalance, 125)
  assert.equal(harness.requests.length, 4)
})

test('allows pooled relay balances on a BYOK account without changing its access mode', async () => {
  const harness = createHarness({
    responses: [{ ok: true, active: true, email: 'customer@example.test', tier: 'founding_beta_byok', mode: 'byok', creditBalance: 999 }],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-0004' })

  assert.equal(harness.service.recordHostedCreditBalance(1)?.creditBalance, 1)
  assert.equal(harness.service.getStatus().mode, 'byok')
  assert.equal(harness.service.getStatus().usagePriority, 'automnia_first')
  assert.equal(harness.service.getStatus().creditBalance, 1)
  assert.equal(harness.service.setUsagePriority('automnia_first').usagePriority, 'automnia_first')
})

test('exposes the Automnia relay as a selectable fallback for permanent BYOK tiers', async () => {
  const harness = createHarness({
    responses: [{ ok: true, active: true, email: 'customer@example.test', tier: 'byok', mode: 'byok', creditBalance: 250 }],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-BYOK-PRIORITY' })

  assert.equal(harness.service.getActiveRelayCredentials()?.usagePriority, 'automnia_first')
  assert.equal(harness.service.setUsagePriority('automnia_first').usagePriority, 'automnia_first')
  assert.equal(harness.service.getActiveRelayCredentials()?.mode, 'hosted_credits')
  assert.equal(harness.service.setUsagePriority('provider_first').usagePriority, 'provider_first')
  assert.equal(harness.service.getActiveRelayCredentials(), null)
  assert.equal(harness.service.setUsagePriority('byok_only').usagePriority, 'byok_only')
  assert.equal(harness.service.getActiveRelayCredentials(), null)
})

test('defaults an upgraded BYOK account with carried-over hosted credits to Automnia first while keeping every route editable', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'starter', mode: 'hosted_credits', creditBalance: 500_000 },
      { ok: true, active: true, email: 'customer@example.test', tier: 'byok', mode: 'byok', creditBalance: 500_000 },
    ],
  })

  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-STARTER-BYOK' })
  const upgraded = await harness.service.refresh()
  assert.equal(upgraded.mode, 'byok')
  assert.equal(upgraded.creditBalance, 500_000)
  assert.equal(upgraded.usagePriority, 'automnia_first')
  assert.equal(harness.service.isUsagePriorityLocked(), false)

  for (const priority of ['provider_first', 'byok_only', 'automnia_first'] as const) {
    assert.equal(harness.service.setUsagePriority(priority).usagePriority, priority)
  }
})

test('forwards and returns the Help Assistant session for grounded follow-up questions', async () => {
  const harness = createHarness({
    responses: [
      { ok: true, active: true, email: 'customer@example.test', tier: 'pro', mode: 'hosted_credits', creditBalance: 500 },
      { ok: true, grounded: true, answerText: 'Use Agents → Agent files.', sessionName: 'projects/test/locations/global/collections/default_collection/dataStores/automnia-knowledge/sessions/help-123' },
    ],
  })

  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-KNOWLEDGE-SESSION' })
  const answer = await harness.service.answerKnowledge('Where are agent files?', 'projects/test/locations/global/collections/default_collection/dataStores/automnia-knowledge/sessions/help-123')

  assert.equal(answer.answerText, 'Use Agents → Agent files.')
  assert.equal(answer.sessionName, 'projects/test/locations/global/collections/default_collection/dataStores/automnia-knowledge/sessions/help-123')
  assert.deepEqual(harness.requests[1]?.body, {
    email: 'customer@example.test',
    licenseKey: 'AUT-TEST-KNOWLEDGE-SESSION',
    query: 'Where are agent files?',
    sessionName: 'projects/test/locations/global/collections/default_collection/dataStores/automnia-knowledge/sessions/help-123',
  })
})

test('returns only a provisioner-configured HTTPS Shopify checkout URL', async () => {
  const harness = createHarness({
    responses: [{ ok: true, checkoutUrl: 'https://billing.example.test/products/automnia-cloud' }],
  })

  const checkout = await harness.service.getSubscriptionCheckout()
  assert.deepEqual(checkout, { checkoutUrl: 'https://billing.example.test/products/automnia-cloud' })
  assert.equal(harness.requests[0]?.url, 'https://provisioner.example.test/api/commerce/checkout')
  assert.deepEqual(harness.requests[0]?.body, {})
})

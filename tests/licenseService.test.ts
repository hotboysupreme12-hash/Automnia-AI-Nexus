import assert from 'node:assert/strict'
import test from 'node:test'

import { createLicenseService, type LicenseServiceOptions } from '../server/services/license/licenseService'

function createHarness(options: { responses?: Array<Record<string, unknown>> } = {}) {
  const values = new Map<string, unknown>()
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const responses = [...(options.responses || [])]
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift() || { ok: true, active: true, mode: 'hosted_credits' }
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    })
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

test('never overwrites a BYOK account with a hosted-credit relay result', async () => {
  const harness = createHarness({
    responses: [{ ok: true, active: true, email: 'customer@example.test', tier: 'founding_beta_byok', mode: 'byok', creditBalance: 999 }],
  })
  await harness.service.activate({ email: 'customer@example.test', licenseKey: 'AUT-TEST-0004' })

  assert.equal(harness.service.recordHostedCreditBalance(1), null)
  assert.equal(harness.service.getStatus().mode, 'byok')
  assert.equal(harness.service.getStatus().usagePriority, 'provider_first')
  assert.equal(harness.service.getStatus().creditBalance, 999)
  assert.equal(harness.service.setUsagePriority('automnia_first').usagePriority, 'provider_first')
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

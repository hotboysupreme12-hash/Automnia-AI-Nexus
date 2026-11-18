import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const infraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceRoot = path.join(infraRoot, 'service')
const welcomeEmail = await readFile(path.join(serviceRoot, 'welcomeEmail.js'), 'utf8')
const provisionerService = await readFile(path.join(serviceRoot, 'server.js'), 'utf8')
assert.match(welcomeEmail, /AUTMNIA/)
assert.match(welcomeEmail, /AI NEXUS/)
assert.match(welcomeEmail, /automnia-ai-nexus-logo\.png/)
assert.match(welcomeEmail, /#2EFCE6/)
assert.doesNotMatch(welcomeEmail, /#48E8FF|#58AAFF/)
assert.match(welcomeEmail, /role="presentation"/)
assert.match(welcomeEmail, /Your secure access details/)
assert.match(welcomeEmail, /Get started in four steps/)
assert.match(provisionerService, /publishedInstallerPlatforms/)
assert.match(provisionerService, /file\(objectName\)\.exists\(\)/)
assert.match(provisionerService, /app\.get\('\/download\/installer'/)
assert.match(provisionerService, /installerSignedUrlMinutes/)
const mappings = JSON.parse(await readFile(path.join(infraRoot, 'shopify-plan-mappings.json'), 'utf8'))
const expectedPlanMappingHash = execFileSync(process.execPath, [
  path.join(infraRoot, 'tools', 'plan-hash.mjs'),
  path.join(infraRoot, 'shopify-plan-mappings.json'),
], { encoding: 'utf8' }).trim()
const encodedMappings = Buffer.from(JSON.stringify(mappings), 'utf8').toString('base64')

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return response.json()
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw lastError || new Error('Service health timed out.')
}

async function runMode(writeMode) {
  const port = await unusedPort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serviceRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      GOOGLE_CLOUD_PROJECT: 'local-smoke',
      LOCAL_IN_MEMORY_LICENSES: 'true',
      MIGRATION_WRITE_MODE: writeMode,
      SHOPIFY_PLAN_MAPPINGS: encodedMappings,
      SHOPIFY_CHECKOUT_URL: 'https://example.test/automnia-checkout',
      SHOPIFY_STORE_DOMAIN: 'automnia.app',
      SHOPIFY_API_VERSION: '2026-07',
      SHOPIFY_ADMIN_API_TOKEN: 'local-smoke-shopify-admin-token',
      AUTOMNIA_TEST_EMAIL_DELIVERY: 'stub',
      SHOPIFY_WEBHOOK_SECRETS: 'local-smoke-webhook-value',
      ADMIN_API_TOKEN: 'local-smoke-admin-value',
    },
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    const health = await waitForHealth(baseUrl)
    assert.equal(health.ok, true)
    assert.equal(health.writeMode, writeMode)
    assert.equal(health.aiRelayModel, 'gemini-4-hydrogen')
    assert.deepEqual(health.aiRelayModels, ['gemini-4-hydrogen', 'gemini-3.8-flash'])
    assert.deepEqual(health.aiRelayFallbackModels, ['gemini-3.8-flash'])
    assert.equal(health.vertexLocation, 'us-central1')
    assert.equal(health.billing?.accountingUnit, 'tokens')
    assert.equal(health.billing?.displayUnit, 'credits')
    assert.equal(health.billing?.tokensPerCredit, 1_000)
    assert.equal(health.billing?.billingUnitVersion, 2)
    assert.equal(20_000_000 / health.billing.tokensPerCredit, 20_000, '20M tokens must map to 20,000 displayed credits')
    assert.equal(health.commerce.planMappingCount, mappings.length)
    assert.equal(health.commerce.checkoutConfigured, true)
    assert.equal(health.commerce.webhookSecretsConfigured, true)
    assert.equal(health.commerce.emailDeliveryConfigured, true)

    const ready = await fetch(`${baseUrl}/ready`).then((response) => response.json())
    assert.equal(ready.ok, true)
    const checkout = await fetch(`${baseUrl}/api/commerce/checkout`).then((response) => response.json())
    assert.equal(checkout.checkoutUrl, 'https://example.test/automnia-checkout')

    const activation = await fetch(`${baseUrl}/api/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', licenseKey: 'AUT-INVALID-0000' }),
    })
    assert.equal(activation.status, writeMode === 'read_only' ? 503 : 404)
    if (writeMode === 'read_only') {
      assert.equal((await activation.json()).retryable, true)
    } else {
      const sendShopifyWebhook = async (webhookName, deliveryId, payload) => {
        const body = JSON.stringify(payload)
        const signature = createHmac('sha256', 'local-smoke-webhook-value').update(body).digest('base64')
        return fetch(`${baseUrl}/shopify/webhooks/${webhookName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-hmac-sha256': signature,
            'x-shopify-webhook-id': deliveryId,
          },
          body,
        })
      }

      const sendPaidOrder = async (id, sku, email = 'owner@example.test', quantity = 1, extra = {}) => {
        const body = JSON.stringify({
          id,
          email,
          name: `#${id}`,
          line_items: [{ sku, quantity }],
          ...extra,
        })
        return sendShopifyWebhook('orders-paid', `smoke-${id}`, JSON.parse(body))
      }

      const starterOrder = await sendPaidOrder('smoke-starter', 'AUTO-SUB-STARTER-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'starter-contract-smoke',
        next_billing_date: '2099-01-01T12:00:00.000Z',
      })
      assert.equal(starterOrder.status, 200)
      let provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'starter')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.byokAllowed, false)
      assert.equal(provisioned.records[0]?.permanentAccess, false)
      assert.equal(provisioned.records[0]?.accessType, 'subscription')
      assert.equal(provisioned.records[0]?.usagePriority, 'automnia_only')
      assert.equal(provisioned.records[0]?.creditBalance, 22_000, 'Starter must display 22,000 credits for its 22,000,000-token grant')

      const refillOrder = await sendPaidOrder('smoke-owner-refill-10m', 'AUTO-REFILL-10M')
      assert.equal(refillOrder.status, 200)
      assert.equal((await refillOrder.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      const refilledOwner = provisioned.records.find((record) => record.email === 'owner@example.test')
      assert.equal(refilledOwner?.creditBalance, 32_000, '10M Shopify refill must display as 10,000 credits and add to the existing Starter wallet')

      const duplicateRefill = await sendPaidOrder('smoke-owner-refill-10m', 'AUTO-REFILL-10M')
      assert.equal(duplicateRefill.status, 200)
      assert.equal((await duplicateRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 32_000, 'Duplicate Shopify delivery must not double-credit the wallet')

      const dollarRefill = await sendPaidOrder('smoke-owner-refill-100k', 'AUTO-REFILL-100K')
      assert.equal(dollarRefill.status, 200)
      assert.equal((await dollarRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 32_100, '$1 Shopify refill must add 100 credits')

      const duplicateDollarRefill = await sendPaidOrder('smoke-owner-refill-100k', 'AUTO-REFILL-100K')
      assert.equal(duplicateDollarRefill.status, 200)
      assert.equal((await duplicateDollarRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 32_100, 'Duplicate $1 Shopify delivery must not double-credit the wallet')

      const quantityRefill = await sendPaidOrder('smoke-owner-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'owner@example.test', 2)
      assert.equal(quantityRefill.status, 200)
      assert.equal((await quantityRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 32_300, 'A quantity-2 100K refill must add 200 credits')

      const duplicateQuantityRefill = await sendPaidOrder('smoke-owner-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'owner@example.test', 2)
      assert.equal(duplicateQuantityRefill.status, 200)
      assert.equal((await duplicateQuantityRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 32_300, 'A duplicate quantity-2 delivery must not double-credit the wallet')

      const quantityLargeRefill = await sendPaidOrder('smoke-owner-refill-10m-quantity-2', 'AUTO-REFILL-10M', 'owner@example.test', 2)
      assert.equal(quantityLargeRefill.status, 200)
      assert.equal((await quantityLargeRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 52_300, 'A quantity-2 10M refill must add 20,000 credits')

      const duplicateQuantityLargeRefill = await sendPaidOrder('smoke-owner-refill-10m-quantity-2', 'AUTO-REFILL-10M', 'owner@example.test', 2)
      assert.equal(duplicateQuantityLargeRefill.status, 200)
      assert.equal((await duplicateQuantityLargeRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 52_300, 'A duplicate quantity-2 large refill must not double-credit the wallet')

      const uncontractedProOrder = await sendPaidOrder('smoke-pro-without-contract', 'AUTO-SUB-PRO-MONTHLY')
      assert.equal(uncontractedProOrder.status, 503, 'A subscription SKU without a Shopify contract must not create or extend access')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.some((record) => record.lastShopifyOrderId === 'smoke-pro-without-contract'), false)

      const nextProBillingAt = '2099-01-31T12:00:00.000Z'
      const proOrder = await sendPaidOrder('smoke-pro', 'AUTO-SUB-PRO-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: '123456789',
        next_billing_date: nextProBillingAt,
      })
      assert.equal(proOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'pro')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.accessType, 'subscription')
      assert.equal(provisioned.records[0]?.permanentAccess, false)
      assert.equal(provisioned.records[0]?.planPriceCents, 2999)
      assert.equal(provisioned.records[0]?.subscriptionStatus, 'active')
      assert.equal(provisioned.records[0]?.nextBillingAt, nextProBillingAt)
      assert.equal(provisioned.records[0]?.usagePriority, 'automnia_only')
      assert.equal(provisioned.records[0]?.creditBalance, 107_300, 'Pro must add 55,000 credits to the existing wallet')

      const starterToProStarter = await sendPaidOrder('smoke-starter-to-pro-starter', 'AUTO-SUB-STARTER-MONTHLY', 'starter-to-pro@example.test', 1, {
        subscription_contract_id: 'starter-to-pro-starter-contract',
        next_billing_date: '2099-01-01T12:00:00.000Z',
      })
      assert.equal(starterToProStarter.status, 200)
      const starterToProUpgrade = await sendPaidOrder('smoke-starter-to-pro-upgrade', 'AUTO-SUB-PRO-MONTHLY', 'STARTER-TO-PRO@EXAMPLE.TEST', 1, {
        subscription_contract_id: 'starter-to-pro-upgrade-contract',
        next_billing_date: '2099-02-01T12:00:00.000Z',
      })
      assert.equal(starterToProUpgrade.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      const upgradedProRecord = provisioned.records.find((record) => record.email === 'starter-to-pro@example.test')
      assert.equal(upgradedProRecord?.tier, 'pro')
      assert.equal(upgradedProRecord?.mode, 'hosted_credits')
      assert.equal(upgradedProRecord?.permanentAccess, false)
      assert.equal(upgradedProRecord?.accessType, 'subscription')
      assert.equal(upgradedProRecord?.byokAllowed, true, 'Pro includes the complete provider capability set')
      assert.equal(upgradedProRecord?.creditBalance, 77_000, 'Starter credits must survive a Pro upgrade and combine with Pro credits')
      assert.equal(upgradedProRecord?.usagePriority, 'automnia_only', 'Pro with carried-over credits should default to the preserved credit route')

      const lowerOrder = await sendPaidOrder('smoke-starter-again', 'AUTO-SUB-STARTER-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'starter-after-pro-contract',
        next_billing_date: '2099-02-01T12:00:00.000Z',
      })
      assert.equal(lowerOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 2)
      assert.equal(provisioned.records[0]?.tier, 'pro')

      const lifecycleContractId = 'lifecycle-contract-smoke'
      const lifecycleOrder = await sendPaidOrder('smoke-lifecycle-pro', 'AUTO-SUB-PRO-MONTHLY', 'lifecycle@example.test', 1, {
        subscription_contract_id: lifecycleContractId,
        next_billing_date: '2099-02-01T12:00:00.000Z',
      })
      assert.equal(lifecycleOrder.status, 200)

      const wrongContractCancel = await sendShopifyWebhook('subscription-contracts-cancel', 'smoke-wrong-contract-cancel', {
        id: 'different-contract-smoke',
        email: 'lifecycle@example.test',
        status: 'CANCELLED',
      })
      assert.equal(wrongContractCancel.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      let lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'active', 'A webhook for a different contract must not cancel this customer\'s current subscription')
      assert.equal(lifecycleRecord?.active, true)

      const renewal = await sendShopifyWebhook('subscription-billing-attempts-success', 'smoke-lifecycle-renewal', {
        subscription_contract_id: lifecycleContractId,
        next_billing_date: '2099-03-01T12:00:00.000Z',
      })
      assert.equal(renewal.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'active')
      assert.equal(lifecycleRecord?.active, true)
      assert.equal(lifecycleRecord?.nextBillingAt, '2099-03-01T12:00:00.000Z')

      const paymentFailure = await sendShopifyWebhook('subscription-billing-attempts-failure', 'smoke-lifecycle-payment-failure', {
        subscription_contract_id: lifecycleContractId,
        error_code: 'PAYMENT_METHOD_INVALID',
      })
      assert.equal(paymentFailure.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'payment_failed')

      const recoveredPayment = await sendShopifyWebhook('subscription-billing-attempts-success', 'smoke-lifecycle-payment-recovered', {
        subscription_contract_id: lifecycleContractId,
        next_billing_date: '2099-04-01T12:00:00.000Z',
      })
      assert.equal(recoveredPayment.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'active')
      assert.equal(lifecycleRecord?.active, true)
      assert.equal(lifecycleRecord?.billingFailureCode, null)

      const paused = await sendShopifyWebhook('subscription-contracts-pause', 'smoke-lifecycle-pause', {
        id: lifecycleContractId,
        status: 'PAUSED',
      })
      assert.equal(paused.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'paused')

      const latePaymentWhilePaused = await sendShopifyWebhook('subscription-billing-attempts-success', 'smoke-lifecycle-late-payment-paused', {
        subscription_contract_id: lifecycleContractId,
        next_billing_date: '2099-05-01T12:00:00.000Z',
      })
      assert.equal(latePaymentWhilePaused.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'paused', 'A delayed successful billing webhook must not resume a paused contract')
      assert.equal(lifecycleRecord?.paymentStatus, 'paid')

      const cancelled = await sendShopifyWebhook('subscription-contracts-cancel', 'smoke-lifecycle-cancel', {
        id: lifecycleContractId,
        status: 'CANCELLED',
      })
      assert.equal(cancelled.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'cancelled')

      const latePaymentAfterCancellation = await sendShopifyWebhook('subscription-billing-attempts-success', 'smoke-lifecycle-late-payment-cancelled', {
        subscription_contract_id: lifecycleContractId,
        next_billing_date: '2099-06-01T12:00:00.000Z',
      })
      assert.equal(latePaymentAfterCancellation.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      lifecycleRecord = provisioned.records.find((record) => record.email === 'lifecycle@example.test')
      assert.equal(lifecycleRecord?.subscriptionStatus, 'cancelled', 'A delayed successful billing webhook must not reactivate a cancelled contract')
      assert.equal(lifecycleRecord?.paymentStatus, 'paid')

      const firstOrderQuantityRefill = await sendPaidOrder('smoke-first-order-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'quantity-owner@example.test', 2)
      assert.equal(firstOrderQuantityRefill.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'quantity-owner@example.test')?.creditBalance, 200, 'A first order with quantity 2 must provision 200 credits')
    }
    return { writeMode, planMappingHash: health.commerce.planMappingHash, activationStatus: activation.status }
  } finally {
    child.kill()
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
    if (child.exitCode && child.exitCode !== 0) throw new Error(`Service exited ${child.exitCode}: ${stderr}`)
  }
}

async function runUnconfiguredDeliveryCheck() {
  const port = await unusedPort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serviceRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      GOOGLE_CLOUD_PROJECT: 'local-smoke',
      AUTOMNIA_RELAY_MODEL: 'gemini-4-hydrogen',
      LOCAL_IN_MEMORY_LICENSES: 'true',
      MIGRATION_WRITE_MODE: 'active',
      SHOPIFY_PLAN_MAPPINGS: encodedMappings,
      SHOPIFY_CHECKOUT_URL: 'https://example.test/automnia-checkout',
      SHOPIFY_STORE_DOMAIN: 'automnia.app',
      SHOPIFY_WEBHOOK_SECRETS: 'local-smoke-webhook-value',
      ADMIN_API_TOKEN: 'local-smoke-admin-value',
    },
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    const health = await waitForHealth(baseUrl)
    assert.equal(health.commerce.emailDeliveryConfigured, false)
    const body = JSON.stringify({
      id: 'smoke-unconfigured-email',
      email: 'owner@example.test',
      subscription_contract_id: 'smoke-unconfigured-email-contract',
      next_billing_date: '2099-01-01T12:00:00.000Z',
      line_items: [{ sku: 'AUTO-SUB-STARTER-MONTHLY', quantity: 1 }],
    })
    const signature = createHmac('sha256', 'local-smoke-webhook-value').update(body).digest('base64')
    const response = await fetch(`${baseUrl}/shopify/webhooks/orders-paid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': signature,
        'x-shopify-webhook-id': 'smoke-unconfigured-email',
      },
      body,
    })
    assert.equal(response.status, 503)
    const provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((result) => result.json())
    assert.equal(provisioned.count, 1)
    assert.equal(Object.hasOwn(provisioned.records[0] || {}, 'emailDelivery'), false)
    const retry = await fetch(`${baseUrl}/admin/email-delivery/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer local-smoke-admin-value', 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'smoke-unconfigured-email' }),
    })
    assert.equal(retry.status, 503)
    return { deliveryStatus: response.status, retryStatus: retry.status }
  } finally {
    child.kill()
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
    if (child.exitCode && child.exitCode !== 0) throw new Error(`Service exited ${child.exitCode}: ${stderr}`)
  }
}

const active = await runMode('active')
const readOnly = await runMode('read_only')
assert.equal(active.planMappingHash, readOnly.planMappingHash)
assert.equal(active.planMappingHash, expectedPlanMappingHash, 'runtime and deployment tooling must hash the same canonical Shopify plan map')
const unconfiguredDelivery = await runUnconfiguredDeliveryCheck()
console.log(JSON.stringify({ passed: true, active, readOnly, unconfiguredDelivery }))

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const infraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceRoot = path.join(infraRoot, 'service')
const welcomeEmail = await readFile(path.join(serviceRoot, 'welcomeEmail.js'), 'utf8')
assert.match(welcomeEmail, /AUTMNIA/)
assert.match(welcomeEmail, /AI NEXUS/)
assert.match(welcomeEmail, /Your secure access details/)
assert.match(welcomeEmail, /Get started in four steps/)
const mappings = JSON.parse(await readFile(path.join(infraRoot, 'shopify-plan-mappings.json'), 'utf8'))
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
      SHOPIFY_STORE_DOMAIN: 'unbkay-k3.myshopify.com',
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
      const sendPaidOrder = async (id, sku, email = 'owner@example.test', quantity = 1) => {
        const body = JSON.stringify({
          id,
          email,
          name: `#${id}`,
          line_items: [{ sku, quantity }],
        })
        const signature = createHmac('sha256', 'local-smoke-webhook-value').update(body).digest('base64')
        return fetch(`${baseUrl}/shopify/webhooks/orders-paid`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-hmac-sha256': signature,
            'x-shopify-webhook-id': `smoke-${id}`,
          },
          body,
        })
      }

      const starterOrder = await sendPaidOrder('smoke-starter', 'AUTO-SUB-STARTER-MONTHLY')
      assert.equal(starterOrder.status, 200)
      let provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'starter')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.byokAllowed, false)
      assert.equal(provisioned.records[0]?.permanentAccess, false)
      assert.equal(provisioned.records[0]?.accessType, 'subscription')
      assert.equal(provisioned.records[0]?.usagePriority, 'automnia_only')

      const refillOrder = await sendPaidOrder('smoke-owner-refill-10m', 'AUTO-REFILL-10M')
      assert.equal(refillOrder.status, 200)
      assert.equal((await refillOrder.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      const refilledOwner = provisioned.records.find((record) => record.email === 'owner@example.test')
      assert.equal(refilledOwner?.creditBalance, 10_500_000, '10M Shopify refill must add to the existing hosted-credit wallet')

      const duplicateRefill = await sendPaidOrder('smoke-owner-refill-10m', 'AUTO-REFILL-10M')
      assert.equal(duplicateRefill.status, 200)
      assert.equal((await duplicateRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 10_500_000, 'Duplicate Shopify delivery must not double-credit the wallet')

      const dollarRefill = await sendPaidOrder('smoke-owner-refill-100k', 'AUTO-REFILL-100K')
      assert.equal(dollarRefill.status, 200)
      assert.equal((await dollarRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 10_600_000, '$1 Shopify refill must add 100,000 hosted credits')

      const duplicateDollarRefill = await sendPaidOrder('smoke-owner-refill-100k', 'AUTO-REFILL-100K')
      assert.equal(duplicateDollarRefill.status, 200)
      assert.equal((await duplicateDollarRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 10_600_000, 'Duplicate $1 Shopify delivery must not double-credit the wallet')

      const quantityRefill = await sendPaidOrder('smoke-owner-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'owner@example.test', 2)
      assert.equal(quantityRefill.status, 200)
      assert.equal((await quantityRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 10_800_000, 'A quantity-2 100K refill must add 200,000 hosted credits')

      const duplicateQuantityRefill = await sendPaidOrder('smoke-owner-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'owner@example.test', 2)
      assert.equal(duplicateQuantityRefill.status, 200)
      assert.equal((await duplicateQuantityRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 10_800_000, 'A duplicate quantity-2 delivery must not double-credit the wallet')

      const quantityLargeRefill = await sendPaidOrder('smoke-owner-refill-10m-quantity-2', 'AUTO-REFILL-10M', 'owner@example.test', 2)
      assert.equal(quantityLargeRefill.status, 200)
      assert.equal((await quantityLargeRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 30_800_000, 'A quantity-2 10M refill must add 20,000,000 hosted credits')

      const duplicateQuantityLargeRefill = await sendPaidOrder('smoke-owner-refill-10m-quantity-2', 'AUTO-REFILL-10M', 'owner@example.test', 2)
      assert.equal(duplicateQuantityLargeRefill.status, 200)
      assert.equal((await duplicateQuantityLargeRefill.json()).action, 'duplicate_ignored')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 30_800_000, 'A duplicate quantity-2 large refill must not double-credit the wallet')

      const proOrder = await sendPaidOrder('smoke-pro', 'AUTO-SUB-PRO-MONTHLY')
      assert.equal(proOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'pro')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.accessType, 'permanent')
      assert.equal(provisioned.records[0]?.usagePriority, 'automnia_only')

      const starterToByokStarter = await sendPaidOrder('smoke-starter-to-byok-starter', 'AUTO-SUB-STARTER-MONTHLY', 'starter-to-byok@example.test')
      assert.equal(starterToByokStarter.status, 200)
      const starterToByokUpgrade = await sendPaidOrder('smoke-starter-to-byok-upgrade', 'AUTO-BYOK-ONETIME', 'STARTER-TO-BYOK@EXAMPLE.TEST')
      assert.equal(starterToByokUpgrade.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      const upgradedByokRecord = provisioned.records.find((record) => record.email === 'starter-to-byok@example.test')
      assert.equal(upgradedByokRecord?.tier, 'byok')
      assert.equal(upgradedByokRecord?.mode, 'byok')
      assert.equal(upgradedByokRecord?.permanentAccess, true)
      assert.equal(upgradedByokRecord?.creditBalance, 500000, 'Starter hosted credits must survive a BYOK upgrade')
      assert.equal(upgradedByokRecord?.usagePriority, 'automnia_only', 'BYOK with carried-over hosted credits should default to the preserved credit route')

      const byokOrder = await sendPaidOrder('smoke-byok', 'AUTO-BYOK-ONETIME', 'byok-owner@example.test')
      assert.equal(byokOrder.status, 200)
      const byokRefill = await sendPaidOrder('smoke-byok-refill', 'AUTO-SUB-STARTER-MONTHLY', 'BYOK-OWNER@EXAMPLE.TEST')
      assert.equal(byokRefill.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      const byokRecord = provisioned.records.find((record) => record.email === 'byok-owner@example.test')
      assert.equal(byokRecord?.mode, 'byok')
      assert.equal(byokRecord?.permanentAccess, true)
      assert.equal(byokRecord?.usagePriority, 'automnia_only')
      assert.equal(byokRecord?.creditBalance, 500000)

      const byokDollarRefill = await sendPaidOrder('smoke-byok-refill-100k', 'AUTO-REFILL-100K', 'BYOK-OWNER@EXAMPLE.TEST')
      assert.equal(byokDollarRefill.status, 200)
      assert.equal((await byokDollarRefill.json()).action, 'topup_applied')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'byok-owner@example.test')?.creditBalance, 600000, '$1 Shopify refill must add 100,000 credits to a BYOK account')

      const lowerOrder = await sendPaidOrder('smoke-starter-again', 'AUTO-SUB-STARTER-MONTHLY')
      assert.equal(lowerOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 3)
      assert.equal(provisioned.records[0]?.tier, 'pro')

      const firstOrderQuantityRefill = await sendPaidOrder('smoke-first-order-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'quantity-owner@example.test', 2)
      assert.equal(firstOrderQuantityRefill.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'quantity-owner@example.test')?.creditBalance, 200000, 'A first order with quantity 2 must provision 200,000 hosted credits')
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
      LOCAL_IN_MEMORY_LICENSES: 'true',
      MIGRATION_WRITE_MODE: 'active',
      SHOPIFY_PLAN_MAPPINGS: encodedMappings,
      SHOPIFY_CHECKOUT_URL: 'https://example.test/automnia-checkout',
      SHOPIFY_STORE_DOMAIN: 'unbkay-k3.myshopify.com',
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
const unconfiguredDelivery = await runUnconfiguredDeliveryCheck()
console.log(JSON.stringify({ passed: true, active, readOnly, unconfiguredDelivery }))

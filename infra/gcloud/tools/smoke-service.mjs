import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLicenseEmailHtml } from '../service/welcomeEmail.js'
import {
  buildLicenseEmailMimeMessage,
  encodeGmailRawMessage,
  encodeMicrosoftGraphRawMessage,
} from '../service/licenseEmailMime.js'

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
assert.match(welcomeEmail, /Google sign-in is optional/)
const newCustomerEmail = buildLicenseEmailHtml({ email: 'new@example.test', licenseKey: 'AUT-TEST-0001', tier: 'starter' })
assert.match(newCustomerEmail, /Create or sign in with your Automnia password\. Google sign-in is optional\./)
const upgradedCustomerEmail = buildLicenseEmailHtml(
  { email: 'existing@example.test', licenseKey: 'AUT-TEST-0002', tier: 'pro' },
  { isAccountUpdate: true, purchasePlan: 'Automnia Pro Monthly <script>' },
)
assert.match(upgradedCustomerEmail, /Automnia Pro Monthly &lt;script&gt;/, 'Plan details in upgrade emails must be HTML escaped')
assert.match(upgradedCustomerEmail, /Your new plan order is linked to your existing Automnia account/)
assert.match(upgradedCustomerEmail, /same license key below/)
const licenseMimeMessage = buildLicenseEmailMimeMessage({
  from: 'Automnia AI Nexus <support@automnia.app>',
  to: 'customer@example.test',
  subject: 'Welcome to Automnia AI Nexus — your license key',
  text: 'Your Automnia license key is ready.',
  html: '<p>Your Automnia license key is ready.</p>',
})
assert.match(licenseMimeMessage, /^From: Automnia AI Nexus <support@automnia\.app>\r$/m)
assert.match(licenseMimeMessage, /multipart\/alternative/)
assert.match(Buffer.from(encodeGmailRawMessage(licenseMimeMessage), 'base64url').toString('utf8'), /^From: Automnia AI Nexus/)
assert.match(Buffer.from(encodeMicrosoftGraphRawMessage(licenseMimeMessage), 'base64').toString('utf8'), /^From: Automnia AI Nexus/)
assert.match(provisionerService, /'Content-Type': 'text\/plain'/)
assert.match(provisionerService, /buildMicrosoftGraphRawMessage\(record, context\)/)
const zeroValueAccountEmail = buildLicenseEmailHtml(
  { email: 'existing@example.test', licenseKey: 'AUT-TEST-0003', tier: 'pro' },
  { isAccountUpdate: true, zeroValueOrder: true, purchasePlan: 'Automnia Pro Monthly' },
)
assert.match(zeroValueAccountEmail, /This \$0 order did not add plan access or credits/)
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
      SHOPIFY_STORE_DOMAIN: 'j12hqc-h2.myshopify.com',
      SHOPIFY_API_VERSION: '2026-07',
      SHOPIFY_ADMIN_API_TOKEN: 'local-smoke-shopify-admin-token',
      AUTOMNIA_TEST_EMAIL_DELIVERY: 'stub',
      EMAIL_PROVIDER: 'microsoft_graph',
      EMAIL_MAILBOX: 'support@automnia.app',
      EMAIL_SENDER: 'licenses@automnia.app',
      SHOPIFY_WEBHOOK_SECRETS: 'local-smoke-webhook-value',
      ADMIN_API_TOKEN: 'local-smoke-admin-value\r\n',
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    const health = await waitForHealth(baseUrl)
    assert.equal(health.ok, true)
    assert.equal(health.writeMode, writeMode)
    assert.equal(health.aiRelayModel, 'gemini-4-hydrogen')
    assert.deepEqual(health.aiRelayModels, ['gemini-4-hydrogen', 'gemini-3.8-flash'])
    assert.deepEqual(health.aiRelayFallbackModels, ['gemini-3.8-flash'])
    assert.deepEqual(health.aiRelaySelectableModels, ['gemini-4-carbon', 'gemini-4-neon', 'gemini-4-hydrogen', 'gemini-3.8-flash'])
    assert.equal(health.vertexLocation, 'global')
    assert.equal(health.billing?.accountingUnit, 'tokens')
    assert.equal(health.billing?.displayUnit, 'credits')
    assert.equal(health.billing?.tokensPerCredit, 1_000)
    assert.equal(health.billing?.billingUnitVersion, 2)
    assert.equal(20_000_000 / health.billing.tokensPerCredit, 20_000, '20M tokens must map to 20,000 displayed credits')
    assert.equal(health.commerce.planMappingCount, mappings.length)
    assert.equal(health.commerce.checkoutConfigured, true)
    assert.equal(health.commerce.webhookSecretsConfigured, true)
    assert.equal(health.commerce.emailDeliveryConfigured, true)
    assert.equal(health.commerce.emailDeliveryProvider, 'microsoft_graph')
    assert.equal(health.commerce.emailDeliverySender, 'licenses@automnia.app')
    assert.equal(health.commerce.emailDeliveryMailbox, 'support@automnia.app')

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
      const sendShopifyWebhook = async (webhookName, deliveryId, payload, shopDomain = 'j12hqc-h2.myshopify.com') => {
        const body = JSON.stringify(payload)
        const signature = createHmac('sha256', 'local-smoke-webhook-value').update(body).digest('base64')
        return fetch(`${baseUrl}/shopify/webhooks/${webhookName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-hmac-sha256': signature,
            'x-shopify-webhook-id': deliveryId,
            'x-shopify-shop-domain': shopDomain,
          },
          body,
        })
      }

      const smokeUnitPriceCents = {
        'AUTO-REFILL-100K': 100,
        'AUTO-REFILL-500K': 500,
        'AUTO-REFILL-1M': 1_000,
        'AUTO-REFILL-2500K': 2_500,
        'AUTO-REFILL-5M': 5_000,
        'AUTO-REFILL-10M': 10_000,
        'AUTO-SUB-STARTER-MONTHLY': 1_999,
        'AUTO-SUB-PRO-MONTHLY': 2_999,
        'AUTO-BYOK-ONETIME': 2_999,
      }
      const sendPaidOrder = async (id, sku, email = 'owner@example.test', quantity = 1, extra = {}) => {
        const unitPriceCents = smokeUnitPriceCents[sku]
        assert.ok(Number.isInteger(unitPriceCents), `smoke order requires a mapped price for ${sku}`)
        const lineItem = { sku, quantity, price: (unitPriceCents / 100).toFixed(2), total_discount: '0.00' }
        const body = JSON.stringify({
          id,
          email,
          name: `#${id}`,
          financial_status: 'paid',
          total_price: ((unitPriceCents * quantity) / 100).toFixed(2),
          line_items: [lineItem],
          ...extra,
        })
        return sendShopifyWebhook('orders-paid', `smoke-${id}`, JSON.parse(body))
      }

      const crossStoreOrder = await sendShopifyWebhook('orders-paid', 'smoke-source-store-order', {
        id: 'smoke-source-store-order',
        email: 'foreign@example.test',
        financial_status: 'paid',
        total_price: '29.99',
        subscription_contract_id: 'source-store-contract-smoke',
        next_billing_date: '2099-01-01T12:00:00.000Z',
        line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '0.00' }],
      }, 'unbkay-k3.myshopify.com')
      assert.equal(crossStoreOrder.status, 401, 'A valid webhook signed for another Shopify store must be rejected')
      let provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.some((record) => record.email === 'foreign@example.test'), false, 'A source-store webhook must not create target-store access')

      const starterOrder = await sendPaidOrder('smoke-starter', 'AUTO-SUB-STARTER-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'starter-contract-smoke',
        next_billing_date: '2099-01-01T12:00:00.000Z',
      })
      assert.equal(starterOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'starter')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.byokAllowed, false)
      assert.equal(provisioned.records[0]?.permanentAccess, false)
      assert.equal(provisioned.records[0]?.accessType, 'subscription')
      assert.equal(provisioned.records[0]?.usagePriority, 'automnia_only')
      assert.equal(provisioned.records[0]?.creditBalance, 22_000, 'Starter must display 22,000 credits for its 22,000,000-token grant')

      const duplicateStarterOrder = await sendPaidOrder('smoke-starter', 'AUTO-SUB-STARTER-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'starter-contract-smoke',
        next_billing_date: '2099-01-01T12:00:00.000Z',
      })
      assert.equal(duplicateStarterOrder.status, 200)
      assert.equal((await duplicateStarterOrder.json()).action, 'duplicate_ignored')

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

      const duplicateProOrder = await sendPaidOrder('smoke-pro', 'AUTO-SUB-PRO-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: '123456789',
        next_billing_date: nextProBillingAt,
      })
      assert.equal(duplicateProOrder.status, 200)
      assert.equal((await duplicateProOrder.json()).action, 'duplicate_ignored')

      const zeroValueProOrder = await sendPaidOrder('smoke-zero-value-pro', 'AUTO-SUB-PRO-MONTHLY', 'zero-value@example.test', 1, {
        subscription_contract_id: 'zero-value-contract-smoke',
        next_billing_date: '2099-02-01T12:00:00.000Z',
        total_price: '0.00',
        line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '29.99' }],
      })
      assert.equal(zeroValueProOrder.status, 200)
      assert.equal((await zeroValueProOrder.json()).action, 'order_rejected_unpaid', 'A $0 paid-status order must not grant a Pro balance')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.some((record) => record.email === 'zero-value@example.test'), false, 'A zero-value order must not provision an entitlement')

      const zeroValueDuplicateProOrder = await sendPaidOrder('smoke-pro', 'AUTO-SUB-PRO-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: '123456789',
        next_billing_date: nextProBillingAt,
        total_price: '0.00',
        line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '29.99' }],
      })
      assert.equal(zeroValueDuplicateProOrder.status, 200)
      assert.equal((await zeroValueDuplicateProOrder.json()).action, 'order_rejected_unpaid', 'A zero-value replay must be rejected before duplicate delivery recovery')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 107_300, 'Rejecting a zero-value replay must not change an existing balance')

      const zeroValueExistingAccountOrder = await sendPaidOrder('smoke-owner-free-plan-key', 'AUTO-SUB-PRO-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'owner-free-plan-contract',
        total_price: '0.00',
        line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '29.99' }],
      })
      assert.equal(zeroValueExistingAccountOrder.status, 200)
      assert.equal((await zeroValueExistingAccountOrder.json()).action, 'zero_value_order_key_emailed', 'An existing customer should receive their current key after a zero-dollar Shopify order, without a new entitlement')
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'owner@example.test')?.creditBalance, 107_300, 'A zero-dollar order email must not add credits')
      const duplicateZeroValueExistingAccountOrder = await sendPaidOrder('smoke-owner-free-plan-key', 'AUTO-SUB-PRO-MONTHLY', 'owner@example.test', 1, {
        subscription_contract_id: 'owner-free-plan-contract',
        total_price: '0.00',
        line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '29.99' }],
      })
      assert.equal(duplicateZeroValueExistingAccountOrder.status, 200)
      assert.equal((await duplicateZeroValueExistingAccountOrder.json()).action, 'zero_value_order_key_already_sent')
      const retrySpecificOrder = await fetch(`${baseUrl}/admin/email-delivery/retry`, {
        method: 'POST',
        headers: { Authorization: 'Bearer local-smoke-admin-value', 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'smoke-starter', shopifyOrderId: 'smoke-owner-free-plan-key' }),
      })
      assert.equal(retrySpecificOrder.status, 200)
      const retrySpecificOrderResult = await retrySpecificOrder.json()
      assert.equal(retrySpecificOrderResult.action, 'email_already_sent')
      assert.equal(retrySpecificOrderResult.status, 'sent', 'An admin retry must report the status of the requested Shopify order')

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

      const contractLinkOrder = await sendPaidOrder('smoke-contract-link-paid', 'AUTO-SUB-PRO-MONTHLY', 'contract-link@example.test', 1, {
        subscription_contract_id: 'original-contract-link',
        next_billing_date: '2099-01-01T12:00:00.000Z',
      })
      assert.equal(contractLinkOrder.status, 200)
      const unpaidContractCreate = await sendShopifyWebhook('subscription-contracts-create', 'smoke-contract-link-create', {
        id: 'contract-link-after-unpaid-create',
        status: 'ACTIVE',
        origin_order: {
          id: 'smoke-contract-link-zero-order',
          email: 'contract-link@example.test',
          financial_status: 'paid',
          total_price: '0.00',
          line_items: [{ sku: 'AUTO-SUB-PRO-MONTHLY', quantity: 1, price: '29.99', total_discount: '29.99' }],
        },
      })
      assert.equal(unpaidContractCreate.status, 200)
      assert.equal((await unpaidContractCreate.json()).action, 'subscription_contract_linked_waiting_for_payment')
      let contractLinkRecord = (await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())).records.find((record) => record.email === 'contract-link@example.test')
      assert.equal(contractLinkRecord?.creditBalance, 55_000, 'Linking an unpaid contract must not grant credits')
      const pauseLinkedContract = await sendShopifyWebhook('subscription-contracts-pause', 'smoke-contract-link-pause', {
        id: 'contract-link-after-unpaid-create',
        status: 'PAUSED',
      })
      assert.equal(pauseLinkedContract.status, 200)
      assert.equal((await pauseLinkedContract.json()).action, 'subscription_state_updated', 'The lifecycle hook must locate the license linked during contract creation')
      contractLinkRecord = (await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())).records.find((record) => record.email === 'contract-link@example.test')
      assert.equal(contractLinkRecord?.subscriptionStatus, 'paused', 'A subsequent pause event must update the linked license state')

      const firstOrderQuantityRefill = await sendPaidOrder('smoke-first-order-refill-100k-quantity-2', 'AUTO-REFILL-100K', 'quantity-owner@example.test', 2)
      assert.equal(firstOrderQuantityRefill.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.records.find((record) => record.email === 'quantity-owner@example.test')?.creditBalance, 200, 'A first order with quantity 2 must provision 200 credits')
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    const deliveredEmailOrders = stdout.split(/\r?\n/)
      .filter((line) => line.includes('"event":"test_license_email_delivery"'))
      .map((line) => {
        try { return JSON.parse(line).shopifyOrderId } catch { return null }
      })
      .filter(Boolean)
    if (writeMode === 'active') {
      const emailCount = (shopifyOrderId) => deliveredEmailOrders.filter((value) => value === shopifyOrderId).length
      for (const orderId of ['smoke-starter', 'smoke-owner-refill-10m', 'smoke-pro', 'smoke-owner-free-plan-key', 'smoke-starter-to-pro-starter', 'smoke-starter-to-pro-upgrade', 'smoke-starter-again', 'smoke-contract-link-paid']) {
        assert.equal(emailCount(orderId), 1, `Successful order ${orderId} must send exactly one license key email despite duplicate webhook delivery`)
      }
      assert.equal(emailCount('smoke-zero-value-pro'), 0, 'A zero-value order must not trigger an entitlement email')
    } else {
      assert.equal(deliveredEmailOrders.length, 0, 'Read-only mode must not send license emails')
    }
    return { writeMode, planMappingHash: health.commerce.planMappingHash, activationStatus: activation.status, emailDeliveries: deliveredEmailOrders.length }
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
      SHOPIFY_STORE_DOMAIN: 'j12hqc-h2.myshopify.com',
      SHOPIFY_WEBHOOK_SECRETS: 'local-smoke-webhook-value',
      ADMIN_API_TOKEN: 'local-smoke-admin-value\r\n',
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
      financial_status: 'paid',
      total_price: '19.99',
      subscription_contract_id: 'smoke-unconfigured-email-contract',
      next_billing_date: '2099-01-01T12:00:00.000Z',
      line_items: [{ sku: 'AUTO-SUB-STARTER-MONTHLY', quantity: 1, price: '19.99', total_discount: '0.00' }],
    })
    const signature = createHmac('sha256', 'local-smoke-webhook-value').update(body).digest('base64')
    const response = await fetch(`${baseUrl}/shopify/webhooks/orders-paid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': signature,
        'x-shopify-webhook-id': 'smoke-unconfigured-email',
        'x-shopify-shop-domain': 'j12hqc-h2.myshopify.com',
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

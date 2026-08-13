import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const infraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceRoot = path.join(infraRoot, 'service')
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
    assert.equal(health.commerce.planMappingCount, 9)
    assert.equal(health.commerce.checkoutConfigured, true)
    assert.equal(health.commerce.webhookSecretsConfigured, true)

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
      const sendPaidOrder = async (id, sku, email = 'owner@example.test') => {
        const body = JSON.stringify({
          id,
          email,
          name: `#${id}`,
          line_items: [{ sku }],
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

      const proOrder = await sendPaidOrder('smoke-pro', 'AUTO-SUB-PRO-MONTHLY')
      assert.equal(proOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'pro')
      assert.equal(provisioned.records[0]?.mode, 'hosted_credits')
      assert.equal(provisioned.records[0]?.accessType, 'permanent')

      const lowerOrder = await sendPaidOrder('smoke-starter-again', 'AUTO-SUB-STARTER-MONTHLY')
      assert.equal(lowerOrder.status, 200)
      provisioned = await fetch(`${baseUrl}/provisioned`, { headers: { Authorization: 'Bearer local-smoke-admin-value' } }).then((response) => response.json())
      assert.equal(provisioned.count, 1)
      assert.equal(provisioned.records[0]?.tier, 'pro')
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

const active = await runMode('active')
const readOnly = await runMode('read_only')
assert.equal(active.planMappingHash, readOnly.planMappingHash)
console.log(JSON.stringify({ passed: true, active, readOnly }))

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

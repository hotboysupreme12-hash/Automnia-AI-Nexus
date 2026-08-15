import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express, { type Express } from 'express'

import { registerLicenseRoutes } from '../server/routes/licenseRoutes'
import type { LicenseService, LicenseStatus } from '../server/services/license/licenseService'

async function withRouteServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function activeStatus(usagePriority: LicenseStatus['usagePriority']): LicenseStatus {
  return {
    active: true,
    email: 'customer@example.test',
    tier: 'pro',
    mode: 'hosted_credits',
    planPriceCents: null,
    byokAllowed: true,
    permanentAccess: true,
    subscriptionStatus: 'active',
    usagePriority,
    creditBalance: 500,
    creditBalanceUpdatedAt: null,
    activatedAt: null,
    verifiedAt: null,
  }
}

test('usage priority does not acknowledge until Gateway route synchronization completes', async () => {
  let status = activeStatus('automnia_first')
  let resolveSynchronization!: () => void
  let markSynchronizationStarted!: () => void
  const synchronizationStarted = new Promise<void>((resolve) => { markSynchronizationStarted = resolve })
  const synchronizationGate = new Promise<void>((resolve) => { resolveSynchronization = resolve })

  const licenseService = {
    getStatus: () => status,
    isUsagePriorityLocked: () => false,
    setUsagePriority: (usagePriority: NonNullable<LicenseStatus['usagePriority']>) => {
      status = activeStatus(usagePriority)
      return status
    },
  } as unknown as LicenseService

  const app = express()
  app.use(express.json())
  registerLicenseRoutes(app, {
    licenseService,
    synchronizeOpenClawBillingRoute: async () => {
      markSynchronizationStarted()
      await synchronizationGate
    },
  })

  await withRouteServer(app, async (baseUrl) => {
    let responseSettled = false
    const responsePromise = fetch(`${baseUrl}/api/license/usage-priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usagePriority: 'provider_first' }),
    }).then((response) => {
      responseSettled = true
      return response
    })

    await synchronizationStarted
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(responseSettled, false)

    resolveSynchronization()
    const response = await responsePromise
    const payload = await response.json() as { ok: boolean; data: LicenseStatus }
    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.data.usagePriority, 'provider_first')
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAccountAuthService, AccountAuthError } from '../server/services/auth/accountAuthService'
import type { LicenseService } from '../server/services/license/licenseService'

function createHarness({ tier = 'pro', mode = 'hosted_credits', byokAllowed = true, permanentAccess = true, remoteUnavailable = false, googleSubject = 'google-subject', reconcileAccountAccess = false } = {}) {
  const values = new Map<string, unknown>()
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const adoptedLicenseKeys: string[] = []
  let reconciliationCount = 0
  let remotePassword = ''
  let remotePasswordSet = false
  const status = {
    active: true,
    email: null,
    tier,
    mode: mode as 'hosted_credits' | 'byok',
    planPriceCents: tier === 'starter' ? 1_999 : null,
    byokAllowed,
    permanentAccess,
    subscriptionStatus: 'active',
    usagePriority: 'automnia_only' as const,
    creditBalance: 500,
    creditBalanceUpdatedAt: null,
    activatedAt: null,
    verifiedAt: null,
  }
  const licenseService = {
    getStatus: () => status,
    adoptRemoteAccount: (license: Record<string, unknown>, licenseKey: string) => {
      adoptedLicenseKeys.push(licenseKey)
      status.email = typeof license.email === 'string' ? license.email : null
      status.tier = typeof license.tier === 'string' ? license.tier : status.tier
      status.mode = license.mode === 'byok' ? 'byok' : 'hosted_credits'
      status.byokAllowed = license.byokAllowed === true || byokAllowed
      status.permanentAccess = license.permanentAccess === true || permanentAccess
      return { ...status, licenseKey }
    },
  } as unknown as LicenseService
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
    if (remoteUnavailable) throw new Error('network down')
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const email = String(body.email || 'customer@example.com')
    const path = new URL(String(input)).pathname
    if (path === '/api/account/password/change' && remotePassword && body.currentPassword !== remotePassword) {
      return new Response(JSON.stringify({ ok: false, error: 'The current password is incorrect.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    if (path === '/api/account/setup' || path === '/api/account/password/set' || path === '/api/account/password/change') {
      remotePassword = String(body.password || body.newPassword || '')
      remotePasswordSet = true
    }
    if (path === '/api/account/login' && remotePassword && body.password !== remotePassword) {
      return new Response(JSON.stringify({ ok: false, error: 'The email or password is incorrect.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      ok: true,
      email,
      licenseKey: 'AUT-TEST-ACCOUNT',
      account: { accountId: 'acct-test', email, hasPassword: remotePasswordSet, googleSubject: path === '/api/account/google' ? googleSubject : null },
      license: {
        active: true,
        email,
        tier,
        mode,
        planPriceCents: tier === 'starter' ? 1_999 : null,
        byokAllowed,
        permanentAccess,
        subscriptionStatus: 'active',
        creditBalance: 500,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof globalThis.fetch
  const service = createAccountAuthService({
    read: <T>(key: string) => (values.get(key) as T | undefined) || null,
    write: (key: string, value: unknown) => { values.set(key, value); return true },
    licenseService,
    reconcileAccountAccess: reconcileAccountAccess
      ? async () => { reconciliationCount += 1 }
      : undefined,
    apiUrl: 'https://provisioner.example.test',
    fetch,
    now: () => new Date('2026-08-12T12:00:00.000Z'),
  })
  return {
    adoptedLicenseKeys,
    service,
    values,
    requests,
    status,
    setRemotePassword: (password: string) => {
      remotePassword = password
      remotePasswordSet = true
    },
    get reconciliationCount() {
      return reconciliationCount
    },
  }
}

test('first activation creates a local password verifier without storing the password', async () => {
  const harness = createHarness()
  const result = await harness.service.setup({
    email: 'Customer@example.com',
    licenseKey: 'AUT-TEST-ACCOUNT',
    password: 'correct horse battery staple',
  })

  assert.equal(result.account.email, 'customer@example.com')
  assert.equal(result.account.hasPassword, true)
  const stored = harness.values.get('account:identity') as Record<string, unknown>
  assert.notEqual(stored.passwordHash, 'correct horse battery staple')
  assert.equal(JSON.stringify(stored).includes('correct horse battery staple'), false)
})

test('higher-tier account sign-in works offline after first activation', async () => {
  const harness = createHarness()
  await harness.service.setup({ email: 'customer@example.com', licenseKey: 'AUT-TEST-ACCOUNT', password: 'correct horse battery staple' })
  const requestCount = harness.requests.length
  const result = await harness.service.login({ email: 'customer@example.com', password: 'correct horse battery staple' })

  assert.equal(result.account.email, 'customer@example.com')
  assert.equal(harness.requests.length, requestCount)
  await assert.rejects(
    () => harness.service.login({ email: 'customer@example.com', password: 'wrong password that is long' }),
    (error: unknown) => error instanceof AccountAuthError && error.code === 'invalid_credentials',
  )
})

test('account activation and re-login reconcile billing access without blocking offline login', async () => {
  const harness = createHarness({ reconcileAccountAccess: true })
  await harness.service.setup({ email: 'customer@example.com', licenseKey: 'AUT-TEST-ACCOUNT', password: 'correct horse battery staple' })
  await harness.service.login({ email: 'customer@example.com', password: 'correct horse battery staple' })

  assert.equal(harness.reconciliationCount, 2)
  assert.equal(harness.requests.length, 1)
})

test('Starter subscription account sign-in revalidates online after first activation', async () => {
  const harness = createHarness({ tier: 'starter', mode: 'hosted_credits', byokAllowed: false, permanentAccess: false })
  await harness.service.setup({ email: 'customer@example.com', licenseKey: 'AUT-TEST-ACCOUNT', password: 'correct horse battery staple' })
  const requestCount = harness.requests.length
  await harness.service.login({ email: 'customer@example.com', password: 'correct horse battery staple' })
  assert.equal(harness.requests.length, requestCount + 1)
})

test('Google account sign-in imports the matched license key and entitlement', async () => {
  const harness = createHarness({ tier: 'starter', byokAllowed: false })
  const result = await harness.service.loginWithGoogle('google-access-token')

  assert.equal(result.account.email, 'customer@example.com')
  assert.deepEqual(harness.adoptedLicenseKeys, ['AUT-TEST-ACCOUNT'])
  assert.equal(harness.status.email, 'customer@example.com')
  assert.equal(harness.status.tier, 'starter')
})

test('Google-only account can create a password without entering a nonexistent current password', async () => {
  const harness = createHarness()
  const googleResult = await harness.service.loginWithGoogle('google-access-token')
  assert.equal(googleResult.account.hasPassword, false)

  const result = await harness.service.setPassword({ newPassword: 'correct horse battery staple' })

  assert.equal(result.account.hasPassword, true)
  const setRequest = harness.requests.find((request) => request.path === '/api/account/password/set')
  assert.deepEqual(setRequest?.body, {
    email: 'customer@example.com',
    googleSubject: 'google-subject',
    newPassword: 'correct horse battery staple',
  })
  const stored = harness.values.get('account:identity') as Record<string, unknown>
  assert.equal(stored.googleSubject, 'google-subject')
  assert.notEqual(stored.passwordHash, 'correct horse battery staple')
})

test('a password changed on another device refreshes the stale local verifier', async () => {
  const harness = createHarness()
  await harness.service.setup({ email: 'customer@example.com', licenseKey: 'AUT-TEST-ACCOUNT', password: 'old password that is long' })
  harness.setRemotePassword('new password from another device')
  const result = await harness.service.login({ email: 'customer@example.com', password: 'new password from another device' })

  assert.equal(result.account.email, 'customer@example.com')
  assert.equal(harness.requests.at(-1)?.path, '/api/account/login')
  const stored = harness.values.get('account:identity') as Record<string, unknown>
  assert.notEqual(stored.passwordHash, 'old password that is long')
})

test('a Google login on a new device recognizes an existing remote password', async () => {
  const harness = createHarness()
  harness.setRemotePassword('existing account password')

  const googleResult = await harness.service.loginWithGoogle('google-access-token')
  assert.equal(googleResult.account.hasPassword, true)

  const result = await harness.service.changePassword({
    currentPassword: 'existing account password',
    newPassword: 'new password from this device',
  })

  assert.equal(result.account.hasPassword, true)
  assert.equal(harness.requests.at(-1)?.path, '/api/account/password/change')
})

test('Google password setup can recover when an older account response omits the subject', async () => {
  const harness = createHarness({ googleSubject: null })
  const googleResult = await harness.service.loginWithGoogle('google-access-token')

  assert.equal(googleResult.account.hasPassword, false)
  assert.equal(googleResult.account.googleLinked, true)

  await harness.service.setPassword({ newPassword: 'correct horse battery staple' })

  const setRequest = harness.requests.find((request) => request.path === '/api/account/password/set')
  assert.deepEqual(setRequest?.body, {
    email: 'customer@example.com',
    googleAccessToken: 'google-access-token',
    newPassword: 'correct horse battery staple',
  })
  const stored = harness.values.get('account:identity') as Record<string, unknown>
  assert.equal(stored.passwordSet, true)
  assert.equal(stored.googleSubject, null)
})

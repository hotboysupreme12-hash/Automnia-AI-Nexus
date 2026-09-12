import assert from 'node:assert/strict'
import test from 'node:test'
import { createLicenseService } from '../server/services/license/licenseService'
import { formatUsageRemaining } from '../src/utils/usageRemaining'

test('allocation survives legacy account rewrites and subsequent spending', () => {
  const record = { active: true, licenseKey: 'test', email: 'test@example.test', activatedAt: '2026-01-01', mode: 'hosted_credits', billingUnitVersion: 2, tokensPerCredit: 1_000, creditBalance: 9_564.638 }
  const data = new Map<string, unknown>([
    ['license:activation', record],
    ['license:usage-allocation', { email: record.email, activatedAt: record.activatedAt, baseline: 10_000, billingUnitVersion: 2 }],
  ])
  const service = createLicenseService({
    read: <T>(key: string) => (data.get(key) as T) ?? null,
    write: (key, value) => { data.set(key, value); return true },
    remove: key => data.delete(key),
  })
  assert.equal(service.getStatus().creditUsageBaseline, 10_000)
  service.recordHostedCreditBalance(9_500)
  let status = service.getStatus()
  assert.equal(formatUsageRemaining(status.creditBalance, status.creditUsageBaseline), '95%')
  data.set('license:activation', { ...record, creditBalance: 9_400 })
  status = service.getStatus()
  assert.equal(formatUsageRemaining(status.creditBalance, status.creditUsageBaseline), '94%')
  data.set('license:activation', { ...record, email: 'another@example.test' })
  assert.notEqual(service.getStatus().creditUsageBaseline, 10_000)
})

test('ignores an unversioned legacy raw-token allocation instead of using it as a credit baseline', () => {
  const record = { active: true, licenseKey: 'test', email: 'test@example.test', activatedAt: '2026-01-01', mode: 'hosted_credits', billingUnitVersion: 2, creditBalance: 193.521 }
  const data = new Map<string, unknown>([
    ['license:activation', record],
    ['license:usage-allocation', { email: record.email, activatedAt: record.activatedAt, baseline: 200_000 }],
  ])
  const service = createLicenseService({
    read: <T>(key: string) => (data.get(key) as T) ?? null,
    write: (key, value) => { data.set(key, value); return true },
    remove: key => data.delete(key),
  })

  assert.equal(service.getStatus().creditUsageBaseline, 193.521)
  assert.equal(formatUsageRemaining(service.getStatus().creditBalance, service.getStatus().creditUsageBaseline), '100%')
})

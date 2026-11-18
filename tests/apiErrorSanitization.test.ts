import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeApiErrorDetail } from '../server/controlPlaneHttp'

test('API error sanitization preserves a valid one-time confirmation UUID without weakening other redactions', () => {
  const confirmationId = '01234567-89ab-4cde-8fab-0123456789ab'
  const sanitized = sanitizeApiErrorDetail({
    confirmationId,
    phone: '212-555-0123',
    apiKey: 'sk-test-secret-value',
  }) as Record<string, unknown>

  assert.equal(sanitized.confirmationId, confirmationId)
  assert.equal(sanitized.phone, '[redacted-phone]')
  assert.equal(sanitized.apiKey, '[redacted]')
})

test('API error sanitization rejects malformed confirmation UUIDs and still applies text redaction', () => {
  const sanitized = sanitizeApiErrorDetail({ confirmationId: '123-555-0123' }) as Record<string, unknown>
  assert.equal(sanitized.confirmationId, '[redacted-phone]')
})

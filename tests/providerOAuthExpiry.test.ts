import assert from 'node:assert/strict'
import test from 'node:test'

import { providerOAuthExpiryGuidance } from '../src/utils/providerOAuthExpiry'

const NOW = Date.UTC(2026, 10, 17, 12)

test('OAuth expiry guidance warns a day ahead when refresh is unavailable', () => {
  const result = providerOAuthExpiryGuidance(NOW + 12 * 60 * 60 * 1000, false, NOW)
  assert.equal(result.tone, 'amber')
  assert.equal(result.label, 'Expires within 24 hours')
  assert.match(result.message, /Reconnect before the next model call/)
})

test('OAuth expiry guidance distinguishes near expiry with and without refresh', () => {
  const refreshable = providerOAuthExpiryGuidance(NOW + 30 * 60 * 1000, true, NOW)
  const reconnect = providerOAuthExpiryGuidance(NOW + 30 * 60 * 1000, false, NOW)
  assert.equal(refreshable.label, 'Expires soon · refresh available')
  assert.match(refreshable.message, /refresh token is available/)
  assert.equal(reconnect.label, 'Expires soon · reconnect')
  assert.match(reconnect.message, /Reconnect now/)
})

test('OAuth expiry guidance flags expired and unreported expiry without exposing credentials', () => {
  assert.equal(providerOAuthExpiryGuidance(NOW - 1, true, NOW).tone, 'rose')
  const unknown = providerOAuthExpiryGuidance(undefined, false, NOW)
  assert.equal(unknown.label, 'Expiry unknown')
  assert.match(unknown.message, /No access-token expiry/)
})

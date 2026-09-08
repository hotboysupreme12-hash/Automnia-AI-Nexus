import assert from 'node:assert/strict'
import test from 'node:test'

import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl, automniaCloudRouteBaseUrl } from '../server/config/automniaCloud'

test('uses the canonical Automnia API domain after DNS cutover', () => {
  assert.equal(AUTOMNIA_PUBLIC_CLOUD_URL, 'https://api.automnia.app')
  assert.equal(automniaCloudBaseUrl(), 'https://api.automnia.app')
  assert.equal(automniaCloudBaseUrl('https://staging.automnia.app///'), 'https://staging.automnia.app')
})

test('rejects insecure or credential-bearing provisioner overrides', () => {
  assert.throws(() => automniaCloudBaseUrl('http://api.automnia.app'), /HTTPS origin/)
  assert.throws(() => automniaCloudBaseUrl('https://user:password@api.automnia.app'), /HTTPS origin/)
})

test('hosted-credit routing uses the canonical deployment instead of persisted Gateway origins', () => {
  assert.equal(automniaCloudRouteBaseUrl(), AUTOMNIA_PUBLIC_CLOUD_URL)
})

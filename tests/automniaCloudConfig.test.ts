import assert from 'node:assert/strict'
import test from 'node:test'

import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl, automniaCloudRouteBaseUrl } from '../server/config/automniaCloud'

test('uses the temporary Automnia Cloud Run origin until DNS cutover', () => {
  assert.equal(AUTOMNIA_PUBLIC_CLOUD_URL, 'https://automnia-shopify-provisioner-gpz4bqizia-ue.a.run.app')
  assert.equal(automniaCloudBaseUrl(), 'https://automnia-shopify-provisioner-gpz4bqizia-ue.a.run.app')
  assert.equal(automniaCloudBaseUrl('https://staging.automnia.ai///'), 'https://staging.automnia.ai')
})

test('rejects insecure or credential-bearing provisioner overrides', () => {
  assert.throws(() => automniaCloudBaseUrl('http://api.automnia.ai'), /HTTPS origin/)
  assert.throws(() => automniaCloudBaseUrl('https://user:password@api.automnia.ai'), /HTTPS origin/)
})

test('hosted-credit routing uses the canonical deployment instead of persisted Gateway origins', () => {
  assert.equal(automniaCloudRouteBaseUrl(), AUTOMNIA_PUBLIC_CLOUD_URL)
})

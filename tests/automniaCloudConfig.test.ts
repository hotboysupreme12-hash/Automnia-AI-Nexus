import assert from 'node:assert/strict'
import test from 'node:test'

import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl } from '../server/config/automniaCloud'

test('uses the permanent Automnia hostname instead of a project-specific Cloud Run URL', () => {
  assert.equal(AUTOMNIA_PUBLIC_CLOUD_URL, 'https://api.automnia.ai')
  assert.equal(automniaCloudBaseUrl(), 'https://api.automnia.ai')
  assert.equal(automniaCloudBaseUrl('https://staging.automnia.ai///'), 'https://staging.automnia.ai')
})

test('rejects insecure or credential-bearing provisioner overrides', () => {
  assert.throws(() => automniaCloudBaseUrl('http://api.automnia.ai'), /HTTPS origin/)
  assert.throws(() => automniaCloudBaseUrl('https://user:password@api.automnia.ai'), /HTTPS origin/)
})

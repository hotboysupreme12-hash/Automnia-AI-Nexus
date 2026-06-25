import assert from 'node:assert/strict'
import { sanitizeApiErrorDetail } from '../server/controlPlaneHttp'

const circular: Record<string, unknown> = {
  message: 'Authorization: Bearer sk-live-123456789',
}
circular.self = circular

const sanitized = sanitizeApiErrorDetail({
  provider: 'openai',
  detail: {
    message: 'provider failed with Authorization: Bearer sk-nested-secret',
    safe: 'plain diagnostic text',
    token: 'provider-token',
    apiKey: 'provider-api-key',
    auth: {
      authorization: 'Bearer auth-secret',
      cookie: 'session=secret-cookie',
      oauth: {
        code: 'oauth-code',
        verifier: 'pkce-verifier',
      },
    },
    attempts: [
      {
        secret: 'nested-secret',
        result: 'failed',
      },
    ],
  },
  circular,
}) as Record<string, unknown>

const detail = sanitized.detail as Record<string, unknown>
const auth = detail.auth as Record<string, unknown>
const oauth = auth.oauth as Record<string, unknown>
const attempts = detail.attempts as Array<Record<string, unknown>>
const cleanCircular = sanitized.circular as Record<string, unknown>

assert.equal(sanitized.provider, 'openai')
assert.equal(detail.safe, 'plain diagnostic text')
assert.equal(detail.token, '[redacted]')
assert.equal(detail.apiKey, '[redacted]')
assert.equal(auth.authorization, '[redacted]')
assert.equal(auth.cookie, '[redacted]')
assert.equal(oauth.code, '[redacted]')
assert.equal(oauth.verifier, '[redacted]')
assert.equal(attempts[0]?.secret, '[redacted]')
assert.equal(attempts[0]?.result, 'failed')
assert.equal(cleanCircular.self, '[circular]')

const encoded = JSON.stringify(sanitized)
assert.doesNotMatch(encoded, /provider-token|provider-api-key|auth-secret|secret-cookie|oauth-code|pkce-verifier|nested-secret/)
assert.doesNotMatch(encoded, /sk-live-123456789|sk-nested-secret/)
assert.match(encoded, /\[redacted\]/)

console.log('api error redaction contract ok')

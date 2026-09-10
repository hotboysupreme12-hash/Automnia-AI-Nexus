import assert from 'node:assert/strict'
import test from 'node:test'
import { removeGeneratedHostedToolAllowlist } from '../server/services/agents/hostedToolPolicy'

test('hosted defaults stop restricting Full access while explicit operator policies survive', () => {
  const legacy = { allow: ['read', 'write', 'edit', 'exec', 'process', 'cron', 'memory_get', 'session_status'], deny: ['message'] }
  assert.deepEqual(removeGeneratedHostedToolAllowlist(legacy), { deny: ['message'] })
  assert.equal(legacy.allow.length, 8)
  const custom = { allow: ['read'], deny: ['exec'] }
  assert.deepEqual(removeGeneratedHostedToolAllowlist(custom), custom)
  assert.deepEqual(removeGeneratedHostedToolAllowlist({}), {})
})

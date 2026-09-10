import assert from 'node:assert/strict'
import test from 'node:test'
import { BASIC_RESTRICTED_TOOLS, DYNAMIC_TOOL_SEARCH, fullAccessToolPolicy, restrictedToolDefaults } from '../server/services/agents/dynamicToolPolicy'

test('full operator permission authorizes tools without eagerly exposing schemas', () => {
  const original = { profile: 'minimal', exec: { security: 'full', ask: 'off' }, allow: ['read'], deny: ['exec'], alsoAllow: ['write'], byProvider: { google: { allow: ['read'] } }, sandbox: { tools: { deny: ['exec'] } } }
  assert.deepEqual(fullAccessToolPolicy(original), { profile: 'full', exec: original.exec })
  assert.deepEqual(original.deny, ['exec'], 'do not mutate input')
  assert.deepEqual(DYNAMIC_TOOL_SEARCH, { enabled: true, mode: 'tools', searchDefaultLimit: 3, maxSearchLimit: 8 })
})
test('restricted and future unconfigured agents retain operator restrictions', () => {
  for (const exec of [undefined, { security: 'allowlist', ask: 'on-miss' }, { security: 'full', ask: 'always' }]) {
    const policy = { exec, allow: ['read'], deny: ['exec'], byProvider: { google: { deny: ['write'] } } }
    assert.equal(fullAccessToolPolicy(policy), policy)
  }
})
test('new restricted agents receive only the basic tool surface', () => {
  assert.deepEqual(restrictedToolDefaults({ profile: 'full' }).allow, [...BASIC_RESTRICTED_TOOLS])
  assert.deepEqual(restrictedToolDefaults({ profile: 'full', allow: ['web_search'] }).allow, ['web_search'])
  assert.deepEqual(restrictedToolDefaults({ profile: 'full', deny: ['browser'] }).deny, ['browser'])
})

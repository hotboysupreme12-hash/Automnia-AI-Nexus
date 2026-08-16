import assert from 'node:assert/strict'
import test from 'node:test'

import { ensurePrimaryAgentSelection } from '../server/services/agents/primaryAgentSelectionService'

const active = (id: string, isDefault?: boolean) => ({
  id,
  ...(isDefault === undefined ? {} : { default: isDefault }),
})

test('selects a non-main fallback when a config has no primary assistant', () => {
  const config = {
    agents: { list: [active('main'), active('sarah'), active('elena')] },
    bindings: [{ agentId: 'elena', match: { channel: 'telegram', accountId: 'support' } }],
  }

  assert.equal(ensurePrimaryAgentSelection(config, () => false), true)
  assert.deepEqual(config.agents.list.map((entry) => [entry.id, Boolean(entry.default)]), [
    ['main', false],
    ['sarah', true],
    ['elena', false],
  ])
  assert.deepEqual(config.bindings, [{ agentId: 'elena', match: { channel: 'telegram', accountId: 'support' } }])
})

test('keeps one existing primary assistant and clears duplicate flags', () => {
  const config = { agents: { list: [active('sarah', true), active('elena', true)] } }

  assert.equal(ensurePrimaryAgentSelection(config, () => false), true)
  assert.deepEqual(config.agents.list.map((entry) => [entry.id, Boolean(entry.default)]), [
    ['sarah', true],
    ['elena', false],
  ])
})

test('prefers a visible roster agent over the reserved main entry', () => {
  const config = { agents: { list: [active('main', true), active('elena')] } }

  assert.equal(ensurePrimaryAgentSelection(config, () => false), true)
  assert.deepEqual(config.agents.list.map((entry) => [entry.id, Boolean(entry.default)]), [
    ['main', false],
    ['elena', true],
  ])
})

test('replaces a retired primary assistant with an active agent', () => {
  const config = { agents: { list: [active('retired', true), active('elena')] } }

  assert.equal(ensurePrimaryAgentSelection(config, (id) => id === 'retired'), true)
  assert.deepEqual(config.agents.list.map((entry) => [entry.id, Boolean(entry.default)]), [
    ['retired', false],
    ['elena', true],
  ])
})

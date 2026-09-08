import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigEditConflict, configSnapshot, mergeConfigEdit, rememberConfigSnapshot } from '../server/services/filesystem/configMerge'

test('concurrent settings changes preserve an intervening external edit', () => {
  const base = { models: { primary: 'original' }, plugins: { enabled: false }, gateway: { port: 18789 } }
  const first = rememberConfigSnapshot(structuredClone(base))
  const second = rememberConfigSnapshot(structuredClone(base))
  first.models.primary = 'selected'
  second.plugins.enabled = true
  const external = { ...base, gateway: { port: 18790 } }
  const firstWrite = mergeConfigEdit(configSnapshot(first), first, external)
  const secondWrite = mergeConfigEdit(configSnapshot(second), second, firstWrite)
  assert.deepEqual(secondWrite, { models: { primary: 'selected' }, plugins: { enabled: true }, gateway: { port: 18790 } })
})

test('keyed agent updates and additions retain unrelated concurrent changes', () => {
  const base = { agents: [{ id: 'a', name: 'A', model: 'old' }, { id: 'b', name: 'B', model: 'old' }] }
  const desired = structuredClone(base)
  desired.agents[0].model = 'new'
  const current = structuredClone(base)
  current.agents[1].name = 'Renamed'
  current.agents.push({ id: 'c', name: 'C', model: 'added' })
  assert.deepEqual(mergeConfigEdit(base, desired, current), {
    agents: [{ id: 'a', name: 'A', model: 'new' }, { id: 'b', name: 'Renamed', model: 'old' }, { id: 'c', name: 'C', model: 'added' }],
  })
})

test('conflicting values, deletions, array edits and reorders fail explicitly', () => {
  assert.throws(() => mergeConfigEdit({ model: 'a' }, { model: 'b' }, { model: 'c' }), ConfigEditConflict)
  assert.throws(() => mergeConfigEdit({ model: 'a' }, {}, { model: 'c' }), ConfigEditConflict)
  assert.throws(() => mergeConfigEdit(['a'], ['b'], ['c']), ConfigEditConflict)
  const rows = ['a', 'b', 'c'].map((id) => ({ id }))
  assert.throws(() => mergeConfigEdit(rows, [rows[1], rows[0], rows[2]], [rows[0], rows[2], rows[1]]), ConfigEditConflict)
})

test('snapshots are detached and prototype-shaped keys never affect the object prototype', () => {
  const config = rememberConfigSnapshot({ enabled: false })
  config.enabled = true
  assert.deepEqual(configSnapshot(config), { enabled: false })
  const base = JSON.parse('{"__proto__":{"safe":true},"a":0,"b":0}')
  const result = mergeConfigEdit(base, { ...base, a: 1 }, { ...base, b: 2 }) as Record<string, unknown>
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal(Object.hasOwn(result, '__proto__'), true)
  assert.equal(result.a, 1)
  assert.equal(result.b, 2)
})

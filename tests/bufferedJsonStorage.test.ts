import test from 'node:test'
import assert from 'node:assert/strict'
import { createBufferedJsonStorage } from '../src/store/bufferedJsonStorage'

test('storage coalesces serialization and skips unchanged durable writes', () => {
  let writes = 0
  let serializations = 0
  const data = new Map<string, string>()
  const target = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
  const { storage, flush } = createBufferedJsonStorage(() => target)
  const value = { state: { toJSON: () => { serializations++; return { title: 'latest' } } } }
  for (let i = 0; i < 100; i++) storage.setItem('nexus', value)
  assert.equal(serializations, 0)
  assert.equal(storage.getItem('nexus'), value)
  flush()
  assert.equal(serializations, 1)
  assert.equal(writes, 1)
  storage.setItem('nexus', value)
  flush()
  assert.equal(writes, 1)
})

test('quota failure preserves the prior value and pending changes can be retried', () => {
  let raw = '{"state":{"title":"saved"}}'
  let full = true
  const errors: unknown[] = []
  const { storage, flush } = createBufferedJsonStorage(() => ({
    getItem: () => raw,
    setItem: (_key, value) => { if (full) throw new Error('quota'); raw = value },
    removeItem: () => { throw new Error('must never remove saved state') },
  }), (error) => errors.push(error))
  storage.setItem('nexus', { state: { title: 'new' } })
  flush()
  assert.equal(JSON.parse(raw).state.title, 'saved')
  assert.deepEqual(storage.getItem('nexus'), { state: { title: 'new' } })
  assert.equal(errors.length, 1)
  full = false
  flush()
  assert.equal(JSON.parse(raw).state.title, 'new')
})

test('invalid storage JSON does not crash hydration', () => {
  const errors: unknown[] = []
  const { storage } = createBufferedJsonStorage(() => ({
    getItem: () => 'broken JSON', setItem() {}, removeItem() {},
  }), (error) => errors.push(error))
  assert.equal(storage.getItem('nexus'), null)
  assert.equal(errors.length, 1)
})

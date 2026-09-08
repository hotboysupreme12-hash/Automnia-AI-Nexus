import assert from 'node:assert/strict'
import test from 'node:test'
import { readPreferenceValue, savePreferenceEntries } from '../src/components/settings/preferenceStorage'

test('partial persistent writes roll back while all current preferences remain usable in memory', () => {
  const values = new Map([['console-width-test', '420'], ['console-visible-test', 'visible']])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key === 'console-visible-test' && value === 'hidden') throw new Error('quota'); values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } as Storage
  const result = savePreferenceEntries([['console-width-test', '600'], ['console-visible-test', 'hidden']], storage)
  assert.equal(result.ok, false)
  assert.equal(values.get('console-width-test'), '420')
  assert.equal(values.get('console-visible-test'), 'visible')
  assert.equal(readPreferenceValue('console-width-test', storage), '600')
  assert.equal(readPreferenceValue('console-visible-test', storage), 'hidden')
  assert.equal(savePreferenceEntries([['console-width-test', '500'], ['console-visible-test', 'visible']], storage).ok, true)
  assert.equal(readPreferenceValue('console-width-test', storage), '500')
})

test('blocked storage does not throw and retains the session value', () => {
  assert.equal(savePreferenceEntries([['blocked-test', 'retained']], null).ok, false)
  assert.equal(readPreferenceValue('blocked-test', null), 'retained')
  const denied = { getItem: () => { throw new Error('denied') } } as unknown as Storage
  assert.equal(readPreferenceValue('unwritten-test', denied), null)
})

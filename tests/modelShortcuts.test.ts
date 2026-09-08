import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeModelPreferences } from '../src/components/models/modelPreferences'
import { ModelShortcuts } from '../src/components/models/ModelShortcuts'
import { avatarInitials } from '../src/utils/avatarInitials'

test('model preferences retain stable order, reject malformed entries and cap lists', () => {
  assert.deepEqual(normalizeModelPreferences({ favorites: ['a/model', null, 'a/model', 'b/model'], recent: ['b/model', 'a/model'] }), { favorites: ['a/model', 'b/model'], recent: ['b/model', 'a/model'] })
  assert.equal(normalizeModelPreferences({ favorites: Array.from({ length: 70 }, (_, index) => `provider/${index}`) }).favorites.length, 50)
  assert.deepEqual(normalizeModelPreferences(null), { favorites: [], recent: [] })
})
test('unavailable saved models remain labeled and disabled', () => {
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify({ favorites: ['gone/model'], recent: ['live/model'] }) } })
  try {
    const html = renderToStaticMarkup(React.createElement(ModelShortcuts, { models: [{ id: 'live/model', name: 'Available model' }], selected: 'live/model', disabled: false, onSelect: () => undefined }))
    assert.match(html, /value="gone\/model" disabled=""/)
    assert.match(html, /unavailable for this setup/)
    assert.match(html, /Available model/)
    assert.match(html, /aria-pressed="false"/)
  } finally { Reflect.deleteProperty(globalThis, 'localStorage'); Reflect.deleteProperty(globalThis, 'React') }
})
test('avatar initials handle empty, Unicode and long names consistently', () => {
  assert.equal(avatarInitials(''), 'AI')
  assert.equal(avatarInitials('  Jean   Myrvil '), 'JM')
  assert.equal(avatarInitials('Émilie'), 'ÉM')
  assert.equal(avatarInitials('𐐀name Last'), '𐐀L')
})

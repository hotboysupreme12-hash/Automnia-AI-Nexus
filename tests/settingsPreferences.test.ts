import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CONSOLE_PREFERENCES,
  DEFAULT_REGISTRY_PREFERENCES,
  AGENT_CARD_RARITY_THEMES,
  REGISTRY_PREFS_CHANGED_EVENT,
  REGISTRY_PREFS_KEY,
  applyRegistryCardTheme,
  readConsolePreferences,
  readRegistryPreferences,
  resolveAgentCardTheme,
  saveConsolePreferences,
  saveRegistryPreferences,
} from '../src/components/settings/workspaceSettings'
import {
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_SETTINGS_STORAGE_KEY,
  readSpeechSettings,
  saveSpeechSettings,
} from '../src/speech/speechSettings'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

const storage = new MemoryStorage()
const events = new EventTarget()
const documentElement = { dataset: {} as Record<string, string> }
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: storage,
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  },
})
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement },
})

test('registry preferences validate persisted values and publish live updates', () => {
  storage.clear()
  storage.setItem(REGISTRY_PREFS_KEY, JSON.stringify({ displayMode: 'broken', overlayPreset: 'blueprint-grid', rarityFilter: 'invalid', sortKey: 'level' }))
  assert.deepEqual(readRegistryPreferences(), {
    ...DEFAULT_REGISTRY_PREFERENCES,
    overlayPreset: 'blueprint-grid',
    rarityColorsEnabled: false,
    sortKey: 'level',
  })

  let changed = false
  events.addEventListener(REGISTRY_PREFS_CHANGED_EVENT, () => { changed = true }, { once: true })
  saveRegistryPreferences({ displayMode: 'list', overlayPreset: 'blueprint-grid', rarityColorsEnabled: true, rarityFilter: 'epic', sortKey: 'name' })
  assert.equal(changed, true)
  assert.deepEqual(readRegistryPreferences(), { displayMode: 'list', overlayPreset: 'blueprint-grid', rarityColorsEnabled: true, rarityFilter: 'epic', sortKey: 'name' })
  assert.deepEqual(AGENT_CARD_RARITY_THEMES, {
    legendary: 'original',
    epic: 'epic-purple',
    rare: 'blueprint-grid',
    common: 'graphite-glass',
  })
  assert.equal(resolveAgentCardTheme('rare', { overlayPreset: 'graphite-glass', rarityColorsEnabled: true }), 'blueprint-grid')
  assert.equal(resolveAgentCardTheme('legendary', { overlayPreset: 'graphite-glass', rarityColorsEnabled: false }), 'graphite-glass')
})

test('registry card theme is available before a lazy registry paint', () => {
  applyRegistryCardTheme({ overlayPreset: 'graphite-glass', rarityColorsEnabled: true })
  assert.equal(documentElement.dataset.agentCardOverlay, 'rarity')
  assert.equal(documentElement.dataset.agentCardRarityColors, 'enabled')

  applyRegistryCardTheme({ overlayPreset: 'blueprint-grid', rarityColorsEnabled: false })
  assert.equal(documentElement.dataset.agentCardOverlay, 'blueprint-grid')
  assert.equal(documentElement.dataset.agentCardRarityColors, 'disabled')
})

test('console preferences preserve defaults and clamp unsafe widths', () => {
  storage.clear()
  assert.deepEqual(readConsolePreferences(), DEFAULT_CONSOLE_PREFERENCES)
  saveConsolePreferences({ visible: false, width: 9_000, rememberDrafts: false })
  assert.deepEqual(readConsolePreferences(), { visible: false, width: 760, rememberDrafts: false })
})

test('speech settings migrate old records and normalize every functional control', () => {
  storage.clear()
  storage.setItem(SPEECH_SETTINGS_STORAGE_KEY, JSON.stringify({ mode: 'online' }))
  assert.deepEqual(readSpeechSettings(), { ...DEFAULT_SPEECH_SETTINGS, mode: 'online' })

  saveSpeechSettings({
    mode: 'local',
    autoStop: false,
    pauseDurationMs: 99_000,
    maxRecordingSeconds: 2,
    noiseSuppression: false,
    echoCancellation: false,
    autoGainControl: false,
  })
  assert.deepEqual(readSpeechSettings(), {
    mode: 'local',
    autoStop: false,
    pauseDurationMs: 3_000,
    maxRecordingSeconds: 15,
    noiseSuppression: false,
    echoCancellation: false,
    autoGainControl: false,
  })
})

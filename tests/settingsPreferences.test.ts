import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CONSOLE_PREFERENCES,
  DEFAULT_REGISTRY_PREFERENCES,
  REGISTRY_PREFS_CHANGED_EVENT,
  REGISTRY_PREFS_KEY,
  readConsolePreferences,
  readRegistryPreferences,
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
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: storage,
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  },
})

test('registry preferences validate persisted values and publish live updates', () => {
  storage.clear()
  storage.setItem(REGISTRY_PREFS_KEY, JSON.stringify({ displayMode: 'broken', overlayPreset: 'aurora-mesh', rarityFilter: 'invalid', sortKey: 'level' }))
  assert.deepEqual(readRegistryPreferences(), {
    ...DEFAULT_REGISTRY_PREFERENCES,
    overlayPreset: 'aurora-mesh',
    sortKey: 'level',
  })

  let changed = false
  events.addEventListener(REGISTRY_PREFS_CHANGED_EVENT, () => { changed = true }, { once: true })
  saveRegistryPreferences({ displayMode: 'list', overlayPreset: 'studio-noir', rarityFilter: 'epic', sortKey: 'name' })
  assert.equal(changed, true)
  assert.deepEqual(readRegistryPreferences(), { displayMode: 'list', overlayPreset: 'studio-noir', rarityFilter: 'epic', sortKey: 'name' })
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePreferencesBackup, serializePreferencesBackup } from '../src/components/settings/preferencesBackup'
import { DEFAULT_UI_SETTINGS, UI_SETTINGS_STORAGE_KEY } from '../src/components/settings/uiSettings'
import { DEFAULT_SPEECH_SETTINGS } from '../src/speech/speechSettings'
import { DEFAULT_CONSOLE_PREFERENCES } from '../src/components/settings/workspaceSettings'

test('preference backups round trip recognized groups and reject corrupt or future data', () => {
  const values = { appearance: DEFAULT_UI_SETTINGS, voice: { ...DEFAULT_SPEECH_SETTINGS, microphoneDeviceId: 'external-mic' }, console: DEFAULT_CONSOLE_PREFERENCES }
  assert.deepEqual(parsePreferencesBackup(serializePreferencesBackup(values)), values)
  for (const content of ['null', '[]', '{', '{"version":99}', '{"version":2,"format":"automnia-preferences","preferences":{"console":{"visible":"yes"}}}']) {
    assert.throws(() => parsePreferencesBackup(content))
  }
  assert.throws(() => parsePreferencesBackup(' '.repeat(1_000_001)), /too large/)
})

test('legacy clipboard backups migrate only explicit preferences and strip unknown fields', () => {
  assert.deepEqual(parsePreferencesBackup(JSON.stringify({ version: 1, [UI_SETTINGS_STORAGE_KEY]: { ...DEFAULT_UI_SETTINGS, apiKey: 'excluded' }, unexpected: 'excluded' })), { appearance: DEFAULT_UI_SETTINGS })
  assert.throws(() => parsePreferencesBackup('{"version":1,"credentials":{"key":"excluded"}}'), /No recognized/)
})


test('older console backups keep parallel chat off and an explicit on value survives export', () => {
  const legacy = { visible: true, width: 420, rememberDrafts: true }
  const backup = JSON.stringify({ format: 'automnia-preferences', version: 2, preferences: { console: legacy } })
  assert.equal(parsePreferencesBackup(backup).console?.parallelAgentChat, false)
  const values = { console: { ...DEFAULT_CONSOLE_PREFERENCES, parallelAgentChat: true } }
  assert.deepEqual(parsePreferencesBackup(serializePreferencesBackup(values)), values)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBookmarks } from '../src/components/bookmarks/bookmarkStore'
import { parsePreferencesBackup, serializePreferencesBackup } from '../src/components/settings/preferencesBackup'
import { applyWorkspaceProfile, captureWorkspace, readWorkspaceProfiles, saveWorkspaceProfiles } from '../src/components/settings/workspaceProfiles'
import { savePreferenceEntries } from '../src/components/settings/preferenceStorage'
import { DEFAULT_UI_SETTINGS } from '../src/components/settings/uiSettings'
import { DEFAULT_REGISTRY_PREFERENCES, DEFAULT_CONSOLE_PREFERENCES } from '../src/components/settings/workspaceSettings'

const validBookmark = { id: 'response:1', kind: 'response', title: 'A retained response', text: 'Result', sourceId: '1', savedAt: '2026-09-07T12:00:00Z' }
test('bookmark recovery rejects malformed, duplicate and oversized records without losing valid records', () => {
  assert.deepEqual(normalizeBookmarks([null, validBookmark, validBookmark, { ...validBookmark, id: '2', text: 'x'.repeat(100_001) }, { ...validBookmark, id: '3', savedAt: 'invalid' }]), [validBookmark])
  assert.equal(normalizeBookmarks([{ ...validBookmark, note: 'x'.repeat(2001) }]).length, 0)
  assert.equal(normalizeBookmarks([{ ...validBookmark, note: 'Follow up tomorrow' }])[0].note, 'Follow up tomorrow')
  assert.equal(normalizeBookmarks(Array.from({ length: 200 }, (_, index) => ({ ...validBookmark, id: String(index) }))).length, 100)
})

test('workspace profile recovery validates complete settings and strips unrelated groups', () => {
  const preferences = { appearance: DEFAULT_UI_SETTINGS, registry: DEFAULT_REGISTRY_PREFERENCES, console: DEFAULT_CONSOLE_PREFERENCES }
  savePreferenceEntries([['automnia-workspace-profiles-v1', JSON.stringify([{ id: 'valid', name: 'Focus', preferences }, { id: 'bad', name: 'Invalid', preferences: { appearance: { density: 'tiny' } } }])]], null)
  assert.deepEqual(readWorkspaceProfiles(), [{ id: 'valid', name: 'Focus', preferences }])
  assert.throws(() => saveWorkspaceProfiles([{ id: '1', name: 'Focus', preferences }, { id: '2', name: ' focus ', preferences }]), /already uses/)
  assert.throws(() => applyWorkspaceProfile({ appearance: DEFAULT_UI_SETTINGS }), /incomplete/)
  assert.equal(parsePreferencesBackup(serializePreferencesBackup(captureWorkspace())).console?.width, 420)
})

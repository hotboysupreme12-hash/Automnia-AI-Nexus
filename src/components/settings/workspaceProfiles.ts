import { parsePreferencesBackup, serializePreferencesBackup, type PreferencesBackup } from './preferencesBackup'
import { readPreferenceValue, savePreferenceEntries } from './preferenceStorage'
import { applyUiSettings, readUiSettings, UI_SETTINGS_STORAGE_KEY } from './uiSettings'
import { applyRegistryCardTheme, CONSOLE_PREFS_CHANGED_EVENT, CONSOLE_PARALLEL_CHAT_KEY, CONSOLE_VISIBILITY_KEY, CONSOLE_WIDTH_KEY, readConsolePreferences, readRegistryPreferences, REGISTRY_PREFS_CHANGED_EVENT, REGISTRY_PREFS_KEY, REGISTRY_PREFS_VERSION } from './workspaceSettings'

export type WorkspaceProfile = { id: string; name: string; preferences: PreferencesBackup }
const KEY = 'automnia-workspace-profiles-v1'
export function captureWorkspace(): PreferencesBackup {
  return { appearance: readUiSettings(), registry: readRegistryPreferences(), console: readConsolePreferences() }
}
export function readWorkspaceProfiles(): WorkspaceProfile[] {
  try {
    const raw = readPreferenceValue(KEY) || '[]'
    if (raw.length > 100_000) return []
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) return []
    return values.slice(0, 20).flatMap((value) => {
      try {
        if (!value || typeof value.id !== 'string' || value.id.length > 100 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60) return []
        const parsed = parsePreferencesBackup(serializePreferencesBackup(value.preferences))
        if (!parsed.appearance || !parsed.registry || !parsed.console) return []
        return [{ id: value.id, name: value.name, preferences: { appearance: parsed.appearance, registry: parsed.registry, console: parsed.console } }]
      } catch { return [] }
    })
  } catch { return [] }
}
export function saveWorkspaceProfiles(values: WorkspaceProfile[]) {
  if (values.length > 20) throw new Error('Keep up to 20 workspace profiles. Remove one before saving another.')
  if (new Set(values.map((value) => value.name.trim().toLowerCase())).size !== values.length) throw new Error('A profile already uses this name. Choose another name.')
  return savePreferenceEntries([[KEY, JSON.stringify(values)]])
}
export function applyWorkspaceProfile(preferences: PreferencesBackup) {
  const values = parsePreferencesBackup(serializePreferencesBackup(preferences))
  if (!values.appearance || !values.registry || !values.console) throw new Error('This workspace profile is incomplete.')
  const result = savePreferenceEntries([
    [UI_SETTINGS_STORAGE_KEY, JSON.stringify(values.appearance)],
    [REGISTRY_PREFS_KEY, JSON.stringify({ ...values.registry, overlayPresetVersion: REGISTRY_PREFS_VERSION })],
    [CONSOLE_PARALLEL_CHAT_KEY, values.console.parallelAgentChat ? 'on' : 'off'],
    [CONSOLE_VISIBILITY_KEY, values.console.visible ? 'visible' : 'hidden'],
    [CONSOLE_WIDTH_KEY, String(values.console.width)],
  ])
  applyUiSettings(values.appearance)
  applyRegistryCardTheme(values.registry)
  window.dispatchEvent(new CustomEvent(REGISTRY_PREFS_CHANGED_EVENT, { detail: values.registry }))
  window.dispatchEvent(new CustomEvent(CONSOLE_PREFS_CHANGED_EVENT, { detail: readConsolePreferences() }))
  return result
}

export type ModelPreferences = { favorites: string[]; recent: string[] }
export const MODEL_PREFERENCES_KEY = 'automnia:model-preferences:v1'
export const MODEL_PREFERENCES_EVENT = 'automnia:model-preferences-changed'
export function normalizeModelPreferences(value: unknown): ModelPreferences {
  const source = value && typeof value === 'object' ? value as Partial<ModelPreferences> : {}
  const ids = (list: unknown, limit: number) => Array.isArray(list)
    ? [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, limit) : []
  return { favorites: ids(source.favorites, 50), recent: ids(source.recent, 8) }
}
export function readModelPreferences(): ModelPreferences {
  try { return normalizeModelPreferences(JSON.parse(localStorage.getItem(MODEL_PREFERENCES_KEY) || '{}')) } catch { return { favorites: [], recent: [] } }
}
export function updateModelPreferences(update: (current: ModelPreferences) => ModelPreferences): boolean {
  try {
    localStorage.setItem(MODEL_PREFERENCES_KEY, JSON.stringify(normalizeModelPreferences(update(readModelPreferences()))))
    window.dispatchEvent(new Event(MODEL_PREFERENCES_EVENT))
    return true
  } catch { return false }
}
export function rememberModelSelection(id: string) {
  if (id) updateModelPreferences((current) => ({ ...current, recent: [id, ...current.recent.filter((value) => value !== id)] }))
}

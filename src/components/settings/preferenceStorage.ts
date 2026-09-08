export type PreferenceSaveResult = { ok: boolean; message: string }
export const PREFERENCE_STORAGE_STATUS_EVENT = 'automnia:preference-storage-status'
const volatileValues = new Map<string, string>()
let latestResult: PreferenceSaveResult = { ok: true, message: '' }

function storageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function readPreferenceValue(key: string, storage = storageOrNull()): string | null {
  if (volatileValues.has(key)) return volatileValues.get(key)!
  try { return storage?.getItem(key) ?? null } catch { return null }
}

export function lastPreferenceSaveResult(): PreferenceSaveResult { return latestResult }

/** Publish all values together, rolling back persistent keys on a partial write. */
export function savePreferenceEntries(entries: Array<[string, string]>, storage = storageOrNull()): PreferenceSaveResult {
  const previous = new Map<string, string | null>()
  try {
    if (!storage) throw new Error('Storage is unavailable')
    for (const [key] of entries) previous.set(key, storage.getItem(key))
    for (const [key, value] of entries) storage.setItem(key, value)
    for (const [key] of entries) volatileValues.delete(key)
    latestResult = { ok: true, message: '' }
  } catch {
    if (storage) {
      for (const [key, value] of previous) {
        try { if (value === null) storage.removeItem(key); else storage.setItem(key, value) } catch { /* Keep the coherent in-memory copy. */ }
      }
    }
    for (const [key, value] of entries) volatileValues.set(key, value)
    latestResult = { ok: false, message: 'Applied for this session, but saving failed. Device storage may be full or blocked. Export a backup before closing the app.' }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PREFERENCE_STORAGE_STATUS_EVENT, { detail: latestResult }))
  return latestResult
}

import { readPreferenceValue, savePreferenceEntries } from '../settings/preferenceStorage'

export type Bookmark = { id: string; kind: 'response' | 'mission'; title: string; text: string; savedAt: string; sourceId: string; note?: string }
const KEY = 'automnia-bookmarks-v1'
const EVENT = 'automnia:bookmarks-changed'
const MAX_BYTES = 1_500_000
export function normalizeBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if ((record.kind !== 'response' && record.kind !== 'mission') || typeof record.id !== 'string' || record.id.length > 200 || ids.has(record.id)
      || typeof record.title !== 'string' || record.title.length > 200 || typeof record.text !== 'string' || record.text.length > 100_000
      || (record.note !== undefined && (typeof record.note !== 'string' || record.note.length > 2000))
      || typeof record.sourceId !== 'string' || record.sourceId.length > 200 || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) return []
    ids.add(record.id)
    return [{ id: record.id, kind: record.kind, title: record.title, text: record.text, sourceId: record.sourceId, savedAt: record.savedAt, ...(typeof record.note === 'string' ? { note: record.note } : {}) }]
  })
}
let cachedRaw: string | null | undefined
let cached: Bookmark[] = []
export function readBookmarks(): Bookmark[] {
  const raw = readPreferenceValue(KEY)
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  try { cached = !raw || raw.length > MAX_BYTES ? [] : normalizeBookmarks(JSON.parse(raw)) } catch { cached = [] }
  return cached
}
export function subscribeBookmarks(listener: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage) }
}
export function saveBookmarks(values: Bookmark[]) {
  if (values.length > 100) throw new Error('You can keep 100 bookmarks. Remove one before saving another.')
  const validated = normalizeBookmarks(values)
  if (validated.length !== values.length) throw new Error('This bookmark is too large or invalid. Download the response instead.')
  const raw = JSON.stringify(validated)
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Bookmark storage is full. Export and remove some bookmarks first.')
  const result = savePreferenceEntries([[KEY, raw]])
  window.dispatchEvent(new Event(EVENT))
  return result
}

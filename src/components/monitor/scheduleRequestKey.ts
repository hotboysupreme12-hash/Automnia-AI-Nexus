const key = 'automnia:schedule-request-keys:v1'
const pending = new Map<string, string>()
let restored = false
function restore() {
  if (restored) return
  restored = true
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    if (Array.isArray(saved)) for (const pair of saved.slice(0, 100)) {
      if (Array.isArray(pair) && pair.length === 2 && pair.every((value) => typeof value === 'string') && /^[a-f0-9]{64}$/.test(pair[0]) && pair[1].length <= 100) pending.set(pair[0], pair[1])
    }
  } catch { /* In-memory keys still protect retries in this renderer. */ }
}
function save() { try { localStorage.setItem(key, JSON.stringify([...pending])) } catch { /* Keep the current renderer's receipt key. */ } }
export async function scheduleRequestKey(kind: 'single' | 'team', payload: unknown): Promise<string> {
  restore()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${JSON.stringify(payload)}`))
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const existing = pending.get(fingerprint)
  if (existing) return existing
  if (pending.size >= 100) throw new Error('Too many job requests are still unconfirmed. Check Runtime Monitor before starting more jobs.')
  const id = crypto.randomUUID()
  pending.set(fingerprint, id)
  // Retain unresolved keys across navigation and restarts, including lost acknowledgements.
  save()
  return id
}
export function settleScheduleRequest(requestKey: string) {
  for (const [fingerprint, id] of pending) if (id === requestKey) pending.delete(fingerprint)
  save()
}

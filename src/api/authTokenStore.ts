const CONTROL_CENTER_TOKEN_KEY = 'control-center-token'
let memoryToken: string | null = null

function browserStorage(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function storageRead(storage: Storage | null): string | null {
  try {
    return storage?.getItem(CONTROL_CENTER_TOKEN_KEY) ?? null
  } catch {
    return null
  }
}

function storageWrite(storage: Storage | null, value: string | null): void {
  try {
    if (value) storage?.setItem(CONTROL_CENTER_TOKEN_KEY, value)
    else storage?.removeItem(CONTROL_CENTER_TOKEN_KEY)
  } catch {
    // Authentication remains valid in memory when hardened storage is blocked.
  }
}

function storageRemove(storage: Storage | null): void {
  try {
    storage?.removeItem(CONTROL_CENTER_TOKEN_KEY)
  } catch {
    // Ignore blocked storage during migration or explicit cleanup.
  }
}

function normalizeToken(value: string | null | undefined): string | null {
  const token = typeof value === 'string' ? value.trim() : ''
  return token || null
}

export function readAuthToken(): string | null {
  if (memoryToken) return memoryToken

  const session = browserStorage('session')
  const sessionToken = normalizeToken(storageRead(session))
  if (sessionToken) {
    memoryToken = sessionToken
    return sessionToken
  }

  // One-time migration from older builds that persisted bearer sessions across
  // browser restarts. New sessions are tab/process scoped instead.
  const local = browserStorage('local')
  const legacyToken = normalizeToken(storageRead(local))
  if (legacyToken) {
    memoryToken = legacyToken
    storageWrite(session, legacyToken)
    storageRemove(local)
    return legacyToken
  }

  return null
}

export function writeAuthToken(value: string): void {
  const token = normalizeToken(value)
  memoryToken = token
  storageWrite(browserStorage('session'), token)
  storageRemove(browserStorage('local'))
}

export function clearAuthToken(): void {
  memoryToken = null
  storageRemove(browserStorage('session'))
  storageRemove(browserStorage('local'))
}

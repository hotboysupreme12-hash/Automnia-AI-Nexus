const CONTROL_CENTER_TOKEN_KEY = 'control-center-token'
const CONTROL_CENTER_SIGNED_OUT_KEY = 'control-center-signed-out'
let memoryToken: string | null = null
let explicitSignOut = false
const tokenListeners = new Set<(token: string | null) => void>()

function notifyTokenListeners(token: string | null): void {
  for (const listener of tokenListeners) {
    try {
      listener(token)
    } catch {
      // A stale UI listener must not prevent the rest of the app from recovering.
    }
  }
}

function browserStorage(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

// Account sessions must survive an Electron process restart. The server-issued
// token is still short-lived, and explicit logout removes it from both stores.

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

function storageHasSignOutFlag(storage: Storage | null): boolean {
  try {
    return storage?.getItem(CONTROL_CENTER_SIGNED_OUT_KEY) === '1'
  } catch {
    return false
  }
}

function storageWriteSignOutFlag(storage: Storage | null, value: boolean): void {
  try {
    if (value) storage?.setItem(CONTROL_CENTER_SIGNED_OUT_KEY, '1')
    else storage?.removeItem(CONTROL_CENTER_SIGNED_OUT_KEY)
  } catch {
    // The in-memory flag still protects this renderer when storage is blocked.
  }
}

function normalizeToken(value: string | null | undefined): string | null {
  const token = typeof value === 'string' ? value.trim() : ''
  return token || null
}

export function readAuthToken(): string | null {
  if (isAuthExplicitlySignedOut()) {
    memoryToken = null
    return null
  }
  if (memoryToken) return memoryToken

  const local = browserStorage('local')
  const localToken = normalizeToken(storageRead(local))
  if (localToken) {
    memoryToken = localToken
    return localToken
  }

  const session = browserStorage('session')
  const sessionToken = normalizeToken(storageRead(session))
  if (sessionToken) {
    memoryToken = sessionToken
    // Migrate sessions created by builds that only used sessionStorage so the
    // user is not prompted again after the next restart.
    storageWrite(local, sessionToken)
    return sessionToken
  }

  return null
}

/**
 * An explicit logout must win over Electron's automatic session recovery.
 * This marker is scoped to the current browser tab/window and is cleared only
 * by a deliberate password or Google sign-in.
 */
export function isAuthExplicitlySignedOut(): boolean {
  if (explicitSignOut) return true
  explicitSignOut = storageHasSignOutFlag(browserStorage('session'))
  return explicitSignOut
}

export function markAuthSignedOut(): void {
  explicitSignOut = true
  memoryToken = null
  storageWriteSignOutFlag(browserStorage('session'), true)
  storageRemove(browserStorage('session'))
  storageRemove(browserStorage('local'))
  notifyTokenListeners(null)
}

export function clearAuthSignedOut(): void {
  explicitSignOut = false
  storageWriteSignOutFlag(browserStorage('session'), false)
}

export function writeAuthToken(value: string): void {
  const token = normalizeToken(value)
  memoryToken = token
  storageWrite(browserStorage('local'), token)
  storageWrite(browserStorage('session'), token)
  notifyTokenListeners(token)
}

export function clearAuthToken(): void {
  memoryToken = null
  storageRemove(browserStorage('session'))
  storageRemove(browserStorage('local'))
  notifyTokenListeners(null)
}

/** Subscribe UI state to tokens renewed by the desktop-session recovery layer. */
export function subscribeAuthToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener)
  return () => tokenListeners.delete(listener)
}

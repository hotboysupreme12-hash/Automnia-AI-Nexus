import { writeAuthToken } from './authTokenStore'

type DesktopAuthBridge = {
  dystopaiDesktop?: {
    bootstrapControlCenterSession?: () => Promise<string | null> | string | null
  }
}

const DESKTOP_SESSION_BOOTSTRAP_TIMEOUT_MS = 7_500
let recoveryInFlight: Promise<string | null> | null = null

function desktopSessionBootstrap(): (() => Promise<string | null> | string | null) | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as Window & DesktopAuthBridge).dystopaiDesktop
  return typeof bridge?.bootstrapControlCenterSession === 'function' ? bridge.bootstrapControlCenterSession : null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs)
    void promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timer))
  })
}

/** True when this renderer can mint a fresh local control-plane session through Electron. */
export function hasDesktopControlCenterSessionBootstrap(): boolean {
  return Boolean(desktopSessionBootstrap())
}

/**
 * Reconnect a renderer to a restarted local Control Center. Calls are coalesced so
 * a burst of polling failures creates one IPC request and one fresh bearer token.
 */
export async function recoverDesktopControlCenterSession(): Promise<string | null> {
  const bootstrap = desktopSessionBootstrap()
  if (!bootstrap) return null
  if (recoveryInFlight) return recoveryInFlight

  recoveryInFlight = withTimeout(Promise.resolve(bootstrap()), DESKTOP_SESSION_BOOTSTRAP_TIMEOUT_MS)
    .then((value) => {
      const token = typeof value === 'string' ? value.trim() : ''
      if (!token) return null
      writeAuthToken(token)
      return token
    })
    .catch(() => null)
    .finally(() => {
      recoveryInFlight = null
    })

  return recoveryInFlight
}

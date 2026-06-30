import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import { clearAuthToken, readAuthToken, writeAuthToken } from '../api/authTokenStore'
import { AuthContext } from './authContextValue'

type DesktopAuthBridge = {
  dystopaiDesktop?: {
    bootstrapControlCenterSession?: () => Promise<string | null> | string | null
  }
}

type DesktopSessionBootstrap = NonNullable<NonNullable<DesktopAuthBridge['dystopaiDesktop']>['bootstrapControlCenterSession']>

const DESKTOP_BOOTSTRAP_ATTEMPTS = 4
const DESKTOP_BOOTSTRAP_TIMEOUT_MS = 6500
const DESKTOP_BOOTSTRAP_RETRY_MS = 450

function desktopAuthBridge(): DesktopAuthBridge['dystopaiDesktop'] {
  if (typeof window === 'undefined') return undefined
  return (window as Window & DesktopAuthBridge).dystopaiDesktop
}

function hasDesktopSessionBootstrap(): boolean {
  return typeof desktopAuthBridge()?.bootstrapControlCenterSession === 'function'
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function callDesktopSessionBootstrap(provider: DesktopSessionBootstrap, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof window.setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(provider()).then((value) => {
        const token = typeof value === 'string' ? value.trim() : ''
        return token || null
      }),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

async function bootstrapDesktopSession(provider: DesktopSessionBootstrap, isCancelled: () => boolean): Promise<string | null> {
  for (let attempt = 0; attempt < DESKTOP_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    if (isCancelled()) return null
    const sessionToken = await callDesktopSessionBootstrap(provider, DESKTOP_BOOTSTRAP_TIMEOUT_MS).catch(() => null)
    if (sessionToken || isCancelled()) return sessionToken
    await sleep(DESKTOP_BOOTSTRAP_RETRY_MS * (attempt + 1))
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<string | null>(() => readAuthToken())
  const [checking, setChecking] = useState(() => Boolean(readAuthToken()) || hasDesktopSessionBootstrap())

  const completeLogin = (sessionToken: string) => {
    writeAuthToken(sessionToken)
    setToken(sessionToken)
    setIsAuthenticated(true)
    setChecking(false)
  }

  useEffect(() => {
    if (!token) {
      const provider = desktopAuthBridge()?.bootstrapControlCenterSession
      if (!provider) {
        return
      }
      let cancelled = false
      Promise.resolve()
        .then(async () => {
          if (!cancelled) setChecking(true)
          const sessionToken = await bootstrapDesktopSession(provider, () => cancelled)
          if (!sessionToken || cancelled) return false
          if (!cancelled) completeLogin(sessionToken)
          return true
        })
        .catch(() => {
          if (!cancelled) {
            clearAuthToken()
            setToken(null)
            setIsAuthenticated(false)
          }
        })
        .finally(() => {
          if (!cancelled) setChecking(false)
        })
      return () => {
        cancelled = true
      }
    }

    const controller = new AbortController()

    void apiRequest<{ authenticated: boolean }>('/api/auth/status', {
      authToken: token,
      signal: controller.signal,
      timeoutMs: 10_000,
    })
      .then((result) => {
        const authenticated = result.ok && result.data.authenticated
        setIsAuthenticated(authenticated)
        if (!authenticated) {
          clearAuthToken()
          setToken(null)
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setIsAuthenticated(false)
        clearAuthToken()
        setToken(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })

    return () => {
      controller.abort()
    }
  }, [token])

  const login = async (accessToken: string) => {
    const result = await apiRequest<{ ok?: boolean; token?: string }>('/api/auth/login', {
      method: 'POST',
      authToken: '',
      timeoutMs: 10_000,
      body: { token: accessToken },
    })

    if (!result.ok || !result.data.token) {
      throw new Error(result.ok ? 'Login response did not include a session token' : apiErrorMessage(result.error))
    }

    completeLogin(result.data.token)
  }

  const logout = () => {
    const activeToken = token
    clearAuthToken()
    setToken(null)
    setIsAuthenticated(false)
    setChecking(false)
    if (activeToken) {
      void apiRequest('/api/auth/logout', {
        method: 'POST',
        authToken: activeToken,
        timeoutMs: 5_000,
      })
    }
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, token, login, logout, checking }}>
      {children}
    </AuthContext.Provider>
  )
}

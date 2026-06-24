import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import { AuthContext } from './authContextValue'

type DesktopAuthBridge = {
  dystopaiDesktop?: {
    getControlCenterToken?: () => Promise<string | null> | string | null
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem('control-center-token')
  } catch {
    return null
  }
}

function writeStoredToken(token: string): void {
  try {
    localStorage.setItem('control-center-token', token)
  } catch {
    // Authentication still works for this session even if storage is blocked.
  }
}

function removeStoredToken(): void {
  try {
    localStorage.removeItem('control-center-token')
  } catch {
    // Ignore blocked storage during cleanup.
  }
}

function desktopAuthBridge(): DesktopAuthBridge['dystopaiDesktop'] {
  if (typeof window === 'undefined') return undefined
  return (window as Window & DesktopAuthBridge).dystopaiDesktop
}

function hasDesktopLaunchTokenProvider(): boolean {
  return typeof desktopAuthBridge()?.getControlCenterToken === 'function'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<string | null>(() => readStoredToken())
  const [checking, setChecking] = useState(() => Boolean(readStoredToken()) || hasDesktopLaunchTokenProvider())

  const completeLogin = (sessionToken: string) => {
    writeStoredToken(sessionToken)
    setToken(sessionToken)
    setIsAuthenticated(true)
    setChecking(false)
  }

  useEffect(() => {
    if (!token) {
      const provider = desktopAuthBridge()?.getControlCenterToken
      if (!provider) {
        return
      }
      let cancelled = false
      Promise.resolve()
        .then(async () => {
          if (!cancelled) setChecking(true)
          const launchToken = await Promise.resolve(provider())
          if (!launchToken || cancelled) return false
          const result = await apiRequest<{ ok?: boolean; token?: string }>('/api/auth/login', {
            method: 'POST',
            timeoutMs: 10_000,
            authToken: '',
            body: { token: launchToken },
          })
          if (!result.ok || !result.data.token) throw new Error(result.ok ? 'Login response did not include a session token' : apiErrorMessage(result.error))
          if (!cancelled) completeLogin(result.data.token)
          return true
        })
        .catch(() => {
          if (!cancelled) {
            removeStoredToken()
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
          removeStoredToken()
          setToken(null)
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setIsAuthenticated(false)
        removeStoredToken()
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
    removeStoredToken()
    setToken(null)
    setIsAuthenticated(false)
    setChecking(false)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, token, login, logout, checking }}>
      {children}
    </AuthContext.Provider>
  )
}

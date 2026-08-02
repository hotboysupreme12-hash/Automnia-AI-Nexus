import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import { clearAuthToken, readAuthToken, subscribeAuthToken, writeAuthToken } from '../api/authTokenStore'
import { hasDesktopControlCenterSessionBootstrap, recoverDesktopControlCenterSession } from '../api/desktopSessionRecovery'
import { AuthContext } from './authContextValue'

const DESKTOP_BOOTSTRAP_ATTEMPTS = 4
const DESKTOP_BOOTSTRAP_RETRY_MS = 450
const AUTH_STATUS_TIMEOUT_MS = 4_500

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function bootstrapDesktopSession(isCancelled: () => boolean): Promise<string | null> {
  for (let attempt = 0; attempt < DESKTOP_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    if (isCancelled()) return null
    const sessionToken = await recoverDesktopControlCenterSession().catch(() => null)
    if (sessionToken || isCancelled()) return sessionToken
    await sleep(DESKTOP_BOOTSTRAP_RETRY_MS * (attempt + 1))
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readAuthToken())
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAuthToken()))
  const [checking, setChecking] = useState(() => !readAuthToken() && hasDesktopControlCenterSessionBootstrap())

  const completeLogin = (sessionToken: string) => {
    writeAuthToken(sessionToken)
    setToken(sessionToken)
    setIsAuthenticated(true)
    setChecking(false)
  }

  useEffect(() => {
    return subscribeAuthToken((nextToken) => {
      setToken(nextToken)
      setIsAuthenticated(Boolean(nextToken))
      if (nextToken) setChecking(false)
    })
  }, [])

  useEffect(() => {
    if (!token) {
      if (!hasDesktopControlCenterSessionBootstrap()) {
        return
      }
      let cancelled = false
      Promise.resolve()
        .then(async () => {
          if (!cancelled) setChecking(true)
          const sessionToken = await bootstrapDesktopSession(() => cancelled)
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
      timeoutMs: AUTH_STATUS_TIMEOUT_MS,
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

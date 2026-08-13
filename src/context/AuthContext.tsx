import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import {
  clearAuthSignedOut,
  clearAuthToken,
  isAuthExplicitlySignedOut,
  markAuthSignedOut,
  readAuthToken,
  subscribeAuthToken,
  writeAuthToken,
} from '../api/authTokenStore'
import { hasDesktopControlCenterSessionBootstrap, recoverDesktopControlCenterSession } from '../api/desktopSessionRecovery'
import { AuthContext, type AccountInfo } from './authContextValue'

const DESKTOP_BOOTSTRAP_ATTEMPTS = 4
const DESKTOP_BOOTSTRAP_RETRY_MS = 450
const AUTH_STATUS_TIMEOUT_MS = 4_500
const GOOGLE_LOGIN_POLL_ATTEMPTS = 600

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function bootstrapDesktopSession(isCancelled: () => boolean): Promise<string | null> {
  for (let attempt = 0; attempt < DESKTOP_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    if (isCancelled() || isAuthExplicitlySignedOut()) return null
    const sessionToken = await recoverDesktopControlCenterSession().catch(() => null)
    if (sessionToken || isCancelled() || isAuthExplicitlySignedOut()) return sessionToken
    await sleep(DESKTOP_BOOTSTRAP_RETRY_MS * (attempt + 1))
  }
  return null
}

async function ensureGoogleLicenseWasImported(sessionToken: string): Promise<void> {
  const result = await apiRequest<{ active: boolean }>('/api/license/status', {
    authToken: sessionToken,
    timeoutMs: 8_000,
  })
  if (!result.ok) throw new Error(apiErrorMessage(result.error))
  if (result.data.active !== true) {
    throw new Error('Google sign-in succeeded, but no active Automnia license was found for that Google email.')
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readAuthToken())
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(readAuthToken()))
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [checking, setChecking] = useState(() => !readAuthToken() && hasDesktopControlCenterSessionBootstrap())
  const authEpochRef = useRef(0)

  const completeLogin = (
    sessionToken: string,
    nextAccount: AccountInfo | null = null,
    options: { allowExplicitSignIn?: boolean; epoch?: number } = {},
  ) => {
    if (options.epoch !== undefined && options.epoch !== authEpochRef.current) return false
    if (isAuthExplicitlySignedOut() && !options.allowExplicitSignIn) return false
    clearAuthSignedOut()
    writeAuthToken(sessionToken)
    setToken(sessionToken)
    setIsAuthenticated(true)
    setAccount(nextAccount)
    setChecking(false)
    return true
  }

  useEffect(() => {
    return subscribeAuthToken((nextToken) => {
      setToken(nextToken)
      setIsAuthenticated(Boolean(nextToken))
      if (!nextToken) setAccount(null)
      if (nextToken) setChecking(false)
    })
  }, [])

  useEffect(() => {
    if (!token) {
      if (isAuthExplicitlySignedOut() || !hasDesktopControlCenterSessionBootstrap()) {
        return
      }
      let cancelled = false
      Promise.resolve()
        .then(async () => {
          if (!cancelled) setChecking(true)
          const sessionToken = await bootstrapDesktopSession(() => cancelled)
          if (!sessionToken || cancelled) return false
          if (!cancelled) completeLogin(sessionToken, null, { epoch: authEpochRef.current })
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

    const authCheckEpoch = authEpochRef.current
    void apiRequest<{ authenticated: boolean; account?: AccountInfo | null }>('/api/auth/status', {
      authToken: token,
      signal: controller.signal,
      timeoutMs: AUTH_STATUS_TIMEOUT_MS,
    })
      .then((result) => {
        if (controller.signal.aborted || authCheckEpoch !== authEpochRef.current) return
        const authenticated = result.ok && result.data.authenticated
        setIsAuthenticated(authenticated)
        setAccount(authenticated && result.ok ? result.data.account || null : null)
        if (!authenticated) {
          clearAuthToken()
          setToken(null)
        }
      })
      .catch((error: unknown) => {
        if ((error instanceof DOMException && error.name === 'AbortError') || authCheckEpoch !== authEpochRef.current) return
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

  const login = async (email: string, password: string) => {
    const epoch = authEpochRef.current
    const result = await apiRequest<{ token?: string; account?: AccountInfo }>('/api/auth/login', {
      method: 'POST',
      authToken: '',
      timeoutMs: 10_000,
      body: { email, password },
    })

    if (!result.ok || !result.data.token) {
      throw new Error(result.ok ? 'Login response did not include a session token' : apiErrorMessage(result.error))
    }

    if (!completeLogin(result.data.token, result.data.account || null, { allowExplicitSignIn: true, epoch })) {
      void apiRequest('/api/auth/logout', { method: 'POST', authToken: result.data.token, timeoutMs: 5_000 })
    }
  }

  const setupAccount = async (email: string, licenseKey: string, password: string) => {
    const epoch = authEpochRef.current
    const result = await apiRequest<{ token?: string; account?: AccountInfo }>('/api/auth/account/setup', {
      method: 'POST',
      authToken: '',
      timeoutMs: 30_000,
      body: { email, licenseKey, password },
    })
    if (!result.ok || !result.data.token) {
      throw new Error(result.ok ? 'Account activation did not include a session token' : apiErrorMessage(result.error))
    }
    if (!completeLogin(result.data.token, result.data.account || null, { allowExplicitSignIn: true, epoch })) {
      void apiRequest('/api/auth/logout', { method: 'POST', authToken: result.data.token, timeoutMs: 5_000 })
    }
  }

  const loginWithGoogle = async () => {
    const epoch = authEpochRef.current
    const start = await apiRequest<{ sessionId: string; authorizationUrl?: string; openedBrowser?: boolean }>('/api/auth/account/google/start', {
      method: 'POST',
      authToken: '',
      timeoutMs: 15_000,
      body: {},
    })
    if (!start.ok) throw new Error(apiErrorMessage(start.error))
    if (!start.data.openedBrowser && start.data.authorizationUrl) {
      const opened = window.open(start.data.authorizationUrl, '_blank', 'noopener,noreferrer')
      if (!opened) throw new Error('Your browser blocked the Google sign-in window. Allow pop-ups for Automnia AI Nexus and try again.')
    }

    for (let attempt = 0; attempt < GOOGLE_LOGIN_POLL_ATTEMPTS; attempt += 1) {
      if (epoch !== authEpochRef.current) return
      const result = await apiRequest<{ status?: string; token?: string; account?: AccountInfo }>(`/api/auth/account/google/session/${encodeURIComponent(start.data.sessionId)}`, {
        authToken: '',
        timeoutMs: 10_000,
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      if (result.data.token) {
        await ensureGoogleLicenseWasImported(result.data.token)
        if (!completeLogin(result.data.token, result.data.account || null, { allowExplicitSignIn: true, epoch })) {
          void apiRequest('/api/auth/logout', { method: 'POST', authToken: result.data.token, timeoutMs: 5_000 })
        }
        return
      }
      await sleep(1_000)
    }
    throw new Error('Google sign-in timed out. Start it again when you are ready.')
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const result = await apiRequest('/api/auth/account/password/change', {
      method: 'POST',
      timeoutMs: 20_000,
      body: { currentPassword, newPassword },
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setAccount((current) => current ? { ...current, hasPassword: true } : current)
  }

  const setPassword = async (newPassword: string) => {
    const result = await apiRequest('/api/auth/account/password/set', {
      method: 'POST',
      timeoutMs: 20_000,
      body: { newPassword },
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setAccount((current) => current ? { ...current, hasPassword: true } : current)
  }

  const logout = () => {
    const activeToken = token
    authEpochRef.current += 1
    markAuthSignedOut()
    setToken(null)
    setIsAuthenticated(false)
    setAccount(null)
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
    <AuthContext.Provider value={{ isAuthenticated, token, account, login, setupAccount, loginWithGoogle, changePassword, setPassword, logout, checking }}>
      {children}
    </AuthContext.Provider>
  )
}

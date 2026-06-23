import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './authContextValue'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<string | null>(() => readStoredToken())
  const [checking, setChecking] = useState(() => Boolean(readStoredToken()))

  useEffect(() => {
    if (!token) return

    const controller = new AbortController()

    fetch('/api/auth/status', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { authenticated: boolean }) => {
        setIsAuthenticated(data.authenticated)
        if (!data.authenticated) {
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
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    })

    if (!response.ok) {
      throw new Error('Invalid token')
    }

    const data = (await response.json()) as { token: string }
    writeStoredToken(data.token)
    setToken(data.token)
    setIsAuthenticated(true)
    setChecking(false)
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

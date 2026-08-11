import { useEffect, useState, type ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import { useAuth } from './useAuth'
import { LicenseContext, type LicenseInfo } from './licenseContextValue'

const EMPTY_LICENSE: LicenseInfo = {
  active: false,
  email: null,
  tier: null,
  mode: null,
  creditBalance: null,
  activatedAt: null,
  verifiedAt: null,
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, token } = useAuth()
  const [license, setLicense] = useState<LicenseInfo | null>(null)
  const [checking, setChecking] = useState(() => isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setLicense(null)
      setChecking(false)
      return
    }

    const controller = new AbortController()
    setChecking(true)
    void apiRequest<LicenseInfo>('/api/license/status', { signal: controller.signal, timeoutMs: 8_000 })
      .then((result) => setLicense(result.ok ? result.data : EMPTY_LICENSE))
      .catch(() => setLicense(EMPTY_LICENSE))
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [isAuthenticated, token])

  const activate = async (email: string, licenseKey: string) => {
    const result = await apiRequest<LicenseInfo>('/api/license/activate', {
      method: 'POST',
      timeoutMs: 12_000,
      body: { email, licenseKey },
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setLicense(result.data)
  }

  return (
    <LicenseContext.Provider value={{ checking, license, isLicensed: license?.active === true, activate }}>
      {children}
    </LicenseContext.Provider>
  )
}

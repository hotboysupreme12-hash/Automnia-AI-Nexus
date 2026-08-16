import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import {
  LICENSE_STATUS_UPDATED_EVENT,
  mergeHostedCreditBalance,
  type HostedCreditBalanceUpdate,
} from '../utils/licenseEntitlement'
import { useAuth } from './useAuth'
import { LicenseContext, type HostedUsagePriority, type LicenseInfo } from './licenseContextValue'

const EMPTY_LICENSE: LicenseInfo = {
  active: false,
  email: null,
  tier: null,
  mode: null,
  planPriceCents: null,
  byokAllowed: false,
  permanentAccess: false,
  subscriptionStatus: null,
  usagePriority: null,
  creditBalance: null,
  creditBalanceUpdatedAt: null,
  activatedAt: null,
  verifiedAt: null,
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, token } = useAuth()
  const [license, setLicense] = useState<LicenseInfo | null>(null)
  const [checking, setChecking] = useState(() => isAuthenticated)
  const [licenseActivationRequested, setLicenseActivationRequested] = useState(false)
  const statusReadSequenceRef = useRef(0)

  const readLocalStatus = useCallback(async ({
    signal,
    blocking = false,
    clearOnError = false,
  }: {
    signal?: AbortSignal
    blocking?: boolean
    clearOnError?: boolean
  } = {}) => {
    const sequence = statusReadSequenceRef.current + 1
    statusReadSequenceRef.current = sequence
    if (blocking) setChecking(true)
    try {
      const result = await apiRequest<LicenseInfo>('/api/license/status', { signal, timeoutMs: 8_000 })
      const next = result.ok ? result.data : EMPTY_LICENSE
      if (!signal?.aborted && sequence === statusReadSequenceRef.current && (result.ok || clearOnError)) {
        setLicense(next)
      }
      return next
    } catch (error) {
      if (!signal?.aborted && clearOnError && sequence === statusReadSequenceRef.current) setLicense(EMPTY_LICENSE)
      throw error
    } finally {
      if (blocking && !signal?.aborted && sequence === statusReadSequenceRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !token) return

    const controller = new AbortController()
    void readLocalStatus({ signal: controller.signal, blocking: true, clearOnError: true })
      .catch(() => undefined)
    return () => controller.abort()
  }, [isAuthenticated, readLocalStatus, token])

  useEffect(() => {
    if (!isAuthenticated || !token) return
    const onHostedCreditUpdate = (event: Event) => {
      const detail = (event as CustomEvent<HostedCreditBalanceUpdate>).detail
      if (
        detail &&
        typeof detail.creditBalance === 'number' &&
        Number.isFinite(detail.creditBalance) &&
        detail.creditBalance >= 0
      ) {
        // The relay response is newer than any status request already in
        // flight. Invalidate those reads so an older cached balance cannot
        // overwrite the confirmed post-turn balance when it finishes later.
        statusReadSequenceRef.current += 1
        startTransition(() => {
          setLicense((current) => mergeHostedCreditBalance(
            current,
            detail.creditBalance,
            detail.creditBalanceUpdatedAt || new Date().toISOString(),
          ))
        })
        return
      }
      // Backward-compatible events reconcile silently. They must never put
      // the mounted app back into its blocking startup state.
      void readLocalStatus({ blocking: false, clearOnError: false }).catch(() => undefined)
    }
    window.addEventListener(LICENSE_STATUS_UPDATED_EVENT, onHostedCreditUpdate)
    return () => window.removeEventListener(LICENSE_STATUS_UPDATED_EVENT, onHostedCreditUpdate)
  }, [isAuthenticated, readLocalStatus, token])

  const activate = useCallback(async (email: string, licenseKey: string) => {
    const result = await apiRequest<LicenseInfo>('/api/license/activate', {
      method: 'POST',
      timeoutMs: 20_000,
      body: { email, licenseKey },
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setLicense(result.data)
  }, [])

  const refresh = useCallback(async () => {
    const result = await apiRequest<LicenseInfo>('/api/license/refresh', {
      method: 'POST',
      // The server retries transient provisioner failures before returning a
      // definitive refresh result. Keep the client request alive long enough
      // to receive that result instead of surfacing a false timeout.
      timeoutMs: 40_000,
      body: {},
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    
    setLicense(result.data)
    setLicenseActivationRequested(false)
    return result.data
  }, [])

  const setUsagePriority = useCallback(async (usagePriority: HostedUsagePriority) => {
    const result = await apiRequest<LicenseInfo>('/api/license/usage-priority', {
      method: 'POST',
      // Route changes wait for authenticated Gateway confirmation. A restart
      // is used only when OpenClaw cannot hot-reload the route safely.
      timeoutMs: 60_000,
      body: { usagePriority },
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setLicense(result.data)
    return result.data
  }, [])

  const openSubscriptionCheckout = useCallback(async () => {
    const result = await apiRequest<{ checkoutUrl: string }>('/api/license/checkout', {
      method: 'POST',
      timeoutMs: 12_000,
      body: {},
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    try {
      const parsed = new URL(result.data.checkoutUrl)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Checkout service returned an invalid URL.')
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Checkout service returned an invalid URL.')
    }
    const checkoutWindow = window.open(result.data.checkoutUrl, '_blank', 'noopener,noreferrer')
    if (!checkoutWindow) throw new Error('Your browser blocked the checkout window. Allow pop-ups for Automnia AI Nexus and try again.')
  }, [])

  const requestLicenseActivation = useCallback(() => setLicenseActivationRequested(true), [])
  const dismissLicenseActivation = useCallback(() => setLicenseActivationRequested(false), [])
  const contextValue = useMemo(() => ({
    // Do not render the manual activation screen during the first render
    // after Google/password login, before the imported local license status
    // has been read from the loopback server.
    checking: isAuthenticated && Boolean(token) ? checking || license === null : false,
    license: isAuthenticated && token ? license : null,
    isLicensed: isAuthenticated && Boolean(token) && license?.active === true,
    activate,
    refresh,
    setUsagePriority,
    openSubscriptionCheckout,
    requestLicenseActivation,
    dismissLicenseActivation,
    licenseActivationRequested,
  }), [
    activate,
    checking,
    dismissLicenseActivation,
    isAuthenticated,
    license,
    licenseActivationRequested,
    openSubscriptionCheckout,
    refresh,
    requestLicenseActivation,
    setUsagePriority,
    token,
  ])

  return (
    <LicenseContext.Provider value={contextValue}>
      {children}
    </LicenseContext.Provider>
  )
}

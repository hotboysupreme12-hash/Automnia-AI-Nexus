import { createContext } from 'react'

export type HostedUsagePriority =
  | 'automnia_only'
  | 'provider_first'
  | 'automnia_first_with_provider_fallback'
  /** Legacy values accepted while older local state is migrated. */
  | 'automnia_first'
  | 'byok_only'

export type LicenseInfo = {
  active: boolean
  email: string | null
  tier: string | null
  mode: 'hosted_credits' | 'byok' | null
  planPriceCents: number | null
  byokAllowed: boolean
  permanentAccess: boolean
  subscriptionStatus: string | null
  usagePriority: HostedUsagePriority | null
  creditBalance: number | null
  creditBalanceUpdatedAt: string | null
  activatedAt: string | null
  verifiedAt: string | null
}

export type LicenseContextValue = {
  checking: boolean
  license: LicenseInfo | null
  isLicensed: boolean
  activate: (email: string, licenseKey: string) => Promise<void>
  refresh: () => Promise<LicenseInfo>
  setUsagePriority: (usagePriority: HostedUsagePriority) => Promise<LicenseInfo>
  openSubscriptionCheckout: () => Promise<void>
  requestLicenseActivation: () => void
  dismissLicenseActivation: () => void
  licenseActivationRequested: boolean
}

export const LicenseContext = createContext<LicenseContextValue | null>(null)

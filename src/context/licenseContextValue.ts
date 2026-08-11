import { createContext } from 'react'

export type LicenseInfo = {
  active: boolean
  email: string | null
  tier: string | null
  activatedAt: string | null
  verifiedAt: string | null
}

export type LicenseContextValue = {
  checking: boolean
  license: LicenseInfo | null
  isLicensed: boolean
  activate: (email: string, licenseKey: string) => Promise<void>
}

export const LicenseContext = createContext<LicenseContextValue | null>(null)

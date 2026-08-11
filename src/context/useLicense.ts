import { useContext } from 'react'
import { LicenseContext } from './licenseContextValue'

export function useLicense() {
  const context = useContext(LicenseContext)
  if (!context) throw new Error('useLicense must be used within LicenseProvider')
  return context
}

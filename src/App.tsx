import { memo } from 'react'
import { NexusShell } from './components/layout/NexusShell'
import { LicenseActivationModal } from './components/auth/LicenseActivationModal'
import { LoginModal } from './components/auth/LoginModal'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import { useAuth } from './context/useAuth'
import { useLicense } from './context/useLicense'

const StableNexusShell = memo(NexusShell)

function AuthenticatedShell() {
  const { isAuthenticated } = useAuth()
  const { checking, isLicensed, licenseActivationRequested, dismissLicenseActivation } = useLicense()
  if (!isAuthenticated || checking) return <LoginModal />
  if (!isLicensed) return <LicenseActivationModal />
  return <>
    <StableNexusShell />
    {licenseActivationRequested && <LicenseActivationModal onClose={dismissLicenseActivation} />}
  </>
}

function App() {
  return (
    <AuthProvider>
      <LicenseProvider>
        <AuthenticatedShell />
      </LicenseProvider>
    </AuthProvider>
  )
}

export default App

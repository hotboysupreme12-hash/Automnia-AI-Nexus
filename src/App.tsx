import { memo } from 'react'
import { NexusShell } from './components/layout/NexusShell'
import { LicenseActivationModal } from './components/auth/LicenseActivationModal'
import { LoginModal } from './components/auth/LoginModal'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import { useAuth } from './context/useAuth'
import { useLicense } from './context/useLicense'

const StableNexusShell = memo(NexusShell)
const DEV_AGENT_SCREEN_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_AUTOMNIA_DEV_AGENT_SCREEN_PREVIEW === '1'

function AuthenticatedShell() {
  const { isAuthenticated } = useAuth()
  const { checking, isLicensed, licenseActivationRequested, dismissLicenseActivation } = useLicense()
  // This is a local UI preview only. It is available only from Vite's
  // development server and never changes the server-side auth or billing
  // gates used by agent traffic.
  if (DEV_AGENT_SCREEN_PREVIEW) return <StableNexusShell />
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

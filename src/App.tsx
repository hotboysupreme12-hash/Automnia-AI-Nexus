import { NexusShell } from './components/layout/NexusShell'
import { LicenseActivationModal } from './components/auth/LicenseActivationModal'
import { LoginModal } from './components/auth/LoginModal'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import { useAuth } from './context/useAuth'
import { useLicense } from './context/useLicense'

function AuthenticatedShell() {
  const { isAuthenticated } = useAuth()
  const { checking, isLicensed } = useLicense()
  if (!isAuthenticated || checking) return <LoginModal />
  return isLicensed ? <NexusShell /> : <LicenseActivationModal />
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

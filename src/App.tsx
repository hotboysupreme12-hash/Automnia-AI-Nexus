import { NexusShell } from './components/layout/NexusShell'
import { LoginModal } from './components/auth/LoginModal'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/useAuth'

function AuthenticatedShell() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <NexusShell /> : <LoginModal />
}

function App() {
  return (
    <AuthProvider>
      <AuthenticatedShell />
    </AuthProvider>
  )
}

export default App

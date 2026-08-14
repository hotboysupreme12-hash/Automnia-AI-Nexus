import { createContext } from 'react'

export type AccountInfo = {
  accountId: string | null
  email: string
  hasPassword: boolean
  googleLinked: boolean
}

export interface AuthContextValue {
  isAuthenticated: boolean
  token: string | null
  account: AccountInfo | null
  login: (email: string, password: string) => Promise<void>
  setupAccount: (email: string, licenseKey: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  cancelGoogleLogin: () => void
  skipDesktopSessionBootstrap: () => void
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  setPassword: (newPassword: string) => Promise<void>
  logout: () => void
  checking: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

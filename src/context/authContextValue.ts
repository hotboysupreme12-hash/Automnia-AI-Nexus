import { createContext } from 'react'

export interface AuthContextValue {
  isAuthenticated: boolean
  token: string | null
  login: (token: string) => Promise<void>
  logout: () => void
  checking: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

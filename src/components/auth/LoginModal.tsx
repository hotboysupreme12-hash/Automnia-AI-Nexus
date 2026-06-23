import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/useAuth'

const DYSTOPAI_LOCKUP_SRC = '/brand/dystopai-logo-multi-model-transparent-v2.png'

export function LoginModal() {
  const { login, checking } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(token)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[radial-gradient(circle_at_18%_10%,rgba(160,176,184,0.10),transparent_28%),radial-gradient(circle_at_82%_4%,rgba(255,255,255,0.035),transparent_30%),linear-gradient(160deg,#030303_0%,#101214_48%,#050505_100%)]">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-slate-300/80 border-t-transparent" />
          <p className="text-lg text-slate-100">Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[radial-gradient(circle_at_18%_10%,rgba(160,176,184,0.10),transparent_28%),radial-gradient(circle_at_82%_4%,rgba(255,255,255,0.035),transparent_30%),linear-gradient(160deg,#030303_0%,#101214_48%,#050505_100%)] px-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl border border-slate-200/15 bg-[linear-gradient(180deg,rgba(20,23,25,0.96),rgba(6,7,8,0.96))] p-8 shadow-[0_30px_80px_-48px_rgba(160,176,184,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div className="mb-6 text-center">
          <div className="dui-login-brand mx-auto flex w-full max-w-[360px] items-center justify-center" aria-label="DystopAI Multi Model Nexus">
            <img src={DYSTOPAI_LOCKUP_SRC} alt="DystopAI Multi Model Nexus" className="dui-login-logo-lockup" draggable={false} />
          </div>
          <p className="mt-1 text-sm text-slate-300">Enter your access token to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="token" className="mb-2 block text-sm text-slate-200">
              Access Token
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your token"
              className="w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-900/40 border border-red-400/30 px-4 py-2 text-sm text-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full rounded-lg border border-slate-100/20 bg-[linear-gradient(180deg,rgba(214,224,228,0.18),rgba(116,132,140,0.12))] px-4 py-3 font-semibold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_18px_36px_-30px_rgba(190,206,214,0.52)] transition disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Login'}
          </button>

          <div className="mt-4 text-center text-xs text-slate-400">
            <p>Default dev token: dev-token-change-me</p>
            <p className="mt-1">Set CONTROL_CENTER_TOKEN env var to change</p>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

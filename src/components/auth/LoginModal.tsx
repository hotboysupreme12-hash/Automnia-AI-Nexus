import { useState } from 'react'
import { useAuth } from '../../context/useAuth'

const AUTOMNIA_LOCKUP_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const AUTOMNIA_BRAND_LABEL = 'Automnia AI Nexus'

export function LoginModal() {
  const { login, setupAccount, loginWithGoogle, checking } = useAuth()
  const [mode, setMode] = useState<'login' | 'setup'>('login')
  const [email, setEmail] = useState('')
  const [licenseKey, setLicenseKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (mode === 'setup' && password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'setup') await setupAccount(email.trim(), licenseKey.trim(), password)
      else await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setLoading(true)
    try {
      await loginWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="dui-auth-screen fixed inset-0 z-50 grid place-items-center bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0)_220px),linear-gradient(135deg,#050607_0%,#090b0f_44%,#0c1015_72%,#050607_100%)] px-4">
        <div className="dui-auth-card w-full max-w-sm rounded-lg border border-slate-200/15 bg-[linear-gradient(180deg,rgba(18,22,25,0.96),rgba(8,10,11,0.96))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_44px_-34px_rgba(180,200,190,0.34)]">
          <div className="dui-login-brand mx-auto flex w-full max-w-[260px] items-center justify-center" aria-label={AUTOMNIA_BRAND_LABEL}>
            <img src={AUTOMNIA_LOCKUP_SRC} alt={AUTOMNIA_BRAND_LABEL} className="dui-login-logo-lockup" draggable={false} />
          </div>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div className="h-full w-1/2 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-slate-200/70" />
          </div>
          <p className="mt-4 text-center text-sm font-semibold text-slate-100">Opening secure session</p>
          <p className="mt-1 text-center text-xs text-slate-400">Verifying the local Automnia runtime.</p>
        </div>
      </div>
    )
  }

  const isSetup = mode === 'setup'
  return (
    <div className="dui-auth-screen fixed inset-0 z-50 grid place-items-center bg-[radial-gradient(circle_at_18%_10%,rgba(160,176,184,0.10),transparent_28%),radial-gradient(circle_at_82%_4%,rgba(255,255,255,0.035),transparent_30%),linear-gradient(160deg,#030303_0%,#101214_48%,#050505_100%)] px-4">
      <div className="dui-auth-card dy-surface-enter w-full max-w-md rounded-2xl border border-slate-200/15 bg-[linear-gradient(180deg,rgba(20,23,25,0.96),rgba(6,7,8,0.96))] p-8 shadow-[0_30px_80px_-48px_rgba(160,176,184,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="mb-6 text-center">
          <div className="dui-login-brand mx-auto flex w-full max-w-[360px] items-center justify-center" aria-label={AUTOMNIA_BRAND_LABEL}>
            <img src={AUTOMNIA_LOCKUP_SRC} alt={AUTOMNIA_BRAND_LABEL} className="dui-login-logo-lockup" draggable={false} />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-100">{isSetup ? 'Activate your Automnia account' : 'Sign in to Automnia'}</h1>
          <p className="mt-1 text-sm text-slate-300">
            {isSetup ? 'Create the password you will use on this device and future devices.' : 'Use your Automnia account password to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="account-email" className="mb-2 block text-sm text-slate-200">Account email</label>
            <input
              id="account-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500"
              required
            />
          </div>

          {isSetup && (
            <div>
              <label htmlFor="subscription-key" className="mb-2 block text-sm text-slate-200">Automnia license key (first account link)</label>
              <input
                id="subscription-key"
                type="password"
                autoComplete="off"
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder="From your Automnia order"
                className="w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500"
                required
              />
            </div>
          )}

          <div>
            <label htmlFor="account-password" className="mb-2 block text-sm text-slate-200">{isSetup ? 'Create password' : 'Password'}</label>
            <input
              id="account-password"
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              className="w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500"
              minLength={12}
              required
            />
          </div>

          {isSetup && (
            <div>
              <label htmlFor="confirm-password" className="mb-2 block text-sm text-slate-200">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Enter it again"
                className="w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500"
                minLength={12}
                required
              />
            </div>
          )}

          {error && <div className="rounded-lg border border-red-400/30 bg-red-900/40 px-4 py-2 text-sm text-red-100">{error}</div>}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full rounded-lg border border-slate-100/20 bg-[linear-gradient(180deg,rgba(214,224,228,0.18),rgba(116,132,140,0.12))] px-4 py-3 font-semibold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_18px_36px_-30px_rgba(190,206,214,0.52)] transition disabled:opacity-50"
          >
            {loading ? (isSetup ? 'Activating...' : 'Signing in...') : (isSetup ? 'Activate account' : 'Sign in')}
          </button>

          {!isSetup && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full rounded-lg border border-slate-200/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                {loading ? 'Waiting for Google...' : 'Continue with Google'}
              </button>
              <p className="text-center text-xs text-slate-500">Your default browser will open for secure Google sign-in. Only active Automnia subscriber emails can continue.</p>
            </>
          )}

          <div className="pt-2 text-center text-xs text-slate-400">
            <button type="button" className="text-slate-200 underline decoration-slate-500 underline-offset-4" onClick={() => { setError(''); setMode(isSetup ? 'login' : 'setup') }}>
              {isSetup ? 'Already linked? Sign in' : 'First time here? Link your Automnia purchase'}
            </button>
            <p className="mt-3">Your password is verified locally after account linking; eligible Pro and higher permanent tiers can continue offline. Starter requires online subscription verification. Automnia never uses the password itself as a session token.</p>
          </div>
        </form>
      </div>
    </div>
  )
}

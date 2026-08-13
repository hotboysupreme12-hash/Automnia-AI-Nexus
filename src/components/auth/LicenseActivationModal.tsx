import { useState } from 'react'
import { useLicense } from '../../context/useLicense'
import { resolveAgentRoutePresentation, resolveLicenseEntitlement } from '../../utils/licenseEntitlement'

const AUTOMNIA_LOCKUP_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const AUTOMNIA_BRAND_LABEL = 'Automnia AI Nexus'

export function LicenseActivationModal({ onClose }: { onClose?: () => void }) {
  const { activate, license } = useLicense()
  const [email, setEmail] = useState(license?.email || '')
  const [licenseKey, setLicenseKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await activate(email.trim(), licenseKey.trim())
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const entitlement = resolveLicenseEntitlement(license)
  const routePresentation = resolveAgentRoutePresentation(license)
  const isCloudCredits = entitlement.isHosted
  const hasManagedCredits = isCloudCredits || entitlement.isByok
  const providerFirst = routePresentation.providerFirst
  return (
    <div className="dui-auth-screen fixed inset-0 z-50 grid place-items-center bg-[radial-gradient(circle_at_18%_10%,rgba(160,176,184,0.10),transparent_28%),linear-gradient(160deg,#030303_0%,#101214_48%,#050505_100%)] px-4">
      <div className="dui-auth-card dy-surface-enter w-full max-w-md rounded-2xl border border-slate-200/15 bg-[linear-gradient(180deg,rgba(20,23,25,0.96),rgba(6,7,8,0.96))] p-8 shadow-[0_30px_80px_-48px_rgba(160,176,184,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="mb-6 text-center">
          <div className="dui-login-brand mx-auto flex w-full max-w-[360px] items-center justify-center" aria-label={AUTOMNIA_BRAND_LABEL}>
            <img src={AUTOMNIA_LOCKUP_SRC} alt={AUTOMNIA_BRAND_LABEL} className="dui-login-logo-lockup" draggable={false} />
          </div>
          <p className="mt-3 text-sm text-slate-300">Automnia AI Nexus License & Billing Route</p>
        </div>

        {license?.active && (
          <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 text-left">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">License Active</span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">{entitlement.tierLabel}</span>
            </div>
            <p className="mt-2 text-sm text-slate-200"><strong className="text-slate-100">Email:</strong> {license.email}</p>

            <div className="mt-3 border-t border-emerald-500/10 pt-3">
              {hasManagedCredits ? (
                <div>
                  <p className="text-xs font-medium text-emerald-300">{entitlement.tierLabel} — {routePresentation.routeLabel}</p>
                  <p className="mt-1 font-mono text-lg font-bold text-white">
                    {license.creditBalance !== null ? license.creditBalance.toLocaleString() : 'Balance pending confirmation'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{providerFirst ? 'Your connected provider or OAuth account is used first. Automnia pooled credits remain available for this account.' : routePresentation.providerOnly ? 'Your connected provider is used directly. Automnia credits are bypassed.' : 'Automnia credits are available for this confirmed account and can be pooled across its email-linked purchases.'}</p>
                  <p className="mt-1 text-xs text-slate-500">{entitlement.usagePriorityLocked ? 'Starter stays on Automnia credits.' : 'Change this priority at any time under Settings → Account &amp; License.'}</p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-sky-300">{entitlement.tierLabel} — Your Provider Account</p>
                  <p className="mt-1 text-xs text-slate-300">Add an API key or sign in with OpenAI, Gemini, Anthropic, or another provider in model settings. Your provider can be prioritized, or this account can use any pooled Automnia credits linked to the same verified email.</p>
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-slate-200">Checkout email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" className="mt-2 w-full rounded-lg bg-slate-950/70 px-4 py-3 text-slate-100 placeholder-slate-500" required />
          </label>
          <label className="block text-sm text-slate-200">License key
            <input value={licenseKey} onChange={(event) => setLicenseKey(event.target.value.toUpperCase())} placeholder="AUT-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} className="mt-2 w-full rounded-lg bg-slate-950/70 px-4 py-3 font-mono text-slate-100 placeholder-slate-500" required />
          </label>
          {error && <div className="rounded-lg border border-red-400/30 bg-red-900/40 px-4 py-2 text-sm text-red-100">{error}</div>}
          <button type="submit" disabled={loading || !email.trim() || !licenseKey.trim()} className="w-full rounded-lg border border-slate-100/20 bg-[linear-gradient(180deg,rgba(214,224,228,0.18),rgba(116,132,140,0.12))] px-4 py-3 font-semibold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_18px_36px_-30px_rgba(190,206,214,0.52)] transition disabled:opacity-50">
            {loading ? 'Linking...' : license?.active ? 'Link another purchase' : 'Link Automnia purchase'}
          </button>
          {onClose && <button type="button" onClick={onClose} className="w-full rounded-lg border border-slate-100/10 bg-slate-950/40 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-100/20 hover:text-white">Keep current license</button>}
          <p className="text-center text-xs text-slate-400">
            Link a purchase once. Higher-tier purchases are merged automatically into this account and keep one canonical license key.
          </p>
        </form>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import {
  fetchProviderAuthStatuses,
  fetchProviderOAuthSession,
  startProviderOAuthSession,
  submitProviderOAuthManual,
  type AuthProviderStatus,
} from '../../api/providerAuth'

interface ProviderAuthModalProps {
  isOpen: boolean
  provider: string
  envKeys: string[]
  providerStatus?: AuthProviderStatus | null
  onClose: () => void
  onSave: (apiKey: string) => Promise<void>
  onConnected?: (providerStatus?: AuthProviderStatus) => Promise<void> | void
  onOAuthComplete?: (providerStatus?: AuthProviderStatus) => Promise<void> | void
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  deepseek: 'DeepSeek',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'openai-codex': 'OpenAI / Codex',
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function formatOAuthExpiry(expiresAt?: number, refreshAvailable = false) {
  if (!expiresAt) return refreshAvailable ? 'refresh token available' : 'not reported'
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return 'expired — reconnect now'
  const minutes = Math.round(deltaMs / 60000)
  if (minutes < 60) return `${minutes} min remaining`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hr remaining`
  return `${Math.round(hours / 24)} days remaining`
}

function oauthHealth(expiresAt?: number, refreshAvailable = false) {
  if (!expiresAt) return { label: refreshAvailable ? 'Refreshable' : 'Connected', tone: 'emerald' as const }
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return { label: 'Reconnect required', tone: 'rose' as const }
  if (deltaMs < 15 * 60 * 1000) return { label: refreshAvailable ? 'Refresh Soon' : 'Expiring', tone: 'amber' as const }
  return { label: 'Ready', tone: 'emerald' as const }
}

function BrandMark() {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.09] shadow-[0_10px_30px_-18px_rgba(34,211,238,0.9)]">
      <svg aria-hidden="true" className="size-6 text-cyan-200" viewBox="0 0 24 24" fill="none">
        <path d="M12 2.75 14.2 9.8 21.25 12l-7.05 2.2L12 21.25 9.8 14.2 2.75 12 9.8 9.8 12 2.75Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
        <path d="m18.25 3.25.55 1.95 1.95.55-1.95.55-.55 1.95-.55-1.95-1.95-.55 1.95-.55.55-1.95Z" fill="currentColor" />
      </svg>
    </span>
  )
}

function ShieldCheckIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none">
      <path d="M12 3.25 19 6v5.35c0 4.3-2.7 7.65-7 9.4-4.3-1.75-7-5.1-7-9.4V6l7-2.75Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m8.75 12 2.15 2.15 4.4-4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none">
      <path d="M14 5h5v5M19 5l-8.25 8.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 13.5v4A1.5 1.5 0 0 1 16.5 19h-10A1.5 1.5 0 0 1 5 17.5v-10A1.5 1.5 0 0 1 6.5 6h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none">
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ProviderAuthModal({ isOpen, provider, envKeys, providerStatus, onClose, onSave, onConnected, onOAuthComplete }: ProviderAuthModalProps) {
  const isGoogleVertex = provider === 'google-vertex'
  const isGoogleProvider = provider === 'google' || isGoogleVertex
  const [apiKey, setApiKey] = useState('')
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualPrompt, setManualPrompt] = useState('')
  const [manualSessionId, setManualSessionId] = useState('')
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [liveProviderStatus, setLiveProviderStatus] = useState<AuthProviderStatus | null>(null)
  const [gcloudRefreshing, setGcloudRefreshing] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState('')

  const activeProviderStatus = liveProviderStatus || providerStatus
  const label = isGoogleVertex
    ? 'Google Cloud'
    : provider === 'google'
      ? 'Gemini'
      : activeProviderStatus?.label || providerLabels[provider] || provider

  const refreshProviderStatus = useCallback(async (announceReady = false) => {
    setGcloudRefreshing(true)
    try {
      const result = await fetchProviderAuthStatuses({ refresh: true, timeoutMs: 30_000 })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const next = result.data.providers?.find((entry) => entry.provider === provider) || null
      if (!next) {
        if (announceReady) setStatus('Saved locally. Provider status will refresh on the next check.')
        return
      }
      if (next) {
        setLiveProviderStatus(next)
        if (next.configured) {
          if (announceReady) {
            const project = next.gcloud?.projectId || next.oauth?.projectId
            setStatus(isGoogleProvider ? `Connected${project ? ` · Project: ${project}` : ''}.` : `${next.label || providerLabels[provider] || provider} is ready.`)
          }
          await onConnected?.(next)
        } else if (announceReady) {
          const readyLabel = next.label || providerLabels[provider] || provider
          setStatus(`${readyLabel} key was saved, but the provider is not reporting ready yet.`)
        }
      }
    } catch (error) {
      if (announceReady) setStatus(`Refresh failed: ${error}`)
    } finally {
      setGcloudRefreshing(false)
    }
  }, [isGoogleProvider, onConnected, provider])

  useEffect(() => {
    if (!isOpen) return
    setApiKey('')
    setApiKeyOpen(false)
    setProjectId(activeProviderStatus?.oauth?.projectId || '')
    setStatus('')
    setSaving(false)
    setOauthBusy(false)
    setAuthorizationUrl('')
    setManualCode('')
    setManualPrompt('')
    setManualSessionId('')
    setManualSubmitting(false)
    setLiveProviderStatus(null)
    setCopiedCommand('')
    if (provider === 'google-vertex') void refreshProviderStatus(false)
  }, [isOpen, provider, activeProviderStatus?.oauth?.projectId, refreshProviderStatus])

  if (!isOpen) return null

  const oauth = activeProviderStatus?.oauth
  const oauthSupported = Boolean(oauth?.supported)
  const oauthReady = Boolean(oauth?.available)
  const oauthMissing = oauth?.missing?.filter(Boolean) || []
  const oauthState = oauthHealth(oauth?.expiresAt, oauth?.refreshAvailable)
  const subscriptionAuth = activeProviderStatus?.subscriptionAuth
  const gcloud = activeProviderStatus?.gcloud
  const gcloudMissing = gcloud?.missing?.filter(Boolean) || []
  const hasApiKeyAuth = envKeys.length > 0
  const gcloudCredentialLabel = gcloud?.credentialSource === 'application-default'
    ? 'Application Default Credentials'
    : gcloud?.credentialSource === 'gcloud'
      ? 'Google Cloud CLI sign-in'
      : gcloud?.credentialSource === 'environment'
        ? 'environment access token'
        : gcloud?.credentialSource === 'local-oauth'
          ? 'local Google OAuth'
          : ''

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    setStatus('')
    try {
      await onSave(apiKey.trim())
      setApiKey('')
      setStatus('Saved. Verifying provider readiness...')
      await refreshProviderStatus(true)
    } catch (error) {
      setStatus(`Failed to save: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const pollOAuthSession = async (sessionId: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await sleep(1500)
      const result = await fetchProviderOAuthSession(provider, sessionId, { timeoutMs: 10_000 })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const data = result.data
      if (data.authorizationUrl) setAuthorizationUrl(data.authorizationUrl)
      if (data.manualInputRequired) {
        setManualSessionId(sessionId)
        setManualPrompt(data.manualPrompt || 'Paste the authorization code or full redirect URL.')
      }
      if (data.status === 'complete') {
        if (data.providerStatus?.provider === provider) {
          setLiveProviderStatus(data.providerStatus)
        }
        if (data.providerStatus?.configured) {
          await onConnected?.(data.providerStatus)
        } else {
          await refreshProviderStatus(false)
        }
        const connectedAs = !isGoogleProvider && data.result?.email ? ` as ${data.result.email}` : ''
        setStatus(
          isGoogleProvider
            ? `Connected${isGoogleVertex && !projectId.trim() ? '. Add a project to use Vertex.' : '.'}`
            : `OAuth connected${connectedAs}. You can close this window.`,
        )
        setAuthorizationUrl('')
        setManualSessionId('')
        setManualPrompt('')
        setManualCode('')
        await onOAuthComplete?.(data.providerStatus)
        return
      }
      if (data.status === 'error') throw new Error(data.error || 'OAuth failed.')
    }
    throw new Error('OAuth timed out before the browser callback completed.')
  }

  const handleOAuth = async () => {
    setOauthBusy(true)
    setStatus('')
    setAuthorizationUrl('')
    setManualCode('')
    setManualPrompt('')
    setManualSessionId('')
    try {
      const result = await startProviderOAuthSession(provider, {
        projectId: projectId.trim() || undefined,
        timeoutMs: 20_000,
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const data = result.data
      if (!data.ok || !data.sessionId) {
        throw new Error('Could not start OAuth.')
      }
      if (data.authorizationUrl) setAuthorizationUrl(data.authorizationUrl)
      setStatus(data.openedBrowser ? 'Finish sign-in in your browser.' : 'Open the sign-in link to continue.')
      if (!data.openedBrowser && data.authorizationUrl) window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer')
      await pollOAuthSession(data.sessionId)
    } catch (error) {
      setStatus(`OAuth failed: ${error}`)
    } finally {
      setOauthBusy(false)
    }
  }

  const handleManualSubmit = async () => {
    if (!manualSessionId || !manualCode.trim()) return
    setManualSubmitting(true)
    setStatus('')
    try {
      const result = await submitProviderOAuthManual(provider, manualSessionId, manualCode.trim())
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      setManualCode('')
      setManualPrompt('')
      setStatus('Authorization submitted. Finishing sign-in.')
    } catch (error) {
      setStatus(`OAuth failed: ${error}`)
    } finally {
      setManualSubmitting(false)
    }
  }

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(command)
      window.setTimeout(() => setCopiedCommand((current) => current === command ? '' : current), 1800)
    } catch {
      setStatus('Copy was unavailable. Select the command and copy it manually.')
    }
  }

  const statusTone = /failed|error|expired|reconnect required|not reporting/i.test(status)
    ? 'error'
    : /connected|ready|saved|submitted/i.test(status)
      ? 'success'
      : 'info'
  const oauthStep = oauth?.configured ? 3 : oauthBusy || authorizationUrl ? 2 : 1
  const googleConnected = Boolean(isGoogleVertex ? gcloud?.configured || oauth?.configured : activeProviderStatus?.configured || oauth?.configured)
  const googleProject = gcloud?.projectId || oauth?.projectId || projectId
  const googleAdcSetupUrl = oauth?.docs || 'https://cloud.google.com/docs/authentication/provide-credentials-adc'

  return (
    <>
      <div
        className="fixed inset-0 z-[60] overflow-y-auto bg-[#02050b]/88 p-4 backdrop-blur-md sm:p-6"
      >
        <div className="flex min-h-full items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-auth-title"
            className="dy-surface-enter relative my-4 max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[1.75rem] border border-white/[0.12] bg-[linear-gradient(145deg,rgba(17,31,52,0.98),rgba(5,9,17,0.99)_58%,rgba(4,7,12,0.99))] p-5 shadow-[0_36px_100px_-44px_rgba(34,211,238,0.38),0_18px_60px_-30px_rgba(0,0,0,0.95)] sm:p-7"
          >
            <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-cyan-400/[0.08] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -left-24 size-64 rounded-full bg-blue-500/[0.07] blur-3xl" />

            <div className="relative">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <BrandMark />
                  <div className="min-w-0">
                    <div className={`mb-1 flex flex-wrap items-center gap-2 ${isGoogleProvider ? 'hidden' : ''}`}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">Provider connection</p>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                        <ShieldCheckIcon /> Secure
                      </span>
                    </div>
                    <h3 id="provider-auth-title" className="truncate font-heading text-2xl tracking-tight text-slate-50 sm:text-[1.7rem]">Connect {label}</h3>
                    <p className={`mt-1 max-w-xl text-xs leading-5 text-slate-300 ${isGoogleProvider ? 'hidden' : ''}`}>
                {provider === 'openai'
                  ? 'Choose an API key or your ChatGPT / Codex subscription.'
                  : provider === 'anthropic'
                    ? 'Use a production API key or an existing Claude Code subscription.'
                    : provider === 'google' || provider === 'google-vertex'
                      ? `Connect with your ${label} account or use an API key.`
                    : 'Store local credentials for this provider.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close provider connection dialog"
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.10] bg-white/[0.035] text-slate-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-slate-100"
                >
                  <CloseIcon />
                </button>
              </div>

              {(activeProviderStatus?.docs || activeProviderStatus?.apiKeyUrl) && !isGoogleProvider && (
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resources</span>
                  {activeProviderStatus.docs && (
                    <a
                      href={activeProviderStatus.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.11]"
                    >
                      Provider guide <ExternalLinkIcon />
                    </a>
                  )}
                  {activeProviderStatus.apiKeyUrl && (
                    <a
                      href={activeProviderStatus.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.035] px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-slate-100"
                    >
                      {provider === 'google' ? 'Create Gemini API key' : 'Create API key'} <ExternalLinkIcon />
                    </a>
                  )}
                </div>
              )}

              {oauthSupported && !isGoogleProvider && (
                <section className="mb-5 rounded-2xl border border-cyan-200/20 bg-[linear-gradient(145deg,rgba(8,47,73,0.52),rgba(7,18,31,0.72))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-200/20 bg-cyan-300/[0.08] text-cyan-200">
                        <ShieldCheckIcon />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/70">Recommended</p>
                          <span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-100">OAuth</span>
                        </div>
                        <h4 className="mt-1 text-base font-semibold text-slate-50">
                          {provider === 'openai' ? 'ChatGPT / Codex subscription' : provider === 'anthropic' ? 'Claude Pro / Max OAuth' : provider === 'google-vertex' ? 'Google Cloud sign-in' : `${label} account`}
                        </h4>
                        <p className="mt-1 max-w-lg text-xs leading-5 text-slate-300">
                          {oauth?.configured
                            ? `Connected${oauth.email ? ` as ${oauth.email}` : oauth.accountId ? ` as ${oauth.accountId}` : ''}. Reconnect any time to replace this session.`
                          : provider === 'google-vertex'
                            ? 'Sign in with Google once. Automnia reuses this local credential for Vertex AI and keeps the token in the local runtime.'
                            : `Sign in securely with your ${label} account. Automnia keeps the credential in the local runtime.`}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleOAuth}
                      disabled={oauthBusy || !oauthReady}
                      aria-busy={oauthBusy}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-200/25 bg-cyan-300/[0.12] px-4 text-xs font-bold text-cyan-50 shadow-[0_10px_28px_-18px_rgba(34,211,238,0.9)] transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.18] disabled:cursor-wait disabled:opacity-45"
                    >
                      {oauthBusy && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                      {oauthBusy ? 'Opening browser...' : oauth?.configured ? 'Reconnect account' : 'Continue with OAuth'}
                      {!oauthBusy && <ArrowIcon />}
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2" aria-label="OAuth sign-in steps">
                    {[
                      ['1', 'Open sign-in'],
                      ['2', 'Approve access'],
                      ['3', 'Return to Automnia'],
                    ].map(([step, stepLabel], index) => {
                      const active = index + 1 === oauthStep
                      const complete = index + 1 < oauthStep
                      return (
                        <div key={step} className={`rounded-xl border px-2.5 py-2.5 ${active ? 'border-cyan-200/30 bg-cyan-300/[0.09]' : complete ? 'border-emerald-200/20 bg-emerald-300/[0.05]' : 'border-white/[0.08] bg-white/[0.025]'}`}>
                          <div className={`mb-1 flex size-5 items-center justify-center rounded-full text-[9px] font-bold ${active ? 'bg-cyan-200 text-slate-950' : complete ? 'bg-emerald-300/80 text-slate-950' : 'bg-white/[0.08] text-slate-500'}`}>
                            {complete ? '✓' : step}
                          </div>
                          <p className={`text-[10px] font-semibold leading-4 ${active ? 'text-cyan-100' : complete ? 'text-emerald-100' : 'text-slate-500'}`}>{stepLabel}</p>
                        </div>
                      )
                    })}
                  </div>

                  {oauth?.configured && (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className={`rounded-xl border px-3 py-2.5 ${oauthState.tone === 'rose' ? 'border-rose-300/25 bg-rose-400/[0.08]' : oauthState.tone === 'amber' ? 'border-amber-300/25 bg-amber-400/[0.08]' : 'border-emerald-300/20 bg-emerald-400/[0.07]'}`}>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Session status</p>
                        <p className={`mt-1 text-xs font-semibold ${oauthState.tone === 'rose' ? 'text-rose-100' : oauthState.tone === 'amber' ? 'text-amber-100' : 'text-emerald-100'}`}>{oauthState.label}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Session lifetime</p>
                        <p className="mt-1 text-xs font-semibold text-slate-200">{formatOAuthExpiry(oauth.expiresAt, oauth.refreshAvailable)}</p>
                      </div>
                      {oauth.email && (
                        <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Signed in as</p>
                          <p className="mt-1 truncate text-xs font-semibold text-slate-200">{oauth.email}</p>
                        </div>
                      )}
                      {oauth.accountId && (
                        <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Account</p>
                          <p className="mt-1 truncate text-xs font-semibold text-slate-200">{oauth.accountId}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {(provider === 'google' || provider === 'google-vertex') && (
                    <label className="mt-4 block text-xs font-medium text-slate-200">
                      Google Cloud project <span className="font-normal text-slate-500">(needed for Vertex; optional for Gemini API keys)</span>
                      <input
                        type="text"
                        value={projectId}
                        onChange={(event) => setProjectId(event.target.value)}
                        placeholder="Enter a project ID"
                        className="mt-2 w-full rounded-xl border border-white/[0.09] bg-slate-950/55 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                      />
                    </label>
                  )}
                  {!oauthReady && oauthMissing.length > 0 && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-amber-100">
                      <span className="mt-0.5 text-amber-200">!</span>
                      <span>{oauthMissing[0]}</span>
                    </div>
                  )}

                  {(oauthBusy || authorizationUrl || manualSessionId) && (
                    <div className="mt-4 rounded-xl border border-cyan-200/15 bg-slate-950/45 p-3.5" aria-live="polite">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${oauthBusy ? 'bg-cyan-300/[0.12] text-cyan-200' : 'bg-emerald-300/[0.10] text-emerald-200'}`}>
                          {oauthBusy ? <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" /> : <ShieldCheckIcon />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-100">{oauthBusy ? 'Waiting for secure callback' : 'Continue in your browser'}</p>
                          <p className="mt-1 text-[11px] leading-5 text-slate-400">
                            {oauthBusy ? 'Finish signing in in the browser window. Automnia will detect the callback automatically.' : 'If the sign-in page did not open, use the link below to continue.'}
                          </p>
                        </div>
                        {authorizationUrl && (
                          <a
                            href={authorizationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.09] px-2.5 py-2 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-300/[0.15]"
                          >
                            Open link <ExternalLinkIcon />
                          </a>
                        )}
                      </div>
                      {manualSessionId && (
                        <div className="mt-3 border-t border-white/[0.08] pt-3">
                          <p className="text-[11px] leading-5 text-slate-300">{manualPrompt || 'Paste the authorization code or full redirect URL.'}</p>
                          <textarea
                            value={manualCode}
                            onChange={(event) => setManualCode(event.target.value)}
                            aria-label="Authorization code or redirect URL"
                            placeholder="Paste the authorization code or redirect URL"
                            rows={3}
                            className="mt-2 w-full resize-none rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 font-mono text-[11px] leading-5 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                          />
                          <button
                            type="button"
                            onClick={handleManualSubmit}
                            disabled={manualSubmitting || !manualCode.trim()}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.10] px-3 py-2 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-300/[0.16] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {manualSubmitting && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                            {manualSubmitting ? 'Submitting...' : 'Finish sign-in'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {isGoogleProvider && (
                <section className="mb-5 rounded-2xl border border-cyan-200/20 bg-[linear-gradient(145deg,rgba(8,47,73,0.42),rgba(7,18,31,0.62))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] sm:p-5">
                  {(!googleConnected || isGoogleVertex) && (
                    <div className="flex items-center justify-between gap-3">
                      {!googleConnected && <p className="text-xs font-semibold text-slate-100">Not connected</p>}
                      {isGoogleVertex && (
                        <a
                          href={googleAdcSetupUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-slate-100"
                        >
                          Provider setup for ADC Google <ExternalLinkIcon />
                        </a>
                      )}
                    </div>
                  )}

                  {(!googleConnected || !googleProject) && (
                    <label className="mt-4 block text-xs font-medium text-slate-200">
                      Project ID <span className="font-normal text-slate-500">{isGoogleVertex ? '' : '(optional)'}</span>
                      <input
                        type="text"
                        value={projectId}
                        onChange={(event) => setProjectId(event.target.value)}
                        placeholder="Project ID"
                        className="mt-2 w-full rounded-xl border border-white/[0.09] bg-slate-950/55 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                      />
                    </label>
                  )}

                  {googleConnected && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] px-3 py-2.5 text-xs">
                      <span className="font-semibold text-emerald-100">Connected</span>
                      <span className="truncate text-slate-300">Project: {googleProject || 'not set'}</span>
                    </div>
                  )}

                  {(oauthBusy || authorizationUrl || manualSessionId) && (
                    <div className="mt-4 rounded-xl border border-cyan-200/15 bg-slate-950/45 p-3" aria-live="polite">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-slate-100">{oauthBusy ? 'Finish sign-in in your browser.' : 'Continue in your browser.'}</p>
                        {authorizationUrl && (
                          <a
                            href={authorizationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.09] px-2.5 py-2 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-300/[0.15]"
                          >
                            Open sign-in <ExternalLinkIcon />
                          </a>
                        )}
                      </div>
                      {manualSessionId && (
                        <div className="mt-3 border-t border-white/[0.08] pt-3">
                          <p className="text-[11px] leading-5 text-slate-300">{manualPrompt || 'Paste the authorization code or redirect URL.'}</p>
                          <textarea
                            value={manualCode}
                            onChange={(event) => setManualCode(event.target.value)}
                            aria-label="Authorization code or redirect URL"
                            placeholder="Paste the authorization code or redirect URL"
                            rows={3}
                            className="mt-2 w-full resize-none rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 font-mono text-[11px] leading-5 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                          />
                          <button
                            type="button"
                            onClick={handleManualSubmit}
                            disabled={manualSubmitting || !manualCode.trim()}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.10] px-3 py-2 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-300/[0.16] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {manualSubmitting && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                            {manualSubmitting ? 'Submitting…' : 'Finish sign-in'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                    {oauthSupported && (
                      <button
                        type="button"
                        onClick={handleOAuth}
                        disabled={oauthBusy || !oauthReady}
                        aria-busy={oauthBusy}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-cyan-200/25 bg-cyan-300/[0.12] px-4 text-xs font-bold text-cyan-50 shadow-[0_10px_28px_-18px_rgba(34,211,238,0.9)] transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.18] disabled:cursor-wait disabled:opacity-45"
                      >
                        {oauthBusy && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                        {oauthBusy ? 'Connecting…' : oauth?.configured ? 'Reconnect Google' : 'Continue with Google'}
                        {!oauthBusy && <ArrowIcon />}
                      </button>
                    )}
                    {hasApiKeyAuth && (
                      <button
                        type="button"
                        onClick={() => setApiKeyOpen((open) => !open)}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-xs font-bold text-slate-200 transition hover:bg-white/[0.08]"
                      >
                        {apiKeyOpen ? 'Hide API key' : provider === 'google' ? 'Use Gemini API key' : 'Use API key'}
                      </button>
                    )}
                  </div>

                  {apiKeyOpen && hasApiKeyAuth && (
                    <div className="mx-auto mt-4 max-w-md rounded-xl border border-white/[0.09] bg-white/[0.025] p-3">
                      <label className="block text-xs font-medium text-slate-200">
                        Gemini API key
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="Paste your API key"
                          autoComplete="new-password"
                          className="mt-2 w-full rounded-xl border border-white/[0.10] bg-slate-950/55 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                        />
                      </label>
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={saving || !apiKey.trim()}
                          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.12] px-3.5 text-xs font-bold text-cyan-50 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.18] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {saving && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                          {saving ? 'Saving…' : 'Save API key'}
                        </button>
                        {activeProviderStatus?.apiKeyUrl && (
                          <a
                            href={activeProviderStatus?.apiKeyUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] font-semibold text-cyan-100 underline decoration-cyan-200/30 underline-offset-4"
                          >
                            Get a key <ExternalLinkIcon />
                          </a>
                        )}
                      </div>
                      <p className="mt-2 text-center text-[10px] text-slate-500">Stored locally.</p>
                    </div>
                  )}

                  {isGoogleVertex && gcloud?.supported && !gcloud.configured && (gcloudMissing.length > 0 || gcloud.setupScript || gcloud.commands?.length) && (
                    <details className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
                      <summary className="cursor-pointer font-semibold text-slate-300">Advanced setup</summary>
                      <div className="mt-3 space-y-2">
                        {gcloud.setupScript && (
                          <div className="rounded-lg border border-white/[0.08] bg-slate-950/50 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-slate-400">{gcloud.setupScript.label}</p>
                              <button
                                type="button"
                                onClick={() => void copyCommand(gcloud.setupScript!.command)}
                                className="rounded border border-white/15 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-white/[0.08]"
                              >
                                {copiedCommand === gcloud.setupScript.command ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div className="break-all font-mono text-[10px] text-slate-100">{gcloud.setupScript.command}</div>
                          </div>
                        )}
                        {gcloud.commands?.length ? (
                          <div className="rounded-lg border border-white/[0.08] bg-slate-950/50 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-slate-400">Manual alternative</p>
                              <button
                                type="button"
                                onClick={() => void copyCommand(gcloud.commands?.join('\n') || '')}
                                className="rounded border border-white/15 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-white/[0.08]"
                              >
                                {copiedCommand === (gcloud.commands?.join('\n') || '') ? 'Copied' : 'Copy all'}
                              </button>
                            </div>
                            <div className="font-mono text-[10px] text-slate-100">
                              {gcloud.commands.map((command) => <div key={command}>{command}</div>)}
                            </div>
                          </div>
                        ) : null}
                        {!gcloud.installed && gcloud.installUrl && (
                          <a href={gcloud.installUrl} target="_blank" rel="noreferrer" className="inline-flex text-[10px] font-semibold text-cyan-100 underline decoration-cyan-200/30 underline-offset-4">
                            Install Google CLI <ExternalLinkIcon />
                          </a>
                        )}
                      </div>
                    </details>
                  )}
                </section>
              )}

          {subscriptionAuth?.supported && (
            <div className="mb-5 rounded-2xl border border-violet-300/15 bg-violet-950/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-violet-100">{subscriptionAuth.label || 'Subscription sign-in'}</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {subscriptionAuth.configured
                      ? 'An OpenClaw-compatible Claude Code session was detected on this machine.'
                      : 'OpenClaw can use a Claude Code subscription already signed in on this machine.'}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${subscriptionAuth.configured ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100' : 'border-amber-300/30 bg-amber-400/10 text-amber-100'}`}>
                  {subscriptionAuth.configured ? 'Detected' : 'Optional'}
                </span>
              </div>
              {!subscriptionAuth.configured && subscriptionAuth.setupCommand && (
                <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/50 px-2.5 py-2 font-mono text-[10px] text-violet-100">
                  {subscriptionAuth.setupCommand}
                </div>
              )}
              {subscriptionAuth.docs && (
                <a
                  href={subscriptionAuth.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-[11px] font-semibold text-violet-100 underline decoration-violet-300/40 underline-offset-4"
                >
                  Read Claude / OpenClaw setup guidance
                </a>
              )}
            </div>
          )}

          {gcloud?.supported && !isGoogleProvider && (
            <div className="mb-5 rounded-2xl border border-sky-300/15 bg-sky-950/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-sky-100">Google Cloud sign-in</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {gcloud.configured
                      ? `Ready${gcloud.account ? ` as ${gcloud.account}` : ''}${gcloud.projectId ? ` on ${gcloud.projectId}` : ''}${gcloudCredentialLabel ? ` via ${gcloudCredentialLabel}` : ''}.`
                      : 'One local Google sign-in unlocks every Vertex model.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshProviderStatus(true)}
                    disabled={gcloudRefreshing}
                    className="rounded-lg border border-sky-300/35 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100 disabled:opacity-45"
                  >
                    {gcloudRefreshing ? 'Checking...' : 'Refresh'}
                  </button>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                      gcloud.configured
                        ? 'border-emerald-300/45 bg-emerald-900/30 text-emerald-100'
                        : 'border-amber-300/45 bg-amber-900/30 text-amber-100'
                    }`}
                  >
                    {gcloudRefreshing ? 'Checking' : gcloud.configured ? 'Ready' : 'Setup Needed'}
                  </span>
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-[11px] text-slate-300 sm:grid-cols-2">
                <span>Project: {gcloud.projectId || 'not set'}</span>
                <span>Location: {gcloud.location || 'us-central1'}</span>
              </div>
              <p className="mt-2 text-[11px] text-slate-300">
                Vertex can use the Google sign-in above or Google Application Default Credentials (ADC). You do not need to paste a client secret or API key for Vertex. After one successful sign-in, select any <code className="font-mono text-sky-100">google-vertex/…</code> model.
              </p>
              {!gcloud.configured && (
                <div className="mt-3 space-y-2">
                  {gcloudMissing.length > 0 && (
                    <p className="text-[11px] text-amber-100">{gcloudMissing[0]}</p>
                  )}
                  {gcloud.setupScript && (
                    <div className="rounded-lg border border-sky-300/20 bg-sky-950/35 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-100">ADC fallback: {gcloud.setupScript.label}</p>
                        <button
                          type="button"
                          onClick={() => void copyCommand(gcloud.setupScript!.command)}
                          className="rounded border border-sky-300/25 px-2 py-1 text-[10px] font-semibold text-sky-100 hover:bg-sky-300/[0.10]"
                        >
                          {copiedCommand === gcloud.setupScript.command ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="break-all font-mono text-[10px] text-slate-100">{gcloud.setupScript.command}</div>
                    </div>
                  )}
                  {gcloud.commands?.length ? (
                    <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2 text-[10px] text-slate-200">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="font-sans text-slate-400">Manual alternative</p>
                          <button
                            type="button"
                            onClick={() => void copyCommand(gcloud.commands?.join('\n') || '')}
                            className="rounded border border-white/15 px-2 py-1 font-sans text-[10px] font-semibold text-slate-200 hover:bg-white/[0.08]"
                          >
                            {copiedCommand === (gcloud.commands?.join('\n') || '') ? 'Copied' : 'Copy all'}
                          </button>
                        </div>
                      <div className="font-mono">
                        {gcloud.commands.map((command) => (
                          <div key={command}>{command}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {!gcloud.installed && gcloud.installUrl && (
                    <a
                      href={gcloud.installUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-lg border border-sky-300/35 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100"
                    >
                      Install Google CLI
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {hasApiKeyAuth && !isGoogleProvider && (
            <section className="mb-5 rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Alternative method</p>
                  <h4 className="mt-1 text-sm font-semibold text-slate-100">Use an API key</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Best for automation, shared environments, or usage billed directly to your provider account.</p>
                </div>
                <span className="rounded-full border border-white/[0.10] bg-white/[0.035] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Local only</span>
              </div>
              <label className="block text-xs font-medium text-slate-200">
                {provider === 'anthropic' ? 'Anthropic API key' : provider === 'openai' ? 'OpenAI API key' : provider === 'google' ? 'Gemini API key' : 'API key'}
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste your secret key"
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-white/[0.10] bg-slate-950/55 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-200/40 focus:ring-2 focus:ring-cyan-300/[0.08]"
                />
              </label>
              <div className="mt-3 flex flex-col gap-1 text-[11px] leading-5 text-slate-500 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <p>Environment variable: <span className="font-mono text-slate-400">{envKeys.join(', ')}</span></p>
                <p className="text-left sm:max-w-[55%] sm:text-right">Stored locally and injected into the runtime. Never shown after save.</p>
              </div>
            </section>
          )}

          {status && (
            <div className={`mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5 ${statusTone === 'error' ? 'border-rose-300/20 bg-rose-400/[0.06] text-rose-100' : statusTone === 'success' ? 'border-emerald-300/20 bg-emerald-400/[0.06] text-emerald-100' : 'border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-100'}`} role="status" aria-live="polite">
              <span className={`mt-1 size-1.5 shrink-0 rounded-full ${statusTone === 'error' ? 'bg-rose-300' : statusTone === 'success' ? 'bg-emerald-300' : 'bg-cyan-300'}`} />
              <span>{status}</span>
            </div>
          )}

          {hasApiKeyAuth && !isGoogleProvider && (
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200/25 bg-cyan-300/[0.12] px-4 text-xs font-bold text-cyan-50 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.18] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving && <span className="size-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />}
                {saving ? 'Saving key...' : 'Save API key'}
              </button>
            </div>
          )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

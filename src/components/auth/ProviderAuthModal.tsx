import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface AuthProviderOAuthStatus {
  supported: boolean
  configured: boolean
  available: boolean
  missing?: string[]
  docs?: string
  redirectUri?: string
  projectId?: string
  accountId?: string
  email?: string
  expiresAt?: number
  refreshAvailable?: boolean
  clientIdEnvKeys?: string[]
  projectIdEnvKeys?: string[]
}

interface AuthProviderGcloudStatus {
  supported: boolean
  installed: boolean
  authenticated: boolean
  configured: boolean
  projectId?: string
  location?: string
  account?: string
  missing?: string[]
  installUrl?: string
  commands?: string[]
}

interface AuthProviderStatus {
  provider: string
  configured: boolean
  envKeys: string[]
  label?: string
  oauth?: AuthProviderOAuthStatus
  gcloud?: AuthProviderGcloudStatus
}

interface ProviderAuthModalProps {
  isOpen: boolean
  provider: string
  envKeys: string[]
  providerStatus?: AuthProviderStatus | null
  onClose: () => void
  onSave: (apiKey: string) => Promise<void>
  onConnected?: () => Promise<void> | void
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  deepseek: 'DeepSeek',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'openai-codex': 'OpenAI Codex',
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function formatOAuthExpiry(expiresAt?: number, refreshAvailable = false) {
  if (!expiresAt) return refreshAvailable ? 'refresh token available' : 'not reported'
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return refreshAvailable ? 'expired, refresh available' : 'expired'
  const minutes = Math.round(deltaMs / 60000)
  if (minutes < 60) return `${minutes} min remaining`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hr remaining`
  return `${Math.round(hours / 24)} days remaining`
}

function oauthHealth(expiresAt?: number, refreshAvailable = false) {
  if (!expiresAt) return { label: refreshAvailable ? 'Refreshable' : 'Connected', tone: 'emerald' as const }
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) return refreshAvailable ? { label: 'Refreshable', tone: 'amber' as const } : { label: 'Expired', tone: 'rose' as const }
  if (deltaMs < 15 * 60 * 1000) return { label: refreshAvailable ? 'Refresh Soon' : 'Expiring', tone: 'amber' as const }
  return { label: 'Ready', tone: 'emerald' as const }
}

async function fetchJsonWithTimeout<T>(url: string, options: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    const data = (await response.json().catch(() => ({}))) as T
    return { response, data }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function ProviderAuthModal({ isOpen, provider, envKeys, providerStatus, onClose, onSave, onConnected }: ProviderAuthModalProps) {
  const [apiKey, setApiKey] = useState('')
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

  const activeProviderStatus = liveProviderStatus || providerStatus
  const label = activeProviderStatus?.label || providerLabels[provider] || provider

  const refreshProviderStatus = useCallback(async (announceReady = false) => {
    setGcloudRefreshing(true)
    try {
      const { response, data } = await fetchJsonWithTimeout<{ providers?: AuthProviderStatus[]; error?: string; detail?: string }>(
        '/api/auth/providers?refresh=1',
        { cache: 'no-store' },
        30000,
      )
      if (!response.ok) throw new Error(data.detail || data.error || 'Could not refresh provider status.')
      const next = data.providers?.find((entry) => entry.provider === provider) || null
      if (next) {
        setLiveProviderStatus(next)
        if (next.configured) {
          if (announceReady) {
            const readyLabel = next.label || providerLabels[provider] || provider
            const account = next.gcloud?.account ? ` as ${next.gcloud.account}` : ''
            const project = next.gcloud?.projectId ? ` on ${next.gcloud.projectId}` : ''
            setStatus(`${readyLabel} is ready${account}${project}.`)
          }
          await onConnected?.()
        } else if (provider === 'google-vertex') {
          setStatus(next.gcloud?.missing?.filter(Boolean)[0] || '')
        }
      }
    } catch (error) {
      setStatus(`Refresh failed: ${error}`)
    } finally {
      setGcloudRefreshing(false)
    }
  }, [onConnected, provider])

  useEffect(() => {
    if (!isOpen) return
    setApiKey('')
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
    if (provider === 'google-vertex') void refreshProviderStatus(false)
  }, [isOpen, provider, activeProviderStatus?.oauth?.projectId, refreshProviderStatus])

  if (!isOpen) return null

  const oauth = activeProviderStatus?.oauth
  const oauthSupported = Boolean(oauth?.supported)
  const oauthReady = Boolean(oauth?.available)
  const oauthMissing = oauth?.missing?.filter(Boolean) || []
  const oauthState = oauthHealth(oauth?.expiresAt, oauth?.refreshAvailable)
  const gcloud = activeProviderStatus?.gcloud
  const gcloudMissing = gcloud?.missing?.filter(Boolean) || []
  const hasApiKeyAuth = envKeys.length > 0

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    setStatus('')
    try {
      await onSave(apiKey.trim())
      await onConnected?.()
      setStatus('Saved. You can close this window.')
    } catch (error) {
      setStatus(`Failed to save: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const pollOAuthSession = async (sessionId: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await sleep(1500)
      const { response, data } = await fetchJsonWithTimeout<{
        status?: 'pending' | 'complete' | 'error'
        error?: string
        authorizationUrl?: string
        manualInputRequired?: boolean
        manualPrompt?: string
        result?: { email?: string; projectId?: string }
      }>(`/api/auth/providers/${provider}/oauth/session/${sessionId}`, { cache: 'no-store' }, 10000)
      if (!response.ok) throw new Error(data.error || 'OAuth status check failed.')
      if (data.authorizationUrl) setAuthorizationUrl(data.authorizationUrl)
      if (data.manualInputRequired) {
        setManualSessionId(sessionId)
        setManualPrompt(data.manualPrompt || 'Paste the authorization code or full redirect URL.')
      }
      if (data.status === 'complete') {
        await onConnected?.()
        const connectedAs = data.result?.email ? ` as ${data.result.email}` : ''
        setStatus(`OAuth connected${connectedAs}. You can close this window.`)
        setManualSessionId('')
        setManualPrompt('')
        setManualCode('')
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
      const { response, data } = await fetchJsonWithTimeout<{
        ok?: boolean
        sessionId?: string
        authorizationUrl?: string
        error?: string
        detail?: string
        openedBrowser?: boolean
      }>(`/api/auth/providers/${provider}/oauth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectId.trim() || undefined }),
      }, 20000)
      if (!response.ok || !data.ok || !data.sessionId) {
        throw new Error(data.detail || data.error || 'Could not start OAuth.')
      }
      if (data.authorizationUrl) setAuthorizationUrl(data.authorizationUrl)
      setStatus(data.openedBrowser ? `Browser opened. Finish ${label} sign-in there.` : 'Open the authorization link to continue.')
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
      const { response, data } = await fetchJsonWithTimeout<{ error?: string; detail?: string }>(
        `/api/auth/providers/${provider}/oauth/session/${manualSessionId}/manual`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: manualCode.trim() }),
        },
        15000,
      )
      if (!response.ok) throw new Error(data.detail || data.error || 'Could not submit authorization code.')
      setManualCode('')
      setManualPrompt('')
      setStatus('Authorization submitted. Finishing sign-in.')
    } catch (error) {
      setStatus(`OAuth failed: ${error}`)
    } finally {
      setManualSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 10 }}
          className="w-full max-w-lg rounded-2xl border border-cyan-200/45 bg-gradient-to-b from-blue-900/95 to-slate-950/95 p-5 shadow-glow"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-heading text-2xl text-slate-100">Connect {label}</h3>
              <p className="text-xs text-cyan-100">Store local credentials for this provider.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-slate-900/60 px-3 py-1.5 text-xs text-slate-100"
            >
              Close
            </button>
          </div>

          {oauthSupported && (
            <div className="mb-4 rounded-xl border border-emerald-300/20 bg-emerald-950/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-100">OAuth</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {oauth?.configured
                      ? `Connected${oauth.email ? ` as ${oauth.email}` : oauth.accountId ? ` as ${oauth.accountId}` : ''}.`
                      : `Connect with your ${label} account.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOAuth}
                  disabled={oauthBusy || !oauthReady}
                  className="rounded-lg border border-emerald-300/35 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-45"
                >
                  {oauthBusy ? 'Waiting...' : oauth?.configured ? 'Force re-login' : 'Connect'}
                </button>
              </div>
              {oauth?.configured && (
                <div className="mt-3 grid gap-2 text-[11px] text-slate-300 sm:grid-cols-2">
                  <span
                    className={`rounded-lg border px-2.5 py-1.5 ${
                      oauthState.tone === 'rose'
                        ? 'border-rose-300/25 bg-rose-400/10 text-rose-100'
                        : oauthState.tone === 'amber'
                          ? 'border-amber-300/25 bg-amber-400/10 text-amber-100'
                          : 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
                    }`}
                  >
                    OAuth: {oauthState.label}
                  </span>
                  <span className="rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-slate-300">
                    Expiry: {formatOAuthExpiry(oauth.expiresAt, oauth.refreshAvailable)}
                  </span>
                  {oauth.email && <span className="truncate rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5">Email: {oauth.email}</span>}
                  {oauth.accountId && <span className="truncate rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5">Account: {oauth.accountId}</span>}
                </div>
              )}
              {provider === 'google' && (
                <label className="mt-3 block text-xs text-slate-200">
                  Google Cloud project
                  <input
                    type="text"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    placeholder="Optional project id"
                    className="mt-1 w-full rounded-lg bg-slate-950/70 px-3 py-2 text-slate-100"
                  />
                </label>
              )}
              {!oauthReady && oauthMissing.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-100">{oauthMissing[0]}</p>
              )}
              {(authorizationUrl || manualSessionId) && (
                <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-slate-950/45 p-2">
                  {authorizationUrl && (
                    <a
                      href={authorizationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-md border border-emerald-300/35 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100"
                    >
                      Open sign-in link
                    </a>
                  )}
                  {manualSessionId && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-slate-300">
                        {manualPrompt || 'Paste the authorization code or full redirect URL.'}
                      </p>
                      <textarea
                        value={manualCode}
                        onChange={(event) => setManualCode(event.target.value)}
                        placeholder="Authorization code or redirect URL"
                        rows={3}
                        className="w-full resize-none rounded-md border border-white/10 bg-slate-950/70 px-2.5 py-2 font-mono text-[11px] text-slate-100 outline-none focus:border-emerald-300/50"
                      />
                      <button
                        type="button"
                        onClick={handleManualSubmit}
                        disabled={manualSubmitting || !manualCode.trim()}
                        className="rounded-md border border-emerald-300/35 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 disabled:opacity-45"
                      >
                        {manualSubmitting ? 'Submitting...' : 'Submit code'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {gcloud?.supported && (
            <div className="mb-4 rounded-xl border border-sky-300/20 bg-sky-950/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-sky-100">Google Cloud CLI</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {gcloud.configured
                      ? `Ready${gcloud.account ? ` as ${gcloud.account}` : ''}${gcloud.projectId ? ` on ${gcloud.projectId}` : ''}.`
                      : 'Use gcloud authentication for Vertex AI model calls.'}
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
              {!gcloud.configured && (
                <div className="mt-3 space-y-2">
                  {gcloudMissing.length > 0 && (
                    <p className="text-[11px] text-amber-100">{gcloudMissing[0]}</p>
                  )}
                  {gcloud.commands?.length ? (
                    <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2 font-mono text-[10px] text-slate-200">
                      {gcloud.commands.map((command) => (
                        <div key={command}>{command}</div>
                      ))}
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

          {hasApiKeyAuth && (
            <>
              <label className="block text-sm text-slate-200">
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste your API key"
                  className="mt-2 w-full rounded-lg bg-slate-950/70 px-3 py-2 text-slate-100"
                />
              </label>

              <div className="mt-3 text-xs text-slate-300">
                <p>Env vars used: {envKeys.join(', ')}</p>
                <p className="mt-1">Keys are stored locally and injected into OpenClaw runtime.</p>
              </div>
            </>
          )}

          {status && <p className="mt-3 text-xs text-cyan-100">{status}</p>}

          {hasApiKeyAuth && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className="rounded-lg bg-cyan-700/40 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Key'}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

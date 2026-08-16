import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { LocalOAuthCredential } from './providerAuthService'
import type {
  AnthropicOAuthLoginCallbacks,
  AnthropicOAuthLoginResult,
} from './providerSetupService'

export type GoogleOAuthClientConfig = {
  clientId: string
  clientSecret?: string
}

// OpenClaw uses one canonical provider key, "openai", for API keys and
// ChatGPT/Codex subscription OAuth. "openai-codex" is a repaired legacy key.
export type OAuthProvider = 'google' | 'openai' | 'anthropic'
export type OAuthSessionStatus = 'pending' | 'complete' | 'error'

export type ProviderOAuthSession = {
  id: string
  provider: OAuthProvider
  purpose?: 'provider' | 'account'
  state?: string
  verifier?: string
  challenge?: string
  projectId?: string
  redirectUri?: string
  authorizationUrl: string
  status: OAuthSessionStatus
  createdAt: string
  completedAt?: string
  error?: string
  manualInputRequired?: boolean
  manualInputSubmittedAt?: string
  manualPrompt?: string
  result?: {
    email?: string
    accountId?: string
    projectId?: string
    expiresAt?: number
  }
  // Public account fields only. OAuth access and refresh tokens never belong
  // in the session object returned to the renderer.
  account?: Record<string, unknown>
}

export type OAuthLaunchResult = {
  ok: boolean
  detail?: string
}

export type OAuthStartResult = {
  session: ProviderOAuthSession
  launched: OAuthLaunchResult
}

export type OpenAICodexAuthorizationFlow = {
  verifier: string
  redirectUri: string
  state: string
  url: string
}

export type OpenAICodexTokenExchangeResult =
  | {
      type: 'success'
      access: string
      refresh: string
      expires: number
    }
  | {
      type: 'failed'
      status?: number
      message: string
    }

export type OpenAICodexRefreshResult = {
  access: string
  refresh: string
  expires: number
  accountId?: string
  idToken?: string
}

export type AnthropicOAuthRefreshResult = AnthropicOAuthLoginResult

export type OAuthCallbackServerSnapshot = {
  google: OAuthCallbackServerState
  openAiCodex: OAuthCallbackServerState
}

type OAuthCallbackServerState = {
  listening: boolean
  address: string | null
  port: number | null
}

type PendingAnthropicOAuthLogin = {
  abortController: AbortController
  resolveManualInput: (input: string) => void
  rejectManualInput: (error: Error) => void
}

type FetchLike = typeof fetch

export type OAuthCallbackServiceOptions = {
  createOpenAICodexAuthorizationFlow: (originator?: string) => Promise<OpenAICodexAuthorizationFlow>
  exchangeGoogleOAuthCodeForTokens?: (code: string, verifier: string, projectId?: string) => Promise<LocalOAuthCredential>
  exchangeOpenAICodexAuthorizationCode: (
    code: string,
    verifier: string,
    redirectUri?: string,
  ) => Promise<OpenAICodexTokenExchangeResult>
  anthropicOAuthRedirectUri?: string
  loginAnthropicOAuth?: (callbacks: AnthropicOAuthLoginCallbacks) => Promise<AnthropicOAuthLoginResult>
  refreshAnthropicOAuthToken?: (refreshToken: string) => Promise<AnthropicOAuthRefreshResult>
  fetch?: FetchLike
  googleCallbackPort?: number
  googleAccountOAuthScopes?: string[]
  googleOAuthRedirectUri: string
  googleOAuthScopes: string[]
  authenticateGoogleAccount?: (accessToken: string) => Promise<{ account: Record<string, unknown> }>
  isShuttingDown: () => boolean
  now?: () => Date
  openAiCodexCallbackPort?: number
  openAiCodexOAuthRedirectUri: string
  openAiCodexOAuthScopes: string[]
  openExternalAuthUrl: (url: string) => Promise<OAuthLaunchResult>
  persistProviderOAuth: (provider: OAuthProvider, oauth: LocalOAuthCredential) => Promise<unknown>
  redactSensitiveText?: (value: string) => string
  refreshOpenAICodexToken: (refreshToken: string) => Promise<OpenAICodexRefreshResult>
  resolveGoogleOAuthClientConfig: () => GoogleOAuthClientConfig
  resolveGoogleProjectId: (input?: string) => string
  sessionTimeoutMs?: number
  warn?: (message: string, error: unknown) => void
}

const DEFAULT_OAUTH_SESSION_TIMEOUT_MS = 10 * 60 * 1000

function defaultRedactSensitiveText(value: string) {
  return value
}

function defaultWarn(message: string, error: unknown) {
  console.warn(message, error)
}

function callbackPortFromRedirectUri(redirectUri: string, fallback: number) {
  try {
    const parsed = new URL(redirectUri)
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    return Number.isFinite(port) && port >= 0 ? port : fallback
  } catch {
    return fallback
  }
}

function escapeHtml(value: string) {
  return value.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char] || char)
}

function generatePkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function serverState(server: Server | null): OAuthCallbackServerState {
  const address = server?.address()
  if (!address || typeof address === 'string') {
    return { listening: Boolean(server?.listening), address: typeof address === 'string' ? address : null, port: null }
  }
  return {
    listening: Boolean(server?.listening),
    address: address.address,
    port: address.port,
  }
}

function safeErrorText(error: unknown, redactSensitiveText: (value: string) => string) {
  const message = error instanceof Error && error.message ? error.message : String(error)
  return redactSensitiveText(message)
}

async function closeLifecycleHttpServer(
  server: Server | null,
  label: string,
  reason: string,
  warn: (message: string, error: unknown) => void,
  timeoutMs = 1000,
): Promise<boolean> {
  if (!server) return false
  const closable = server as Server & {
    closeAllConnections?: () => void
    closeIdleConnections?: () => void
  }
  if (!closable.listening) {
    try {
      closable.closeAllConnections?.()
      closable.closeIdleConnections?.()
    } catch {
      // Best-effort cleanup for a server that is already closing.
    }
    return false
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (closed: boolean, error?: Error & { code?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(forceCloseTimer)
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        warn(`[control-center] ${reason}: ${label} close warning:`, error)
      }
      resolve(closed)
    }
    const forceCloseTimer = setTimeout(() => {
      try {
        closable.closeIdleConnections?.()
        closable.closeAllConnections?.()
      } catch {
        // The server may already be closing.
      }
      finish(true)
    }, timeoutMs)
    forceCloseTimer.unref?.()

    try {
      closable.close((error?: Error & { code?: string }) => finish(true, error))
    } catch (error) {
      finish(false, error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function createOAuthCallbackService(options: OAuthCallbackServiceOptions) {
  const oauthSessions = new Map<string, ProviderOAuthSession>()
  const redactSensitiveText = options.redactSensitiveText ?? defaultRedactSensitiveText
  const warn = options.warn ?? defaultWarn
  const now = options.now ?? (() => new Date())
  const fetchImpl = options.fetch ?? fetch
  const sessionTimeoutMs = Math.max(1, options.sessionTimeoutMs ?? DEFAULT_OAUTH_SESSION_TIMEOUT_MS)
  const googleCallbackPort = options.googleCallbackPort ?? callbackPortFromRedirectUri(options.googleOAuthRedirectUri, 8085)
  const openAiCodexCallbackPort = options.openAiCodexCallbackPort ?? callbackPortFromRedirectUri(options.openAiCodexOAuthRedirectUri, 1455)

  let googleOAuthCallbackServer: Server | null = null
  let googleOAuthCallbackServerStarting: Promise<void> | null = null
  let openAICodexOAuthCallbackServer: Server | null = null
  let openAICodexOAuthCallbackServerStarting: Promise<void> | null = null
  const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingAnthropicOAuthLogins = new Map<string, PendingAnthropicOAuthLogin>()

  function completeAt() {
    return now().toISOString()
  }

  function failSession(session: ProviderOAuthSession, error: unknown) {
    session.status = 'error'
    session.error = safeErrorText(error, redactSensitiveText)
    session.completedAt = completeAt()
    clearSessionTimeout(session.id)
  }

  function cancelPendingAnthropicOAuthLogin(sessionId: string, reason: string) {
    const pending = pendingAnthropicOAuthLogins.get(sessionId)
    if (!pending) return false
    pending.abortController.abort()
    pending.rejectManualInput(new Error(reason))
    pendingAnthropicOAuthLogins.delete(sessionId)
    return true
  }

  function cancelOAuthSession(session: ProviderOAuthSession, reason = 'OAuth sign-in was cancelled. Start it again when you are ready.') {
    if (session.status !== 'pending') return false
    cancelPendingAnthropicOAuthLogin(session.id, reason)
    failSession(session, reason)
    return true
  }

  function clearSessionTimeout(sessionId: string) {
    const timer = sessionTimeouts.get(sessionId)
    if (!timer) return
    clearTimeout(timer)
    sessionTimeouts.delete(sessionId)
  }

  function armSessionTimeout(session: ProviderOAuthSession) {
    clearSessionTimeout(session.id)
    const timer = setTimeout(() => {
      if (session.status !== 'pending') return
      session.status = 'error'
      session.error = `OAuth timed out after ${Math.round(sessionTimeoutMs / 1000)} seconds. Start the connection again.`
      session.completedAt = completeAt()
      sessionTimeouts.delete(session.id)
      cancelPendingAnthropicOAuthLogin(session.id, session.error)
    }, sessionTimeoutMs)
    timer.unref?.()
    sessionTimeouts.set(session.id, timer)
  }

  function clearAllSessionTimeouts() {
    for (const timer of sessionTimeouts.values()) clearTimeout(timer)
    sessionTimeouts.clear()
  }

  function failPendingOAuthSessionsForShutdown(reason: string): number {
    let failed = 0
    const completedAt = completeAt()
    for (const session of oauthSessions.values()) {
      if (session.status !== 'pending') continue
      session.status = 'error'
      session.error = `OAuth cancelled during ${reason}.`
      session.completedAt = completedAt
      clearSessionTimeout(session.id)
      cancelPendingAnthropicOAuthLogin(session.id, session.error)
      failed += 1
    }
    return failed
  }

  function buildGoogleOAuthAuthorizationUrl(challenge: string, state: string, scopes = options.googleOAuthScopes) {
    const { clientId } = options.resolveGoogleOAuthClientConfig()
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: options.googleOAuthRedirectUri,
      scope: scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent select_account',
    }).toString()}`
  }

  async function fetchGoogleUserInfo(accessToken: string): Promise<{ email?: string }> {
    const response = await fetchImpl('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return {}
    const data = await response.json().catch(() => ({})) as { email?: string }
    return { ...(data.email ? { email: data.email } : {}) }
  }

  async function exchangeGoogleOAuthCodeForTokens(code: string, verifier: string, projectId?: string): Promise<LocalOAuthCredential> {
    if (options.exchangeGoogleOAuthCodeForTokens) {
      return options.exchangeGoogleOAuthCodeForTokens(code, verifier, projectId)
    }

    const { clientId, clientSecret } = options.resolveGoogleOAuthClientConfig()
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: options.googleOAuthRedirectUri,
      code_verifier: verifier,
    })
    if (clientSecret) body.set('client_secret', clientSecret)

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body,
    })
    const data = await response.json().catch(() => ({})) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
      error?: string
      error_description?: string
    }
    if (!response.ok || !data.access_token) {
      throw new Error(redactSensitiveText(data.error_description || data.error || `Google token exchange failed (${response.status})`))
    }

    const user = await fetchGoogleUserInfo(data.access_token).catch((): { email?: string } => ({}))
    const expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000 - 300000
    return {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      expiresAt,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope?.split(/\s+/).filter(Boolean) || options.googleOAuthScopes,
      ...(user.email ? { email: user.email } : {}),
      ...(projectId ? { projectId } : {}),
    }
  }

  async function refreshGoogleOAuthCredential(oauth: LocalOAuthCredential): Promise<LocalOAuthCredential> {
    const refreshToken = oauth.refreshToken?.trim()
    if (!refreshToken) throw new Error('Google OAuth refresh token is missing. Reconnect Google.')

    const { clientId, clientSecret } = options.resolveGoogleOAuthClientConfig()
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    if (clientSecret) body.set('client_secret', clientSecret)

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body,
    })
    const data = await response.json().catch(() => ({})) as {
      access_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
      error?: string
      error_description?: string
    }
    if (!response.ok || !data.access_token) {
      throw new Error(redactSensitiveText(data.error_description || data.error || `Google token refresh failed (${response.status})`))
    }

    return {
      ...oauth,
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000 - 300000,
      tokenType: data.token_type || oauth.tokenType || 'Bearer',
      scope: data.scope?.split(/\s+/).filter(Boolean) || oauth.scope || options.googleOAuthScopes,
    }
  }

  async function refreshOpenAICodexOAuthCredential(oauth: LocalOAuthCredential): Promise<LocalOAuthCredential> {
    const refreshToken = oauth.refreshToken?.trim()
    if (!refreshToken) throw new Error('OpenAI Codex OAuth refresh token is missing. Reconnect OpenAI Codex.')

    const refreshed = await options.refreshOpenAICodexToken(refreshToken)
    return {
      ...oauth,
      accessToken: refreshed.access,
      refreshToken: refreshed.refresh || oauth.refreshToken,
      expiresAt: refreshed.expires,
      tokenType: 'Bearer',
      scope: oauth.scope || options.openAiCodexOAuthScopes,
      ...(refreshed.accountId ? { accountId: refreshed.accountId } : {}),
      ...(refreshed.idToken ? { idToken: refreshed.idToken } : {}),
    }
  }

  async function refreshAnthropicOAuthCredential(oauth: LocalOAuthCredential): Promise<LocalOAuthCredential> {
    const refreshToken = oauth.refreshToken?.trim()
    if (!refreshToken) throw new Error('Anthropic OAuth refresh token is missing. Reconnect Anthropic.')
    if (!options.refreshAnthropicOAuthToken) throw new Error('Anthropic OAuth refresh is not available in this build.')

    const refreshed = await options.refreshAnthropicOAuthToken(refreshToken)
    return {
      ...oauth,
      accessToken: refreshed.access,
      refreshToken: refreshed.refresh || oauth.refreshToken,
      expiresAt: refreshed.expires,
      tokenType: 'Bearer',
    }
  }

  async function ensureGoogleOAuthCallbackServer() {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    if (googleOAuthCallbackServer?.listening) return
    if (googleOAuthCallbackServerStarting) return googleOAuthCallbackServerStarting

    googleOAuthCallbackServerStarting = new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', options.googleOAuthRedirectUri)
          if (requestUrl.pathname !== '/oauth2callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Not found')
            return
          }

          const state = requestUrl.searchParams.get('state') || ''
          const code = requestUrl.searchParams.get('code') || ''
          const error = requestUrl.searchParams.get('error') || ''
          const session = Array.from(oauthSessions.values()).find((entry) => entry.provider === 'google' && entry.state === state)
          if (!session) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h1>OAuth session not found</h1><p>Return to Automnia and start the connection again.</p>')
            return
          }

          if (error) throw new Error(error)
          if (!code) throw new Error('Google did not return an authorization code.')
          if (!session.verifier) throw new Error('Google OAuth verifier missing. Restart the connection.')

          const credential = await exchangeGoogleOAuthCodeForTokens(code, session.verifier, session.projectId)
          if (session.purpose === 'account') {
            if (!options.authenticateGoogleAccount) {
              throw new Error('Google account sign-in is not configured in this build.')
            }
            const accessToken = credential.accessToken?.trim()
            if (!accessToken) throw new Error('Google sign-in did not return an account token.')
            const account = await options.authenticateGoogleAccount(accessToken)
            session.account = account.account
          } else {
            await options.persistProviderOAuth('google', credential)
          }
          session.status = 'complete'
          session.completedAt = completeAt()
          clearSessionTimeout(session.id)
          session.result = {
            ...(credential.email ? { email: credential.email } : {}),
            ...(credential.projectId ? { projectId: credential.projectId } : {}),
            ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h1>Google connected</h1><p>You can close this window and return to Automnia.</p>')
        } catch (err) {
          const message = safeErrorText(err, redactSensitiveText)
          const state = new URL(req.url || '/', options.googleOAuthRedirectUri).searchParams.get('state') || ''
          const session = Array.from(oauthSessions.values()).find((entry) => entry.provider === 'google' && entry.state === state)
          if (session) failSession(session, message)
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<h1>Google connection failed</h1><p>${escapeHtml(message)}</p>`)
        }
      })

      server.once('close', () => {
        if (googleOAuthCallbackServer === server) googleOAuthCallbackServer = null
      })
      server.once('error', (error) => {
        if (googleOAuthCallbackServer === server) googleOAuthCallbackServer = null
        googleOAuthCallbackServerStarting = null
        reject(error)
      })
      server.listen(googleCallbackPort, '127.0.0.1', () => {
        googleOAuthCallbackServerStarting = null
        if (options.isShuttingDown()) {
          server.close(() => resolve())
          return
        }
        googleOAuthCallbackServer = server
        resolve()
      })
    })

    return googleOAuthCallbackServerStarting
  }

  async function startGoogleOAuthSessionWithScopes(
    projectId: string | undefined,
    purpose: 'provider' | 'account',
    scopes: string[],
  ): Promise<OAuthStartResult> {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    const id = randomUUID()
    const state = randomBytes(24).toString('base64url')
    const { verifier, challenge } = generatePkcePair()
    const authorizationUrl = buildGoogleOAuthAuthorizationUrl(challenge, state, scopes)
    const resolvedProjectId = purpose === 'provider' ? options.resolveGoogleProjectId(projectId) : ''
    const session: ProviderOAuthSession = {
      id,
      provider: 'google',
      purpose,
      state,
      verifier,
      challenge,
      authorizationUrl,
      redirectUri: options.googleOAuthRedirectUri,
      status: 'pending',
      createdAt: completeAt(),
      ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
    }
    oauthSessions.set(id, session)
    armSessionTimeout(session)
    try {
      await ensureGoogleOAuthCallbackServer()
    } catch (error) {
      failSession(session, error)
      throw new Error(session.error || 'Failed to start Google OAuth callback server.')
    }
    if (options.isShuttingDown()) {
      failSession(session, 'OAuth cancelled during Control Center shutdown.')
      throw new Error('Control Center is shutting down.')
    }
    const launched = await options.openExternalAuthUrl(authorizationUrl).catch((error) => ({ ok: false, detail: safeErrorText(error, redactSensitiveText) }))
    return { session, launched }
  }

  async function startGoogleOAuthSession(projectId?: string): Promise<OAuthStartResult> {
    return startGoogleOAuthSessionWithScopes(projectId, 'provider', options.googleOAuthScopes)
  }

  async function startGoogleAccountOAuthSession(): Promise<OAuthStartResult> {
    return startGoogleOAuthSessionWithScopes(
      undefined,
      'account',
      options.googleAccountOAuthScopes?.length ? options.googleAccountOAuthScopes : ['openid', 'email', 'profile'],
    )
  }

  function parseOpenAICodexAuthorizationInput(input: string): { code: string; state?: string } {
    const trimmed = input.trim()
    if (!trimmed) throw new Error('Authorization code is empty.')

    const fromSearchParams = (params: URLSearchParams) => {
      const code = params.get('code')?.trim()
      const state = params.get('state')?.trim()
      return code ? { code, ...(state ? { state } : {}) } : null
    }

    try {
      const parsed = fromSearchParams(new URL(trimmed).searchParams)
      if (parsed) return parsed
    } catch {
      // Plain codes and query-string fragments are handled below.
    }

    if (trimmed.includes('code=') || trimmed.includes('state=')) {
      const parsed = fromSearchParams(new URLSearchParams(trimmed.replace(/^\?/, '')))
      if (parsed) return parsed
    }

    return { code: trimmed }
  }

  function resolveOpenAICodexAccountIdFromAccessToken(accessToken: string) {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return undefined
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>
      const auth = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined
      const accountId = auth?.chatgpt_account_id
      return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined
    } catch {
      return undefined
    }
  }

  async function completeOpenAICodexOAuthSession(session: ProviderOAuthSession, code: string, state?: string) {
    try {
      if (session.status !== 'pending') throw new Error(`OAuth session is already ${session.status}.`)
      if (!session.verifier) throw new Error('OpenAI Codex OAuth verifier missing. Restart the connection.')
      if (state && session.state && state !== session.state) throw new Error('State mismatch')

      const result = await options.exchangeOpenAICodexAuthorizationCode(code, session.verifier, session.redirectUri || options.openAiCodexOAuthRedirectUri)
      if (result.type !== 'success') throw new Error(result.message || 'OpenAI Codex token exchange failed.')

      const accountId = resolveOpenAICodexAccountIdFromAccessToken(result.access)
      const credential: LocalOAuthCredential = {
        accessToken: result.access,
        refreshToken: result.refresh,
        expiresAt: result.expires,
        tokenType: 'Bearer',
        scope: options.openAiCodexOAuthScopes,
        ...(accountId ? { accountId } : {}),
      }
      await options.persistProviderOAuth('openai', credential)
      session.status = 'complete'
      session.manualInputRequired = false
      session.completedAt = completeAt()
      clearSessionTimeout(session.id)
      session.result = {
        ...(credential.accountId ? { accountId: credential.accountId } : {}),
        ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
      }
      return credential
    } catch (error) {
      failSession(session, error)
      throw new Error(session.error || 'OpenAI Codex OAuth failed.')
    }
  }

  async function ensureOpenAICodexOAuthCallbackServer() {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    if (openAICodexOAuthCallbackServer?.listening) return
    if (openAICodexOAuthCallbackServerStarting) return openAICodexOAuthCallbackServerStarting

    openAICodexOAuthCallbackServerStarting = new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', options.openAiCodexOAuthRedirectUri)
          if (requestUrl.pathname !== '/auth/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Not found')
            return
          }

          const state = requestUrl.searchParams.get('state') || ''
          const code = requestUrl.searchParams.get('code') || ''
          const error = requestUrl.searchParams.get('error') || ''
          const session = Array.from(oauthSessions.values()).find(
            (entry) => entry.provider === 'openai' && entry.state === state,
          )
          if (!session) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h1>OAuth session not found</h1><p>Return to Automnia and start the connection again.</p>')
            return
          }

          if (error) throw new Error(error)
          if (!code) throw new Error('OpenAI did not return an authorization code.')

          await completeOpenAICodexOAuthSession(session, code, state)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h1>OpenAI Codex connected</h1><p>You can close this window and return to Automnia.</p>')
        } catch (err) {
          const message = safeErrorText(err, redactSensitiveText)
          const state = new URL(req.url || '/', options.openAiCodexOAuthRedirectUri).searchParams.get('state') || ''
          const session = Array.from(oauthSessions.values()).find(
            (entry) => entry.provider === 'openai' && entry.state === state,
          )
          if (session) failSession(session, message)
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<h1>OpenAI Codex connection failed</h1><p>${escapeHtml(message)}</p>`)
        }
      })

      server.once('close', () => {
        if (openAICodexOAuthCallbackServer === server) openAICodexOAuthCallbackServer = null
      })
      server.once('error', (error) => {
        if (openAICodexOAuthCallbackServer === server) openAICodexOAuthCallbackServer = null
        openAICodexOAuthCallbackServerStarting = null
        reject(error)
      })
      server.listen(openAiCodexCallbackPort, '127.0.0.1', () => {
        openAICodexOAuthCallbackServerStarting = null
        if (options.isShuttingDown()) {
          server.close(() => resolve())
          return
        }
        openAICodexOAuthCallbackServer = server
        resolve()
      })
    })

    return openAICodexOAuthCallbackServerStarting
  }

  async function startOpenAICodexOAuthSession(): Promise<OAuthStartResult> {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    const id = randomUUID()
    const flow = await options.createOpenAICodexAuthorizationFlow('automnia')
    const session: ProviderOAuthSession = {
      id,
      provider: 'openai',
      state: flow.state,
      verifier: flow.verifier,
      redirectUri: flow.redirectUri,
      authorizationUrl: flow.url,
      status: 'pending',
      manualInputRequired: true,
      manualPrompt: 'Complete sign-in in the browser. If OpenAI shows a code or localhost redirect URL, paste it here.',
      createdAt: completeAt(),
    }
    oauthSessions.set(id, session)
    armSessionTimeout(session)
    try {
      await ensureOpenAICodexOAuthCallbackServer()
    } catch (error) {
      failSession(session, error)
      throw new Error(session.error || 'Failed to start OpenAI Codex OAuth callback server.')
    }
    if (options.isShuttingDown()) {
      failSession(session, 'OAuth cancelled during Control Center shutdown.')
      throw new Error('Control Center is shutting down.')
    }
    const launched = await options.openExternalAuthUrl(flow.url).catch((error) => ({ ok: false, detail: safeErrorText(error, redactSensitiveText) }))
    return { session, launched }
  }

  async function startAnthropicOAuthSession(): Promise<OAuthStartResult> {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    if (!options.loginAnthropicOAuth) throw new Error('Anthropic OAuth is not available in this build.')

    const id = randomUUID()
    const redirectUri = options.anthropicOAuthRedirectUri || 'http://localhost:53692/callback'
    const session: ProviderOAuthSession = {
      id,
      provider: 'anthropic',
      redirectUri,
      authorizationUrl: '',
      status: 'pending',
      manualInputRequired: true,
      manualPrompt: 'Complete Anthropic sign-in in the browser. If the browser is on another machine, paste the final redirect URL here.',
      createdAt: completeAt(),
    }
    oauthSessions.set(id, session)
    armSessionTimeout(session)

    let resolveAuthorization: () => void = () => undefined
    let rejectAuthorization: (error: Error) => void = () => undefined
    const authorizationReady = new Promise<void>((resolve, reject) => {
      resolveAuthorization = resolve
      rejectAuthorization = reject
    })
    let resolveManualInput: (input: string) => void = () => undefined
    let rejectManualInput: (error: Error) => void = () => undefined
    const manualInput = new Promise<string>((resolve, reject) => {
      resolveManualInput = resolve
      rejectManualInput = reject
    })
    const abortController = new AbortController()
    pendingAnthropicOAuthLogins.set(id, { abortController, resolveManualInput, rejectManualInput })

    void (async () => {
      try {
        const credentials = await options.loginAnthropicOAuth!({
          onAuth: (auth) => {
            session.authorizationUrl = auth.url
            session.manualPrompt = auth.instructions || session.manualPrompt
            resolveAuthorization()
          },
          onProgress: (message) => {
            session.manualPrompt = message
          },
          onPrompt: async (prompt) => {
            session.manualPrompt = prompt.message
            return manualInput
          },
          onManualCodeInput: async () => await manualInput,
          signal: abortController.signal,
        })
        const credential: LocalOAuthCredential = {
          accessToken: credentials.access,
          refreshToken: credentials.refresh,
          expiresAt: credentials.expires,
          tokenType: 'Bearer',
        }
        await options.persistProviderOAuth('anthropic', credential)
        session.status = 'complete'
        session.manualInputRequired = false
        session.completedAt = completeAt()
        session.result = { ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}) }
        clearSessionTimeout(session.id)
        resolveAuthorization()
      } catch (error) {
        const message = safeErrorText(error, redactSensitiveText)
        if (session.status === 'pending') failSession(session, message)
        rejectAuthorization(new Error(message))
      } finally {
        pendingAnthropicOAuthLogins.delete(id)
      }
    })()

    try {
      await authorizationReady
    } catch (error) {
      throw new Error(session.error || safeErrorText(error, redactSensitiveText))
    }
    if (session.status !== 'pending' || !session.authorizationUrl) {
      throw new Error(session.error || 'Anthropic OAuth did not return an authorization URL.')
    }
    if (options.isShuttingDown()) {
      cancelOAuthSession(session, 'OAuth cancelled during Control Center shutdown.')
      throw new Error('Control Center is shutting down.')
    }
    const launched = await options.openExternalAuthUrl(session.authorizationUrl)
      .catch((error) => ({ ok: false, detail: safeErrorText(error, redactSensitiveText) }))
    return { session, launched }
  }

  async function submitAnthropicOAuthManualInput(session: ProviderOAuthSession, input: string) {
    if (session.provider !== 'anthropic') throw new Error('OAuth session is not an Anthropic session.')
    if (session.status !== 'pending') throw new Error(`OAuth session is already ${session.status}.`)
    const pending = pendingAnthropicOAuthLogins.get(session.id)
    if (!pending) throw new Error('Anthropic OAuth login is no longer waiting for input. Start it again.')
    session.manualInputSubmittedAt = completeAt()
    session.manualInputRequired = false
    pending.resolveManualInput(input)
  }

  async function closeOAuthCallbackServersForShutdown(reason: string): Promise<{ closed: number; failedPendingSessions: number }> {
    const failedPendingSessions = failPendingOAuthSessionsForShutdown(reason)
    const starting = [googleOAuthCallbackServerStarting, openAICodexOAuthCallbackServerStarting].filter(Boolean) as Promise<void>[]
    if (starting.length) {
      await Promise.race([
        Promise.allSettled(starting),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ])
    }
    googleOAuthCallbackServerStarting = null
    openAICodexOAuthCallbackServerStarting = null
    const [googleClosed, codexClosed] = await Promise.all([
      closeLifecycleHttpServer(googleOAuthCallbackServer, 'Google OAuth callback server', reason, warn),
      closeLifecycleHttpServer(openAICodexOAuthCallbackServer, 'OpenAI Codex OAuth callback server', reason, warn),
    ])
    googleOAuthCallbackServer = null
    openAICodexOAuthCallbackServer = null
    clearAllSessionTimeouts()
    return {
      closed: Number(googleClosed) + Number(codexClosed),
      failedPendingSessions,
    }
  }

  function closeOAuthCallbackServersForProcessExit(reason: string): void {
    failPendingOAuthSessionsForShutdown(reason)
    clearAllSessionTimeouts()
    for (const server of [googleOAuthCallbackServer, openAICodexOAuthCallbackServer]) {
      try {
        const closable = server as (Server & {
          closeAllConnections?: () => void
          closeIdleConnections?: () => void
        }) | null
        closable?.closeIdleConnections?.()
        closable?.closeAllConnections?.()
        closable?.close()
      } catch {
        // The process is already exiting.
      }
    }
    googleOAuthCallbackServer = null
    openAICodexOAuthCallbackServer = null
    googleOAuthCallbackServerStarting = null
    openAICodexOAuthCallbackServerStarting = null
  }

  function callbackServerSnapshot(): OAuthCallbackServerSnapshot {
    return {
      google: serverState(googleOAuthCallbackServer),
      openAiCodex: serverState(openAICodexOAuthCallbackServer),
    }
  }

  return {
    callbackServerSnapshot,
    cancelOAuthSession,
    closeOAuthCallbackServersForProcessExit,
    closeOAuthCallbackServersForShutdown,
    completeOpenAICodexOAuthSession,
    oauthSessions,
    parseOpenAICodexAuthorizationInput,
    refreshGoogleOAuthCredential,
    refreshAnthropicOAuthCredential,
    refreshOpenAICodexOAuthCredential,
    startGoogleOAuthSession,
    startGoogleAccountOAuthSession,
    startAnthropicOAuthSession,
    startOpenAICodexOAuthSession,
    submitAnthropicOAuthManualInput,
  }
}

export type OAuthCallbackService = ReturnType<typeof createOAuthCallbackService>

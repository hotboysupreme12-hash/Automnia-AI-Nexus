import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { LocalOAuthCredential } from './providerAuthService'

export type GoogleOAuthClientConfig = {
  clientId: string
  clientSecret?: string
}

export type OAuthProvider = 'google' | 'openai-codex'
export type OAuthSessionStatus = 'pending' | 'complete' | 'error'

export type ProviderOAuthSession = {
  id: string
  provider: OAuthProvider
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

export type OAuthCallbackServerSnapshot = {
  google: OAuthCallbackServerState
  openAiCodex: OAuthCallbackServerState
}

type OAuthCallbackServerState = {
  listening: boolean
  address: string | null
  port: number | null
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
  fetch?: FetchLike
  googleCallbackPort?: number
  googleOAuthRedirectUri: string
  googleOAuthScopes: string[]
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

  function completeAt() {
    return now().toISOString()
  }

  function failSession(session: ProviderOAuthSession, error: unknown) {
    session.status = 'error'
    session.error = safeErrorText(error, redactSensitiveText)
    session.completedAt = completeAt()
    clearSessionTimeout(session.id)
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
      failed += 1
    }
    return failed
  }

  function buildGoogleOAuthAuthorizationUrl(challenge: string, state: string) {
    const { clientId } = options.resolveGoogleOAuthClientConfig()
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: options.googleOAuthRedirectUri,
      scope: options.googleOAuthScopes.join(' '),
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
            res.end('<h1>OAuth session not found</h1><p>Return to DystopAI and start the connection again.</p>')
            return
          }

          if (error) throw new Error(error)
          if (!code) throw new Error('Google did not return an authorization code.')
          if (!session.verifier) throw new Error('Google OAuth verifier missing. Restart the connection.')

          const credential = await exchangeGoogleOAuthCodeForTokens(code, session.verifier, session.projectId)
          await options.persistProviderOAuth('google', credential)
          session.status = 'complete'
          session.completedAt = completeAt()
          clearSessionTimeout(session.id)
          session.result = {
            ...(credential.email ? { email: credential.email } : {}),
            ...(credential.projectId ? { projectId: credential.projectId } : {}),
            ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h1>Google connected</h1><p>You can close this window and return to DystopAI.</p>')
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

  async function startGoogleOAuthSession(projectId?: string): Promise<OAuthStartResult> {
    if (options.isShuttingDown()) throw new Error('Control Center is shutting down.')
    const id = randomUUID()
    const state = randomBytes(24).toString('base64url')
    const { verifier, challenge } = generatePkcePair()
    const authorizationUrl = buildGoogleOAuthAuthorizationUrl(challenge, state)
    const resolvedProjectId = options.resolveGoogleProjectId(projectId)
    const session: ProviderOAuthSession = {
      id,
      provider: 'google',
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
      await options.persistProviderOAuth('openai-codex', credential)
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
            (entry) => entry.provider === 'openai-codex' && entry.state === state,
          )
          if (!session) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h1>OAuth session not found</h1><p>Return to DystopAI and start the connection again.</p>')
            return
          }

          if (error) throw new Error(error)
          if (!code) throw new Error('OpenAI did not return an authorization code.')

          await completeOpenAICodexOAuthSession(session, code, state)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h1>OpenAI Codex connected</h1><p>You can close this window and return to DystopAI.</p>')
        } catch (err) {
          const message = safeErrorText(err, redactSensitiveText)
          const state = new URL(req.url || '/', options.openAiCodexOAuthRedirectUri).searchParams.get('state') || ''
          const session = Array.from(oauthSessions.values()).find(
            (entry) => entry.provider === 'openai-codex' && entry.state === state,
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
    const flow = await options.createOpenAICodexAuthorizationFlow('dystopai')
    const session: ProviderOAuthSession = {
      id,
      provider: 'openai-codex',
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
    closeOAuthCallbackServersForProcessExit,
    closeOAuthCallbackServersForShutdown,
    completeOpenAICodexOAuthSession,
    oauthSessions,
    parseOpenAICodexAuthorizationInput,
    refreshGoogleOAuthCredential,
    refreshOpenAICodexOAuthCredential,
    startGoogleOAuthSession,
    startOpenAICodexOAuthSession,
  }
}

export type OAuthCallbackService = ReturnType<typeof createOAuthCallbackService>

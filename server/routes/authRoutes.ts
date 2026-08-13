import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { createLoginAttemptLimiter, type LoginAttemptLimiter } from '../loginAttemptLimiter'
import { secureTokenEqual, type SessionTokenStore } from '../sessionTokenStore'
import { AccountAuthError, type AccountAuthService } from '../services/auth/accountAuthService'
import type { LocalOAuthCredential } from '../services/providers/providerAuthService'
import type { ProviderOAuthSession } from '../services/providers/oauthCallbackService'

type AuthRouteOptions = {
  authToken: string
  loginAttempts?: LoginAttemptLimiter
  sessionTokens: SessionTokenStore
  accountAuth?: AccountAuthService
  ensureProviderAuthReady?: () => Promise<unknown>
  getLocalProviderOAuth?: (provider: string) => LocalOAuthCredential | undefined
  oauthSessions?: Pick<Map<string, ProviderOAuthSession>, 'get'>
  startGoogleOAuthSession?: (projectId?: string) => Promise<{
    session: ProviderOAuthSession
    launched: { ok: boolean; detail?: string }
  }>
  startGoogleAccountOAuthSession?: () => Promise<{
    session: ProviderOAuthSession
    launched: { ok: boolean; detail?: string }
  }>
}

function loginAttemptKey(req: Request) {
  const origin = req.get('origin') || 'no-origin'
  // The control plane is loopback-only and does not trust proxy headers.
  // Using X-Forwarded-For here would let a local caller rotate arbitrary keys.
  return `${req.socket.remoteAddress || req.ip || 'local'}|${origin}`
}

function bearerToken(req: Request) {
  return /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]?.trim() || ''
}

function accountFailure(res: Response, error: unknown) {
  if (!(error instanceof AccountAuthError)) {
    return apiFailure(res, 503, 'account_service_unavailable', 'Automnia account service is unavailable. Try again shortly.')
  }
  const status = error.code === 'invalid_credentials' ? 401
    : error.code === 'account_exists' || error.code === 'account_setup_required' ? 409
      : error.code === 'password_invalid' ? 400
        : error.code === 'account_activation_failed' ? 400 : 503
  return apiFailure(res, status, error.code, error.message)
}

export function registerAuthRoutes(app: Express, options: AuthRouteOptions) {
  const loginAttempts = options.loginAttempts || createLoginAttemptLimiter()
  const googleSessionLogins = new Map<string, { token: string; account: unknown }>()

  app.post('/api/auth/login', async (req, res) => {
    const attemptKey = loginAttemptKey(req)
    const decision = loginAttempts.check(attemptKey)
    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      return apiFailure(
        res,
        429,
        'rate_limited',
        'Too many failed login attempts. Try again after the retry window.',
        { retryAfterSeconds },
      )
    }

    const accountSchema = z.object({
      email: z.string().trim().email().max(320),
      password: z.string().min(1).max(128),
    })
    const tokenSchema = z.object({ token: z.string().min(1).max(4096) })
    const accountParsed = accountSchema.safeParse(req.body)
    const tokenParsed = tokenSchema.safeParse(req.body)

    if (accountParsed.success) {
      if (!options.accountAuth) return apiFailure(res, 503, 'account_service_unavailable', 'Account sign-in is not configured in this build.')
      try {
        const account = await options.accountAuth.login(accountParsed.data)
        loginAttempts.recordSuccess(attemptKey)
        return apiSuccess(res, { ...options.sessionTokens.issue(), ...account })
      } catch (error) {
        const failure = loginAttempts.recordFailure(attemptKey)
        if (!failure.allowed) {
          const retryAfterSeconds = Math.max(1, Math.ceil(failure.retryAfterMs / 1000))
          res.setHeader('Retry-After', String(retryAfterSeconds))
          return apiFailure(res, 429, 'rate_limited', 'Too many failed login attempts. Try again after the retry window.', { retryAfterSeconds })
        }
        return accountFailure(res, error)
      }
    }

    if (!tokenParsed.success) return apiFailure(res, 400, 'invalid_payload', 'Enter your Automnia email and password.', accountParsed.error.flatten())
    if (secureTokenEqual(tokenParsed.data.token, options.authToken)) {
      loginAttempts.recordSuccess(attemptKey)
      return apiSuccess(res, options.sessionTokens.issue())
    }

    const failure = loginAttempts.recordFailure(attemptKey)
    if (!failure.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(failure.retryAfterMs / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      return apiFailure(
        res,
        429,
        'rate_limited',
        'Too many failed login attempts. Try again after the retry window.',
        { retryAfterSeconds },
      )
    }
    return apiFailure(res, 401, 'invalid_token', 'Invalid local runtime credential')
  })

  app.post('/api/auth/account/setup', async (req, res) => {
    if (!options.accountAuth) return apiFailure(res, 503, 'account_service_unavailable', 'Account activation is not configured in this build.')
    const parsed = z.object({
      email: z.string().trim().email().max(320),
      licenseKey: z.string().trim().min(1).max(256),
      password: z.string().min(12).max(128),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Enter your email, Cloud Subscription key, and a password of at least 12 characters.', parsed.error.flatten())
    try {
      const account = await options.accountAuth.setup(parsed.data)
      return apiSuccess(res, { ...options.sessionTokens.issue(), ...account })
    } catch (error) {
      return accountFailure(res, error)
    }
  })

  app.post('/api/auth/account/google/start', async (req, res) => {
    if (!options.startGoogleAccountOAuthSession) {
      return apiFailure(res, 503, 'oauth_operation_failed', 'Google sign-in is not configured in this build.')
    }
    const parsed = z.object({}).optional().safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid Google sign-in request.', parsed.error.flatten())
    try {
      const result = await options.startGoogleAccountOAuthSession()
      return apiSuccess(res, {
        sessionId: result.session.id,
        authorizationUrl: result.session.authorizationUrl,
        openedBrowser: result.launched.ok,
        browserDetail: result.launched.detail,
      })
    } catch (error) {
      return apiFailure(res, 500, 'oauth_operation_failed', 'Failed to start Google sign-in.', String(error))
    }
  })

  app.get('/api/auth/account/google/session/:sessionId', async (req, res) => {
    const sessionId = String(req.params.sessionId || '')
    const session = options.oauthSessions?.get(sessionId)
    if (!session || session.provider !== 'google') return apiFailure(res, 404, 'oauth_operation_failed', 'Google sign-in session not found.')
    if (session.status === 'pending') return apiSuccess(res, { sessionId, status: 'pending' })
    if (session.status === 'error') return apiFailure(res, 400, 'oauth_operation_failed', session.error || 'Google sign-in failed.')
    const previous = googleSessionLogins.get(sessionId)
    if (previous) return apiSuccess(res, { sessionId, status: 'complete', ...previous })
    if (session.purpose === 'account') {
      if (!session.account) return apiFailure(res, 409, 'oauth_operation_failed', 'Google sign-in completed, but Automnia could not verify the subscriber account yet.')
      const result = { token: options.sessionTokens.issue().token, account: session.account }
      googleSessionLogins.set(sessionId, result)
      return apiSuccess(res, { sessionId, status: 'complete', ...result })
    }
    if (!options.accountAuth || !options.getLocalProviderOAuth) return apiFailure(res, 503, 'account_service_unavailable', 'Google account sign-in is not configured.')
    try {
      await options.ensureProviderAuthReady?.()
      const credential = options.getLocalProviderOAuth('google')
      if (!credential?.accessToken) return apiFailure(res, 409, 'oauth_operation_failed', 'Google sign-in completed, but the local account credential was not available yet.')
      const account = await options.accountAuth.loginWithGoogle(credential.accessToken)
      const result = { token: options.sessionTokens.issue().token, account }
      googleSessionLogins.set(sessionId, result)
      return apiSuccess(res, { sessionId, status: 'complete', ...result })
    } catch (error) {
      return accountFailure(res, error)
    }
  })

  app.post('/api/auth/account/password/change', async (req, res) => {
    const token = bearerToken(req)
    if (!token || !options.sessionTokens.has(token)) {
      return apiFailure(res, 401, 'auth_required', 'Sign in before changing your password.')
    }
    if (!options.accountAuth) return apiFailure(res, 503, 'account_service_unavailable', 'Password changes are not configured in this build.')
    const parsed = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(12).max(128),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Enter your current password and a new password of at least 12 characters.', parsed.error.flatten())
    try {
      return apiSuccess(res, await options.accountAuth.changePassword(parsed.data))
    } catch (error) {
      return accountFailure(res, error)
    }
  })

  app.post('/api/auth/account/password/set', async (req, res) => {
    const token = bearerToken(req)
    if (!token || !options.sessionTokens.has(token)) {
      return apiFailure(res, 401, 'auth_required', 'Sign in with Google before creating an account password.')
    }
    if (!options.accountAuth) return apiFailure(res, 503, 'account_service_unavailable', 'Password setup is not configured in this build.')
    const parsed = z.object({
      newPassword: z.string().min(12).max(128),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Create a password between 12 and 128 characters.', parsed.error.flatten())
    try {
      return apiSuccess(res, await options.accountAuth.setPassword(parsed.data))
    } catch (error) {
      return accountFailure(res, error)
    }
  })

  app.get('/api/auth/status', (req, res) => {
    const token = bearerToken(req)
    if (token && (options.sessionTokens.has(token) || secureTokenEqual(token, options.authToken))) {
      return apiSuccess(res, { authenticated: true, account: options.accountAuth?.getStatus().account || null })
    }
    return apiSuccess(res, { authenticated: false, account: null })
  })

  app.post('/api/auth/logout', (req, res) => {
    const revoked = options.sessionTokens.revoke(bearerToken(req))
    return apiSuccess(res, { revoked })
  })
}

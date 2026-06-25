import type { Express, Request } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { createLoginAttemptLimiter, type LoginAttemptLimiter } from '../loginAttemptLimiter'
import { secureTokenEqual, type SessionTokenStore } from '../sessionTokenStore'

type AuthRouteOptions = {
  authToken: string
  loginAttempts?: LoginAttemptLimiter
  sessionTokens: SessionTokenStore
}

function loginAttemptKey(req: Request) {
  const origin = req.get('origin') || 'no-origin'
  // The control plane is loopback-only and does not trust proxy headers.
  // Using X-Forwarded-For here would let a local caller rotate arbitrary keys.
  return `${req.socket.remoteAddress || req.ip || 'local'}|${origin}`
}

export function registerAuthRoutes(app: Express, options: AuthRouteOptions) {
  const loginAttempts = options.loginAttempts || createLoginAttemptLimiter()

  app.post('/api/auth/login', (req, res) => {
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

    const schema = z.object({ token: z.string().min(1).max(4096) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    if (secureTokenEqual(parsed.data.token, options.authToken)) {
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
    return apiFailure(res, 401, 'invalid_token', 'Invalid token')
  })

  app.get('/api/auth/status', (req, res) => {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]?.trim()
    if (token && options.sessionTokens.has(token)) {
      return apiSuccess(res, { authenticated: true })
    }
    return apiSuccess(res, { authenticated: false })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]?.trim() || ''
    const revoked = options.sessionTokens.revoke(token)
    return apiSuccess(res, { revoked })
  })
}

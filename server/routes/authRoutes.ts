import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { secureTokenEqual, type SessionTokenStore } from '../sessionTokenStore'

type AuthRouteOptions = {
  authToken: string
  sessionTokens: SessionTokenStore
}

export function registerAuthRoutes(app: Express, options: AuthRouteOptions) {
  app.post('/api/auth/login', (req, res) => {
    const schema = z.object({ token: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    if (secureTokenEqual(parsed.data.token, options.authToken)) {
      return apiSuccess(res, options.sessionTokens.issue())
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

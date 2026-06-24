import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type AuthRouteOptions = {
  authToken: string
  sessionTokens: Set<string>
}

export function registerAuthRoutes(app: Express, options: AuthRouteOptions) {
  app.post('/api/auth/login', (req, res) => {
    const schema = z.object({ token: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    if (parsed.data.token === options.authToken) {
      const sessionToken = randomUUID()
      options.sessionTokens.add(sessionToken)
      return apiSuccess(res, { token: sessionToken })
    }

    return apiFailure(res, 401, 'invalid_token', 'Invalid token')
  })

  app.get('/api/auth/status', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (token && options.sessionTokens.has(token)) {
      return apiSuccess(res, { authenticated: true })
    }
    return apiSuccess(res, { authenticated: false })
  })
}

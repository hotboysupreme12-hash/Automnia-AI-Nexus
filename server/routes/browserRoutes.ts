import type { Express } from 'express'
import { apiSuccess } from '../controlPlaneHttp'

type BrowserPreflight = Record<string, unknown> & { ok: boolean }

type BrowserRoutesOptions = {
  checkBrowserPreflight: (agentId?: string) => Promise<BrowserPreflight>
}

export function registerBrowserRoutes(app: Express, options: BrowserRoutesOptions) {
  app.get('/api/browser/preflight', async (req, res) => {
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined
    const preflight = await options.checkBrowserPreflight(agentId)
    return apiSuccess(res, { ok: preflight.ok, preflight })
  })
}

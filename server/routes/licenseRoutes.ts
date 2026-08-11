import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { LicenseServiceError, type LicenseService } from '../services/license/licenseService'

export function registerLicenseRoutes(app: Express, options: { licenseService: LicenseService }) {
  app.get('/api/license/status', (_req, res) => apiSuccess(res, options.licenseService.getStatus()))

  app.post('/api/license/activate', async (req, res) => {
    const parsed = z.object({
      email: z.string().trim().email().max(320),
      licenseKey: z.string().trim().min(8).max(128),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Enter the checkout email and license key from your Automnia order.')

    try {
      const status = await options.licenseService.activate({
        email: parsed.data.email.toLowerCase(),
        licenseKey: parsed.data.licenseKey.toUpperCase(),
      })
      return apiSuccess(res, status)
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      return apiFailure(res, known?.code === 'license_activation_failed' ? 401 : 502, known?.code || 'license_service_unavailable', known?.message || 'License activation failed.')
    }
  })

  app.post('/api/license/deactivate', (_req, res) => {
    try {
      return apiSuccess(res, options.licenseService.deactivate())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The local license record could not be removed.'
      return apiFailure(res, 500, 'license_service_unavailable', message)
    }
  })
}

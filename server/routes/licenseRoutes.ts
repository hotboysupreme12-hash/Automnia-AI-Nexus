import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { LicenseServiceError, type LicenseService } from '../services/license/licenseService'

export function registerLicenseRoutes(app: Express, options: {
  licenseService: LicenseService
  synchronizeOpenClawBillingRoute?: () => Promise<void>
  pushGatewayLog?: (stream: 'lifecycle' | 'stderr' | 'stdout' | 'gateway' | 'channel', message: string, level?: string) => void
}) {
  const synchronizeOpenClawBillingRoute = async () => {
    await options.synchronizeOpenClawBillingRoute?.()
  }

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
      await synchronizeOpenClawBillingRoute()
      return apiSuccess(res, status)
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      return apiFailure(res, known?.code === 'license_activation_failed' ? 401 : 502, known?.code || 'license_service_unavailable', known?.message || 'License activation failed.')
    }
  })

  // A manual reconciliation is useful after a top-up or when the same
  // subscription was used on another device. It never changes a balance
  // locally; it asks the Shopify provisioner for its current authoritative
  // license state.
  app.post('/api/license/refresh', (_req, res) => {
    // Return immediately to shield the gateway from the 1200ms timeout.
    apiSuccess(res, { status: 'refresh_initiated' })

    // Execute refresh in the background
    options.licenseService.refresh()
      .then(async (status) => {
        await synchronizeOpenClawBillingRoute()
        if (options.pushGatewayLog) {
          options.pushGatewayLog('lifecycle', `Background license refresh succeeded: ${status.email || 'unknown user'}`)
        } else {
          console.log(`Background license refresh succeeded: ${status.email || 'unknown user'}`)
        }
      })
      .catch((error) => {
        if (options.pushGatewayLog) {
          options.pushGatewayLog('stderr', `Background license refresh failed: ${error instanceof Error ? error.message : String(error)}`)
        } else {
          console.error('Background license refresh failed:', error)
        }
      })
  })

  app.post('/api/license/usage-priority', async (req, res) => {
    const parsed = z.object({
      usagePriority: z.enum(['automnia_first', 'provider_first']),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Choose Automnia credits first or your connected provider first.')
    if (options.licenseService.getStatus().mode !== 'hosted_credits') {
      return apiFailure(res, 409, 'invalid_payload', 'Usage priority is available to active hosted subscribers. BYOK access always uses the connected provider.')
    }
    try {
      const status = options.licenseService.setUsagePriority(parsed.data.usagePriority)
      await synchronizeOpenClawBillingRoute()
      return apiSuccess(res, status)
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      return apiFailure(res, 500, known?.code || 'license_service_unavailable', known?.message || 'The usage priority could not be saved.')
    }
  })

  // Checkout is provisioner-owned: the desktop app only asks for a verified
  // HTTPS URL and opens it for the customer. It never constructs Shopify cart
  // links, product IDs, prices, or an entitlement locally.
  app.post('/api/license/checkout', async (_req, res) => {
    try {
      return apiSuccess(res, await options.licenseService.getSubscriptionCheckout())
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      return apiFailure(res, known?.code === 'license_activation_failed' ? 404 : 502, known?.code || 'license_service_unavailable', known?.message || 'Shopify checkout is currently unavailable.')
    }
  })

  app.post('/api/license/deactivate', async (_req, res) => {
    try {
      const status = options.licenseService.deactivate()
      await synchronizeOpenClawBillingRoute()
      return apiSuccess(res, status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The local license record could not be removed.'
      return apiFailure(res, 500, 'license_service_unavailable', message)
    }
  })
}

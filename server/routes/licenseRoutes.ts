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

  const synchronizeOpenClawBillingRouteInBackground = () => {
    void synchronizeOpenClawBillingRoute().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      options.pushGatewayLog?.('stderr', `Usage priority synchronization failed after save: ${message}`)
    })
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
  // subscription was used on another device. Keep this request synchronous:
  // returning the old status before the provisioner answers made a failed
  // refresh look successful and only surfaced later as a confusing stderr log.
  app.post('/api/license/refresh', async (_req, res) => {
    try {
      const status = await options.licenseService.refresh()
      await synchronizeOpenClawBillingRoute()
      if (options.pushGatewayLog) {
        options.pushGatewayLog('lifecycle', `License refresh succeeded: ${status.email || 'unknown user'}`)
      }
      return apiSuccess(res, status)
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      const message = known?.message || 'Unable to refresh the Automnia license right now. Check your connection and try again.'
      if (options.pushGatewayLog) options.pushGatewayLog('stderr', `License refresh failed: ${message}`)
      return apiFailure(res, 502, known?.code || 'license_service_unavailable', message)
    }
  })

  app.post('/api/knowledge/answer', async (req, res) => {
    const parsed = z.object({ query: z.string().trim().min(1).max(5_000) }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Enter a knowledge question between 1 and 5,000 characters.')
    try {
      return apiSuccess(res, await options.licenseService.answerKnowledge(parsed.data.query))
    } catch (error) {
      const known = error instanceof LicenseServiceError ? error : null
      return apiFailure(res, known?.code === 'license_activation_failed' ? 401 : 502, known?.code || 'license_service_unavailable', known?.message || 'The Automnia knowledge assistant is unavailable.')
    }
  })

  app.post('/api/license/usage-priority', async (req, res) => {
    const parsed = z.object({
      usagePriority: z.enum(['automnia_first', 'provider_first', 'byok_only']),
    }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Choose Automnia credits first, Automnia with fallback, or BYOK only.')
    const currentStatus = options.licenseService.getStatus()
    if (currentStatus.mode !== 'hosted_credits') {
      return apiFailure(res, 409, 'invalid_payload', 'BYOK access uses the connected provider. Hosted priority options are available on Pro and higher permanent tiers.')
    }
    if (options.licenseService.isUsagePriorityLocked() && parsed.data.usagePriority !== 'automnia_first') {
      return apiFailure(res, 409, 'invalid_payload', 'Starter Subscription ($19.99) stays on Subscription Relay. Upgrade to Pro or higher to choose another usage priority.')
    }
    try {
      const status = options.licenseService.setUsagePriority(parsed.data.usagePriority)
      // Saving the preference is local and synchronous. Config reconciliation
      // may wait on a Gateway restart, so do it after the response instead of
      // holding the renderer request open until the 8-second client timeout.
      synchronizeOpenClawBillingRouteInBackground()
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

import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl, automniaCloudRuntimeBaseUrl } from '../../config/automniaCloud'

export const DEFAULT_LICENSE_API_URL = AUTOMNIA_PUBLIC_CLOUD_URL
const ACTIVATION_TIMEOUT_MS = 10_000

export type HostedUsagePriority = 'automnia_first' | 'provider_first'

export type LicenseStatus = {
  active: boolean
  email: string | null
  tier: string | null
  mode: 'hosted_credits' | 'byok' | null
  usagePriority: HostedUsagePriority | null
  creditBalance: number | null
  creditBalanceUpdatedAt: string | null
  activatedAt: string | null
  verifiedAt: string | null
}

export type SubscriptionCheckout = {
  checkoutUrl: string
}

type StoredLicense = LicenseStatus & {
  licenseKey: string
}

export type LicenseServiceOptions = {
  read: <T>(stateKey: string) => T | null
  write: (stateKey: string, value: unknown) => boolean
  remove: (stateKey: string) => boolean
  apiUrl?: string
  fetch?: typeof fetch
  now?: () => Date
}

export class LicenseServiceError extends Error {
  public readonly code: 'license_activation_failed' | 'license_service_unavailable'

  constructor(
    code: 'license_activation_failed' | 'license_service_unavailable',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

function licenseApiBaseUrl(value: string | undefined) {
  const explicitOverride = value || process.env.AUTOMNIA_LICENSE_API_URL
  return explicitOverride ? automniaCloudBaseUrl(explicitOverride) : automniaCloudRuntimeBaseUrl(DEFAULT_LICENSE_API_URL)
}

function validCreditBalance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function validUsagePriority(value: unknown): value is HostedUsagePriority {
  return value === 'automnia_first' || value === 'provider_first'
}

function effectiveMode(record: Pick<StoredLicense, 'mode' | 'tier'>): 'hosted_credits' | 'byok' {
  return record.mode || (record.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits')
}

function publicStatus(record: StoredLicense | null): LicenseStatus {
  if (!record?.active) {
    return {
      active: false,
      email: null,
      tier: null,
      mode: null,
      usagePriority: null,
      creditBalance: null,
      creditBalanceUpdatedAt: null,
      activatedAt: null,
      verifiedAt: null,
    }
  }
  const mode = effectiveMode(record)
  return {
    active: true,
    email: record.email || null,
    tier: record.tier || null,
    mode,
    usagePriority: mode === 'byok'
      ? 'provider_first'
      : validUsagePriority(record.usagePriority) ? record.usagePriority : 'automnia_first',
    creditBalance: validCreditBalance(record.creditBalance) ? record.creditBalance : null,
    creditBalanceUpdatedAt: record.creditBalanceUpdatedAt || null,
    activatedAt: record.activatedAt || null,
    verifiedAt: record.verifiedAt || null,
  }
}

function storedLicense(value: unknown): StoredLicense | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.active !== true || typeof record.licenseKey !== 'string' || !record.licenseKey.trim()) return null
  return {
    active: true,
    licenseKey: record.licenseKey,
    email: typeof record.email === 'string' ? record.email : null,
    tier: typeof record.tier === 'string' ? record.tier : null,
    mode: record.mode === 'byok' ? 'byok' : record.mode === 'hosted_credits' ? 'hosted_credits' : null,
    usagePriority: validUsagePriority(record.usagePriority) ? record.usagePriority : null,
    creditBalance: validCreditBalance(record.creditBalance) ? record.creditBalance : null,
    creditBalanceUpdatedAt: typeof record.creditBalanceUpdatedAt === 'string' ? record.creditBalanceUpdatedAt : null,
    activatedAt: typeof record.activatedAt === 'string' ? record.activatedAt : null,
    verifiedAt: typeof record.verifiedAt === 'string' ? record.verifiedAt : null,
  }
}

export function createLicenseService(options: LicenseServiceOptions) {
  const stateKey = 'license:activation'
  const apiBaseUrl = licenseApiBaseUrl(options.apiUrl)
  const request = options.fetch || globalThis.fetch
  const now = () => (options.now ? options.now() : new Date()).toISOString()
  const current = () => storedLicense(options.read<StoredLicense>(stateKey))

  const store = (record: StoredLicense, errorMessage: string) => {
    if (!options.write(stateKey, record)) {
      throw new LicenseServiceError('license_service_unavailable', errorMessage)
    }
    return publicStatus(record)
  }

  const activeRecordFromPayload = (payload: Record<string, unknown>, fallback: StoredLicense): StoredLicense => {
    const reportedCreditBalance = validCreditBalance(payload.creditBalance) ? payload.creditBalance : fallback.creditBalance
    const mode = payload.mode === 'byok' || payload.mode === 'hosted_credits'
      ? payload.mode
      : fallback.mode
    return {
      active: true,
      licenseKey: fallback.licenseKey,
      email: typeof payload.email === 'string' ? payload.email : fallback.email,
      tier: typeof payload.tier === 'string' ? payload.tier : fallback.tier,
      mode,
      usagePriority: mode === 'byok'
        ? 'provider_first'
        : validUsagePriority(fallback.usagePriority) ? fallback.usagePriority : 'automnia_first',
      creditBalance: reportedCreditBalance,
      creditBalanceUpdatedAt: validCreditBalance(payload.creditBalance) ? now() : fallback.creditBalanceUpdatedAt,
      activatedAt: typeof payload.activatedAt === 'string' ? payload.activatedAt : fallback.activatedAt || now(),
      verifiedAt: now(),
    }
  }

  const verifyWithProvisioner = async ({ email, licenseKey }: { email: string; licenseKey: string }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACTIVATION_TIMEOUT_MS)
    try {
      const response = await request(`${apiBaseUrl}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, licenseKey }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!response.ok || payload?.ok !== true || payload.active !== true) {
        const detail = typeof payload?.error === 'string' ? payload.error : 'License activation was not accepted.'
        const code = response.status >= 500 ? 'license_service_unavailable' : 'license_activation_failed'
        throw new LicenseServiceError(code, detail)
      }
      return payload
    } catch (error) {
      if (error instanceof LicenseServiceError) throw error
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'License service did not respond in time. Check your connection and try again.'
        : 'Unable to reach the Automnia license service. Check your connection and try again.'
      throw new LicenseServiceError('license_service_unavailable', message)
    } finally {
      clearTimeout(timer)
    }
  }

  const checkoutFromProvisioner = async (): Promise<SubscriptionCheckout> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACTIVATION_TIMEOUT_MS)
    try {
      const response = await request(`${apiBaseUrl}/api/commerce/checkout`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null
      if (response.status === 404) {
        throw new LicenseServiceError('license_activation_failed', 'Shopify checkout is not configured yet. Contact Automnia support or enter the Cloud Subscription key from an existing order.')
      }
      if (!response.ok || payload?.ok !== true || !validCheckoutUrl(payload.checkoutUrl)) {
        throw new LicenseServiceError('license_service_unavailable', 'Automnia could not open a verified Shopify checkout right now. Please try again shortly.')
      }
      return { checkoutUrl: payload.checkoutUrl }
    } catch (error) {
      if (error instanceof LicenseServiceError) throw error
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Shopify checkout did not respond in time. Check your connection and try again.'
        : 'Unable to reach the Automnia checkout service. Check your connection and try again.'
      throw new LicenseServiceError('license_service_unavailable', message)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getStatus: (): LicenseStatus => publicStatus(current()),
    isActive: () => current()?.active === true,
    // Kept server-local: never expose the license key in the browser-facing status response.
    getActiveRelayCredentials: (): { email: string; licenseKey: string; mode: 'hosted_credits'; usagePriority: HostedUsagePriority } | null => {
      const record = current()
      if (!record?.active || effectiveMode(record) !== 'hosted_credits' || !record.email || !record.licenseKey) return null
      return {
        email: record.email,
        licenseKey: record.licenseKey,
        mode: 'hosted_credits',
        usagePriority: validUsagePriority(record.usagePriority) ? record.usagePriority : 'automnia_first',
      }
    },
    getUsagePriority: (): HostedUsagePriority | null => publicStatus(current()).usagePriority,
    activate: async ({ email, licenseKey }: { email: string; licenseKey: string }): Promise<LicenseStatus> => {
      const payload = await verifyWithProvisioner({ email, licenseKey })
      const record = activeRecordFromPayload(payload, {
        active: true,
        licenseKey,
        email,
        tier: null,
        mode: null,
        usagePriority: 'automnia_first',
        creditBalance: null,
        creditBalanceUpdatedAt: null,
        activatedAt: null,
        verifiedAt: null,
      })
      return store(record, 'Activation succeeded, but the local license record could not be saved.')
    },
    // A successful hosted-relay response is the only in-app source permitted
    // to change this cached balance. The provisioner remains authoritative.
    recordHostedCreditBalance: (creditBalance: number): LicenseStatus | null => {
      if (!validCreditBalance(creditBalance)) return null
      const record = current()
      if (!record?.active || effectiveMode(record) !== 'hosted_credits') return null
      return store({
        ...record,
        creditBalance,
        creditBalanceUpdatedAt: now(),
        verifiedAt: now(),
      }, 'The provider charged this request, but the local credit balance could not be saved. Refresh Account & License to reconcile it.')
    },
    setUsagePriority: (usagePriority: HostedUsagePriority): LicenseStatus => {
      const record = current()
      if (!record?.active || effectiveMode(record) !== 'hosted_credits') return publicStatus(record)
      return store({
        ...record,
        usagePriority,
      }, 'The usage priority could not be saved on this device.')
    },
    refresh: async (): Promise<LicenseStatus> => {
      const record = current()
      if (!record?.active || !record.email || !record.licenseKey) return publicStatus(record)
      const payload = await verifyWithProvisioner({ email: record.email, licenseKey: record.licenseKey })
      return store(
        activeRecordFromPayload(payload, record),
        'The license was verified, but the refreshed account balance could not be saved.',
      )
    },
    getSubscriptionCheckout: checkoutFromProvisioner,
    deactivate: (): LicenseStatus => {
      if (!options.remove(stateKey)) {
        throw new LicenseServiceError('license_service_unavailable', 'The local license record could not be removed.')
      }
      return publicStatus(null)
    },
  }
}

export type LicenseService = ReturnType<typeof createLicenseService>

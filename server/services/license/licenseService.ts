const DEFAULT_LICENSE_API_URL = 'https://automnia-shopify-provisioner-336625531977.us-east1.run.app'
const ACTIVATION_TIMEOUT_MS = 10_000

export type LicenseStatus = {
  active: boolean
  email: string | null
  tier: string | null
  mode: 'hosted_credits' | 'byok' | null
  creditBalance: number | null
  activatedAt: string | null
  verifiedAt: string | null
}

type StoredLicense = LicenseStatus & {
  licenseKey: string
}

type LicenseServiceOptions = {
  read: <T>(stateKey: string) => T | null
  write: (stateKey: string, value: unknown) => boolean
  remove: (stateKey: string) => boolean
  apiUrl?: string
}

export class LicenseServiceError extends Error {
  constructor(
    public readonly code: 'license_activation_failed' | 'license_service_unavailable',
    message: string,
  ) {
    super(message)
  }
}

function licenseApiBaseUrl(value: string | undefined) {
  return (value || process.env.AUTOMNIA_LICENSE_API_URL || DEFAULT_LICENSE_API_URL).replace(/\/+$/, '')
}

function publicStatus(record: StoredLicense | null): LicenseStatus {
  if (!record?.active) {
    return { active: false, email: null, tier: null, mode: null, creditBalance: null, activatedAt: null, verifiedAt: null }
  }
  return {
    active: true,
    email: record.email || null,
    tier: record.tier || null,
    mode: record.mode || (record.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits'),
    creditBalance: typeof record.creditBalance === 'number' ? record.creditBalance : null,
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
    creditBalance: typeof record.creditBalance === 'number' ? record.creditBalance : null,
    activatedAt: typeof record.activatedAt === 'string' ? record.activatedAt : null,
    verifiedAt: typeof record.verifiedAt === 'string' ? record.verifiedAt : null,
  }
}

export function createLicenseService(options: LicenseServiceOptions) {
  const stateKey = 'license:activation'
  const apiBaseUrl = licenseApiBaseUrl(options.apiUrl)
  const current = () => storedLicense(options.read<StoredLicense>(stateKey))

  return {
    getStatus: (): LicenseStatus => publicStatus(current()),
    isActive: () => current()?.active === true,
    activate: async ({ email, licenseKey }: { email: string; licenseKey: string }): Promise<LicenseStatus> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ACTIVATION_TIMEOUT_MS)
      try {
        const response = await fetch(`${apiBaseUrl}/api/activate`, {
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

        const now = new Date().toISOString()
        const record: StoredLicense = {
          active: true,
          licenseKey,
          email: typeof payload.email === 'string' ? payload.email : email,
          tier: typeof payload.tier === 'string' ? payload.tier : null,
          mode: payload.mode === 'byok' ? 'byok' : payload.mode === 'hosted_credits' ? 'hosted_credits' : null,
          creditBalance: typeof payload.creditBalance === 'number' ? payload.creditBalance : null,
          activatedAt: typeof payload.activatedAt === 'string' ? payload.activatedAt : now,
          verifiedAt: now,
        }
        if (!options.write(stateKey, record)) {
          throw new LicenseServiceError('license_service_unavailable', 'Activation succeeded, but the local license record could not be saved.')
        }
        return publicStatus(record)
      } catch (error) {
        if (error instanceof LicenseServiceError) throw error
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'License service did not respond in time. Check your connection and try again.'
          : 'Unable to reach the Automnia license service. Check your connection and try again.'
        throw new LicenseServiceError('license_service_unavailable', message)
      } finally {
        clearTimeout(timer)
      }
    },
    deactivate: (): LicenseStatus => {
      if (!options.remove(stateKey)) {
        throw new LicenseServiceError('license_service_unavailable', 'The local license record could not be removed.')
      }
      return publicStatus(null)
    },
  }
}

export type LicenseService = ReturnType<typeof createLicenseService>

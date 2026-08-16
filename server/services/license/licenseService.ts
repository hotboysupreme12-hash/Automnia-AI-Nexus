import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl, automniaCloudRuntimeBaseUrl } from '../../config/automniaCloud'

export const DEFAULT_LICENSE_API_URL = AUTOMNIA_PUBLIC_CLOUD_URL
const ACTIVATION_TIMEOUT_MS = 10_000
const KNOWLEDGE_TIMEOUT_MS = 45_000

export type HostedUsagePriority =
  | 'automnia_only'
  | 'provider_first'
  | 'automnia_first_with_provider_fallback'
  /** Legacy values kept readable so existing local records can be migrated. */
  | 'automnia_first'
  | 'byok_only'

export type LicenseStatus = {
  active: boolean
  email: string | null
  tier: string | null
  mode: 'hosted_credits' | 'byok' | null
  planPriceCents: number | null
  byokAllowed: boolean
  permanentAccess: boolean
  subscriptionStatus: string | null
  usagePriority: HostedUsagePriority | null
  creditBalance: number | null
  creditBalanceUpdatedAt: string | null
  activatedAt: string | null
  verifiedAt: string | null
}

export type LicenseTrafficGate = {
  active: boolean
  mode: 'hosted_credits' | 'byok' | null
  tier: string | null
  creditsOnly: boolean
  permanentAccess: boolean
  providerAccessAllowed: boolean
  localAiAllowed: boolean
  messageTrafficAllowed: boolean
  creditBalance: number | null
  creditState: 'not_required' | 'available' | 'exhausted' | 'unknown'
  blocked: boolean
  blockCode: 'license_required' | 'credits_exhausted' | 'credit_balance_unverified' | null
  blockMessage: string | null
}

export type SubscriptionCheckout = {
  checkoutUrl: string
}

export type AutomniaKnowledgeAnswer = {
  grounded: boolean
  state: string | null
  answerText: string
  citations: unknown[]
  references: unknown[]
  skippedReasons: string[]
  sessionName: string | null
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

function validPlanPriceCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
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
  return value === 'automnia_only'
    || value === 'provider_first'
    || value === 'automnia_first_with_provider_fallback'
    || value === 'automnia_first'
    || value === 'byok_only'
}

function tierAllowsByok(tier: string | null | undefined) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!normalized) return false
  if (new Set(['credit_pack_topup', 'credit_refill', 'starter', 'starter_subscription', 'cloud_starter_subscription']).has(normalized)) return false
  return true
}

function tierRank(tier: string | null | undefined) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized.includes('enterprise')) return 3
  if (normalized.includes('pro')) return 2
  if (normalized === 'starter' || normalized.includes('starter') || normalized === 'byok' || normalized.includes('byok')) return 1
  if (normalized.includes('credit') || normalized.includes('refill') || normalized.includes('topup')) return 0
  return normalized ? 1 : 0
}

function permanentAccessFor(record: { permanentAccess?: boolean; mode?: 'hosted_credits' | 'byok' | null; tier?: string | null }) {
  return !creditsOnlyEntitlement(record) && (record.permanentAccess === true || record.mode === 'byok' || tierRank(record.tier) >= 2)
}

function effectiveMode(record: Pick<StoredLicense, 'mode' | 'tier'>): 'hosted_credits' | 'byok' {
  return record.mode || (record.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits')
}

function isStarterSubscriptionOnly(record: {
  mode?: 'hosted_credits' | 'byok' | null
  tier?: string | null
  planPriceCents?: number | null
}) {
  const normalized = String(record.tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const isStarterTier = normalized === 'starter'
    || normalized === 'cloud_starter_subscription'
    || (normalized.includes('starter') && !normalized.includes('pro'))
    || (record.planPriceCents === 1_999 && !normalized)
  const mode = record.mode || 'hosted_credits'
  return mode === 'hosted_credits' && isStarterTier
}

function creditsOnlyEntitlement(record: {
  mode?: 'hosted_credits' | 'byok' | null
  tier?: string | null
  planPriceCents?: number | null
}) {
  const normalized = String(record.tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const refillOnly = normalized === 'credit_pack_topup' || normalized === 'credit_refill'
  return (record.mode || 'hosted_credits') === 'hosted_credits' && (isStarterSubscriptionOnly(record) || refillOnly)
}

function effectiveUsagePriority(record: StoredLicense, mode = effectiveMode(record)): HostedUsagePriority {
  if (creditsOnlyEntitlement(record)) return 'automnia_only'
  // Migrate the two removed labels without allowing an old desktop setting
  // to re-enable silent provider substitution. The old Automnia-first label
  // is now credits-only; the old provider-only label becomes the supported
  // provider-plus-Automnia route.
  if (record.usagePriority === 'automnia_first') return 'automnia_only'
  if (record.usagePriority === 'byok_only') return 'provider_first'
  return validUsagePriority(record.usagePriority)
    ? record.usagePriority
    : mode === 'byok' && !(validCreditBalance(record.creditBalance) && record.creditBalance > 0) ? 'provider_first' : 'automnia_only'
}

function publicStatus(record: StoredLicense | null): LicenseStatus {
  if (!record?.active) {
    return {
      active: false,
      email: null,
      tier: null,
      mode: null,
      planPriceCents: null,
      byokAllowed: false,
      permanentAccess: false,
      subscriptionStatus: null,
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
    planPriceCents: validPlanPriceCents(record.planPriceCents) ? record.planPriceCents : null,
    byokAllowed: !creditsOnlyEntitlement(record) && (record.byokAllowed === true || tierAllowsByok(record.tier)),
    permanentAccess: permanentAccessFor(record),
    subscriptionStatus: record.subscriptionStatus || null,
    usagePriority: effectiveUsagePriority(record, mode),
    creditBalance: validCreditBalance(record.creditBalance) ? record.creditBalance : null,
    creditBalanceUpdatedAt: record.creditBalanceUpdatedAt || null,
    activatedAt: record.activatedAt || null,
    verifiedAt: record.verifiedAt || null,
  }
}

export function resolveLicenseTrafficGate(status: LicenseStatus): LicenseTrafficGate {
  if (!status.active || !status.mode) {
    return {
      active: false,
      mode: null,
      tier: null,
      creditsOnly: false,
      permanentAccess: false,
      providerAccessAllowed: false,
      localAiAllowed: false,
      messageTrafficAllowed: false,
      creditBalance: null,
      creditState: 'unknown',
      blocked: true,
      blockCode: 'license_required',
      blockMessage: 'Activate your Automnia license before sending messages or using Gateway and channel traffic.',
    }
  }

  const creditsOnly = creditsOnlyEntitlement(status)
  // This flag is derived from the provisioner-verified license record. It is
  // intentionally the only permanent bypass for hosted-credit enforcement.
  // Starter/refill records are normalized to false before reaching this gate.
  const permanentAccess = !creditsOnly && status.permanentAccess === true
  const providerAccessAllowed = !creditsOnly && permanentAccess
  const localAiAllowed = !creditsOnly
  const requiresCredits = !permanentAccess && status.mode === 'hosted_credits'
  const creditState: LicenseTrafficGate['creditState'] = !requiresCredits
    ? 'not_required'
    : status.creditBalance === null
      ? 'unknown'
      : status.creditBalance > 0
        ? 'available'
        : 'exhausted'
  const blocked = requiresCredits && creditState !== 'available'
  const blockCode = blocked
    ? creditState === 'exhausted' ? 'credits_exhausted' : 'credit_balance_unverified'
    : null
  const blockMessage = blockCode === 'credits_exhausted'
    ? 'Automnia credits are out of tokens. Messages, Gateway traffic, channels, local AI, and cron runs are paused until your credit balance is restored.'
    : blockCode === 'credit_balance_unverified'
      ? 'Automnia could not verify an available credit balance. Messages, Gateway traffic, channels, local AI, and cron runs are paused until Account & License is refreshed.'
      : null

  return {
    active: true,
    mode: status.mode,
    tier: status.tier,
    creditsOnly,
    permanentAccess,
    providerAccessAllowed,
    localAiAllowed,
    messageTrafficAllowed: !blocked,
    creditBalance: status.creditBalance,
    creditState,
    blocked,
    blockCode,
    blockMessage,
  }
}

function storedLicense(value: unknown): StoredLicense | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.active !== true || typeof record.licenseKey !== 'string' || !record.licenseKey.trim()) return null
  const mode = record.mode === 'byok' ? 'byok' : record.mode === 'hosted_credits' ? 'hosted_credits' : null
  const tier = typeof record.tier === 'string' ? record.tier : null
  const planPriceCents = validPlanPriceCents(record.planPriceCents) ? record.planPriceCents : null
  const creditsOnly = creditsOnlyEntitlement({ mode, tier, planPriceCents })
  return {
    active: true,
    licenseKey: record.licenseKey,
    email: typeof record.email === 'string' ? record.email : null,
    tier,
    mode,
    planPriceCents,
    byokAllowed: !creditsOnly && (record.byokAllowed === true || mode === 'byok' || tierAllowsByok(tier)),
    permanentAccess: !creditsOnly && (record.permanentAccess === true || mode === 'byok' || tierRank(tier) >= 2),
    subscriptionStatus: typeof record.subscriptionStatus === 'string' ? record.subscriptionStatus : null,
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
    const tier = typeof payload.tier === 'string' ? payload.tier : fallback.tier
    const planPriceCents = validPlanPriceCents(payload.planPriceCents) ? payload.planPriceCents : fallback.planPriceCents
    const creditsOnly = creditsOnlyEntitlement({ mode, tier, planPriceCents })
    return {
      active: true,
      licenseKey: typeof payload.canonicalLicenseKey === 'string' && payload.canonicalLicenseKey.trim()
        ? payload.canonicalLicenseKey
        : fallback.licenseKey,
      email: typeof payload.email === 'string' ? payload.email : fallback.email,
      tier,
      mode,
      planPriceCents,
      byokAllowed: !creditsOnly && (payload.byokAllowed === true || fallback.byokAllowed === true || mode === 'byok' || tierAllowsByok(tier)),
      permanentAccess: !creditsOnly && (payload.permanentAccess === true || fallback.permanentAccess === true || mode === 'byok' || tierRank(tier) >= 2),
      subscriptionStatus: typeof payload.subscriptionStatus === 'string' ? payload.subscriptionStatus : fallback.subscriptionStatus,
      // The desktop preference is durable local state. Provisioner/account
      // payloads currently omit the user's selected route or may contain the
      // historical Automnia-first default, so never replace an explicit local
      // choice during refresh/account reconciliation. A credits-only entitlement
      // remains the one intentional lock.
      usagePriority: creditsOnly
        ? 'automnia_only'
        : validUsagePriority(fallback.usagePriority)
          ? fallback.usagePriority
          : validUsagePriority(payload.usagePriority)
            ? payload.usagePriority
            : mode === 'byok' && !(validCreditBalance(reportedCreditBalance) && reportedCreditBalance > 0) ? 'provider_first' : 'automnia_only',
      creditBalance: reportedCreditBalance,
      creditBalanceUpdatedAt: validCreditBalance(payload.creditBalance) ? now() : fallback.creditBalanceUpdatedAt,
      activatedAt: typeof payload.activatedAt === 'string' ? payload.activatedAt : fallback.activatedAt || now(),
      verifiedAt: now(),
    }
  }

  const verifyWithProvisioner = async (
    { email, licenseKey }: { email: string; licenseKey: string },
    retryTransient = false,
  ) => {
    const maxAttempts = retryTransient ? 3 : 1
    let lastTransportMessage = 'Unable to reach the Automnia license service. Check your connection and try again.'

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
          if (code === 'license_activation_failed' || attempt === maxAttempts - 1) {
            throw new LicenseServiceError(code, detail)
          }
          lastTransportMessage = detail
        } else {
          return payload
        }
      } catch (error) {
        if (error instanceof LicenseServiceError && error.code === 'license_activation_failed') throw error
        if (error instanceof LicenseServiceError) {
          lastTransportMessage = error.message
        } else {
          lastTransportMessage = error instanceof Error && error.name === 'AbortError'
            ? 'License service did not respond in time. Check your connection and try again.'
            : 'Unable to reach the Automnia license service. Check your connection and try again.'
        }
        if (attempt === maxAttempts - 1) {
          throw new LicenseServiceError('license_service_unavailable', lastTransportMessage)
        }
      } finally {
        clearTimeout(timer)
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, 300 * (attempt + 1))))
    }

    throw new LicenseServiceError('license_service_unavailable', lastTransportMessage)
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
    getTrafficGate: (): LicenseTrafficGate => resolveLicenseTrafficGate(publicStatus(current())),
    isActive: () => current()?.active === true,
    // Kept server-local: never expose the license key in the browser-facing status response.
    getActiveRelayCredentials: (): { email: string; licenseKey: string; mode: 'hosted_credits'; usagePriority: HostedUsagePriority } | null => {
      const record = current()
      if (!record?.active || !record.email || !record.licenseKey) return null
      const usagePriority = effectiveUsagePriority(record)
      // BYOK and higher tiers use this same hosted relay when the combined
      // provider-plus-Automnia route is selected. The route order is explicit
      // in usagePriority; it must not be inferred from the account mode.
      return {
        email: record.email,
        licenseKey: record.licenseKey,
        mode: 'hosted_credits',
        usagePriority,
      }
    },
    getUsagePriority: (): HostedUsagePriority | null => publicStatus(current()).usagePriority,
      isUsagePriorityLocked: (): boolean => {
        const record = current()
        return Boolean(record?.active && creditsOnlyEntitlement(record))
    },
    activate: async ({ email, licenseKey }: { email: string; licenseKey: string }): Promise<LicenseStatus> => {
      const payload = await verifyWithProvisioner({ email, licenseKey })
      const record = activeRecordFromPayload(payload, {
        active: true,
        licenseKey,
        email,
        tier: null,
        mode: null,
        planPriceCents: null,
        byokAllowed: false,
        permanentAccess: false,
        subscriptionStatus: null,
        usagePriority: null,
        creditBalance: null,
        creditBalanceUpdatedAt: null,
        activatedAt: null,
        verifiedAt: null,
      })
      return store(record, 'Activation succeeded, but the local license record could not be saved.')
    },
    // Cloud Run account authentication returns the license key only to this
    // loopback service. It is never included in the renderer-facing status.
    adoptRemoteAccount: (payload: Record<string, unknown>, licenseKey: string): LicenseStatus => {
      const existing = current()
      // Account authentication returns the canonical key as a separate
      // loopback-only value. Feed it through the same reconciliation path as
      // /api/license/activate so Google sign-in cannot leave a replaced local
      // key behind.
      const canonicalPayload = licenseKey.trim()
        ? { ...payload, canonicalLicenseKey: licenseKey }
        : payload
      return store(
        activeRecordFromPayload(canonicalPayload, {
          active: true,
          licenseKey,
          email: typeof payload.email === 'string' ? payload.email : existing?.email || null,
          tier: existing?.tier || null,
          mode: existing?.mode || null,
          planPriceCents: existing?.planPriceCents ?? null,
          byokAllowed: existing?.byokAllowed || false,
          permanentAccess: existing?.permanentAccess || false,
          subscriptionStatus: existing?.subscriptionStatus || null,
          usagePriority: existing?.usagePriority || null,
          creditBalance: existing?.creditBalance || null,
          creditBalanceUpdatedAt: existing?.creditBalanceUpdatedAt || null,
          activatedAt: existing?.activatedAt || null,
          verifiedAt: existing?.verifiedAt || null,
        }),
        'The account was verified, but the local license record could not be saved.',
      )
    },
    // A successful Automnia relay response is the only in-app source permitted
    // to change this cached pooled balance. The provisioner remains authoritative.
    recordHostedCreditBalance: (creditBalance: number): LicenseStatus | null => {
      if (!validCreditBalance(creditBalance)) return null
      const record = current()
      if (!record?.active) return null
      return store({
        ...record,
        creditBalance,
        creditBalanceUpdatedAt: now(),
        verifiedAt: now(),
      }, 'The provider charged this request, but the local credit balance could not be saved. Refresh Account & License to reconcile it.')
    },
    setUsagePriority: (usagePriority: HostedUsagePriority): LicenseStatus => {
      const record = current()
      if (!record?.active) return publicStatus(record)
      return store({
        ...record,
        usagePriority: creditsOnlyEntitlement(record) ? 'automnia_only' : usagePriority,
      }, 'The usage priority could not be saved on this device.')
    },
    refresh: async (): Promise<LicenseStatus> => {
      const record = current()
      if (!record?.active || !record.email || !record.licenseKey) return publicStatus(record)
      const payload = await verifyWithProvisioner({ email: record.email, licenseKey: record.licenseKey }, true)
      return store(
        activeRecordFromPayload(payload, record),
        'The license was verified, but the refreshed account balance could not be saved.',
      )
    },
    answerKnowledge: async (query: string, sessionName?: string): Promise<AutomniaKnowledgeAnswer> => {
      const record = current()
      if (!record?.active || !record.email || !record.licenseKey) {
        throw new LicenseServiceError('license_activation_failed', 'Activate an Automnia account before using the knowledge assistant.')
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), KNOWLEDGE_TIMEOUT_MS)
      try {
        const response = await request(`${apiBaseUrl}/api/knowledge/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            email: record.email,
            licenseKey: record.licenseKey,
            query,
            ...(sessionName?.trim() ? { sessionName: sessionName.trim() } : {}),
          }),
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null
        if (!response.ok || payload?.ok !== true) {
          const detail = typeof payload?.error === 'string' ? payload.error : 'The Automnia knowledge assistant did not accept the request.'
          // A knowledge-index rejection is not an expired desktop session.
          // Keep it out of the 401 auth-recovery path so Help can render the
          // service error in-place instead of making the whole shell reconnect.
          throw new LicenseServiceError('license_service_unavailable', detail)
        }
        return {
          grounded: payload.grounded === true,
          state: typeof payload.state === 'string' ? payload.state : null,
          answerText: typeof payload.answerText === 'string' ? payload.answerText : '',
          citations: Array.isArray(payload.citations) ? payload.citations : [],
          references: Array.isArray(payload.references) ? payload.references : [],
          skippedReasons: Array.isArray(payload.skippedReasons) ? payload.skippedReasons.filter((value): value is string => typeof value === 'string') : [],
          sessionName: typeof payload.sessionName === 'string' ? payload.sessionName : null,
        }
      } catch (error) {
        if (error instanceof LicenseServiceError) throw error
        throw new LicenseServiceError('license_service_unavailable', error instanceof Error && error.name === 'AbortError'
          ? 'The Automnia knowledge assistant did not respond in time.'
          : 'Unable to reach the Automnia knowledge assistant. Check your connection and try again.')
      } finally {
        clearTimeout(timer)
      }
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

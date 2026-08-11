import type { LicenseInfo } from '../context/licenseContextValue'

export const LICENSE_STATUS_UPDATED_EVENT = 'automnia-license-updated'

export type HostedCreditBalanceUpdate = {
  creditBalance: number
  creditBalanceUpdatedAt: string
  synchronized: boolean
}

export type LicenseEntitlement = {
  active: boolean
  mode: 'hosted_credits' | 'byok' | null
  kind: 'subscription' | 'hosted_refill' | 'byok' | 'inactive'
  isHosted: boolean
  isByok: boolean
  isSubscription: boolean
  isHostedRefill: boolean
  tierLabel: string
  billingLabel: string
  defaultRouteLabel: string
  statusLabel: string
}

const HOSTED_TIER_LABELS: Record<string, string> = {
  starter: 'Starter Subscription',
  cloud_starter_subscription: 'Starter Subscription',
  pro: 'Pro Subscription',
  pro_tier: 'Pro Subscription',
  enterprise: 'Enterprise Subscription',
  enterprise_tier: 'Enterprise Subscription',
  credit_pack_topup: 'Hosted Credit Refill',
  credit_refill: 'Hosted Credit Refill',
}

const BYOK_TIER_KEYS = new Set([
  'byok',
  'founding_beta_byok',
  'byok_one_time',
  'byok_one_time_access',
])

function normalizedTier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, '_') || ''
}

function humanizeTier(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function effectiveMode(license: LicenseInfo | null | undefined): LicenseEntitlement['mode'] {
  if (license?.active !== true) return null
  if (license.mode === 'hosted_credits' || license.mode === 'byok') return license.mode
  const tier = normalizedTier(license.tier)
  return BYOK_TIER_KEYS.has(tier) || tier.includes('byok') ? 'byok' : 'hosted_credits'
}

export function resolveLicenseEntitlement(license: LicenseInfo | null | undefined): LicenseEntitlement {
  const mode = effectiveMode(license)
  const active = license?.active === true && mode !== null
  const isHosted = active && mode === 'hosted_credits'
  const isByok = active && mode === 'byok'
  const tier = normalizedTier(license?.tier)

  if (isByok) {
    return {
      active,
      mode,
      kind: 'byok',
      isHosted,
      isByok,
      isSubscription: false,
      isHostedRefill: false,
      tierLabel: 'BYOK One-Time Access',
      billingLabel: 'BYOK One-Time Access — Your Provider Account',
      defaultRouteLabel: 'Your connected provider / OpenClaw runtime',
      statusLabel: 'One-time access active',
    }
  }

  if (isHosted) {
    const isHostedRefill = tier === 'credit_pack_topup' || tier === 'credit_refill'
    const knownLabel = HOSTED_TIER_LABELS[tier]
    const humanized = tier ? humanizeTier(tier) : ''
    const tierLabel = knownLabel || (humanized
      ? /subscription/i.test(humanized) ? humanized : `${humanized} Subscription`
      : 'Cloud Subscription')
    const providerFirst = license?.usagePriority === 'provider_first'
    return {
      active,
      mode,
      kind: isHostedRefill ? 'hosted_refill' : 'subscription',
      isHosted,
      isByok,
      isSubscription: !isHostedRefill,
      isHostedRefill,
      tierLabel,
      billingLabel: isHostedRefill
        ? 'Hosted Credits — Automnia Refill Balance'
        : 'Cloud Subscription — Automnia Credits',
      defaultRouteLabel: providerFirst
        ? 'My connected provider first → Automnia credits fallback'
        : 'Automnia credits first → My connected provider fallback',
      statusLabel: providerFirst ? 'Provider first active' : 'Credits first active',
    }
  }

  return {
    active: false,
    mode: null,
    kind: 'inactive',
    isHosted: false,
    isByok: false,
    isSubscription: false,
    isHostedRefill: false,
    tierLabel: 'No active license',
    billingLabel: 'Not active',
    defaultRouteLabel: 'Activate a license to choose a billing route',
    statusLabel: 'No active license',
  }
}

export function mergeHostedCreditBalance(
  license: LicenseInfo | null,
  creditBalance: number,
  creditBalanceUpdatedAt: string,
): LicenseInfo | null {
  if (!Number.isFinite(creditBalance) || creditBalance < 0) return license
  if (!resolveLicenseEntitlement(license).isHosted || !license) return license
  return {
    ...license,
    creditBalance,
    creditBalanceUpdatedAt,
  }
}

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
  kind: 'permanent' | 'subscription' | 'hosted_refill' | 'byok' | 'inactive'
  isHosted: boolean
  isByok: boolean
  isSubscription: boolean
  isHostedRefill: boolean
  byokAllowed: boolean
  usagePriorityLocked: boolean
  permanentAccess: boolean
  offlineByokAvailable: boolean
  tierLabel: string
  billingLabel: string
  defaultRouteLabel: string
  statusLabel: string
}

export type AgentRoutePresentation = {
  routeLabel: string
  modelLabel: string
  modelDescription: string
  managedRouteDescription: string
  managedRoute: boolean
  providerFirst: boolean
  providerOnly: boolean
}

const HOSTED_TIER_LABELS: Record<string, string> = {
  starter: 'Starter Subscription',
  cloud_starter_subscription: 'Starter Legacy Access',
  pro: 'Pro Access',
  pro_tier: 'Pro Access',
  enterprise: 'Enterprise Access',
  enterprise_tier: 'Enterprise Access',
  credit_pack_topup: 'Hosted Credit Refill',
  credit_refill: 'Hosted Credit Refill',
}

const BYOK_TIER_KEYS = new Set([
  'byok',
  'founding_beta_byok',
  'byok_one_time',
  'byok_one_time_access',
])

const REFILL_ONLY_TIER_KEYS = new Set([
  'credit_pack_topup',
  'credit_refill',
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

function tierAllowsByok(value: string | null | undefined) {
  const tier = normalizedTier(value)
  return Boolean(tier) && !REFILL_ONLY_TIER_KEYS.has(tier) && !tier.includes('starter')
}

function effectiveMode(license: LicenseInfo | null | undefined): LicenseEntitlement['mode'] {
  if (license?.active !== true) return null
  if (license.mode === 'hosted_credits' || license.mode === 'byok') return license.mode
  const tier = normalizedTier(license.tier)
  return BYOK_TIER_KEYS.has(tier) || tier.includes('byok') ? 'byok' : 'hosted_credits'
}

export function isStarterSubscriptionOnly(license: LicenseInfo | null | undefined) {
  const tier = normalizedTier(license?.tier)
  const isStarterTier = tier === 'starter' || tier === 'cloud_starter_subscription' || (tier.includes('starter') && !tier.includes('pro'))
  return effectiveMode(license) === 'hosted_credits' && isStarterTier
}

export function resolveLicenseEntitlement(license: LicenseInfo | null | undefined): LicenseEntitlement {
  const mode = effectiveMode(license)
  const active = license?.active === true && mode !== null
  const isHosted = active && mode === 'hosted_credits'
  const isByok = active && mode === 'byok'
  const tier = normalizedTier(license?.tier)
  const usagePriorityLocked = isStarterSubscriptionOnly(license)
  const byokAllowed = active && !usagePriorityLocked && (license?.byokAllowed === true || isByok || tierAllowsByok(tier))
  const permanentAccess = active && !usagePriorityLocked && (license?.permanentAccess === true || isByok || tier.includes('pro') || tier.includes('enterprise'))

  if (isByok) {
    return {
      active,
      mode,
      kind: 'permanent',
      isHosted,
      isByok,
      isSubscription: false,
      isHostedRefill: false,
      byokAllowed: true,
      permanentAccess: true,
      offlineByokAvailable: true,
      usagePriorityLocked: false,
      tierLabel: 'BYOK Access',
      billingLabel: 'Permanent BYOK access — Your Provider Account',
      defaultRouteLabel: 'Your connected provider / OpenClaw runtime',
      statusLabel: 'Permanent access active',
    }
  }

  if (isHosted) {
    const isHostedRefill = tier === 'credit_pack_topup' || tier === 'credit_refill'
    const knownLabel = HOSTED_TIER_LABELS[tier]
    const humanized = tier ? humanizeTier(tier) : ''
    const tierLabel = knownLabel || (humanized
      ? /subscription/i.test(humanized) ? humanized : `${humanized} Subscription`
      : 'Cloud Subscription')
    const providerFirst = !usagePriorityLocked && license?.usagePriority === 'provider_first'
    const providerOnly = !usagePriorityLocked && license?.usagePriority === 'byok_only'
    return {
      active,
      mode,
      kind: isHostedRefill ? 'hosted_refill' : permanentAccess ? 'permanent' : 'subscription',
      isHosted,
      isByok,
      isSubscription: !isHostedRefill && !permanentAccess,
      isHostedRefill,
      byokAllowed,
      usagePriorityLocked,
      permanentAccess,
      offlineByokAvailable: Boolean(byokAllowed),
      tierLabel,
      billingLabel: isHostedRefill
        ? 'Hosted Credits — Automnia Refill Balance'
        : permanentAccess ? 'Permanent Automnia access — Credits' : 'Cloud Subscription — Automnia Credits',
      defaultRouteLabel: providerFirst
        ? 'My connected provider → Subscription Relay'
        : providerOnly
          ? 'My connected provider'
          : 'Subscription Relay',
      statusLabel: providerFirst
        ? 'Provider first · relay available'
        : providerOnly
          ? 'Provider-only active'
          : permanentAccess ? 'Permanent access active' : 'Subscription relay active',
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
    byokAllowed: false,
    usagePriorityLocked: false,
    permanentAccess: false,
    offlineByokAvailable: false,
    tierLabel: 'No active license',
    billingLabel: 'Not active',
    defaultRouteLabel: 'Activate a license to choose a billing route',
    statusLabel: 'No active license',
  }
}

/**
 * Keep the agent model editor focused on the route an end user selected.
 * Provider models remain persisted in the agent-local config so switching
 * back to BYOK/provider-first mode does not discard the user's choices.
 */
export function resolveAgentRoutePresentation(license: LicenseInfo | null | undefined): AgentRoutePresentation {
  const entitlement = resolveLicenseEntitlement(license)
  const providerFirst = entitlement.isHosted && !entitlement.usagePriorityLocked && license?.usagePriority === 'provider_first'
  const providerOnly = entitlement.isHosted && !entitlement.usagePriorityLocked && license?.usagePriority === 'byok_only'

  if (entitlement.isHosted) {
    return {
      routeLabel: providerOnly ? 'My Provider' : 'Subscription Relay',
      modelLabel: providerFirst || providerOnly ? 'Primary Provider Model' : 'Automnia',
      modelDescription: providerFirst
        ? 'Your connected provider runs first. Subscription Relay remains available for the same agent.'
        : providerOnly
          ? 'Your connected provider bills this agent directly. Subscription credits are bypassed.'
          : 'Automnia manages model selection for this subscription.',
      managedRouteDescription: providerFirst
        ? 'Subscription Relay is available when your connected provider cannot complete the request.'
        : providerOnly
          ? 'Automnia subscription credits are bypassed while provider-only mode is active.'
          : 'Subscription Relay · model selection is managed automatically.',
      managedRoute: !providerFirst && !providerOnly,
      providerFirst,
      providerOnly,
    }
  }

  if (entitlement.isByok) {
    return {
      routeLabel: 'Automnia',
      modelLabel: 'Primary Model',
      modelDescription: 'This agent uses the provider account selected below.',
      managedRouteDescription: '',
      managedRoute: false,
      providerFirst: false,
      providerOnly: true,
    }
  }

  return {
    routeLabel: 'Automnia',
    modelLabel: 'Primary Model',
    modelDescription: 'Activate a Cloud Subscription or BYOK license before using this agent.',
    managedRouteDescription: '',
    managedRoute: false,
    providerFirst: false,
    providerOnly: false,
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

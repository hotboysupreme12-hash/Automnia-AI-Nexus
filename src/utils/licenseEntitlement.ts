import type { LicenseInfo } from '../context/licenseContextValue'

export const LICENSE_STATUS_UPDATED_EVENT = 'automnia-license-updated'

export const AUTOMNIA_CREDITS_MODEL_ID = 'automnia-cloud/gemini-3.6-flash'

export function isAutomniaCreditsModelId(value: string | null | undefined) {
  return value?.trim().toLowerCase() === AUTOMNIA_CREDITS_MODEL_ID
}

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

function usesProviderWhenAutomniaCreditsAreExhausted(
  license: LicenseInfo | null | undefined,
  usagePriorityLocked: boolean,
  byokAllowed: boolean,
) {
  return !usagePriorityLocked
    && byokAllowed
    && license?.creditBalance === 0
    && (license.usagePriority === 'automnia_only' || license.usagePriority === 'automnia_first')
}

function effectiveMode(license: LicenseInfo | null | undefined): LicenseEntitlement['mode'] {
  if (license?.active !== true) return null
  if (license.mode === 'hosted_credits' || license.mode === 'byok') return license.mode
  const tier = normalizedTier(license.tier)
  return BYOK_TIER_KEYS.has(tier) || tier.includes('byok') ? 'byok' : 'hosted_credits'
}

export function isStarterSubscriptionOnly(license: LicenseInfo | null | undefined) {
  const tier = normalizedTier(license?.tier)
  const isStarterTier = tier === 'starter'
    || tier === 'cloud_starter_subscription'
    || (tier.includes('starter') && !tier.includes('pro'))
    || (license?.planPriceCents === 1_999 && !tier)
  return effectiveMode(license) === 'hosted_credits' && isStarterTier
}

export function isCreditsOnlyEntitlement(license: LicenseInfo | null | undefined) {
  const tier = normalizedTier(license?.tier)
  return effectiveMode(license) === 'hosted_credits' && (isStarterSubscriptionOnly(license) || REFILL_ONLY_TIER_KEYS.has(tier))
}

export function resolveLicenseEntitlement(license: LicenseInfo | null | undefined): LicenseEntitlement {
  const mode = effectiveMode(license)
  const active = license?.active === true && mode !== null
  const isHosted = active && mode === 'hosted_credits'
  const isByok = active && mode === 'byok'
  const tier = normalizedTier(license?.tier)
  const usagePriorityLocked = isCreditsOnlyEntitlement(license)
  const byokAllowed = active && !usagePriorityLocked && (license?.byokAllowed === true || isByok || tierAllowsByok(tier))
  const permanentAccess = active && !usagePriorityLocked && (license?.permanentAccess === true || isByok || tier.includes('pro') || tier.includes('enterprise'))

  if (isByok) {
    const providerFirst = license?.usagePriority === 'provider_first' || license?.usagePriority === 'byok_only'
    const automniaFirstWithFallback = license?.usagePriority === 'automnia_first_with_provider_fallback'
    const exhaustedProviderFallback = usesProviderWhenAutomniaCreditsAreExhausted(license, false, true)
    const providerOnly = false
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
      defaultRouteLabel: providerOnly
        ? 'Legacy provider-only route — choose My provider + Automnia credits'
        : providerFirst
        ? 'Your connected provider → Automnia credits fallback'
        : automniaFirstWithFallback
          ? 'Automnia credits → your connected provider fallback'
            : exhaustedProviderFallback
              ? 'Your connected provider — Automnia credits exhausted'
            : 'Automnia credits only',
      statusLabel: providerOnly
        ? 'Legacy route — update Usage Priority'
        : providerFirst || automniaFirstWithFallback || exhaustedProviderFallback
          ? 'Provider + Automnia active'
          : 'Automnia credits active',
    }
  }

  if (isHosted) {
    const isHostedRefill = tier === 'credit_pack_topup' || tier === 'credit_refill'
    const knownLabel = HOSTED_TIER_LABELS[tier]
    const humanized = tier ? humanizeTier(tier) : ''
    const tierLabel = knownLabel || (humanized
      ? /subscription/i.test(humanized) ? humanized : `${humanized} Subscription`
      : 'Cloud Subscription')
    const providerFirst = !usagePriorityLocked && (license?.usagePriority === 'provider_first' || license?.usagePriority === 'byok_only')
    const automniaFirstWithFallback = !usagePriorityLocked && license?.usagePriority === 'automnia_first_with_provider_fallback'
    const exhaustedProviderFallback = usesProviderWhenAutomniaCreditsAreExhausted(license, usagePriorityLocked, byokAllowed)
    const providerOnly = false
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
        ? 'My connected provider → Automnia credits fallback'
        : automniaFirstWithFallback
          ? 'Automnia credits → My connected provider fallback'
          : exhaustedProviderFallback
            ? 'My connected provider — Automnia credits exhausted'
          : providerOnly
            ? 'Legacy provider-only route — choose My provider + Automnia credits'
            : 'Automnia credits only',
      statusLabel: providerFirst || automniaFirstWithFallback || exhaustedProviderFallback
        ? 'Provider + Automnia active'
        : providerOnly
          ? 'Legacy route — update Usage Priority'
          : permanentAccess ? 'Automnia credits active' : 'Automnia credits route active',
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
  const selectedProviderFirst = (entitlement.isHosted || entitlement.isByok) && !entitlement.usagePriorityLocked && (license?.usagePriority === 'provider_first' || license?.usagePriority === 'byok_only')
  const selectedAutomniaFirstWithFallback = (entitlement.isHosted || entitlement.isByok) && !entitlement.usagePriorityLocked && license?.usagePriority === 'automnia_first_with_provider_fallback'
  const exhaustedProviderFallback = usesProviderWhenAutomniaCreditsAreExhausted(license, entitlement.usagePriorityLocked, entitlement.byokAllowed)
  const providerFirst = selectedProviderFirst || exhaustedProviderFallback
  const providerOnly = false

  if (entitlement.isHosted || entitlement.isByok) {
    return {
      routeLabel: providerOnly
        ? 'Legacy provider-only'
        : exhaustedProviderFallback
          ? 'My Provider — credits exhausted'
          : providerFirst
            ? 'My Provider → Automnia'
            : selectedAutomniaFirstWithFallback
              ? 'Automnia → My Provider'
              : 'Automnia credits',
      modelLabel: providerFirst || providerOnly ? 'Primary Provider Model' : 'Automnia',
      modelDescription: providerFirst
        ? exhaustedProviderFallback
          ? 'Your confirmed Automnia balance is zero, so your connected provider runs for this request.'
          : 'Your connected provider runs first. Automnia credits remain available as the same-account fallback.'
        : providerOnly
          ? 'Your connected provider bills this agent directly. Subscription credits are bypassed.'
        : selectedAutomniaFirstWithFallback
            ? 'Automnia credits run first. Your connected provider is the fallback.'
            : entitlement.isByok
              ? 'This agent uses Automnia credits only until you choose My provider + Automnia credits.'
              : 'This agent uses Automnia credits only.',
      managedRouteDescription: providerFirst
        ? exhaustedProviderFallback
          ? 'The connected provider is used until Automnia credits are restored.'
          : 'Automnia credits are available when your connected provider cannot complete the request.'
        : providerOnly
          ? 'Automnia subscription credits are bypassed while provider-only mode is active.'
        : selectedAutomniaFirstWithFallback
          ? 'Your connected provider is available when the Automnia route cannot complete the request.'
          : entitlement.isByok
            ? 'The Automnia credits-only route is active.'
            : 'Automnia credits-only route · model selection is managed automatically.',
      managedRoute: !providerFirst && !providerOnly && !selectedAutomniaFirstWithFallback,
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
  const entitlement = resolveLicenseEntitlement(license)
  if (!license || !entitlement.active || (!entitlement.isHosted && !entitlement.isByok)) return license
  return {
    ...license,
    creditBalance,
    creditBalanceUpdatedAt,
  }
}

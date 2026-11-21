export const AUTOMNIA_CREDITS_PROVIDER_ID = 'automnia-cloud'
export const AUTOMNIA_SWIFT_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.8-flash`
export const AUTOMNIA_CREDITS_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-4-hydrogen`
export const AUTOMNIA_PRO_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-4-neon`
export const AUTOMNIA_FRONTIER_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-4-carbon`

/** Migrate only the retired Automnia-hosted Argon ID, never direct providers. */
export function migrateRetiredAutomniaModelId(modelId: string) {
  return /^automnia-cloud\/gemini-4-argon$/i.test(modelId.trim()) ? AUTOMNIA_CREDITS_MODEL_ID : modelId
}

export function migrateRetiredAutomniaChannelModels(
  channels: Record<string, Record<string, string>> | undefined,
) {
  if (!channels) return channels
  return Object.fromEntries(Object.entries(channels).map(([channel, models]) => [
    channel,
    Object.fromEntries(Object.entries(models).map(([key, model]) => [key, migrateRetiredAutomniaModelId(model)])),
  ]))
}

// The relay can serve these named Automnia tiers for accounts using hosted
// credits. Credits users may choose any of the named Automnia tiers; the
// fallback chain remains bounded to Automnia-hosted candidates.
export const AUTOMNIA_RELAY_MODEL_IDS = [
  AUTOMNIA_FRONTIER_MODEL_ID,
  AUTOMNIA_PRO_MODEL_ID,
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_SWIFT_MODEL_ID,
] as const

export const AUTOMNIA_RELAY_MODEL_LABELS: Record<string, string> = {
  [AUTOMNIA_FRONTIER_MODEL_ID]: 'Automnia Frontier',
  [AUTOMNIA_PRO_MODEL_ID]: 'Automnia Pro',
  [AUTOMNIA_CREDITS_MODEL_ID]: 'Automnia Balanced',
  [AUTOMNIA_SWIFT_MODEL_ID]: 'Automnia Swift',
}

// These are hosted relay model IDs, not direct Google/Vertex routes. Keeping
// the fallback chain in this policy makes the credits-only boundary explicit
// everywhere the route is projected (Gateway, Telegram menus, and billing).
export const AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS = [
  AUTOMNIA_SWIFT_MODEL_ID,
] as const
export const AUTOMNIA_CREDITS_MODEL_IDS = [
  AUTOMNIA_CREDITS_MODEL_ID,
  ...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
] as const

const FRONTIER_TIER_KEYS = new Set([
  'frontier',
  'frontier_tier',
  'automnia_frontier',
])

const FRONTIER_ELIGIBLE_TIER_KEYS = new Set([
  'pro',
  'pro_tier',
  'enterprise',
  'enterprise_tier',
])

export function isAutomniaFrontierTier(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return FRONTIER_TIER_KEYS.has(normalized) || normalized.endsWith('_frontier')
}

export function isAutomniaFrontierEligibleTier(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return isAutomniaFrontierTier(normalized)
    || FRONTIER_ELIGIBLE_TIER_KEYS.has(normalized)
    || normalized === 'pro_access'
    || normalized === 'enterprise_access'
    || normalized.startsWith('pro_')
    || normalized.startsWith('enterprise_')
}

export function isAutomniaFrontierModelId(value: unknown) {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === AUTOMNIA_FRONTIER_MODEL_ID
}

export function isAutomniaProModelId(value: unknown) {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === AUTOMNIA_PRO_MODEL_ID
}

export function automniaHostedModelIdsForTier(tier: unknown) {
  return AUTOMNIA_RELAY_MODEL_IDS.filter((modelId) =>
    (!isAutomniaFrontierModelId(modelId) && !isAutomniaProModelId(modelId)) || isAutomniaFrontierEligibleTier(tier),
  )
}

export const CREDITS_ONLY_MODEL_ACCESS_MESSAGE =
  'Starter Subscription is locked to Automnia credits only. Connect your own provider or choose a provider model after upgrading to a BYOK-eligible tier.'

export const AUTOMNIA_FRONTIER_MODEL_ACCESS_MESSAGE =
  'Automnia Frontier requires a Pro, Enterprise, or Automnia Frontier entitlement. Choose Automnia Balanced or connect an eligible provider instead.'
export const AUTOMNIA_PRO_MODEL_ACCESS_MESSAGE =
  'Automnia Pro requires a Pro, Enterprise, or Automnia Frontier entitlement. Choose Automnia Balanced or connect an eligible provider instead.'

export type CreditsOnlyModelSelection = {
  primary: string
  fallbacks?: string[]
}

export function isAutomniaCreditsModelId(value: unknown) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return AUTOMNIA_CREDITS_MODEL_IDS.some((modelId) => modelId === normalized)
}

export function isAutomniaRelayModelId(value: unknown) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return AUTOMNIA_RELAY_MODEL_IDS.some((modelId) => modelId === normalized)
}

export function creditsOnlyModelSelection(): CreditsOnlyModelSelection {
  return {
    primary: AUTOMNIA_CREDITS_MODEL_ID,
    fallbacks: [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS],
  }
}

export function filterCreditsOnlyModels<T extends { id?: unknown }>(models: T[]) {
  return models.filter((model) => isAutomniaCreditsModelId(model.id))
}

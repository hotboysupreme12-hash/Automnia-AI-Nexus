export const AUTOMNIA_CREDITS_PROVIDER_ID = 'automnia-cloud'
export const AUTOMNIA_CREDITS_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.8-flash`

// The relay can serve these named Automnia tiers for accounts using hosted
// credits. Credits users may choose any of the named Automnia tiers; the
// fallback chain remains bounded to Automnia-hosted candidates.
export const AUTOMNIA_RELAY_MODEL_IDS = [
  AUTOMNIA_CREDITS_MODEL_ID,
  `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.7-flash`,
  `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.6-flash`,
] as const

export const AUTOMNIA_RELAY_MODEL_LABELS: Record<string, string> = {
  [`${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.8-flash`]: 'Automnia Prime',
  [`${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.7-flash`]: 'Automnia Balanced',
  [`${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.6-flash`]: 'Automnia Swift',
  [`${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-2.5-flash`]: 'Automnia Classic',
}

// These are hosted relay model IDs, not direct Google/Vertex routes. Keeping
// the fallback chain in this policy makes the credits-only boundary explicit
// everywhere the route is projected (Gateway, Telegram menus, and billing).
export const AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS = [
  `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.6-flash`,
  `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-2.5-flash`,
] as const
export const AUTOMNIA_CREDITS_MODEL_IDS = [
  AUTOMNIA_CREDITS_MODEL_ID,
  `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.7-flash`,
  ...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
] as const

export const CREDITS_ONLY_MODEL_ACCESS_MESSAGE =
  'Starter Subscription is locked to Automnia credits only. Connect your own provider or choose a provider model after upgrading to a BYOK-eligible tier.'

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

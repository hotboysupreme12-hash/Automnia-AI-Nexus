import {
  AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
  isAutomniaCreditsModelId,
  isAutomniaRelayModelId,
} from './creditsOnlyModelPolicy'

export type UsagePriority =
  | 'automnia_only'
  | 'provider_first'
  | 'automnia_first_with_provider_fallback'
  /** Legacy values accepted while older local state is migrated. */
  | 'automnia_first'
  | 'byok_only'

export type UsagePriorityModelSelection = {
  primary?: string
  fallbacks?: string[]
}

export type UsagePriorityModelOrderOptions = {
  /** The last confirmed pooled Automnia balance. */
  automniaCreditBalance?: number | null
  /** A user-selected provider model must win over catalog insertion order. */
  preferredProviderModel?: string | null
  /** @deprecated Kept for compatibility; Automnia-only never auto-falls back. */
  allowProviderFallbackWhenCreditsExhausted?: boolean
}

/**
 * Add the billing-owned wildcard default for a channel without touching
 * explicit conversation mappings.
 */
export function withUsagePriorityChannelDefault(
  channelModels: Record<string, string> | undefined,
  selection: UsagePriorityModelSelection | undefined,
) {
  if (!selection?.primary) return channelModels
  return {
    ...(channelModels || {}),
    '*': selection.primary,
  }
}

function uniqueStrings(...values: unknown[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.flatMap((entry) => Array.isArray(entry) ? entry : [entry])) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function isAutomniaModel(modelId: string, automniaModelId: string) {
  const normalized = modelId.trim().toLowerCase()
  return normalized === automniaModelId.trim().toLowerCase() || normalized.startsWith('automnia-cloud/')
}

function automniaHostedFallbacks(automniaModelId: string, selectedPrimary?: string) {
  // Keep the fallback chain inside the Automnia-hosted boundary. Never infer
  // fallback IDs from a user/provider selection: that could widen a
  // credits-only route into a direct-provider request.
  if (!isAutomniaModel(automniaModelId, 'automnia-cloud/gemini-3.7-flash')) return []
  return [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS].filter((modelId) => modelId !== selectedPrimary)
}

function selectedAutomniaModel(selection: UsagePriorityModelSelection | undefined, automniaModelId: string) {
  const requested = typeof selection?.primary === 'string' ? selection.primary.trim() : ''
  return isAutomniaRelayModelId(requested) || isAutomniaCreditsModelId(requested) ? requested : automniaModelId
}

/**
 * Build the exact model chain allowed by the selected billing policy.
 *
 * The first non-Automnia model is the user's selected provider model. Older
 * provider fallbacks and generic resilience fallbacks are intentionally not
 * carried forward: a priority switch must never silently broaden the billing
 * route.
 */
export function applyUsagePriorityModelOrder(
  selection: UsagePriorityModelSelection | undefined,
  usagePriority: UsagePriority | null,
  providerCandidates: string[] = [],
  automniaModelId: string,
  options: UsagePriorityModelOrderOptions = {},
): UsagePriorityModelSelection | undefined {
  // Keep the configured provider list available for compatibility with
  // callers, but do not use it to invent a model for this agent's stack.
  void providerCandidates
  const selectedProviderModel = uniqueStrings(
    selection?.primary,
    ...(Array.isArray(selection?.fallbacks) ? selection.fallbacks : []),
  ).find((modelId) => !isAutomniaModel(modelId, automniaModelId))
  // The model stack selected in the agent editor is the source of truth.
  // `preferredProviderModel` is retained in the options type for persisted
  // account compatibility, but it must never inject a provider model that the
  // user did not select for this agent. In particular, an old Luna preference
  // must not replace a selected Automnia Frontier primary and make the UI and
  // the actual Gateway turn disagree.
  void options.preferredProviderModel
  const providerModel = selectedProviderModel

  if (usagePriority === 'automnia_only' || usagePriority === 'automnia_first') {
    // Automnia-only is an explicit billing choice. A zero balance must not
    // silently convert it into provider usage; provider fallback is opt-in
    // through the combined Automnia-first route below.
    const hasExplicitFallbacks = Array.isArray(selection?.fallbacks)
    const primary = selectedAutomniaModel(selection, automniaModelId)
    const fallbacks = hasExplicitFallbacks
      ? uniqueStrings(...(selection?.fallbacks || []))
        .filter((modelId) => isAutomniaModel(modelId, automniaModelId) && modelId.toLowerCase() !== primary.toLowerCase())
      : automniaHostedFallbacks(automniaModelId, primary)
    return {
      primary,
      ...(fallbacks.length ? { fallbacks } : {}),
    }
  }

  if (usagePriority === 'automnia_first_with_provider_fallback') {
    const primary = selectedAutomniaModel(selection, automniaModelId)
    const hasExplicitFallbacks = Array.isArray(selection?.fallbacks)
    const hostedFallbacks = hasExplicitFallbacks ? [] : automniaHostedFallbacks(automniaModelId, primary)
    const requestedFallbacks = hasExplicitFallbacks ? selection?.fallbacks || [] : []
    const fallbacks = uniqueStrings(...requestedFallbacks, ...hostedFallbacks, ...(hasExplicitFallbacks ? [] : [providerModel]))
      .filter((modelId) => modelId.toLowerCase() !== primary.toLowerCase())
    return {
      primary,
      ...(fallbacks.length ? { fallbacks } : {}),
    }
  }

  if (usagePriority === 'provider_first') {
    // A provider-first preference changes the order only when the agent stack
    // contains a provider model. If the stack contains only Automnia models,
    // preserve the explicit selection instead of silently injecting the first
    // configured provider (historically gpt-5.6-luna).
    if (!providerModel) {
      return selection ? {
        primary: selectedAutomniaModel(selection, automniaModelId),
        ...(Array.isArray(selection.fallbacks) && selection.fallbacks.length
          ? { fallbacks: uniqueStrings(...selection.fallbacks).filter((modelId) => !isAutomniaModel(modelId, automniaModelId) || modelId.toLowerCase() !== selectedAutomniaModel(selection, automniaModelId).toLowerCase()) }
          : {}),
      } : undefined
    }
    const hasExplicitFallbacks = Array.isArray(selection?.fallbacks)
    const requestedFallbacks = hasExplicitFallbacks
      ? (selection?.fallbacks || [])
      : options.automniaCreditBalance === 0
        ? []
        : [automniaModelId, ...automniaHostedFallbacks(automniaModelId)]
    const fallbacks = uniqueStrings(...requestedFallbacks)
      .filter((modelId) => modelId.toLowerCase() !== providerModel.toLowerCase())
      .filter((modelId) => options.automniaCreditBalance !== 0 || !isAutomniaModel(modelId, automniaModelId))
    return {
      primary: providerModel,
      ...(fallbacks.length ? { fallbacks } : {}),
    }
  }

  if (usagePriority === 'byok_only') {
    // BYOK-only must contain no Automnia model and no legacy provider retry.
    return providerModel ? { primary: providerModel } : undefined
  }

  return { primary: automniaModelId }
}

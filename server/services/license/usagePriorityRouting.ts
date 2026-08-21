import { AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS } from './creditsOnlyModelPolicy'

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
  /** Keep credits-only entitlements from gaining a provider route. */
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

function automniaHostedFallbacks(automniaModelId: string) {
  // The active billing route always uses the canonical Automnia primary. Do
  // not infer fallback IDs from a user/provider selection: that could widen a
  // credits-only route into a direct-provider request.
  if (!isAutomniaModel(automniaModelId, 'automnia-cloud/gemini-3.7-flash')) return []
  return [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS]
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
  const providerModel = uniqueStrings(
    selection?.primary,
    ...(Array.isArray(selection?.fallbacks) ? selection.fallbacks : []),
    ...providerCandidates,
  ).find((modelId) => !isAutomniaModel(modelId, automniaModelId))

  if (usagePriority === 'automnia_only' || usagePriority === 'automnia_first') {
    if (options.allowProviderFallbackWhenCreditsExhausted !== false
      && options.automniaCreditBalance === 0
      && providerModel) {
      return { primary: providerModel }
    }

    return {
      primary: automniaModelId,
      fallbacks: automniaHostedFallbacks(automniaModelId),
    }
  }

  if (usagePriority === 'automnia_first_with_provider_fallback') {
    const hostedFallbacks = automniaHostedFallbacks(automniaModelId)
    const fallbacks = uniqueStrings(...hostedFallbacks, providerModel)
    return {
      primary: automniaModelId,
      ...(fallbacks.length ? { fallbacks } : {}),
    }
  }

  if (usagePriority === 'provider_first') {
    // Fail closed when no provider model exists. Falling back to Automnia as
    // the primary here would violate an explicit provider-first choice.
    return providerModel
      ? {
          primary: providerModel,
          ...(options.automniaCreditBalance === 0
            ? {}
            : { fallbacks: uniqueStrings(automniaModelId, ...automniaHostedFallbacks(automniaModelId)) }),
        }
      : undefined
  }

  if (usagePriority === 'byok_only') {
    // BYOK-only must contain no Automnia model and no legacy provider retry.
    return providerModel ? { primary: providerModel } : undefined
  }

  return { primary: automniaModelId }
}

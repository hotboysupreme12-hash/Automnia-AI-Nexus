export type ModelReasoningDefault = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const MAX_MODEL_REASONING_DEFAULT_CACHE_ENTRIES = 256

type CacheEntry = {
  metadataFingerprint: string
  value: ModelReasoningDefault | undefined
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]))
  }
  return value
}

function fingerprint(metadata: unknown) {
  return JSON.stringify(stableValue(metadata))
}

export function createModelReasoningDefaultCache(maxEntries = MAX_MODEL_REASONING_DEFAULT_CACHE_ENTRIES) {
  const limit = Math.max(1, Math.floor(Number.isFinite(maxEntries) ? maxEntries : MAX_MODEL_REASONING_DEFAULT_CACHE_ENTRIES))
  const entries = new Map<string, CacheEntry>()

  return {
    resolve(
      provider: string,
      modelId: string,
      normalizedMetadata: unknown,
      resolver: () => ModelReasoningDefault | undefined,
    ): ModelReasoningDefault | undefined {
      const normalizedProvider = provider.trim().toLowerCase()
      const normalizedModelId = modelId.trim().toLowerCase()
      if (!normalizedProvider || !normalizedModelId) return resolver()
      const key = `${normalizedProvider}/${normalizedModelId}`
      const metadataFingerprint = fingerprint(normalizedMetadata)
      const existing = entries.get(key)
      if (existing?.metadataFingerprint === metadataFingerprint) {
        entries.delete(key)
        entries.set(key, existing)
        return existing.value
      }

      const value = resolver()
      entries.delete(key)
      entries.set(key, { metadataFingerprint, value })
      while (entries.size > limit) entries.delete(entries.keys().next().value as string)
      return value
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

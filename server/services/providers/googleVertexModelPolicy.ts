/**
 * Google Vertex Gemini model limits used by OpenClaw's context and compaction
 * planners.
 *
 * Vertex exposes a large context window, but the Gemini generate-content
 * endpoint has a separate maximum output-token limit. Keeping both values in
 * the model catalog prevents compaction from deriving an invalid request from
 * a large reserve-token setting.
 */
export const GOOGLE_VERTEX_CONTEXT_TOKENS = 1_048_576
export const GOOGLE_VERTEX_MAX_OUTPUT_TOKENS = 65_536

type GoogleVertexModelConfig = Record<string, unknown>

export function applyGoogleVertexModelLimits(providerConfig: Record<string, unknown>) {
  const models = providerConfig.models
  if (!Array.isArray(models)) return false

  let changed = false
  providerConfig.models = models.map((model) => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) return model
    const entry = model as GoogleVertexModelConfig
    if (typeof entry.id !== 'string' || !entry.id.trim()) return model

    const next = { ...entry }
    if (next.contextWindow !== GOOGLE_VERTEX_CONTEXT_TOKENS) {
      next.contextWindow = GOOGLE_VERTEX_CONTEXT_TOKENS
      changed = true
    }
    if (next.contextTokens !== GOOGLE_VERTEX_CONTEXT_TOKENS) {
      next.contextTokens = GOOGLE_VERTEX_CONTEXT_TOKENS
      changed = true
    }

    const configuredMaxTokens = typeof next.maxTokens === 'number' && Number.isFinite(next.maxTokens)
      ? Math.floor(next.maxTokens)
      : undefined
    const safeMaxTokens = configuredMaxTokens === undefined
      ? GOOGLE_VERTEX_MAX_OUTPUT_TOKENS
      : Math.min(configuredMaxTokens, GOOGLE_VERTEX_MAX_OUTPUT_TOKENS)
    if (next.maxTokens !== safeMaxTokens) {
      next.maxTokens = safeMaxTokens
      changed = true
    }

    return next
  })

  return changed
}

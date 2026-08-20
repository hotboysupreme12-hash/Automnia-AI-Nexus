/**
 * Shared compatibility rules for the native Google Gemini and Google Vertex
 * transports. Keep these rules provider-agnostic so direct streaming and the
 * Gateway/OpenClaw path cannot drift apart when Google changes a model's
 * request contract.
 */

export type GoogleGeminiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

function normalizedGoogleGeminiModel(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/^publishers\/google\/models\//, '')
    .replace(/^models\//, '')
    .replace(/^(?:google|google-vertex)\//, '')
}

export function isGoogleGemini37FlashModel(model: string) {
  return /^gemini-3\.7-flash(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

/**
 * Gemini 3.7 Flash supports LOW, MEDIUM, and HIGH thinking levels. The app's
 * broader thinking selector includes OFF and MINIMAL, so use LOW as the
 * closest valid low-latency request for those choices. Extended app levels
 * collapse to HIGH, matching the existing Gemini 3.x behavior.
 */
export function googleGeminiThinkingForModel(
  model: string,
  thinking: GoogleGeminiThinkingLevel,
): GoogleGeminiThinkingLevel {
  if (!isGoogleGemini37FlashModel(model)) return thinking
  if (thinking === 'off' || thinking === 'minimal') return 'low'
  if (thinking === 'xhigh' || thinking === 'max') return 'high'
  return thinking
}

/**
 * Google documents temperature/top-p/top-k as deprecated for the Gemini 3.6
 * and 3.7 Flash migration contract. The normal streaming requests already
 * omit them; direct artifact generation uses this predicate too.
 */
export function googleGeminiModelDisallowsCustomSampling(model: string) {
  const normalized = normalizedGoogleGeminiModel(model)
  return /^gemini-(?:3\.6|3\.7)-flash(?:$|[-@])/.test(normalized)
}

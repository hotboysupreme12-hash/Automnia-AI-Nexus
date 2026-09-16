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

export function isGoogleGemini38FlashModel(model: string) {
  return /^gemini-3\.8-flash(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini31ProModel(model: string) {
  return /^gemini-3\.1-pro-preview(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini35FlashLiteModel(model: string) {
  return /^gemini-3\.5-flash-lite(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

/**
 * Gemini 3.1 Pro Preview, 3.7 Flash, and 3.8 Flash support LOW, MEDIUM, and
 * HIGH thinking levels. The app's broader selector includes OFF and MINIMAL,
 * so use LOW as the closest valid request for those choices. Extended app
 * levels collapse to HIGH. Gemini 3.5 Flash-Lite deliberately keeps MINIMAL:
 * it is valid for that model.
 */
export function googleGeminiThinkingForModel(
  model: string,
  thinking: GoogleGeminiThinkingLevel,
): GoogleGeminiThinkingLevel {
  if (!isGoogleGemini31ProModel(model) && !isGoogleGemini37FlashModel(model) && !isGoogleGemini38FlashModel(model)) return thinking
  if (thinking === 'off' || thinking === 'minimal') return 'low'
  if (thinking === 'xhigh' || thinking === 'max') return 'high'
  return thinking
}

/**
 * Google documents temperature/top-p/top-k as unsupported or deprecated for
 * Gemini 3.5 Flash-Lite and the 3.6, 3.7, and 3.8 Flash migration contracts.
 * Normal streaming requests already omit them; direct artifact generation uses
 * this predicate too.
 */
export function googleGeminiModelDisallowsCustomSampling(model: string) {
  const normalized = normalizedGoogleGeminiModel(model)
  return /^(?:gemini-3\.5-flash-lite|gemini-3\.(?:6|7|8)-flash)(?:$|[-@])/.test(normalized)
}

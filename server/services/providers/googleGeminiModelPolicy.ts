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

/**
 * Google Gemini chat models in the supported generations accept inline image
 * input. Keep this separate from video/audio metadata because not every model
 * in those families accepts the same additional media types.
 */
export function googleGeminiSupportsImageInput(model: string) {
  const normalized = normalizedGoogleGeminiModel(model)
  return /^(?:gemini-1\.5-(?:pro|flash)|gemini-(?:[2-9](?:\.\d+)?)-(?:pro|flash|ultra|computer-use)|gemini-4-(?:hydrogen|argon|carbon))(?:$|[-@])/.test(normalized)
}

export function googleGeminiInputModalities(model: string) {
  const normalized = normalizedGoogleGeminiModel(model)
  if (!googleGeminiSupportsImageInput(normalized)) return ['text']
  if (/^(?:gemini-3\.8-flash|gemini-4-(?:hydrogen|carbon))(?:$|[-@])/.test(normalized)) {
    return ['text', 'image', 'audio', 'video']
  }
  return ['text', 'image']
}

export function isGoogleGemini37FlashModel(model: string) {
  return /^gemini-3\.7-flash(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini38FlashModel(model: string) {
  return /^gemini-3\.8-flash(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini4HydrogenModel(model: string) {
  return /^gemini-4-hydrogen(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini4ArgonModel(model: string) {
  return /^gemini-4-argon(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini4CarbonModel(model: string) {
  return /^gemini-4-carbon(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini31ProModel(model: string) {
  return /^gemini-3\.1-pro-preview(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

export function isGoogleGemini35FlashLiteModel(model: string) {
  return /^gemini-3\.5-flash-lite(?:$|[-@])/.test(normalizedGoogleGeminiModel(model))
}

/**
 * Gemini 4 Hydrogen additionally supports XHIGH. Gemini 4 Argon and Carbon,
 * Gemini 3.1 Pro Preview, and Gemini 3.7/3.8 Flash support LOW, MEDIUM, and
 * HIGH. The app's broader selector includes OFF and MINIMAL, so use LOW as
 * the closest valid request for those choices. Extended levels map to the
 * model's highest supported level. Gemini 3.5 Flash-Lite keeps MINIMAL.
 */
export function googleGeminiThinkingForModel(
  model: string,
  thinking: GoogleGeminiThinkingLevel,
): GoogleGeminiThinkingLevel {
  if (isGoogleGemini4HydrogenModel(model)) {
    if (thinking === 'off' || thinking === 'minimal') return 'low'
    if (thinking === 'max') return 'xhigh'
    return thinking
  }
  const isGemini4StandardReasoning = isGoogleGemini4ArgonModel(model) || isGoogleGemini4CarbonModel(model)
  if (!isGemini4StandardReasoning && !isGoogleGemini31ProModel(model) && !isGoogleGemini37FlashModel(model) && !isGoogleGemini38FlashModel(model)) return thinking
  if (thinking === 'off' || thinking === 'minimal') return 'low'
  if (thinking === 'xhigh' || thinking === 'max') return 'high'
  return thinking
}

/**
 * Google documents temperature/top-p/top-k as unsupported or deprecated for
 * Gemini 3.5 Flash-Lite and the Gemini 3.6/3.7/3.8 Flash and Gemini 4 model
 * request contracts. Normal streaming requests already omit them; direct
 * artifact generation uses this predicate too.
 */
export function googleGeminiModelDisallowsCustomSampling(model: string) {
  const normalized = normalizedGoogleGeminiModel(model)
  return /^(?:gemini-3\.5-flash-lite|gemini-3\.(?:6|7|8)-flash|gemini-4-(?:hydrogen|argon|carbon))(?:$|[-@])/.test(normalized)
}

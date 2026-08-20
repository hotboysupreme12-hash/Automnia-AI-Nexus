const GEMINI_36_NATIVE_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);
const GEMINI_37_NATIVE_THINKING_LEVELS = new Set(['low', 'medium', 'high']);

/**
 * Converts OpenAI-compatible reasoning effort to the selected Gemini Flash
 * model's native Vertex setting. Gemini does not provide a complete
 * thinking-off mode: Gemini 3.6 uses MINIMAL, while Gemini 3.7's lowest
 * supported setting is LOW.
 */
export function geminiThinkingConfigFromOpenAiRequest(requestBody, model = 'gemini-3.6-flash') {
  const raw = typeof requestBody?.reasoning_effort === 'string'
    ? requestBody.reasoning_effort.trim().toLowerCase()
    : '';

  if (!raw) return undefined;

  const normalizedModel = String(model || '').trim().toLowerCase();
  const isGemini37Flash = /(?:^|\/)gemini-3\.7-flash(?:$|[-@])/.test(normalizedModel);
  const nativeLevels = isGemini37Flash ? GEMINI_37_NATIVE_THINKING_LEVELS : GEMINI_36_NATIVE_THINKING_LEVELS;
  const lowestLevel = isGemini37Flash ? 'low' : 'minimal';

  const level = raw === 'off' || raw === 'none'
    ? lowestLevel
    : raw === 'xhigh' || raw === 'max' || raw === 'ultra'
      ? 'high'
      : raw === 'minimal' && isGemini37Flash
        ? lowestLevel
      : nativeLevels.has(raw)
        ? raw
        : undefined;

  return level ? { thinkingLevel: level.toUpperCase() } : undefined;
}

// Keep the old named import valid for local callers while the relay supports
// both its historical 3.6 contract and the active 3.7 deployment contract.
export const gemini36ThinkingConfigFromOpenAiRequest = geminiThinkingConfigFromOpenAiRequest;

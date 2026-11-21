const GEMINI_38_NATIVE_THINKING_LEVELS = new Set(['low', 'medium', 'high']);
const GEMINI_4_NATIVE_THINKING_LEVELS = new Set(['low', 'medium', 'high']);
const GEMINI_4_HYDROGEN_NATIVE_THINKING_LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);

/**
 * Converts OpenAI-compatible reasoning effort to the selected Gemini model's
 * native Vertex setting. Gemini 3.8 Flash, Argon, and Carbon support LOW,
 * MEDIUM, and HIGH; Hydrogen and Neon also support XHIGH. None provides a complete
 * thinking-off mode, so OFF and MINIMAL map to LOW.
 */
export function geminiThinkingConfigFromOpenAiRequest(requestBody, model = 'gemini-4-hydrogen') {
  const raw = typeof requestBody?.reasoning_effort === 'string'
    ? requestBody.reasoning_effort.trim().toLowerCase()
    : '';

  if (!raw) return undefined;

  const normalizedModel = String(model || '').trim().toLowerCase();
  const isGemini4ExtendedThinking = /(?:^|\/)gemini-4-(?:hydrogen|neon)(?:$|[-@])/.test(normalizedModel);
  const isGemini4 = /(?:^|\/)gemini-4-(?:hydrogen|neon|argon|carbon)(?:$|[-@])/.test(normalizedModel);
  const isGemini38Flash = /(?:^|\/)gemini-3\.8-flash(?:$|[-@])/.test(normalizedModel);
  const nativeLevels = isGemini4ExtendedThinking
    ? GEMINI_4_HYDROGEN_NATIVE_THINKING_LEVELS
    : isGemini4
      ? GEMINI_4_NATIVE_THINKING_LEVELS
      : GEMINI_38_NATIVE_THINKING_LEVELS;
  const lowestLevel = 'low';

  const level = raw === 'off' || raw === 'none'
    ? lowestLevel
    : (raw === 'xhigh' || raw === 'max' || raw === 'ultra') && isGemini4ExtendedThinking
      ? 'xhigh'
    : (raw === 'xhigh' || raw === 'max' || raw === 'ultra') && !isGemini4ExtendedThinking
      ? 'high'
      : raw === 'minimal' && (isGemini38Flash || isGemini4)
        ? lowestLevel
      : nativeLevels.has(raw)
        ? raw
        : undefined;

  return level ? { thinkingLevel: level.toUpperCase() } : undefined;
}

// Keep the old named import valid for local callers while the relay supports
// both its historical 3.6 contract and the active 3.7 deployment contract.
export const gemini36ThinkingConfigFromOpenAiRequest = geminiThinkingConfigFromOpenAiRequest;

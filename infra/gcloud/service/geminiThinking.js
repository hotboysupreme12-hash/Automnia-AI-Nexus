const GEMINI_36_NATIVE_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);

/**
 * Converts OpenAI-compatible reasoning effort to Gemini 3.6 Flash's native
 * Vertex setting. Gemini does not provide a complete thinking-off mode, so
 * `off` uses its documented closest equivalent: `MINIMAL`.
 */
export function gemini36ThinkingConfigFromOpenAiRequest(requestBody) {
  const raw = typeof requestBody?.reasoning_effort === 'string'
    ? requestBody.reasoning_effort.trim().toLowerCase()
    : '';

  if (!raw) return undefined;

  const level = raw === 'off' || raw === 'none'
    ? 'minimal'
    : raw === 'xhigh' || raw === 'max' || raw === 'ultra'
      ? 'high'
      : GEMINI_36_NATIVE_THINKING_LEVELS.has(raw)
        ? raw
        : undefined;

  return level ? { thinkingLevel: level.toUpperCase() } : undefined;
}

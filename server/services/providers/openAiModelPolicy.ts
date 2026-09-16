/**
 * Shared request compatibility rules for OpenAI models. Keep the model-specific
 * conversions here so Chat Completions and Responses cannot send a selector
 * value that the current model API rejects.
 */

export type OpenAiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

function normalizedOpenAiModel(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(?:openai|openai-codex|codex)\//, '')
}

export function isOpenAiAstraModel(model: string) {
  return /^gpt-6-astra(?:$|[-@])/.test(normalizedOpenAiModel(model))
}

export function isOpenAiReasoningModel(model: string) {
  const normalized = normalizedOpenAiModel(model)
  return isOpenAiAstraModel(normalized) || /^(gpt-5|o[1-9]|gpt-oss)/.test(normalized)
}

function parsedOpenAiGpt5Minor(model: string): number | null {
  const match = normalizedOpenAiModel(model).match(/^gpt-5(?:\.(\d+))?/)
  if (!match) return null
  return match[1] ? Number(match[1]) : 0
}

function openAiSupportsReasoningNone(model: string) {
  const minor = parsedOpenAiGpt5Minor(model)
  return minor !== null && minor >= 1
}

function openAiSupportsMinimalReasoning(model: string) {
  const minor = parsedOpenAiGpt5Minor(model)
  return minor !== null && minor >= 2
}

/**
 * GPT-6 Astra accepts low through max reasoning effort, but not none or
 * minimal. The product-wide selector intentionally retains those choices for
 * older providers, so map them to Astra's lowest valid effort.
 */
export function openAiReasoningEffortForModel(model: string, thinking: OpenAiThinkingLevel) {
  if (!isOpenAiReasoningModel(model)) return undefined
  if (isOpenAiAstraModel(model)) return openAiThinkingForRuntime(model, thinking)
  if (thinking === 'off') return openAiSupportsReasoningNone(model) ? 'none' : undefined
  if (thinking === 'minimal') return openAiSupportsMinimalReasoning(model) ? 'minimal' : 'low'
  return thinking
}

/**
 * Gateway/OpenClaw model configuration uses the shared product thinking level
 * rather than an OpenAI request body. Keep Astra on the same valid lower bound
 * as the direct Responses and Chat Completions paths.
 */
export function openAiThinkingForRuntime(model: string, thinking: OpenAiThinkingLevel): OpenAiThinkingLevel {
  if (isOpenAiAstraModel(model) && (thinking === 'off' || thinking === 'minimal')) return 'low'
  return thinking
}

export function openAiChatCompletionsReasoningPatch(model: string, thinking: OpenAiThinkingLevel) {
  const effort = openAiReasoningEffortForModel(model, thinking)
  return effort ? { reasoning_effort: effort } : {}
}

export function openAiResponsesReasoningPatch(model: string, thinking: OpenAiThinkingLevel) {
  const effort = openAiReasoningEffortForModel(model, thinking)
  return effort ? { reasoning: { effort } } : {}
}

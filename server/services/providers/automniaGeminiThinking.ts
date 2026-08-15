export type AutomniaThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const AUTOMNIA_CLOUD_PROVIDER = 'automnia-cloud'
const AUTOMNIA_GEMINI_36_FLASH_MODEL = 'gemini-3.6-flash'

/**
 * Gemini 3.6 Flash accepts minimal, low, medium, and high thinking levels.
 * The Gateway's broader controls include xhigh and max, so collapse those
 * requests before OpenClaw validates the turn. The hosted relay translates
 * off to Gemini's closest supported low-thinking mode, minimal.
 */
export function thinkingForAutomniaGeminiRuntimeModel(
  modelId: string,
  thinking: AutomniaThinkingLevel,
): AutomniaThinkingLevel {
  const [rawProvider = '', ...rawModelParts] = modelId.trim().toLowerCase().split('/')
  const provider = rawProvider.trim()
  const model = rawModelParts.join('/').trim()
  if (provider !== AUTOMNIA_CLOUD_PROVIDER || model !== AUTOMNIA_GEMINI_36_FLASH_MODEL) return thinking

  return thinking === 'xhigh' || thinking === 'max' ? 'high' : thinking
}

export const AUTOMNIA_GEMINI_36_OPENCLAW_THINKING_LEVEL_MAP = {
  // Gemini 3.6 Flash always reasons. Its lowest supported setting is the
  // closest equivalent to the app's "off" choice.
  off: 'minimal',
  xhigh: 'high',
  max: 'high',
} as const

export const AUTOMNIA_GEMINI_36_OPENAI_REASONING_COMPAT = {
  supportsReasoningEffort: true,
  supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
  reasoningEffortMap: {
    // Gemini 3.6 Flash has no fully-disabled mode. Minimal is Google's
    // documented nearest equivalent for low-latency requests.
    off: 'minimal',
    // OpenClaw's OpenAI-compatible transport represents disabled thinking as
    // `none` while constructing the outbound request, so normalize that
    // internal spelling as well. This keeps the final relay request at
    // Gemini's supported MINIMAL level instead of omitting the setting.
    none: 'minimal',
    xhigh: 'high',
    max: 'high',
  },
} as const

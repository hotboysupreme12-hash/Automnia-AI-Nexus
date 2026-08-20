export type AutomniaThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const AUTOMNIA_CLOUD_PROVIDER = 'automnia-cloud'
const AUTOMNIA_GEMINI_37_FLASH_MODEL = 'gemini-3.7-flash'

/**
 * Gemini 3.7 Flash accepts low, medium, and high thinking levels. The
 * Gateway's broader controls include off, minimal, xhigh, and max, so map
 * those app choices to the closest valid 3.7 level before OpenClaw validates
 * the turn. The hosted relay performs the same translation at the Vertex
 * boundary.
 */
export function thinkingForAutomniaGeminiRuntimeModel(
  modelId: string,
  thinking: AutomniaThinkingLevel,
): AutomniaThinkingLevel {
  const [rawProvider = '', ...rawModelParts] = modelId.trim().toLowerCase().split('/')
  const provider = rawProvider.trim()
  const model = rawModelParts.join('/').trim()
  if (provider !== AUTOMNIA_CLOUD_PROVIDER || model !== AUTOMNIA_GEMINI_37_FLASH_MODEL) return thinking

  if (thinking === 'off' || thinking === 'minimal') return 'low'
  return thinking === 'xhigh' || thinking === 'max' ? 'high' : thinking
}

export const AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP = {
  // Gemini 3.7 Flash always reasons. Its lowest supported setting is the
  // closest equivalent to the app's "off" and "minimal" choices.
  off: 'low',
  minimal: 'low',
  xhigh: 'high',
  max: 'high',
} as const

export const AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT = {
  supportsReasoningEffort: true,
  supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
  reasoningEffortMap: {
    // Gemini 3.7 Flash has no fully-disabled mode. Low is Google's lowest
    // supported thinking level and the nearest equivalent for low latency.
    off: 'low',
    minimal: 'low',
    // OpenClaw's OpenAI-compatible transport represents disabled thinking as
    // `none` while constructing the outbound request, so normalize that
    // internal spelling as well. This keeps the final relay request at
    // Gemini's supported MINIMAL level instead of omitting the setting.
    none: 'low',
    xhigh: 'high',
    max: 'high',
  },
} as const

// Compatibility aliases keep older persisted OpenClaw patches and local test
// imports valid while the hosted Automnia model moves to Gemini 3.7.
export const AUTOMNIA_GEMINI_36_OPENCLAW_THINKING_LEVEL_MAP = AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP
export const AUTOMNIA_GEMINI_36_OPENAI_REASONING_COMPAT = AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT

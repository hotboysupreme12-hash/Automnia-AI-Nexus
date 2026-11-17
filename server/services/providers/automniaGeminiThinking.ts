export type AutomniaThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const AUTOMNIA_CLOUD_PROVIDER = 'automnia-cloud'
const AUTOMNIA_GEMINI_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-4-carbon',
])

const AUTOMNIA_GEMINI_THINKING_DEFAULTS: Record<string, Exclude<AutomniaThinkingLevel, 'off' | 'minimal' | 'max'>> = {
  'gemini-3.8-flash': 'medium',
  'gemini-4-hydrogen': 'high',
  'gemini-4-argon': 'medium',
  'gemini-4-carbon': 'medium',
}

export function automniaThinkingDefaultForModel(modelId: string): Exclude<AutomniaThinkingLevel, 'off' | 'minimal' | 'max'> | undefined {
  const [, ...parts] = modelId.trim().toLowerCase().split('/')
  return AUTOMNIA_GEMINI_THINKING_DEFAULTS[parts.join('/')]
}

/**
 * Gemini 3.8 Flash, Argon, and Carbon accept low, medium, and high thinking;
 * Hydrogen also accepts xhigh. Map the app's wider controls to each model's
 * valid range before OpenClaw validates the turn. The hosted relay applies
 * the same translation at the Vertex boundary.
 */
export function thinkingForAutomniaGeminiRuntimeModel(
  modelId: string,
  thinking: AutomniaThinkingLevel,
): AutomniaThinkingLevel {
  const [rawProvider = '', ...rawModelParts] = modelId.trim().toLowerCase().split('/')
  const provider = rawProvider.trim()
  const model = rawModelParts.join('/').trim()
  if (provider !== AUTOMNIA_CLOUD_PROVIDER || !AUTOMNIA_GEMINI_MODELS.has(model)) return thinking

  if (thinking === 'off' || thinking === 'minimal') return 'low'
  if (model === 'gemini-4-hydrogen' && thinking === 'max') return 'xhigh'
  if (model !== 'gemini-4-hydrogen' && (thinking === 'xhigh' || thinking === 'max')) return 'high'
  return thinking
}

export const AUTOMNIA_GEMINI_4_OPENCLAW_THINKING_LEVEL_MAP = {
  // Gemini 4 always reasons. LOW is the closest equivalent to "off" and
  // "minimal"; HIGH is the maximum for Argon and Carbon.
  off: 'low',
  minimal: 'low',
  xhigh: 'high',
  max: 'high',
} as const

export const AUTOMNIA_GEMINI_4_HYDROGEN_OPENCLAW_THINKING_LEVEL_MAP = {
  off: 'low',
  minimal: 'low',
  xhigh: 'xhigh',
  max: 'xhigh',
} as const

export const AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT = {
  supportsReasoningEffort: true,
  supportedReasoningEfforts: ['low', 'medium', 'high'],
  reasoningEffortMap: {
    // Gemini 4 has no fully-disabled mode. LOW is Google's lowest supported
    // thinking level and the closest low-latency choice.
    off: 'low',
    minimal: 'low',
    none: 'low',
    xhigh: 'high',
    max: 'high',
  },
} as const

export const AUTOMNIA_GEMINI_4_HYDROGEN_OPENAI_REASONING_COMPAT = {
  ...AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT,
  supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
  reasoningEffortMap: {
    ...AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT.reasoningEffortMap,
    xhigh: 'xhigh',
    max: 'xhigh',
  },
} as const

// Keep these exports for older generated/runtime patches that import them.
export const AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP = AUTOMNIA_GEMINI_4_OPENCLAW_THINKING_LEVEL_MAP
export const AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT = AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT

// Compatibility aliases keep older persisted OpenClaw patches and local test
// imports valid while the hosted Automnia model moves to Gemini 4.
export const AUTOMNIA_GEMINI_36_OPENCLAW_THINKING_LEVEL_MAP = AUTOMNIA_GEMINI_4_OPENCLAW_THINKING_LEVEL_MAP
export const AUTOMNIA_GEMINI_36_OPENAI_REASONING_COMPAT = AUTOMNIA_GEMINI_4_OPENAI_REASONING_COMPAT

const PROVIDER_LOGO_ASSETS: Record<string, string> = {
  'automnia-cloud': '/brand/automnia-ai-nexus-emblem-v2.png',
  openai: '/icons/providers/openai.png',
  anthropic: '/icons/providers/anthropic.png',
  google: '/icons/providers/google.png',
  deepseek: '/icons/providers/deepseek.png',
  openrouter: '/icons/providers/openrouter.png',
  xai: '/icons/providers/xai.png',
  mistral: '/icons/providers/mistral.png',
  groq: '/icons/providers/groq.png',
  meta: '/icons/providers/meta.png',
  cohere: '/icons/providers/cohere.png',
  perplexity: '/icons/providers/perplexity.png',
  together: '/icons/providers/together.png',
  'fireworks-ai': '/icons/providers/fireworks-ai.png',
  cerebras: '/icons/providers/cerebras.png',
  ollama: '/icons/providers/ollama.png',
  lmstudio: '/icons/providers/lmstudio.png',
}

const PROVIDER_LOGO_ALIASES: Record<string, string> = {
  automnia: 'automnia-cloud',
  'automnia-ai': 'automnia-cloud',
  'automnia-credits': 'automnia-cloud',
  codex: 'openai',
  'openai-codex': 'openai',
  'google-vertex': 'google',
  'google-ai-studio': 'google',
  'x-ai': 'xai',
  'mistral-ai': 'mistral',
  'together-ai': 'together',
  togetherai: 'together',
  fireworks: 'fireworks-ai',
  fireworksai: 'fireworks-ai',
  'fireworks-ai': 'fireworks-ai',
  'lm-studio': 'lmstudio',
  'lm-studio-local': 'lmstudio',
}

export function providerLogoKey(providerOrGroupKey: string): string {
  const rawKey = providerOrGroupKey.trim().toLowerCase()
  const providerKey = rawKey.startsWith('openrouter:')
    ? rawKey.slice('openrouter:'.length)
    : rawKey
  const normalizedKey = providerKey.replace(/[_\s]+/g, '-')
  const canonicalKey = PROVIDER_LOGO_ALIASES[normalizedKey] || normalizedKey
  return PROVIDER_LOGO_ASSETS[canonicalKey] ? canonicalKey : ''
}

export function providerLogoSrc(providerOrGroupKey: string): string {
  const key = providerLogoKey(providerOrGroupKey)
  return key ? PROVIDER_LOGO_ASSETS[key] : ''
}

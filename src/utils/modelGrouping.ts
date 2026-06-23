export type ModelOptionLike = {
  id: string
  alias?: string
  provider?: string
  name?: string
}

export type ModelOptionGroup<T extends ModelOptionLike> = {
  key: string
  label: string
  models: T[]
}

const PROVIDER_LABELS: Record<string, string> = {
  'openai-codex': 'OpenAI Codex',
  openai: 'OpenAI API',
  anthropic: 'Anthropic Claude',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  xai: 'xAI',
  mistral: 'Mistral',
  groq: 'Groq',
  meta: 'Meta',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  together: 'Together AI',
  fireworks: 'Fireworks',
  cerebras: 'Cerebras',
  ollama: 'Ollama',
  local: 'Local models',
  lmstudio: 'LM Studio',
}

const PROVIDER_ORDER = [
  'openai-codex',
  'openai',
  'anthropic',
  'google',
  'google-vertex',
  'deepseek',
  'openrouter',
  'xai',
  'mistral',
  'groq',
  'meta',
  'cohere',
  'perplexity',
  'together',
  'fireworks',
  'cerebras',
  'ollama',
  'lmstudio',
  'local',
]

const ROUTE_PROVIDER_IDS = new Set(Object.keys(PROVIDER_LABELS))

const clean = (value: string | undefined) => (value || '').trim()

const titleizeProvider = (provider: string) =>
  provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'ai') return 'AI'
      if (lower === 'api') return 'API'
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    })
    .join(' ')

export const modelProviderLabel = (provider: string) => {
  const normalized = provider.trim().toLowerCase()
  return PROVIDER_LABELS[normalized] || titleizeProvider(provider.trim() || 'Other')
}

const splitModelId = (modelId: string) => {
  const [provider = '', ...modelParts] = modelId.trim().split('/')
  return {
    provider: provider.trim().toLowerCase(),
    model: modelParts.join('/').trim(),
  }
}

const isOpenAiCodexSubscriptionModel = (modelId: string) => {
  const { provider, model } = splitModelId(modelId)
  return /^(openai|openai-codex|codex)$/i.test(provider) && /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model)
}

const modelProviderForGrouping = (model: ModelOptionLike) => {
  if (isOpenAiCodexSubscriptionModel(model.id)) return 'openai-codex'
  const explicitProvider = clean(model.provider).toLowerCase()
  const idProvider = splitModelId(model.id).provider
  const provider = idProvider && ROUTE_PROVIDER_IDS.has(idProvider) ? idProvider : explicitProvider || idProvider || 'other'
  if (provider === 'codex') return 'openai-codex'
  return provider
}

const openRouterUpstreamFor = (model: ModelOptionLike) => {
  const idParts = model.id.trim().split('/').filter(Boolean)
  if (idParts[0]?.toLowerCase() === 'openrouter' && idParts.length > 2) {
    return idParts[1].toLowerCase()
  }

  const candidate = clean(model.name) || clean(model.alias)
  const [upstream = ''] = candidate.split('/')
  return candidate.includes('/') ? upstream.trim().toLowerCase() : ''
}

const groupKeyForModel = (model: ModelOptionLike) => {
  const provider = modelProviderForGrouping(model)
  if (provider === 'openrouter') {
    const upstream = openRouterUpstreamFor(model)
    return upstream ? `openrouter:${upstream}` : 'openrouter'
  }
  return provider
}

const groupLabelForKey = (key: string) => {
  if (key.startsWith('openrouter:')) {
    return `OpenRouter - ${modelProviderLabel(key.slice('openrouter:'.length))}`
  }
  return modelProviderLabel(key)
}

const groupOrder = (key: string) => {
  const provider = key.startsWith('openrouter:') ? 'openrouter' : key
  const index = PROVIDER_ORDER.indexOf(provider)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function formatModelGroupLabel<T extends ModelOptionLike>(group: ModelOptionGroup<T>) {
  return `${group.label} (${group.models.length})`
}

export function formatModelChoiceLabel(model: ModelOptionLike) {
  const provider = clean(model.provider) || splitModelId(model.id).provider || 'model'
  const name = clean(model.name) || clean(model.alias) || splitModelId(model.id).model || model.id
  const alias = clean(model.alias)
  return alias && alias !== name ? `${provider} / ${name} (${alias})` : `${provider} / ${name}`
}

export function groupAvailableModels<T extends ModelOptionLike>(models: readonly T[]): ModelOptionGroup<T>[] {
  const groups = new Map<string, ModelOptionGroup<T>>()

  for (const model of models) {
    const key = groupKeyForModel(model)
    const existing = groups.get(key)
    if (existing) {
      existing.models.push(model)
    } else {
      groups.set(key, { key, label: groupLabelForKey(key), models: [model] })
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftOrder = groupOrder(left.key)
    const rightOrder = groupOrder(right.key)
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left.label.localeCompare(right.label)
  })
}

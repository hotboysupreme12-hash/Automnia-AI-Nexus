export type ModelCatalogOpenClawConfig = {
  agents?: {
    defaults?: {
      model?: { primary?: string; fallbacks?: string[] }
      models?: Record<string, unknown>
    }
    list?: Array<{
      model?: { primary?: string; fallbacks?: string[] }
      models?: unknown
      [key: string]: unknown
    }>
  }
  models?: {
    providers?: Record<string, ModelProviderConfig>
  }
  plugins?: {
    entries?: Record<string, { enabled?: boolean; [key: string]: unknown }>
    allow?: unknown
    deny?: unknown
  }
  [key: string]: unknown
}

export type ModelProviderConfig = {
  apiKey?: string
  baseUrl?: string
  api?: string
  agentRuntime?: unknown
  models?: unknown
  timeoutSeconds?: number
  [key: string]: unknown
}

export type AvailableModelInput = {
  id?: string
  key?: string
  alias?: string
  provider?: string
  name?: string
  available?: boolean
  missing?: boolean
}

export type AvailableModelStreaming = {
  supported: boolean
  provider: string
  transport: string
  requires: string[]
  docs?: string
}

export type AvailableModelOutput = {
  id: string
  alias: string
  provider: string
  name: string
  streaming: AvailableModelStreaming
}

export type AvailableModelCatalogCache = {
  models: AvailableModelOutput[]
  source: 'fallback' | 'config' | 'openclaw'
  expiresAt: number
  refreshedAt: number
}

export type FastAvailableModelCatalog = {
  models: AvailableModelOutput[]
  source: AvailableModelCatalogCache['source']
  refreshing: boolean
  stale: boolean
}

type RunOpenClawResult = {
  code: number
  stdout?: string
  stderr?: string
}

export type ModelCatalogServiceOptions = {
  cacheMs?: number
  ensureFastModeModelParams: (config: ModelCatalogOpenClawConfig, modelId: string) => void
  filterGoogleVertexCatalogModels: <T extends { id: string; provider?: string; name?: string }>(models: T[]) => Promise<T[]>
  isProviderConfigured: (provider: string) => boolean
  now?: () => number
  readOpenclawConfig: () => Promise<ModelCatalogOpenClawConfig>
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<RunOpenClawResult>
  streamingCapabilityForModel: (modelId: string) => AvailableModelStreaming
  warn?: (message: string, error: unknown) => void
  writeOpenclawConfig: (config: ModelCatalogOpenClawConfig) => Promise<unknown>
}

export const FALLBACK_MODELS: Array<{ id: string; alias?: string }> = [
  // Keep the local picker useful while OpenClaw is starting or the catalog is
  // temporarily unavailable. These are the current GPT-5.6 and Claude 5 IDs.
  { id: 'openai/gpt-5.6-sol', alias: 'GPT-5.6 Sol (flagship)' },
  { id: 'openai/gpt-5.6-terra', alias: 'GPT-5.6 Terra (balanced)' },
  { id: 'openai/gpt-5.6-luna', alias: 'GPT-5.6 Luna (high-volume)' },
  { id: 'openai/gpt-5.6', alias: 'GPT-5.6 (current alias)' },
  { id: 'openai/gpt-5.5', alias: 'gpt-5.5' },
  { id: 'openai/gpt-5.5-pro', alias: 'gpt-5.5-pro' },
  { id: 'openai/gpt-5.4', alias: 'gpt-5.4' },
  { id: 'openai/gpt-5.4-pro', alias: 'gpt-5.4-pro' },
  { id: 'openai/gpt-5.4-mini', alias: 'gpt-5.4-mini' },
  { id: 'openai/gpt-5.4-nano', alias: 'gpt-5.4-nano' },
  { id: 'openai/gpt-5.3-codex-spark', alias: 'gpt-5.3-codex-spark' },
  { id: 'openai/gpt-5.3-chat-latest', alias: 'gpt-5.3-chat-latest' },
  { id: 'openai/o4-mini', alias: 'o4-mini' },
  { id: 'openai/o4-mini-deep-research', alias: 'o4-mini-deep-research' },
  { id: 'openai/o3', alias: 'o3' },
  { id: 'openai/o3-pro', alias: 'o3-pro' },
  { id: 'openai/o3-mini', alias: 'o3-mini' },
  { id: 'openai/o3-deep-research', alias: 'o3-deep-research' },
  { id: 'openai/o1', alias: 'o1' },
  { id: 'openai/o1-pro', alias: 'o1-pro' },
  { id: 'openai/gpt-4.1-mini', alias: 'gpt-4.1-mini' },
  { id: 'openai/gpt-5.2', alias: 'gpt-5.2' },
  { id: 'openai/gpt-5.1', alias: 'gpt-5.1' },
  { id: 'anthropic/claude-fable-5', alias: 'Claude Fable 5 (flagship)' },
  { id: 'anthropic/claude-sonnet-5', alias: 'Claude Sonnet 5' },
  { id: 'anthropic/claude-opus-4-8', alias: 'Claude Opus 4.8' },
  { id: 'anthropic/claude-haiku-4-5', alias: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-mythos-5', alias: 'Claude Mythos 5 (limited preview)' },
  { id: 'anthropic/claude-opus-4-6', alias: 'Claude Opus 4.6' },
  { id: 'anthropic/claude-sonnet-4-6', alias: 'Claude Sonnet 4.6' },
  { id: 'opencode/claude-opus-4-6', alias: 'opencode-opus' },
  { id: 'google/gemini-3.1-pro-preview', alias: 'gemini-3.1-pro' },
  { id: 'google/gemini-3.1-pro-preview-customtools', alias: 'gemini-3.1-pro-tools' },
  { id: 'google/gemini-3.7-pro', alias: 'Gemini 3.7 Pro (GA)' },
  { id: 'google/gemini-3.7-flash', alias: 'Gemini 3.7 Flash (GA)' },
  { id: 'google/gemini-3.6-flash', alias: 'Gemini 3.6 Flash (GA)' },
  { id: 'google/gemini-3.5-flash', alias: 'gemini-3.5-flash' },
  { id: 'google/gemini-3-flash-preview', alias: 'gemini-3-flash' },
  { id: 'google/gemini-3.1-flash-lite', alias: 'gemini-3.1-flash-lite' },
  { id: 'google/gemini-3.1-flash-lite-preview', alias: 'gemini-3.1-flash-lite-preview' },
  { id: 'google/gemini-3-pro-preview', alias: 'gemini-3-pro' },
  { id: 'google/gemini-2.5-pro', alias: 'gemini-2.5-pro' },
  { id: 'google/gemini-2.5-flash', alias: 'flash' },
  { id: 'google/gemini-2.5-flash-lite', alias: 'flash-lite' },
  { id: 'google-vertex/gemini-2.5-pro', alias: 'vertex-gemini-2.5-pro' },
  { id: 'google-vertex/gemini-2.5-flash', alias: 'vertex-flash' },
  { id: 'google-vertex/gemini-2.5-flash-lite', alias: 'vertex-flash-lite' },
  { id: 'google-vertex/gemini-3.7-pro', alias: 'Vertex Gemini 3.7 Pro (GA)' },
  { id: 'google-vertex/gemini-3.7-flash', alias: 'Vertex Gemini 3.7 Flash (GA)' },
  { id: 'google-vertex/gemini-3.6-flash', alias: 'Vertex Gemini 3.6 Flash (GA)' },
  { id: 'google-vertex/gemini-3.5-flash', alias: 'vertex-gemini-3.5-flash' },
  { id: 'google-vertex/gemini-3.1-pro-preview', alias: 'vertex-gemini-3.1-pro' },
  { id: 'google-vertex/gemini-3-flash-preview', alias: 'vertex-gemini-3-flash' },
  { id: 'google-vertex/gemini-3.1-flash-lite', alias: 'vertex-gemini-3.1-flash-lite' },
  { id: 'google-vertex/gemini-3.1-flash-lite-preview', alias: 'vertex-gemini-3.1-flash-lite' },
  { id: 'google-vertex/gemini-3-pro-preview', alias: 'vertex-gemini-3-pro' },
  { id: 'deepseek/deepseek-v4-pro', alias: 'deepseek-v4-pro' },
  { id: 'deepseek/deepseek-v4-flash', alias: 'deepseek-v4-flash' },
  { id: 'deepseek/deepseek-chat', alias: 'deepseek-chat' },
  { id: 'deepseek/deepseek-reasoner', alias: 'deepseek-r1' },
  { id: 'meta/muse-spark-1.1', alias: 'Muse Spark 1.1 (Meta)' },
  { id: 'openrouter/deepseek/deepseek-v4-pro', alias: 'openrouter-deepseek-v4-pro' },
  { id: 'openrouter/deepseek/deepseek-v4-flash', alias: 'openrouter-deepseek-v4-flash' },
]

export const KNOWN_UNAVAILABLE_MODEL_IDS = new Set<string>([
  'openai/gpt-5.3-chat-latest',
  'google/gemini-3.1-pro-preview-customtools',
])

export const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS = new Set([
  'openai/gpt-5.3-chat-latest',
  'google/gemini-3.1-pro-preview-customtools',
])

// Keep the newest production Gemini Flash release readily visible even if
// OpenClaw is still warming up or returns a sparse catalog.
const PINNED_MODEL_IDS = ['google-vertex/gemini-3.6-flash']
const OPENROUTER_PROVIDER_WILDCARD_MODEL_ID = 'openrouter/*'
const OPENROUTER_DEEPSEEK_V4_PRO_MODEL_ID = 'openrouter/deepseek/deepseek-v4-pro'
const OPENROUTER_DEEPSEEK_V4_FLASH_MODEL_ID = 'openrouter/deepseek/deepseek-v4-flash'
const AVAILABLE_MODELS_CACHE_MS = 5 * 60 * 1000

function defaultWarning(message: string, error: unknown) {
  console.warn(message, error)
}

export function splitModelId(modelId: string) {
  const [provider = '', ...modelParts] = modelId.split('/')
  return {
    provider: provider.trim(),
    model: (modelParts.join('/') || modelId).trim(),
  }
}

export function isOpenAiCodexSubscriptionModelName(model: string) {
  return /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model.trim())
}

export function canonicalAgentModelId(modelId: string | undefined) {
  const trimmed = modelId?.trim() || ''
  if (!trimmed.includes('/') && isOpenAiCodexSubscriptionModelName(trimmed)) return `openai/${trimmed}`
  const parsed = trimmed.match(/^([^/]+)\/(.+)$/)
  if (parsed && /^(?:openai|openai-codex|codex)$/i.test(parsed[1]) && isOpenAiCodexSubscriptionModelName(parsed[2])) {
    return `openai/${parsed[2]}`
  }
  return trimmed
}

export function isOpenAiCodexSubscriptionModel(modelId: string) {
  const { provider, model } = splitModelId(canonicalAgentModelId(modelId))
  if (!['openai', 'openai-codex', 'codex'].includes(provider.toLowerCase())) return false
  return isOpenAiCodexSubscriptionModelName(model)
}

export function isModelSafeForOpenClawConfig(modelId: string) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  return Boolean(
    canonicalModelId &&
      canonicalModelId.includes('/') &&
      !KNOWN_UNAVAILABLE_MODEL_IDS.has(canonicalModelId) &&
      !OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS.has(canonicalModelId),
  )
}

function modelIdFor(model: AvailableModelInput) {
  return typeof model.id === 'string' && model.id.trim()
    ? model.id.trim()
    : typeof model.key === 'string' && model.key.trim()
      ? model.key.trim()
      : ''
}

function displayProviderForAvailableModel(model: AvailableModelInput, id: string) {
  // OpenClaw's current provider key is "openai" for both API-key and
  // ChatGPT/Codex subscription auth. Keep the legacy parser, never surface it.
  if (isOpenAiCodexSubscriptionModel(id)) return 'openai'
  return model.provider || id.split('/')[0]
}

function fallbackAvailableModels(streamingCapabilityForModel: ModelCatalogServiceOptions['streamingCapabilityForModel']): AvailableModelOutput[] {
  return FALLBACK_MODELS
    .filter((model) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(model.id))
    .map((model) => ({
      id: model.id,
      alias: model.alias || model.id.split('/').pop() || model.id,
      provider: displayProviderForAvailableModel(model, model.id),
      name: model.id.split('/').pop() || model.id,
      streaming: streamingCapabilityForModel(model.id),
    }))
}

function mergeAvailableModels(
  available: AvailableModelInput[],
  streamingCapabilityForModel: ModelCatalogServiceOptions['streamingCapabilityForModel'],
): AvailableModelOutput[] {
  const deduped = new Map<string, AvailableModelOutput>()
  const addModel = (model: AvailableModelInput) => {
    const id = canonicalAgentModelId(modelIdFor(model))
    if (!id) return
    if (KNOWN_UNAVAILABLE_MODEL_IDS.has(id)) return
    const provider = displayProviderForAvailableModel(model, id)
    const name = model.name || id.split('/').pop() || id
    const alias = model.alias || name
    if (!deduped.has(id)) {
      deduped.set(id, { id, alias, provider, name, streaming: streamingCapabilityForModel(id) })
    }
  }
  for (const model of available) addModel(model)
  for (const model of fallbackAvailableModels(streamingCapabilityForModel)) addModel(model)
  return orderAvailableModels(Array.from(deduped.values()))
}

function orderAvailableModels(models: AvailableModelOutput[]) {
  return [...models].sort((left, right) => {
    const leftPinned = PINNED_MODEL_IDS.indexOf(left.id)
    const rightPinned = PINNED_MODEL_IDS.indexOf(right.id)
    if (leftPinned !== -1 || rightPinned !== -1) {
      if (leftPinned === -1) return 1
      if (rightPinned === -1) return -1
      return leftPinned - rightPinned
    }
    return 0
  })
}

export function configHasOpenRouterPluginEnabled(config: ModelCatalogOpenClawConfig) {
  const entry = config.plugins?.entries?.openrouter
  if (entry && entry.enabled !== false) return true
  const allow = Array.isArray(config.plugins?.allow) ? config.plugins.allow : []
  return allow.some((id) => typeof id === 'string' && id.trim().toLowerCase() === 'openrouter')
}

export function ensureModelAllowlistEntry(
  config: ModelCatalogOpenClawConfig,
  modelId: string,
  options: Pick<ModelCatalogServiceOptions, 'ensureFastModeModelParams'>,
  alias?: string,
) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  if (!isModelSafeForOpenClawConfig(canonicalModelId)) return

  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}
  if (!config.agents.defaults.models) config.agents.defaults.models = {}

  const existing = config.agents.defaults.models[canonicalModelId]
  const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {}
  config.agents.defaults.models[canonicalModelId] = {
    ...(alias && !existingRecord.alias ? { alias } : {}),
    ...existingRecord,
  }
  options.ensureFastModeModelParams(config, canonicalModelId)
}

export function ensureConfiguredProviderModel(config: ModelCatalogOpenClawConfig, modelId: string) {
  if (!isModelSafeForOpenClawConfig(modelId)) return
  const { provider, model } = splitModelId(canonicalAgentModelId(modelId))
  if (!provider || !model) return
  if (!['openai', 'google', 'google-vertex', 'deepseek'].includes(provider)) return

  if (!config.models) config.models = {}
  if (!config.models.providers) config.models.providers = {}
  if (!config.models.providers[provider]) config.models.providers[provider] = {}

  const providerConfig = config.models.providers[provider]
  if (provider === 'openai' && isOpenAiCodexSubscriptionModel(modelId)) {
    providerConfig.agentRuntime ??= { id: 'openclaw' }
  }
  if (provider === 'google') {
    if (!providerConfig.baseUrl) providerConfig.baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
    providerConfig.api = 'google-generative-ai'
  }
  if (provider === 'google-vertex') {
    providerConfig.api = 'google-vertex'
    if (!providerConfig.apiKey) providerConfig.apiKey = 'gcp-vertex-credentials'
  }
  if (provider === 'deepseek') {
    if (!providerConfig.baseUrl) providerConfig.baseUrl = 'https://api.deepseek.com'
    providerConfig.api = 'openai-completions'
    if (!providerConfig.apiKey) providerConfig.apiKey = 'DEEPSEEK_API_KEY'
  }
  if (!Array.isArray(providerConfig.models)) {
    if (providerConfig.models && typeof providerConfig.models === 'object') return
    providerConfig.models = []
  }

  const models = providerConfig.models as Array<string | { id?: unknown; model?: unknown; name?: unknown; api?: unknown }>
  const providerApi = provider === 'google'
    ? 'google-generative-ai'
    : provider === 'google-vertex'
      ? 'google-vertex'
      : provider === 'deepseek'
        ? 'openai-completions'
        : undefined
  for (const [index, entry] of models.entries()) {
    if (typeof entry === 'string') {
      if (entry === model) {
        if (providerApi) models[index] = { id: model, name: model, api: providerApi }
        return
      }
      continue
    }
    if (entry?.id === model || entry?.model === model || entry?.name === model) {
      if (!entry.name) entry.name = model
      if (providerApi) entry.api = providerApi
      return
    }
  }
  models.push(providerApi ? { id: model, name: model, api: providerApi } : { id: model, name: model })
}

export function createModelCatalogService(options: ModelCatalogServiceOptions) {
  const nowMs = options.now ?? (() => Date.now())
  const warn = options.warn ?? defaultWarning
  const cacheMs = options.cacheMs ?? AVAILABLE_MODELS_CACHE_MS
  let availableModelsCache: AvailableModelCatalogCache | null = null
  let availableModelsRefreshPromise: Promise<AvailableModelCatalogCache> | null = null
  let availableModelsRefreshTimer: ReturnType<typeof setTimeout> | null = null

  function ensureConfiguredModelAllowlist(config: ModelCatalogOpenClawConfig, modelIds: string[]) {
    const canonicalIds = Array.from(
      new Set(
        modelIds
          .map((modelId) => canonicalAgentModelId(modelId))
          .filter(isModelSafeForOpenClawConfig),
      ),
    )
    if (!canonicalIds.length) return

    if (!config.agents) config.agents = {}
    if (!config.agents.defaults) config.agents.defaults = {}
    if (!config.agents.defaults.models) config.agents.defaults.models = {}

    for (const modelId of canonicalIds) {
      const existing = config.agents.defaults.models[modelId]
      const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing as Record<string, unknown>
        : {}
      const fallback = FALLBACK_MODELS.find((entry) => entry.id === modelId)
      config.agents.defaults.models[modelId] = {
        ...(fallback?.alias && !existingRecord.alias ? { alias: fallback.alias } : {}),
        ...existingRecord,
      }
      options.ensureFastModeModelParams(config, modelId)
      ensureConfiguredProviderModel(config, modelId)
    }
  }

  function ensureOpenRouterModelCatalogAllowlist(config: ModelCatalogOpenClawConfig) {
    ensureModelAllowlistEntry(config, OPENROUTER_PROVIDER_WILDCARD_MODEL_ID, options, 'OpenRouter catalog')
    ensureConfiguredModelAllowlist(config, [
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL_ID,
      OPENROUTER_DEEPSEEK_V4_FLASH_MODEL_ID,
    ])
  }

  async function loadAvailableModelsFromOpenClaw(): Promise<{ models: AvailableModelOutput[]; source: AvailableModelCatalogCache['source'] }> {
    try {
      const config = await options.readOpenclawConfig()
      if (configHasOpenRouterPluginEnabled(config) || options.isProviderConfigured('openrouter')) {
        const before = JSON.stringify(config.agents?.defaults?.models || {})
        ensureOpenRouterModelCatalogAllowlist(config)
        const after = JSON.stringify(config.agents?.defaults?.models || {})
        if (after !== before) await options.writeOpenclawConfig(config)
      }
    } catch (error) {
      warn('OpenRouter model catalog allowlist normalization failed:', error)
    }

    try {
      const listResult = await options.runOpenClaw(['models', 'list', '--json'], 30000)
      if (listResult.code === 0 && listResult.stdout) {
        const parsed = JSON.parse(listResult.stdout) as {
          models?: AvailableModelInput[]
        } | AvailableModelInput[]

        const entries = Array.isArray(parsed) ? parsed : parsed.models || []
        const available = entries
          .filter((model) => modelIdFor(model).includes('/'))
          .map((model) => ({
            id: modelIdFor(model),
            alias: model.alias || model.name || modelIdFor(model).split('/').pop(),
            provider: model.provider || modelIdFor(model).split('/')[0],
            name: model.name || modelIdFor(model).split('/').pop(),
            available: model.available,
            missing: model.missing,
          }))
        if (available.length) {
          return {
            models: await options.filterGoogleVertexCatalogModels(mergeAvailableModels(available, options.streamingCapabilityForModel)),
            source: 'openclaw',
          }
        }
      }
    } catch (error) {
      warn('OpenClaw model listing unavailable; using local model catalog fallback:', error)
    }

    try {
      const config = await options.readOpenclawConfig()
      const models = config.agents?.defaults?.models || {}
      const available = Object.entries(models).map(([id, data]) => ({
        id,
        alias: data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { alias?: unknown }).alias === 'string'
          ? (data as { alias: string }).alias
          : id.split('/').pop(),
        provider: id.split('/')[0],
        name: id.split('/').pop(),
      }))
      if (available.length) {
        return {
          models: await options.filterGoogleVertexCatalogModels(mergeAvailableModels(available, options.streamingCapabilityForModel)),
          source: 'config',
        }
      }
    } catch (error) {
      warn('OpenClaw config unavailable; using local model catalog fallback:', error)
    }

    return {
      models: await options.filterGoogleVertexCatalogModels(fallbackAvailableModels(options.streamingCapabilityForModel)),
      source: 'fallback',
    }
  }

  async function refreshAvailableModelsCache() {
    if (availableModelsRefreshPromise) return availableModelsRefreshPromise

    availableModelsRefreshPromise = (async () => {
      const loaded = await loadAvailableModelsFromOpenClaw()
      const refreshedAt = nowMs()
      const cache: AvailableModelCatalogCache = {
        ...loaded,
        refreshedAt,
        expiresAt: refreshedAt + cacheMs,
      }
      availableModelsCache = cache
      return cache
    })().finally(() => {
      availableModelsRefreshPromise = null
    })

    return availableModelsRefreshPromise
  }

  function scheduleAvailableModelsCacheRefresh() {
    if (availableModelsRefreshPromise || availableModelsRefreshTimer) return
    availableModelsRefreshTimer = setTimeout(() => {
      availableModelsRefreshTimer = null
      void refreshAvailableModelsCache().catch((error) => {
        warn('Background model catalog refresh failed:', error)
      })
    }, 0)
    availableModelsRefreshTimer.unref?.()
  }

  function invalidateAvailableModelsForAuthChange() {
    availableModelsCache = null
    scheduleAvailableModelsCacheRefresh()
  }

  function invalidateAvailableModels() {
    availableModelsCache = null
  }

  function clearRefreshTimer() {
    if (!availableModelsRefreshTimer) return
    clearTimeout(availableModelsRefreshTimer)
    availableModelsRefreshTimer = null
  }

  function getFastAvailableModelsCatalog(optionsParam: { refreshStale?: boolean } = {}): FastAvailableModelCatalog {
    const now = nowMs()
    const cache = availableModelsCache
    const stale = !cache || cache.expiresAt <= now
    const refreshStale = optionsParam.refreshStale !== false
    if (stale && refreshStale) {
      scheduleAvailableModelsCacheRefresh()
    }
    return {
      models: cache?.models?.length ? cache.models : fallbackAvailableModels(options.streamingCapabilityForModel),
      source: cache?.source || 'fallback',
      refreshing: Boolean(availableModelsRefreshPromise || availableModelsRefreshTimer) || (stale && refreshStale),
      stale,
    }
  }

  return {
    clearRefreshTimer,
    configHasOpenRouterPluginEnabled,
    ensureConfiguredModelAllowlist,
    ensureOpenRouterModelCatalogAllowlist,
    fallbackAvailableModels: () => fallbackAvailableModels(options.streamingCapabilityForModel),
    getFastAvailableModelsCatalog,
    invalidateAvailableModels,
    invalidateAvailableModelsForAuthChange,
    loadAvailableModelsFromOpenClaw,
    refreshAvailableModelsCache,
    scheduleAvailableModelsCacheRefresh,
  }
}

export type ModelCatalogService = ReturnType<typeof createModelCatalogService>

import {
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_CREDITS_PROVIDER_ID,
  AUTOMNIA_RELAY_MODEL_IDS,
  AUTOMNIA_RELAY_MODEL_LABELS,
  isAutomniaCreditsModelId as isAutomniaCreditsModelPolicyId,
  isAutomniaRelayModelId as isAutomniaRelayModelPolicyId,
} from '../license/creditsOnlyModelPolicy'

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

// These are the current Anthropic model IDs included in fallback mode.
// Account-specific availability is still determined by `openclaw models list`;
// this set prevents fallback mode from surfacing unverified Anthropic IDs.
export const OPENCLAW_VERIFIED_ANTHROPIC_MODEL_IDS = new Set([
  'claude-fable-5-2',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
])

export const FALLBACK_MODELS: Array<{ id: string; alias?: string }> = [
  // This is an offline/startup hint only. Authenticated provider discovery
  // remains authoritative for account and deployment availability.
  { id: 'openai/gpt-6.2-astra', alias: 'GPT-6.2 Astra (frontier)' },
  { id: 'openai/gpt-6.2-sol', alias: 'GPT-6.2 Sol (balanced)' },
  // Automnia is a provider-backed billing route. Keep its bounded hosted
  // fallback chain in the shared catalog so the Gateway can fail over without
  // ever leaving the hosted credits boundary.
  ...AUTOMNIA_RELAY_MODEL_IDS.map((id) => ({ id, alias: AUTOMNIA_RELAY_MODEL_LABELS[id] })),
  { id: 'anthropic/claude-fable-5-2', alias: 'Claude Fable 5.2 (frontier)' },
  { id: 'anthropic/claude-opus-5-5', alias: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5-5', alias: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'anthropic/claude-haiku-5-5', alias: 'Claude Haiku 5.5 (fast)' },
  { id: 'google/gemini-4-carbon', alias: 'Gemini 4 Carbon (frontier)' },
  { id: 'google/gemini-4-argon', alias: 'Gemini 4 Argon (Pro)' },
  { id: 'google/gemini-4-hydrogen', alias: 'Gemini 4 Hydrogen (balanced)' },
  { id: 'google/gemini-3.8-flash', alias: 'Gemini 3.8 Flash' },
  { id: 'google-vertex/gemini-4-carbon', alias: 'Vertex Gemini 4 Carbon (frontier)' },
  { id: 'google-vertex/gemini-4-argon', alias: 'Vertex Gemini 4 Argon (Pro)' },
  { id: 'google-vertex/gemini-4-hydrogen', alias: 'Vertex Gemini 4 Hydrogen (balanced)' },
  { id: 'google-vertex/gemini-3.8-flash', alias: 'Vertex Gemini 3.8 Flash' },
  { id: 'xai/grok-4.7', alias: 'Grok 4.7 (xAI)' },
  { id: 'deepseek/deepseek-flash', alias: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek/deepseek-v4-pro', alias: 'DeepSeek V4 Pro' },
  { id: 'mistral/mistral-large-4-0', alias: 'Mistral Large 4' },
  { id: 'meta/muse-wonder-1.0', alias: 'Muse Wonder 1.0 (frontier)' },
  { id: 'meta/muse-spark-1.3', alias: 'Muse Spark 1.3' },
  { id: 'qwen/qwen4-max', alias: 'Qwen4 Max (frontier)' },
  { id: 'qwen/qwen3.7-plus', alias: 'Qwen3.7 Plus (balanced)' },
  { id: 'qwen/qwen3.8-flash', alias: 'Qwen3.8 Flash (fast)' },
  { id: 'moonshot/kimi-k3.1-pro', alias: 'Kimi K3.1 Pro (frontier)' },
  { id: 'moonshot/kimi-k3.1-pro-highspeed', alias: 'Kimi K3.1 Pro Highspeed' },
]

export const KNOWN_UNAVAILABLE_MODEL_IDS = new Set<string>([
  'openai/gpt-5.3-chat-latest',
  'google/gemini-3.1-pro-preview-customtools',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash-vision-exp',
])

export const OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS = new Set([
  'openai/gpt-5.3-chat-latest',
  'google/gemini-3.1-pro-preview-customtools',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash-vision-exp',
])

// Keep current Google models visible during startup while preserving provider
// discovery as the authority for account-specific availability.
const PINNED_MODEL_IDS = [
  'google-vertex/gemini-4-carbon',
  'google/gemini-4-carbon',
  'google-vertex/gemini-4-argon',
  'google/gemini-4-argon',
  'google-vertex/gemini-4-hydrogen',
  'google/gemini-4-hydrogen',
  'google-vertex/gemini-3.8-flash',
  'google/gemini-3.8-flash',
  ...AUTOMNIA_RELAY_MODEL_IDS.slice().reverse(),
]
const OPENROUTER_PROVIDER_WILDCARD_MODEL_ID = 'openrouter/*'
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

function isSupersededGoogleGeminiModel(modelId: string) {
  const { provider, model } = splitModelId(modelId)
  if (!['google', 'google-vertex'].includes(provider.toLowerCase())) return false
  if (!/^gemini-/i.test(model)) return false
  return !/^gemini-(?:3\.8-flash|4-(?:hydrogen|argon|carbon))(?:$|[-@])/i.test(model)
}

function isSupersededModelId(modelId: string) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  return KNOWN_UNAVAILABLE_MODEL_IDS.has(canonicalModelId) || isSupersededGoogleGeminiModel(canonicalModelId)
}

function automniaRelayModelLabel(modelId: string) {
  const normalized = modelId.trim().toLowerCase()
  const mapped = AUTOMNIA_RELAY_MODEL_LABELS[normalized]
  if (mapped) return mapped
  if (!normalized.startsWith(`${AUTOMNIA_CREDITS_PROVIDER_ID}/`)) return ''
  return 'Automnia hosted class'
}

export function isOpenAiCodexSubscriptionModelName(model: string) {
  return /^gpt-(?:5|6)(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model.trim())
}

export function canonicalAgentModelId(modelId: string | undefined) {
  const trimmed = modelId?.trim() || ''
  if (!trimmed.includes('/') && isOpenAiCodexSubscriptionModelName(trimmed)) return `openai/${trimmed}`
  const parsed = trimmed.match(/^([^/]+)\/(.+)$/)
  if (parsed && parsed[1].trim().toLowerCase() === AUTOMNIA_CREDITS_PROVIDER_ID) {
    const candidate = `${AUTOMNIA_CREDITS_PROVIDER_ID}/${parsed[2].trim().toLowerCase()}`
    return isAutomniaCreditsModelPolicyId(candidate) || isAutomniaRelayModelPolicyId(candidate)
      ? candidate
      : AUTOMNIA_CREDITS_MODEL_ID
  }
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
      !OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS.has(canonicalModelId) &&
      !isSupersededGoogleGeminiModel(canonicalModelId),
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
    .filter((model) => {
      if (isSupersededModelId(model.id)) return false
      const [provider, modelId] = model.id.split('/')
      return provider !== 'anthropic' || OPENCLAW_VERIFIED_ANTHROPIC_MODEL_IDS.has(modelId || '')
    })
    .map((model) => ({
      id: model.id,
      alias: automniaRelayModelLabel(model.id) || model.alias || model.id.split('/').pop() || model.id,
      provider: displayProviderForAvailableModel(model, model.id),
      name: automniaRelayModelLabel(model.id) || model.id.split('/').pop() || model.id,
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
    if (isSupersededModelId(id)) return
    const provider = displayProviderForAvailableModel(model, id)
    const fallbackEntry = FALLBACK_MODELS.find((entry) => entry.id === id)
    const managedLabel = automniaRelayModelLabel(id)
    const name = managedLabel || model.name || id.split('/').pop() || id
    const alias = managedLabel || model.alias || fallbackEntry?.alias || name
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
  if (!['openai', 'anthropic', 'google', 'google-vertex', 'deepseek', 'xai', 'mistral', 'meta', 'qwen', 'moonshot', AUTOMNIA_CREDITS_PROVIDER_ID].includes(provider)) return

  if (!config.models) config.models = {}
  if (!config.models.providers) config.models.providers = {}
  if (!config.models.providers[provider]) config.models.providers[provider] = {}

  const providerConfig = config.models.providers[provider]
  if (provider === 'openai' && isOpenAiCodexSubscriptionModel(modelId)) {
    // OpenAI GPT models are Codex-backed when the account is authenticated
    // with ChatGPT/Codex OAuth (and the Codex harness also supports an API-key
    // profile as a fallback).  Leaving this unset lets OpenClaw select its
    // native Codex runtime.  Forcing "openclaw" here sends OAuth credentials
    // to the plain Responses API path, which only accepts an API key.
    providerConfig.agentRuntime ??= { id: 'codex' }
  }
  if (provider === 'google') {
    if (!providerConfig.baseUrl) providerConfig.baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
    providerConfig.api = 'google-generative-ai'
  }
  if (provider === 'anthropic') {
    providerConfig.api = 'anthropic-messages'
  }
  if (provider === 'google-vertex') {
    providerConfig.api = 'google-vertex'
    if (!providerConfig.apiKey) providerConfig.apiKey = 'gcp-vertex-credentials'
  }
  const directApiProviders: Record<string, { api: string; baseUrl: string; apiKey: string }> = {
    deepseek: {
      api: 'openai-completions',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '${DEEPSEEK_API_KEY}',
    },
    mistral: {
      api: 'openai-completions',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: '${MISTRAL_API_KEY}',
    },
    meta: {
      api: 'openai-responses',
      baseUrl: 'https://api.meta.ai/v1',
      apiKey: '${MODEL_API_KEY}',
    },
    qwen: {
      api: 'openai-completions',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKey: '${QWEN_API_KEY}',
    },
    moonshot: {
      api: 'openai-completions',
      baseUrl: 'https://api.moonshot.ai/v1',
      apiKey: '${MOONSHOT_API_KEY}',
    },
  }
  const directApi = directApiProviders[provider]
  if (directApi) {
    // These current providers expose OpenAI-compatible endpoints. OpenClaw's
    // first-party plugins add provider-specific discovery and media features,
    // but static Automnia model rows can execute through the documented API
    // without depending on an uninstalled external plugin. Respect an
    // explicit deployment endpoint, including Qwen/Moonshot regional routes.
    if (!providerConfig.baseUrl) providerConfig.baseUrl = directApi.baseUrl
    providerConfig.api = directApi.api
    if (!providerConfig.apiKey) providerConfig.apiKey = directApi.apiKey
  }
  if (!Array.isArray(providerConfig.models)) {
    if (providerConfig.models && typeof providerConfig.models === 'object') return
    providerConfig.models = []
  }

  const models = providerConfig.models as Array<string | { id?: unknown; model?: unknown; name?: unknown; api?: unknown }>
  const providerApi = provider === 'google'
    ? 'google-generative-ai'
    : provider === 'anthropic'
      ? 'anthropic-messages'
    : provider === 'google-vertex'
      ? 'google-vertex'
    : directApiProviders[provider]
        ? directApiProviders[provider].api
        : undefined
  const managedAutomniaThinking = provider === AUTOMNIA_CREDITS_PROVIDER_ID
    ? model === 'gemini-4-hydrogen' || model === 'gemini-4-neon'
      ? 'high'
      : model === 'gemini-4-argon' || model === 'gemini-4-carbon'
        ? 'medium'
        : undefined
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
      if (managedAutomniaThinking && entry && typeof entry === 'object') {
        const configured = entry as unknown as Record<string, unknown>
        const params = configured.params && typeof configured.params === 'object' && !Array.isArray(configured.params)
          ? configured.params as Record<string, unknown>
          : {}
        configured.params = { ...params, thinking: managedAutomniaThinking }
      }
      return
    }
  }
  models.push({
    id: model,
    name: model,
    ...(providerApi ? { api: providerApi } : {}),
    ...(managedAutomniaThinking ? { params: { thinking: managedAutomniaThinking } } : {}),
  })
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

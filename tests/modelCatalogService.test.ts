import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalAgentModelId,
  createModelCatalogService,
  ensureConfiguredProviderModel,
  isModelSafeForOpenClawConfig,
  OPENCLAW_VERIFIED_ANTHROPIC_MODEL_IDS,
  type ModelCatalogOpenClawConfig,
} from '../server/services/providers/modelCatalogService'

type HarnessOptions = {
  config?: ModelCatalogOpenClawConfig
  configuredProviders?: string[]
  openClawModels?: unknown
  openClawUnavailable?: boolean
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createHarness(options: HarnessOptions = {}) {
  const state = {
    config: clone(options.config || { agents: { defaults: { models: {} } } }),
    configuredProviders: new Set(options.configuredProviders || []),
    fastModeModelIds: [] as string[],
    now: Date.parse('2026-06-30T12:00:00.000Z'),
    warnings: [] as string[],
    writes: [] as ModelCatalogOpenClawConfig[],
  }
  const service = createModelCatalogService({
    cacheMs: 100,
    ensureFastModeModelParams: (config, modelId) => {
      state.fastModeModelIds.push(modelId)
      const entry = config.agents?.defaults?.models?.[modelId]
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const mutableEntry = entry as Record<string, unknown>
        mutableEntry.fastMode = 'auto'
      }
    },
    filterGoogleVertexCatalogModels: async (models) => models,
    isProviderConfigured: (provider) => state.configuredProviders.has(provider),
    now: () => state.now,
    readOpenclawConfig: async () => state.config,
    runOpenClaw: async () => {
      if (options.openClawUnavailable) return { code: 1, stdout: '', stderr: 'unavailable' }
      return { code: 0, stdout: JSON.stringify(options.openClawModels ?? { models: [] }) }
    },
    streamingCapabilityForModel: (modelId) => ({
      supported: true,
      provider: modelId.split('/')[0] || 'model',
      transport: 'test',
      requires: [],
    }),
    warn: (message) => state.warnings.push(message),
    writeOpenclawConfig: async (config) => {
      state.config = config
      state.writes.push(clone(config))
    },
  })
  return { service, state }
}

test('managed Automnia model registration publishes per-tier thinking defaults', () => {
  const config: ModelCatalogOpenClawConfig = {
    models: { providers: { 'automnia-cloud': { models: [] } } },
  }
  ensureConfiguredProviderModel(config, 'automnia-cloud/gemini-4-hydrogen')
  ensureConfiguredProviderModel(config, 'automnia-cloud/gemini-4-neon')
  ensureConfiguredProviderModel(config, 'automnia-cloud/gemini-4-carbon')

  const models = config.models?.providers?.['automnia-cloud']?.models as Array<Record<string, unknown>>
  assert.deepEqual(models.map((model) => [model.id, (model.params as Record<string, unknown>)?.thinking]), [
    ['gemini-4-hydrogen', 'high'],
    ['gemini-4-neon', 'high'],
    ['gemini-4-carbon', 'medium'],
  ])
})

test('fallback catalog exposes current pinned models and suppresses unavailable ids', () => {
  const { service } = createHarness()
  const fallback = service.fallbackAvailableModels()
  const gemini4Carbon = fallback.find((model) => model.id === 'google/gemini-4-carbon')
  const gemini4Argon = fallback.find((model) => model.id === 'google/gemini-4-argon')
  const gemini4Hydrogen = fallback.find((model) => model.id === 'google/gemini-4-hydrogen')
  const gemini38Flash = fallback.find((model) => model.id === 'google/gemini-3.8-flash')
  const vertexGemini4Carbon = fallback.find((model) => model.id === 'google-vertex/gemini-4-carbon')
  const vertexGemini4Argon = fallback.find((model) => model.id === 'google-vertex/gemini-4-argon')
  const vertexGemini4Hydrogen = fallback.find((model) => model.id === 'google-vertex/gemini-4-hydrogen')
  const vertexGemini38Flash = fallback.find((model) => model.id === 'google-vertex/gemini-3.8-flash')
  const astra = fallback.find((model) => model.id === 'openai/gpt-6.2-astra')
  const sol = fallback.find((model) => model.id === 'openai/gpt-6.2-sol')
  const fable = fallback.find((model) => model.id === 'anthropic/claude-fable-5-2')
  const opus = fallback.find((model) => model.id === 'anthropic/claude-opus-5-5')
  const sonnet = fallback.find((model) => model.id === 'anthropic/claude-sonnet-5-5')
  const haiku = fallback.find((model) => model.id === 'anthropic/claude-haiku-5-5')
  const grok = fallback.find((model) => model.id === 'xai/grok-4.7')
  const deepseek = fallback.find((model) => model.id === 'deepseek/deepseek-flash')
  const deepseekPro = fallback.find((model) => model.id === 'deepseek/deepseek-v4-pro')
  const mistral = fallback.find((model) => model.id === 'mistral/mistral-large-4-0')
  const metaWonder = fallback.find((model) => model.id === 'meta/muse-wonder-1.0')
  const metaSpark = fallback.find((model) => model.id === 'meta/muse-spark-1.3')
  const qwenMax = fallback.find((model) => model.id === 'qwen/qwen4-max')
  const kimi = fallback.find((model) => model.id === 'moonshot/kimi-k3.1-pro')
  const kimiHighspeed = fallback.find((model) => model.id === 'moonshot/kimi-k3.1-pro-highspeed')
  const automniaBalanced = fallback.find((model) => model.id === 'automnia-cloud/gemini-4-hydrogen')
  const automniaSwift = fallback.find((model) => model.id === 'automnia-cloud/gemini-3.8-flash')
  const automniaPro = fallback.find((model) => model.id === 'automnia-cloud/gemini-4-neon')
  const automniaFrontier = fallback.find((model) => model.id === 'automnia-cloud/gemini-4-carbon')

  assert.equal(canonicalAgentModelId('gpt-6.2-astra'), 'openai/gpt-6.2-astra')
  assert.equal(astra?.provider, 'openai')
  assert.equal(fallback.some((model) => model.id === 'openai/gpt-5.3-chat-latest'), false)
  assert.equal(isModelSafeForOpenClawConfig('openai/gpt-5.3-chat-latest'), false)
  assert.equal(isModelSafeForOpenClawConfig('openai/gpt-6.2-astra'), true)
  assert.equal(gemini4Carbon?.alias, 'Gemini 4 Carbon (frontier)')
  assert.equal(gemini4Argon?.alias, 'Gemini 4 Argon (Pro)')
  assert.equal(gemini4Hydrogen?.alias, 'Gemini 4 Hydrogen (balanced)')
  assert.equal(gemini38Flash?.alias, 'Gemini 3.8 Flash')
  assert.equal(vertexGemini4Carbon?.streaming.provider, 'google-vertex')
  assert.equal(vertexGemini4Argon?.streaming.provider, 'google-vertex')
  assert.equal(vertexGemini4Hydrogen?.streaming.provider, 'google-vertex')
  assert.equal(vertexGemini38Flash?.alias, 'Vertex Gemini 3.8 Flash')
  assert.equal(astra?.alias, 'GPT-6.2 Astra (frontier)')
  assert.equal(astra?.streaming.provider, 'openai')
  assert.equal(sol?.alias, 'GPT-6.2 Sol (balanced)')
  assert.equal(fable?.alias, 'Claude Fable 5.2 (frontier)')
  assert.equal(opus?.alias, 'Claude Opus 5.5')
  assert.equal(sonnet?.alias, 'Claude Sonnet 5.5 (balanced)')
  assert.equal(haiku?.alias, 'Claude Haiku 5.5 (fast)')
  assert.equal(grok?.alias, 'Grok 4.7 (xAI)')
  assert.equal(deepseek?.alias, 'DeepSeek V4.1 Flash')
  assert.equal(deepseekPro?.alias, 'DeepSeek V4 Pro')
  assert.equal(isModelSafeForOpenClawConfig('deepseek/deepseek-v4-pro'), true)
  assert.equal(mistral?.alias, 'Mistral Large 4')
  assert.equal(metaWonder?.alias, 'Muse Wonder 1.0 (frontier)')
  assert.equal(metaSpark?.alias, 'Muse Spark 1.3')
  assert.equal(qwenMax?.alias, 'Qwen4 Max (frontier)')
  assert.equal(kimi?.alias, 'Kimi K3.1 Pro (frontier)')
  assert.equal(kimiHighspeed?.alias, 'Kimi K3.1 Pro Highspeed')
  assert.equal(fallback.some((model) => model.id === 'openai/gpt-6-astra'), false)
  assert.equal(fallback.some((model) => model.id === 'anthropic/claude-opus-4-7'), false)
  assert.equal(fallback.some((model) => model.id === 'google/gemini-3.7-flash'), false)
  assert.equal(isModelSafeForOpenClawConfig('deepseek/deepseek-chat'), false)
  assert.equal(isModelSafeForOpenClawConfig('deepseek/deepseek-reasoner'), false)
  assert.equal(isModelSafeForOpenClawConfig('deepseek/deepseek-v4-flash'), false)
  assert.equal(isModelSafeForOpenClawConfig('deepseek/deepseek-v4-flash-vision-exp'), false)
  assert.equal(isModelSafeForOpenClawConfig('google/gemini-3.7-flash'), false)
  assert.equal(isModelSafeForOpenClawConfig('google-vertex/gemini-3.5-flash-lite'), false)
  assert.equal(isModelSafeForOpenClawConfig('google/gemini-3.8-flash'), true)
  assert.equal(automniaSwift?.alias, 'Automnia Swift')
  assert.equal(automniaFrontier?.alias, 'Automnia Frontier')
  assert.equal(automniaFrontier?.provider, 'automnia-cloud')
  assert.equal(automniaPro?.alias, 'Automnia Pro')
  assert.equal(automniaPro?.provider, 'automnia-cloud')
  assert.equal(automniaBalanced?.alias, 'Automnia Balanced')
  assert.equal(automniaBalanced?.provider, 'automnia-cloud')
  assert.equal(automniaSwift?.name, 'Automnia Swift')
  assert.equal(fallback.some((model) => model.id === 'automnia-cloud/gemini-3.7-flash'), false)
  assert.equal(fallback.some((model) => model.id === 'automnia-cloud/gemini-3.6-flash'), false)
  assert.equal(fallback.some((model) => model.id === 'automnia-cloud/gemini-2.5-flash'), false)
  assert.equal(canonicalAgentModelId('automnia-cloud/gemini-3.6-flash'), 'automnia-cloud/gemini-4-hydrogen')
  assert.equal(canonicalAgentModelId('automnia-cloud/gemini-4-argon'), 'automnia-cloud/gemini-4-hydrogen')
  assert.equal(canonicalAgentModelId('automnia-cloud/unknown-model'), 'automnia-cloud/gemini-4-hydrogen')
  assert.ok(fallback.filter((model) => model.provider === 'anthropic').every((model) =>
    OPENCLAW_VERIFIED_ANTHROPIC_MODEL_IDS.has(model.id.split('/')[1] || ''),
  ))
})

test('refresh loads OpenClaw catalog and normalizes OpenRouter allowlist through the service', async () => {
  const { service, state } = createHarness({
    config: {
      agents: { defaults: { models: {} } },
      plugins: { entries: { openrouter: { enabled: true } } },
    },
    openClawModels: {
      models: [
        { id: 'anthropic/claude-custom', alias: 'custom', provider: 'anthropic', name: 'claude-custom' },
        { id: 'automnia-cloud/gemini-3.6-flash', alias: 'legacy Automnia model', provider: 'automnia-cloud', name: 'Gemini 3.6 Flash' },
        { id: 'google-vertex/gemini-4-carbon', provider: 'google-vertex', name: 'gemini-4-carbon' },
        { id: 'google-vertex/gemini-4-argon', provider: 'google-vertex', name: 'gemini-4-argon' },
        { id: 'google-vertex/gemini-4-hydrogen', provider: 'google-vertex', name: 'gemini-4-hydrogen' },
        { id: 'google-vertex/gemini-3.8-flash', provider: 'google-vertex', name: 'gemini-3.8-flash' },
        { id: 'google/gemini-3.7-flash', provider: 'google', name: 'gemini-3.7-flash' },
        { id: 'google-vertex/gemini-3.5-flash-lite', provider: 'google-vertex', name: 'gemini-3.5-flash-lite' },
        { id: 'google-vertex/gemini-3.7-reasoning', provider: 'google-vertex', name: 'gemini-3.7-reasoning' },
        { id: 'deepseek/deepseek-v4-flash', provider: 'deepseek', name: 'deepseek-v4-flash' },
        { id: 'deepseek/deepseek-v4-flash-vision-exp', provider: 'deepseek', name: 'deepseek-v4-flash-vision-exp' },
        { id: 'xai/grok-4.7', provider: 'xai', name: 'grok-4.7' },
        { id: 'moonshot/kimi-k3.1-pro', provider: 'moonshot', name: 'kimi-k3.1-pro' },
        { id: 'openai/gpt-5.3-chat-latest', provider: 'openai', name: 'gpt-5.3-chat-latest' },
      ],
    },
  })

  const cache = await service.refreshAvailableModelsCache()
  assert.equal(cache.source, 'openclaw')
  assert.equal(cache.models[0]?.id, 'google-vertex/gemini-4-carbon')
  assert.ok(cache.models.some((model) => model.id === 'anthropic/claude-custom'))
  assert.ok(cache.models.some((model) => model.id === 'google-vertex/gemini-4-argon'))
  assert.ok(cache.models.some((model) => model.id === 'google-vertex/gemini-4-hydrogen'))
  assert.ok(cache.models.some((model) => model.id === 'google-vertex/gemini-3.8-flash'))
  assert.equal(cache.models.some((model) => model.id === 'google/gemini-3.7-flash'), false)
  assert.equal(cache.models.some((model) => model.id === 'google-vertex/gemini-3.5-flash-lite'), false)
  assert.equal(cache.models.some((model) => model.id === 'deepseek/deepseek-v4-flash'), false)
  assert.equal(cache.models.some((model) => model.id === 'deepseek/deepseek-v4-flash-vision-exp'), false)
  assert.ok(cache.models.some((model) => model.id === 'xai/grok-4.7'))
  assert.ok(cache.models.some((model) => model.id === 'moonshot/kimi-k3.1-pro'))
  assert.deepEqual(cache.models.filter((model) => model.provider === 'automnia-cloud').map((model) => ({ id: model.id, alias: model.alias, name: model.name })), [
    { id: 'automnia-cloud/gemini-3.8-flash', alias: 'Automnia Swift', name: 'Automnia Swift' },
    { id: 'automnia-cloud/gemini-4-hydrogen', alias: 'Automnia Balanced', name: 'Automnia Balanced' },
    { id: 'automnia-cloud/gemini-4-neon', alias: 'Automnia Pro', name: 'Automnia Pro' },
    { id: 'automnia-cloud/gemini-4-carbon', alias: 'Automnia Frontier', name: 'Automnia Frontier' },
  ])
  assert.equal(cache.models.some((model) => model.id === 'google-vertex/gemini-3.7-reasoning'), false)
  assert.equal(cache.models.some((model) => model.id === 'openai/gpt-5.3-chat-latest'), false)
  assert.equal(state.writes.length, 1)
  assert.equal(
    typeof state.config.agents?.defaults?.models?.['openrouter/*'],
    'object',
  )
  assert.equal(
    state.config.agents?.defaults?.models?.['openrouter/deepseek/deepseek-v4-pro'],
    undefined,
  )

  const freshFastPath = service.getFastAvailableModelsCatalog({ refreshStale: false })
  assert.equal(freshFastPath.stale, false)
  assert.equal(freshFastPath.refreshing, false)

  state.now += 101
  const staleFastPath = service.getFastAvailableModelsCatalog({ refreshStale: false })
  assert.equal(staleFastPath.stale, true)
  assert.equal(staleFastPath.refreshing, false)
})

test('refresh falls back to configured models when OpenClaw listing is unavailable', async () => {
  const { service } = createHarness({
    config: {
      agents: {
        defaults: {
          models: {
            'openai/gpt-5.4-mini': { alias: 'mini-from-config' },
          },
        },
      },
    },
    openClawUnavailable: true,
  })

  const cache = await service.refreshAvailableModelsCache()
  assert.equal(cache.source, 'config')
  assert.ok(cache.models.some((model) => model.id === 'openai/gpt-5.4-mini' && model.alias === 'mini-from-config'))
})

test('configured model allowlist normalizes provider entries and skips unsafe models', () => {
  const { service, state } = createHarness()
  const config: ModelCatalogOpenClawConfig = {}

  service.ensureConfiguredModelAllowlist(config, [
    'google/gemini-4-carbon',
    'google-vertex/gemini-4-carbon',
    'google/gemini-4-argon',
    'google-vertex/gemini-4-argon',
    'google/gemini-4-hydrogen',
    'google-vertex/gemini-4-hydrogen',
    'google/gemini-3.8-flash',
    'google-vertex/gemini-3.8-flash',
    'deepseek/deepseek-flash',
    'anthropic/claude-sonnet-5-5',
    'anthropic/claude-fable-5-2',
    'openai/gpt-6.2-astra',
    'openai/gpt-6.2-sol',
    'xai/grok-4.7',
    'mistral/mistral-large-4-0',
    'meta/muse-wonder-1.0',
    'qwen/qwen4-max',
    'moonshot/kimi-k3.1-pro',
    'openai/gpt-5.3-chat-latest',
  ])

  assert.equal(typeof config.agents?.defaults?.models?.['google/gemini-4-carbon'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google-vertex/gemini-4-carbon'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google/gemini-4-argon'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google-vertex/gemini-4-argon'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google/gemini-4-hydrogen'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google-vertex/gemini-4-hydrogen'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google/gemini-3.8-flash'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google-vertex/gemini-3.8-flash'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['deepseek/deepseek-flash'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['anthropic/claude-sonnet-5-5'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['anthropic/claude-fable-5-2'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['openai/gpt-6.2-astra'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['openai/gpt-6.2-sol'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['xai/grok-4.7'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['mistral/mistral-large-4-0'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['meta/muse-wonder-1.0'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['qwen/qwen4-max'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['moonshot/kimi-k3.1-pro'], 'object')
  assert.equal(config.agents?.defaults?.models?.['openai/gpt-5.3-chat-latest'], undefined)
  assert.equal(config.models?.providers?.google?.api, 'google-generative-ai')
  assert.equal(config.models?.providers?.['google-vertex']?.api, 'google-vertex')
  assert.equal(config.models?.providers?.deepseek?.api, 'openai-completions')
  assert.equal(config.models?.providers?.deepseek?.baseUrl, 'https://api.deepseek.com')
  assert.equal(config.models?.providers?.deepseek?.apiKey, '${DEEPSEEK_API_KEY}')
  assert.equal(config.models?.providers?.anthropic?.api, 'anthropic-messages')
  assert.deepEqual(config.models?.providers?.openai?.agentRuntime, { id: 'codex' })
  assert.ok(Array.isArray(config.models?.providers?.xai?.models))
  assert.ok(Array.isArray(config.models?.providers?.mistral?.models))
  assert.equal(config.models?.providers?.mistral?.api, 'openai-completions')
  assert.equal(config.models?.providers?.mistral?.baseUrl, 'https://api.mistral.ai/v1')
  assert.equal(config.models?.providers?.mistral?.apiKey, '${MISTRAL_API_KEY}')
  assert.ok(Array.isArray(config.models?.providers?.meta?.models))
  assert.equal(config.models?.providers?.meta?.api, 'openai-responses')
  assert.equal(config.models?.providers?.meta?.baseUrl, 'https://api.meta.ai/v1')
  assert.equal(config.models?.providers?.meta?.apiKey, '${MODEL_API_KEY}')
  assert.ok(Array.isArray(config.models?.providers?.qwen?.models))
  assert.equal(config.models?.providers?.qwen?.api, 'openai-completions')
  assert.equal(config.models?.providers?.qwen?.baseUrl, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  assert.equal(config.models?.providers?.qwen?.apiKey, '${QWEN_API_KEY}')
  assert.ok(Array.isArray(config.models?.providers?.moonshot?.models))
  assert.equal(config.models?.providers?.moonshot?.api, 'openai-completions')
  assert.equal(config.models?.providers?.moonshot?.baseUrl, 'https://api.moonshot.ai/v1')
  assert.equal(config.models?.providers?.moonshot?.apiKey, '${MOONSHOT_API_KEY}')
  assert.deepEqual(state.fastModeModelIds.sort(), [
    'google/gemini-4-carbon',
    'google-vertex/gemini-4-carbon',
    'google/gemini-4-argon',
    'google-vertex/gemini-4-argon',
    'google/gemini-4-hydrogen',
    'google-vertex/gemini-4-hydrogen',
    'google/gemini-3.8-flash',
    'google-vertex/gemini-3.8-flash',
    'deepseek/deepseek-flash',
    'anthropic/claude-fable-5-2',
    'anthropic/claude-sonnet-5-5',
    'openai/gpt-6.2-astra',
    'openai/gpt-6.2-sol',
    'xai/grok-4.7',
    'mistral/mistral-large-4-0',
    'meta/muse-wonder-1.0',
    'qwen/qwen4-max',
    'moonshot/kimi-k3.1-pro',
  ].sort())
})

test('configured OpenAI-compatible provider models preserve explicit regional endpoints', () => {
  const config: ModelCatalogOpenClawConfig = {
    models: {
      providers: {
        qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        moonshot: { baseUrl: 'https://api.moonshot.cn/v1' },
      },
    },
  }

  ensureConfiguredProviderModel(config, 'qwen/qwen4-max')
  ensureConfiguredProviderModel(config, 'moonshot/kimi-k3.1-pro')

  assert.equal(config.models?.providers?.qwen?.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(config.models?.providers?.moonshot?.baseUrl, 'https://api.moonshot.cn/v1')
  assert.equal(config.models?.providers?.qwen?.api, 'openai-completions')
  assert.equal(config.models?.providers?.moonshot?.api, 'openai-completions')
})

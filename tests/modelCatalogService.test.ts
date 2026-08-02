import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalAgentModelId,
  createModelCatalogService,
  isModelSafeForOpenClawConfig,
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

test('fallback catalog canonicalizes Codex subscription models and suppresses unavailable ids', () => {
  const { service } = createHarness()
  const fallback = service.fallbackAvailableModels()
  const codexSpark = fallback.find((model) => model.id === 'openai/gpt-5.3-codex-spark')
  const geminiFlash = fallback.find((model) => model.id === 'google/gemini-3.6-flash')
  const vertexGeminiFlash = fallback.find((model) => model.id === 'google-vertex/gemini-3.6-flash')
  const metaMuse = fallback.find((model) => model.id === 'meta/muse-spark-1.1')

  assert.equal(canonicalAgentModelId('gpt-5.3-codex-spark'), 'openai/gpt-5.3-codex-spark')
  assert.equal(codexSpark?.provider, 'openai')
  assert.equal(fallback.some((model) => model.id === 'openai/gpt-5.3-chat-latest'), false)
  assert.equal(isModelSafeForOpenClawConfig('openai/gpt-5.3-chat-latest'), false)
  assert.equal(isModelSafeForOpenClawConfig('openai/gpt-5.3-codex-spark'), true)
  assert.equal(geminiFlash?.alias, 'Gemini 3.6 Flash (GA)')
  assert.equal(geminiFlash?.streaming.provider, 'google')
  assert.equal(vertexGeminiFlash?.alias, 'Vertex Gemini 3.6 Flash (GA)')
  assert.equal(vertexGeminiFlash?.streaming.provider, 'google-vertex')
  assert.equal(metaMuse?.alias, 'Muse Spark 1.1 (Meta)')
  assert.equal(metaMuse?.streaming.provider, 'meta')
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
        { id: 'google-vertex/gemini-3.6-flash', provider: 'google-vertex', name: 'gemini-3.6-flash' },
        { id: 'openai/gpt-5.3-chat-latest', provider: 'openai', name: 'gpt-5.3-chat-latest' },
      ],
    },
  })

  const cache = await service.refreshAvailableModelsCache()
  assert.equal(cache.source, 'openclaw')
  assert.equal(cache.models[0]?.id, 'google-vertex/gemini-3.6-flash')
  assert.ok(cache.models.some((model) => model.id === 'anthropic/claude-custom'))
  assert.equal(cache.models.some((model) => model.id === 'openai/gpt-5.3-chat-latest'), false)
  assert.equal(state.writes.length, 1)
  assert.equal(
    typeof state.config.agents?.defaults?.models?.['openrouter/*'],
    'object',
  )
  assert.equal(
    typeof state.config.agents?.defaults?.models?.['openrouter/deepseek/deepseek-v4-pro'],
    'object',
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
    'google/gemini-3.6-flash',
    'google-vertex/gemini-3.6-flash',
    'deepseek/deepseek-v4-flash',
    'openai/gpt-5.3-chat-latest',
  ])

  assert.equal(typeof config.agents?.defaults?.models?.['google/gemini-3.6-flash'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['google-vertex/gemini-3.6-flash'], 'object')
  assert.equal(typeof config.agents?.defaults?.models?.['deepseek/deepseek-v4-flash'], 'object')
  assert.equal(config.agents?.defaults?.models?.['openai/gpt-5.3-chat-latest'], undefined)
  assert.equal(config.models?.providers?.google?.api, 'google-generative-ai')
  assert.equal(config.models?.providers?.['google-vertex']?.api, 'google-vertex')
  assert.equal(config.models?.providers?.deepseek?.api, 'openai-completions')
  assert.equal(config.models?.providers?.deepseek?.baseUrl, 'https://api.deepseek.com')
  assert.deepEqual(state.fastModeModelIds.sort(), [
    'deepseek/deepseek-v4-flash',
    'google-vertex/gemini-3.6-flash',
    'google/gemini-3.6-flash',
  ].sort())
})

import { automniaThinkingDefaultForModel } from './automniaGeminiThinking'
import {
  createModelReasoningDefaultCache,
  type ModelReasoningDefault,
} from './modelReasoningDefaultCache'

export const MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 1
export const MODEL_PROBE_TIMEOUT_MS = 15_000
export const MODEL_PROBE_MAX_OUTPUT_TOKENS = 8
export const MODEL_PROBE_COOLDOWN_MS = 5 * 60 * 1000

const MAX_MODELS_PER_PROVIDER_SNAPSHOT = 500
const MAX_PROVIDER_SNAPSHOTS = 100
const MAX_STORED_MODEL_PROBE_RESULTS = 250
const OPENCLAW_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}\/[^\s]{1,255}$/i
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i
const MODEL_INPUT_MODALITIES = new Set(['text', 'image', 'audio', 'video', 'document'])

export type ModelCapabilityRecord = {
  id: string
  provider: string
  name?: string
  contextWindow?: number
  contextTokens?: number
  contextWindows?: Array<Record<string, unknown>>
  input?: string[]
  output?: string[]
  reasoning?: boolean
  thinkingDefault?: ModelReasoningDefault
  supportsTools?: boolean
  source: 'openclaw-model-catalog'
  verifiedAt: string
}

export type ModelProviderCapabilitySnapshot = {
  provider: string
  schemaVersion: typeof MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION
  source: 'openclaw-model-catalog'
  verifiedAt: string
  catalogOutcome: 'ready' | 'auth-rejected' | 'unavailable' | 'unknown'
  models: ModelCapabilityRecord[]
}

export type ModelProbeResult = {
  modelId: string
  provider: string
  status: 'passed' | 'failed' | 'blocked'
  reason: 'ok' | 'provider_not_configured' | 'provider_auth_or_entitlement_failed' | 'model_not_snapshotted' | 'cooldown' | 'probe_in_progress' | 'probe_failed' | 'invalid_probe_response'
  checkedAt: string
  durationMs: number
  timeoutMs: typeof MODEL_PROBE_TIMEOUT_MS
  maxOutputTokens: typeof MODEL_PROBE_MAX_OUTPUT_TOKENS
}

export type ModelCapabilityStoreState = {
  schemaVersion: typeof MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION
  providers: Record<string, ModelProviderCapabilitySnapshot>
  probes: Record<string, ModelProbeResult>
}

type OpenClawRunResult = {
  code: number
  stdout?: string
  stderr?: string
}

export type ModelCenterServiceOptions = {
  isProviderConfigured: (provider: string) => boolean
  now?: () => number
  readState: () => ModelCapabilityStoreState | null | Promise<ModelCapabilityStoreState | null>
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<OpenClawRunResult>
  writeState: (value: ModelCapabilityStoreState) => boolean | Promise<boolean>
}

export type ModelFallbackExplanation = {
  requestedModel: string | null
  resolvedModel: string
  fallbackChain: string[]
  selectedFrom: 'requested' | 'agent-fallback' | 'configured-default' | 'system-default' | 'billing-policy'
  reason: 'requested-model-selected' | 'requested-model-unavailable' | 'configured-fallback-selected' | 'configured-default-selected' | 'system-default-selected' | 'billing-policy-override'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function positiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) return undefined
  return value
}

function modelIdFor(value: Record<string, unknown>) {
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  return OPENCLAW_MODEL_ID_PATTERN.test(id) ? id : ''
}

function providerFor(value: Record<string, unknown>, id: string) {
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  return PROVIDER_ID_PATTERN.test(provider) ? provider : id.slice(0, id.indexOf('/'))
}

function stringList(value: unknown, allowed?: Set<string>) {
  if (!Array.isArray(value)) return undefined
  const values = [...new Set(value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const normalized = entry.trim().toLowerCase()
    return normalized && (!allowed || allowed.has(normalized)) ? [normalized] : []
  }))]
  return values.length ? values : undefined
}

function normalizeContextWindows(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const rows = value.slice(0, 16).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const contextWindow = positiveInteger(entry.contextWindow)
    const contextTokens = positiveInteger(entry.contextTokens)
    if (!contextWindow && !contextTokens) return []
    const output: Record<string, unknown> = {}
    if (contextWindow) output.contextWindow = contextWindow
    if (contextTokens) output.contextTokens = contextTokens
    for (const key of ['id', 'name', 'label', 'region']) {
      if (typeof entry[key] === 'string' && (entry[key] as string).length <= 100) output[key] = entry[key]
    }
    return [output]
  })
  return rows.length ? rows : undefined
}

function normalizeModelCapabilities(value: unknown, provider: string, verifiedAt: string): ModelCapabilityRecord | null {
  if (!isRecord(value)) return null
  const id = modelIdFor(value)
  if (!id) return null
  const actualProvider = providerFor(value, id)
  if (actualProvider !== provider) return null
  const record: ModelCapabilityRecord = {
    id,
    provider,
    source: 'openclaw-model-catalog',
    verifiedAt,
  }
  if (typeof value.name === 'string' && value.name.trim().length <= 200) record.name = value.name.trim()
  const contextWindow = positiveInteger(value.contextWindow)
  const contextTokens = positiveInteger(value.contextTokens)
  if (contextWindow) record.contextWindow = contextWindow
  if (contextTokens) record.contextTokens = contextTokens
  const contextWindows = normalizeContextWindows(value.contextWindows)
  if (contextWindows) record.contextWindows = contextWindows
  const input = stringList(value.input, MODEL_INPUT_MODALITIES)
  const output = stringList(value.output, MODEL_INPUT_MODALITIES)
  if (input) record.input = input
  if (output) record.output = output
  if (typeof value.reasoning === 'boolean') record.reasoning = value.reasoning
  if (typeof value.supportsTools === 'boolean') record.supportsTools = value.supportsTools
  return record
}

function normalizeStoreState(value: unknown): ModelCapabilityStoreState {
  if (!isRecord(value)) return { schemaVersion: MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION, providers: {}, probes: {} }
  const providers: Record<string, ModelProviderCapabilitySnapshot> = {}
  if (isRecord(value.providers)) {
    for (const [provider, snapshot] of Object.entries(value.providers).slice(-MAX_PROVIDER_SNAPSHOTS)) {
      if (!PROVIDER_ID_PATTERN.test(provider) || !isRecord(snapshot) || !Array.isArray(snapshot.models)) continue
      const verifiedAt = typeof snapshot.verifiedAt === 'string' ? snapshot.verifiedAt : new Date(0).toISOString()
      const models = snapshot.models.flatMap((model) => {
        const normalized = normalizeModelCapabilities(model, provider, verifiedAt)
        return normalized ? [normalized] : []
      }).slice(0, MAX_MODELS_PER_PROVIDER_SNAPSHOT)
      if (!models.length) continue
      const outcome = snapshot.catalogOutcome
      providers[provider] = {
        provider,
        schemaVersion: MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
        source: 'openclaw-model-catalog',
        verifiedAt,
        catalogOutcome: outcome === 'ready' || outcome === 'auth-rejected' || outcome === 'unavailable' ? outcome : 'unknown',
        models,
      }
    }
  }
  const probes: Record<string, ModelProbeResult> = {}
  if (isRecord(value.probes)) {
    for (const [modelId, result] of Object.entries(value.probes).slice(-MAX_STORED_MODEL_PROBE_RESULTS)) {
      if (!OPENCLAW_MODEL_ID_PATTERN.test(modelId) || !isRecord(result)) continue
      if (result.status !== 'passed' && result.status !== 'failed' && result.status !== 'blocked') continue
      const checkedAtMs = typeof result.checkedAt === 'string' ? Date.parse(result.checkedAt) : Number.NaN
      if (!Number.isFinite(checkedAtMs)) continue
      const provider = modelId.slice(0, modelId.indexOf('/'))
      const allowedReasons = new Set<ModelProbeResult['reason']>([
        'ok',
        'provider_not_configured',
        'provider_auth_or_entitlement_failed',
        'model_not_snapshotted',
        'cooldown',
        'probe_in_progress',
        'probe_failed',
        'invalid_probe_response',
      ])
      const reason = allowedReasons.has(result.reason as ModelProbeResult['reason'])
        ? result.reason as ModelProbeResult['reason']
        : 'probe_failed'
      const durationMs = typeof result.durationMs === 'number'
        && Number.isFinite(result.durationMs)
        && result.durationMs >= 0
        ? Math.min(Math.floor(result.durationMs), MODEL_PROBE_TIMEOUT_MS)
        : 0
      probes[modelId] = {
        modelId,
        provider,
        status: result.status,
        reason,
        checkedAt: new Date(checkedAtMs).toISOString(),
        durationMs,
        timeoutMs: MODEL_PROBE_TIMEOUT_MS,
        maxOutputTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS,
      }
    }
  }
  return { schemaVersion: MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION, providers, probes }
}

function catalogRows(parsed: unknown) {
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) return []
  return parsed.models
}

function catalogOutcomeFor(parsed: unknown, provider: string): ModelProviderCapabilitySnapshot['catalogOutcome'] {
  if (!isRecord(parsed) || !Array.isArray(parsed.providerOutcomes)) return 'unknown'
  const outcome = parsed.providerOutcomes.find((entry) => isRecord(entry) && entry.provider === provider)
  if (!isRecord(outcome)) return 'unknown'
  return outcome.status === 'ready' || outcome.status === 'auth-rejected' || outcome.status === 'unavailable'
    ? outcome.status
    : 'unknown'
}

function safeErrorReason(run: OpenClawRunResult, parsed: unknown) {
  if (run.code !== 0) return 'catalog_unavailable'
  if (!isRecord(parsed) && !Array.isArray(parsed)) return 'invalid_catalog_response'
  return 'empty_catalog'
}

function isAuthOrEntitlementFailure(value: unknown) {
  if (typeof value !== 'string') return false
  return /\b(?:401|403)\b|unauthori[sz]ed|permission[_\s-]*denied|\bforbidden\b/i.test(value)
    || /api[ _-]?key.{0,32}(?:invalid|missing)/i.test(value)
    || /(?:billing|quota).{0,40}(?:disabled|not enabled|denied|exceeded)|entitle(?:ment|d)?/i.test(value)
}

function normalizeModelRef(modelId: string) {
  const normalized = modelId.trim()
  return OPENCLAW_MODEL_ID_PATTERN.test(normalized) ? normalized : ''
}

export function explainModelFallback(input: {
  requestedModel: string | null | undefined
  resolvedModel: string
  fallbacks?: string[]
  defaultModel?: string | null
  requestedModelUnavailable?: boolean
  billingPolicyOverride?: boolean
}): ModelFallbackExplanation {
  const requestedModel = normalizeModelRef(input.requestedModel || '') || null
  const resolvedModel = normalizeModelRef(input.resolvedModel)
  const fallbackChain = [...new Set((input.fallbacks || []).map(normalizeModelRef).filter(Boolean))].slice(0, 32)
  if (!resolvedModel) throw new Error('Resolved model ID is invalid')
  if (input.billingPolicyOverride && requestedModel !== resolvedModel) {
    return { requestedModel, resolvedModel, fallbackChain, selectedFrom: 'billing-policy', reason: 'billing-policy-override' }
  }
  if (!requestedModel) {
    const defaultModel = normalizeModelRef(input.defaultModel || '')
    return {
      requestedModel: null,
      resolvedModel,
      fallbackChain,
      selectedFrom: defaultModel ? 'configured-default' : 'system-default',
      reason: defaultModel ? 'configured-default-selected' : 'system-default-selected',
    }
  }
  if (requestedModel === resolvedModel) {
    return { requestedModel, resolvedModel, fallbackChain, selectedFrom: 'requested', reason: 'requested-model-selected' }
  }
  const selectedFrom = fallbackChain.includes(resolvedModel) ? 'agent-fallback' : 'system-default'
  const reason = input.requestedModelUnavailable
    ? 'requested-model-unavailable'
    : selectedFrom === 'agent-fallback'
      ? 'configured-fallback-selected'
      : 'system-default-selected'
  return { requestedModel, resolvedModel, fallbackChain, selectedFrom, reason }
}

export function createModelCenterService(options: ModelCenterServiceOptions) {
  const nowMs = options.now ?? (() => Date.now())
  let probeInProgress = false
  const reasoningDefaultCache = createModelReasoningDefaultCache()

  function withReasoningDefaults(snapshot: ModelProviderCapabilitySnapshot): ModelProviderCapabilitySnapshot {
    return {
      ...snapshot,
      models: snapshot.models.map((model) => {
        const defaultThinking = reasoningDefaultCache.resolve(
          model.provider,
          model.id.slice(model.id.indexOf('/') + 1),
          {
            name: model.name,
            contextWindow: model.contextWindow,
            contextTokens: model.contextTokens,
            contextWindows: model.contextWindows,
            input: model.input,
            output: model.output,
            reasoning: model.reasoning,
            supportsTools: model.supportsTools,
          },
          () => model.reasoning === false
            ? 'off'
            : (model.provider === 'automnia-cloud' ? automniaThinkingDefaultForModel(model.id) : undefined)
              || (model.reasoning === true ? 'low' : undefined),
        )
        return defaultThinking ? { ...model, thinkingDefault: defaultThinking } : model
      }),
    }
  }

  async function readState() {
    return normalizeStoreState(await options.readState())
  }

  async function getCapabilitySnapshots(provider?: string) {
    const state = await readState()
    const values = provider
      ? [state.providers[provider]].filter((value): value is ModelProviderCapabilitySnapshot => Boolean(value))
      : Object.values(state.providers)
    return values.map((snapshot) => ({
      ...withReasoningDefaults(snapshot),
      stale: nowMs() - Date.parse(snapshot.verifiedAt) > 14 * 24 * 60 * 60 * 1000,
    }))
  }

  async function refreshProviderCapabilities(provider: string) {
    if (!PROVIDER_ID_PATTERN.test(provider)) return { ok: false as const, reason: 'invalid_provider' as const, snapshot: null }
    const result = await options.runOpenClaw(['models', 'list', '--all', '--json', '--refresh', '--provider', provider], 30_000)
    let parsed: unknown
    try {
      parsed = result.stdout ? JSON.parse(result.stdout) : null
    } catch {
      parsed = null
    }
    const verifiedAt = new Date(nowMs()).toISOString()
    const models = catalogRows(parsed)
      .flatMap((model) => {
        const normalized = normalizeModelCapabilities(model, provider, verifiedAt)
        return normalized ? [normalized] : []
      })
      .slice(0, MAX_MODELS_PER_PROVIDER_SNAPSHOT)
    if (result.code !== 0 || models.length === 0) {
      return {
        ok: false as const,
        reason: safeErrorReason(result, parsed),
        snapshot: (await getCapabilitySnapshots(provider))[0] || null,
      }
    }
    const state = await readState()
    const snapshot: ModelProviderCapabilitySnapshot = {
      provider,
      schemaVersion: MODEL_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
      source: 'openclaw-model-catalog',
      verifiedAt,
      catalogOutcome: catalogOutcomeFor(parsed, provider),
      models,
    }
    const next = {
      ...state,
      providers: { ...state.providers, [provider]: snapshot },
    }
    const boundedProviders = Object.fromEntries(Object.entries(next.providers).slice(-MAX_PROVIDER_SNAPSHOTS))
    if (!await options.writeState({ ...next, providers: boundedProviders })) {
      return { ok: false as const, reason: 'persistence_failed' as const, snapshot: (await getCapabilitySnapshots(provider))[0] || null }
    }
    return { ok: true as const, reason: 'refreshed' as const, snapshot: { ...withReasoningDefaults(snapshot), stale: false } }
  }

  async function persistProbeResult(result: ModelProbeResult) {
    const state = await readState()
    const probes = { ...state.probes, [result.modelId]: result }
    const boundedProbes = Object.fromEntries(Object.entries(probes).slice(-MAX_STORED_MODEL_PROBE_RESULTS))
    await options.writeState({ ...state, probes: boundedProbes })
  }

  async function probeModel(modelIdInput: string) {
    const modelId = normalizeModelRef(modelIdInput)
    if (!modelId) return { ok: false as const, reason: 'invalid_model_id' as const, result: null }
    const provider = modelId.slice(0, modelId.indexOf('/'))
    const state = await readState()
    const previous = state.probes[modelId]
    const checkedAtMs = previous ? Date.parse(previous.checkedAt) : 0
    const now = nowMs()
    if (previous && now - checkedAtMs < MODEL_PROBE_COOLDOWN_MS) {
      return { ok: false as const, reason: 'cooldown' as const, result: previous }
    }
    if (!state.providers[provider]?.models.some((model) => model.id === modelId)) {
      return { ok: false as const, reason: 'model_not_snapshotted' as const, result: null }
    }
    if (!options.isProviderConfigured(provider)) {
      return { ok: false as const, reason: 'provider_not_configured' as const, result: null }
    }
    if (probeInProgress) return { ok: false as const, reason: 'probe_in_progress' as const, result: null }
    probeInProgress = true
    const startedAt = nowMs()
    const checkedAt = new Date(startedAt).toISOString()
    const override = JSON.stringify({
      agents: {
        defaults: {
          contextInjection: 'never',
          model: { primary: modelId, fallbacks: [] },
          models: { [modelId]: { params: { maxTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS } } },
        },
      },
      tools: { deny: ['*'] },
    })
    let status: ModelProbeResult['status'] = 'failed'
    let reason: ModelProbeResult['reason'] = 'probe_failed'
    try {
      const result = await options.runOpenClaw([
        'agent', 'exec',
        '--message', 'Reply with the single word OK.',
        '--model', modelId,
        '--thinking', 'off',
        '--timeout', String(Math.floor(MODEL_PROBE_TIMEOUT_MS / 1000)),
        '--json',
        '--config-override', override,
      ], MODEL_PROBE_TIMEOUT_MS)
      let parsed: unknown
      try {
        parsed = result.stdout ? JSON.parse(result.stdout) : null
      } catch {
        parsed = null
      }
      if (result.code === 0 && isRecord(parsed) && parsed.ok === true) {
        status = 'passed'
        reason = 'ok'
      } else if (isAuthOrEntitlementFailure(`${result.stderr || ''}\n${result.stdout || ''}`)) {
        status = 'blocked'
        reason = 'provider_auth_or_entitlement_failed'
      } else if (result.code === 0) {
        reason = 'invalid_probe_response'
      }
    } catch (error) {
      if (isAuthOrEntitlementFailure(error instanceof Error ? error.message : String(error))) {
        status = 'blocked'
        reason = 'provider_auth_or_entitlement_failed'
      } else {
        reason = 'probe_failed'
      }
    } finally {
      probeInProgress = false
    }
    const probeResult: ModelProbeResult = {
      modelId,
      provider,
      status,
      reason,
      checkedAt,
      durationMs: Math.max(0, nowMs() - startedAt),
      timeoutMs: MODEL_PROBE_TIMEOUT_MS,
      maxOutputTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS,
    }
    await persistProbeResult(probeResult)
    return { ok: status === 'passed', reason, result: probeResult }
  }

  return { getCapabilitySnapshots, probeModel, refreshProviderCapabilities }
}

export type ModelCenterService = ReturnType<typeof createModelCenterService>

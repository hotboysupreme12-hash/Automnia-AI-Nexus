import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProviderAuthModal } from '../auth/ProviderAuthModal'
import type { ThinkingLevel } from '../../types/nexus'
import { apiErrorMessage, apiRequest } from '../../api/client'
import {
  authKindForProvider,
  authLabelForProvider,
  effectiveAuthStatusForProvider,
  fetchProviderAuthStatuses,
  saveProviderApiKey,
  type AuthProviderStatus,
} from '../../api/providerAuth'
import { isSelectableModelId } from '../../utils/modelGrouping'
import { ModelPicker } from '../models/ModelPicker'
import {
  AUTOMNIA_CREDITS_MODEL_ID,
  isAutomniaCreditsModelId,
  isCreditsOnlyEntitlement,
  resolveAgentRoutePresentation,
  resolveLicenseEntitlement,
} from '../../utils/licenseEntitlement'
import { useLicense } from '../../context/useLicense'

interface AvailableModel {
  id: string
  alias: string
  provider: string
  name: string
}

const isOpenAiCodexSubscriptionModel = (modelId: string) => {
  const [, model = ''] = modelId.trim().split('/')
  return /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model)
}

interface ModelSelectorModalProps {
  isOpen: boolean
  agentId: string
  agentName: string
  currentModel: string
  currentFallbacks: string[]
  currentThinking?: ThinkingLevel
  onClose: () => void
  onSave: (primary: string, fallbacks: string[], thinking: ThinkingLevel) => Promise<void>
}

const CODEX_5_3_SPARK_MODEL_ID = 'openai/gpt-5.3-codex-spark'
const CODEX_5_3_SPARK_MODEL: AvailableModel = {
  id: CODEX_5_3_SPARK_MODEL_ID,
  alias: 'gpt-5.3-codex-spark',
  provider: 'openai',
  name: 'Codex 5.3 Spark',
}
const AUTOMNIA_CREDITS_MODEL: AvailableModel = {
  id: AUTOMNIA_CREDITS_MODEL_ID,
  alias: 'Automnia credits',
  provider: 'automnia-cloud',
  name: 'Gemini 3.6 Flash',
}
const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly ThinkingLevel[]
const MODEL_SELECTOR_CACHE_MS = 5 * 60 * 1000
const MODEL_SELECTOR_FETCH_TIMEOUT_MS = 8000

let modelSelectorModelsCache: { value: AvailableModel[]; expiresAt: number } | null = null
let modelSelectorModelsRequest: Promise<AvailableModel[]> | null = null

const isAvailableModel = (value: unknown): value is AvailableModel => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AvailableModel>
  return typeof entry.id === 'string' && typeof entry.alias === 'string' && typeof entry.provider === 'string' && typeof entry.name === 'string'
}

const safeAvailableModels = (value: unknown): AvailableModel[] =>
  Array.isArray(value) ? value.filter(isAvailableModel).filter((model) => isSelectableModelId(model.id)) : []

const modelOptionFromId = (modelId: string): AvailableModel | null => {
  const id = modelId.trim()
  if (!id) return null
  const [rawProvider = '', ...modelParts] = id.split('/')
  const provider = isOpenAiCodexSubscriptionModel(id) ? 'openai' : rawProvider || 'model'
  const name = modelParts.join('/') || id
  return { id, alias: name, provider, name }
}

function modelBrief(modelId: string): { title: string; description: string; tone: string } | null {
  const normalized = modelId.toLowerCase()
  if (normalized.includes('gpt-5.6-sol')) {
    return { title: 'Flagship research and coding', description: 'Best fit for complex planning, agentic coding, and difficult research tasks.', tone: 'cyan' }
  }
  if (normalized.includes('gpt-5.6-terra')) {
    return { title: 'Balanced reasoning', description: 'Strong general reasoning with a more efficient runtime profile.', tone: 'emerald' }
  }
  if (normalized.includes('gpt-5.6-luna')) {
    return { title: 'High-volume execution', description: 'Optimized for economical, parallel task throughput.', tone: 'amber' }
  }
  if (normalized.includes('claude-fable-5')) {
    return { title: 'Anthropic flagship', description: 'Highest-capability Claude 5 option; check retention requirements before sensitive workloads.', tone: 'violet' }
  }
  if (normalized.includes('claude-sonnet-5')) {
    return { title: 'Fast Claude 5 reasoning', description: 'A strong default for demanding day-to-day analysis and implementation.', tone: 'violet' }
  }
  if (normalized.includes('claude-opus-4-8')) {
    return { title: 'Proven deep reasoning', description: 'A robust Claude option when you need conservative, high-quality outputs.', tone: 'violet' }
  }
  return null
}

const mergeSelectedModelOptions = (catalog: AvailableModel[], selectedIds: string[], creditsOnly = false) => {
  const merged = new Map<string, AvailableModel>()
  const allowedCatalog = creditsOnly ? catalog.filter((model) => isAutomniaCreditsModelId(model.id)) : catalog
  const seededCatalog = catalog.some((model) => model.id === CODEX_5_3_SPARK_MODEL_ID)
    ? creditsOnly
      ? (allowedCatalog.some((model) => model.id === AUTOMNIA_CREDITS_MODEL_ID) ? allowedCatalog : [AUTOMNIA_CREDITS_MODEL, ...allowedCatalog])
      : catalog
    : creditsOnly
      ? (allowedCatalog.some((model) => model.id === AUTOMNIA_CREDITS_MODEL_ID) ? allowedCatalog : [AUTOMNIA_CREDITS_MODEL, ...allowedCatalog])
      : [CODEX_5_3_SPARK_MODEL, ...catalog]
  for (const model of seededCatalog) {
    if (model.id.trim() && isSelectableModelId(model.id)) merged.set(model.id, model)
  }
  for (const selectedId of creditsOnly ? selectedIds.filter((modelId) => isAutomniaCreditsModelId(modelId)) : selectedIds) {
    if (!isSelectableModelId(selectedId)) continue
    const synthetic = modelOptionFromId(selectedId)
    if (synthetic && !merged.has(synthetic.id)) merged.set(synthetic.id, synthetic)
  }
  return Array.from(merged.values())
}

async function fetchModelSelectorModels() {
  const cached = modelSelectorModelsCache && modelSelectorModelsCache.expiresAt > Date.now() ? modelSelectorModelsCache.value : null
  if (cached) return cached
  if (modelSelectorModelsRequest) return modelSelectorModelsRequest

  modelSelectorModelsRequest = apiRequest<{ models?: unknown; error?: string; detail?: string }>('/api/models/available?background=0', {
    timeoutMs: MODEL_SELECTOR_FETCH_TIMEOUT_MS,
  })
    .then((result) => {
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const payload = result.data
      const models = safeAvailableModels(payload.models)
      modelSelectorModelsCache = { value: models, expiresAt: Date.now() + MODEL_SELECTOR_CACHE_MS }
      return models
    })
    .finally(() => {
      modelSelectorModelsRequest = null
    })

  return modelSelectorModelsRequest
}

export function ModelSelectorModal({
  isOpen,
  agentId,
  agentName,
  currentModel,
  currentFallbacks,
  currentThinking = 'off',
  onClose,
  onSave,
}: ModelSelectorModalProps) {
  const { license } = useLicense()
  const creditsOnly = isCreditsOnlyEntitlement(license)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [selectedPrimary, setSelectedPrimary] = useState(currentModel)
  const [selectedFallbacks, setSelectedFallbacks] = useState<string[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState(currentThinking !== 'off')
  const [thinkingLevel, setThinkingLevel] = useState<Exclude<ThinkingLevel, 'off'>>(
    currentThinking === 'off' ? 'minimal' : currentThinking,
  )
  const [authProviders, setAuthProviders] = useState<AuthProviderStatus[]>([])
  const [authModalProvider, setAuthModalProvider] = useState<AuthProviderStatus | null>(null)
  const authRefreshKeyRef = useRef('')

  const fetchModels = useCallback(async () => {
    const cached = modelSelectorModelsCache && modelSelectorModelsCache.expiresAt > Date.now() ? modelSelectorModelsCache.value : null
    if (cached) setModels(cached)
    setLoading(!cached && !currentModel)
    try {
      const models = await fetchModelSelectorModels()
      setModels(models)
      if (creditsOnly) {
        setSelectedPrimary(AUTOMNIA_CREDITS_MODEL_ID)
        setSelectedFallbacks([])
      } else if (!currentModel && models.length) {
        setSelectedPrimary(models[0].id)
      }
    } catch (error) {
      if (!currentModel) setStatus(`Failed to load models: ${error}`)
      setModels((current) => current.length ? current : modelSelectorModelsCache?.value || [])
    } finally {
      setLoading(false)
    }
  }, [currentModel, creditsOnly])

  const upsertAuthProviderStatus = useCallback((next?: AuthProviderStatus | null) => {
    if (!next) return
    setAuthModalProvider((current) => current?.provider === next.provider ? next : current)
    setAuthProviders((current) => current.some((entry) => entry.provider === next.provider)
      ? current.map((entry) => entry.provider === next.provider ? next : entry)
      : [next, ...current])
  }, [])

  const fetchAuthProviders = useCallback(async (force = false) => {
    try {
      const result = await fetchProviderAuthStatuses({ refresh: force, timeoutMs: force ? 30_000 : 8_000 })
      const next = result.ok ? result.data.providers || [] : []
      setAuthProviders(next)
      setAuthModalProvider((current) => current ? next.find((entry) => entry.provider === current.provider) || current : current)
      return next
    } catch {
      setAuthProviders([])
      return []
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setSelectedPrimary(creditsOnly ? AUTOMNIA_CREDITS_MODEL_ID : currentModel)
    setSelectedFallbacks(creditsOnly ? [] : currentFallbacks)
    setThinkingEnabled(currentThinking !== 'off')
    setThinkingLevel(currentThinking === 'off' ? 'minimal' : currentThinking)
    authRefreshKeyRef.current = ''
    void fetchModels()
    void fetchAuthProviders()
  }, [isOpen, currentModel, currentFallbacks, currentThinking, fetchModels, fetchAuthProviders, creditsOnly])

  const selectableModels = useMemo(
    () => mergeSelectedModelOptions(models, [selectedPrimary, ...selectedFallbacks].filter(Boolean), creditsOnly),
    [models, selectedPrimary, selectedFallbacks, creditsOnly],
  )

  const providerForModel = (modelId: string) =>
    selectableModels.find((model) => model.id === modelId)?.provider || (isOpenAiCodexSubscriptionModel(modelId) ? 'openai' : modelId.split('/')[0] || '')

  const handleSave = async () => {
    if (!selectedPrimary) {
      setStatus('Select a primary model before saving.')
      return
    }
    if (creditsOnly && !isAutomniaCreditsModelId(selectedPrimary)) {
      setSelectedPrimary(AUTOMNIA_CREDITS_MODEL_ID)
      setSelectedFallbacks([])
      setStatus('Starter subscriptions can use Automnia credits only.')
      return
    }
    const primaryProvider = providerForModel(selectedPrimary)
    const providerStatus = effectiveAuthStatusForProvider(authProviders, primaryProvider)
    if (providerStatus && !providerStatus.configured) {
      setStatus(`Missing ${authLabelForProvider(primaryProvider, providerStatus)} ${authKindForProvider(providerStatus)}. Connect this provider before saving.`)
      setAuthModalProvider(providerStatus)
      return
    }
    setSaving(true)
    setStatus('')
    try {
      await onSave(selectedPrimary, selectedFallbacks, thinkingEnabled ? thinkingLevel : 'off')
      setStatus('Model configuration saved')
      setTimeout(onClose, 1200)
    } catch (error) {
      setStatus(`Failed to save: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleFallback = (modelId: string) => {
    if (selectedFallbacks.includes(modelId)) {
      setSelectedFallbacks(selectedFallbacks.filter((id) => id !== modelId))
    } else {
      setSelectedFallbacks([...selectedFallbacks, modelId])
    }
  }

  const primaryProvider = selectedPrimary ? providerForModel(selectedPrimary) : ''
  const primaryProviderStatus = primaryProvider
    ? effectiveAuthStatusForProvider(authProviders, primaryProvider)
    : undefined
  const selectedModelBrief = selectedPrimary ? modelBrief(selectedPrimary) : null
  const entitlement = resolveLicenseEntitlement(license)
  const routePresentation = resolveAgentRoutePresentation(license)
  const usesHostedCredits = entitlement.isHosted
  const usesByok = entitlement.isByok
  const providerFirst = routePresentation.providerFirst
  useEffect(() => {
    if (!isOpen || !selectedPrimary || !primaryProvider) return
    if (!primaryProviderStatus?.oauth?.supported || primaryProviderStatus.configured) return
    const key = `${primaryProvider}:${selectedPrimary}`
    if (authRefreshKeyRef.current === key) return
    authRefreshKeyRef.current = key
    void fetchAuthProviders(true).then((next) => {
      const refreshedStatus = effectiveAuthStatusForProvider(next, primaryProvider)
      if (refreshedStatus && !refreshedStatus.configured) setAuthModalProvider(refreshedStatus)
    })
  }, [
    isOpen,
    selectedPrimary,
    primaryProvider,
    primaryProviderStatus?.configured,
    primaryProviderStatus?.oauth?.supported,
    fetchAuthProviders,
  ])
  const selectedThinking: ThinkingLevel = thinkingEnabled ? thinkingLevel : 'off'

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md"
      >
        <div className="dy-surface-enter max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-cyan-200/45 bg-gradient-to-b from-blue-900/90 to-slate-950/95 p-5 shadow-glow">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-heading text-3xl text-slate-100">Configure Model</h3>
              <p className="text-sm text-cyan-100">
                {agentName} ({agentId})
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100"
            >
              Close
            </button>
          </div>

          {loading && !selectedPrimary && !selectableModels.length ? (
            <p className="text-center text-slate-300">Loading models...</p>
          ) : (
            <>
              <div data-model-selector-billing-route={usesHostedCredits ? routePresentation.providerOnly ? 'provider-only' : providerFirst ? 'provider-first' : 'automnia-first' : usesByok ? 'byok' : 'unconfigured'} className={`mb-4 rounded-xl border p-3 ${usesHostedCredits ? 'border-emerald-300/25 bg-emerald-400/[0.07] text-emerald-100' : usesByok ? 'border-sky-300/25 bg-sky-400/[0.07] text-sky-100' : 'border-slate-300/20 bg-slate-950/40 text-slate-200'}`}>
                <p className="text-sm font-semibold">{usesHostedCredits || usesByok ? `${entitlement.tierLabel} — ${routePresentation.routeLabel}` : 'License route not configured'}</p>
                <p className="mt-1 text-xs text-slate-300">{routePresentation.modelDescription}</p>
              </div>
              <div className="mb-4 grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-2">
                  <h4 className="text-lg font-semibold text-slate-100">{routePresentation.modelLabel}</h4>
                  {routePresentation.managedRoute ? (
                    <div data-model-selector-managed-route className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-base font-semibold text-emerald-100">Automnia</span>
                        <span className="rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">Subscription Relay</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">{routePresentation.managedRouteDescription}</p>
                    </div>
                  ) : <>
                  <p className="text-xs text-slate-300">{routePresentation.modelDescription}</p>
                  <ModelPicker
                    mode="primary"
                    models={selectableModels}
                    selectedIds={selectedPrimary ? [selectedPrimary] : []}
                    fallbackIds={selectedFallbacks}
                    onToggleFallback={toggleFallback}
                    emptyOption={{ label: 'Choose a model...', detail: 'Select a provider to browse its available models.' }}
                    label=""
                    providerAuthStatusFor={(provider) => effectiveAuthStatusForProvider(authProviders, provider)}
                    onProviderAuth={(_, providerStatus) => setAuthModalProvider(providerStatus)}
                    onSelect={(next) => {
                      setSelectedPrimary(next)
                      const provider = next ? providerForModel(next) : ''
                      const providerStatus = provider ? effectiveAuthStatusForProvider(authProviders, provider) : undefined
                      if (providerStatus && !providerStatus.configured) setAuthModalProvider(providerStatus)
                    }}
                  />
                  {selectedModelBrief && (
                    <div className={`rounded-xl border px-3 py-2 text-xs ${
                      selectedModelBrief.tone === 'emerald'
                        ? 'border-emerald-300/25 bg-emerald-400/[0.07] text-emerald-100'
                        : selectedModelBrief.tone === 'amber'
                          ? 'border-amber-300/25 bg-amber-400/[0.07] text-amber-100'
                          : selectedModelBrief.tone === 'violet'
                            ? 'border-violet-300/25 bg-violet-400/[0.07] text-violet-100'
                            : 'border-cyan-300/25 bg-cyan-400/[0.07] text-cyan-100'
                    }`}>
                      <p className="font-semibold">{selectedModelBrief.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-300">{selectedModelBrief.description}</p>
                      </div>
                  )}
                  </>}
                  {usesHostedCredits && providerFirst && <div data-model-selector-managed-route className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.05] px-3 py-2">
                    <p className="text-sm font-semibold text-emerald-100">Automnia</p>
                    <p className="mt-1 text-[11px] text-slate-300">{routePresentation.managedRouteDescription}</p>
                  </div>}
                </div>

              </div>

              <div className="mb-4 rounded-xl border border-violet-300/20 bg-violet-950/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-violet-100">Reasoning Effort</p>
                    <p className="mt-0.5 text-xs text-slate-300">Provider-native effort for this agent.</p>
                  </div>
                  <span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-violet-100">
                    {selectedThinking}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                  {REASONING_EFFORT_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        if (level === 'off') {
                          setThinkingEnabled(false)
                        } else {
                          setThinkingEnabled(true)
                          setThinkingLevel(level)
                        }
                      }}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold capitalize transition ${
                        selectedThinking === level
                          ? 'border-violet-300/60 bg-violet-400/15 text-violet-100'
                          : 'border-white/10 bg-slate-950/35 text-slate-400 hover:border-violet-300/30 hover:text-violet-100'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-cyan-100">{status}</p>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !selectedPrimary}
                  className="rounded-lg bg-cyan-700/40 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {authModalProvider && (
        <ProviderAuthModal
          isOpen={true}
          provider={authModalProvider.provider}
          envKeys={authModalProvider.envKeys}
          providerStatus={authModalProvider}
          onClose={() => setAuthModalProvider(null)}
          onSave={async (apiKey) => {
            const result = await saveProviderApiKey(authModalProvider.provider, apiKey)
            if (!result.ok) throw new Error(apiErrorMessage(result.error))
            await fetchAuthProviders(true)
          }}
          onConnected={async (nextStatus) => {
            upsertAuthProviderStatus(nextStatus)
            await fetchAuthProviders(true)
          }}
        />
      )}
    </>
  )
}

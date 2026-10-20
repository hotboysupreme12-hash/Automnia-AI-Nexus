import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useDialogFocus } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { FormFeedback } from '../ui/FormFeedback'
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
  AUTOMNIA_RELAY_MODEL_IDS,
  AUTOMNIA_RELAY_MODEL_LABELS,
  automniaRelayModelLabel,
  isAutomniaCreditsModelId,
  isAutomniaCreditsModelSelectionRoute,
  isAutomniaFrontierModelId,
  isAutomniaFrontierEligibleTier,
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
const AUTOMNIA_MODEL_OPTIONS: AvailableModel[] = AUTOMNIA_RELAY_MODEL_IDS.map((id) => ({
  id,
  alias: AUTOMNIA_RELAY_MODEL_LABELS[id],
  provider: 'automnia-cloud',
  name: AUTOMNIA_RELAY_MODEL_LABELS[id],
}))
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
  const managedName = provider.toLowerCase() === 'automnia-cloud' ? automniaRelayModelLabel(id) : name
  return { id, alias: managedName, provider, name: managedName }
}

function modelBrief(modelId: string): { title: string; description: string; tone: string } | null {
  const normalized = modelId.toLowerCase()
  if (normalized.includes('automnia-cloud/gemini-4-argon')) {
    return { title: 'Automnia Frontier reasoning', description: 'Automnia’s highest hosted tier, powered by Google Gemini 4 Argon for deep research, software engineering, and long-horizon agent work.', tone: 'cyan' }
  }
  if (normalized.includes('gpt-6-astra')) {
    return { title: 'Frontier research and agent work', description: 'OpenAI\'s highest-capability API model for complex research, reasoning, and tool-assisted work. Requires an OpenAI API key.', tone: 'cyan' }
  }
  if (normalized.includes('gpt-6.1-sol')) {
    return { title: 'Balanced frontier reasoning', description: 'OpenAI’s near-flagship model for demanding reasoning and coding at a lower cost than Astra.', tone: 'cyan' }
  }
  if (normalized.includes('gpt-6-luna')) {
    return { title: 'High-volume frontier execution', description: 'OpenAI’s efficient model for focused, parallel, and cost-sensitive workloads.', tone: 'amber' }
  }
  if (normalized.includes('gpt-5.6-sol')) {
    return { title: 'Flagship research and coding', description: 'Best fit for complex planning, agentic coding, and difficult research tasks.', tone: 'cyan' }
  }
  if (normalized.includes('gpt-5.6-terra')) {
    return { title: 'Balanced reasoning', description: 'Strong general reasoning with a more efficient runtime profile.', tone: 'emerald' }
  }
  if (normalized.includes('gpt-5.6-luna')) {
    return { title: 'High-volume execution', description: 'Optimized for economical, parallel task throughput.', tone: 'amber' }
  }
  if (normalized.includes('claude-fable-5-1')) {
    return { title: 'Anthropic frontier reasoning', description: 'Current Fable flagship for difficult reasoning and agent work; check retention requirements before sensitive workloads.', tone: 'violet' }
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
  if (normalized.includes('claude-opus-4-7')) {
    return { title: 'Anthropic frontier reasoning', description: 'An active Opus model for complex agent work and careful multi-step reasoning.', tone: 'violet' }
  }
  return null
}

const isAllowedAutomniaHostedModel = (modelId: string, frontierAllowed: boolean) =>
  isAutomniaCreditsModelId(modelId) || (frontierAllowed && isAutomniaFrontierModelId(modelId))

const mergeSelectedModelOptions = (catalog: AvailableModel[], selectedIds: string[], creditsOnly = false, frontierAllowed = false) => {
  const merged = new Map<string, AvailableModel>()
  const allowedCatalog = creditsOnly
    ? [
        ...AUTOMNIA_MODEL_OPTIONS.filter((model) => isAllowedAutomniaHostedModel(model.id, frontierAllowed)),
        ...catalog.filter((model) => isAllowedAutomniaHostedModel(model.id, frontierAllowed)),
      ]
    : catalog.filter((model) => frontierAllowed || !isAutomniaFrontierModelId(model.id))
  const seededCatalog = creditsOnly
    ? allowedCatalog
    : catalog.some((model) => model.id === CODEX_5_3_SPARK_MODEL_ID)
      ? catalog
      : [CODEX_5_3_SPARK_MODEL, ...catalog]
  for (const model of seededCatalog) {
    if (model.id.trim() && isSelectableModelId(model.id)) merged.set(model.id, model)
  }
  for (const selectedId of creditsOnly
    ? selectedIds.filter((modelId) => isAllowedAutomniaHostedModel(modelId, frontierAllowed))
    : selectedIds.filter((modelId) => frontierAllowed || !isAutomniaFrontierModelId(modelId))) {
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
  const creditsOnly = isAutomniaCreditsModelSelectionRoute(license)
  const frontierAllowed = isAutomniaFrontierEligibleTier(license?.tier)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [loading, setLoading] = useState(false)
  const dialogId = useId()
  const dialogRootRef = useRef<HTMLDivElement>(null)
  const dialogPanelRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'error' | 'success' | 'info'>('error')
  const saveCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
        setSelectedPrimary(isAllowedAutomniaHostedModel(currentModel, frontierAllowed) ? currentModel : AUTOMNIA_CREDITS_MODEL_ID)
        setSelectedFallbacks(currentFallbacks.filter((modelId) => isAllowedAutomniaHostedModel(modelId, frontierAllowed)))
      } else if (!frontierAllowed && isAutomniaFrontierModelId(currentModel)) {
        setSelectedPrimary(AUTOMNIA_CREDITS_MODEL_ID)
        setSelectedFallbacks(currentFallbacks.filter((modelId) => !isAutomniaFrontierModelId(modelId)))
      } else if (!currentModel && models.length) {
        setSelectedPrimary(models[0].id)
      }
    } catch (error) {
      if (!currentModel) setStatus(`Failed to load models: ${error}`)
      setModels((current) => current.length ? current : modelSelectorModelsCache?.value || [])
    } finally {
      setLoading(false)
    }
  }, [currentFallbacks, currentModel, creditsOnly, frontierAllowed])

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
    setSelectedPrimary(creditsOnly && !isAllowedAutomniaHostedModel(currentModel, frontierAllowed)
      ? AUTOMNIA_CREDITS_MODEL_ID
      : !frontierAllowed && isAutomniaFrontierModelId(currentModel)
        ? AUTOMNIA_CREDITS_MODEL_ID
        : currentModel)
    setSelectedFallbacks(creditsOnly
      ? currentFallbacks.filter((modelId) => isAllowedAutomniaHostedModel(modelId, frontierAllowed))
      : currentFallbacks.filter((modelId) => frontierAllowed || !isAutomniaFrontierModelId(modelId)))
    setThinkingEnabled(currentThinking !== 'off')
    setThinkingLevel(currentThinking === 'off' ? 'minimal' : currentThinking)
    authRefreshKeyRef.current = ''
    void fetchModels()
    void fetchAuthProviders()
  }, [isOpen, currentModel, currentFallbacks, currentThinking, fetchModels, fetchAuthProviders, creditsOnly, frontierAllowed])

  const selectableModels = useMemo(
    () => mergeSelectedModelOptions(models, [selectedPrimary, ...selectedFallbacks].filter(Boolean), creditsOnly, frontierAllowed),
    [models, selectedPrimary, selectedFallbacks, creditsOnly, frontierAllowed],
  )

  const providerForModel = (modelId: string) =>
    selectableModels.find((model) => model.id === modelId)?.provider || (isOpenAiCodexSubscriptionModel(modelId) ? 'openai' : modelId.split('/')[0] || '')

  useEffect(() => () => { if (saveCloseTimerRef.current) clearTimeout(saveCloseTimerRef.current) }, [isOpen])

  const handleSave = async () => {
    if (saving) return
    if (saveCloseTimerRef.current) clearTimeout(saveCloseTimerRef.current)
    setStatusTone('error')
    if (!selectedPrimary) {
      setStatus('Select a primary model before saving.')
      return
    }
    if (creditsOnly && !isAllowedAutomniaHostedModel(selectedPrimary, frontierAllowed)) {
      setSelectedPrimary(AUTOMNIA_CREDITS_MODEL_ID)
      setSelectedFallbacks([])
      setStatus(frontierAllowed
        ? 'Choose an Automnia hosted model.'
        : 'Starter subscriptions can use Automnia credits only.')
      return
    }
    if (!frontierAllowed && isAutomniaFrontierModelId(selectedPrimary)) {
      setSelectedPrimary(AUTOMNIA_CREDITS_MODEL_ID)
      setSelectedFallbacks((current) => current.filter((modelId) => !isAutomniaFrontierModelId(modelId)))
      setStatus('Automnia Frontier requires a Pro, Enterprise, or Automnia Frontier entitlement.')
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
      setStatusTone('success')
      setStatus('Model configuration saved')
      saveCloseTimerRef.current = setTimeout(onClose, 1200)
    } catch (error) {
      setStatus(`Failed to save: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleFallback = (modelId: string) => {
    setSelectedFallbacks((current) => current.includes(modelId)
      ? current.filter((id) => id !== modelId)
      : [...current, modelId])
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

  useDialogFocus({ open: isOpen, rootRef: dialogRootRef, panelRef: dialogPanelRef, onClose, preventClose: saving })
  if (!isOpen) return null

  return (
    <>
      <div
        ref={dialogRootRef}
        className="dui-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md"
      >
        <div ref={dialogPanelRef} role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} tabIndex={-1} className="dui-modal-surface dy-surface-enter max-h-[90dvh] w-full max-w-3xl overflow-auto rounded-2xl border p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 id={`${dialogId}-title`} className="font-heading text-3xl text-slate-100">Configure Model</h3>
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
                  {primaryProviderStatus && !primaryProviderStatus.configured && !creditsOnly && (
                    <div role="alert" className="mt-3 rounded-xl border border-amber-300/30 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-100">
                      <p className="font-semibold">Missing {authLabelForProvider(primaryProvider, primaryProviderStatus)} {authKindForProvider(primaryProviderStatus)}.</p>
                      <p className="mt-1">Connect it before using this model.</p>
                      <button
                        type="button"
                        className="mt-2 rounded-md border border-amber-200/35 bg-amber-200/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-amber-50"
                        onClick={() => setAuthModalProvider(primaryProviderStatus)}
                      >
                        Connect provider
                      </button>
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
                      aria-pressed={selectedThinking === level}
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

              <div className="flex flex-wrap items-center justify-between gap-3">
                <FormFeedback tone={statusTone}>{status}</FormFeedback>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!selectedPrimary}
                  loading={saving}
                  variant="primary"
                >
                  Save Configuration
                </Button>
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

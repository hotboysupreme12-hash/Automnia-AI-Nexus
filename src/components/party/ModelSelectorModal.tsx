import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ProviderAuthModal } from '../auth/ProviderAuthModal'
import type { ThinkingLevel } from '../../types/nexus'
import { apiUrl } from '../../utils/apiUrl'
import { formatModelGroupLabel, groupAvailableModels } from '../../utils/modelGrouping'

interface AvailableModel {
  id: string
  alias: string
  provider: string
  name: string
}

interface AuthProviderStatus {
  provider: string
  configured: boolean
  envKeys: string[]
  label?: string
  oauth?: {
    supported: boolean
    configured: boolean
    available: boolean
    missing?: string[]
    docs?: string
    redirectUri?: string
    projectId?: string
    accountId?: string
    email?: string
    expiresAt?: number
    clientIdEnvKeys?: string[]
    projectIdEnvKeys?: string[]
  }
}

const OAUTH_PROVIDER_FALLBACKS: Record<string, AuthProviderStatus> = {
  'openai-codex': {
    provider: 'openai-codex',
    configured: false,
    envKeys: [],
    label: 'OpenAI Codex',
    oauth: {
      supported: true,
      configured: false,
      available: true,
      missing: [],
      redirectUri: 'http://localhost:1455/auth/callback',
    },
  },
}

const authStatusForProvider = (providers: AuthProviderStatus[], provider: string) =>
  providers.find((entry) => entry.provider === provider) || OAUTH_PROVIDER_FALLBACKS[provider]

const isOpenAiCodexSubscriptionModel = (modelId: string) => {
  const [, model = ''] = modelId.trim().split('/')
  return /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model)
}

const authLabelForProvider = (provider: string, status?: AuthProviderStatus) =>
  status?.label || (provider === 'openai-codex' ? 'OpenAI Codex' : provider)

const authKindForProvider = (status?: AuthProviderStatus) => (status?.oauth?.supported ? 'OAuth' : 'auth')

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

const DEEPSEEK_PRO_MODEL = 'deepseek/deepseek-v4-pro'
const DEEPSEEK_FLASH_MODEL = 'deepseek/deepseek-v4-flash'
const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const satisfies readonly ThinkingLevel[]
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
  Array.isArray(value) ? value.filter(isAvailableModel) : []

const modelOptionFromId = (modelId: string): AvailableModel | null => {
  const id = modelId.trim()
  if (!id) return null
  const [rawProvider = '', ...modelParts] = id.split('/')
  const provider = isOpenAiCodexSubscriptionModel(id) ? 'openai-codex' : rawProvider || 'model'
  const name = modelParts.join('/') || id
  return { id, alias: name, provider, name }
}

const mergeSelectedModelOptions = (catalog: AvailableModel[], selectedIds: string[]) => {
  const merged = new Map<string, AvailableModel>()
  for (const model of catalog) {
    if (model.id.trim()) merged.set(model.id, model)
  }
  for (const selectedId of selectedIds) {
    const synthetic = modelOptionFromId(selectedId)
    if (synthetic && !merged.has(synthetic.id)) merged.set(synthetic.id, synthetic)
  }
  return Array.from(merged.values())
}

async function fetchModelSelectorModels() {
  const cached = modelSelectorModelsCache && modelSelectorModelsCache.expiresAt > Date.now() ? modelSelectorModelsCache.value : null
  if (cached) return cached
  if (modelSelectorModelsRequest) return modelSelectorModelsRequest

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), MODEL_SELECTOR_FETCH_TIMEOUT_MS)
  modelSelectorModelsRequest = fetch(apiUrl('/api/models/available?background=0'), { signal: controller.signal })
    .then(async (response) => {
      const payload = await response.json() as { models?: unknown; error?: string; detail?: string }
      if (!response.ok || payload.error) throw new Error(payload.detail || payload.error || `Models request failed with HTTP ${response.status}`)
      const models = safeAvailableModels(payload.models)
      modelSelectorModelsCache = { value: models, expiresAt: Date.now() + MODEL_SELECTOR_CACHE_MS }
      return models
    })
    .finally(() => {
      window.clearTimeout(timeout)
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

  const fetchModels = useCallback(async () => {
    const cached = modelSelectorModelsCache && modelSelectorModelsCache.expiresAt > Date.now() ? modelSelectorModelsCache.value : null
    if (cached) setModels(cached)
    setLoading(!cached && !currentModel)
    try {
      const models = await fetchModelSelectorModels()
      setModels(models)
      if (!currentModel && models.length) {
        setSelectedPrimary(models[0].id)
      }
    } catch (error) {
      if (!currentModel) setStatus(`Failed to load models: ${error}`)
      setModels((current) => current.length ? current : modelSelectorModelsCache?.value || [])
    } finally {
      setLoading(false)
    }
  }, [currentModel])

  const fetchAuthProviders = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/providers')
      const data = (await response.json()) as { providers: AuthProviderStatus[] }
      setAuthProviders(data.providers || [])
    } catch {
      setAuthProviders([])
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setSelectedPrimary(currentModel)
    setSelectedFallbacks(currentFallbacks)
    setThinkingEnabled(currentThinking !== 'off')
    setThinkingLevel(currentThinking === 'off' ? 'minimal' : currentThinking)
    void fetchModels()
    void fetchAuthProviders()
  }, [isOpen, currentModel, currentFallbacks, currentThinking, fetchModels, fetchAuthProviders])

  const selectableModels = useMemo(
    () => mergeSelectedModelOptions(models, [selectedPrimary, ...selectedFallbacks].filter(Boolean)),
    [models, selectedPrimary, selectedFallbacks],
  )

  const providerForModel = (modelId: string) =>
    selectableModels.find((model) => model.id === modelId)?.provider || (isOpenAiCodexSubscriptionModel(modelId) ? 'openai-codex' : modelId.split('/')[0] || '')

  const handleSave = async () => {
    if (!selectedPrimary) {
      setStatus('Select a primary model before saving.')
      return
    }
    const primaryProvider = providerForModel(selectedPrimary)
    const providerStatus = authStatusForProvider(authProviders, primaryProvider)
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
    ? authStatusForProvider(authProviders, primaryProvider)
    : undefined
  const primaryProviderLabel = authLabelForProvider(primaryProvider, primaryProviderStatus)
  const primaryProviderAuthKind = authKindForProvider(primaryProviderStatus)
  const deepSeekProviderStatus = authProviders.find((entry) => entry.provider === 'deepseek')
  const deepSeekModels = models.filter((model) => model.id === DEEPSEEK_PRO_MODEL || model.id === DEEPSEEK_FLASH_MODEL)
  const modelGroups = useMemo(() => groupAvailableModels(selectableModels), [selectableModels])
  const fallbackModelGroups = useMemo(
    () => groupAvailableModels(selectableModels.filter((model) => model.id !== selectedPrimary)),
    [selectableModels, selectedPrimary],
  )
  const deepSeekReady = deepSeekProviderStatus?.configured === true
  const selectedThinking: ThinkingLevel = thinkingEnabled ? thinkingLevel : 'off'

  const applyDeepSeekStack = () => {
    setSelectedPrimary(DEEPSEEK_PRO_MODEL)
    setSelectedFallbacks((current) => {
      const next = current.filter((id) => id !== DEEPSEEK_PRO_MODEL && id !== DEEPSEEK_FLASH_MODEL)
      return [DEEPSEEK_FLASH_MODEL, ...next]
    })
    setStatus(deepSeekReady ? 'DeepSeek V4 stack selected.' : 'DeepSeek V4 selected. Add a key before saving.')
    if (deepSeekProviderStatus && !deepSeekReady) setAuthModalProvider(deepSeekProviderStatus)
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          initial={{ scale: 0.95, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 8 }}
          className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-cyan-200/45 bg-gradient-to-b from-blue-900/90 to-slate-950/95 p-5 shadow-glow"
        >
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

          {loading && !selectedPrimary && !modelGroups.length ? (
            <p className="text-center text-slate-300">Loading models...</p>
          ) : (
            <>
              <div className="mb-4 grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-2">
                  <h4 className="text-lg font-semibold text-slate-100">Primary Model</h4>
                  <p className="text-xs text-slate-300">Select the primary model for this agent.</p>
                  <div className="rounded-xl border border-cyan-300/20 bg-slate-950/55 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">DeepSeek V4</p>
                        <p className="mt-0.5 text-xs text-slate-300">Use Pro as primary and Flash as fallback.</p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                          deepSeekReady
                            ? 'border-emerald-300/45 bg-emerald-900/30 text-emerald-100'
                            : 'border-amber-300/45 bg-amber-900/30 text-amber-100'
                        }`}
                      >
                        {deepSeekReady ? 'Key Connected' : 'Key Needed'}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {deepSeekModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedPrimary(model.id)
                            setStatus(`${model.alias} selected as primary.`)
                          }}
                          className={`rounded-lg border px-3 py-2 text-left transition ${
                            selectedPrimary === model.id
                              ? 'border-cyan-200/70 bg-cyan-900/35 text-cyan-100'
                              : 'border-white/10 bg-slate-900/55 text-slate-200 hover:border-cyan-300/40'
                          }`}
                        >
                          <span className="block text-sm font-semibold">{model.alias}</span>
                          <span className="block text-[11px] text-slate-400">{model.id}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={applyDeepSeekStack}
                        className="rounded-lg border border-cyan-300/45 bg-cyan-900/30 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                      >
                        Use Pro + Flash
                      </button>
                      {deepSeekProviderStatus && !deepSeekReady && (
                        <button
                          type="button"
                          onClick={() => setAuthModalProvider(deepSeekProviderStatus)}
                          className="rounded-lg border border-amber-300/40 bg-amber-900/25 px-3 py-1.5 text-xs text-amber-100"
                        >
                          Connect DeepSeek
                        </button>
                      )}
                    </div>
                  </div>
                  {primaryProviderStatus && !primaryProviderStatus.configured && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-900/30 px-3 py-2 text-xs text-amber-100">
                      Missing {primaryProviderLabel} {primaryProviderAuthKind}. Connect it before using this model.
                      <button
                        type="button"
                        onClick={() => setAuthModalProvider(primaryProviderStatus)}
                        className="ml-2 rounded bg-amber-300/20 px-2 py-0.5 text-[11px] text-amber-100"
                      >
                        Connect
                      </button>
                    </div>
                  )}
                  <select
                    value={selectedPrimary}
                    onChange={(event) => {
                      const next = event.target.value
                      setSelectedPrimary(next)
                      const provider = next ? providerForModel(next) : ''
                      const providerStatus = provider ? authStatusForProvider(authProviders, provider) : undefined
                      if (providerStatus && !providerStatus.configured) setAuthModalProvider(providerStatus)
                    }}
                    className="w-full rounded-lg border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="" disabled>
                      Choose a model...
                    </option>
                    {modelGroups.map((group) => (
                      <optgroup key={group.key} label={formatModelGroupLabel(group)}>
                        {group.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.alias} ({model.provider})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedPrimary && <div className="text-xs text-slate-300">{selectedPrimary}</div>}
                  {primaryProvider === 'google-vertex' && (
                    <div className="inline-flex w-fit rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">
                      google-vertex
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-lg font-semibold text-slate-100">Fallbacks</h4>
                  <p className="text-xs text-slate-300">Optional failover models.</p>
                  <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-slate-100/10 bg-slate-950/55 p-2">
                    {fallbackModelGroups.map((group) => (
                      <div key={group.key} className="space-y-1">
                        <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{formatModelGroupLabel(group)}</div>
                        {group.models.map((model) => (
                          <label key={model.id} className="flex items-center gap-2 text-xs text-slate-100">
                            <input
                              type="checkbox"
                              checked={selectedFallbacks.includes(model.id)}
                              onChange={() => toggleFallback(model.id)}
                              className="h-4 w-4 accent-emerald-400"
                            />
                            <span className="truncate">{model.alias}</span>
                            <span className="text-[10px] text-slate-400">{model.provider}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
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
                <div className="mt-3 grid grid-cols-5 gap-1.5">
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

              <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
                {selectedFallbacks.map((id) => (
                  <span key={id} className="rounded-full border border-emerald-300/30 bg-emerald-900/35 px-2 py-0.5 text-emerald-100">
                    {id.split('/').pop()}
                  </span>
                ))}
                {!selectedFallbacks.length && <span className="text-slate-400">No fallbacks selected.</span>}
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
        </motion.div>
      </motion.div>
      {authModalProvider && (
        <ProviderAuthModal
          isOpen={true}
          provider={authModalProvider.provider}
          envKeys={authModalProvider.envKeys}
          providerStatus={authModalProvider}
          onClose={() => setAuthModalProvider(null)}
          onSave={async (apiKey) => {
            const response = await fetch(`/api/auth/providers/${authModalProvider.provider}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            })
            if (!response.ok) throw new Error('Failed to save provider key')
            await fetchAuthProviders()
          }}
          onConnected={fetchAuthProviders}
        />
      )}
    </AnimatePresence>
  )
}

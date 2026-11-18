import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorMessage } from '../../api/client'
import {
  fetchProviderModelCapabilities,
  fetchProviderModelOnboarding,
  runBoundedProviderModelProbe,
  type ProviderModelCapability,
  type ProviderModelOnboarding,
  type ProviderModelProbe,
} from '../../api/providerModelReadiness'

type ProbeOutcome = {
  passed: boolean
  reason: string
  probe: ProviderModelProbe | null
}

const onboardingLabels: Record<ProviderModelOnboarding['status'], string> = {
  invalid_provider: 'Invalid provider',
  authentication_required: 'Authentication required',
  catalog_discovery_required: 'Catalog discovery required',
  catalog_auth_rejected: 'Catalog access rejected',
  catalog_stale: 'Catalog snapshot is stale',
  ready_for_opt_in_probe: 'Ready for opt-in probe',
}

function displayDate(value?: string | null) {
  if (!value) return 'Not discovered'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Unknown'
}

function capabilitySummary(onboarding: ProviderModelOnboarding) {
  const capabilities = onboarding.advertisedCapabilities
  const modalities = capabilities.inputModalities.length
    ? capabilities.inputModalities.join(', ')
    : 'Not reported'
  const outputModalities = capabilities.outputModalities.length
    ? capabilities.outputModalities.join(', ')
    : 'Not reported'
  return { capabilities, modalities, outputModalities }
}

export type ProviderModelReadinessViewProps = {
  providerLabel: string
  authenticationConfigured?: boolean
  onboarding: ProviderModelOnboarding | null
  models: ProviderModelCapability[]
  selectedModelId: string
  pendingProbeModelId: string
  probeOutcome: ProbeOutcome | null
  loading: boolean
  refreshing: boolean
  probing: boolean
  error: string
  onRefresh: () => void
  onSelectModel: (modelId: string) => void
  onBeginProbe: () => void
  onCancelProbe: () => void
  onConfirmProbe: () => void
}

export function ProviderModelReadinessView({
  providerLabel,
  authenticationConfigured,
  onboarding,
  models,
  selectedModelId,
  pendingProbeModelId,
  probeOutcome,
  loading,
  refreshing,
  probing,
  error,
  onRefresh,
  onSelectModel,
  onBeginProbe,
  onCancelProbe,
  onConfirmProbe,
}: ProviderModelReadinessViewProps) {
  const authConfigured = onboarding?.authentication.configured ?? authenticationConfigured
  const catalog = onboarding?.catalog
  const probeAvailable = onboarding?.probeContract.available === true
  const summary = onboarding ? capabilitySummary(onboarding) : null
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const pendingModel = models.find((model) => model.id === pendingProbeModelId)

  return (
    <section aria-labelledby="provider-model-readiness-title" className="mb-5 rounded-2xl border border-cyan-200/15 bg-[linear-gradient(145deg,rgba(8,47,73,0.28),rgba(7,18,31,0.58))] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/70">Model compatibility</p>
          <h4 id="provider-model-readiness-title" className="mt-1 text-sm font-semibold text-slate-100">{providerLabel} readiness</h4>
          <p className="mt-1 text-xs leading-5 text-slate-400">Check authentication, catalog freshness, and advertised model capabilities. Readiness checks never run a model.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading || refreshing} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-50">
          {refreshing ? 'Refreshing catalog…' : loading ? 'Checking…' : 'Refresh catalog'}
        </button>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-slate-950/35 px-3 py-2.5">
          <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Authentication</dt>
          <dd className={`mt-1 text-xs font-semibold ${authConfigured ? 'text-emerald-200' : authConfigured === false ? 'text-amber-200' : 'text-slate-300'}`}>
            {authConfigured === undefined ? 'Not checked' : authConfigured ? 'Configured' : 'Not configured'}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-slate-950/35 px-3 py-2.5">
          <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Catalog status</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-200">
            {onboarding ? onboardingLabels[onboarding.status] : loading ? 'Checking…' : 'Not checked'}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-slate-950/35 px-3 py-2.5">
          <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Last catalog discovery</dt>
          <dd className="mt-1 text-xs font-medium text-slate-200">
            {catalog ? `${displayDate(catalog.verifiedAt)} · ${catalog.modelCount} model${catalog.modelCount === 1 ? '' : 's'}${catalog.stale ? ' · stale' : ''}` : 'No snapshot'}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-slate-950/35 px-3 py-2.5">
          <dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Advertised capabilities</dt>
          <dd className="mt-1 text-xs leading-5 text-slate-200">
            {summary
              ? `Input: ${summary.modalities} · Output: ${summary.outputModalities}. ${summary.capabilities.reasoningModelCount} reasoning, ${summary.capabilities.toolCapableModelCount} tool-capable, ${summary.capabilities.contextWindowModelCount} with context metadata.`
              : 'Capabilities are available after discovery.'}
          </dd>
        </div>
      </dl>

      {onboarding?.probeContract.executed === false ? (
        <p className="mt-3 text-[10px] leading-4 text-slate-500">
          Probe contract: tools disabled, {onboarding.probeContract.maxOutputTokens} output tokens maximum, {Math.round(onboarding.probeContract.timeoutMs / 1000)} second timeout. A probe may be billable and requires a separate confirmation.
        </p>
      ) : null}

      {models.length ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[10px] font-semibold text-slate-400">
            Model from the discovered catalog
            <select value={selectedModelId} onChange={(event) => onSelectModel(event.target.value)} disabled={loading || refreshing || probing} className="mt-1.5 min-h-10 w-full rounded-lg border border-white/[0.12] bg-slate-950/70 px-3 text-xs text-slate-100 outline-none focus:border-cyan-200/40 disabled:opacity-50">
              {models.map((model) => <option key={model.id} value={model.id}>{model.name ? `${model.name} · ${model.id}` : model.id}</option>)}
            </select>
          </label>
          <button type="button" onClick={onBeginProbe} disabled={!probeAvailable || !selectedModel || loading || refreshing || probing} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-amber-200/25 bg-amber-300/[0.08] px-3 text-[11px] font-bold text-amber-100 hover:bg-amber-300/[0.13] disabled:cursor-not-allowed disabled:opacity-45">
            Probe selected model
          </button>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-white/[0.08] bg-slate-950/35 px-3 py-2.5 text-[11px] leading-5 text-slate-400">
          {loading || refreshing ? 'Loading the provider catalog…' : 'No discovered models yet. Refresh the catalog after connecting provider authentication.'}
        </p>
      )}

      {pendingModel ? (
        <div className="mt-3 rounded-xl border border-amber-200/25 bg-amber-300/[0.06] p-3" role="alertdialog" aria-labelledby="provider-probe-confirm-title" aria-describedby="provider-probe-confirm-description">
          <p id="provider-probe-confirm-title" className="text-xs font-bold text-amber-100">Confirm a potentially billable probe</p>
          <p id="provider-probe-confirm-description" className="mt-1 text-[11px] leading-5 text-amber-50/80">
            Automnia will send one short request to <span className="font-mono">{pendingModel.id}</span>. Tools remain disabled and output is capped at {onboarding?.probeContract.maxOutputTokens ?? 8} tokens. This can incur provider charges.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onCancelProbe} disabled={probing} className="min-h-9 rounded-lg border border-white/15 px-3 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50">Cancel</button>
            <button type="button" onClick={onConfirmProbe} disabled={probing || !probeAvailable} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-amber-200/30 bg-amber-300/[0.13] px-3 text-[11px] font-bold text-amber-50 hover:bg-amber-300/[0.2] disabled:cursor-wait disabled:opacity-50">
              {probing ? 'Running bounded probe…' : 'Confirm and run probe'}
            </button>
          </div>
        </div>
      ) : null}

      {probeOutcome ? (
        <p role="status" aria-live="polite" className={`mt-3 rounded-lg border px-3 py-2.5 text-[11px] leading-5 ${probeOutcome.passed ? 'border-emerald-200/20 bg-emerald-300/[0.06] text-emerald-100' : 'border-amber-200/20 bg-amber-300/[0.06] text-amber-100'}`}>
          {probeOutcome.passed ? 'Probe passed' : 'Probe did not pass'}: {probeOutcome.reason.replaceAll('_', ' ')}{probeOutcome.probe ? ` · ${probeOutcome.probe.durationMs} ms · checked ${displayDate(probeOutcome.probe.checkedAt)}` : ''}
        </p>
      ) : null}

      {error ? <p role="status" aria-live="polite" className="mt-3 rounded-lg border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] leading-5 text-rose-100">{error}</p> : null}
    </section>
  )
}

export function ProviderModelReadinessPanel({
  open,
  provider,
  providerLabel,
  authenticationConfigured,
}: {
  open: boolean
  provider: string
  providerLabel: string
  authenticationConfigured?: boolean
}) {
  const [onboarding, setOnboarding] = useState<ProviderModelOnboarding | null>(null)
  const [models, setModels] = useState<ProviderModelCapability[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [pendingProbeModelId, setPendingProbeModelId] = useState('')
  const [probeOutcome, setProbeOutcome] = useState<ProbeOutcome | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState('')
  const requestGeneration = useRef(0)

  const refreshReadiness = useCallback(async (refreshCatalog = false) => {
    const generation = ++requestGeneration.current
    setError('')
    setLoading(!refreshCatalog)
    setRefreshing(refreshCatalog)
    try {
      const onboardingResult = await fetchProviderModelOnboarding(provider, { refreshCatalog })
      if (!onboardingResult.ok) throw new Error(apiErrorMessage(onboardingResult.error))
      const capabilityResult = await fetchProviderModelCapabilities(provider)
      if (!capabilityResult.ok) throw new Error(apiErrorMessage(capabilityResult.error))
      if (generation !== requestGeneration.current) return
      const nextModels = capabilityResult.data.snapshots.find((snapshot) => snapshot.provider === provider)?.models || []
      setOnboarding(onboardingResult.data.onboarding)
      setModels(nextModels)
      setSelectedModelId((current) => nextModels.some((model) => model.id === current) ? current : nextModels[0]?.id || '')
      setPendingProbeModelId('')
      setProbeOutcome(null)
    } catch (loadError) {
      if (generation === requestGeneration.current) setError(String(loadError))
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [provider])

  useEffect(() => {
    if (!open) return
    void refreshReadiness(false)
    return () => { requestGeneration.current += 1 }
  }, [open, refreshReadiness])

  const confirmProbe = useCallback(async () => {
    if (!pendingProbeModelId || onboarding?.probeContract.available !== true || probing) return
    setProbing(true)
    setError('')
    try {
      const result = await runBoundedProviderModelProbe(pendingProbeModelId, true)
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      setProbeOutcome({
        passed: result.data.passed,
        reason: result.data.reason,
        probe: result.data.probe,
      })
      setPendingProbeModelId('')
    } catch (probeError) {
      setError(String(probeError))
    } finally {
      setProbing(false)
    }
  }, [onboarding?.probeContract.available, pendingProbeModelId, probing])

  if (!open) return null
  return (
    <ProviderModelReadinessView
      providerLabel={providerLabel}
      authenticationConfigured={authenticationConfigured}
      onboarding={onboarding}
      models={models}
      selectedModelId={selectedModelId}
      pendingProbeModelId={pendingProbeModelId}
      probeOutcome={probeOutcome}
      loading={loading}
      refreshing={refreshing}
      probing={probing}
      error={error}
      onRefresh={() => void refreshReadiness(true)}
      onSelectModel={(modelId) => { setSelectedModelId(modelId); setPendingProbeModelId(''); setProbeOutcome(null) }}
      onBeginProbe={() => {
        if (!selectedModelId || onboarding?.probeContract.available !== true) return
        setError('')
        setProbeOutcome(null)
        setPendingProbeModelId(selectedModelId)
      }}
      onCancelProbe={() => setPendingProbeModelId('')}
      onConfirmProbe={() => void confirmProbe()}
    />
  )
}

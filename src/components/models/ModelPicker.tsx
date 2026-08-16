import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuthProviderStatus } from '../../api/providerAuth'
import { groupAvailableModels, isSelectableModelId, modelProviderLabel, type ModelOptionGroup } from '../../utils/modelGrouping'
import { providerLogoKey, providerLogoSrc } from '../../utils/providerLogos'

export type ModelPickerModel = {
  id: string
  alias?: string
  provider?: string
  name?: string
}

type ModelPickerProps = {
  models: readonly ModelPickerModel[]
  selectedIds: readonly string[]
  onSelect: (modelId: string) => void
  label?: string
  selectionMode?: 'single' | 'multiple'
  emptyOption?: { label: string; detail?: string }
  disabled?: boolean
  loading?: boolean
  className?: string
  collapsible?: boolean
  mode?: 'provider-grid' | 'primary'
  fallbackIds?: readonly string[]
  onToggleFallback?: (modelId: string) => void
  providerAuthStatusFor?: (provider: string) => AuthProviderStatus | undefined
  onProviderAuth?: (provider: string, status: AuthProviderStatus) => void
}

const modelTitle = (model: ModelPickerModel) =>
  model.alias?.trim() || model.name?.trim() || model.id.split('/').pop() || model.id

const modelDetail = (model: ModelPickerModel) => {
  const provider = model.provider?.trim() || model.id.split('/')[0] || 'provider'
  const name = model.name?.trim() || model.id.split('/').pop() || model.id
  return `${modelProviderLabel(provider)} / ${name}`
}

function providerInitial(label: string) {
  return label.replace(/^OpenRouter\s+-\s+/i, '').trim().charAt(0).toUpperCase() || 'A'
}

const authProviderKeyForGroup = (provider: string) =>
  provider.startsWith('openrouter:') ? 'openrouter' : provider

const modelProviderKey = (model: ModelPickerModel) =>
  (model.provider?.trim() || model.id.split('/')[0] || '').toLowerCase()

function ProviderLogo({ provider, label, size = 'sm' }: { provider: string; label: string; size?: 'sm' | 'md' }) {
  const [failedSrc, setFailedSrc] = useState('')
  const logoKey = providerLogoKey(provider)
  const src = providerLogoSrc(provider)
  const sizeClass = size === 'md' ? 'h-7 w-7 rounded-lg' : 'h-6 w-6 rounded-md'

  return (
    <span aria-hidden="true" data-provider-logo={logoKey || 'fallback'} className={`relative grid shrink-0 place-items-center border border-cyan-200/15 bg-cyan-300/[0.07] shadow-[inset_0_0_0_1px_rgba(255,255,255,.025)] ${sizeClass}`}>
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt=""
          className={`h-full w-full object-contain p-1 ${logoKey === 'automnia-cloud' ? 'drop-shadow-[0_0_5px_rgba(103,232,249,.5)]' : 'mix-blend-screen [filter:invert(1)_grayscale(1)_brightness(1.5)]'}`}
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="text-xs font-black text-cyan-200">{providerInitial(label)}</span>
      )}
    </span>
  )
}

function ProviderIcon({ group }: { group: ModelOptionGroup<ModelPickerModel> }) {
  return (
    <ProviderLogo provider={group.key} label={group.label} />
  )
}

export function ModelPicker({
  models,
  selectedIds,
  onSelect,
  label = 'Models',
  selectionMode = 'single',
  emptyOption,
  disabled = false,
  loading = false,
  className = '',
  collapsible = false,
  mode = 'provider-grid',
  fallbackIds = [],
  onToggleFallback,
  providerAuthStatusFor,
  onProviderAuth,
}: ModelPickerProps) {
  const selectableModels = useMemo(
    () => models.filter((model) => isSelectableModelId(model.id)),
    [models],
  )
  const pickerModels = selectableModels
  const groups = useMemo(() => groupAvailableModels(pickerModels), [pickerModels])
  const selectedSet = useMemo(() => new Set(selectedIds.filter(Boolean)), [selectedIds])
  const fallbackSet = useMemo(() => new Set(fallbackIds.filter(Boolean)), [fallbackIds])
  const [openGroupKey, setOpenGroupKey] = useState('')
  const [isFallbacksOpen, setIsFallbacksOpen] = useState(false)
  const [isPrimaryOpen, setIsPrimaryOpen] = useState(false)
  const [primaryProviderKey, setPrimaryProviderKey] = useState('')
  const [fallbackProviderKey, setFallbackProviderKey] = useState('')
  const [isFallbackProviderOpen, setIsFallbackProviderOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openGroupKey && !isPrimaryOpen && !isFallbackProviderOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node)) return
      setOpenGroupKey('')
      setIsPrimaryOpen(false)
      setIsFallbackProviderOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroupKey('')
        setIsPrimaryOpen(false)
        setIsFallbackProviderOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFallbackProviderOpen, isPrimaryOpen, openGroupKey])
  const visibleOpenGroupKey = groups.some((group) => group.key === openGroupKey) ? openGroupKey : ''
  const primaryModelId = selectedIds.find(Boolean) || ''
  const primaryModel = pickerModels.find((model) => model.id === primaryModelId)
  const primaryModelGroup = groups.find((group) => group.models.some((model) => model.id === primaryModelId))
  const activePrimaryGroup = groups.find((group) => group.key === primaryProviderKey) || primaryModelGroup || groups[0]
  const selectedFallbackGroup = groups.find((group) => group.models.some((model) => fallbackSet.has(model.id)))
  const activeFallbackGroup = groups.find((group) => group.key === fallbackProviderKey)
    || selectedFallbackGroup
    || groups.find((group) => group.key !== activePrimaryGroup?.key)
    || groups[0]
  const selectedModelNames = selectedIds
    .filter(Boolean)
    .map((modelId) => modelTitle(selectableModels.find((model) => model.id === modelId) || { id: modelId }))
  const selectModel = (modelId: string) => {
    if (disabled || loading || !isSelectableModelId(modelId)) return
    onSelect(modelId)
    if (selectionMode === 'single') setOpenGroupKey('')
  }

  if (mode === 'primary') {
    const browseProviderLabel = activePrimaryGroup?.label || 'Choose a provider'
    const selectedProviderLabel = primaryModelGroup?.label || (primaryModel ? modelProviderLabel(modelProviderKey(primaryModel)) : 'No provider selected')
    const selectedProviderKey = primaryModelGroup?.key || activePrimaryGroup?.key || 'model'
    const primaryModels = activePrimaryGroup?.models || []
    const fallbackModels = activeFallbackGroup?.models.filter((model) => model.id !== primaryModelId) || []
    const availableFallbackModels = fallbackModels.filter((model) => !fallbackSet.has(model.id))
    const selectedFallbackCount = fallbackIds.filter((modelId) => pickerModels.some((model) => model.id === modelId)).length
    const selectedFallbackModels = fallbackIds
      .map((modelId) => pickerModels.find((model) => model.id === modelId))
      .filter((model): model is ModelPickerModel => Boolean(model))
    const activeAuthProvider = authProviderKeyForGroup(activePrimaryGroup?.key || selectedProviderKey)
    const activeAuth = providerAuthStatusFor?.(activeAuthProvider)
    const activeFallbackAuthProvider = authProviderKeyForGroup(activeFallbackGroup?.key || 'model')
    const activeFallbackAuth = providerAuthStatusFor?.(activeFallbackAuthProvider)
    const togglePrimaryMenu = () => {
      setIsFallbackProviderOpen(false)
      setIsPrimaryOpen((open) => !open)
    }

    return (
      <div ref={modelMenuRef} className={`space-y-2.5 ${className}`} data-model-picker="primary">
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isPrimaryOpen}
            aria-controls="model-primary-provider-menu"
            disabled={disabled || loading}
            onClick={togglePrimaryMenu}
            data-model-primary-trigger
            className={`group flex min-h-[66px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${isPrimaryOpen ? 'border-cyan-300/50 bg-cyan-400/[0.10] shadow-[0_0_0_1px_rgba(103,232,249,.10)]' : 'border-white/[0.12] bg-white/[0.035] hover:border-cyan-300/35 hover:bg-white/[0.06]'} ${disabled || loading ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <ProviderLogo provider={selectedProviderKey} label={selectedProviderLabel} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[9px] font-extrabold uppercase tracking-[0.16em] text-cyan-200/75">Primary model</span>
                {primaryModel ? <span className="truncate text-[9px] font-semibold text-slate-500">{selectedProviderLabel}</span> : null}
              </span>
              <strong className="mt-0.5 block max-w-full truncate text-sm font-bold text-slate-100">
                {primaryModel ? modelTitle(primaryModel) : emptyOption?.label || 'Choose a primary model'}
              </strong>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                {primaryModel ? 'Click to switch provider or model' : `Select a provider to browse ${browseProviderLabel === 'Choose a provider' ? 'available models' : 'its models'}`}
              </span>
            </span>
            <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.10] bg-white/[0.04] text-slate-400 transition group-hover:border-cyan-300/25 group-hover:text-cyan-100 ${isPrimaryOpen ? 'border-cyan-300/35 bg-cyan-300/[0.10] text-cyan-100' : ''}`}>
              <svg viewBox="0 0 16 16" className={`h-4 w-4 transition-transform ${isPrimaryOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </span>
          </button>

          {isPrimaryOpen ? (
            <div id="model-primary-provider-menu" className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-cyan-300/25 bg-slate-950 shadow-2xl shadow-black/50" data-model-primary-menu>
              <div className="flex items-center gap-3 border-b border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block text-[9px] font-extrabold uppercase tracking-[0.16em] text-cyan-200/80">Choose a provider</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">Then choose its primary model below.</span>
                </div>
                {activeAuth && onProviderAuth ? (
                  <button
                    type="button"
                    disabled={disabled || loading}
                    data-provider-auth-action
                    data-provider-auth-state={activeAuth.configured ? 'connected' : 'missing'}
                    onClick={() => onProviderAuth(activeAuthProvider, activeAuth)}
                    className="shrink-0 rounded-md border border-white/[0.10] bg-white/[0.04] px-2 py-1.5 text-[9px] font-bold text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.08] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activeAuth.configured ? 'Provider settings' : 'Connect provider'}
                  </button>
                ) : null}
              </div>
              <div role="listbox" aria-label="Available model providers" className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2">
                {groups.map((group) => {
                  const isSelected = group.key === activePrimaryGroup?.key
                  const groupAuth = providerAuthStatusFor?.(authProviderKeyForGroup(group.key))
                  return (
                    <button
                      key={group.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setPrimaryProviderKey(group.key)
                        setIsPrimaryOpen(false)
                      }}
                      className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${isSelected ? 'border-cyan-300/35 bg-cyan-400/[0.10] text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,.05)]' : 'border-white/[0.07] bg-white/[0.025] text-slate-200 hover:border-white/[0.16] hover:bg-white/[0.06]'}`}
                    >
                      <ProviderLogo provider={group.key} label={group.label} size="md" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[11px] font-bold">{group.label}</strong>
                        <span className="mt-0.5 block truncate text-[9px] text-slate-500">{group.models.length} model{group.models.length === 1 ? '' : 's'}</span>
                      </span>
                      {groupAuth ? <span aria-hidden="true" title={groupAuth.configured ? 'Provider ready' : 'Provider connection needed'} className={`h-1.5 w-1.5 shrink-0 rounded-full ${groupAuth.configured ? 'bg-emerald-300' : 'bg-amber-300'}`} /> : null}
                      {isSelected ? <span aria-hidden="true" className="text-sm font-bold text-cyan-200">✓</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>

        {loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">Loading models…</div> : null}
        {!loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">No models available.</div> : null}

        {activePrimaryGroup && primaryModels.length ? (
          <div data-model-primary-models className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.035] p-2.5">
            <label className="block">
              <span className="block px-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Primary model</span>
              <span className="mt-1 block px-1 text-[10px] text-slate-500">Current models from {browseProviderLabel}</span>
              <span className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.035] px-2">
                <ProviderLogo provider={activePrimaryGroup.key} label={browseProviderLabel} />
                <select
                  aria-label={`${browseProviderLabel} primary model`}
                  data-model-primary-select
                  value={primaryModels.some((model) => model.id === primaryModelId) ? primaryModelId : ''}
                  disabled={disabled || loading}
                  onChange={(event) => {
                    setPrimaryProviderKey(activePrimaryGroup.key)
                    onSelect(event.currentTarget.value)
                  }}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{emptyOption?.label || `Choose a ${browseProviderLabel} model`}</option>
                  {primaryModels.map((model) => (
                    <option key={model.id} value={model.id}>{modelTitle(model)}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        ) : null}

        {onToggleFallback ? (
          <div data-model-fallback-ticker className="rounded-xl border border-white/[0.10] bg-black/10 p-2.5">
            <button
              type="button"
              aria-expanded={isFallbacksOpen}
              disabled={disabled || loading}
              onClick={() => {
                setIsPrimaryOpen(false)
                setIsFallbacksOpen((open) => !open)
              }}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span aria-hidden="true" className={`text-sm leading-none text-cyan-200 transition-transform ${isFallbacksOpen ? 'rotate-90' : ''}`}>›</span>
              <ProviderLogo provider={activeFallbackGroup?.key || 'model'} label={activeFallbackGroup?.label || 'Fallback providers'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-extrabold text-slate-200">Fallback providers</span>
                <span className="mt-0.5 block truncate text-[9px] text-slate-500">{activeFallbackGroup?.label || 'Choose a provider'} · select backup models</span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-cyan-200">{selectedFallbackCount ? `${selectedFallbackCount} selected` : 'None selected'}</span>
            </button>

            {isFallbacksOpen && activeFallbackGroup ? (
              <div className="mt-2 space-y-2 border-t border-white/[0.08] pt-2">
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isFallbackProviderOpen}
                    aria-controls="model-fallback-provider-menu"
                    disabled={disabled || loading}
                    onClick={() => {
                      setIsPrimaryOpen(false)
                      setIsFallbackProviderOpen((open) => !open)
                    }}
                    data-model-fallback-provider-trigger
                    className={`group flex min-h-[66px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${isFallbackProviderOpen ? 'border-cyan-300/50 bg-cyan-400/[0.10] shadow-[0_0_0_1px_rgba(103,232,249,.10)]' : 'border-white/[0.12] bg-white/[0.035] hover:border-cyan-300/35 hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <ProviderLogo provider={activeFallbackGroup.key} label={activeFallbackGroup.label} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9px] font-extrabold uppercase tracking-[0.16em] text-cyan-200/75">Fallback provider</span>
                      <strong className="mt-0.5 block truncate text-sm font-bold text-slate-100">{activeFallbackGroup.label}</strong>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">Click to switch provider</span>
                    </span>
                    <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.10] bg-white/[0.04] text-slate-400 transition group-hover:border-cyan-300/25 group-hover:text-cyan-100 ${isFallbackProviderOpen ? 'border-cyan-300/35 bg-cyan-300/[0.10] text-cyan-100' : ''}`}>
                      <svg viewBox="0 0 16 16" className={`h-4 w-4 transition-transform ${isFallbackProviderOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </span>
                  </button>

                  {isFallbackProviderOpen ? (
                    <div id="model-fallback-provider-menu" className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-cyan-300/25 bg-slate-950 shadow-2xl shadow-black/50" data-model-fallback-provider-menu>
                      <div className="flex items-center gap-3 border-b border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <span className="block text-[9px] font-extrabold uppercase tracking-[0.16em] text-cyan-200/80">Choose a fallback provider</span>
                          <span className="mt-0.5 block text-[10px] text-slate-400">Then add one or more fallback models.</span>
                        </div>
                        {activeFallbackAuth && onProviderAuth ? (
                          <button
                            type="button"
                            disabled={disabled || loading}
                            data-provider-auth-action
                            data-provider-auth-state={activeFallbackAuth.configured ? 'connected' : 'missing'}
                            onClick={() => onProviderAuth(activeFallbackAuthProvider, activeFallbackAuth)}
                            className="shrink-0 rounded-md border border-white/[0.10] bg-white/[0.04] px-2 py-1.5 text-[9px] font-bold text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.08] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {activeFallbackAuth.configured ? 'Provider settings' : 'Connect provider'}
                          </button>
                        ) : null}
                      </div>
                      <div role="listbox" aria-label="Available fallback providers" className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2">
                        {groups.map((group) => {
                          const selected = group.key === activeFallbackGroup.key
                          const groupAuth = providerAuthStatusFor?.(authProviderKeyForGroup(group.key))
                          return (
                            <button
                              key={group.key}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => {
                                setFallbackProviderKey(group.key)
                                setIsFallbackProviderOpen(false)
                              }}
                              className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${selected ? 'border-cyan-300/35 bg-cyan-400/[0.10] text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,.05)]' : 'border-white/[0.07] bg-white/[0.025] text-slate-200 hover:border-white/[0.16] hover:bg-white/[0.06]'}`}
                            >
                              <ProviderLogo provider={group.key} label={group.label} size="md" />
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-[11px] font-bold">{group.label}</strong>
                                <span className="mt-0.5 block truncate text-[9px] text-slate-500">{group.models.length} model{group.models.length === 1 ? '' : 's'}</span>
                              </span>
                              {groupAuth ? <span aria-hidden="true" title={groupAuth.configured ? 'Provider ready' : 'Provider connection needed'} className={`h-1.5 w-1.5 shrink-0 rounded-full ${groupAuth.configured ? 'bg-emerald-300' : 'bg-amber-300'}`} /> : null}
                              {selected ? <span aria-hidden="true" className="text-sm font-bold text-cyan-200">✓</span> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div data-model-fallback-models className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.035] p-2.5">
                  <label className="block">
                    <span className="block px-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Fallback model</span>
                    <span className="mt-1 block px-1 text-[10px] text-slate-500">Add models from {activeFallbackGroup.label}</span>
                    <span className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.035] px-2">
                      <ProviderLogo provider={activeFallbackGroup.key} label={activeFallbackGroup.label} />
                      <select
                        aria-label={`${activeFallbackGroup.label} fallback model`}
                        data-model-fallback-select
                        value=""
                        disabled={disabled || loading || !availableFallbackModels.length}
                        onChange={(event) => {
                          if (event.currentTarget.value) onToggleFallback(event.currentTarget.value)
                        }}
                        className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">{availableFallbackModels.length ? 'Choose a fallback model' : 'No more models for this provider'}</option>
                        {availableFallbackModels.map((model) => (
                          <option key={model.id} value={model.id}>{modelTitle(model)}</option>
                        ))}
                      </select>
                    </span>
                  </label>
                  {selectedFallbackModels.length ? (
                    <div role="list" aria-label="Selected fallback models" className="mt-2 space-y-1">
                      {selectedFallbackModels.map((model) => {
                        const group = groups.find((candidate) => candidate.models.some((entry) => entry.id === model.id))
                        return (
                          <div key={model.id} className="flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/[0.07] px-2 py-1.5">
                            <ProviderLogo provider={group?.key || modelProviderKey(model)} label={group?.label || modelProviderLabel(modelProviderKey(model))} />
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-[10px] font-semibold text-cyan-50">{modelTitle(model)}</strong>
                              <span className="mt-0.5 block truncate text-[9px] text-slate-500">{group?.label || modelProviderLabel(modelProviderKey(model))}</span>
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${modelTitle(model)} fallback`}
                              disabled={disabled || loading}
                              onClick={() => onToggleFallback(model.id)}
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/[0.10] text-sm text-slate-400 transition hover:border-rose-300/30 hover:bg-rose-300/[0.08] hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              ×
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : <p className="mt-2 px-1 text-[10px] text-slate-500">No fallback models selected.</p>}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`} data-model-picker={selectionMode}>
      {collapsible ? (
        <div data-model-picker-disclosure>
          <button
            type="button"
            aria-expanded={isFallbacksOpen}
            aria-controls="model-picker-fallbacks-panel"
            disabled={disabled || loading}
            onClick={() => setIsFallbacksOpen((open) => !open)}
            className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-2 text-left transition hover:border-cyan-300/30 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className={`text-sm leading-none text-cyan-200 transition-transform ${isFallbacksOpen ? 'rotate-90' : ''}`}>›</span>
            <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-200">{label || 'Fallbacks'}</span>
            <span className="ml-auto text-[10px] text-slate-500">{selectedModelNames.length ? `${selectedModelNames.length} selected` : 'None selected'}</span>
          </button>
          {selectedModelNames.length ? (
            <div data-model-picker-selected aria-label="Selected fallback models" className="flex flex-wrap gap-1.5 px-1">
              {selectedModelNames.map((name, index) => (
                <span key={`${name}-${index}`} className="max-w-full truncate rounded border border-cyan-300/20 bg-cyan-400/[0.07] px-2 py-1 text-[10px] font-semibold text-cyan-100">{name}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {(!collapsible || isFallbacksOpen) ? (
        <div id={collapsible ? 'model-picker-fallbacks-panel' : undefined} className={collapsible ? 'space-y-3' : undefined}>
      {label && !collapsible ? <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-200">{label}</span><span className="text-xs text-slate-400">{groups.length} providers · {selectableModels.length} models</span></div> : null}

      {emptyOption ? (
        <button
          type="button"
          disabled={disabled || loading}
          aria-pressed={selectedSet.size === 0}
          onClick={() => onSelect('')}
          className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left transition ${selectedSet.size === 0 ? 'border-cyan-300/45 bg-cyan-400/[0.10] text-cyan-50' : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-cyan-300/30 hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span><strong className="block text-[11px]">{emptyOption.label}</strong>{emptyOption.detail ? <span className="mt-0.5 block text-[10px] text-slate-400">{emptyOption.detail}</span> : null}</span>
          {selectedSet.size === 0 ? <span aria-hidden="true" className="text-sm text-cyan-200">✓</span> : null}
        </button>
      ) : null}

      {loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">Loading models…</div> : null}
      {!loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">No models available.</div> : null}

      {groups.length ? (
        <div ref={modelMenuRef} className="grid gap-2 sm:grid-cols-2" data-model-provider-list aria-label={`${label} providers`}>
          {groups.map((group) => {
            const isOpen = group.key === visibleOpenGroupKey
            const selectedModels = group.models.filter((model) => selectedSet.has(model.id))
            const selectedModel = selectedModels[0]
            const selectedCount = selectedModels.length
            const menuId = `model-picker-menu-${group.key.replace(/[^a-z0-9]+/gi, '-')}`
            return (
              <div key={group.key} className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={isOpen}
                  aria-controls={menuId}
                  disabled={disabled || loading}
                  onClick={() => setOpenGroupKey((current) => current === group.key ? '' : group.key)}
                  className={`flex min-h-[42px] w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${isOpen ? 'border-cyan-300/45 bg-cyan-400/[0.11] shadow-[0_0_0_1px_rgba(103,232,249,.08)]' : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <ProviderIcon group={group} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] font-bold leading-tight text-slate-100">{group.label}</strong>
                    <span className="mt-0.5 block truncate text-[9px] leading-tight text-slate-400">
                      {selectedModel ? modelTitle(selectedModel) : `${group.models.length} model${group.models.length === 1 ? '' : 's'}`}
                      {selectedCount > 1 ? ` · ${selectedCount} selected` : ''}
                    </span>
                  </span>
                  <span aria-hidden="true" className={`text-sm leading-none transition ${isOpen ? 'rotate-180 text-cyan-200' : 'text-slate-500'}`}>⌄</span>
                </button>

                {isOpen ? (
                  <div
                    id={menuId}
                    role="listbox"
                    aria-multiselectable={selectionMode === 'multiple' || undefined}
                    aria-label={`${group.label} models`}
                    className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-72 overflow-y-auto rounded-lg border border-cyan-300/25 bg-slate-950 p-1 shadow-2xl shadow-black/40"
                  >
                    {group.models.map((model) => {
                      const selected = selectedSet.has(model.id)
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={disabled || loading}
                          onClick={() => selectModel(model.id)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${selected ? 'bg-cyan-400/[0.14] text-cyan-50' : 'text-slate-200 hover:bg-white/[0.08]'} ${selected ? 'border-l-2 border-cyan-300' : 'border-l-2 border-transparent'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {selectionMode === 'multiple' ? <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${selected ? 'border-cyan-200/60 bg-cyan-300/20 text-cyan-100' : 'border-white/20 text-transparent'}`}>✓</span> : null}
                          <ProviderLogo provider={group.key} label={group.label} />
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-xs font-semibold">{modelTitle(model)}</strong>
                            <span className="mt-0.5 block truncate text-[10px] text-slate-400">{modelDetail(model)}</span>
                          </span>
                          {selectionMode === 'single' && selected ? <span aria-hidden="true" className="text-sm text-cyan-200">✓</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
        </div>
      ) : null}
    </div>
  )
}

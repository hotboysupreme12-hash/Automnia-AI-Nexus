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
  const [primaryProviderKey, setPrimaryProviderKey] = useState('')
  const [fallbackProviderKey, setFallbackProviderKey] = useState('')
  const modelMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openGroupKey) return

    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node)) return
      setOpenGroupKey('')
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenGroupKey('')
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openGroupKey])
  const visibleOpenGroupKey = groups.some((group) => group.key === openGroupKey) ? openGroupKey : ''
  const primaryModelId = selectedIds.find(Boolean) || ''
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
    const primaryModels = activePrimaryGroup?.models || []
    const fallbackModels = activeFallbackGroup?.models.filter((model) => model.id !== primaryModelId) || []
    const availableFallbackModels = fallbackModels.filter((model) => !fallbackSet.has(model.id))
    const selectedFallbackModels = fallbackIds
      .map((modelId) => pickerModels.find((model) => model.id === modelId))
      .filter((model): model is ModelPickerModel => Boolean(model))

    return (
      <div ref={modelMenuRef} className={['space-y-2.5', className].filter(Boolean).join(' ')} data-model-picker="primary">
        <label className="block">
          <span className="mb-1.5 block px-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Primary provider</span>
          <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
            <ProviderLogo provider={activePrimaryGroup?.key || 'model'} label={browseProviderLabel} />
            <select
              aria-label="Primary provider"
              data-model-primary-provider-select
              value={activePrimaryGroup?.key || ''}
              disabled={disabled || loading || !groups.length}
              onChange={(event) => setPrimaryProviderKey(event.currentTarget.value)}
              className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!groups.length ? <option value="">Choose a provider</option> : null}
              {groups.map((group) => (
                <option key={group.key} value={group.key}>{group.label}</option>
              ))}
            </select>
          </span>
        </label>

        {loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">Loading models…</div> : null}
        {!loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">No models available.</div> : null}

        {activePrimaryGroup && primaryModels.length ? (
          <div data-model-primary-models>
            <label className="block">
              <span className="mb-1.5 block px-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Primary model</span>
              <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
                <ProviderLogo provider={activePrimaryGroup.key} label={browseProviderLabel} />
                <select
                  aria-label={browseProviderLabel + ' primary model'}
                  data-model-primary-select
                  value={primaryModels.some((model) => model.id === primaryModelId) ? primaryModelId : ''}
                  disabled={disabled || loading}
                  onChange={(event) => {
                    setPrimaryProviderKey(activePrimaryGroup.key)
                    onSelect(event.currentTarget.value)
                  }}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{emptyOption?.label || 'Choose a ' + browseProviderLabel + ' model'}</option>
                  {primaryModels.map((model) => (
                    <option key={model.id} value={model.id}>{modelTitle(model)}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        ) : null}

        {onToggleFallback && activeFallbackGroup ? (
          <div data-model-fallbacks className="space-y-2.5">
            <label className="block">
              <span className="mb-1.5 block px-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Fallback provider</span>
              <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
                <ProviderLogo provider={activeFallbackGroup.key} label={activeFallbackGroup.label} />
                <select
                  aria-label="Fallback provider"
                  data-model-fallback-provider-select
                  value={activeFallbackGroup.key}
                  disabled={disabled || loading}
                  onChange={(event) => setFallbackProviderKey(event.currentTarget.value)}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {groups.map((group) => (
                    <option key={group.key} value={group.key}>{group.label}</option>
                  ))}
                </select>
              </span>
            </label>

            <div data-model-fallback-models>
              <label className="block">
                <span className="mb-1.5 block px-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200/75">Fallback model</span>
                <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
                  <ProviderLogo provider={activeFallbackGroup.key} label={activeFallbackGroup.label} />
                  <select
                    aria-label={activeFallbackGroup.label + ' fallback model'}
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
                <div role="list" aria-label="Selected fallback models" className="mt-1.5 space-y-0.5">
                  {selectedFallbackModels.map((model) => {
                    const group = groups.find((candidate) => candidate.models.some((entry) => entry.id === model.id))
                    return (
                      <div key={model.id} className="flex min-h-9 items-center gap-2 border-b border-white/[0.08] px-0.5 py-1.5">
                        <ProviderLogo provider={group?.key || modelProviderKey(model)} label={group?.label || modelProviderLabel(modelProviderKey(model))} />
                        <strong className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-200">{modelTitle(model)}</strong>
                        <button
                          type="button"
                          aria-label={'Remove ' + modelTitle(model) + ' fallback'}
                          disabled={disabled || loading}
                          onClick={() => onToggleFallback(model.id)}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-sm text-slate-400 transition hover:bg-rose-300/[0.08] hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
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

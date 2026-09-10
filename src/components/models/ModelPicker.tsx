import { EmptyState } from '../ui/EmptyState'
import { Button } from '../ui'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AuthProviderStatus } from '../../api/providerAuth'
import { AUTOMNIA_CREDITS_MODEL_ID, automniaRelayModelLabel } from '../../utils/licenseEntitlement'
import { groupAvailableModels, isSelectableModelId, modelProviderLabel, type ModelOptionGroup } from '../../utils/modelGrouping'
import { providerLogoKey, providerLogoSrc } from '../../utils/providerLogos'
import { ModelShortcuts } from './ModelShortcuts'
import { rememberModelSelection } from './modelPreferences'

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

const modelTitle = (model: ModelPickerModel) => {
  const provider = model.provider?.trim().toLowerCase() || model.id.split('/')[0]?.toLowerCase() || ''
  return provider === 'automnia-cloud'
    ? automniaRelayModelLabel(model.id)
    : model.alias?.trim() || model.name?.trim() || model.id.split('/').pop() || model.id
}

const modelDetail = (model: ModelPickerModel) => {
  const provider = model.provider?.trim() || model.id.split('/')[0] || 'provider'
  const isAutomnia = provider.toLowerCase() === 'automnia-cloud'
  const name = isAutomnia
    ? modelTitle(model)
    : model.name?.trim() || model.id.split('/').pop() || model.id
  return `${modelProviderLabel(provider)} / ${name}`
}

function providerInitial(label: string) {
  return label.replace(/^OpenRouter\s+-\s+/i, '').trim().charAt(0).toUpperCase() || 'A'
}

const modelProviderKey = (model: ModelPickerModel) =>
  (model.provider?.trim() || model.id.split('/')[0] || '').toLowerCase()

const isAutomniaProviderKey = (provider: string) => provider.trim().toLowerCase() === 'automnia-cloud'

export function ProviderLogo({ provider, label, size = 'sm' }: { provider: string; label: string; size?: 'sm' | 'md' }) {
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
  onSelect: onSelectModel,
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
  const onSelect = (id: string) => { onSelectModel(id); rememberModelSelection(id) }
  const pickerId = useId()
  const selectableModels = useMemo(
    () => models.filter((model) => isSelectableModelId(model.id)),
    [models],
  )
  const pickerModels = selectableModels
  const groups = useMemo(() => groupAvailableModels(pickerModels), [pickerModels])
  const normalizedSelectedIds = useMemo(() => selectedIds.filter(Boolean), [selectedIds])
  const normalizedFallbackIds = useMemo(() => fallbackIds.filter(Boolean), [fallbackIds])
  const selectedSet = useMemo(() => new Set(normalizedSelectedIds), [normalizedSelectedIds])
  const fallbackSet = useMemo(() => new Set(normalizedFallbackIds), [normalizedFallbackIds])
  const [openGroupKey, setOpenGroupKey] = useState('')
  const [isFallbacksOpen, setIsFallbacksOpen] = useState(false)
  const [primaryProviderKey, setPrimaryProviderKey] = useState('')
  const [fallbackProviderKey, setFallbackProviderKey] = useState('')
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const typeaheadRef = useRef({ text: '', updatedAt: 0 })
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const [focusedOption, setFocusedOption] = useState(0)

  useLayoutEffect(() => {
    if (!openGroupKey) return
    const updatePosition = () => {
      const trigger = triggerRefs.current.get(openGroupKey)
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportLeft = viewport?.offsetLeft || 0
      const viewportTop = viewport?.offsetTop || 0
      const viewportWidth = viewport?.width || window.innerWidth
      const viewportHeight = viewport?.height || window.innerHeight
      const width = Math.max(0, Math.min(Math.max(rect.width, 260), viewportWidth - 16))
      const below = viewportTop + viewportHeight - rect.bottom - 12
      const above = rect.top - viewportTop - 12
      const openAbove = below < 180 && above > below
      const maxHeight = Math.min(288, Math.max(64, openAbove ? above : below))
      setMenuPosition({
        position: 'fixed',
        width,
        maxHeight,
        left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8)),
        top: openAbove ? Math.max(viewportTop + 8, rect.top - maxHeight - 4) : Math.max(viewportTop + 8, rect.bottom + 4),
        zIndex: 100,
      })
    }
    updatePosition()
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [openGroupKey])

  useEffect(() => {
    if (!openGroupKey) return
    listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focusedOption]?.focus({ preventScroll: true })
    listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focusedOption]?.scrollIntoView({ block: 'nearest' })
  }, [openGroupKey, focusedOption])
  useEffect(() => {
    if (!openGroupKey) return

    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node) || listboxRef.current?.contains(event.target as Node)) return
      setOpenGroupKey('')
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpenGroupKey('')
        triggerRefs.current.get(openGroupKey)?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [openGroupKey])
  const openGroup = (group: ModelOptionGroup<ModelPickerModel>, last = false) => {
    const selectedIndex = group.models.findIndex((model) => selectedSet.has(model.id))
    setFocusedOption(last ? group.models.length - 1 : Math.max(0, selectedIndex))
    setOpenGroupKey(group.key)
  }
  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, group: ModelOptionGroup<ModelPickerModel>) => {
    const count = group.models.length
    if (!count) return
    let nextIndex = focusedOption
    if (event.key === 'ArrowDown') nextIndex = (focusedOption + 1) % count
    else if (event.key === 'ArrowUp') nextIndex = (focusedOption - 1 + count) % count
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = count - 1
    else if (event.key === 'Tab') {
      setOpenGroupKey('')
      triggerRefs.current.get(group.key)?.focus()
      return
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const previous = now - typeaheadRef.current.updatedAt < 700 ? typeaheadRef.current.text : ''
      const text = `${previous}${event.key}`.toLocaleLowerCase()
      typeaheadRef.current = { text, updatedAt: now }
      const match = group.models.findIndex((model) => modelTitle(model).toLocaleLowerCase().startsWith(text))
      if (match < 0) return
      nextIndex = match
    } else return
    event.preventDefault()
    setFocusedOption(nextIndex)
  }
  const visibleOpenGroupKey = groups.some((group) => group.key === openGroupKey) ? openGroupKey : ''
  const primaryModelId = selectedIds.find(Boolean) || ''
  const primaryModelProviderKey = modelProviderKey({ id: primaryModelId })
  const primaryModelGroup = groups.find((group) => group.models.some((model) => model.id === primaryModelId))
    || groups.find((group) => group.key === primaryModelProviderKey)
  const activePrimaryGroup = groups.find((group) => group.key === primaryProviderKey) || primaryModelGroup || groups[0]
  const selectedFallbackGroup = groups.find((group) => group.models.some((model) => fallbackSet.has(model.id)))
  const activeFallbackGroup = groups.find((group) => group.key === fallbackProviderKey)
    || selectedFallbackGroup
    || groups.find((group) => group.key !== activePrimaryGroup?.key)
    || groups[0]
  const selectedModelNames = normalizedSelectedIds
    .filter(Boolean)
    .map((modelId) => modelTitle(selectableModels.find((model) => model.id === modelId) || { id: modelId }))
  const selectModel = (modelId: string) => {
    if (disabled || loading || !isSelectableModelId(modelId)) return
    onSelect(modelId)
    if (selectionMode === 'single') {
      setOpenGroupKey('')
      triggerRefs.current.get(openGroupKey)?.focus()
    }
  }

  if (mode === 'primary') {
    const browseProviderLabel = activePrimaryGroup?.label || 'Choose a provider'
    const primaryModels = activePrimaryGroup?.models || []
    const primaryProviderAuth = activePrimaryGroup && providerAuthStatusFor?.(activePrimaryGroup.key)
    const fallbackModels = activeFallbackGroup?.models.filter((model) => model.id !== primaryModelId) || []
    const availableFallbackModels = fallbackModels.filter((model) => !fallbackSet.has(model.id))
    const selectedFallbackModels = normalizedFallbackIds
      .map((modelId) => pickerModels.find((model) => model.id === modelId))
      .filter((model): model is ModelPickerModel => Boolean(model))

    return (
      <div ref={modelMenuRef} data-model-picker-instance={pickerId} className={['space-y-2.5', className].filter(Boolean).join(' ')} data-model-picker="primary">
        <ModelShortcuts models={selectableModels} selected={primaryModelId} disabled={disabled || loading} onSelect={onSelect} />
        <label className="block">
          <span className="mb-1.5 block px-0.5 text-[10px] font-semibold tracking-normal text-cyan-200/75">Primary provider</span>
          <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
            <ProviderLogo provider={activePrimaryGroup?.key || 'model'} label={browseProviderLabel} />
            <select
              aria-label="Primary provider"
              data-model-primary-provider-select
              value={activePrimaryGroup?.key || ''}
              disabled={disabled || loading || !groups.length}
              onChange={(event) => {
                const nextProviderKey = event.currentTarget.value
                setPrimaryProviderKey(nextProviderKey)
                if (isAutomniaProviderKey(nextProviderKey)) {
                  const defaultAutomniaModel = groups
                    .find((group) => group.key === nextProviderKey)
                    ?.models.find((model) => model.id === AUTOMNIA_CREDITS_MODEL_ID)
                  onSelect(defaultAutomniaModel?.id || AUTOMNIA_CREDITS_MODEL_ID)
                }
              }}
              className="min-h-10 min-w-0 flex-1 bg-transparent px-1 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!groups.length ? <option value="">Choose a provider</option> : null}
              {groups.map((group) => (
                <option key={group.key} value={group.key}>{group.label}</option>
              ))}
            </select>
          </span>
        </label>

        {activePrimaryGroup && primaryProviderAuth && onProviderAuth ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2" data-provider-auth-action>
            <span className="min-w-0 truncate text-[10px] text-slate-400">
              {primaryProviderAuth.configured ? 'Account connected' : 'Account needed'}
            </span>
            <button
              type="button"
              data-provider-auth-button
              aria-label={`${primaryProviderAuth.configured ? 'Manage' : 'Connect'} ${browseProviderLabel} sign-in`}
              onClick={() => onProviderAuth(activePrimaryGroup.key, primaryProviderAuth)}
              disabled={disabled || loading}
              className="shrink-0 rounded-md border border-cyan-200/25 bg-cyan-300/[0.08] px-2.5 py-1.5 text-[10px] font-bold text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {primaryProviderAuth.configured ? 'Manage sign-in' : 'Connect'}
            </button>
          </div>
        ) : null}

        {loading && !groups.length ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">Loading models…</div> : null}
        {!loading && !groups.length ? <EmptyState title="No models available" description="Check your account access and provider connection, then reopen this model picker."><Button size="compact" onClick={() => window.dispatchEvent(new CustomEvent('automnia:navigate', { detail: 'settings-account' }))}>Open account setup</Button></EmptyState> : null}

        {activePrimaryGroup && primaryModels.length ? (
          <div data-model-primary-models>
            <label className="block">
              <span className="mb-1.5 block px-0.5 text-[10px] font-semibold tracking-normal text-cyan-200/75">Primary model</span>
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
              <span className="mb-1.5 block px-0.5 text-[10px] font-semibold tracking-normal text-cyan-200/75">Fallback provider</span>
              <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.025] px-2">
                <ProviderLogo provider={activeFallbackGroup.key} label={activeFallbackGroup.label} />
                <select
                  aria-label="Fallback provider"
                  data-model-fallback-provider-select
                  value={activeFallbackGroup.key}
                  disabled={disabled || loading}
                  onChange={(event) => {
                    const nextProviderKey = event.currentTarget.value
                    setFallbackProviderKey(nextProviderKey)
                    if (isAutomniaProviderKey(nextProviderKey) && primaryModelId !== AUTOMNIA_CREDITS_MODEL_ID && !fallbackSet.has(AUTOMNIA_CREDITS_MODEL_ID)) {
                      onToggleFallback(AUTOMNIA_CREDITS_MODEL_ID)
                    }
                  }}
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
                <span className="mb-1.5 block px-0.5 text-[10px] font-semibold tracking-normal text-cyan-200/75">Fallback model</span>
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
    <div className={`space-y-3 ${className}`} data-model-picker={selectionMode} data-model-picker-instance={pickerId}>
      {selectionMode === 'single' && <ModelShortcuts models={selectableModels} selected={primaryModelId} disabled={disabled || loading} onSelect={onSelect} />}
      {collapsible ? (
        <div data-model-picker-disclosure>
          <button
            type="button"
            aria-expanded={isFallbacksOpen}
            aria-controls={`${pickerId}-fallbacks-panel`}
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
        <div id={collapsible ? `${pickerId}-fallbacks-panel` : undefined} className={collapsible ? 'space-y-3' : undefined}>
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
      {!loading && !groups.length ? <EmptyState title="No models available" description="Check your account access and provider connection, then reopen this model picker."><Button size="compact" onClick={() => window.dispatchEvent(new CustomEvent('automnia:navigate', { detail: 'settings-account' }))}>Open account setup</Button></EmptyState> : null}

      {groups.length ? (
        <div ref={modelMenuRef} className="grid gap-2 sm:grid-cols-2" data-model-provider-list aria-label={`${label} providers`}>
          {groups.map((group) => {
            const isOpen = group.key === visibleOpenGroupKey
            const selectedModels = group.models.filter((model) => selectedSet.has(model.id))
            const selectedModel = selectedModels[0]
            const selectedCount = selectedModels.length
            const providerAuth = providerAuthStatusFor?.(group.key)
            const menuId = `${pickerId}-menu-${group.key.replace(/[^a-z0-9]+/gi, '-')}`
            return (
              <div key={group.key} className="relative min-w-0">
                <button
                  type="button"
                  ref={(node) => { if (node) triggerRefs.current.set(group.key, node); else triggerRefs.current.delete(group.key) }}
                  aria-haspopup="listbox"
                  aria-expanded={isOpen}
                  aria-controls={menuId}
                  disabled={disabled || loading}
                  onClick={() => { if (isOpen) setOpenGroupKey(''); else openGroup(group) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    event.preventDefault()
                    openGroup(group, event.key === 'ArrowUp')
                  }}
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

                {providerAuth && onProviderAuth ? (
                  <button
                    type="button"
                    data-provider-auth-button
                    aria-label={`${providerAuth.configured ? 'Manage' : 'Connect'} ${group.label} sign-in`}
                    onClick={() => onProviderAuth(group.key, providerAuth)}
                    disabled={disabled || loading}
                    className="mt-1 w-full rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-left text-[9px] font-semibold text-cyan-100 transition hover:border-cyan-200/30 hover:bg-cyan-300/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {providerAuth.configured ? 'Manage sign-in' : 'Connect provider'}
                  </button>
                ) : null}

                {isOpen ? createPortal(
                  <div
                    ref={listboxRef}
                    id={menuId}
                    data-model-picker-popover
                    data-modal-popover
                    data-popover-owner={pickerId}
                    role="listbox"
                    aria-multiselectable={selectionMode === 'multiple' || undefined}
                    aria-label={`${group.label} models`}
                    style={menuPosition}
                    onKeyDown={(event) => handleListboxKeyDown(event, group)}
                    className="model-picker-popover overflow-y-auto rounded-lg border border-cyan-300/25 bg-slate-950 p-1 shadow-2xl shadow-black/40"
                  >
                    {group.models.map((model, index) => {
                      const selected = selectedSet.has(model.id)
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          tabIndex={index === focusedOption ? 0 : -1}
                          onFocus={() => setFocusedOption(index)}
                          aria-selected={selected}
                          disabled={disabled || loading}
                          onClick={() => selectModel(model.id)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${selected ? 'bg-cyan-400/[0.14] text-cyan-50' : 'text-slate-200 hover:bg-white/[0.08]'} ${selected ? 'border-l-2 border-cyan-300' : 'border-l-2 border-transparent'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {selectionMode === 'multiple' ? <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${selected ? 'border-cyan-200/60 bg-cyan-300/20 text-cyan-100' : 'border-white/20 text-transparent'}`}>✓</span> : null}
                          <ProviderLogo provider={group.key} label={group.label} />
                          <span className="min-w-0 flex-1">
                            <strong className="block break-words text-xs font-semibold">{modelTitle(model)}</strong>
                            <span className="mt-0.5 block break-all text-[11px] text-slate-400">{modelDetail(model)}</span>
                          </span>
                          {selectionMode === 'single' && selected ? <span aria-hidden="true" className="text-sm text-cyan-200">✓</span> : null}
                        </button>
                      )
                    })}
                  </div>, document.body,
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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AuthProviderStatus } from '../../api/providerAuth'
import { groupAvailableModels, isSelectableModelId, modelProviderLabel } from '../../utils/modelGrouping'
import { automniaRelayModelLabel } from '../../utils/licenseEntitlement'
import { ProviderLogo, type ModelPickerModel } from './ModelPicker'
import { MODEL_PREFERENCES_EVENT, MODEL_PREFERENCES_KEY, readModelPreferences, rememberModelSelection, updateModelPreferences } from './modelPreferences'
import './agent-model-picker.css'

interface Props {
  models: readonly ModelPickerModel[]
  selectedIds: readonly string[]
  fallbackIds: readonly string[]
  loading?: boolean
  disabled?: boolean
  onSelect: (id: string) => void
  onToggleFallback: (id: string) => void
  providerAuthStatusFor: (provider: string) => AuthProviderStatus | undefined
  onProviderAuth: (provider: string, status: AuthProviderStatus) => void
}

const provider = (model: ModelPickerModel) => model.provider || model.id.split('/')[0] || ''
const title = (model: ModelPickerModel) => provider(model) === 'automnia-cloud'
  ? automniaRelayModelLabel(model.id)
  : model.alias || model.name || model.id.split('/').pop() || model.id

/** A single catalog for primary and backup choices, scoped to agent settings. */
export function AgentModelPicker({ models, selectedIds, fallbackIds, loading, disabled, onSelect, onToggleFallback, providerAuthStatusFor, onProviderAuth }: Props) {
  const id = useId()
  const [choosing, setChoosing] = useState<'primary' | 'backup' | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [preferences, setPreferences] = useState(readModelPreferences)
  const [notice, setNotice] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const catalog = useMemo(() => models.filter(model => isSelectableModelId(model.id)), [models])
  const groups = useMemo(() => groupAvailableModels(catalog), [catalog])
  const primaryId = selectedIds[0] || ''
  const selected = catalog.find(model => model.id === primaryId) || (primaryId ? { id: primaryId } : undefined)
  const selectedGroup = groups.find(group => group.models.some(model => model.id === primaryId))
  const providerKey = selectedGroup?.key || (selected ? provider(selected) : '')
  const auth = providerKey ? providerAuthStatusFor(providerKey) : undefined
  const favorite = preferences.favorites.includes(primaryId)
  const busy = disabled || loading
  const backups = fallbackIds.filter(modelId => modelId !== primaryId).map(modelId => catalog.find(model => model.id === modelId) || { id: modelId })

  useEffect(() => {
    const refresh = () => setPreferences(readModelPreferences())
    const storage = (event: StorageEvent) => { if (!event.key || event.key === MODEL_PREFERENCES_KEY) refresh() }
    window.addEventListener(MODEL_PREFERENCES_EVENT, refresh)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(MODEL_PREFERENCES_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [])
  useEffect(() => {
    if (!choosing) return
    searchRef.current?.focus()
    // Handle the inline chooser before the containing dialog's capture listener.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !rootRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
      ;(choosing === 'backup' ? addRef : changeRef).current?.focus()
      setChoosing(null)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [choosing])

  const open = (target: 'primary' | 'backup') => { setNotice(''); setQuery(''); setFilter('all'); setProviderFilter('all'); setChoosing(target) }
  const close = () => { (choosing === 'backup' ? addRef : changeRef).current?.focus(); setChoosing(null) }
  const choose = (modelId: string) => {
    if (busy) return
    if (choosing === 'backup') onToggleFallback(modelId)
    else { onSelect(modelId); rememberModelSelection(modelId) }
    close()
  }
  const visible = groups.flatMap(group => group.models.map(model => ({ model, group }))).filter(({ model, group }) => {
    if (choosing === 'backup' && (model.id === primaryId || fallbackIds.includes(model.id))) return false
    if (filter === 'favorites' && !preferences.favorites.includes(model.id)) return false
    if (filter === 'recent' && !preferences.recent.includes(model.id)) return false
    if (providerFilter !== 'all' && group.key !== providerFilter) return false
    return `${title(model)} ${model.id} ${group.label}`.toLowerCase().includes(query.trim().toLowerCase())
  })
  if (filter === 'recent') visible.sort((a, b) => preferences.recent.indexOf(a.model.id) - preferences.recent.indexOf(b.model.id))

  const chooser = choosing && <section className="amp-chooser" id={`${id}-chooser`} aria-label={choosing === 'primary' ? 'Choose a model' : 'Add a backup model'} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <div className="amp-row amp-chooser-heading"><strong>{choosing === 'primary' ? 'Choose a model' : 'Add a backup model'}</strong><button type="button" onClick={close}>Cancel</button></div>
    <input ref={searchRef} type="search" aria-label="Search models and providers" placeholder="Search models or providers…" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="amp-row amp-filters" role="group" aria-label="Filter models">
      {(['all', 'favorites', 'recent'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); if (value === 'all') setProviderFilter('all') }}>{value === 'all' ? 'All models' : value === 'favorites' ? 'Favorites' : 'Recent'}</button>)}
      <span role="status">{visible.length} models</span>
    </div>
    <div className="amp-provider-chips" role="group" aria-label="Filter by provider">
      {groups.map(group => <button type="button" className="amp-provider-chip" key={group.key} aria-pressed={providerFilter === group.key} onClick={() => setProviderFilter(group.key)}><ProviderLogo provider={group.key} label={group.label} />{group.label}</button>)}
    </div>
    <div className="amp-results" aria-label="Available models">
      {visible.map(({ model, group }) => <button className="amp-result" type="button" key={model.id} disabled={busy} aria-pressed={model.id === primaryId} onClick={() => choose(model.id)}>
        <ProviderLogo provider={group.key} label={group.label} />
        <span className="amp-model-name"><strong>{title(model)}</strong><small>{group.label}</small></span>
        <span className="amp-result-state">{model.id === primaryId ? 'Current' : choosing === 'backup' ? 'Add' : 'Select'}</span>
      </button>)}
      {!visible.length && <p className="amp-empty">{loading ? 'Loading models…' : query ? 'No matching models. Try a different name or provider.' : filter === 'favorites' ? 'No available favorites yet. Save your active model as a favorite to find it here.' : filter === 'recent' ? 'Models you choose will appear here.' : choosing === 'backup' ? 'All available models are already in use.' : 'No models available. Check your account access and provider connections.'}</p>}
    </div>
  </section>

  return <div ref={rootRef} className="agent-model-settings">
    <section className="amp-primary" aria-label="Active model">
      <div className="amp-row"><h3>Active model</h3><span className="amp-caption">Used for your agent’s work</span></div>
      <div className="amp-row amp-selection">
        {selected && <ProviderLogo provider={providerKey} label={modelProviderLabel(providerKey)} size="md" />}
        <div className="amp-model-name"><strong>{selected ? title(selected) : loading ? 'Loading models…' : 'Choose a model'}</strong><small>{selected ? selectedGroup?.label || modelProviderLabel(providerKey) : 'Browse models from your available providers.'}</small></div>
        <button ref={changeRef} type="button" className="amp-change" disabled={busy} aria-expanded={choosing === 'primary'} aria-controls={choosing === 'primary' ? `${id}-chooser` : undefined} onClick={() => choosing === 'primary' ? close() : open('primary')}>{selected ? 'Change model' : 'Choose model'}</button>
      </div>
      {selected && <div className="amp-row amp-secondary-actions">
        <button type="button" aria-pressed={favorite} disabled={busy} onClick={() => {
          if (!favorite && preferences.favorites.length >= 50) { setNotice('You can save up to 50 favorites. Remove one before adding another.'); return }
          const saved = updateModelPreferences(current => ({ ...current, favorites: favorite ? current.favorites.filter(value => value !== primaryId) : [...current.favorites, primaryId] }))
          setNotice(saved ? favorite ? 'Favorite removed.' : 'Model saved to favorites.' : 'Could not save this preference. Check available local storage.')
        }}>{favorite ? '★ Saved to favorites' : '☆ Save to favorites'}</button>
        {auth && <button type="button" disabled={busy} onClick={() => onProviderAuth(providerKey, auth)}>{auth.configured ? 'Manage connection' : 'Connect provider'}</button>}
      </div>}
      {auth && !auth.configured && <p className="amp-connection-note">Connect {selectedGroup?.label || modelProviderLabel(providerKey)} to use this model.</p>}
      {choosing === 'primary' && chooser}
    </section>
    <details className="amp-backups" onToggle={event => { if (!event.currentTarget.open && choosing === 'backup') setChoosing(null) }}>
      <summary><span><strong>Backup models</strong><small>{backups.length ? `${backups.length} configured · used if the active model fails` : 'Optional · used if the active model fails'}</small></span><span className="amp-chevron" aria-hidden="true">›</span></summary>
      <div className="amp-backup-body">
        <p>Backups are tried in the order below. Your active model is always used first.</p>
        {backups.length > 0 && <ol>{backups.map((model, index) => <li className="amp-row" key={model.id}><span className="amp-order">{index + 1}</span><ProviderLogo provider={provider(model)} label={modelProviderLabel(provider(model))} /><div className="amp-model-name"><strong>{title(model)}</strong><small>{modelProviderLabel(provider(model))}</small></div><button type="button" disabled={busy} aria-label={`Remove ${title(model)} backup`} onClick={() => onToggleFallback(model.id)}>Remove</button></li>)}</ol>}
        <button ref={addRef} type="button" disabled={busy} aria-expanded={choosing === 'backup'} aria-controls={choosing === 'backup' ? `${id}-chooser` : undefined} onClick={() => choosing === 'backup' ? close() : open('backup')}>Add backup model</button>
        {choosing === 'backup' && chooser}
      </div>
    </details>
    {notice && <p role="status">{notice}</p>}
  </div>
}

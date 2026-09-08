import { useEffect, useState } from 'react'
import { MODEL_PREFERENCES_EVENT, MODEL_PREFERENCES_KEY, readModelPreferences, updateModelPreferences } from './modelPreferences'
import type { ModelPickerModel } from './ModelPicker'

export function ModelShortcuts({ models, selected, disabled, onSelect }: { models: readonly ModelPickerModel[]; selected: string; disabled: boolean; onSelect: (id: string) => void }) {
  const [preferences, setPreferences] = useState(readModelPreferences)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const refresh = () => setPreferences(readModelPreferences())
    const storage = (event: StorageEvent) => { if (!event.key || event.key === MODEL_PREFERENCES_KEY) refresh() }
    window.addEventListener(MODEL_PREFERENCES_EVENT, refresh)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(MODEL_PREFERENCES_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [])
  const byId = new Map(models.map((model) => [model.id, model]))
  const favorites = preferences.favorites
  const recent = preferences.recent.filter((id) => !favorites.includes(id))
  const favorite = preferences.favorites.includes(selected)
  if (!models.length && !favorites.length && !recent.length) return null
  const title = (id: string) => byId.get(id)?.alias || byId.get(id)?.name || id
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs" aria-label="Model shortcuts">
    {(favorites.length > 0 || recent.length > 0) && <label className="min-w-0 flex-1">
      <span className="sr-only">Favorite and recent models</span>
      <select disabled={disabled} value="" onChange={(event) => { if (byId.has(event.target.value)) onSelect(event.target.value) }} className="min-h-9 w-full min-w-0 rounded border border-white/15 bg-transparent px-2">
        <option value="">Favorites and recent models</option>
        {favorites.length > 0 && <optgroup label="Favorites">{favorites.map((id) => <option key={id} value={id} disabled={!byId.has(id)}>{title(id)}{byId.has(id) ? '' : ' — unavailable for this setup'}</option>)}</optgroup>}
        {recent.length > 0 && <optgroup label="Recent">{recent.map((id) => <option key={id} value={id} disabled={!byId.has(id)}>{title(id)}{byId.has(id) ? '' : ' — unavailable for this setup'}</option>)}</optgroup>}
      </select>
    </label>}
    {selected && byId.has(selected) && <button type="button" disabled={disabled} aria-pressed={favorite} aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${title(selected)}`} className="min-h-9 rounded border border-white/15 px-3" onClick={() => {
      if (!favorite && preferences.favorites.length >= 50) { setNotice('You can save 50 favorite models. Remove one before adding another.'); return }
      const saved = updateModelPreferences((current) => ({ ...current, favorites: favorite ? current.favorites.filter((id) => id !== selected) : [...current.favorites, selected] }))
      setNotice(saved ? favorite ? 'Favorite removed.' : 'Model favorited.' : 'Could not save this preference. Check available local storage.')
    }}>{favorite ? '★ Favorited' : '☆ Favorite'}</button>}
    {notice && <span role="status" className="w-full">{notice}</span>}
  </div>
}

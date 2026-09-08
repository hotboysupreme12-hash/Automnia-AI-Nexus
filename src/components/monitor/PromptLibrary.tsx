import { useId, useState } from 'react'
import { Button } from '../ui'

type SavedPrompt = { id: string; name: string; text: string }
const STORAGE_KEY = 'automnia:saved-prompts:v1'

function readPrompts(): SavedPrompt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedPrompt => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.text === 'string').slice(0, 30)
  } catch { return [] }
}

export function PromptLibrary({ draft, onInsert }: { draft: string; onInsert: (text: string) => void }) {
  const [prompts, setPrompts] = useState(readPrompts)
  const [name, setName] = useState('')
  const [notice, setNotice] = useState('')
  const nameId = useId()
  const store = (next: SavedPrompt[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setPrompts(next)
      return true
    } catch { setNotice('Could not save prompts. Free local storage and try again.'); return false }
  }
  return <details className="min-w-0 rounded border border-white/10 px-3 py-2 text-[12px]">
    <summary className="cursor-pointer">Saved prompts ({prompts.length})</summary>
    <div className="mt-3 grid min-w-0 gap-2">
      <label htmlFor={nameId}>Name for the current draft</label>
      <input id={nameId} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="min-w-0 rounded border border-white/15 bg-transparent px-2 py-2" />
      <Button size="compact" disabled={!name.trim() || !draft.trim()} onClick={() => {
        if (prompts.length >= 30) { setNotice('Your library holds 30 prompts. Remove one before saving another.'); return }
        if (draft.length > 32_000) { setNotice('Saved prompts can contain up to 32,000 characters.'); return }
        if (store([...prompts, { id: crypto.randomUUID(), name: name.trim(), text: draft }])) { setName(''); setNotice('Prompt saved on this device.') }
      }}>Save current draft</Button>
      {prompts.map((prompt) => <div key={prompt.id} className="flex min-w-0 flex-wrap gap-2">
        <Button size="compact" className="min-w-0 flex-1" onClick={() => { onInsert(prompt.text); setNotice(`Inserted ${prompt.name}.`) }}>{prompt.name}</Button>
        <Button size="compact" variant="quiet" aria-label={`Remove saved prompt ${prompt.name}`} onClick={() => { if (store(prompts.filter((entry) => entry.id !== prompt.id))) setNotice('Saved prompt removed.') }}>Remove</Button>
      </div>)}
      {notice && <p role="status" className="break-words">{notice}</p>}
    </div>
  </details>
}

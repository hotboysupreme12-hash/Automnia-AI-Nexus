import { useNexusStore } from '../../store/nexusStore'
import { useState, useSyncExternalStore } from 'react'
import { Button, Dialog } from '../ui'
import { ResponseMarkdown } from '../monitor/ResponseMarkdown'
import { readBookmarks, saveBookmarks, subscribeBookmarks, type Bookmark } from './bookmarkStore'

export function BookmarkButton({ kind, sourceId, title, text }: Pick<Bookmark, 'kind' | 'sourceId' | 'title' | 'text'>) {
  const bookmarks = useSyncExternalStore(subscribeBookmarks, readBookmarks, readBookmarks)
  const [notice, setNotice] = useState('')
  const id = `${kind}:${sourceId}`
  const saved = bookmarks.some((entry) => entry.id === id)
  return <>
    <Button size="compact" variant="quiet" aria-pressed={saved} aria-label={`${saved ? 'Remove bookmark for' : 'Bookmark'} ${title}`} onClick={() => {
      try {
        const current = readBookmarks()
        const result = saveBookmarks(saved ? current.filter((entry) => entry.id !== id) : [{ id, kind, sourceId, title: title.slice(0, 200), text, savedAt: new Date().toISOString() }, ...current])
        setNotice(result.ok ? (saved ? 'Bookmark removed.' : 'Saved a copy on this device.') : result.message)
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save the bookmark.') }
    }}>{saved ? 'Bookmarked' : 'Bookmark'}</Button>
    {notice && <span role="status" className="text-xs text-slate-300">{notice}</span>}
  </>
}

function BookmarkNote({ bookmark }: { bookmark: Bookmark }) {
  const [note, setNote] = useState(bookmark.note || '')
  const [notice, setNotice] = useState('')
  return <form className="mt-3 space-y-2" onSubmit={(event) => {
    event.preventDefault()
    try {
      const current = readBookmarks()
      if (!current.some((entry) => entry.id === bookmark.id)) throw new Error('This bookmark was removed. Copy your note before closing.')
      const result = saveBookmarks(current.map((entry) => entry.id === bookmark.id ? { ...entry, note: note.trim() } : entry))
      setNotice(result.ok ? 'Note saved.' : result.message)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save this note.') }
  }}>
    <label className="block text-sm">Your note<textarea className="mt-2 block w-full rounded-lg border border-white/20 bg-transparent p-3" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this is useful or what to do next" /></label>
    <Button type="submit" size="compact" disabled={note === (bookmark.note || '')}>Save note</Button>
    {notice && <p role="status" className="text-sm text-slate-300">{notice}</p>}
  </form>
}

export function Bookmarks() {
  const bookmarks = useSyncExternalStore(subscribeBookmarks, readBookmarks, readBookmarks)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [removed, setRemoved] = useState<Bookmark | null>(null)
  const [notice, setNotice] = useState('')
  const selected = bookmarks.find((entry) => entry.id === selectedId)
  const originalAvailable = useNexusStore((state) => !selected || (selected.kind === 'response' ? state.agentResponses.some((entry) => entry.id === selected.sourceId) : state.missionHistory.some((entry) => entry.id === selected.sourceId) || state.missionReports.some((entry) => entry.missionId === selected.sourceId)))
  const filtered = bookmarks.filter((entry) => `${entry.title} ${entry.text} ${entry.note || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <>
    <Button size="compact" variant="quiet" onClick={() => setOpen(true)}>Bookmarks{bookmarks.length ? ` (${bookmarks.length})` : ''}</Button>
    <Dialog open={open} title="Saved bookmarks" description="Copies saved on this device. Clearing response history does not remove these bookmarks." onClose={() => setOpen(false)}>
      <input type="search" className="mb-3 w-full rounded-lg border border-white/20 bg-transparent p-3" aria-label="Search bookmarks" placeholder="Find a saved response or mission" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="max-h-[45dvh] overflow-auto">
        {selected ? <article>
          <Button size="compact" onClick={() => setSelectedId('')}>Back to bookmarks</Button>
          <h3 className="my-3 break-words text-lg font-semibold">{selected.title}</h3>
          <p className="mb-3 text-xs text-slate-400">Saved {new Date(selected.savedAt).toLocaleString()}</p>
          {!originalAvailable && <p className="mb-3 text-sm text-amber-200">The original is no longer in local history. Your saved copy is shown below.</p>}
          {selected.kind === 'mission' ? <pre className="dui-document-surface">{selected.text}</pre> : <ResponseMarkdown text={selected.text} />}
          <BookmarkNote key={selected.id} bookmark={selected} />
          <div className="mt-3 flex flex-wrap gap-2"><Button size="compact" onClick={() => { void navigator.clipboard.writeText(selected.text).then(() => setNotice('Copied.'), () => setNotice('Select the text to copy it. Clipboard access was unavailable.')) }}>Copy saved text</Button>
            <Button size="compact" variant="quiet" onClick={() => { const result = saveBookmarks(readBookmarks().filter((entry) => entry.id !== selected.id)); setRemoved(selected); setSelectedId(''); setNotice(result.ok ? 'Bookmark removed.' : result.message) }}>Remove bookmark</Button></div>
        </article> : filtered.length ? <ul className="space-y-2">{filtered.map((entry) => <li key={entry.id}><button type="button" className="w-full rounded-lg border border-white/15 p-3 text-left" onClick={() => setSelectedId(entry.id)}>
          <strong className="block break-words text-sm">{entry.title}</strong><span className="mt-1 block text-xs text-slate-400">{entry.kind === 'mission' ? 'Mission' : 'Response'} · {new Date(entry.savedAt).toLocaleDateString()}</span>
        </button></li>)}</ul> : <p className="py-4 text-sm text-slate-300">{query ? 'No bookmarks match this search.' : 'Use Bookmark on a finished response or mission report to keep it here.'}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="compact" disabled={!bookmarks.length} onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'automnia-bookmarks', version: 1, bookmarks }, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = 'automnia-bookmarks.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>Export bookmarks</Button>
        {removed && <Button size="compact" onClick={() => { try { const result = saveBookmarks([removed, ...readBookmarks().filter((entry) => entry.id !== removed.id)]); setRemoved(null); setNotice(result.ok ? 'Bookmark restored.' : result.message) } catch (error) { setNotice(String(error)) } }}>Undo removal</Button>}
      </div>
      {notice && <p className="mt-2 text-sm text-slate-300" role="status">{notice}</p>}
    </Dialog>
  </>
}

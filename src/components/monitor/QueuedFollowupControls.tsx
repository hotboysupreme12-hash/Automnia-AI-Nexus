import { useId, useState } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import { Button, Dialog } from '../ui'

export function QueuedFollowupControls({ id, position, depth }: { id: string; position: number; depth: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const fieldId = useId()
  if (!position && draft === null) return null
  const move = (direction: -1 | 1) => {
    const changed = useNexusStore.getState().moveQueuedCommandConsoleFollowup(id, direction)
    setNotice(changed ? `Moved to queue position ${position + direction}.` : 'This follow-up already started or cannot move further.')
  }
  return <div className="flex flex-wrap items-center gap-2 py-2">
    <Button size="compact" variant="quiet" onClick={() => {
      const prompt = useNexusStore.getState().queuedCommandConsolePrompt(id)
      setDraft(prompt)
      setNotice(prompt === null ? 'This follow-up has already started.' : '')
    }}>Edit follow-up</Button>
    <Button size="compact" variant="quiet" disabled={position <= 1} onClick={() => move(-1)}>Move earlier</Button>
    <Button size="compact" variant="quiet" disabled={position >= depth} onClick={() => move(1)}>Move later</Button>
    {notice && <span role="status" className="text-xs">{notice}</span>}
    <Dialog open={draft !== null} title="Edit queued follow-up" description="Changes apply while the follow-up is waiting. Its recipient and attached files stay with this turn." onClose={() => setDraft(null)} footer={<>
      <Button variant="quiet" onClick={() => setDraft(null)}>Cancel</Button>
      <Button disabled={!draft?.trim()} onClick={() => {
        if (useNexusStore.getState().editQueuedCommandConsoleFollowup(id, draft || '')) { setDraft(null); setNotice('Queued follow-up updated.') }
        else setNotice('This follow-up has already started. Your edit remains here so you can copy it.')
      }}>Save follow-up</Button>
    </>}>
      <label htmlFor={fieldId} className="mb-2 block">Message</label>
      <textarea id={fieldId} value={draft || ''} maxLength={100_000} rows={8} onChange={(event) => setDraft(event.target.value)} className="w-full min-w-0 rounded border border-white/20 bg-black/20 p-3 text-sm" />
      {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    </Dialog>
  </div>
}

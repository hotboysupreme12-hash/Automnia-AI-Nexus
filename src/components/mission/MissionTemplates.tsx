import { useId, useState } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import { missionDraftFromRecord } from '../../store/missionTemplateState'
import type { MissionDraft } from '../../types/nexus'
import { Button, Dialog } from '../ui'

type Template = { id: string; name: string; draft: MissionDraft }
const KEY = 'automnia:mission-templates:v1'
function readTemplates(): Template[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(saved)) return []
    return saved.slice(0, 30).flatMap((entry) => {
      const draft = missionDraftFromRecord(entry?.draft)
      return draft && typeof entry?.id === 'string' && typeof entry?.name === 'string' && entry.name.length <= 80 ? [{ id: entry.id, name: entry.name, draft }] : []
    })
  } catch { return [] }
}

export function MissionTemplates() {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState(readTemplates)
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [notice, setNotice] = useState('')
  const draft = useNexusStore((state) => state.missionDraft)
  const running = useNexusStore((state) => state.activeMission?.status === 'running' || state.missionLaunchPending)
  const inputId = useId()
  const save = (next: Template[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setTemplates(next); return true }
    catch { setNotice('Your templates could not be saved. Free device storage and try again.'); return false }
  }
  const saveDraft = (replace: boolean) => {
    const clean = missionDraftFromRecord(draft)
    if (!clean || !name.trim()) { setNotice('Enter a name and check the mission settings.'); return }
    if (!replace && templates.length >= 30) { setNotice('Remove a template to make room. You can save up to 30.'); return }
    const entry = { id: replace ? selectedId : crypto.randomUUID(), name: name.trim(), draft: clean }
    if (save(replace ? templates.map((item) => item.id === selectedId ? entry : item) : [...templates, entry])) { setSelectedId(entry.id); setNotice('Template saved on this device.') }
  }
  return <>
    <Button variant="quiet" size="compact" onClick={() => setOpen(true)}>My templates</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="My mission templates" description="Templates save objectives, evidence requirements, timing, and collaboration settings. Loading one creates an editable draft.">
      <div className="grid gap-3">
        <label htmlFor={inputId}>Template name</label>
        <input id={inputId} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="min-w-0 rounded border border-white/20 bg-transparent p-3" />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!name.trim()} onClick={() => saveDraft(false)}>{selectedId ? 'Save as new template' : 'Save current draft'}</Button>
          {selectedId && <Button variant="quiet" disabled={!name.trim()} onClick={() => saveDraft(true)}>Update selected template</Button>}
        </div>
        {!templates.length && <p className="text-sm text-slate-300">Your saved mission templates will appear here.</p>}
        {templates.map((template) => <div key={template.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-white/10 p-3">
          <strong className="min-w-0 flex-1 break-words text-sm">{template.name}</strong>
          <Button size="compact" disabled={running} onClick={() => {
            const current = useNexusStore.getState()
            if (current.activeMission?.status === 'running' || current.missionLaunchPending) return
            current.updateMissionDraft({ ...template.draft, requiredEvidence: template.draft.requiredEvidence || [] })
            setSelectedId(template.id); setName(template.name); setNotice('Template loaded. Close this dialog to edit the draft, then reopen it to save your changes.')
          }}>Load for editing</Button>
          <Button variant="quiet" size="compact" aria-label={`Remove mission template ${template.name}`} onClick={() => { if (save(templates.filter((entry) => entry.id !== template.id))) { if (selectedId === template.id) setSelectedId(''); setNotice('Template removed.') } }}>Remove</Button>
        </div>)}
        {running && <p className="text-sm">Wait until the current mission finishes before loading another draft.</p>}
        {notice && <p role="status" className="break-words text-sm">{notice}</p>}
      </div>
    </Dialog>
  </>
}

import { useState } from 'react'
import { Button, Dialog } from '../ui'
import { applyWorkspaceProfile, captureWorkspace, readWorkspaceProfiles, saveWorkspaceProfiles, type WorkspaceProfile } from './workspaceProfiles'
import type { PreferencesBackup } from './preferencesBackup'

export function WorkspaceProfiles({ onApply }: { onApply: () => void }) {
  const [profiles, setProfiles] = useState(readWorkspaceProfiles)
  const [name, setName] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<PreferencesBackup | null>(null)
  const [editing, setEditing] = useState<WorkspaceProfile | null>(null)
  const [editName, setEditName] = useState('')
  const [updateLayout, setUpdateLayout] = useState(false)
  const [editError, setEditError] = useState('')
  const [removed, setRemoved] = useState<WorkspaceProfile | null>(null)
  const persist = (next: WorkspaceProfile[], message: string) => {
    const result = saveWorkspaceProfiles(next)
    setProfiles(next)
    setNotice(result.ok ? message : result.message)
  }
  return <section className="rounded-xl border border-white/15 p-4" aria-label="Named workspace profiles">
    <h4 className="font-semibold text-slate-100">Workspace profiles</h4>
    <p className="mt-1 text-sm text-slate-300">Save appearance, registry view and console layout for different tasks. Draft retention stays as you set it.</p>
    <form className="my-3 flex flex-wrap gap-2" onSubmit={(event) => {
      event.preventDefault()
      try {
        const next = [...readWorkspaceProfiles(), { id: crypto.randomUUID(), name: name.trim(), preferences: captureWorkspace() }]
        if (!name.trim()) return
        persist(next, `Saved “${name.trim()}”.`)
        setName('')
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save this profile.') }
    }}>
      <input className="min-w-0 flex-1 rounded-lg border border-white/20 bg-transparent px-3 py-2" aria-label="New workspace profile name" maxLength={60} placeholder="For example, focused writing" value={name} onChange={(event) => setName(event.target.value)} />
      <Button type="submit" disabled={!name.trim()}>Save current layout</Button>
    </form>
    <ul className="space-y-2">{profiles.map((profile) => <li key={profile.id} className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 break-words text-sm">{profile.name}</span>
      <Button size="compact" onClick={() => { try { const previous = captureWorkspace(); const result = applyWorkspaceProfile(profile.preferences); setUndo(previous); onApply(); setNotice(result.ok ? `Applied “${profile.name}”.` : result.message) } catch (error) { setNotice(String(error)) } }}>Apply</Button>
      <Button size="compact" variant="quiet" aria-label={`Edit profile ${profile.name}`} onClick={() => { setEditing(profile); setEditName(profile.name); setUpdateLayout(false); setEditError('') }}>Edit</Button>
      <Button size="compact" variant="quiet" aria-label={`Remove profile ${profile.name}`} onClick={() => { persist(readWorkspaceProfiles().filter((entry) => entry.id !== profile.id), `Removed “${profile.name}”.`); setRemoved(profile) }}>Remove</Button>
    </li>)}</ul>
    {!profiles.length && <p className="text-sm text-slate-400">Your saved layouts will appear here.</p>}
    {undo && <Button size="compact" className="mt-3" onClick={() => { const result = applyWorkspaceProfile(undo); setUndo(null); onApply(); setNotice(result.ok ? 'Restored the previous layout.' : result.message) }}>Undo layout change</Button>}
    {removed && <Button size="compact" className="mt-3" onClick={() => { try { persist([...readWorkspaceProfiles(), removed], 'Profile restored.'); setRemoved(null) } catch (error) { setNotice(String(error)) } }}>Undo profile removal</Button>}
    <Dialog open={Boolean(editing)} title="Edit workspace profile" onClose={() => setEditing(null)}>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault()
        if (!editing || !editName.trim()) return
        try {
          const current = readWorkspaceProfiles()
          if (!current.some((profile) => profile.id === editing.id)) throw new Error('This profile was removed elsewhere. Close this editor and save a new profile.')
          persist(current.map((profile) => profile.id === editing.id ? { ...profile, name: editName.trim(), preferences: updateLayout ? captureWorkspace() : profile.preferences } : profile), 'Workspace profile updated.')
          setEditing(null)
        } catch (error) { setEditError(error instanceof Error ? error.message : 'Could not update this profile.') }
      }}>
        <label className="block text-sm">Profile name<input className="mt-2 block w-full rounded-lg border border-white/20 bg-transparent p-3" value={editName} maxLength={60} onChange={(event) => setEditName(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updateLayout} onChange={(event) => setUpdateLayout(event.target.checked)} />Replace saved layout with the current workspace</label>
        {editError && <p role="alert" className="text-sm text-rose-200">{editError}</p>}
        <Button type="submit" disabled={!editName.trim()}>Save profile changes</Button>
      </form>
    </Dialog>
    {notice && <p className="mt-2 text-sm text-slate-300" role="status">{notice}</p>}
  </section>
}

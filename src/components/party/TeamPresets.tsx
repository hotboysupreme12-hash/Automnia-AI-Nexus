import { useId, useState } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import { sanitizePartyIds } from '../../store/agentConfigState'
import { Button, Dialog } from '../ui'

type TeamPreset = { id: string; name: string; agentIds: string[] }
const STORAGE_KEY = 'automnia:team-presets:v1'
function readTeams(): TeamPreset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is TeamPreset => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.agentIds) && item.agentIds.length <= 6 && item.agentIds.every((id: unknown) => typeof id === 'string')).slice(0, 20)
  } catch { return [] }
}

export function TeamPresets() {
  const [open, setOpen] = useState(false)
  const [teams, setTeams] = useState(readTeams)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const activePartyIds = useNexusStore((state) => state.activePartyIds)
  const missionRunning = useNexusStore((state) => state.activeMission?.status === 'running')
  const nameId = useId()
  const save = (next: TeamPreset[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setTeams(next); return true }
    catch { setMessage('Teams could not be saved. Free local storage and try again.'); return false }
  }
  return <>
    <Button variant="quiet" size="compact" onClick={() => setOpen(true)}>Saved teams</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Saved teams" description="Save a party once and restore its members in the same order.">
      <div className="grid min-w-0 gap-3">
        <label htmlFor={nameId}>Name this party</label>
        <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="min-w-0 rounded border border-white/15 bg-transparent px-3 py-2" />
        <Button disabled={!name.trim() || !activePartyIds.length} onClick={() => {
          if (teams.length >= 20) { setMessage('You can save 20 teams. Remove one to make space.'); return }
          if (save([...teams, { id: crypto.randomUUID(), name: name.trim(), agentIds: [...activePartyIds] }])) { setName(''); setMessage('Team saved on this device.') }
        }}>Save current party</Button>
        {!teams.length && <p className="text-[13px] text-slate-300">Your saved teams will appear here.</p>}
        {teams.map((team) => <div key={team.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-white/10 p-3">
          <span className="min-w-0 flex-1 break-words">{team.name} · {team.agentIds.length} agents</span>
          <Button size="compact" disabled={missionRunning} onClick={() => {
            const current = useNexusStore.getState()
            if (current.activeMission?.status === 'running') { setMessage('Wait for the active mission before switching teams.'); return }
            const ids = sanitizePartyIds(team.agentIds, current.agents)
            if (!ids.length) { setMessage('None of this team’s agents are still available.'); return }
            useNexusStore.setState({ activePartyIds: ids, confirmedPartyIds: [], selectedAgentId: null, selectedAgentIds: [] })
            setMessage(ids.length === team.agentIds.length ? `${team.name} loaded. Review and confirm the party.` : `${team.name} loaded with ${ids.length} available agents. Missing agents were skipped.`)
          }}>Load</Button>
          <Button size="compact" variant="quiet" aria-label={`Remove saved team ${team.name}`} onClick={() => { if (save(teams.filter((entry) => entry.id !== team.id))) setMessage('Saved team removed.') }}>Remove</Button>
        </div>)}
        {missionRunning && <p className="text-[13px]">Team switching is paused during the active mission.</p>}
        {message && <p role="status" className="break-words text-[13px]">{message}</p>}
      </div>
    </Dialog>
  </>
}

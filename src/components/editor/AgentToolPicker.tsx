import { useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'

type Tool = { id: string; label: string; description?: string }
type Group = { id: string; label: string; tools: Tool[] }
export function AgentToolPicker({ agentId, allow, deny, onChange }: {
  agentId: string; allow: string; deny: string
  onChange: (allow: string, deny: string) => void
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [status, setStatus] = useState('Loading available tools…')
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    void apiRequest<{ catalog: { groups: Group[] } }>(`/api/party/agent/${encodeURIComponent(agentId)}/tool-catalog`, { timeoutMs: 20000 }).then(result => {
      if (cancelled) return
      if (result.ok && Array.isArray(result.data.catalog?.groups)) {
        setGroups(result.data.catalog.groups)
        setStatus('')
      } else setStatus('Could not load tools. Retry when the gateway is ready.')
    }).catch(() => { if (!cancelled) setStatus('Could not load tools. Please retry.') })
    return () => { cancelled = true }
  }, [agentId, retry])
  const split = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean)
  const allowed = split(allow), denied = split(deny)
  const advanced = [...allowed, ...denied].some(id => id.includes(':') || (id.includes('*') && id !== '*'))
  const selected = (id: string) => (!allowed.length || allowed.includes('*') || allowed.includes(id)) && !denied.includes('*') && !denied.includes(id)
  const tools = [...new Map(groups.flatMap(group => group.tools).map(tool => [tool.id, tool])).values()]
  const select = (ids: string[]) => onChange(ids.join(', '), ids.length ? '' : '*')
  return <section className="space-y-3" aria-label="Agent tools">
    <h3 className="text-sm font-bold">Tools available to this agent</h3>
    <p className="text-xs text-slate-400">Disable tools you do not need to reduce tool-definition tokens. Changes save automatically and apply to the next message, not an already-running request. Command approvals are separate. Plugins may still require setup.</p>
    <div className="flex gap-3 text-xs">
      <button type="button" onClick={() => onChange('', '')}>Enable all available tools</button>
      <button type="button" onClick={() => select([])}>Disable all tools</button>
      <span>{advanced ? 'Advanced rules active' : `${tools.filter(t => selected(t.id)).length} / ${tools.length} selected`}</span>
    </div>
    {advanced && <p className="text-xs text-amber-300">Group or wildcard rules are configured below. Choose Enable all or Disable all to switch to individual selection.</p>}
    <input aria-label="Search tools" placeholder="Search tools…" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded bg-slate-900 p-2 text-xs" />
    {status && <p role="status" className="text-xs">{status} <button type="button" onClick={() => {setStatus('Loading available tools…');setRetry(v => v + 1)}}>Retry</button></p>}
    <div className="max-h-80 space-y-3 overflow-y-auto">
      {groups.map(group => {
        const visible = group.tools.filter(t => `${t.id} ${t.label} ${t.description || ''}`.toLowerCase().includes(query.toLowerCase()))
        return visible.length ? <fieldset key={group.id} className="space-y-1">
          <legend className="text-xs font-semibold text-cyan-200">{group.label}</legend>
          {visible.map(tool => <label key={tool.id} className="flex items-start gap-2 rounded bg-white/[0.03] p-2 text-xs">
            <input type="checkbox" disabled={advanced} checked={!advanced && selected(tool.id)} onChange={e => {
              const ids = new Set([...tools.filter(t => selected(t.id)).map(t => t.id), ...allowed.filter(id => id !== '*')])
              for (const id of denied) ids.delete(id)
              if (e.target.checked) ids.add(tool.id); else ids.delete(tool.id)
              select([...ids])
            }} />
            <span><span className="font-semibold">{tool.label}</span> <code className="text-slate-500">{tool.id}</code><span className="block text-slate-400">{tool.description}</span></span>
          </label>)}
        </fieldset> : null
      })}
    </div>
  </section>
}

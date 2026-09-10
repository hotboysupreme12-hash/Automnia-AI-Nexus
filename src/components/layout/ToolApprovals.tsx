import { useEffect, useState } from 'react'
import { apiRequest, apiErrorMessage } from '../../api/client'
import { useNexusStore } from '../../store/nexusStore'

type Approval = { id: string; expiresAtMs: number; request: { agentId?: string; command?: string; cwd?: string } }

export function ToolApprovals() {
  const [pending, setPending] = useState<Approval[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const agents = useNexusStore((s) => s.agents)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const result = await apiRequest<{ pending: Approval[] }>('/api/tool-approvals', { timeoutMs: 5000 })
      if (stopped) return
      if (result.ok) setPending(result.data.pending.filter((item) => item.expiresAtMs > Date.now()))
      timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])
  const current = pending[0]
  if (!current) return null
  const resolve = async (decision: 'allow-once' | 'allow-always' | 'deny', full = false) => {
    setBusy(true)
    setError('')
    try {
      if (full && current.request.agentId) {
        const access = await apiRequest(`/api/party/agent/${encodeURIComponent(current.request.agentId)}/tool-access`, { method: 'POST', body: { mode: 'full' } })
        if (!access.ok) throw new Error(apiErrorMessage(access.error))
      }
      const result = await apiRequest(`/api/tool-approvals/${encodeURIComponent(current.id)}/resolve`, { method: 'POST', body: { decision } })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      setPending((items) => items.filter((item) => item.id !== current.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Try request again.') }
    finally { setBusy(false) }
  }
  const name = agents.find((agent) => agent.id === current.request.agentId)?.name || current.request.agentId || 'Agent'
  return <section role="region" aria-label="Tool approval" className="fixed bottom-6 right-6 z-[100] max-w-lg rounded-xl border border-cyan-400/40 bg-slate-950 p-5 text-slate-100 shadow-xl">
    <h2 className="font-bold">{name} requests command access</h2>
    <pre className="my-3 max-h-48 overflow-auto whitespace-pre-wrap break-all text-sm">{current.request.command || 'Command execution'}</pre>
    {current.request.cwd && <p className="mb-3 break-all text-sm">Folder: {current.request.cwd}</p>}
    <p className="mb-3 text-sm">Approve this command, remember it, or grant this agent full command access without future prompts.</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void resolve('allow-once')}>Allow once</button>
      <button disabled={busy} onClick={() => void resolve('allow-always')}>Always allow command</button>
      {current.request.agentId && <button disabled={busy} onClick={() => void resolve('allow-once', true)}>Full access</button>}
      <button disabled={busy} onClick={() => void resolve('deny')}>Deny</button>
    </div>
    {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
  </section>
}

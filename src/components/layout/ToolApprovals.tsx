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
  return <section role="region" aria-label="Tool approval" className="fixed bottom-6 right-6 z-[100] w-[min(31rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]/95 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl">
    <div className="border-b border-white/[0.07] bg-gradient-to-r from-cyan-400/[0.10] to-blue-500/[0.04] px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300"><span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9]" /> Approval required</div>
      <h2 className="text-lg font-bold tracking-tight">{name} needs command access</h2>
      <p className="mt-1 text-xs text-slate-400">This agent is set to Ask for approval.</p>
    </div>
    <div className="space-y-4 p-5">
      <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Requested command</div>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-sm leading-6 text-slate-200">{current.request.command || 'Command execution'}</pre>
      </div>
      {current.request.cwd && <p className="break-all text-xs text-slate-400"><span className="font-semibold text-slate-300">Working folder:</span> {current.request.cwd}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50" disabled={busy} onClick={() => void resolve('allow-once')}>Allow once</button>
        <button className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50" disabled={busy} onClick={() => void resolve('allow-always')}>Always allow command</button>
        {current.request.agentId && <button className="col-span-2 rounded-lg border border-cyan-300/30 bg-cyan-300/[0.08] px-3 py-2.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/[0.14] disabled:opacity-50" disabled={busy} onClick={() => void resolve('allow-once', true)}>Grant Full access for this agent</button>}
        <button className="col-span-2 rounded-lg border border-white/[0.07] px-3 py-2 text-xs text-slate-500 transition hover:border-red-300/30 hover:text-red-200 disabled:opacity-50" disabled={busy} onClick={() => void resolve('deny')}>Deny</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  </section>
}

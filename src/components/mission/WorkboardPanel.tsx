import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addWorkboardComment,
  createWorkboardTask,
  fetchWorkboardTasks,
  updateWorkboardTask,
  type WorkboardExecutionState,
  type WorkboardTask,
  type WorkboardTaskStatus,
} from '../../api/workboard'
import { apiErrorMessage, type ApiResult } from '../../api/client'

type WorkboardPanelProps = { missions: Array<{ id: string; title: string }> }

const statusLabel: Record<WorkboardTaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const executionStateBadgeLabel: Partial<Record<WorkboardExecutionState, string>> = {
  waiting_for_dependency: 'Waiting for dependency',
  waiting_for_review: 'Awaiting review',
  waiting_for_integration: 'Ready for integration',
  blocked: 'Blocked',
  break: 'On break',
  checkpointing: 'Checkpointing',
  recovering: 'Recovering',
  failed: 'Failed',
}

function leaseStatusSummary(task: WorkboardTask): { label: string; expired: boolean } | null {
  if (!task.leaseOwnerAgentId && !task.assignedAgentId) return null
  const owner = task.leaseOwnerAgentId || task.assignedAgentId
  if (!task.leaseExpiresAt) return { label: `Owner: ${owner}`, expired: false }
  const expiresMs = Date.parse(task.leaseExpiresAt)
  if (!Number.isFinite(expiresMs)) return { label: `Owner: ${owner}`, expired: false }
  const expired = expiresMs <= Date.now()
  return {
    label: expired
      ? `Lease expired (${owner} · ${new Date(expiresMs).toLocaleTimeString()})`
      : `Lease: ${owner} until ${new Date(expiresMs).toLocaleTimeString()}`,
    expired,
  }
}

export function WorkboardPanel({ missions }: WorkboardPanelProps) {
  const [tasks, setTasks] = useState<WorkboardTask[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [missionId, setMissionId] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, { body: string; evidence: string }>>({})
  const [dependencyDrafts, setDependencyDrafts] = useState<Record<string, string>>({})
  const [fileClaimDrafts, setFileClaimDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const missionNames = useMemo(() => new Map(missions.map((mission) => [mission.id, mission.title])), [missions])

  const refresh = useCallback(async () => {
    const result = await fetchWorkboardTasks()
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    setTasks(result.data.tasks || [])
  }, [])

  useEffect(() => {
    let active = true
    void fetchWorkboardTasks().then((result) => {
      if (!active) return
      if (!result.ok) setNotice(apiErrorMessage(result.error))
      else setTasks(result.data.tasks || [])
    }).catch((error) => { if (active) setNotice(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [])

  const runMutation = async (action: () => Promise<ApiResult<unknown>>, success: string): Promise<boolean> => {
    setBusy(true)
    setNotice('')
    try {
      const result = await action()
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      await refresh()
      setNotice(success)
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      return false
    } finally { setBusy(false) }
  }

  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    void runMutation(() => createWorkboardTask({ title, description, missionId: missionId || null }), 'Task added to Workboard.')
      .then((saved) => { if (saved) { setTitle(''); setDescription('') } })
  }

  const submitComment = (event: FormEvent, task: WorkboardTask) => {
    event.preventDefault()
    const draft = commentDrafts[task.id] || { body: '', evidence: '' }
    const evidence = draft.evidence.trim() ? [{ label: draft.evidence.trim(), uri: draft.evidence.trim() }] : []
    void runMutation(() => addWorkboardComment(task.id, { body: draft.body, evidence }), 'Comment and evidence saved.')
      .then((saved) => { if (saved) setCommentDrafts((current) => ({ ...current, [task.id]: { body: '', evidence: '' } })) })
  }

  const activeLeaseActor = (task: WorkboardTask) => {
    const info = leaseStatusSummary(task)
    return task.leaseOwnerAgentId && !info?.expired ? task.leaseOwnerAgentId : undefined
  }

  const setStatus = (task: WorkboardTask, status: WorkboardTaskStatus) => {
    const actorAgentId = activeLeaseActor(task)
    void runMutation(() => updateWorkboardTask(task.id, { status, actorAgentId }), `Task marked ${statusLabel[status].toLowerCase()}.`)
  }

  const renewHeartbeat = (task: WorkboardTask) => {
    const owner = task.leaseOwnerAgentId || task.assignedAgentId
    if (!owner) return
    void runMutation(() => updateWorkboardTask(task.id, { heartbeat: true, actorAgentId: owner }), `Lease renewed for ${owner}.`)
  }

  const releaseLease = (task: WorkboardTask) => {
    if (!task.leaseOwnerAgentId) return
    const owner = task.leaseOwnerAgentId
    void runMutation(
      () => updateWorkboardTask(task.id, { leaseOwnerAgentId: null, actorAgentId: owner }),
      `Released active lease for ${owner}.`,
    )
  }

  const acknowledgeHandoff = (task: WorkboardTask) => {
    if (!task.handoff || task.handoff.status !== 'pending') return
    const receiver = task.handoff.toAgentId
    void runMutation(
      () => updateWorkboardTask(task.id, { acknowledgeHandoff: true, actorAgentId: receiver }),
      `Handoff acknowledged by ${receiver}.`,
    )
  }

  const addClaimedFile = (task: WorkboardTask) => {
    const draft = (fileClaimDrafts[task.id] || '').trim()
    if (!draft) return
    const nextFiles = Array.from(new Set([...(task.claimedFiles || []), draft]))
    const actorAgentId = activeLeaseActor(task) || task.assignedAgentId || 'operator'
    void runMutation(() => updateWorkboardTask(task.id, { claimedFiles: nextFiles, actorAgentId }), 'Exclusive file lock claimed.')
      .then((saved) => { if (saved) setFileClaimDrafts((current) => ({ ...current, [task.id]: '' })) })
  }

  const releaseClaimedFile = (task: WorkboardTask, targetFile: string) => {
    const nextFiles = (task.claimedFiles || []).filter((entry) => entry !== targetFile)
    const actorAgentId = activeLeaseActor(task)
    void runMutation(() => updateWorkboardTask(task.id, { claimedFiles: nextFiles, actorAgentId }), `Released file lock on ${targetFile}.`)
  }

  const addDependency = (task: WorkboardTask) => {
    const dependency = dependencyDrafts[task.id]
    if (!dependency || task.dependsOn.includes(dependency)) return
    const actorAgentId = activeLeaseActor(task)
    void runMutation(() => updateWorkboardTask(task.id, { dependsOn: [...task.dependsOn, dependency], actorAgentId }), 'Prerequisite added.')
  }

  return (
    <section className="dui-card mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4 sm:p-5" aria-labelledby="openclaw-workboard-title">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/70">OpenClaw coordination</span><h3 id="openclaw-workboard-title" className="mt-1 text-lg font-semibold text-white">Workboard</h3><p className="mt-1 text-xs text-slate-400">Durable task cards linked to Automnia missions, with renewable agent leases, exclusive file locks, prerequisites, and append-only evidence notes.</p></div>
        <button type="button" onClick={() => void refresh().catch((error) => setNotice(error instanceof Error ? error.message : String(error)))} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">Refresh</button>
      </header>

      <form onSubmit={submitTask} className="mb-4 grid gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-3 md:grid-cols-[1fr_1fr_auto]">
        <input aria-label="Workboard task title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Task title" className="min-w-0 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white" required />
        <select aria-label="Link to Automnia mission" value={missionId} onChange={(event) => setMissionId(event.target.value)} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white">
          <option value="">No mission linked</option>
          {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title}</option>)}
        </select>
        <button type="submit" disabled={busy || !title.trim()} className="rounded-lg bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-40">Add task</button>
        <textarea aria-label="Workboard task description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} placeholder="Outcome, acceptance criteria, or handoff details" className="min-h-16 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white md:col-span-3" />
      </form>

      {notice && <p role="status" className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200">{notice}</p>}
      {!tasks.length ? <p className="py-4 text-sm text-slate-400">No Workboard tasks yet.</p> : <ul className="grid gap-3 lg:grid-cols-2">
        {tasks.map((task) => {
          const prerequisites = task.dependsOn.map((id) => tasks.find((candidate) => candidate.id === id)).filter((candidate): candidate is WorkboardTask => Boolean(candidate))
          const blockedBy = prerequisites.filter((candidate) => candidate.status !== 'completed')
          const possibleDependencies = tasks.filter((candidate) => candidate.id !== task.id && !task.dependsOn.includes(candidate.id) && candidate.status !== 'cancelled')
          const leaseInfo = leaseStatusSummary(task)
          const claimedFiles = task.claimedFiles || []
          const isTerminal = task.status === 'completed' || task.status === 'cancelled'
          const execBadge = task.executionState ? executionStateBadgeLabel[task.executionState] : undefined
          return <li key={task.id} className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="break-words font-semibold text-slate-100">{task.title}</h4>
                <p className="mt-1 text-xs text-slate-400">
                  {task.missionId ? `Mission: ${missionNames.get(task.missionId) || task.missionId}` : 'Unlinked task'} · {statusLabel[task.status]}
                  {execBadge ? ` · ${execBadge}` : ''}
                </p>
                {leaseInfo && (
                  <p className={`mt-1 text-[11px] font-medium ${leaseInfo.expired ? 'text-amber-300' : 'text-cyan-200/90'}`}>
                    {leaseInfo.label}
                  </p>
                )}
                {task.waitingDependency && (
                  <p className="mt-1 text-[11px] text-amber-200">
                    Waiting on {task.waitingDependency.dependencyTaskId}: {task.waitingDependency.deliverable}
                  </p>
                )}
                {task.handoff && (
                  <p className="mt-1 text-[11px] text-indigo-200">
                    Handoff {task.handoff.fromAgentId} → {task.handoff.toAgentId} ({task.handoff.status}): {task.handoff.nextAction}
                  </p>
                )}
                {task.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{task.description}</p>}
              </div>
              <span className="shrink-0 rounded-full border border-cyan-200/15 px-2 py-1 text-[10px] text-cyan-100">{task.comments.length} notes</span>
            </div>
            {claimedFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`Claimed files for ${task.title}`}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Locked files:</span>
                {claimedFiles.map((filePath) => (
                  <span key={filePath} className="inline-flex items-center gap-1 rounded border border-cyan-200/20 bg-cyan-950/30 px-1.5 py-0.5 font-mono text-[10px] text-cyan-100">
                    <span className="max-w-[220px] truncate">{filePath}</span>
                    {!isTerminal && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => releaseClaimedFile(task, filePath)}
                        aria-label={`Release file lock ${filePath}`}
                        className="ml-0.5 text-slate-400 hover:text-white disabled:opacity-40"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {prerequisites.length > 0 && <p className="mt-2 text-xs text-slate-400">Prerequisites: {prerequisites.map((entry) => `${entry.title} (${statusLabel[entry.status]})`).join(', ')}</p>}
            {blockedBy.length > 0 && <p className="mt-2 text-xs text-amber-200">Waiting for {blockedBy.length} prerequisite task{blockedBy.length === 1 ? '' : 's'}.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {task.status === 'open' && <button type="button" disabled={busy || blockedBy.length > 0} onClick={() => setStatus(task, 'in_progress')} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40">Start</button>}
              {task.status === 'in_progress' && <button type="button" disabled={busy || blockedBy.length > 0} onClick={() => setStatus(task, 'completed')} className="rounded-lg border border-emerald-200/20 px-2.5 py-1.5 text-xs text-emerald-100 disabled:opacity-40">Complete</button>}
              {!isTerminal && task.handoff?.status === 'pending' && (
                <button type="button" disabled={busy} onClick={() => acknowledgeHandoff(task)} className="rounded-lg border border-indigo-200/25 px-2.5 py-1.5 text-xs text-indigo-100 disabled:opacity-40">Acknowledge handoff</button>
              )}
              {!isTerminal && (task.leaseOwnerAgentId || task.assignedAgentId) && (
                <button type="button" disabled={busy} onClick={() => renewHeartbeat(task)} className="rounded-lg border border-cyan-200/20 px-2.5 py-1.5 text-xs text-cyan-100 disabled:opacity-40">Renew lease</button>
              )}
              {!isTerminal && task.leaseOwnerAgentId && !leaseInfo?.expired && (
                <button type="button" disabled={busy} onClick={() => releaseLease(task)} className="rounded-lg border border-amber-200/20 px-2.5 py-1.5 text-xs text-amber-100 disabled:opacity-40">Release lease</button>
              )}
              {!isTerminal && <button type="button" disabled={busy} onClick={() => setStatus(task, 'cancelled')} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 disabled:opacity-40">Cancel</button>}
            </div>
            <details className="mt-3 border-t border-white/[0.06] pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-100">Coordination notes, file locks & prerequisites</summary>
              <form onSubmit={(event) => submitComment(event, task)} className="mt-3 grid gap-2">
                <textarea aria-label={`Comment on ${task.title}`} value={commentDrafts[task.id]?.body || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [task.id]: { ...current[task.id], body: event.target.value, evidence: current[task.id]?.evidence || '' } }))} maxLength={4000} placeholder="Add a coordination note" className="min-h-16 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white" />
                <input aria-label={`Evidence link for ${task.title}`} value={commentDrafts[task.id]?.evidence || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [task.id]: { ...current[task.id], evidence: event.target.value, body: current[task.id]?.body || '' } }))} placeholder="Evidence URL or /api/files/... link (optional)" className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white" />
                <button type="submit" disabled={busy || !(commentDrafts[task.id]?.body || '').trim()} className="justify-self-start rounded-lg border border-cyan-200/20 px-3 py-1.5 text-xs font-semibold text-cyan-50 disabled:opacity-40">Append note</button>
              </form>
              {!isTerminal && (
                <div className="mt-3 flex gap-2">
                  <input
                    aria-label={`Claim file path for ${task.title}`}
                    value={fileClaimDrafts[task.id] || ''}
                    onChange={(event) => setFileClaimDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                    maxLength={320}
                    placeholder="Claim relative file path (e.g. server/index.ts)"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 font-mono text-xs text-white"
                  />
                  <button type="button" disabled={busy || !(fileClaimDrafts[task.id] || '').trim()} onClick={() => addClaimedFile(task)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40">Lock file</button>
                </div>
              )}
              {possibleDependencies.length > 0 && <div className="mt-3 flex gap-2"><select aria-label={`Prerequisite for ${task.title}`} value={dependencyDrafts[task.id] || ''} onChange={(event) => setDependencyDrafts((current) => ({ ...current, [task.id]: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-xs text-white"><option value="">Add prerequisite…</option>{possibleDependencies.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select><button type="button" disabled={busy || !dependencyDrafts[task.id]} onClick={() => addDependency(task)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40">Add</button></div>}
              <ol className="mt-3 grid gap-2">{task.comments.map((comment) => <li key={comment.id} className="rounded-lg bg-white/[0.025] p-2"><p className="whitespace-pre-wrap text-xs text-slate-200">{comment.body}</p><p className="mt-1 text-[10px] text-slate-500">{comment.actor} · {new Date(comment.createdAt).toLocaleString()}</p>{comment.evidence.map((item) => <a key={item.uri} href={item.uri} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[10px] text-cyan-200 underline">{item.label}</a>)}</li>)}</ol>
            </details>
          </li>
        })}
      </ul>}
    </section>
  )
}

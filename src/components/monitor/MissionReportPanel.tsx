import { BookmarkButton, Bookmarks } from '../bookmarks/Bookmarks'
import { useRememberedState } from '../../hooks/useRememberedState'
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../common/Panel'
import { useNexusStore } from '../../store/nexusStore'
import { apiErrorMessage, apiRequest } from '../../api/client'
import type { MissionReport, MissionRun } from '../../types/nexus'
import { missionDraftFromRecord } from '../../store/missionTemplateState'
import { sanitizePartyIds } from '../../store/agentConfigState'

const COLLABORATION_LABELS: Record<string, string> = { hierarchical: 'Command', parallel: 'Parallel', specialist: 'Specialist', sequential: 'Relay', swarm: 'Swarm' }
const SOURCE_LABELS: Record<string, string> = { 'runtime-responses': 'Agent runtime responses', 'mission-feed': 'Mission activity', mixed: 'Runtime responses and mission activity', none: 'No runtime evidence captured' }

function timestamp(value?: string | null): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString()
}

function Metric({ label, value, score, hint }: { label: string; value: number | null; score?: boolean; hint: string }) {
  const available = typeof value === 'number' && Number.isFinite(value)
  return <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/55 p-3" title={hint}>
    <dt className="text-sm text-slate-300">{label}</dt>
    <dd className="mt-1 text-lg font-semibold text-slate-100">{available ? `${value.toLocaleString()}${score ? ' / 100' : ''}` : 'Not measured'}</dd>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>
  </div>
}

function EvidenceIdentifiers({ label, values, onCopy }: { label: string; values?: string[]; onCopy: (value: string) => void }) {
  const ids = [...new Set((values || []).filter(Boolean))]
  return <details className="rounded-lg border border-white/10 p-3">
    <summary className="cursor-pointer text-sm text-slate-200">{label} · {ids.length}</summary>
    {ids.length ? <ul className="mt-2 space-y-2">{ids.map((id) => <li key={id} className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 break-all text-xs text-slate-300">{id}</code>
      <button type="button" className="shrink-0 rounded border border-white/15 px-2 py-1 text-xs text-cyan-100" aria-label={`Copy ${label} identifier ${id}`} onClick={() => onCopy(id)}>Copy</button>
    </li>)}</ul> : <p className="mt-2 text-xs text-slate-400">No identifiers recorded.</p>}
  </details>
}

export function MissionReportPanel() {
  const missionReports = useNexusStore((state) => state.missionReports)
  const missionHistory = useNexusStore((state) => state.missionHistory)
  const activeMission = useNexusStore((state) => state.activeMission)
  const agents = useNexusStore((state) => state.agents)
  const [selectedMissionId, setSelectedMissionId] = useRememberedState('report-mission', '')
  const [fetchedReports, setFetchedReports] = useState<Record<string, MissionReport>>({})
  const [loadState, setLoadState] = useState<{ missionId: string; error?: string }>({ missionId: '' })
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [copyNotice, setCopyNotice] = useState('')
  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const missionsById = useMemo(() => {
    const entries = new Map<string, MissionRun>()
    for (const mission of missionHistory) entries.set(mission.id, mission)
    if (activeMission) entries.set(activeMission.id, activeMission)
    return entries
  }, [activeMission, missionHistory])
  const reportMissionIds = useMemo(() => [...new Set([...missionReports.map((report) => report.missionId), ...missionHistory.map((mission) => mission.id)])], [missionHistory, missionReports])
  const effectiveMissionId = reportMissionIds.includes(selectedMissionId) ? selectedMissionId : reportMissionIds[0] || ''
  const report = missionReports.find((entry) => entry.missionId === effectiveMissionId) || fetchedReports[effectiveMissionId]
  const mission = missionsById.get(effectiveMissionId)
  const hasReport = Boolean(report)
  const evidence = report?.evidence

  useEffect(() => {
    if (!effectiveMissionId || hasReport) return
    const controller = new AbortController()
    void apiRequest<{ report: MissionReport }>(`/api/missions/${encodeURIComponent(effectiveMissionId)}/report`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setLoadState({ missionId: effectiveMissionId, error: result.status === 404 ? 'No retained report is available for this mission yet.' : apiErrorMessage(result.error) })
          return
        }
        if (!result.data.report || result.data.report.missionId !== effectiveMissionId) {
          setLoadState({ missionId: effectiveMissionId, error: 'The returned report did not match this mission. Retry to refresh it.' })
          return
        }
        setFetchedReports((current) => ({ ...current, [effectiveMissionId]: result.data.report }))
        setLoadState({ missionId: effectiveMissionId })
      })
    return () => controller.abort()
  }, [effectiveMissionId, hasReport, retryAttempt])

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopyNotice('Copied to clipboard.') }
    catch { setCopyNotice('Could not access the clipboard. Select the visible text to copy it.') }
  }
  const downloadReport = () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ mission: mission || null, report }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mission-report-${report.missionId.replace(/[^a-z0-9_-]/gi, '-')}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <Panel title="Mission Report" className="min-h-[280px]" panelId="mission-report">
    {reportMissionIds.length > 0 && <label className="mb-4 block text-sm text-slate-300">
      Choose a mission
      <select className="mt-2 w-full min-w-0 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-slate-100" value={effectiveMissionId} onChange={(event) => { setSelectedMissionId(event.target.value); setCopyNotice('') }}>
        {reportMissionIds.map((id) => <option key={id} value={id}>{missionsById.get(id)?.title || id}</option>)}
      </select>
    </label>}
    {report ? <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-slate-100">{mission?.title || 'Mission report'}</h3>
          <p className="mt-1 text-sm capitalize text-slate-300">{mission?.status || 'Recorded'} · {COLLABORATION_LABELS[mission?.collaborationMode || ''] || 'Mission'}</p>
          <p className="mt-1 text-xs text-slate-400">Generated {timestamp(report.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!mission || activeMission?.status === 'running'} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-100 disabled:opacity-40" onClick={() => {
            const current = useNexusStore.getState()
            const draft = missionDraftFromRecord(mission)
            if (!draft || !mission || current.activeMission?.status === 'running' || current.missionLaunchPending) return
            const party = sanitizePartyIds(mission.selectedAgents, current.agents)
            useNexusStore.setState({ missionDraft: draft, activePartyIds: party, confirmedPartyIds: [], selectedAgentId: null, selectedAgentIds: [], tab: 'missions' })
          }}>Use as a new mission</button>
          <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-100" onClick={downloadReport}>Download report</button>
          <BookmarkButton kind="mission" sourceId={report.missionId} title={mission?.title || 'Mission report'} text={JSON.stringify({ mission: mission || null, report }, null, 2)} />
          <Bookmarks />
        </div>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Efficiency" value={report.efficiencyRating} score hint="Estimated score from successful runs, reduced by failures and recovery attempts. Higher is better." />
        <Metric label="Scheduler stability" value={report.heartbeatStabilityScore} score hint="Estimated scheduler score reduced by cancellations, timeouts, retries and fallbacks. No score without scheduler evidence." />
        <Metric label="Runtime efficiency" value={report.runtimeEfficiency} score hint="Estimated successful-run score, reduced by retries and command/tool failures. Higher is better." />
        <Metric label="Recorded errors" value={report.errors} hint="Recorded run, verification, tool and command failures. Categories may overlap." />
        <Metric label="Soul drift" value={report.soulDrift} hint="No drift measurement is currently supplied by the mission runtime." />
        <Metric label="XP gained" value={report.xpGained} hint="No experience-point measurement is currently supplied by the mission runtime." />
      </dl>
      <p className="text-sm text-slate-300">Skill unlocks: {report.skillUnlocks.length ? report.skillUnlocks.join(', ') : 'None recorded'}</p>
      {evidence && <section className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <h4 className="font-semibold text-slate-100">Evidence source: {SOURCE_LABELS[evidence.source] || evidence.source}</h4>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([['Accepted', evidence.acceptedRuns], ['Started', evidence.startedRuns], ['Completed', evidence.completedRuns], ['Failed', evidence.failedRuns], ['Cancelled', evidence.cancelledRuns], ['Timed out', evidence.timedOutRuns], ['Retries', evidence.retryCount], ['Verification failures', evidence.verificationFailures]] as Array<[string, number]>).map(([label, value]) => <div key={label}><dt className="text-slate-400">{label}</dt><dd className="font-semibold text-slate-100">{value}</dd></div>)}
        </dl>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <EvidenceIdentifiers label="Runtime runs" values={evidence.runtimeRunIds} onCopy={(value) => void copy(value)} />
          <EvidenceIdentifiers label="Cron runs" values={evidence.cronRunIds} onCopy={(value) => void copy(value)} />
          <EvidenceIdentifiers label="Sessions" values={evidence.sessionIds} onCopy={(value) => void copy(value)} />
        </div>
      </section>}
    </div> : effectiveMissionId ? <div role="status" className="rounded-lg border border-white/10 p-4 text-sm text-slate-300">
      {loadState.missionId === effectiveMissionId && loadState.error ? <><p>{loadState.error}</p><button type="button" onClick={() => { setLoadState({ missionId: effectiveMissionId }); setRetryAttempt((value) => value + 1) }} className="mt-3 rounded border border-white/15 px-3 py-2">Retry report</button></> : 'Loading this mission’s report…'}
    </div> : <p className="text-slate-300">No completed missions yet. Reports appear here after a mission finishes.</p>}
    {copyNotice && <p className="mt-2 text-xs text-slate-300" role="status">{copyNotice}</p>}
    <h3 className="mt-5 text-lg font-semibold text-slate-100">Mission History</h3>
    <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-white/10 bg-slate-950/60">
      {missionHistory.length ? missionHistory.map((entry) => <button type="button" key={entry.id} aria-pressed={effectiveMissionId === entry.id} onClick={() => { setSelectedMissionId(entry.id); setCopyNotice('') }} className="block w-full border-b border-white/10 px-3 py-3 text-left text-slate-100 last:border-b-0 hover:bg-white/5 aria-pressed:bg-cyan-300/10">
        <span className="block break-words font-semibold">{entry.title}</span>
        <span className="mt-1 block text-sm text-slate-300">{entry.status} · {COLLABORATION_LABELS[entry.collaborationMode] || entry.collaborationMode} · {entry.selectedAgents.map((id) => agentNames.get(id) || `Unavailable agent (${id})`).join(', ')}</span>
        <span className="mt-1 block text-xs text-slate-400">{timestamp(entry.endedAt || entry.startedAt)}</span><span className="mt-1 block break-all text-xs text-slate-500">Agent IDs: {entry.selectedAgents.join(', ') || 'None recorded'}</span>
      </button>) : <p className="px-3 py-3 text-sm text-slate-400">No history available.</p>}
    </div>
  </Panel>
}

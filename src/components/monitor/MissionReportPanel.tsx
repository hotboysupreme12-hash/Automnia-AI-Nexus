import { Panel } from '../common/Panel'
import { useNexusStore } from '../../store/nexusStore'

function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? 'Unavailable' : `${value}${suffix}`
}

function shortIds(values?: string[]): string {
  const ids = (values || []).filter(Boolean)
  return ids.length ? ids.map((id) => id.length > 16 ? `${id.slice(0, 12)}...` : id).join(', ') : 'none'
}

export function MissionReportPanel() {
  const missionReports = useNexusStore((state) => state.missionReports)
  const missionHistory = useNexusStore((state) => state.missionHistory)

  const latest = missionReports[0]
  const evidence = latest?.evidence

  return (
    <Panel title="Mission Report" className="min-h-[280px]">
      {latest ? (
        <div className="grid gap-3">
          <div className="grid gap-2 text-slate-100 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">Efficiency: {formatMetric(latest.efficiencyRating)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">Soul Drift: {formatMetric(latest.soulDrift)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">Scheduler Stability: {formatMetric(latest.heartbeatStabilityScore)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">Runtime Efficiency: {formatMetric(latest.runtimeEfficiency)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">Errors: {formatMetric(latest.errors)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2">XP Gained: {formatMetric(latest.xpGained)}</div>
            <div className="rounded border border-white/10 bg-slate-950/55 p-2 sm:col-span-2 lg:col-span-2">
              Skill Unlocks: {latest.skillUnlocks.length ? latest.skillUnlocks.join(', ') : 'none'}
            </div>
          </div>
          {evidence && (
            <div className="rounded border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-200">
              <p className="font-semibold text-slate-100">Evidence source: {evidence.source}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <span>Accepted: {evidence.acceptedRuns}</span>
                <span>Started: {evidence.startedRuns}</span>
                <span>Completed: {evidence.completedRuns}</span>
                <span>Failed: {evidence.failedRuns}</span>
                <span>Cancelled: {evidence.cancelledRuns}</span>
                <span>Timed out: {evidence.timedOutRuns}</span>
                <span>Retries: {evidence.retryCount}</span>
                <span>Verification failures: {evidence.verificationFailures}</span>
                <span>Runtime runs: {shortIds(evidence.runtimeRunIds)}</span>
                <span>Cron runs: {shortIds(evidence.cronRunIds)}</span>
                <span>Sessions: {shortIds(evidence.sessionIds)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-slate-200">No completed missions yet.</p>
      )}

      <h3 className="mt-4 font-heading text-2xl text-slate-100">Mission History</h3>
      <div className="mt-2 max-h-44 overflow-auto rounded border border-white/10 bg-slate-950/60">
        {missionHistory.length ? (
          missionHistory.map((mission) => (
            <div key={mission.id} className="border-b border-white/10 px-3 py-2 text-slate-100 last:border-b-0">
              <p className="font-semibold">{mission.title}</p>
              <p className="text-sm text-slate-300">
                {mission.status} | {mission.collaborationMode} | {mission.selectedAgents.join(', ')}
              </p>
            </div>
          ))
        ) : (
          <p className="px-3 py-2 text-slate-300">No history available.</p>
        )}
      </div>
    </Panel>
  )
}

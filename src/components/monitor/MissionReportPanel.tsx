import { Panel } from '../common/Panel'
import { useNexusStore } from '../../store/nexusStore'

export function MissionReportPanel() {
  const missionReports = useNexusStore((state) => state.missionReports)
  const missionHistory = useNexusStore((state) => state.missionHistory)

  const latest = missionReports[0]

  return (
    <Panel title="Mission Report" className="min-h-[280px]">
      {latest ? (
        <div className="grid gap-2 text-slate-100 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">Efficiency: {latest.efficiencyRating}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">Soul Drift: {latest.soulDrift}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">Scheduler Stability: {latest.heartbeatStabilityScore}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">Runtime Efficiency: {latest.runtimeEfficiency}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">Errors: {latest.errors}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2">XP Gained: {latest.xpGained}</div>
          <div className="rounded border border-white/10 bg-slate-950/55 p-2 sm:col-span-2 lg:col-span-2">
            Skill Unlocks: {latest.skillUnlocks.length ? latest.skillUnlocks.join(', ') : 'none'}
          </div>
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

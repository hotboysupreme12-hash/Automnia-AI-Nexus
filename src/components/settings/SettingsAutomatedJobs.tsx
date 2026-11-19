import { useMemo } from 'react'
import { useRuntimeCronJobs, type RuntimeCronJob } from '../../hooks/useRuntimeStatus'
import { useNexusStore } from '../../store/nexusStore'

function formatSchedule(job: RuntimeCronJob) {
  return job.scheduleLabel || job.every || 'Schedule unavailable'
}

function formatNextRun(job: RuntimeCronJob) {
  const timestamp = job.nextRunAt
  if (!timestamp) return 'Not scheduled'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function statusLabel(job: RuntimeCronJob) {
  const value = job.status?.trim().toLowerCase()
  if (value === 'failed' || value === 'error') return 'Needs attention'
  if (value === 'paused') return 'Paused'
  if (value === 'completed' || value === 'complete') return 'Complete'
  return 'Active'
}

export function SettingsAutomatedJobs() {
  const agents = useNexusStore((state) => state.agents)
  const { jobs, error, loading, ready, refresh } = useRuntimeCronJobs(8_000)
  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])

  return (
    <div className="dui-settings-jobs" data-settings-automated-jobs="true">
      <div className="dui-settings-jobs__toolbar">
        <div>
          <strong>{error ? (jobs.length ? 'Last known scheduler snapshot' : 'Scheduler unavailable') : `${jobs.length} scheduled job${jobs.length === 1 ? '' : 's'}`}</strong>
          <small>{error && jobs.length ? 'Showing the last successful response' : ready ? 'Live OpenClaw scheduler state' : 'Reading the OpenClaw scheduler…'}</small>
        </div>
        <button type="button" className="dui-settings-jobs__refresh" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="dui-settings-jobs__notice" role="alert">
          Could not refresh the scheduler. Showing the last successful response when available.
        </div>
      )}

      {!jobs.length && !error && (
        <div className="dui-settings-jobs__empty">
          <strong>{loading ? 'Loading active jobs…' : 'No active cron jobs'}</strong>
          <span>Enabled OpenClaw automations will appear here as soon as they are scheduled.</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="dui-settings-jobs__list" role="list" aria-label="Active cron jobs">
          {jobs.map((job) => {
            const owner = agentNames.get(job.agent) || job.agent || 'Default agent'
            return (
              <article key={job.cronId || job.id} className="dui-settings-job" role="listitem" data-job-id={job.cronId}>
                <div className="dui-settings-job__head">
                  <div>
                    <strong>{job.name || 'OpenClaw cron job'}</strong>
                    <span>{owner} · {job.source === 'control-center' ? 'Automnia schedule' : job.source === 'system-cron' ? 'System crontab' : 'OpenClaw schedule'}</span>
                  </div>
                  <b data-state={job.status || 'active'}>{statusLabel(job)}</b>
                </div>
                <dl className="dui-settings-job__meta">
                  <div><dt>Schedule</dt><dd>{formatSchedule(job)}</dd></div>
                  <div><dt>Next run</dt><dd>{formatNextRun(job)}</dd></div>
                </dl>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

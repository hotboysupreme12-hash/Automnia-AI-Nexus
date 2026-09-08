import { useEffect, useState } from 'react'
import { runtimeSnapshotAgeMs, type RuntimeStatus } from '../../hooks/useRuntimeStatus'

export function RuntimeFreshness({ status, error, onRefresh }: { status: RuntimeStatus | null; error: string; onRefresh: () => void }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const visible = () => {
      clearInterval(timer)
      if (document.hidden) return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 15_000)
    }
    document.addEventListener('visibilitychange', visible)
    visible()
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [])
  if (!status) return null
  const age = runtimeSnapshotAgeMs(status, now)
  const stale = Boolean(error) || age > 30_000
  const elapsed = !Number.isFinite(age) ? 'time unknown' : age < 5000 ? 'just now' : age < 60_000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60_000)}m ago`
  return <button type="button" onClick={onRefresh} className={`min-h-8 rounded px-2 text-xs tabular-nums ${stale ? 'text-amber-200' : 'text-slate-400'}`}
    title="Time of the last runtime snapshot. Activate to refresh." aria-label={`Runtime data ${stale ? 'may be outdated' : 'updated'} ${elapsed}. Refresh runtime status.`}>
    {stale ? 'Cached data' : 'Updated'} · {elapsed}
  </button>
}

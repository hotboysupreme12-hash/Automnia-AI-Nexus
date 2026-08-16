import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorMessage, apiRequest } from '../api/client'
import type { GatewayLogEntry } from './useRuntimeStatus'
import { getRuntimeMonitorClearGeneration, useRuntimeMonitorClearCutoffMs } from './runtimeMonitorClear'

export type GatewayActivityFeed = {
  generatedAt: string
  storage: 'durable-ledger'
  entries: GatewayLogEntry[]
}

type GatewayActivityFeedSnapshot = {
  feed: GatewayActivityFeed | null
  error: string
}

function feedKey(feed: GatewayActivityFeed) {
  return feed.entries.map((entry) => [
    entry.id,
    entry.timestamp,
    entry.stream,
    entry.message,
    entry.level || '',
    entry.source || '',
    entry.channel || '',
    entry.direction || '',
  ].join('|')).join('^')
}

/**
 * Lightweight Settings-only feed. It avoids the general runtime-status
 * subscription so opening Logs cannot trigger Gateway diagnostics or log-tail
 * scans. The screen only updates React when the durable event rows change.
 */
export function useGatewayActivityFeed(intervalMs = 3_000, limit = 48) {
  const clearCutoffMs = useRuntimeMonitorClearCutoffMs()
  const [snapshot, setSnapshot] = useState<GatewayActivityFeedSnapshot>({ feed: null, error: '' })
  const inFlight = useRef(false)
  const latestKey = useRef('')

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    const requestClearGeneration = getRuntimeMonitorClearGeneration()
    inFlight.current = true
    try {
      const result = await apiRequest<GatewayActivityFeed>(`/api/openclaw/runtime/activity?limit=${Math.max(1, Math.min(100, Math.round(limit)))}`, {
        cache: 'no-store',
        timeoutMs: 3_500,
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      if (requestClearGeneration !== getRuntimeMonitorClearGeneration()) return

      const nextKey = feedKey(result.data)
      setSnapshot((previous) => {
        const feedUnchanged = previous.feed !== null && latestKey.current === nextKey
        latestKey.current = nextKey
        return feedUnchanged && !previous.error ? previous : { feed: result.data, error: '' }
      })
    } catch (error) {
      if (requestClearGeneration !== getRuntimeMonitorClearGeneration()) return
      const message = error instanceof Error ? error.message : String(error)
      setSnapshot((previous) => previous.error === message ? previous : { ...previous, error: message })
    } finally {
      inFlight.current = false
    }
  }, [limit])

  useEffect(() => {
    latestKey.current = ''
    setSnapshot({ feed: null, error: '' })
  }, [clearCutoffMs])

  useEffect(() => {
    let disposed = false
    const refreshWhenVisible = () => {
      if (disposed || document.hidden) return
      void refresh()
    }

    refreshWhenVisible()
    const timer = window.setInterval(refreshWhenVisible, Math.max(1_000, intervalMs))
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [intervalMs, refresh])

  return { feed: snapshot.feed, error: snapshot.error, refresh }
}

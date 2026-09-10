import { useCallback, useEffect, useRef, useState } from 'react'
import { reconcileGatewayActivityFeed, type GatewayActivityFeedSnapshot } from './gatewayActivityFeedState'
import { apiErrorMessage, apiRequest } from '../api/client'
import type { GatewayLogEntry } from './useRuntimeStatus'
import { getRuntimeMonitorClearGeneration, useRuntimeMonitorClearCutoffMs } from './runtimeMonitorClear'

export type GatewayActivityFeed = {
  generatedAt: string
  storage: 'durable-ledger'
  entries: GatewayLogEntry[]
}

/**
 * Lightweight Settings-only feed. It avoids the general runtime-status
 * subscription so opening Logs cannot trigger Gateway diagnostics or log-tail
 * scans. The screen only updates React when the durable event rows change.
 */
export function useGatewayActivityFeed(intervalMs = 3_000, limit = 48) {
  const clearCutoffMs = useRuntimeMonitorClearCutoffMs()
  const [snapshot, setSnapshot] = useState<GatewayActivityFeedSnapshot>({ feed: null, error: '' })
  const inFlight = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    const requestClearGeneration = getRuntimeMonitorClearGeneration()
    const controller = new AbortController()
    inFlight.current = controller
    try {
      const result = await apiRequest<GatewayActivityFeed>(`/api/openclaw/runtime/activity?limit=${Math.max(1, Math.min(100, Math.round(limit)))}`, {
        cache: 'no-store',
        timeoutMs: 3_500,
        signal: controller.signal,
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      if (controller.signal.aborted || requestClearGeneration !== getRuntimeMonitorClearGeneration()) return

      setSnapshot((previous) => reconcileGatewayActivityFeed(previous, result.data))
    } catch (error) {
      if (controller.signal.aborted || requestClearGeneration !== getRuntimeMonitorClearGeneration()) return
      const message = error instanceof Error ? error.message : String(error)
      setSnapshot((previous) => previous.error === message ? previous : { ...previous, error: message })
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [limit])

  useEffect(() => {
    setSnapshot({ feed: null, error: '' })
  }, [clearCutoffMs])

  useEffect(() => {
    let disposed = false
    const refreshWhenVisible = () => {
      if (disposed || document.hidden || !document.hasFocus()) return
      void refresh()
    }

    refreshWhenVisible()
    const timer = window.setInterval(refreshWhenVisible, Math.max(1_000, intervalMs))
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      disposed = true
      inFlight.current?.abort()
      inFlight.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [intervalMs, refresh, clearCutoffMs])

  return { feed: snapshot.feed, error: snapshot.error, refresh }
}

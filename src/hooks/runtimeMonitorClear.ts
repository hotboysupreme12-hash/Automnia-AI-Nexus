import { useSyncExternalStore } from 'react'

const RUNTIME_MONITOR_CLEAR_STORAGE_KEY = 'automnia:runtime-monitor-cleared-at'

function readPersistedClearCutoff() {
  if (typeof window === 'undefined') return 0
  try {
    const value = Number(window.localStorage.getItem(RUNTIME_MONITOR_CLEAR_STORAGE_KEY) || 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

let clearGeneration = 0
let clearedAtMs = readPersistedClearCutoff()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((listener) => listener())
}

export function markRuntimeMonitorCleared(clearedAt: string) {
  const parsed = Date.parse(clearedAt)
  if (Number.isFinite(parsed)) {
    clearedAtMs = Math.max(clearedAtMs, parsed)
    try {
      window.localStorage.setItem(RUNTIME_MONITOR_CLEAR_STORAGE_KEY, String(clearedAtMs))
    } catch {
      // The server-side marker remains authoritative when browser storage is unavailable.
    }
  }
  clearGeneration += 1
  notify()
}

export function getRuntimeMonitorClearGeneration() {
  return clearGeneration
}

export function isRuntimeMonitorEntryVisible(timestamp: string | null | undefined, cutoffMs = clearedAtMs) {
  if (!cutoffMs) return true
  const entryMs = timestamp ? Date.parse(timestamp) : NaN
  return Number.isFinite(entryMs) && entryMs > cutoffMs
}

export function useRuntimeMonitorClearCutoffMs() {
  useSyncExternalStore(subscribe, getRuntimeMonitorClearGeneration, getRuntimeMonitorClearGeneration)
  return clearedAtMs
}

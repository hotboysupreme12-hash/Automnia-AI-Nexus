import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DESKTOP_UPDATE_STATE, type DesktopUpdateState } from '../types/desktopUpdate'

export function useAppUpdater() {
  const [state, setState] = useState<DesktopUpdateState>(DEFAULT_DESKTOP_UPDATE_STATE)
  const bridge = typeof window !== 'undefined' ? window.automniaDesktop?.updates : undefined

  useEffect(() => {
    if (!bridge) return
    let active = true
    const unsubscribe = bridge.onState((next) => {
      if (active) setState(next)
    })
    void bridge.getState().then((next) => {
      if (active) setState(next)
    }).catch(() => {
      if (active) setState(DEFAULT_DESKTOP_UPDATE_STATE)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  const invoke = useCallback(async (action: () => Promise<DesktopUpdateState>) => {
    try {
      const next = await action()
      setState(next)
      return next
    } catch {
      return state
    }
  }, [state])

  return {
    state,
    check: useCallback(() => bridge ? invoke(() => bridge.check()) : Promise.resolve(state), [bridge, invoke, state]),
    download: useCallback(() => bridge ? invoke(() => bridge.download()) : Promise.resolve(state), [bridge, invoke, state]),
    install: useCallback(() => bridge ? invoke(() => bridge.install()) : Promise.resolve(state), [bridge, invoke, state]),
    defer: useCallback((hours = 24) => bridge ? invoke(() => bridge.defer(hours)) : Promise.resolve(state), [bridge, invoke, state]),
    setAutoDownload: useCallback((autoDownload: boolean) => bridge ? invoke(() => bridge.setPreferences({ autoDownload })) : Promise.resolve(state), [bridge, invoke, state]),
    openReleaseNotes: useCallback(() => bridge?.openReleaseNotes() ?? Promise.resolve(false), [bridge]),
    openManualDownload: useCallback(() => bridge?.openManualDownload() ?? Promise.resolve(false), [bridge]),
  }
}

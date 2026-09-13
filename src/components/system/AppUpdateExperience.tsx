import { useEffect, useMemo, useState } from 'react'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { Button, Dialog } from '../ui'

function formatBytes(value: number | null) {
  if (!value || value < 1) return ''
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  return `${Math.round(value / (1024 * 1024))} MB`
}

export function AppUpdateExperience() {
  const { state, download, install, defer, openReleaseNotes, openManualDownload } = useAppUpdater()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [expiredDeferredUntil, setExpiredDeferredUntil] = useState<string | null>(null)
  useEffect(() => {
    if (!state.deferredUntil) return
    const delay = Math.max(0, Date.parse(state.deferredUntil) - Date.now())
    const timer = window.setTimeout(() => setExpiredDeferredUntil(state.deferredUntil), Math.min(delay, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [state.deferredUntil])
  const deferred = Boolean(!state.mandatory && state.deferredUntil && expiredDeferredUntil !== state.deferredUntil)
  const dialogOpen = !deferred && dismissedVersion !== state.availableVersion && (state.status === 'ready' || (state.status === 'available' && !state.autoDownload))
  const progressLabel = useMemo(() => {
    if (state.progressPercent === null) return 'Downloading update…'
    const total = formatBytes(state.total)
    return `Downloading update · ${Math.round(state.progressPercent)}%${total ? ` of ${total}` : ''}`
  }, [state.progressPercent, state.total])

  if (!state.supported) return null

  return <>
    {state.status === 'downloading' && !deferred && (
      <aside className="automnia-update-banner" role="status" aria-live="polite">
        <div><strong>{progressLabel}</strong><span>You can keep working. Automnia verifies the installer before offering to restart.</span></div>
        <progress max={100} value={state.progressPercent ?? 0} aria-label={progressLabel} />
      </aside>
    )}
    {state.status === 'manual-required' && state.errorVisible && (
      <aside className="automnia-update-banner is-warning" role="alert">
        <div><strong>Automnia {state.availableVersion} is available</strong><span>{state.error}</span></div>
        <button type="button" onClick={() => void openManualDownload()}>Download signed package</button>
        {state.releaseNotesUrl && <button type="button" onClick={() => void openReleaseNotes()}>Release notes</button>}
      </aside>
    )}
    {state.status === 'error' && state.errorVisible && (
      <aside className="automnia-update-banner is-error" role="alert">
        <div><strong>Update paused safely</strong><span>{state.error}</span></div>
      </aside>
    )}
    <Dialog
      open={dialogOpen}
      role={state.mandatory ? 'alertdialog' : 'dialog'}
      onClose={() => { if (state.mandatory) setDismissedVersion(state.availableVersion); else void defer(24) }}
      title={state.status === 'ready' ? `Automnia ${state.availableVersion} is ready` : `Automnia ${state.availableVersion} is available`}
      description={state.status === 'ready'
        ? 'The signed update is downloaded and verified. Restart when convenient; your local settings and workspace data stay in place.'
        : 'Download the signed update in the background while you continue working.'}
      footer={<>
        {state.releaseNotesUrl && <Button variant="secondary" onClick={() => void openReleaseNotes()}>What’s new</Button>}
        {state.mandatory && <Button variant="secondary" onClick={() => setDismissedVersion(state.availableVersion)}>Finish current work</Button>}
        {!state.mandatory && <Button variant="secondary" onClick={() => void defer(24)}>Remind me tomorrow</Button>}
        {state.status === 'ready'
          ? <Button onClick={() => void install()}>Restart and update</Button>
          : <Button onClick={() => void download()}>Download update</Button>}
      </>}
    >
      {state.mandatory && <p className="automnia-update-required">This version is no longer supported. Finish your current work, then update to continue receiving service and security fixes.</p>}
    </Dialog>
  </>
}

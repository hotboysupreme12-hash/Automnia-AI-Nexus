import { useAppUpdater } from '../../hooks/useAppUpdater'

function updateStatusLabel(status: string, version: string | null) {
  if (status === 'checking') return 'Checking for updates…'
  if (status === 'up-to-date') return 'You’re up to date'
  if (status === 'available') return `Version ${version} is available`
  if (status === 'downloading') return `Downloading version ${version}…`
  if (status === 'ready') return `Version ${version} is ready to install`
  if (status === 'installing') return 'Preparing to restart…'
  if (status === 'manual-required') return `Version ${version} needs to be installed manually`
  if (status === 'error') return 'Update paused'
  return 'Automatic update checks are on'
}

export function AppUpdateSettings() {
  const { state, check, download, install, setAutoDownload, openReleaseNotes, openManualDownload } = useAppUpdater()
  const busy = ['checking', 'downloading', 'installing'].includes(state.status)
  return <>
    <section className="dui-settings-card automnia-update-settings">
      <div className="dui-settings-card__head"><div><strong>App updates</strong><small>Download updates automatically and choose when to restart.</small></div></div>
      <div className="dui-settings-card__body">
        <div className="automnia-update-version-row">
          <div><span>Installed version</span><strong>{state.currentVersion}</strong></div>
          <div><span>Update status</span><strong>{updateStatusLabel(state.status, state.availableVersion)}</strong></div>
        </div>
        <label className="automnia-update-toggle">
          <span><strong>Download updates automatically</strong><small>Automnia will let you know when an update is ready to install.</small></span>
          <input type="checkbox" checked={state.autoDownload} disabled={!state.supported} onChange={(event) => void setAutoDownload(event.target.checked)} />
        </label>
        {state.status === 'downloading' && <progress max={100} value={state.progressPercent ?? 0} aria-label="Update download progress" />}
        {state.error && (state.errorVisible || !state.supported || state.status === 'manual-required') && <p className="automnia-update-settings__message" data-tone={state.status === 'error' ? 'error' : 'neutral'}>{state.error}</p>}
        <div className="dui-settings-actions">
          <button type="button" disabled={!state.supported || busy || state.status === 'ready'} onClick={() => void check()}>{state.status === 'checking' ? 'Checking…' : 'Check for updates'}</button>
          {state.status === 'available' && !state.autoDownload && <button type="button" className="is-primary" onClick={() => void download()}>Download update</button>}
          {state.status === 'ready' && <button type="button" className="is-primary" onClick={() => void install()}>Restart and update</button>}
          {state.status === 'manual-required' && <button type="button" className="is-primary" onClick={() => void openManualDownload()}>Download installer</button>}
          {state.releaseNotesUrl && <button type="button" onClick={() => void openReleaseNotes()}>View release notes</button>}
        </div>
      </div>
    </section>
    <section className="dui-settings-card">
      <div className="dui-settings-card__head"><div><strong>Update protection</strong><small>Automnia only installs verified updates made for your device.</small></div></div>
      <div className="dui-settings-card__body"><p className="automnia-update-policy-copy">If an update is incomplete, incompatible, or cannot be installed safely, Automnia stops and keeps your current version unchanged.</p></div>
    </section>
  </>
}

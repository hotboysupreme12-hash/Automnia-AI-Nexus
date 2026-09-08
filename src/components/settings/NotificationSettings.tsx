import { useState } from 'react'
import { readPreferenceValue, savePreferenceEntries } from './preferenceStorage'
import { Button } from '../ui'

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(() => readPreferenceValue('automnia-background-notifications-v1') === 'on')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const available = typeof Notification !== 'undefined'
  return <div className="dui-settings-field" data-setting-label="Background notifications" data-setting-hint="Completed responses failed runs attention desktop alerts">
    <span><strong>Background notifications</strong><small>Get an alert when a response finishes or needs attention while Automnia is in the background.</small></span>
    <div className="dui-settings-control">
      <Button loading={busy} disabled={!available} aria-pressed={enabled} onClick={() => {
        if (enabled) { const result = savePreferenceEntries([['automnia-background-notifications-v1', 'off']]); setEnabled(false); setNotice(result.ok ? 'Background notifications disabled.' : result.message); return }
        setBusy(true)
        void Notification.requestPermission().then((permission) => {
          if (permission !== 'granted') { setNotice('Notifications are blocked. Enable them in your browser or system notification settings to use this feature.'); return }
          const result = savePreferenceEntries([['automnia-background-notifications-v1', 'on']]); setEnabled(true); setNotice(result.ok ? 'Background completion and attention alerts enabled.' : result.message)
        }).catch(() => setNotice('Notification permission could not be requested. Check your system settings.')).finally(() => setBusy(false))
      }}>{enabled ? 'Disable notifications' : 'Enable notifications'}</Button>
      {!available && <p className="text-sm text-slate-400">Notifications are unavailable in this environment.</p>}
      {notice && <p className="mt-2 text-sm text-slate-300" role="status">{notice}</p>}
    </div>
  </div>
}

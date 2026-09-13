import {
  CHANNEL_ACTIVITY_RETENTION_OPTIONS,
  saveChannelActivitySettings,
  useChannelActivitySettings,
} from './channelActivitySettings'

export function SettingsActivityLog() {
  const channelActivitySettings = useChannelActivitySettings()

  return (
    <div className="dui-settings-section" id="settings-section-logs" role="tabpanel">
      <section className="dui-channel-activity-preferences" aria-labelledby="channel-activity-preferences-title">
        <div className="dui-channel-activity-preferences__copy">
          <span>Channel traffic</span>
          <strong id="channel-activity-preferences-title">Display settings</strong>
          <p>Choose how many recent channel updates remain visible in Monitor.</p>
        </div>
        <div className="dui-channel-activity-preferences__controls">
          <label>
            <span><strong>Visible updates</strong><small>Newest events shown in Channel Traffic</small></span>
            <select
              value={channelActivitySettings.retentionLimit}
              onChange={(event) => saveChannelActivitySettings({
                ...channelActivitySettings,
                retentionLimit: Number(event.target.value) as typeof channelActivitySettings.retentionLimit,
              })}
            >
              {CHANNEL_ACTIVITY_RETENTION_OPTIONS.map((option) => <option key={option} value={option}>Show {option} updates</option>)}
            </select>
          </label>
          <label className="dui-channel-activity-preferences__toggle">
            <span><strong>Automatically trim older events</strong><small>Remove the oldest item when the limit is reached</small></span>
            <input
              type="checkbox"
              checked={channelActivitySettings.autoTrim}
              onChange={(event) => saveChannelActivitySettings({ ...channelActivitySettings, autoTrim: event.target.checked })}
            />
            <i aria-hidden="true" />
          </label>
        </div>
      </section>
    </div>
  )
}

export default SettingsActivityLog

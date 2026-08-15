import { useEffect, useState } from 'react'

export const CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY = 'automnia-channel-activity-settings-v1'
export const CHANNEL_ACTIVITY_SETTINGS_EVENT = 'automnia-channel-activity-settings-changed'

export const CHANNEL_ACTIVITY_RETENTION_OPTIONS = [10, 25, 50, 100] as const
export type ChannelActivityRetention = typeof CHANNEL_ACTIVITY_RETENTION_OPTIONS[number]

export type ChannelActivitySettings = {
  retentionLimit: ChannelActivityRetention
  autoTrim: boolean
}

export const DEFAULT_CHANNEL_ACTIVITY_SETTINGS: ChannelActivitySettings = {
  retentionLimit: 25,
  autoTrim: true,
}

function isRetentionLimit(value: unknown): value is ChannelActivityRetention {
  return typeof value === 'number' && CHANNEL_ACTIVITY_RETENTION_OPTIONS.includes(value as ChannelActivityRetention)
}

export function readChannelActivitySettings(): ChannelActivitySettings {
  if (typeof window === 'undefined') return DEFAULT_CHANNEL_ACTIVITY_SETTINGS
  try {
    const raw = window.localStorage.getItem(CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_CHANNEL_ACTIVITY_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ChannelActivitySettings>
    return {
      retentionLimit: isRetentionLimit(parsed.retentionLimit) ? parsed.retentionLimit : DEFAULT_CHANNEL_ACTIVITY_SETTINGS.retentionLimit,
      autoTrim: typeof parsed.autoTrim === 'boolean' ? parsed.autoTrim : DEFAULT_CHANNEL_ACTIVITY_SETTINGS.autoTrim,
    }
  } catch {
    return DEFAULT_CHANNEL_ACTIVITY_SETTINGS
  }
}

export function saveChannelActivitySettings(settings: ChannelActivitySettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event(CHANNEL_ACTIVITY_SETTINGS_EVENT))
}

export function useChannelActivitySettings(): ChannelActivitySettings {
  const [settings, setSettings] = useState<ChannelActivitySettings>(() => readChannelActivitySettings())

  useEffect(() => {
    const sync = () => setSettings(readChannelActivitySettings())
    window.addEventListener(CHANNEL_ACTIVITY_SETTINGS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANNEL_ACTIVITY_SETTINGS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return settings
}

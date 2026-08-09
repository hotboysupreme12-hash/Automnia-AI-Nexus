export type SpeechTranscriptionMode = 'local' | 'online'

export type SpeechSettings = {
  mode: SpeechTranscriptionMode
  autoStop: boolean
  pauseDurationMs: number
  maxRecordingSeconds: number
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
}

export const SPEECH_SETTINGS_STORAGE_KEY = 'automnia-speech-settings-v1'
export const SPEECH_SETTINGS_CHANGED_EVENT = 'automnia:speech-settings-changed'

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  mode: 'local',
  autoStop: true,
  pauseDurationMs: 1_150,
  maxRecordingSeconds: 120,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function readSpeechSettings(): SpeechSettings {
  if (typeof window === 'undefined') return DEFAULT_SPEECH_SETTINGS
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPEECH_SETTINGS_STORAGE_KEY) || '{}') as Partial<SpeechSettings>
    return {
      mode: parsed.mode === 'online' ? 'online' : 'local',
      autoStop: booleanSetting(parsed.autoStop, DEFAULT_SPEECH_SETTINGS.autoStop),
      pauseDurationMs: boundedNumber(parsed.pauseDurationMs, DEFAULT_SPEECH_SETTINGS.pauseDurationMs, 600, 3_000),
      maxRecordingSeconds: boundedNumber(parsed.maxRecordingSeconds, DEFAULT_SPEECH_SETTINGS.maxRecordingSeconds, 15, 300),
      noiseSuppression: booleanSetting(parsed.noiseSuppression, DEFAULT_SPEECH_SETTINGS.noiseSuppression),
      echoCancellation: booleanSetting(parsed.echoCancellation, DEFAULT_SPEECH_SETTINGS.echoCancellation),
      autoGainControl: booleanSetting(parsed.autoGainControl, DEFAULT_SPEECH_SETTINGS.autoGainControl),
    }
  } catch {
    return DEFAULT_SPEECH_SETTINGS
  }
}

export function saveSpeechSettings(settings: SpeechSettings): void {
  if (typeof window === 'undefined') return
  const normalized: SpeechSettings = {
    mode: settings.mode === 'online' ? 'online' : 'local',
    autoStop: Boolean(settings.autoStop),
    pauseDurationMs: boundedNumber(settings.pauseDurationMs, DEFAULT_SPEECH_SETTINGS.pauseDurationMs, 600, 3_000),
    maxRecordingSeconds: boundedNumber(settings.maxRecordingSeconds, DEFAULT_SPEECH_SETTINGS.maxRecordingSeconds, 15, 300),
    noiseSuppression: Boolean(settings.noiseSuppression),
    echoCancellation: Boolean(settings.echoCancellation),
    autoGainControl: Boolean(settings.autoGainControl),
  }
  window.localStorage.setItem(SPEECH_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent<SpeechSettings>(SPEECH_SETTINGS_CHANGED_EVENT, { detail: normalized }))
}

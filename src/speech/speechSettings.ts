export type SpeechTranscriptionMode = 'local' | 'online'

export type SpeechSettings = {
  mode: SpeechTranscriptionMode
}

export const SPEECH_SETTINGS_STORAGE_KEY = 'automnia-speech-settings-v1'
export const SPEECH_SETTINGS_CHANGED_EVENT = 'automnia:speech-settings-changed'

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  mode: 'local',
}

export function readSpeechSettings(): SpeechSettings {
  if (typeof window === 'undefined') return DEFAULT_SPEECH_SETTINGS
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPEECH_SETTINGS_STORAGE_KEY) || '{}') as Partial<SpeechSettings>
    return {
      mode: parsed.mode === 'online' ? 'online' : 'local',
    }
  } catch {
    return DEFAULT_SPEECH_SETTINGS
  }
}

export function saveSpeechSettings(settings: SpeechSettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SPEECH_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent<SpeechSettings>(SPEECH_SETTINGS_CHANGED_EVENT, { detail: settings }))
}

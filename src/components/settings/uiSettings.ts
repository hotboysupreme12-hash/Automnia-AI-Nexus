export type UiAccentMode = 'no-blue' | 'reference' | 'ember' | 'green'
export type UiFormChrome = 'graphite' | 'obsidian' | 'warm'
export type UiDensity = 'compact' | 'comfortable' | 'spacious'
export type UiMotion = 'standard' | 'reduced'

export type DystopAIUiSettings = {
  accentMode: UiAccentMode
  formChrome: UiFormChrome
  density: UiDensity
  motion: UiMotion
  neutralScrollbars: boolean
  controlGlow: boolean
}

export const UI_SETTINGS_STORAGE_KEY = 'dystopai-ui-settings-v1'

export const DEFAULT_UI_SETTINGS: DystopAIUiSettings = {
  accentMode: 'reference',
  formChrome: 'graphite',
  density: 'comfortable',
  motion: 'standard',
  neutralScrollbars: true,
  controlGlow: false,
}

export function readUiSettings(): DystopAIUiSettings {
  if (typeof window === 'undefined') return DEFAULT_UI_SETTINGS
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_UI_SETTINGS
    const parsed = JSON.parse(raw) as Partial<DystopAIUiSettings>
    return {
      ...DEFAULT_UI_SETTINGS,
      ...parsed,
      accentMode: parsed.accentMode || DEFAULT_UI_SETTINGS.accentMode,
      formChrome: parsed.formChrome || DEFAULT_UI_SETTINGS.formChrome,
      density: parsed.density || DEFAULT_UI_SETTINGS.density,
      motion: parsed.motion || DEFAULT_UI_SETTINGS.motion,
    }
  } catch {
    return DEFAULT_UI_SETTINGS
  }
}

export function saveUiSettings(settings: DystopAIUiSettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function applyUiSettings(settings: DystopAIUiSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.duiAccentMode = settings.accentMode
  root.dataset.duiFormChrome = settings.formChrome
  root.dataset.duiDensity = settings.density
  root.dataset.duiMotion = settings.motion
  root.dataset.duiNeutralScrollbars = settings.neutralScrollbars ? 'true' : 'false'
  root.dataset.duiControlGlow = settings.controlGlow ? 'true' : 'false'
  root.classList.toggle('dui-no-blue-forms', settings.accentMode === 'no-blue')
}

export function applyStoredUiSettings(): DystopAIUiSettings {
  const settings = readUiSettings()
  applyUiSettings(settings)
  return settings
}

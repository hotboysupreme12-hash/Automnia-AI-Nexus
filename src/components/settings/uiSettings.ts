export type UiAccentMode = 'no-blue' | 'reference' | 'ember' | 'green'
export type UiFormChrome = 'graphite' | 'obsidian' | 'warm'
export type UiDensity = 'compact' | 'comfortable' | 'spacious'
export type UiMotion = 'standard' | 'reduced'

export type DystopAIUiSettings = {
  accentMode: UiAccentMode
  formChrome: UiFormChrome
  density: UiDensity
  motion: UiMotion
  highContrast: boolean
  reducedGlow: boolean
  neutralScrollbars: boolean
  controlGlow: boolean
}

export const UI_SETTINGS_STORAGE_KEY = 'dystopai-ui-settings-v1'

export const DEFAULT_UI_SETTINGS: DystopAIUiSettings = {
  accentMode: 'reference',
  formChrome: 'graphite',
  density: 'comfortable',
  motion: 'standard',
  highContrast: false,
  reducedGlow: true,
  neutralScrollbars: true,
  controlGlow: false,
}

const ACCENT_MODES = new Set<UiAccentMode>(['no-blue', 'reference', 'ember', 'green'])
const FORM_CHROMES = new Set<UiFormChrome>(['graphite', 'obsidian', 'warm'])
const DENSITIES = new Set<UiDensity>(['compact', 'comfortable', 'spacious'])
const MOTION_MODES = new Set<UiMotion>(['standard', 'reduced'])

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function readUiSettings(): DystopAIUiSettings {
  if (typeof window === 'undefined') return DEFAULT_UI_SETTINGS
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_UI_SETTINGS
    const parsed = JSON.parse(raw) as Partial<DystopAIUiSettings>
    const controlGlow = isBoolean(parsed.controlGlow) ? parsed.controlGlow : DEFAULT_UI_SETTINGS.controlGlow
    return {
      ...DEFAULT_UI_SETTINGS,
      accentMode: parsed.accentMode && ACCENT_MODES.has(parsed.accentMode) ? parsed.accentMode : DEFAULT_UI_SETTINGS.accentMode,
      formChrome: parsed.formChrome && FORM_CHROMES.has(parsed.formChrome) ? parsed.formChrome : DEFAULT_UI_SETTINGS.formChrome,
      density: parsed.density && DENSITIES.has(parsed.density) ? parsed.density : DEFAULT_UI_SETTINGS.density,
      motion: parsed.motion && MOTION_MODES.has(parsed.motion) ? parsed.motion : DEFAULT_UI_SETTINGS.motion,
      highContrast: isBoolean(parsed.highContrast) ? parsed.highContrast : DEFAULT_UI_SETTINGS.highContrast,
      reducedGlow: isBoolean(parsed.reducedGlow) ? parsed.reducedGlow : !controlGlow,
      neutralScrollbars: isBoolean(parsed.neutralScrollbars) ? parsed.neutralScrollbars : DEFAULT_UI_SETTINGS.neutralScrollbars,
      controlGlow,
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
  root.dataset.duiHighContrast = settings.highContrast ? 'true' : 'false'
  root.dataset.duiReducedGlow = settings.reducedGlow ? 'true' : 'false'
  root.dataset.duiNeutralScrollbars = settings.neutralScrollbars ? 'true' : 'false'
  root.dataset.duiControlGlow = settings.controlGlow && !settings.reducedGlow ? 'true' : 'false'
  root.classList.toggle('dui-no-blue-forms', settings.accentMode === 'no-blue')
  root.classList.toggle('dui-high-contrast', settings.highContrast)
  root.classList.toggle('dui-reduced-glow', settings.reducedGlow)
}

export function applyStoredUiSettings(): DystopAIUiSettings {
  const settings = readUiSettings()
  applyUiSettings(settings)
  return settings
}

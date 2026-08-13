import type { AgentRarity } from '../../types/nexus'

export type RegistrySortKey = 'party' | 'level' | 'name' | 'rarity'
export type AgentDisplayMode = 'showcase' | 'grid6' | 'grid8' | 'grid10' | 'list'
export type AgentOverlayPreset = 'rarity' | 'original' | 'epic-purple' | 'graphite-glass' | 'blueprint-grid'
export type AgentCardTheme = Exclude<AgentOverlayPreset, 'rarity'>

export type RegistryPreferences = {
  displayMode: AgentDisplayMode
  overlayPreset: AgentOverlayPreset
  rarityColorsEnabled: boolean
  rarityFilter: AgentRarity | 'all'
  sortKey: RegistrySortKey
}

export type ConsolePreferences = {
  visible: boolean
  width: number
  rememberDrafts: boolean
}

export const REGISTRY_PREFS_KEY = 'automnia-agent-registry-prefs'
export const REGISTRY_PREFS_CHANGED_EVENT = 'automnia:registry-preferences-changed'
export const REGISTRY_PREFS_VERSION = 6
export const CONSOLE_VISIBILITY_KEY = 'automnia-agent-console-visibility'
export const CONSOLE_WIDTH_KEY = 'automnia-agent-console-width'
export const CONSOLE_DRAFTS_KEY = 'automnia-command-draft-persistence'
export const CONSOLE_PREFS_CHANGED_EVENT = 'automnia:console-preferences-changed'

export const REGISTRY_DISPLAY_OPTIONS: Array<{ id: AgentDisplayMode; label: string; hint: string; pageSize: number }> = [
  { id: 'showcase', label: 'Showcase', hint: 'Large cards', pageSize: 6 },
  { id: 'grid6', label: '6 Grid', hint: 'Balanced', pageSize: 6 },
  { id: 'grid8', label: '9 Grid', hint: 'More agents', pageSize: 9 },
  { id: 'grid10', label: '12 Grid', hint: 'Dense', pageSize: 12 },
  { id: 'list', label: 'List', hint: 'Fast scanning', pageSize: 12 },
]

export const REGISTRY_OVERLAY_OPTIONS: Array<{ id: AgentOverlayPreset; label: string; hint: string }> = [
  { id: 'rarity', label: 'By rarity', hint: 'Legendary Original · Epic Purple · Rare Blueprint · Common Graphite' },
  { id: 'original', label: 'Original', hint: 'Cyber circuit' },
  { id: 'epic-purple', label: 'Epic Purple', hint: 'High-contrast violet' },
  { id: 'graphite-glass', label: 'Graphite', hint: 'Modern glass' },
  { id: 'blueprint-grid', label: 'Blueprint', hint: 'Technical grid' },
]

export const DEFAULT_REGISTRY_PREFERENCES: RegistryPreferences = {
  displayMode: 'grid8',
  overlayPreset: 'graphite-glass',
  rarityColorsEnabled: true,
  rarityFilter: 'all',
  sortKey: 'party',
}

export const AGENT_CARD_RARITY_THEMES: Record<AgentRarity, AgentCardTheme> = {
  legendary: 'original',
  epic: 'epic-purple',
  rare: 'blueprint-grid',
  common: 'graphite-glass',
}

export function resolveAgentCardTheme(rarity: AgentRarity | undefined, preferences: Pick<RegistryPreferences, 'overlayPreset' | 'rarityColorsEnabled'>): AgentCardTheme {
  if (preferences.rarityColorsEnabled) {
    return AGENT_CARD_RARITY_THEMES[rarity || 'common']
  }
  return preferences.overlayPreset === 'rarity' ? 'graphite-glass' : preferences.overlayPreset
}

export const DEFAULT_CONSOLE_PREFERENCES: ConsolePreferences = {
  visible: true,
  width: 420,
  rememberDrafts: true,
}

const DISPLAY_MODES = new Set(REGISTRY_DISPLAY_OPTIONS.map((option) => option.id))
const OVERLAY_PRESETS = new Set(REGISTRY_OVERLAY_OPTIONS.map((option) => option.id))
const RARITIES = new Set<AgentRarity | 'all'>(['all', 'common', 'rare', 'epic', 'legendary'])
const SORT_KEYS = new Set<RegistrySortKey>(['party', 'level', 'name', 'rarity'])

function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readRegistryPreferences(): RegistryPreferences {
  const storage = localStorageOrNull()
  if (!storage) return DEFAULT_REGISTRY_PREFERENCES
  try {
    const parsed = JSON.parse(storage.getItem(REGISTRY_PREFS_KEY) || '{}') as Partial<RegistryPreferences>
    const storedOverlayPreset = parsed.overlayPreset && OVERLAY_PRESETS.has(parsed.overlayPreset)
      ? parsed.overlayPreset
      : DEFAULT_REGISTRY_PREFERENCES.overlayPreset
    const overlayPreset = storedOverlayPreset === 'rarity' ? 'graphite-glass' : storedOverlayPreset
    return {
      displayMode: parsed.displayMode && DISPLAY_MODES.has(parsed.displayMode) ? parsed.displayMode : DEFAULT_REGISTRY_PREFERENCES.displayMode,
      overlayPreset,
      rarityColorsEnabled: typeof parsed.rarityColorsEnabled === 'boolean' ? parsed.rarityColorsEnabled : storedOverlayPreset === 'rarity',
      rarityFilter: parsed.rarityFilter && RARITIES.has(parsed.rarityFilter) ? parsed.rarityFilter : DEFAULT_REGISTRY_PREFERENCES.rarityFilter,
      sortKey: parsed.sortKey && SORT_KEYS.has(parsed.sortKey) ? parsed.sortKey : DEFAULT_REGISTRY_PREFERENCES.sortKey,
    }
  } catch {
    return DEFAULT_REGISTRY_PREFERENCES
  }
}

export function saveRegistryPreferences(preferences: RegistryPreferences): void {
  const storage = localStorageOrNull()
  if (!storage) return
  const normalized: RegistryPreferences = {
    ...preferences,
    overlayPreset: preferences.overlayPreset === 'rarity' ? 'graphite-glass' : preferences.overlayPreset,
    rarityColorsEnabled: Boolean(preferences.rarityColorsEnabled),
  }
  storage.setItem(REGISTRY_PREFS_KEY, JSON.stringify({ ...normalized, overlayPresetVersion: REGISTRY_PREFS_VERSION }))
  window.dispatchEvent(new CustomEvent<RegistryPreferences>(REGISTRY_PREFS_CHANGED_EVENT, { detail: normalized }))
}

export function readConsolePreferences(): ConsolePreferences {
  const storage = localStorageOrNull()
  if (!storage) return DEFAULT_CONSOLE_PREFERENCES
  const storedWidth = Number(storage.getItem(CONSOLE_WIDTH_KEY))
  const width = Number.isFinite(storedWidth) && storedWidth > 0
    ? Math.max(360, Math.min(760, Math.round(storedWidth)))
    : DEFAULT_CONSOLE_PREFERENCES.width
  return {
    visible: storage.getItem(CONSOLE_VISIBILITY_KEY) !== 'hidden',
    width,
    rememberDrafts: storage.getItem(CONSOLE_DRAFTS_KEY) !== 'off',
  }
}

export function saveConsolePreferences(preferences: ConsolePreferences): void {
  const storage = localStorageOrNull()
  if (!storage) return
  const normalized: ConsolePreferences = {
    visible: Boolean(preferences.visible),
    width: Math.max(360, Math.min(760, Math.round(preferences.width))),
    rememberDrafts: Boolean(preferences.rememberDrafts),
  }
  storage.setItem(CONSOLE_VISIBILITY_KEY, normalized.visible ? 'visible' : 'hidden')
  storage.setItem(CONSOLE_WIDTH_KEY, String(normalized.width))
  storage.setItem(CONSOLE_DRAFTS_KEY, normalized.rememberDrafts ? 'on' : 'off')
  window.dispatchEvent(new CustomEvent<ConsolePreferences>(CONSOLE_PREFS_CHANGED_EVENT, { detail: normalized }))
}

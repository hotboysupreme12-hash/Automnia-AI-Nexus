import { readPreferenceValue, savePreferenceEntries } from './preferenceStorage'
import type { AgentRarity } from '../../types/nexus'

export type RegistrySortKey = 'party' | 'level' | 'name' | 'rarity'
export type AgentDisplayMode = 'grid8' | 'grid10' | 'list'
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
  parallelAgentChat: boolean
  rememberDrafts: boolean
}

export const REGISTRY_PREFS_KEY = 'automnia-agent-registry-prefs'
export const REGISTRY_PREFS_CHANGED_EVENT = 'automnia:registry-preferences-changed'
export const REGISTRY_PREFS_VERSION = 8
export const CONSOLE_VISIBILITY_KEY = 'automnia-agent-console-visibility'
export const CONSOLE_WIDTH_KEY = 'automnia-agent-console-width'
export const CONSOLE_PARALLEL_CHAT_KEY = 'automnia-agent-chat-parallel'
export const CONSOLE_DRAFTS_KEY = 'automnia-command-draft-persistence'
export const CONSOLE_PREFS_CHANGED_EVENT = 'automnia:console-preferences-changed'

export const REGISTRY_DISPLAY_OPTIONS: Array<{ id: AgentDisplayMode; label: string; hint: string; pageSize: number }> = [
  { id: 'grid8', label: 'Simple', hint: '9 agents · balanced', pageSize: 9 },
  { id: 'grid10', label: 'Detailed', hint: '12 agents · full card info', pageSize: 12 },
  { id: 'list', label: 'List', hint: 'Fast scanning', pageSize: 12 },
]

export const REGISTRY_OVERLAY_OPTIONS: Array<{ id: AgentOverlayPreset; label: string; hint: string }> = [
  { id: 'original', label: 'Original', hint: 'Dark obsidian' },
  { id: 'epic-purple', label: 'Epic Purple', hint: 'High-contrast violet' },
  { id: 'graphite-glass', label: 'Graphite', hint: 'Modern glass' },
  { id: 'blueprint-grid', label: 'Blueprint', hint: 'Technical grid' },
]

export const DEFAULT_REGISTRY_PREFERENCES: RegistryPreferences = {
  displayMode: 'grid8',
  overlayPreset: 'original',
  rarityColorsEnabled: true,
  rarityFilter: 'all',
  sortKey: 'party',
}

export const AGENT_CARD_RARITY_THEMES: Record<AgentRarity, AgentCardTheme> = {
  // Rarity mode keeps the card shell consistent. The final obsidian layer
  // reads the data-agent-rarity marker for the restrained accent instead of
  // swapping in a full saturated theme per card.
  legendary: 'original',
  epic: 'original',
  rare: 'original',
  common: 'original',
}

export function resolveAgentCardTheme(rarity: AgentRarity | undefined, preferences: Pick<RegistryPreferences, 'overlayPreset' | 'rarityColorsEnabled'>): AgentCardTheme {
  if (preferences.rarityColorsEnabled) {
    return AGENT_CARD_RARITY_THEMES[rarity || 'common']
  }
  return preferences.overlayPreset === 'rarity' ? 'original' : preferences.overlayPreset
}

/**
 * Keep the document-level card theme in sync before the registry paints.
 *
 * The registry is lazy-loaded and can be remounted during a workspace refresh,
 * so this cannot rely on an effect cleanup to own the global marker. Leaving
 * the last valid value in place avoids briefly falling back to the saturated
 * legacy rarity treatment while the cards are being recreated.
 */
export function applyRegistryCardTheme(preferences: Pick<RegistryPreferences, 'overlayPreset' | 'rarityColorsEnabled'>): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.agentCardOverlay = preferences.rarityColorsEnabled ? 'rarity' : preferences.overlayPreset
  document.documentElement.dataset.agentCardRarityColors = preferences.rarityColorsEnabled ? 'enabled' : 'disabled'
}

export const DEFAULT_CONSOLE_PREFERENCES: ConsolePreferences = {
  visible: true,
  width: 420,
  parallelAgentChat: false,
  rememberDrafts: true,
}

const DISPLAY_MODES = new Set(REGISTRY_DISPLAY_OPTIONS.map((option) => option.id))
// Keep the removed rarity preset readable for existing saved preferences.
const OVERLAY_PRESETS = new Set<AgentOverlayPreset>(['rarity', ...REGISTRY_OVERLAY_OPTIONS.map((option) => option.id)])
const RARITIES = new Set<AgentRarity | 'all'>(['all', 'common', 'rare', 'epic', 'legendary'])
const SORT_KEYS = new Set<RegistrySortKey>(['party', 'level', 'name', 'rarity'])

function normalizeDisplayMode(value: unknown): AgentDisplayMode | null {
  if (value === 'grid6' || value === 'showcase' || value === 'grid8') return 'grid8'
  if (value === 'grid10') return 'grid10'
  if (value === 'list') return 'list'
  return null
}

export function readRegistryPreferences(): RegistryPreferences {
  try {
    const parsed = JSON.parse(readPreferenceValue(REGISTRY_PREFS_KEY) || '{}') as Partial<RegistryPreferences> & { overlayPresetVersion?: number }
    const storedOverlayPreset = parsed.overlayPreset && OVERLAY_PRESETS.has(parsed.overlayPreset)
      ? parsed.overlayPreset
      : DEFAULT_REGISTRY_PREFERENCES.overlayPreset
    const legacyDefault = storedOverlayPreset === 'graphite-glass' && (parsed.overlayPresetVersion ?? 0) < REGISTRY_PREFS_VERSION
    const overlayPreset = storedOverlayPreset === 'rarity' || legacyDefault ? 'original' : storedOverlayPreset
    const storedDisplayMode = normalizeDisplayMode((parsed as { displayMode?: unknown }).displayMode)
    return {
      displayMode: storedDisplayMode && DISPLAY_MODES.has(storedDisplayMode) ? storedDisplayMode : DEFAULT_REGISTRY_PREFERENCES.displayMode,
      overlayPreset,
      rarityColorsEnabled: typeof parsed.rarityColorsEnabled === 'boolean' ? parsed.rarityColorsEnabled : parsed.overlayPreset ? storedOverlayPreset === 'rarity' : DEFAULT_REGISTRY_PREFERENCES.rarityColorsEnabled,
      rarityFilter: parsed.rarityFilter && RARITIES.has(parsed.rarityFilter) ? parsed.rarityFilter : DEFAULT_REGISTRY_PREFERENCES.rarityFilter,
      sortKey: parsed.sortKey && SORT_KEYS.has(parsed.sortKey) ? parsed.sortKey : DEFAULT_REGISTRY_PREFERENCES.sortKey,
    }
  } catch {
    return DEFAULT_REGISTRY_PREFERENCES
  }
}

export function saveRegistryPreferences(preferences: RegistryPreferences): void {
  const normalized: RegistryPreferences = {
    ...preferences,
    overlayPreset: preferences.overlayPreset === 'rarity' ? 'original' : preferences.overlayPreset,
    rarityColorsEnabled: Boolean(preferences.rarityColorsEnabled),
  }
  savePreferenceEntries([[REGISTRY_PREFS_KEY, JSON.stringify({ ...normalized, overlayPresetVersion: REGISTRY_PREFS_VERSION })]])
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<RegistryPreferences>(REGISTRY_PREFS_CHANGED_EVENT, { detail: normalized }))
}

export function readConsolePreferences(): ConsolePreferences {
  const storedWidth = Number(readPreferenceValue(CONSOLE_WIDTH_KEY))
  const width = Number.isFinite(storedWidth) && storedWidth > 0
    ? Math.max(360, Math.min(760, Math.round(storedWidth)))
    : DEFAULT_CONSOLE_PREFERENCES.width
  return {
    visible: readPreferenceValue(CONSOLE_VISIBILITY_KEY) !== 'hidden',
    width,
    parallelAgentChat: readPreferenceValue(CONSOLE_PARALLEL_CHAT_KEY) === 'on',
    rememberDrafts: readPreferenceValue(CONSOLE_DRAFTS_KEY) !== 'off',
  }
}

export function saveConsolePreferences(preferences: ConsolePreferences): void {
  const normalized: ConsolePreferences = {
    visible: Boolean(preferences.visible),
    width: Math.max(360, Math.min(760, Math.round(preferences.width))),
    parallelAgentChat: preferences.parallelAgentChat !== false,
    rememberDrafts: Boolean(preferences.rememberDrafts),
  }
  savePreferenceEntries([[CONSOLE_PARALLEL_CHAT_KEY, normalized.parallelAgentChat ? 'on' : 'off'], [CONSOLE_VISIBILITY_KEY, normalized.visible ? 'visible' : 'hidden'], [CONSOLE_WIDTH_KEY, String(normalized.width)], [CONSOLE_DRAFTS_KEY, normalized.rememberDrafts ? 'on' : 'off']])
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ConsolePreferences>(CONSOLE_PREFS_CHANGED_EVENT, { detail: normalized }))
}

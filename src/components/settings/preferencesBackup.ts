import { z } from 'zod'
import { UI_SETTINGS_STORAGE_KEY } from './uiSettings'
import { CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY } from './channelActivitySettings'

export const MAX_PREFERENCES_BACKUP_BYTES = 1_000_000
const boolean = z.boolean()
const appearance = z.object({ accentMode: z.enum(['no-blue', 'reference', 'ember', 'green']), formChrome: z.enum(['graphite', 'obsidian', 'warm']), density: z.enum(['compact', 'comfortable', 'spacious']), motion: z.enum(['standard', 'reduced']), highContrast: boolean, reducedGlow: boolean, neutralScrollbars: boolean, controlGlow: boolean })
const voice = z.object({ mode: z.enum(['local', 'online']), language: z.string().regex(/^([a-z]{2})?$/).optional(), vocabulary: z.string().max(1000).optional(), microphoneDeviceId: z.string().max(512).optional(), autoStop: boolean, pauseDurationMs: z.number().int().min(600).max(3000), maxRecordingSeconds: z.number().int().min(15).max(300), noiseSuppression: boolean, echoCancellation: boolean, autoGainControl: boolean })
const registry = z.object({ displayMode: z.enum(['grid8', 'grid10', 'list']), overlayPreset: z.enum(['rarity', 'original', 'epic-purple', 'graphite-glass', 'blueprint-grid']), rarityColorsEnabled: boolean, rarityFilter: z.enum(['all', 'common', 'rare', 'epic', 'legendary']), sortKey: z.enum(['party', 'level', 'name', 'rarity']) })
const consolePreferences = z.object({ visible: boolean, width: z.number().int().min(360).max(760), rememberDrafts: boolean })
const activity = z.object({ retentionLimit: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]), autoTrim: boolean })
const mission = z.object({ title: z.string().max(500), description: z.string().max(100_000), complexity: z.number().min(1).max(100), riskTolerance: z.number().min(1).max(100), durationMode: z.enum(['instant', 'timed', 'continuous', 'indefinite']), durationValue: z.number().positive().max(100_000), durationUnit: z.enum(['hours', 'days', 'weeks']), collaborationMode: z.enum(['hierarchical', 'parallel', 'specialist', 'sequential', 'swarm']), missionType: z.enum(['codeGeneration', 'planning', 'research', 'orchestration', 'memoryManagement']), requiredEvidence: z.array(z.object({ kind: z.enum(['filesChanged', 'tests', 'build', 'humanPath', 'riskReview', 'runtimePreflight', 'teamSync']), label: z.string().max(1000), required: boolean, command: z.string().max(10_000).optional() })).max(50).optional() })
const preferences = z.object({ appearance: appearance.optional(), voice: voice.optional(), registry: registry.optional(), console: consolePreferences.optional(), activity: activity.optional(), mission: mission.optional() })
export type PreferencesBackup = z.infer<typeof preferences>
export type PreferenceGroup = keyof PreferencesBackup
export const PREFERENCE_GROUP_LABELS: Record<PreferenceGroup, string> = { appearance: 'Appearance', voice: 'Voice and microphone', registry: 'Agent registry', console: 'Command console', activity: 'Activity display', mission: 'Mission draft' }

export function serializePreferencesBackup(values: PreferencesBackup): string {
  return JSON.stringify({ format: 'automnia-preferences', version: 2, createdAt: new Date().toISOString(), preferences: preferences.parse(values) }, null, 2)
}

export function parsePreferencesBackup(text: string): PreferencesBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_PREFERENCES_BACKUP_BYTES) throw new Error('This file is too large. Select a preferences backup smaller than 1 MB.')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This file is not valid JSON. Select an Automnia preferences backup.') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This file does not contain a preferences backup.')
  const source = raw as Record<string, unknown>
  let payload: unknown
  if (source.version === 2 && source.format === 'automnia-preferences') payload = source.preferences
  else if (source.version === 1) payload = { appearance: source[UI_SETTINGS_STORAGE_KEY], activity: source[CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY], voice: source.speech, registry: source.registry, console: source.console, mission: source.mission }
  else throw new Error('Unsupported backup version. Export a backup with a compatible Automnia version.')
  const result = preferences.safeParse(payload)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`Invalid preference ${issue.path.join('.') || 'data'}: ${issue.message}`)
  }
  const recognized = Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined)) as PreferencesBackup
  if (!Object.keys(recognized).length) throw new Error('No recognized preferences were found. No settings were changed.')
  return recognized
}

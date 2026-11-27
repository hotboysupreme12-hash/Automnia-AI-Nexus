import { readPreferenceValue, savePreferenceEntries } from './preferenceStorage'

export const CURSOR_AGENT_SETTINGS_KEY = 'automnia-cursor-agent-settings-v1'
export const CURSOR_AGENT_SETTINGS_EVENT = 'automnia:cursor-agent-settings-changed'
export const CURSOR_AGENT_STATUS_EVENT = 'automnia:cursor-agent-status-changed'
let latestCursorAgentStatus = ''

export type CursorAgentSettings = {
  enabled: boolean
  agentId: string
  includeClipboard: boolean
}

export const DEFAULT_CURSOR_AGENT_SETTINGS: CursorAgentSettings = {
  enabled: false,
  agentId: '',
  includeClipboard: true,
}

export function normalizeCursorAgentSettings(value: unknown): CursorAgentSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_CURSOR_AGENT_SETTINGS
  const input = value as Partial<CursorAgentSettings>
  return {
    enabled: input.enabled === true,
    agentId: typeof input.agentId === 'string' ? input.agentId.trim().slice(0, 128) : '',
    includeClipboard: input.includeClipboard !== false,
  }
}

export function readCursorAgentSettings(): CursorAgentSettings {
  try {
    return normalizeCursorAgentSettings(JSON.parse(readPreferenceValue(CURSOR_AGENT_SETTINGS_KEY) || '{}'))
  } catch {
    return DEFAULT_CURSOR_AGENT_SETTINGS
  }
}

export function saveCursorAgentSettings(value: CursorAgentSettings): CursorAgentSettings {
  const settings = normalizeCursorAgentSettings(value)
  savePreferenceEntries([[CURSOR_AGENT_SETTINGS_KEY, JSON.stringify(settings)]])
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CURSOR_AGENT_SETTINGS_EVENT, { detail: settings }))
  return settings
}

export function readCursorAgentStatus(): string {
  return latestCursorAgentStatus
}

export function publishCursorAgentStatus(message: string): void {
  latestCursorAgentStatus = message.slice(0, 500)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CURSOR_AGENT_STATUS_EVENT, { detail: latestCursorAgentStatus }))
}

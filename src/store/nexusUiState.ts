import type { OpenClawAgent } from '../types/nexus'

export type AppTab = 'agents' | 'missions' | 'monitor' | 'plugins' | 'settings'

export interface NexusUiState {
  tab: AppTab
  selectedAgentId: string | null
  selectedAgentIds: string[]
  isEditorOpen: boolean
  editingAgentId: string | null
}

export function normalizeNexusSelection(
  agents: Array<Pick<OpenClawAgent, 'id'>>,
  selectedAgentId?: unknown,
  selectedAgentIds?: unknown,
): Pick<NexusUiState, 'selectedAgentId' | 'selectedAgentIds'> {
  const validIds = new Set(agents.map((agent) => agent.id))
  const ids = Array.isArray(selectedAgentIds)
    ? selectedAgentIds.filter((id, index): id is string => typeof id === 'string' && validIds.has(id) && selectedAgentIds.indexOf(id) === index)
    : []
  const id: string | null = typeof selectedAgentId === 'string' && validIds.has(selectedAgentId)
    ? selectedAgentId
    : ids[0] ?? null

  if (id && !ids.includes(id)) {
    return { selectedAgentId: id, selectedAgentIds: [id, ...ids] }
  }

  return { selectedAgentId: id, selectedAgentIds: ids }
}

export function makeNexusUiState(
  agents: Array<Pick<OpenClawAgent, 'id'>>,
  options: { tab?: AppTab; selectedAgentId?: unknown; selectedAgentIds?: unknown } = {},
): NexusUiState {
  return {
    tab: options.tab || 'agents',
    ...normalizeNexusSelection(agents, options.selectedAgentId, options.selectedAgentIds),
    isEditorOpen: false,
    editingAgentId: null,
  }
}

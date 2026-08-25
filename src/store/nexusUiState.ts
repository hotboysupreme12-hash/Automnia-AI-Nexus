import type { OpenClawAgent } from '../types/nexus'

export type AppTab = 'agents' | 'missions' | 'monitor' | 'plugins' | 'settings'

export type AgentEditorTab = 'profile' | 'model' | 'heartbeat' | 'policy' | 'workspace' | 'skills' | 'files'

export interface NexusUiState {
  tab: AppTab
  selectedAgentId: string | null
  selectedAgentIds: string[]
  isEditorOpen: boolean
  editingAgentId: string | null
  editorTab: AgentEditorTab
  editorOpenRequest: number
}

/**
 * Resolve the agent an external UI reference should edit. The order mirrors
 * the operator's visible context: explicit selection, first active-party
 * slot, then the first registry agent.
 */
export function resolveAgentEditorId(
  agents: Array<Pick<OpenClawAgent, 'id'>>,
  selectedAgentId: unknown,
  activePartyIds: readonly string[],
  firstVisibleRegistryAgentId?: unknown,
  selectedAgentIds?: readonly string[],
): string | null {
  const validIds = new Set(agents.map((agent) => agent.id))
  if (typeof selectedAgentId === 'string' && validIds.has(selectedAgentId)) return selectedAgentId

  const selectedAgentFallback = selectedAgentIds?.find((agentId) => validIds.has(agentId))
  if (selectedAgentFallback) return selectedAgentFallback

  const partyAgentId = activePartyIds.find((agentId) => validIds.has(agentId))
  if (partyAgentId) return partyAgentId

  if (typeof firstVisibleRegistryAgentId === 'string' && validIds.has(firstVisibleRegistryAgentId)) {
    return firstVisibleRegistryAgentId
  }

  return agents[0]?.id ?? null
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

/**
 * Toggle one valid agent in the chat selection while keeping the primary
 * selection and the ordered multi-selection in sync.
 */
export function toggleNexusSelection(
  agents: Array<Pick<OpenClawAgent, 'id'>>,
  selectedAgentId: unknown,
  selectedAgentIds: unknown,
  agentId: string,
): Pick<NexusUiState, 'selectedAgentId' | 'selectedAgentIds'> {
  const current = normalizeNexusSelection(agents, selectedAgentId, selectedAgentIds)
  if (!current.selectedAgentIds.includes(agentId) && !agents.some((agent) => agent.id === agentId)) {
    return current
  }

  const nextIds = current.selectedAgentIds.includes(agentId)
    ? current.selectedAgentIds.filter((id) => id !== agentId)
    : [...current.selectedAgentIds, agentId]

  return {
    selectedAgentId: nextIds.length
      ? nextIds.includes(agentId) ? agentId : nextIds[nextIds.length - 1]
      : null,
    selectedAgentIds: nextIds,
  }
}

/** Remove an agent from chat selection without ever adding it as a side effect. */
export function removeNexusSelection(
  agents: Array<Pick<OpenClawAgent, 'id'>>,
  selectedAgentId: unknown,
  selectedAgentIds: unknown,
  agentId: string,
): Pick<NexusUiState, 'selectedAgentId' | 'selectedAgentIds'> {
  const current = normalizeNexusSelection(agents, selectedAgentId, selectedAgentIds)
  if (!current.selectedAgentIds.includes(agentId)) return current

  const nextIds = current.selectedAgentIds.filter((id) => id !== agentId)
  return {
    selectedAgentId: nextIds.length ? nextIds[nextIds.length - 1] : null,
    selectedAgentIds: nextIds,
  }
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
    editorTab: 'profile',
    editorOpenRequest: 0,
  }
}

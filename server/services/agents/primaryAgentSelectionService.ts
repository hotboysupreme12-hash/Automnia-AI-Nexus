export type PrimaryAgentEntry = {
  id: string
  default?: boolean
}

type AgentListConfig = {
  agents?: {
    list?: PrimaryAgentEntry[]
  }
}

/**
 * Keep one non-retired agent as the fallback for messages that do not match a
 * more specific binding. Custom bindings still take precedence.
 */
export function ensurePrimaryAgentSelection(
  config: AgentListConfig,
  isRetiredAgentId: (agentId: string) => boolean,
) {
  const list = config.agents?.list
  if (!Array.isArray(list) || !list.length) return false

  const eligible = list.filter((entry) => !isRetiredAgentId(entry.id))
  if (!eligible.length) return false

  const rosterAgents = eligible.filter((entry) => entry.id !== 'main')
  const current = rosterAgents.find((entry) => entry.default === true)
    || (rosterAgents.length ? undefined : eligible.find((entry) => entry.default === true))
  const fallback = current || rosterAgents[0] || eligible[0]
  let changed = false

  for (const entry of list) {
    const shouldBePrimary = entry === fallback
    if (shouldBePrimary) {
      if (entry.default !== true) {
        entry.default = true
        changed = true
      }
      continue
    }
    if (entry.default !== undefined) {
      delete entry.default
      changed = true
    }
  }

  return changed
}

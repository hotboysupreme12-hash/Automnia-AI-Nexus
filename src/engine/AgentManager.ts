import type { OpenClawAgent } from '../types/nexus'

export class AgentManager {
  static getActivePartyAgents(agents: OpenClawAgent[], activePartyIds: string[]): OpenClawAgent[] {
    const agentMap = new Map(agents.map((a) => [a.id, a]))
    // Preserve party slot order — the agent at activePartyIds[0] is the commander.
    return activePartyIds.map((id) => agentMap.get(id)).filter((a): a is OpenClawAgent => Boolean(a))
  }

  static markPartyActivation(agents: OpenClawAgent[], activePartyIds: string[]): OpenClawAgent[] {
    const ids = new Set(activePartyIds)
    return agents.map((agent) => ({ ...agent, heartbeat: { ...agent.heartbeat, continuous: ids.has(agent.id) ? agent.heartbeat.continuous : false } }))
  }
}

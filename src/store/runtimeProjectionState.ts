import { makeDormantState } from '../data/seeds'
import type {
  AgentOperationState,
  HeartbeatConfig,
  MissionEvent,
  MissionRun,
  OpenClawAgent,
} from '../types/nexus'

export type AgentConfigSaveScope = 'heartbeat' | 'runtime' | 'profile' | 'policy' | 'mds' | 'skills'
export type AgentConfigSavePhase = 'saving' | 'saved' | 'failed'

export type AgentConfigSaveEntry = {
  phase: AgentConfigSavePhase
  message: string
  revision: number
  updatedAt: string
  requestId?: string
}

export type AgentConfigSaveStatus = Partial<Record<AgentConfigSaveScope, AgentConfigSaveEntry>>

export type AgentConfigSaveReporter = (agentId: string, scope: AgentConfigSaveScope, entry: AgentConfigSaveEntry) => void

export interface NexusRuntimeProjectionState {
  activeMission: MissionRun | null
  missionFeed: MissionEvent[]
  operationStates: Record<string, AgentOperationState>
  sessionWarmAgentIds: string[]
  agentConfigSaveStatus: Record<string, AgentConfigSaveStatus>
}

type RuntimeProjectionAgent = Pick<OpenClawAgent, 'id'> & { heartbeat: Pick<HeartbeatConfig, 'tickIntervalMs'> }

export function makeDormantOperationStates(agents: RuntimeProjectionAgent[]): Record<string, AgentOperationState> {
  const operationStates: Record<string, AgentOperationState> = {}
  for (const agent of agents) {
    operationStates[agent.id] = makeDormantState(agent.id, agent.heartbeat.tickIntervalMs)
  }
  return operationStates
}

export function makeRuntimeProjectionState(agents: RuntimeProjectionAgent[]): NexusRuntimeProjectionState {
  return {
    activeMission: null,
    missionFeed: [],
    operationStates: makeDormantOperationStates(agents),
    sessionWarmAgentIds: [],
    agentConfigSaveStatus: {},
  }
}

export function preserveRuntimeProjectionState(current: NexusRuntimeProjectionState): NexusRuntimeProjectionState {
  return {
    activeMission: current.activeMission,
    missionFeed: current.missionFeed,
    operationStates: current.operationStates,
    sessionWarmAgentIds: [],
    agentConfigSaveStatus: {},
  }
}

export function updateAgentConfigSaveStatus(
  current: Record<string, AgentConfigSaveStatus>,
  agentId: string,
  scope: AgentConfigSaveScope,
  entry: AgentConfigSaveEntry,
): Record<string, AgentConfigSaveStatus> {
  return {
    ...current,
    [agentId]: {
      ...(current[agentId] || {}),
      [scope]: entry,
    },
  }
}

export function configSaveEntry(phase: AgentConfigSavePhase, message: string, revision: number, requestId?: string): AgentConfigSaveEntry {
  return { phase, message, revision, requestId, updatedAt: new Date().toISOString() }
}

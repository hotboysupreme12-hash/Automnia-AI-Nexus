import { AgentManager } from './AgentManager'
import { MDSValidator } from './MDSValidator'
import type {
  AgentOperationState,
  DurationMode,
  MissionDraft,
  MissionEvent,
  MissionReport,
  MissionRun,
  OpenClawAgent,
} from '../types/nexus'

interface StartMissionInput {
  agents: OpenClawAgent[]
  partyIds: string[]
  mission: MissionDraft
}

interface OrchestratorHooks {
  onMissionChange: (mission: MissionRun | null) => void
  onMissionEvent: (event: MissionEvent) => void
  onOperationUpdate: (state: AgentOperationState) => void
  onRuntimeUpdate: (agentId: string, runtime: OpenClawAgent['runtime']) => void
  onPerformanceUpdate: (agentId: string, xpDelta: number, errorDelta: number, retries: number) => void
  onMissionComplete: (report: MissionReport, mission: MissionRun) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function durationToMs(mode: DurationMode, value: number, unit: MissionDraft['durationUnit']): number | null {
  if (mode === 'instant') return 0
  if (mode === 'continuous' || mode === 'indefinite') return null

  const safe = Math.max(1, value)
  const hourMs = 60 * 60 * 1000
  const unitMultiplier = unit === 'hours' ? 1 : unit === 'days' ? 24 : 24 * 7
  return safe * unitMultiplier * hourMs
}

function heartbeatLifecycle(mode: DurationMode): string {
  if (mode === 'instant') return 'single cycle, auto-terminate'
  if (mode === 'timed') return 'timed heartbeat, auto-stop on expiration'
  if (mode === 'continuous') return 'continuous heartbeat, manual stop'
  return 'indefinite heartbeat, persistent background'
}

export class MissionOrchestrator {
  private readonly hooks: OrchestratorHooks

  private activeMission: MissionRun | null = null
  private totalXpGained = 0
  private totalErrors = 0
  private totalRetries = 0
  private timedStop: ReturnType<typeof setTimeout> | null = null

  constructor(hooks: OrchestratorHooks) {
    this.hooks = hooks
  }

  start(input: StartMissionInput): MissionRun {
    this.stop('cancelled')

    const partyAgents = AgentManager.getActivePartyAgents(input.agents, input.partyIds)

    const eligibleAgents =
      input.mission.collaborationMode === 'specialist'
        ? partyAgents.filter((agent) => MDSValidator.canRunMission(agent, input.mission).ok)
        : partyAgents

    const selected = eligibleAgents.map((agent) => agent.id)

    const mission: MissionRun = {
      id: crypto.randomUUID(),
      ...input.mission,
      selectedAgents: selected,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'running',
      heartbeatLifecycle: heartbeatLifecycle(input.mission.durationMode),
    }

    this.activeMission = mission
    this.totalXpGained = 0
    this.totalErrors = 0
    this.totalRetries = 0

    for (const agent of eligibleAgents) {
      this.hooks.onMissionEvent({
        id: crypto.randomUUID(),
        missionId: mission.id,
        timestamp: new Date().toISOString(),
        type: 'agent',
        agentId: agent.id,
        message: `${agent.name} assigned to mission cluster`,
      })
    }

    this.hooks.onMissionChange(mission)
    this.hooks.onMissionEvent({
      id: crypto.randomUUID(),
      missionId: mission.id,
      timestamp: new Date().toISOString(),
      type: 'mission',
      message: `Mission deployed with ${selected.length} active agents`,
    })

    if (!selected.length) {
      return this.stop('failed') ?? mission
    }

    if (mission.durationMode === 'instant') {
      return mission
    }

    // The store owns real API-backed mission turns for every mode. This
    // orchestrator tracks mission lifecycle, reports, and timers only.

    const stopAfterMs = durationToMs(mission.durationMode, mission.durationValue, mission.durationUnit)
    if (stopAfterMs !== null) {
      this.timedStop = setTimeout(() => {
        this.stop('completed')
      }, stopAfterMs)
    }

    return mission
  }

  stop(status: MissionRun['status'] = 'cancelled'): MissionRun | null {
    if (!this.activeMission) return null

    if (this.timedStop) {
      clearTimeout(this.timedStop)
      this.timedStop = null
    }

    const endedMission: MissionRun = {
      ...this.activeMission,
      status,
      endedAt: new Date().toISOString(),
    }

    this.activeMission = endedMission
    this.hooks.onMissionChange(endedMission)
    this.hooks.onMissionEvent({
      id: crypto.randomUUID(),
      missionId: endedMission.id,
      timestamp: new Date().toISOString(),
      type: 'mission',
      message: `Mission ${status}`,
    })

    const agentCount = Math.max(1, endedMission.selectedAgents.length)
    const averageRetries = this.totalRetries / agentCount
    const efficiencyRating = clamp(
      Math.round(88 - this.totalErrors * 4 - averageRetries * 2 + this.totalXpGained / (agentCount * 9)),
      5,
      99,
    )
    const soulDrift = clamp(Math.round(endedMission.riskTolerance * 0.25 + (endedMission.collaborationMode === 'swarm' ? 8 : 3)), 0, 42)
    const heartbeatStabilityScore = clamp(Math.round(92 - this.totalErrors * 6 - averageRetries * 2), 10, 99)
    const runtimeEfficiency = clamp(Math.round(74 + this.totalXpGained / (agentCount * 7) - this.totalErrors * 5), 0, 99)

    const report: MissionReport = {
      id: crypto.randomUUID(),
      missionId: endedMission.id,
      generatedAt: new Date().toISOString(),
      efficiencyRating,
      soulDrift,
      heartbeatStabilityScore,
      runtimeEfficiency,
      errors: this.totalErrors,
      xpGained: this.totalXpGained,
      skillUnlocks: efficiencyRating > 88 ? [`${endedMission.missionType}-mastery`] : [],
    }

    this.hooks.onMissionComplete(report, endedMission)

    this.activeMission = null

    return endedMission
  }
}

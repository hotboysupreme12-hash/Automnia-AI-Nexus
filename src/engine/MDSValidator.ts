import type {
  CapabilityKey,
  MissionDraft,
  MissionEvidenceRequirement,
  MissionReadinessIssue,
  MissionReadinessReport,
  OpenClawAgent,
} from '../types/nexus'

function hasWorkspaceToolAccess(agent: OpenClawAgent): boolean {
  return (
    agent.mds.toolAccess.includes('filesystem') ||
    agent.toolsPolicy?.profile === 'full' ||
    Boolean(agent.toolsPolicy?.allow?.includes('filesystem')) ||
    agent.sandbox?.workspaceAccess === 'rw'
  )
}

export class MDSValidator {
  static requiredCapability(mission: MissionDraft): CapabilityKey {
    return mission.missionType
  }

  static defaultEvidenceForMission(mission: MissionDraft): MissionEvidenceRequirement[] {
    const configured = mission.requiredEvidence?.filter((entry) => entry.label.trim())
    if (configured?.length) return configured
    const defaults: MissionEvidenceRequirement[] = [
      { kind: 'runtimePreflight', label: 'Runtime and workspace access preflight completed.', required: true },
      { kind: 'teamSync', label: 'TEAM_SYNC.md has a mission ledger entry for every lane.', required: true },
      { kind: 'riskReview', label: 'Commander names residual risk after verification.', required: true },
    ]
    if (mission.missionType === 'codeGeneration') {
      defaults.push(
        { kind: 'filesChanged', label: 'Implementation lanes report exact files changed.', required: true },
        { kind: 'humanPath', label: 'One end-to-end user path is proven through the app.', required: true },
        { kind: 'build', label: 'Build output is reported or explicitly blocked.', required: true, command: 'npm run build' },
        { kind: 'tests', label: 'Relevant test output is reported or explicitly blocked.', required: false, command: 'npm test' },
      )
    }
    return defaults
  }

  static canRunMission(agent: OpenClawAgent, mission: MissionDraft): { ok: boolean; reason?: string } {
    const required = this.requiredCapability(mission)
    if (!agent.mds.capabilities[required]) {
      return { ok: false, reason: `${agent.name} lacks ${required}` }
    }

    if (mission.collaborationMode === 'hierarchical' && !agent.mds.capabilities.orchestration) {
      return { ok: false, reason: `${agent.name} cannot coordinate hierarchical flow` }
    }

    return { ok: true }
  }

  static readinessReport(agents: OpenClawAgent[], mission: MissionDraft): MissionReadinessReport {
    const issues: MissionReadinessIssue[] = []
    const requiredEvidence = this.defaultEvidenceForMission(mission)

    const hasRequiredCapability = agents.some((agent) => agent.mds.capabilities[mission.missionType])

    if (!hasRequiredCapability) {
      issues.push({
        severity: 'error',
        code: 'no_capable_agent',
        message: `No selected agent has ${mission.missionType} capability.`,
      })
    }

    for (const agent of agents) {
      const result = this.canRunMission(agent, mission)
      if (!result.ok) {
        issues.push({
          severity: mission.collaborationMode === 'specialist' ? 'error' : 'warning',
          code: 'capability_mismatch',
          agentId: agent.id,
          message: result.reason
            ? `${result.reason}; allowed only as support lane outside specialist mode.`
            : `${agent.name} is a support lane for this mission.`,
        })
      }

      if (mission.missionType === 'codeGeneration' && !hasWorkspaceToolAccess(agent)) {
        issues.push({
          severity: 'warning',
          code: 'missing_filesystem',
          agentId: agent.id,
          message: `${agent.name} has no explicit filesystem tool flag; OpenClaw runtime preflight will verify workspace access at turn time.`,
        })
      }

      if (mission.collaborationMode === 'hierarchical' && agents[0]?.id === agent.id && !agent.mds.capabilities.orchestration) {
        issues.push({
          severity: 'error',
          code: 'commander_lacks_orchestration',
          agentId: agent.id,
          message: `${agent.name} is slot 1 but cannot coordinate hierarchical flow.`,
        })
      }
    }

    if (mission.missionType === 'codeGeneration' && !requiredEvidence.some((entry) => entry.kind === 'humanPath' && entry.required)) {
      issues.push({
        severity: 'error',
        code: 'missing_human_path_evidence',
        message: 'Code missions require human-path evidence.',
      })
    }

    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      issues,
      requiredEvidence,
    }
  }
}

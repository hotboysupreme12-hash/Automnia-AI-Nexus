import type {
  AgentOperationState,
  CapabilityKey,
  MissionDraft,
  OpenClawAgent,
} from '../types/nexus'
import {
  PROJECT_BUILD_VERIFICATION_COMMAND,
  PROJECT_TEST_VERIFICATION_COMMAND,
} from '../engine/missionVerification'

export const SKILL_TREE: Array<{
  id: string
  name: string
  description: string
  capability: CapabilityKey
}> = [
  {
    id: 'advanced-orchestration',
    name: 'Advanced Orchestration',
    description: 'Unlock dynamic multi-agent task routing.',
    capability: 'orchestration',
  },
  {
    id: 'deep-research-matrix',
    name: 'Deep Research Matrix',
    description: 'Enable higher confidence external synthesis paths.',
    capability: 'research',
  },
  {
    id: 'precision-planning',
    name: 'Precision Planning',
    description: 'Expose structured phased execution planning.',
    capability: 'planning',
  },
  {
    id: 'codeforge-suite',
    name: 'Codeforge Suite',
    description: 'Enable large technical implementation streams.',
    capability: 'codeGeneration',
  },
  {
    id: 'memory-guardian',
    name: 'Memory Guardian',
    description: 'Enable long-horizon continuity and memory cleanup.',
    capability: 'memoryManagement',
  },
]

export const DEFAULT_MISSION_DRAFT: MissionDraft = {
  title: 'Deployment Objective',
  description: 'Execute this objective with verification, clear updates, and no silent regressions.',
  complexity: 65,
  riskTolerance: 35,
  durationMode: 'timed',
  durationValue: 2,
  durationUnit: 'hours',
  collaborationMode: 'parallel',
  missionType: 'planning',
  requiredEvidence: [
    { kind: 'runtimePreflight', label: 'Agent runtime and workspace access checked before launch.', required: true },
    { kind: 'filesChanged', label: 'Every implementation lane reports exact files changed or confirms read-only work.', required: true },
    { kind: 'humanPath', label: 'A provider/browser/integration path proves the user workflow, not just isolated pieces.', required: true },
    { kind: 'build', label: 'Build result or explicit build blocker.', required: true, command: PROJECT_BUILD_VERIFICATION_COMMAND },
    { kind: 'tests', label: 'Project test gate result or explicit unavailable reason.', required: false, command: PROJECT_TEST_VERIFICATION_COMMAND },
    { kind: 'riskReview', label: 'Final review states what could still be broken despite passing checks.', required: true },
    { kind: 'teamSync', label: 'TEAM_SYNC.md acceptance ledger is updated with owner, status, and evidence.', required: true },
  ],
}

type ViteImportMeta = ImportMeta & {
  env?: {
    BASE_URL?: string
  }
}

const assetBaseUrl = ((import.meta as ViteImportMeta).env?.BASE_URL || '/').replace(/\/?$/, '/')

function assetPath(path: string): string {
  return `${assetBaseUrl}${path.replace(/^\/+/, '')}`
}

export function makeSeedAgents(): OpenClawAgent[] {
  return [
    {
      id: 'hn-architect',
      name: 'Elena Vasquez',
      className: 'Solution Architect',
      role: 'Chief Software Architect',
      behaviorProfile: 'architect',
      level: 44,
      rarity: 'legendary',
      portrait: assetPath('agents/generated/elena-vasquez.jpg'),
      attributes: {
        intelligence: 96,
        speed: 58,
        precision: 94,
        creativity: 72,
        stability: 90,
        compute: 84,
        parallelism: 62,
      },
      soul: {
        personality: 'analytical',
        autonomyLevel: 88,
        riskTolerance: 28,
        reflectionDepth: 96,
        goalOrientation: 94,
        persistence: 82,
        alignmentMode: 'strict',
      },
      heartbeat: {
        tickIntervalMs: 5000,
        maxExecutionTimeMs: null,
        continuous: true,
        idleTimeoutMs: 50000,
        recoveryMode: true,
      },
      mds: {
        capabilities: {
          codeGeneration: false,
          planning: true,
          research: true,
          orchestration: true,
          memoryManagement: true,
        },
        maxContextTokens: 30000,
        toolAccess: ['filesystem', 'planner', 'message', 'web_search', 'web_fetch'],
        delegationAllowed: true,
        subAgentSpawnLimit: 4,
      },
      runtime: {
        temperature: 0.28,
        top_p: 0.68,
        maxTokens: 2800,
        retryAttempts: 5,
        concurrencyLimit: 4,
      },
      performance: {
        xp: 19200,
        completedMissions: 62,
        failedMissions: 1,
        efficiencyAverage: 91,
        heartbeatStability: 94,
        runtimeEfficiency: 88,
        errors: 3,
      },
      unlockedSkills: ['advanced-orchestration', 'precision-planning', 'deep-research-matrix', 'memory-guardian'],
    },
    {
      id: 'hn-coordinator',
      name: 'Sarah Cooper',
      className: 'Strategist',
      role: 'Scope Commander',
      behaviorProfile: 'architect',
      level: 31,
      rarity: 'epic',
      portrait: assetPath('agents/generated/sarah-cooper.jpg'),
      attributes: {
        intelligence: 88,
        speed: 62,
        precision: 82,
        creativity: 64,
        stability: 84,
        compute: 72,
        parallelism: 58,
      },
      soul: {
        personality: 'analytical',
        autonomyLevel: 72,
        riskTolerance: 38,
        reflectionDepth: 86,
        goalOrientation: 90,
        persistence: 80,
        alignmentMode: 'strict',
      },
      heartbeat: {
        tickIntervalMs: 4200,
        maxExecutionTimeMs: null,
        continuous: false,
        idleTimeoutMs: 40000,
        recoveryMode: true,
      },
      mds: {
        capabilities: {
          codeGeneration: false,
          planning: true,
          research: true,
          orchestration: true,
          memoryManagement: true,
        },
        maxContextTokens: 18000,
        toolAccess: ['filesystem', 'planner', 'runtime-status'],
        delegationAllowed: true,
        subAgentSpawnLimit: 2,
      },
      runtime: {
        temperature: 0.32,
        top_p: 0.74,
        maxTokens: 1600,
        retryAttempts: 4,
        concurrencyLimit: 3,
      },
      performance: {
        xp: 11850,
        completedMissions: 47,
        failedMissions: 3,
        efficiencyAverage: 83,
        heartbeatStability: 88,
        runtimeEfficiency: 80,
        errors: 11,
      },
      unlockedSkills: ['advanced-orchestration', 'precision-planning', 'memory-guardian'],
    },
    {
      id: 'hn-crypto-lead',
      name: 'Marcus Chen',
      className: 'Crypto Strategist',
      role: 'Lead Alpha Hunter',
      behaviorProfile: 'architect',
      level: 22,
      rarity: 'rare',
      portrait: assetPath('agents/generated/marcus-chen.jpg'),
      attributes: {
        intelligence: 82,
        speed: 78,
        precision: 72,
        creativity: 85,
        stability: 74,
        compute: 80,
        parallelism: 76,
      },
      soul: {
        personality: 'aggressive',
        autonomyLevel: 80,
        riskTolerance: 72,
        reflectionDepth: 68,
        goalOrientation: 90,
        persistence: 82,
        alignmentMode: 'balanced',
      },
      heartbeat: {
        tickIntervalMs: 2800,
        maxExecutionTimeMs: null,
        continuous: false,
        idleTimeoutMs: 22000,
        recoveryMode: true,
      },
      mds: {
        capabilities: {
          codeGeneration: false,
          planning: true,
          research: true,
          orchestration: true,
          memoryManagement: true,
        },
        maxContextTokens: 16000,
        toolAccess: ['filesystem', 'planner', 'web_search', 'web_fetch'],
        delegationAllowed: true,
        subAgentSpawnLimit: 2,
      },
      runtime: {
        temperature: 0.52,
        top_p: 0.82,
        maxTokens: 2000,
        retryAttempts: 3,
        concurrencyLimit: 4,
      },
      performance: {
        xp: 6800,
        completedMissions: 28,
        failedMissions: 4,
        efficiencyAverage: 78,
        heartbeatStability: 80,
        runtimeEfficiency: 76,
        errors: 10,
      },
      unlockedSkills: ['precision-planning', 'deep-research-matrix'],
    },
  ]
}

export function makeDormantState(agentId: string, tickRate: number): AgentOperationState {
  return {
    agentId,
    heartbeatActive: false,
    heartbeatStatus: 'dormant',
    currentPhase: 'Dormant',
    tickRate,
    concurrencyUsage: 0,
    retryCount: 0,
    logStream: ['Awaiting active party assignment.'],
    uptimeMs: 0,
    memoryUsageMb: 0,
    subtaskBreakdown: [
      { id: `${agentId}-s1`, label: 'Planning', progress: 0 },
      { id: `${agentId}-s2`, label: 'Execution', progress: 0 },
      { id: `${agentId}-s3`, label: 'Validation', progress: 0 },
    ],
  }
}

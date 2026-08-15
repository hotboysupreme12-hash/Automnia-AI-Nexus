export type SoulPersonality = 'analytical' | 'creative' | 'aggressive' | 'conservative'
export type AlignmentMode = 'strict' | 'balanced' | 'exploratory'

export interface SoulConfig {
  personality: SoulPersonality
  autonomyLevel: number
  riskTolerance: number
  reflectionDepth: number
  goalOrientation: number
  persistence: number
  alignmentMode: AlignmentMode
}

export interface HeartbeatConfig {
  tickIntervalMs: number
  maxExecutionTimeMs: number | null
  continuous: boolean
  idleTimeoutMs: number
  recoveryMode: boolean
}

export type CapabilityKey =
  | 'codeGeneration'
  | 'planning'
  | 'research'
  | 'orchestration'
  | 'memoryManagement'

export interface AgentMDS {
  capabilities: Record<CapabilityKey, boolean>
  maxContextTokens: number
  toolAccess: string[]
  delegationAllowed: boolean
  subAgentSpawnLimit: number
  skillLibrary?: AgentSkillLibraryState
}

export type AgentSkillSource = 'bundled' | 'library' | 'agent' | 'learned' | 'clawhub'

export interface AgentSkillEntry {
  id: string
  name: string
  description: string
  source: AgentSkillSource
  path?: string
  learnedAt?: string
  xpValue?: number
}

export interface AgentSkillLibraryState {
  knownSkills: AgentSkillEntry[]
  preferredSkills: string[]
  lastSyncedAt?: string
}

export interface RuntimeConfig {
  temperature: number
  top_p: number
  maxTokens: number
  retryAttempts: number
  concurrencyLimit: number
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type FastModeDefault = 'auto' | 'on' | 'off'

export interface AgentRuntimePolicy {
  thinkingDefault?: ThinkingLevel
  timeoutSeconds?: number
  parallelPreferred?: boolean
  fastModeDefault?: FastModeDefault
}

export interface RuntimePreview extends RuntimeConfig {
  reasoningDepth: number
  retryCount: number
  validationStrictness: number
  explorationVariance: number
}

export interface CoreAttributes {
  intelligence: number
  speed: number
  precision: number
  creativity: number
  stability: number
  compute: number
  parallelism: number
}

export interface AgentPerformance {
  xp: number
  completedMissions: number
  failedMissions: number
  efficiencyAverage: number
  heartbeatStability: number
  runtimeEfficiency: number
  errors: number
}

export type BehaviorProfile = 'executor' | 'architect' | 'auditor' | 'researcher' | 'hybrid'
export type AgentRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface OpenClawAgent {
  id: string
  name: string
  isDefault?: boolean
  workspace?: string
  sandbox?: {
    mode?: 'off' | 'all' | 'non-main'
    scope?: 'session' | 'agent' | 'shared'
    workspaceRoot?: string
    workspaceAccess?: 'rw' | 'ro' | 'none'
  }
  model?: {
    primary?: string
    fallbacks?: string[]
  }
  runtimePolicy?: AgentRuntimePolicy
  toolsPolicy?: {
    profile?: string
    allow?: string[]
    deny?: string[]
  }
  rarity?: AgentRarity
  className: string
  role: string
  behaviorProfile: BehaviorProfile
  level: number
  portrait: string
  portraitFocusY?: number
  attributes: CoreAttributes
  soul: SoulConfig
  heartbeat: HeartbeatConfig
  mds: AgentMDS
  runtime: RuntimeConfig
  performance: AgentPerformance
  unlockedSkills: string[]
}

export type DurationMode = 'instant' | 'timed' | 'continuous' | 'indefinite'
export type DurationUnit = 'hours' | 'days' | 'weeks'

export type CollaborationMode = 'parallel' | 'sequential' | 'hierarchical' | 'swarm' | 'specialist'

export type EvidenceKind =
  | 'filesChanged'
  | 'tests'
  | 'build'
  | 'humanPath'
  | 'riskReview'
  | 'runtimePreflight'
  | 'teamSync'

export interface MissionEvidenceRequirement {
  kind: EvidenceKind
  label: string
  required: boolean
  command?: string
}

export interface MissionReadinessIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  agentId?: string
}

export interface MissionReadinessReport {
  ok: boolean
  issues: MissionReadinessIssue[]
  requiredEvidence: MissionEvidenceRequirement[]
}

export interface MissionDraft {
  title: string
  description: string
  complexity: number
  riskTolerance: number
  durationMode: DurationMode
  durationValue: number
  durationUnit: DurationUnit
  collaborationMode: CollaborationMode
  missionType: CapabilityKey
  requiredEvidence?: MissionEvidenceRequirement[]
}

export type MissionStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'

export interface MissionRun extends MissionDraft {
  id: string
  selectedAgents: string[]
  startedAt: string
  endedAt: string | null
  status: MissionStatus
  heartbeatLifecycle: string
  schedulerLifecycle?: string
  scheduler?: {
    engine: string
    policy: string
    status: string
    round: number
    cycleIntervalMs?: number
    nextRoundAt: string | null
    maxCycles?: number | null
    activeJobId: string | null
    lastError?: string | null
    jobs?: Array<{
      id: string
      cronId: string
      agentId: string
      role: string
      round: number
      status: string
      summary: string | null
      scheduleKind?: 'one-shot' | 'recurring'
      runCount?: number
      completedRunCount?: number
      failedRunCount?: number
      lastRunAt?: string | null
      lastRunStatus?: 'completed' | 'failed' | null
    }>
  }
}

// ─── Inter-Agent Coordination Types ──────────────────────────────

export type AgentMessageKind = 'delegation' | 'query' | 'report' | 'alert' | 'handoff' | 'confirmation' | 'broadcast'

export type AgentMessageStatus = 'pending' | 'delivered' | 'acknowledged' | 'completed' | 'rejected'

export interface AgentMessage {
  id: string
  missionId: string
  fromAgentId: string
  toAgentId: string | null // null = broadcast to all mission agents
  kind: AgentMessageKind
  intent: string // natural language: "I need you to audit the payment module"
  context: string // additional detail, code snippets, file paths
  expectedResponse: string // "Please confirm and return findings within 2 ticks"
  status: AgentMessageStatus
  createdAt: string
  acknowledgedAt: string | null
  completedAt: string | null
  acknowledgedBy?: string[]
  completedBy?: string[]
}

export interface WorkspaceClaim {
  agentId: string
  files: string[] // files this agent is actively working on
  task: string // brief description of what they're doing
  claimedAt: string
  expiresAt: string | null
}

export interface DelegationRequest {
  id: string
  missionId: string
  fromAgentId: string
  toAgentId: string
  task: string
  context: string
  deadline: string | null
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'rejected'
  acceptedAt: string | null
  completedAt: string | null
  resultSummary: string | null
}

export interface CollaborationSession {
  missionId: string
  startedAt: string
  messages: AgentMessage[]
  workspaceRegistry: WorkspaceClaim[] // what each agent owns
  delegations: DelegationRequest[]
}

export interface TeamContextBlock {
  roster: string // lane summary
  laneMatrix: string // compact per-agent status and ownership
  workspaceSnapshot: string // who owns what files
  recentDelegations: string // pending/completed delegations
  recentMessages: string // inter-agent messages since last tick
  conflictWarnings: string[] // files with overlapping claims
  commanderIntent: string // slot 1 coordination guidance
  nextActions: string[] // immediate team actions
}

// ─── Existing Runtime Types ───────────────────────────────────────

export interface SubtaskState {
  id: string
  label: string
  progress: number
}

export interface AgentOperationState {
  agentId: string
  heartbeatActive: boolean
  heartbeatStatus: 'dormant' | 'active' | 'idle'
  currentPhase: string
  tickRate: number
  concurrencyUsage: number
  retryCount: number
  logStream: string[]
  uptimeMs: number
  memoryUsageMb: number
  subtaskBreakdown: SubtaskState[]
}

export interface MissionEvent {
  id: string
  missionId: string
  timestamp: string
  type: 'mission' | 'agent' | 'runtime' | 'coordination'
  message: string
  agentId?: string
  coordinationKind?: AgentMessageKind
  failureKind?: string
}

export interface MissionReport {
  id: string
  missionId: string
  generatedAt: string
  efficiencyRating: number | null
  soulDrift: number | null
  heartbeatStabilityScore: number | null
  runtimeEfficiency: number | null
  errors: number | null
  xpGained: number | null
  skillUnlocks: string[]
  evidence?: MissionReportEvidence
}

export interface MissionReportEvidence {
  source: 'runtime-responses' | 'mission-feed' | 'mixed' | 'none'
  acceptedRuns: number
  startedRuns: number
  completedRuns: number
  failedRuns: number
  cancelledRuns: number
  timedOutRuns: number
  retryCount: number
  fallbackCount: number
  verificationFailures: number
  toolFailures: number
  commandFailures: number
  humanInterventions: number
  agentParticipation: string[]
  queueDelayMs: number | null
  timeToFirstTokenMs: number | null
  totalExecutionDurationMs: number | null
  missionWallTimeMs: number | null
  tokenUsageEstimate: number | null
  runtimeRunIds?: string[]
  cronRunIds?: string[]
  sessionIds?: string[]
  sessionKeys?: string[]
  unavailableMetrics: string[]
}

export type AgentActivityType =
  | 'gateway.connected'
  | 'gateway.disconnected'
  | 'gateway.reconnecting'
  | 'gateway.reconnected'
  | 'gateway.health.ok'
  | 'gateway.health.warning'
  | 'run.accepted'
  | 'run.queued'
  | 'run.started'
  | 'run.context_building'
  | 'run.prompt_assembled'
  | 'run.model_running'
  | 'run.compacting_context'
  | 'run.retrying'
  | 'run.cancelled'
  | 'run.failed'
  | 'run.finished'
  | 'agent.started'
  | 'agent.working'
  | 'agent.waiting'
  | 'agent.finalizing'
  | 'message.partial'
  | 'message.block'
  | 'message.preview'
  | 'message.final'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.output'
  | 'tool.finished'
  | 'tool.error'
  | 'tool.blocked'
  | 'approval.pending'
  | 'approval.allowed'
  | 'approval.denied'
  | 'browser.opening'
  | 'browser.navigating'
  | 'browser.reading'
  | 'browser.clicking'
  | 'browser.typing'
  | 'browser.downloading'
  | 'browser.error'
  | 'command.started'
  | 'command.output'
  | 'command.finished'
  | 'command.failed'
  | 'file.reading'
  | 'file.writing'
  | 'file.patching'
  | 'file.finished'

export type AgentActivitySeverity = 'info' | 'success' | 'warning' | 'error'
export type AgentActivitySurface = 'chat' | 'activity' | 'both'

export interface AgentActivityEvent {
  id: string
  type: AgentActivityType | string
  label: string
  rawSource: string
  runId?: string
  sessionId?: string
  sessionKey?: string
  timestamp: string
  severity: AgentActivitySeverity
  surface: AgentActivitySurface
  collapsed: boolean
  payload?: Record<string, unknown>
  dedupeKey: string
  parentId?: string
}

export interface AgentResponse {
  id: string
  missionId?: string
  agentId: string
  prompt: string
  response: string
  ok: boolean
  timestamp: string
  durationMs: number
  modelId?: string
  remainingCredits?: number
  usagePriority?: 'automnia_first' | 'provider_first' | 'byok_only'
  billingRoute?: 'automnia-first' | 'provider-first' | 'provider-only' | string
  fallbackUsed?: boolean
  streaming?: boolean
  failureKind?: string
  transport?: string
  buffered?: boolean
  runtimeNoticeActive?: boolean
  queuedAt?: string
  startedAt?: string
  firstTokenAt?: string
  completedAt?: string
  tokenCountEstimate?: number
  queuePosition?: number
  queueDepth?: number
  progressLabel?: string
  progressLines?: string[]
  progressUpdatedAt?: string
  progressMode?: 'progress' | 'partial' | 'block'
  activity?: AgentActivityEvent[]
}

export interface AgentTurnAttachment {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  kind: 'image' | 'file'
}

export interface RuntimeTickInput {
  agent: OpenClawAgent
  mission: MissionRun
  tick: number
  runtimePreview: RuntimePreview
}

export interface RuntimeTickResult {
  phase: string
  log: string
  retriesUsed: number
  memoryUsageMb: number
  subtaskBreakdown: SubtaskState[]
  concurrencyUsage: number
  errorCount: number
  xpDelta: number
  completed?: boolean
  acceptanceEvidence?: string[]
}

import type {
  AgentMessage,
  AgentMessageKind,
  CollaborationSession,
  DelegationRequest,
  OpenClawAgent,
  TeamContextBlock,
  WorkspaceClaim,
} from '../types/nexus'

interface CoordinationBusHooks {
  onMessage: (msg: AgentMessage) => void
  onDelegationUpdate: (delegation: DelegationRequest) => void
  onWorkspaceClaim: (claim: WorkspaceClaim) => void
}

function compactTeamText(value: string, max = 100): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function isActiveWorkspaceClaim(claim: WorkspaceClaim): boolean {
  if (!claim.expiresAt) return true
  const expiresAt = new Date(claim.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function includesRecipient(list: string[] | undefined, agentId: string): boolean {
  return Boolean(list?.includes(agentId))
}

function isOpenDelegation(delegation: DelegationRequest): boolean {
  return delegation.status === 'pending' || delegation.status === 'accepted' || delegation.status === 'in_progress'
}

function isDelegationOverdue(delegation: DelegationRequest, now = Date.now()): boolean {
  if (!delegation.deadline || !isOpenDelegation(delegation)) return false
  const deadline = new Date(delegation.deadline).getTime()
  return Number.isFinite(deadline) && deadline <= now
}

/**
 * CoordinationBus — real-time inter-agent messaging, workspace registry,
 * delegation lifecycle, and team context generation.
 *
 * Every agent on a mission can:
 * 1. Send structured messages to specific teammates or broadcast
 * 2. Claim files they're working on (preventing conflicts)
 * 3. Delegate subtasks to specialists with intent confirmation
 * 4. Receive structured team context in every prompt tick
 */
export class CoordinationBus {
  private readonly hooks: CoordinationBusHooks
  private sessions = new Map<string, CollaborationSession>()

  constructor(hooks: CoordinationBusHooks) {
    this.hooks = hooks
  }

  // ── Session Lifecycle ──────────────────────────────────────────

  getOrCreateSession(missionId: string): CollaborationSession {
    const existing = this.sessions.get(missionId)
    if (existing) return existing
    const session: CollaborationSession = {
      missionId,
      startedAt: new Date().toISOString(),
      messages: [],
      workspaceRegistry: [],
      delegations: [],
    }
    this.sessions.set(missionId, session)
    return session
  }

  destroySession(missionId: string): void {
    this.sessions.delete(missionId)
  }

  private activeWorkspaceClaims(missionId: string): WorkspaceClaim[] {
    const session = this.sessions.get(missionId)
    if (!session) return []
    const active = session.workspaceRegistry.filter(isActiveWorkspaceClaim)
    if (active.length !== session.workspaceRegistry.length) {
      session.workspaceRegistry = active
    }
    return active
  }

  private expireOverdueDelegations(session: CollaborationSession): void {
    const now = Date.now()
    for (const delegation of session.delegations) {
      if (!isDelegationOverdue(delegation, now)) continue
      delegation.status = 'rejected'
      delegation.resultSummary = 'Delegation deadline expired before completion; commander should reroute or reissue.'
      this.hooks.onDelegationUpdate(delegation)
    }
  }

  // ── Inter-Agent Messaging ──────────────────────────────────────

  sendMessage(
    missionId: string,
    fromAgentId: string,
    toAgentId: string | null,
    kind: AgentMessageKind,
    intent: string,
    context: string,
    expectedResponse: string,
  ): AgentMessage {
    const session = this.getOrCreateSession(missionId)
    const msg: AgentMessage = {
      id: crypto.randomUUID(),
      missionId,
      fromAgentId,
      toAgentId,
      kind,
      intent,
      context,
      expectedResponse,
      status: 'delivered',
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      completedAt: null,
    }
    session.messages.push(msg)
    // Keep last 200 messages per session
    if (session.messages.length > 200) {
      session.messages = session.messages.slice(-200)
    }
    this.hooks.onMessage(msg)
    return msg
  }

  acknowledgeMessage(missionId: string, messageId: string): AgentMessage | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return null
    msg.status = 'acknowledged'
    msg.acknowledgedAt = new Date().toISOString()
    this.hooks.onMessage(msg)
    return msg
  }

  acknowledgeMessageForAgent(missionId: string, messageId: string, agentId: string): AgentMessage | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return null
    if (msg.toAgentId === null) {
      msg.acknowledgedBy = [...new Set([...(msg.acknowledgedBy || []), agentId])]
      this.hooks.onMessage(msg)
      return msg
    }
    return this.acknowledgeMessage(missionId, messageId)
  }

  completeMessage(missionId: string, messageId: string): AgentMessage | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return null
    msg.status = 'completed'
    msg.completedAt = new Date().toISOString()
    this.hooks.onMessage(msg)
    return msg
  }

  completeMessageForAgent(missionId: string, messageId: string, agentId: string): AgentMessage | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return null
    if (msg.toAgentId === null) {
      msg.completedBy = [...new Set([...(msg.completedBy || []), agentId])]
      this.hooks.onMessage(msg)
      return msg
    }
    return this.completeMessage(missionId, messageId)
  }

  getPendingMessagesFor(missionId: string, agentId: string): AgentMessage[] {
    const session = this.sessions.get(missionId)
    if (!session) return []
    return session.messages.filter(
      (m) => {
        if (m.toAgentId === agentId) return m.status === 'delivered'
        if (m.toAgentId !== null) return false
        if (m.fromAgentId === agentId) return false
        return !includesRecipient(m.acknowledgedBy, agentId) && !includesRecipient(m.completedBy, agentId)
      },
    )
  }

  // ── Workspace Registry ─────────────────────────────────────────

  claimWorkspace(
    missionId: string,
    agentId: string,
    files: string[],
    task: string,
    ttlMinutes = 15,
  ): WorkspaceClaim {
    const session = this.getOrCreateSession(missionId)
    // Remove any existing claim for this agent
    session.workspaceRegistry = session.workspaceRegistry.filter(
      (c) => c.agentId !== agentId,
    )
    const claim: WorkspaceClaim = {
      agentId,
      files: [...new Set(files)],
      task,
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    }
    session.workspaceRegistry.push(claim)
    this.hooks.onWorkspaceClaim(claim)
    return claim
  }

  releaseWorkspace(missionId: string, agentId: string): void {
    const session = this.sessions.get(missionId)
    if (!session) return
    session.workspaceRegistry = session.workspaceRegistry.filter(
      (c) => c.agentId !== agentId,
    )
  }

  getWorkspaceConflicts(missionId: string, files: string[]): string[] {
    const conflicts: string[] = []
    const lowerFiles = new Set(files.map((f) => f.toLowerCase()))
    for (const claim of this.activeWorkspaceClaims(missionId)) {
      for (const claimed of claim.files) {
        if (lowerFiles.has(claimed.toLowerCase())) {
          conflicts.push(`${claimed} (claimed by ${claim.agentId}: ${claim.task})`)
        }
      }
    }
    return conflicts
  }

  getWorkspaceRegistry(missionId: string): WorkspaceClaim[] {
    return this.activeWorkspaceClaims(missionId)
  }

  getWorkspaceClaimForAgent(missionId: string, agentId: string): WorkspaceClaim | null {
    return this.activeWorkspaceClaims(missionId).find((claim) => claim.agentId === agentId) || null
  }

  // ── Delegation Protocol ────────────────────────────────────────

  createDelegation(
    missionId: string,
    fromAgentId: string,
    toAgentId: string,
    task: string,
    context: string,
    deadlineMinutes?: number,
  ): DelegationRequest {
    const session = this.getOrCreateSession(missionId)
    const delegation: DelegationRequest = {
      id: crypto.randomUUID(),
      missionId,
      fromAgentId,
      toAgentId,
      task,
      context,
      deadline: deadlineMinutes
        ? new Date(Date.now() + deadlineMinutes * 60_000).toISOString()
        : null,
      status: 'pending',
      acceptedAt: null,
      completedAt: null,
      resultSummary: null,
    }
    session.delegations.push(delegation)
    if (session.delegations.length > 100) {
      session.delegations = session.delegations.slice(-100)
    }
    // Also send a coordination message
    this.sendMessage(
      missionId,
      fromAgentId,
      toAgentId,
      'delegation',
      task,
      context,
      'Please accept and confirm your approach before executing.',
    )
    this.hooks.onDelegationUpdate(delegation)
    return delegation
  }

  acceptDelegation(missionId: string, delegationId: string): DelegationRequest | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const d = session.delegations.find((x) => x.id === delegationId)
    if (!d) return null
    d.status = 'accepted'
    d.acceptedAt = new Date().toISOString()
    this.hooks.onDelegationUpdate(d)
    return d
  }

  progressDelegation(missionId: string, delegationId: string): DelegationRequest | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const d = session.delegations.find((x) => x.id === delegationId)
    if (!d) return null
    d.status = 'in_progress'
    this.hooks.onDelegationUpdate(d)
    return d
  }

  completeDelegation(
    missionId: string,
    delegationId: string,
    resultSummary: string,
  ): DelegationRequest | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const d = session.delegations.find((x) => x.id === delegationId)
    if (!d) return null
    d.status = 'completed'
    d.completedAt = new Date().toISOString()
    d.resultSummary = resultSummary
    this.hooks.onDelegationUpdate(d)
    return d
  }

  rejectDelegation(
    missionId: string,
    delegationId: string,
    reason: string,
  ): DelegationRequest | null {
    const session = this.sessions.get(missionId)
    if (!session) return null
    const d = session.delegations.find((x) => x.id === delegationId)
    if (!d) return null
    d.status = 'rejected'
    d.resultSummary = reason
    this.hooks.onDelegationUpdate(d)
    return d
  }

  getPendingDelegationsFor(missionId: string, agentId: string): DelegationRequest[] {
    const session = this.sessions.get(missionId)
    if (!session) return []
    this.expireOverdueDelegations(session)
    return session.delegations.filter(
      (d) => d.toAgentId === agentId && d.status === 'pending',
    )
  }

  getActiveDelegationsFor(missionId: string, agentId: string): DelegationRequest[] {
    const session = this.sessions.get(missionId)
    if (!session) return []
    this.expireOverdueDelegations(session)
    return session.delegations.filter(
      (d) => d.toAgentId === agentId && isOpenDelegation(d),
    )
  }

  // ── Team Context Blocks for Prompt Injection ───────────────────

  /**
   * Build a structured team context block for injection into agent prompts.
   * This gives every agent real-time awareness of:
   * - What each teammate is working on
   * - What files are claimed (conflict prevention)
   * - Pending delegations
   * - Messages they haven't acknowledged yet
   */
  buildTeamContext(
    missionId: string,
    agentId: string,
    agents: OpenClawAgent[],
  ): TeamContextBlock {
    const session = this.sessions.get(missionId)
    if (session) this.expireOverdueDelegations(session)
    const workspace = this.activeWorkspaceClaims(missionId)
    const delegations = session?.delegations ?? []
    const messages = session?.messages ?? []

    // ── Roster ──
    const roster = agents
      .map((a, i) => {
        const ownWorkspace = workspace.filter((w) => w.agentId === a.id)
        const ownTask =
          ownWorkspace.length > 0
            ? ` [${ownWorkspace.map((w) => compactTeamText(w.task, 60)).join('; ')}]`
            : ''
        const isLead = i === 0 ? ' commander' : ''
        const canDelegate = a.mds.delegationAllowed ? ' delegate' : ''
        return `L${i + 1}${isLead}: ${a.name} (${a.id})${canDelegate}${ownTask}`
      })
      .join('\n')

    const laneMatrix = agents
      .map((a, i) => {
        const claim = workspace.find((w) => w.agentId === a.id)
        const owned = claim?.files.length ? claim.files.join(', ') : 'unclaimed'
        const activeDelegations = delegations.filter(
          (d) => d.toAgentId === a.id && isOpenDelegation(d),
        )
        const outgoing = delegations.filter(
          (d) => d.fromAgentId === a.id && isOpenDelegation(d),
        )
        const status = activeDelegations.length
          ? `${activeDelegations.length} inbound`
          : outgoing.length
            ? `${outgoing.length} delegated`
            : 'ready'
        return `L${i + 1}${i === 0 ? ' commander' : ''}: ${a.name} (${a.id}) | ${status} | owns ${owned}${claim?.task ? ` | ${compactTeamText(claim.task, 70)}` : ''}`
      })
      .join('\n')

    // ── Workspace Snapshot ──
    const activeClaims = workspace
    const workspaceSnapshot = activeClaims.length
      ? activeClaims
          .map((c) => {
            const a = agents.find((x) => x.id === c.agentId)
            return `${a ? `${a.name} (${a.id})` : c.agentId}: ${c.files.join(', ')} | ${compactTeamText(c.task, 70)}`
          })
          .join('\n')
      : 'No files currently claimed. Claim your files before editing to avoid conflicts.'

    // ── Pending Delegations ──
    const myPending = delegations.filter(
      (d) => d.toAgentId === agentId && isOpenDelegation(d),
    )
    const recentDelegations =
      delegations.length > 0
        ? delegations
            .slice(-8)
            .map((d) => {
              const from = agents.find((a) => a.id === d.fromAgentId)
              const to = agents.find((a) => a.id === d.toAgentId)
              const statusEmoji =
                d.status === 'pending'
                  ? '⏳'
                  : d.status === 'accepted'
                    ? '✅'
                    : d.status === 'in_progress'
                      ? '🔄'
                      : d.status === 'completed'
                        ? '🏁'
                        : '❌'
              const fromLabel = from ? `${from.name} (${from.id})` : d.fromAgentId
              const toLabel = to ? `${to.name} (${to.id})` : d.toAgentId
              return `${statusEmoji} ${fromLabel}->${toLabel}: ${compactTeamText(d.task, 90)} [${d.status}]${d.resultSummary ? ` -> ${compactTeamText(d.resultSummary, 70)}` : ''}`
            })
            .join('\n')
        : 'No active delegations.'

    // ── Recent Messages for this agent ──
    const myMessages = messages
      .filter((m) => {
        if (m.toAgentId === agentId) return true
        if (m.toAgentId !== null) return false
        if (m.fromAgentId === agentId) return false
        return !includesRecipient(m.completedBy, agentId)
      })
      .slice(-6)
    const recentMessages = myMessages.length
      ? myMessages
          .map((m) => {
            const from = agents.find((a) => a.id === m.fromAgentId)
            const statusIcon =
              m.status === 'delivered'
                ? '📨'
                : m.status === 'acknowledged'
                  ? '👁️'
                  : '✅'
            const fromLabel = from ? `${from.name} (${from.id})` : m.fromAgentId
            return `${statusIcon} ${fromLabel}: ${compactTeamText(m.intent, 70)} [${m.kind}] -> ${compactTeamText(m.expectedResponse, 70)}`
          })
          .join('\n')
      : 'No pending messages for you.'

    // ── Conflict Warnings ──
    const conflictWarnings: string[] = []
    const agentClaim = activeClaims.find((c) => c.agentId === agentId)
    if (agentClaim) {
      const conflicts = this.getWorkspaceConflicts(
        missionId,
        agentClaim.files,
      )
      for (const conflict of conflicts) {
        if (!conflict.includes(`(claimed by ${agentId}`)) {
          conflictWarnings.push(`CONFLICT: ${compactTeamText(conflict, 120)}`)
        }
      }
    }
    if (myPending.length > 0) {
      conflictWarnings.push(
        `You have ${myPending.length} pending delegation(s).`,
      )
    }

    const commander = agents[0]
    const openDelegations = delegations.filter(isOpenDelegation)
    const blockedDelegations = delegations.filter((d) => d.status === 'rejected')
    const commanderIntent = commander
      ? `Commander: ${commander.name} (${commander.id}).`
      : 'No commander assigned.'
    const nextActions = [
      myPending.length ? `Execute ${myPending.length} delegation(s).` : '',
      openDelegations.length ? `${openDelegations.length} open delegation(s); report evidence.` : '',
      blockedDelegations.length ? `Commander reroute ${blockedDelegations.length} blocked delegation(s).` : '',
      activeClaims.length ? 'Respect file ownership.' : 'Claim files/lane before editing.',
    ].filter(Boolean)

    return {
      roster,
      laneMatrix,
      workspaceSnapshot,
      recentDelegations,
      recentMessages,
      conflictWarnings,
      commanderIntent,
      nextActions,
    }
  }

  /**
   * Format the team context as injectable prompt text.
   */
  formatTeamContextInjection(block: TeamContextBlock): string {
    const parts: string[] = [
      'TEAM:',
      block.roster,
      'LANES:',
      block.laneMatrix,
      'WORKSPACE:',
      block.workspaceSnapshot,
      'COMMANDER:',
      block.commanderIntent,
      'DELEGATIONS:',
      block.recentDelegations,
      'MESSAGES:',
      block.recentMessages,
    ]

    if (block.conflictWarnings.length > 0) {
      parts.push('WARNINGS:', ...block.conflictWarnings)
    }

    if (block.nextActions.length > 0) {
      parts.push('NEXT:', ...block.nextActions.map((action) => `- ${action}`))
    }

    parts.push(
      'Protocol: slot 1 commands; others execute lane, claim files, report blockers/evidence.',
    )

    return parts.join('\n')
  }
}

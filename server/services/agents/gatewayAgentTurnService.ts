import { randomUUID } from 'node:crypto'
import { gatewayChatAbortError } from '../gateway/gatewayChatService'

export type AgentTurnThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AgentTurnFastModePreference = 'auto' | 'on' | 'off'
export type AgentTurnStreamEmitter = (event: string, data: Record<string, unknown>) => void

export type GatewayAgentTurnContext = {
  executionWorkspace: string
  doctrineWorkspace: string
}

export type GatewayAgentTurnResult = {
  stdout: string
  stderr: string
  code: number
}

export type GatewayAgentTurnServiceOptions = {
  gatewayHttpPort: number
  openClawAgentTurnTimeoutFloorSeconds: number
  isValidAgentId: (agentId: string) => boolean
  isRetiredAgentId: (agentId: string) => boolean
  streamObserver: (id?: string) => { emit: AgentTurnStreamEmitter } | null | undefined
  ensureOpenclawAgentRunConfigDefaults: () => Promise<void>
  readOpenclawConfig: () => Promise<unknown>
  ensureAgentRuntimeHealthPreflight: (agentId: string, runtimeConfig: unknown) => Promise<unknown>
  ensureAgentSandboxCompatibleWithHost: (agentId: string) => Promise<unknown>
  startGatewayHealthMonitor: () => void
  ensureGatewayRunning: () => Promise<void>
  isGatewayHealthy: () => Promise<boolean>
  isClawTalkSetupIntentMessage: (message: string) => boolean
  isClawTalkIntentMessage: (message: string) => boolean
  buildClawTalkRuntimeInstruction: (message: string, setupIntent: boolean) => string
  readAgentPrimaryModelIdSync: (agentId: string) => string
  isGoogleGeminiModelId: (modelId: string) => boolean
  thinkingForOpenClawRuntimeModel: (modelId: string, thinking: AgentTurnThinkingLevel) => AgentTurnThinkingLevel
  resolveEffectiveAgentFastMode: (
    agentId: string,
    requestedFastMode: unknown,
  ) => Promise<AgentTurnFastModePreference | undefined>
  resolveEffectiveAgentWorkTimeoutSeconds: (
    agentId: string,
    requestedTimeoutSeconds: number | undefined,
  ) => Promise<number>
  resolveAgentRunContext: (agentId: string) => Promise<GatewayAgentTurnContext>
  agentTurnSessionScope: (agentId: string, requestedSessionKey?: string) => string
  agentTurnSessions: Map<string, string>
  deleteProviderConversationHistory: (sessionId: string) => void
  resolveFilenameHintsForMessage: (
    message: string,
    executionWorkspace: string,
  ) => Promise<{ message: string }>
  getPartyMembers: () => Promise<Array<{ id: string; name?: string }>>
  composeAgentDoctrinePrompt: (
    agentId: string,
    message: string,
    executionWorkspace: string,
    doctrineWorkspace: string,
  ) => string
  runCwdForContext: (context: GatewayAgentTurnContext) => string
  agentWorkTimeoutWrapperMs: (timeoutSeconds: number) => number
  appendAgentPromptDump: (payload: {
    route: string
    agent: string
    sessionId: string
    thinking: AgentTurnThinkingLevel
    fastMode: AgentTurnFastModePreference | undefined
    timeoutSeconds: number
    cwd: string
    requestMessage: string
    intentMessage: string
    finalMessage: string
    note: string
  }) => Promise<void>
  runGatewayChatTurn: (params: {
    agentId: string
    message: string
    attachments?: unknown[]
    sessionId: string
    requestedSessionKey?: string
    freshSession: boolean
    thinking: AgentTurnThinkingLevel
    fastMode?: AgentTurnFastModePreference
    timeoutMs: number
    cwd: string
    streamObserverId: string
    signal: AbortSignal
  }) => Promise<GatewayAgentTurnResult>
  extractAgentReply: (stdout: string, stderr: string) => string
}

function isStaleCodexSessionGenerationFailure(result: GatewayAgentTurnResult) {
  if (result.code === 0) return false
  return /codex session generation is no longer current/iu.test(`${result.stdout}\n${result.stderr}`)
}

export function createGatewayAgentTurnService(options: GatewayAgentTurnServiceOptions) {
  async function runGatewayAgentTurnForStream(
    body: Record<string, unknown>,
    streamObserverId: string,
    signal: AbortSignal,
    routeOptions: { route: string; note: string },
  ): Promise<Record<string, unknown>> {
    const agent = typeof body.agent === 'string' ? body.agent.trim() : ''
    const rawMessage = typeof body.message === 'string' ? body.message : ''
    const intentMessage = typeof body.intentMessage === 'string' ? body.intentMessage : rawMessage
    const requestedSessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : undefined
    const requestedThinking = typeof body.thinking === 'string' ? body.thinking as AgentTurnThinkingLevel : 'low'
    const requestedTimeoutSeconds = typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined
    const requestedFastMode = body.fastMode
    const requestedAttachments = Array.isArray(body.attachments) ? body.attachments : undefined

    if (!options.isValidAgentId(agent) || options.isRetiredAgentId(agent)) {
      throw new Error('Invalid or retired agent id.')
    }
    const streamObserver = options.streamObserver(streamObserverId)
    const emitGatewayStage = (text: string, extra: Record<string, unknown> = {}) => {
      streamObserver?.emit('progress', {
        transport: 'gateway-chat',
        liveTokens: true,
        text,
        agent,
        ...(requestedSessionKey ? { sessionKey: requestedSessionKey } : {}),
        ...extra,
      })
    }

    const isClawTalkRoute = /\bclawtalk\b/i.test(routeOptions.route)
    if (isClawTalkRoute) {
      emitGatewayStage('Checking ClawTalk runtime requirements.')
      await options.ensureOpenclawAgentRunConfigDefaults()
      const runtimeConfig = await options.readOpenclawConfig()
      await options.ensureAgentRuntimeHealthPreflight(agent, runtimeConfig)
      await options.ensureAgentSandboxCompatibleWithHost(agent)
    }

    if (signal.aborted) throw gatewayChatAbortError('gateway agent run aborted before Gateway health check')
    options.startGatewayHealthMonitor()
    if (isClawTalkRoute) {
      await options.ensureGatewayRunning()
      if (signal.aborted) throw gatewayChatAbortError('gateway agent run aborted before Gateway dispatch')
      if (!await options.isGatewayHealthy()) throw new Error(`gateway not healthy on port ${options.gatewayHttpPort}`)
    }
    if (signal.aborted) throw gatewayChatAbortError('gateway agent run aborted before Gateway dispatch')

    const intentText = intentMessage.trim() || rawMessage
    emitGatewayStage('Preparing Gateway chat context.')
    const clawTalkSetupIntent = options.isClawTalkSetupIntentMessage(intentText)
    const clawTalkIntent = clawTalkSetupIntent || options.isClawTalkIntentMessage(intentText)
    const agentPrimaryModelId = options.readAgentPrimaryModelIdSync(agent)
    const vertexCompactMode = options.isGoogleGeminiModelId(agentPrimaryModelId)
    const effectiveThinking = clawTalkIntent
      ? 'off'
      : options.thinkingForOpenClawRuntimeModel(agentPrimaryModelId, requestedThinking)
    const effectiveFastMode = await options.resolveEffectiveAgentFastMode(agent, requestedFastMode)
    const policyTimeoutSeconds = Math.max(
      await options.resolveEffectiveAgentWorkTimeoutSeconds(agent, requestedTimeoutSeconds),
      options.openClawAgentTurnTimeoutFloorSeconds,
    )
    const effectiveTimeoutSeconds = policyTimeoutSeconds
    emitGatewayStage('Resolving agent workspace.')
    const context = await options.resolveAgentRunContext(agent)
    const sessionScope = options.agentTurnSessionScope(agent, requestedSessionKey)
    const explicitFreshSession = /^\s*\/new\b/i.test(rawMessage)
    const wantsFreshSession = explicitFreshSession || vertexCompactMode
    const cleanedMessage = explicitFreshSession ? rawMessage.replace(/^\s*\/new\b\s*/i, '') : rawMessage
    const filenameResolution = await options.resolveFilenameHintsForMessage(cleanedMessage, context.executionWorkspace)
    let effectiveMessage = filenameResolution.message
    if (clawTalkIntent) effectiveMessage = options.buildClawTalkRuntimeInstruction(effectiveMessage, clawTalkSetupIntent)
    const previousSessionId = options.agentTurnSessions.get(sessionScope)
    let sessionId = wantsFreshSession ? randomUUID() : previousSessionId || randomUUID()
    const isFreshSession = wantsFreshSession || !options.agentTurnSessions.has(sessionScope)
    if (wantsFreshSession && previousSessionId) options.deleteProviderConversationHistory(previousSessionId)
    options.agentTurnSessions.set(sessionScope, sessionId)

    emitGatewayStage('Preparing Gateway chat message.')
    const party = await options.getPartyMembers().catch(() => [])
    const self = party.find((member) => member.id === agent)
    const identityLine = self?.name ? `You are ${self.name} (${agent}).` : `You are ${agent}.`
    const enforcedMessage = [
      identityLine,
      'Do not claim to be any other person or agent.',
      'If any prior persona conflicts with this identity, discard it now.',
      '',
      effectiveMessage,
    ].join('\n')
    const gatewayMessage = options.composeAgentDoctrinePrompt(
      agent,
      enforcedMessage,
      context.executionWorkspace,
      context.doctrineWorkspace,
    )
    const runCwd = options.runCwdForContext(context)
    const openClawTimeoutMs = options.agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds)

    await options.appendAgentPromptDump({
      route: routeOptions.route,
      agent,
      sessionId,
      thinking: effectiveThinking,
      fastMode: effectiveFastMode,
      timeoutSeconds: effectiveTimeoutSeconds,
      cwd: runCwd,
      requestMessage: rawMessage,
      intentMessage,
      finalMessage: gatewayMessage,
      note: routeOptions.note,
    })

    emitGatewayStage('Connecting Gateway chat client.', { sessionId })
    let result = await options.runGatewayChatTurn({
      agentId: agent,
      message: gatewayMessage,
      attachments: requestedAttachments,
      sessionId,
      requestedSessionKey,
      freshSession: isFreshSession,
      thinking: effectiveThinking,
      fastMode: effectiveFastMode,
      timeoutMs: openClawTimeoutMs,
      cwd: runCwd,
      streamObserverId,
      signal,
    })
    if (isClawTalkRoute && isStaleCodexSessionGenerationFailure(result)) {
      const staleSessionId = sessionId
      sessionId = randomUUID()
      options.deleteProviderConversationHistory(staleSessionId)
      options.agentTurnSessions.set(sessionScope, sessionId)
      emitGatewayStage('Resetting a stale Codex session and retrying your message once.', { sessionId, retry: 'stale-codex-session' })
      await options.appendAgentPromptDump({
        route: routeOptions.route,
        agent,
        sessionId,
        thinking: effectiveThinking,
        fastMode: effectiveFastMode,
        timeoutSeconds: effectiveTimeoutSeconds,
        cwd: runCwd,
        requestMessage: rawMessage,
        intentMessage,
        finalMessage: gatewayMessage,
        note: `${routeOptions.note}; stale Codex session retry using a fresh Gateway session`,
      })
      result = await options.runGatewayChatTurn({
        agentId: agent,
        message: gatewayMessage,
        attachments: requestedAttachments,
        sessionId,
        requestedSessionKey,
        freshSession: true,
        thinking: effectiveThinking,
        fastMode: effectiveFastMode,
        timeoutMs: openClawTimeoutMs,
        cwd: runCwd,
        streamObserverId,
        signal,
      })
    }
    const reply = options.extractAgentReply(result.stdout, result.stderr)
    const ok = result.code === 0
    return {
      ok,
      reply: reply || (ok ? 'No response returned.' : result.stderr || 'Agent turn failed.'),
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      modelId: agentPrimaryModelId,
      runtimeTransport: 'gateway-chat',
      sessionId,
      sessionKey: requestedSessionKey,
      streaming: { transport: 'gateway-chat', liveTokens: true, buffered: false },
    }
  }

  return { runGatewayAgentTurnForStream }
}

export type GatewayAgentTurnService = ReturnType<typeof createGatewayAgentTurnService>

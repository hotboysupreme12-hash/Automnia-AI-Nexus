import type { Express, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type StreamEmitter = (event: string, data: Record<string, unknown>) => void

type AgentRuntimePreflightCheck = {
  id: string
  label: string
  ok: boolean
  severity: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}

type ClawTalkConsoleMirrorContext = {
  clawTalkRunId: string
  agentId: string
  sessionKey: string
  prompt: string
  terminalEmitted?: boolean
  updatedAt?: number
}

type AgentRuntimeShortcut = {
  command: 'work' | 'runtime' | 'openclaw'
  message: string
}

type AgentRunContext = {
  executionWorkspace: string
  doctrineWorkspace: string
}

type OpenClawResultLike = {
  stdout: string
  stderr: string
  code: number
  failureKind?: string
  runtimeTransport?: 'gateway-chat' | 'gateway' | 'local' | string
  gatewayFallbackDetail?: unknown
}

type FailureStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted'

type DelegationIntent = {
  targetRef: string
  instruction: string
}

type DelegationHandoffPayload = {
  ok?: unknown
  reply?: unknown
  to?: { reply?: unknown }
  handoffId?: unknown
}

type PartyMember = {
  id: string
  name?: string
  aliases?: string[]
}

type AgentToAgentPolicy = {
  enabled: boolean
  allow: string[]
}

type AgentRuntimeTurnParams = {
  agentId: string
  message: string
  context: AgentRunContext
  args: string[]
  timeoutMs: number
  cwd: string
  envOverrides?: Record<string, string>
  signal?: AbortSignal
  retry?: boolean
  gatewayChat?: {
    enabled: boolean
    sessionId: string
    requestedSessionKey?: string
    freshSession?: boolean
    thinking: ThinkingLevel
    message: string
    attachments?: unknown[]
    streamObserverId?: string
  }
}

type AgentTurnStreamInput = {
  agent: string
  message: string
  intentMessage?: string
  displayPrompt?: string
  source?: 'clawtalk'
  sessionKey?: string
  thinking: ThinkingLevel
  timeoutSeconds?: number
  attachments?: unknown[]
  forceOpenClawRuntime?: boolean
}

type BrowserPreflightResult = {
  ok: boolean
  message: string
  detail?: string
}

type HostActionRequest = {
  kind: 'launch-chrome' | string
  url?: string
}

type HostLaunchResult = {
  ok: boolean
  command?: unknown
  detail?: unknown
}

type FilenameResolution = {
  message: string
  notes: string[]
}

type GoogleGeminiArtifactTarget = {
  absolutePath: string
  relativePath: string
}

type GoogleGeminiArtifactFallback = {
  target: GoogleGeminiArtifactTarget
  contentLength: number
  reply: string
}

type GoogleGeminiArtifactFallbackParams = {
  agentId: string
  modelId: string
  thinking: ThinkingLevel
  message: string
  context: AgentRunContext
  envOverrides?: Record<string, string>
  signal?: AbortSignal
}

type AgentTurnRoutesOptions = {
  AUTH_TOKEN: string
  CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK: boolean
  ENABLE_HOST_ACTION_SHORTCUTS: boolean
  MIN_BROWSER_TIMEOUT_SECONDS: number
  OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS: number
  OPENCLAW_STATE_ROOT: string
  OPENCLAW_TIMEOUT_RECOVERY_SECONDS: number
  PORT: number
  SSE_DELTA_CHUNK_CHARS: number
  SSE_FINAL_TEXT_LIMIT: number
  agentRuntimeContextPayload(agent: string, context: AgentRunContext): unknown
  agentTurnSessionScope(agent: string, sessionKey?: string): string
  agentTurnSessions: Map<string, string>
  agentWorkTimeoutWrapperMs(timeoutSeconds: number): number
  appendAgentDailyMemory(agent: string, entry: string): Promise<unknown>
  appendAgentPromptDump(payload: Record<string, unknown>): Promise<unknown>
  buildBrowserRecoveryInstruction(message: string): string
  buildClawTalkRuntimeInstruction(message: string, setupIntent: boolean): string
  buildDoctrineSyncReport(agent: string, workspace: string): Promise<unknown>
  buildRuntimeTimeoutContinuationInstruction(message: string, timeoutSeconds: number): string
  checkBrowserPreflight(agent?: string): Promise<BrowserPreflightResult>
  classifyFailureKind(message: string, fallback?: FailureStatus | null): string | undefined
  cleanupDoctrineMirrorsAfterRun(agent: string, workspace: string): Promise<unknown>
  cleanupOpenClawSessionLocks(options: { agentId?: string; all?: boolean; minAgeMs: number; reason: string }): Promise<{ scanned: number; removed: unknown[]; errors: unknown[] }>
  clearAgentTurnSessions(agent?: string): { sessions: number; histories: number }
  compactClawTalkConsoleValue(value: string, maxChars?: number): string
  compactFinalSsePayload(payload: Record<string, unknown>, liveTextStreamed: boolean): Record<string, unknown>
  compactHttpJsonPayload(payload: Record<string, unknown>): Record<string, unknown>
  composeAgentDoctrinePrompt(agent: string, message: string, executionWorkspace: string, doctrineWorkspace: string): string
  delayMs(ms: number): Promise<unknown>
  detectHostActionRequest(message: string): HostActionRequest | null
  emitClawTalkConsoleFrame(event: string, context: ClawTalkConsoleMirrorContext, payload: Record<string, unknown>): boolean
  ensureAgentRuntimeHealthPreflight(agent: string, config: unknown): Promise<AgentRuntimePreflightCheck[]>
  ensureAgentSandboxCompatibleWithHost(agent: string): Promise<{ changed: boolean; message: string; local: { sandbox: { mode?: string } } }>
  ensureOpenclawAgentRunConfigDefaults(): Promise<unknown>
  extractAgentReply(stdout: string, stderr: string): string
  fileExists(filePath: string): Promise<boolean>
  getAgentAuthEnv(agent: string): Promise<Record<string, string> | undefined>
  getAgentToAgentPolicy(): Promise<AgentToAgentPolicy>
  getPartyMembers(): Promise<PartyMember[]>
  hasBrowserRelayDisconnected(value: string): boolean
  hasBrowserRelayPortConflict(value: string): boolean
  initializeSseResponse(res: Response): void
  isAgentAllowedByPolicy(agent: string, allow: string[]): boolean
  isAgentRuntimeTimeoutResult(result: OpenClawResultLike, reply: string): boolean
  isBrowserServiceReadyOnlyReply(reply: string): boolean
  isClawTalkIntentMessage(message: string): boolean
  isClawTalkSetupIntentMessage(message: string): boolean
  isContextOverflowReply(reply: string): boolean
  isEmptyAgentNoResponseReply(reply: string): boolean
  isGoogleGeminiModelId(modelId: string): boolean
  isHostedCreditsActive?: () => boolean
  hostedUsagePriority?: () => 'automnia_first' | 'provider_first' | null
  isRetiredAgentId(agent: string): boolean
  isValidAgentId(agent: string): boolean
  launchChromeHost(url?: string): Promise<HostLaunchResult>
  openClawErrorResult(error: unknown): OpenClawResultLike
  parseAgentRuntimeShortcut(message: string): AgentRuntimeShortcut | null
  parseDelegationIntent(message: string): DelegationIntent | null
  providerConversationHistories: Map<string, unknown>
  readAgentPrimaryModelIdSync(agent: string): string
  readOpenclawConfig(): Promise<unknown>
  redactHiddenReasoningAndSecrets(value: string): string
  redactSensitiveText(value: string): string
  rememberClawTalkConsoleMirror(context: ClawTalkConsoleMirrorContext): void
  resolveAgentReference(targetRef: string, party: PartyMember[], sourceAgentId?: string): PartyMember | null
  resolveAgentRunContext(agent: string): Promise<AgentRunContext>
  resolveEffectiveAgentWorkTimeoutSeconds(agent: string, requested?: number): Promise<number>
  resolveFilenameHintsForMessage(message: string, workspace: string): Promise<FilenameResolution>
  resolveGoogleGeminiArtifactTarget(message: string, workspace: string): GoogleGeminiArtifactTarget | null
  runControlCenterAgentRuntimeTurn(params: AgentRuntimeTurnParams): Promise<OpenClawResultLike>
  runCwdForContext(context: AgentRunContext): string
  runtimeTimeoutResumeAdvice(agent: string, sessionId: string): string
  shouldRouteBrowserIntentThroughBrowserPlugin(message: string, hostAction: HostActionRequest | null): Promise<boolean>
  shouldUseGoogleGeminiMinimalToolWriteRuntime(agent: string, message: string): boolean
  splitTextForSse(text: string): string[]
  streamProviderAgentTurn(input: AgentTurnStreamInput, emit: StreamEmitter, signal: AbortSignal): Promise<Record<string, unknown>>
  thinkingForOpenClawRuntimeModel(modelId: string, thinking: ThinkingLevel): ThinkingLevel
  trimTask(value: string, maxChars: number): string
  tryGoogleGeminiDirectArtifactWriteFallback(params: GoogleGeminiArtifactFallbackParams): Promise<GoogleGeminiArtifactFallback | null>
  tryReleaseBrowserRelayPort(): Promise<{ released: boolean }>
  tryRestartGatewayService(options?: { reason?: string }): Promise<{ restarted: boolean }>
  unwrapCanonicalApiPayload(payload: unknown): unknown
  withRuntimeTimeoutResumeAdvice(reply: string, agent: string, sessionId: string): string
  writeSseEvent(res: Response, event: string, data: Record<string, unknown>): void
}

export function registerAgentTurnRoutes(app: Express, options: AgentTurnRoutesOptions) {
  const {
    AUTH_TOKEN,
    CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK,
    ENABLE_HOST_ACTION_SHORTCUTS,
    MIN_BROWSER_TIMEOUT_SECONDS,
    OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS,
    OPENCLAW_STATE_ROOT,
    OPENCLAW_TIMEOUT_RECOVERY_SECONDS,
    PORT,
    SSE_DELTA_CHUNK_CHARS,
    SSE_FINAL_TEXT_LIMIT,
    agentRuntimeContextPayload,
    agentTurnSessionScope,
    agentTurnSessions,
    agentWorkTimeoutWrapperMs,
    appendAgentDailyMemory,
    appendAgentPromptDump,
    buildBrowserRecoveryInstruction,
    buildClawTalkRuntimeInstruction,
    buildDoctrineSyncReport,
    buildRuntimeTimeoutContinuationInstruction,
    checkBrowserPreflight,
    classifyFailureKind,
    cleanupDoctrineMirrorsAfterRun,
    cleanupOpenClawSessionLocks,
    clearAgentTurnSessions,
    compactClawTalkConsoleValue,
    compactFinalSsePayload,
    compactHttpJsonPayload,
    composeAgentDoctrinePrompt,
    delayMs,
    detectHostActionRequest,
    emitClawTalkConsoleFrame,
    ensureAgentRuntimeHealthPreflight,
    ensureAgentSandboxCompatibleWithHost,
    ensureOpenclawAgentRunConfigDefaults,
    extractAgentReply,
    fileExists,
    getAgentAuthEnv,
    getAgentToAgentPolicy,
    getPartyMembers,
    hasBrowserRelayDisconnected,
    hasBrowserRelayPortConflict,
    initializeSseResponse,
    isAgentAllowedByPolicy,
    isAgentRuntimeTimeoutResult,
    isBrowserServiceReadyOnlyReply,
    isClawTalkIntentMessage,
    isClawTalkSetupIntentMessage,
    isContextOverflowReply,
    isEmptyAgentNoResponseReply,
    isGoogleGeminiModelId,
    isHostedCreditsActive,
    hostedUsagePriority,
    isRetiredAgentId,
    isValidAgentId,
    launchChromeHost,
    openClawErrorResult,
    parseAgentRuntimeShortcut,
    parseDelegationIntent,
    providerConversationHistories,
    readAgentPrimaryModelIdSync,
    readOpenclawConfig,
    redactHiddenReasoningAndSecrets,
    redactSensitiveText,
    rememberClawTalkConsoleMirror,
    resolveAgentReference,
    resolveAgentRunContext,
    resolveEffectiveAgentWorkTimeoutSeconds,
    resolveFilenameHintsForMessage,
    resolveGoogleGeminiArtifactTarget,
    runControlCenterAgentRuntimeTurn,
    runCwdForContext,
    runtimeTimeoutResumeAdvice,
    shouldRouteBrowserIntentThroughBrowserPlugin,
    shouldUseGoogleGeminiMinimalToolWriteRuntime,
    splitTextForSse,
    streamProviderAgentTurn,
    thinkingForOpenClawRuntimeModel,
    trimTask,
    tryGoogleGeminiDirectArtifactWriteFallback,
    tryReleaseBrowserRelayPort,
    tryRestartGatewayService,
    unwrapCanonicalApiPayload,
    withRuntimeTimeoutResumeAdvice,
    writeSseEvent,
  } = options

  app.post('/api/openclaw/agent-preflight', async (req, res) => {
    const schema = z.object({ agent: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const agent = parsed.data.agent
    if (!isValidAgentId(agent) || isRetiredAgentId(agent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid or retired agent id.')
    }

    try {
      await ensureOpenclawAgentRunConfigDefaults()
      const config = await readOpenclawConfig()
      const healthChecks = await ensureAgentRuntimeHealthPreflight(agent, config)
      const sandbox = await ensureAgentSandboxCompatibleWithHost(agent)
      return apiSuccess(res, {
        agent,
        checks: [
          ...healthChecks,
          {
            ok: true,
            severity: sandbox.changed ? 'warning' : 'info',
            id: 'sandbox',
            label: 'Sandbox',
            message: sandbox.changed ? sandbox.message : 'Agent runtime preflight passed.',
          },
        ],
        sandbox: {
          mode: sandbox.local.sandbox.mode || 'off',
          autoDisabled: sandbox.changed,
        },
      })
    } catch (error) {
      const message = `Agent runtime preflight failed for ${agent}: ${String(error)}`
      return apiFailure(res, 500, 'agent_preflight_failed', message, {
        checks: (error as Error & { checks?: AgentRuntimePreflightCheck[] }).checks,
      })
    }
  })

  app.post('/api/openclaw/agent-turn/sessions/clear', async (req, res) => {
    const schema = z.object({ agent: z.string().min(1).optional() }).optional()
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const agent = parsed.data?.agent?.trim()
    try {
      const cleared = clearAgentTurnSessions(agent || undefined)
      const lockCleanup = await cleanupOpenClawSessionLocks({
        agentId: agent || undefined,
        all: !agent,
        minAgeMs: 0,
        reason: 'agent session cache clear',
      })
      return apiSuccess(res, {
        cleared,
        scope: agent ? 'agent' : 'all',
        sessionLockCleanup: {
          scanned: lockCleanup.scanned,
          removed: lockCleanup.removed.length,
          errors: lockCleanup.errors.length,
        },
      })
    } catch (error) {
      return apiFailure(res, 500, 'agent_session_operation_failed', 'Failed to clear agent turn sessions', String(error))
    }
  })

  app.post('/api/openclaw/agent-turn/stream', async (req, res) => {
    const schema = z.object({
      agent: z.string().min(1),
      message: z.string().min(1),
      intentMessage: z.string().optional(),
      displayPrompt: z.string().optional(),
      source: z.enum(['clawtalk']).optional(),
      sessionKey: z.string().min(1).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      attachments: z.array(z.unknown()).optional(),
      forceOpenClawRuntime: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    initializeSseResponse(res)
    const abortController = new AbortController()
    const clawTalkMirror = parsed.data.source === 'clawtalk'
      ? {
          clawTalkRunId: randomUUID(),
          agentId: parsed.data.agent.trim(),
          sessionKey: parsed.data.sessionKey?.trim() || `clawtalk:${parsed.data.agent.trim()}`,
          prompt: compactClawTalkConsoleValue(parsed.data.displayPrompt || parsed.data.intentMessage || parsed.data.message, 4000),
        } satisfies ClawTalkConsoleMirrorContext
      : null
    if (clawTalkMirror) rememberClawTalkConsoleMirror(clawTalkMirror)
    let closed = false
    let liveTextStreamed = false
    res.on('close', () => {
      closed = true
      abortController.abort()
    })
    const emit: StreamEmitter = (event, data) => {
      if (event === 'delta' && typeof data.text === 'string') {
        const text = data.text
        if (text) liveTextStreamed = true
        if (text.length > SSE_DELTA_CHUNK_CHARS) {
          for (const chunk of splitTextForSse(text)) {
            if (!chunk) continue
            const chunkPayload = { ...data, text: chunk, chunked: true }
            if (clawTalkMirror) emitClawTalkConsoleFrame(event, clawTalkMirror, chunkPayload)
            if (closed) continue
            writeSseEvent(res, event, chunkPayload)
          }
          return
        }
      }
      if (clawTalkMirror) emitClawTalkConsoleFrame(event, clawTalkMirror, data)
      if (closed) return
      writeSseEvent(res, event, data)
      res.flushHeaders?.()
    }

    try {
      const streamAgent = parsed.data.agent.trim()
      if (!isValidAgentId(streamAgent) || isRetiredAgentId(streamAgent)) {
        emit('error', { message: 'Invalid or retired agent id.', failureKind: 'validation' })
        emit('final', compactFinalSsePayload({
          ok: false,
          reply: 'Invalid or retired agent id.',
          stderr: 'Invalid or retired agent id.',
          code: 1,
          failureKind: 'validation',
          streaming: { transport: 'control-center-sse', liveTokens: false },
        }, liveTextStreamed))
        return
      }
      const streamSmokeMode = CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK
        ? (req.get('x-control-center-stream-smoke') || '').trim().toLowerCase()
        : ''
      if (streamSmokeMode === 'abort') {
        const runId = randomUUID()
        const sessionKey = parsed.data.sessionKey?.trim() || `agent:${streamAgent}:control-center:smoke-abort`
        emit('status', {
          transport: 'gateway-chat',
          mode: 'progress',
          label: 'OpenClaw session',
          message: 'Gateway accepted the live chat run.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        await new Promise<void>((resolve) => {
          if (abortController.signal.aborted) {
            resolve()
            return
          }
          const timer = setTimeout(resolve, 5000)
          abortController.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        writeFileSync(
          path.join(OPENCLAW_STATE_ROOT, 'agent-turn-stream-smoke-abort.json'),
          `${JSON.stringify({
            aborted: abortController.signal.aborted,
            agent: streamAgent,
            runId,
            sessionKey,
            transport: 'gateway-chat',
            reason: closed ? 'client-close' : 'timeout',
            closed,
          })}\n`,
          'utf-8',
        )
        return
      }
      if (streamSmokeMode === 'failure' || streamSmokeMode === 'fail') {
        const runId = randomUUID()
        const sessionKey = parsed.data.sessionKey?.trim() || `agent:${streamAgent}:control-center:smoke-failure`
        emit('status', {
          transport: 'gateway-chat',
          mode: 'progress',
          label: 'OpenClaw session',
          message: 'Command accepted; opening the Gateway-backed OpenClaw session.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        emit('progress', {
          transport: 'gateway-chat',
          text: 'Runtime ready; dispatching through Gateway chat.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        throw new Error([
          'Gateway transport error: simulated Command Console failure.',
          'Gateway unavailable while dispatching the command.',
          'api_key=phasek-failed-command-key-123456',
          'Authorization: Bearer phase-k-failed-command-bearer-123456',
          'phasek.operator@example.com',
          '+1 (555) 010-1280',
          'C:\\Users\\PhaseK\\AppData\\Local\\Automnia\\secret.txt',
          'Cookie: automnia_session=phase-k-failed-command-cookie-123456',
        ].join(' '))
      }
      if (streamSmokeMode && /^(1|true|yes|success)$/i.test(streamSmokeMode)) {
        const runId = randomUUID()
        const sessionKey = parsed.data.sessionKey?.trim() || `agent:${streamAgent}:control-center:smoke`
        emit('status', {
          transport: 'gateway-chat',
          mode: 'progress',
          label: 'OpenClaw session',
          message: 'Command accepted; opening the Gateway-backed OpenClaw session.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        emit('progress', {
          transport: 'gateway-chat',
          text: 'Runtime ready; dispatching through Gateway chat.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        emit('delta', {
          transport: 'gateway-chat',
          text: 'Draft gateway reply.',
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        emit('delta', {
          transport: 'gateway-chat',
          text: 'Mock gateway reply complete.',
          replace: true,
          agent: streamAgent,
          sessionKey,
          runId,
          liveTokens: true,
        })
        emit('final', compactFinalSsePayload({
          ok: true,
          reply: 'Mock gateway reply complete.',
          stdout: 'Mock gateway reply complete.',
          stderr: '',
          code: 0,
          agent: streamAgent,
          sessionKey,
          runId,
          streaming: { transport: 'gateway-chat', liveTokens: true },
        }, liveTextStreamed))
        return
      }
      const hostedCreditRoute = Boolean(isHostedCreditsActive?.())
      // Hosted turns use the same Gateway transport as BYOK. Automnia is the
      // selected OpenClaw model provider, so the Gateway owns the complete
      // tool loop and the provider charges each model request.
      const initialTransport = 'gateway-chat'
      const providerFirst = hostedCreditRoute && hostedUsagePriority?.() === 'provider_first'
      const cloudFirst = hostedCreditRoute && !providerFirst
      const gatewayRoute = hostedCreditRoute || providerFirst || parsed.data.forceOpenClawRuntime
      const hostedBrowserIntent = hostedCreditRoute
        ? await shouldRouteBrowserIntentThroughBrowserPlugin(parsed.data.intentMessage?.trim() || parsed.data.message, null)
        : false
      if (hostedBrowserIntent) {
        // Hosted browser turns use the same local browser-service readiness
        // checks as BYOK, but skip the model-backed probe so readiness does
        // not consume a second Automnia request before the actual turn.
        const preflight = await checkBrowserPreflight()
        if (!preflight.ok) throw new Error(`${preflight.message}${preflight.detail ? `\n${preflight.detail}` : ''}`)
      }
      emit('status', {
        transport: initialTransport,
        mode: 'progress',
        label: cloudFirst ? 'Automnia credits via Gateway' : providerFirst ? 'My provider first' : gatewayRoute ? 'OpenClaw session' : 'Command Console',
        message: cloudFirst
          ? 'Automnia credits enabled; opening the Gateway provider session.'
          : providerFirst
            ? 'Subscriber preference enabled; the Gateway will try your connected provider before Automnia credits.'
            : gatewayRoute
              ? 'BYOK/runtime request accepted; opening the Gateway-backed OpenClaw session.'
              : 'Command accepted; preparing the agent session.',
        agent: streamAgent,
        ...(parsed.data.sessionKey ? { sessionKey: parsed.data.sessionKey.trim() } : {}),
        liveTokens: gatewayRoute,
      })
      const forcedGatewayConsoleTurn = gatewayRoute && parsed.data.source !== 'clawtalk'
      emit('progress', {
        transport: initialTransport,
        text: cloudFirst
          ? 'Automnia provider route confirmed; dispatching through Gateway chat.'
          : providerFirst
            ? 'Opening the Gateway model route with Automnia fallback available.'
            : forcedGatewayConsoleTurn
              ? 'Opening Gateway chat session with your configured provider.'
            : 'Checking runtime health and workspace access.',
        agent: streamAgent,
        ...(parsed.data.sessionKey ? { sessionKey: parsed.data.sessionKey.trim() } : {}),
      })
      if (!hostedCreditRoute && !forcedGatewayConsoleTurn) {
        await ensureOpenclawAgentRunConfigDefaults()
        const config = await readOpenclawConfig()
        await ensureAgentRuntimeHealthPreflight(streamAgent, config)
        await ensureAgentSandboxCompatibleWithHost(streamAgent)
      }
      emit('progress', {
        transport: initialTransport,
        text: cloudFirst
          ? 'Gateway route ready; dispatching through Automnia credits.'
          : providerFirst
            ? 'Provider-first Gateway route ready; Automnia credits remain available as fallback.'
          : gatewayRoute
            ? 'Runtime ready; dispatching through your Gateway provider.'
            : 'Runtime ready; dispatching agent turn.',
        agent: streamAgent,
        ...(parsed.data.sessionKey ? { sessionKey: parsed.data.sessionKey.trim() } : {}),
      })
      await delayMs(0)
      const hostedInput = hostedBrowserIntent ? { ...parsed.data, thinking: 'off' as const } : parsed.data
      const payload = await streamProviderAgentTurn(hostedInput, emit, abortController.signal)
      emit('final', compactFinalSsePayload(payload, liveTextStreamed))
    } catch (error) {
      const message = redactHiddenReasoningAndSecrets(String(error))
      const failureKind = classifyFailureKind(message, abortController.signal.aborted ? 'aborted' : 'failed') || 'unknown'
      const failureTransport = isHostedCreditsActive?.()
        ? 'gateway-chat'
        : parsed.data.forceOpenClawRuntime
          ? 'gateway-chat'
          : 'control-center-sse'
      const clawTalkFallbackPending = Boolean(clawTalkMirror && closed && abortController.signal.aborted && failureKind === 'aborted')
      if (clawTalkFallbackPending) {
        emit('status', {
          transport: 'clawtalk-control-center',
          mode: 'progress',
          label: 'Fallback runtime',
          message: 'Control Center stream closed; ClawTalk is continuing through the embedded runtime.',
          fallbackPending: true,
          liveTokens: false,
        })
        return
      }
      emit('error', {
        message: message.length > SSE_FINAL_TEXT_LIMIT ? `${message.slice(0, SSE_FINAL_TEXT_LIMIT).trimEnd()}\n\n[Error truncated.]` : message,
        failureKind,
        transport: failureTransport,
        liveTokens: false,
      })
      emit('final', compactFinalSsePayload({
        ok: false,
        reply: message,
        stderr: message,
        code: 1,
        failureKind,
        streaming: { transport: failureTransport, liveTokens: false },
      }, liveTextStreamed))
    } finally {
      if (!closed) res.end()
    }
  })

  app.post('/api/openclaw/agent-turn', async (req, res) => {
    const schema = z.object({
      agent: z.string().min(1),
      message: z.string().min(1),
      intentMessage: z.string().optional(),
      sessionKey: z.string().min(1).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      attachments: z.array(z.unknown()).optional(),
      forceOpenClawRuntime: z.boolean().optional().default(false),
      gatewayStreamObserverId: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const requestAbortController = new AbortController()
    try {
      res.on('close', () => {
        if (!res.writableEnded) requestAbortController.abort()
      })

    const {
      agent,
      message: rawMessage,
      intentMessage: rawIntentMessage,
      thinking,
      timeoutSeconds,
      forceOpenClawRuntime: requestedForceOpenClawRuntime,
    } = parsed.data
    const runtimeShortcut = parseAgentRuntimeShortcut(rawMessage)
    const forceOpenClawRuntime = requestedForceOpenClawRuntime || Boolean(runtimeShortcut)
    const message = runtimeShortcut?.message || rawMessage
    const intentMessage = runtimeShortcut ? runtimeShortcut.message : rawIntentMessage
    if (!isValidAgentId(agent) || isRetiredAgentId(agent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid or retired agent id.', {
        ok: false,
        reply: 'Invalid or retired agent id.',
        stdout: '',
        stderr: 'Invalid or retired agent id.',
        code: 1,
      })
    }

    // The buffered endpoint is the renderer's recovery path when SSE cannot
    // complete. Hosted customers must keep the same billing route here for
    // every message, including /runtime, /work, and /openclaw; otherwise a
    // successful fallback reply can bypass the Cloud relay and leave the
    // confirmed credit balance unchanged.
    const hostedCreditRoute = Boolean(isHostedCreditsActive?.())
    if (hostedCreditRoute) {
      const hostedBrowserIntent = await shouldRouteBrowserIntentThroughBrowserPlugin(message, null)
      if (hostedBrowserIntent) {
        const preflight = await checkBrowserPreflight()
        if (!preflight.ok) {
          return apiSuccess(res, compactHttpJsonPayload({
            ok: false,
            reply: preflight.message,
            stdout: '',
            stderr: preflight.detail || preflight.message,
            code: 1,
            failureKind: 'browser_preflight_failed',
            preflight,
          }))
        }
      }
      const hostedPayload = await streamProviderAgentTurn(
        { ...parsed.data, agent: agent.trim(), ...(hostedBrowserIntent ? { thinking: 'off' as const } : {}) },
        () => undefined,
        requestAbortController.signal,
      )
      return apiSuccess(res, compactHttpJsonPayload(hostedPayload))
    }

    await ensureOpenclawAgentRunConfigDefaults()
    const runtimeConfig = await readOpenclawConfig()
    await ensureAgentRuntimeHealthPreflight(agent, runtimeConfig)
    await ensureAgentSandboxCompatibleWithHost(agent)
    const intentText = intentMessage?.trim() || message
    const hostAction = ENABLE_HOST_ACTION_SHORTCUTS && !forceOpenClawRuntime ? detectHostActionRequest(intentText) : null
    const browserIntent = forceOpenClawRuntime ? false : await shouldRouteBrowserIntentThroughBrowserPlugin(intentText, hostAction)
    const clawTalkSetupIntent = isClawTalkSetupIntentMessage(intentText)
    const clawTalkIntent = clawTalkSetupIntent || isClawTalkIntentMessage(intentText)
    const agentPrimaryModelId = readAgentPrimaryModelIdSync(agent)
    const vertexCompactMode = isGoogleGeminiModelId(agentPrimaryModelId)
    const effectiveThinking = browserIntent || clawTalkIntent ? 'off' : thinkingForOpenClawRuntimeModel(agentPrimaryModelId, thinking)
    const policyTimeoutSeconds = Math.max(
      await resolveEffectiveAgentWorkTimeoutSeconds(agent, timeoutSeconds),
      OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS,
    )
    const effectiveTimeoutSeconds = browserIntent ? Math.max(policyTimeoutSeconds, MIN_BROWSER_TIMEOUT_SECONDS) : policyTimeoutSeconds

    if (browserIntent) {
      const preflight = await checkBrowserPreflight(agent)
      if (!preflight.ok) {
        return apiSuccess(res, {
          ok: false,
          reply: preflight.message,
          stdout: '',
          stderr: preflight.detail || preflight.message,
          code: 1,
          modelId: agentPrimaryModelId,
          preflight,
          doctrineSync: {
            attempted: false,
            skipped: true,
          },
        })
      }
    }

    if (hostAction?.kind === 'launch-chrome') {
      const launched = await launchChromeHost(hostAction.url)
      const hostMessage = launched.ok
        ? `Host action executed: launched Google Chrome${hostAction.url ? ` (${hostAction.url})` : ''}.`
        : 'Host action failed: could not launch Google Chrome.'

      await appendAgentDailyMemory(agent, `[turn] ${launched.ok ? 'completed' : 'failed'} | ${hostMessage}`)

      return apiSuccess(res, {
        ok: launched.ok,
        reply: hostMessage,
        stdout: launched.ok
          ? JSON.stringify({
              status: 'ok',
              message: hostMessage,
              command: launched.command,
              detail: launched.detail,
            })
          : '',
        stderr: launched.ok
          ? ''
          : JSON.stringify({
              status: 'error',
              message: hostMessage,
              command: launched.command,
              detail: launched.detail,
            }),
        code: launched.ok ? 0 : 1,
        modelId: agentPrimaryModelId,
        doctrineSync: {
          attempted: false,
          skipped: true,
        },
      })
    }

    const delegation = forceOpenClawRuntime ? null : parseDelegationIntent(message)
    if (delegation) {
      const party = await getPartyMembers().catch(() => [])
      const target = resolveAgentReference(delegation.targetRef, party, agent)

      if (target) {
        const policy = await getAgentToAgentPolicy().catch(() => ({ enabled: true, allow: [] as string[] }))
        if (!policy.enabled) {
          return apiFailure(res, 403, 'party_handoff_failed', 'Agent-to-agent routing is disabled by policy.', {
            ok: false,
            reply: 'Agent-to-agent routing is disabled by policy.',
            stderr: 'tools.agentToAgent.enabled is false',
            code: 1,
            modelId: agentPrimaryModelId,
          })
        }
        if (!isAgentAllowedByPolicy(agent, policy.allow) || !isAgentAllowedByPolicy(target.id, policy.allow)) {
          return apiFailure(res, 403, 'party_handoff_failed', `Agent-to-agent policy denies routing from ${agent} to ${target.id}.`, {
            ok: false,
            reply: `Agent-to-agent policy denies routing from ${agent} to ${target.id}.`,
            stderr: JSON.stringify({ allow: policy.allow }),
            code: 1,
            modelId: agentPrimaryModelId,
          })
        }

        const handoffResponse: { ok: boolean; status: number; json: () => Promise<unknown> } = await fetch(`http://127.0.0.1:${PORT}/api/party/agent-to-agent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
          body: JSON.stringify({
            fromAgent: agent,
            toAgent: target.id,
            instruction: delegation.instruction,
            thinking: effectiveThinking,
            timeoutSeconds: effectiveTimeoutSeconds,
          }),
        }).catch((error) => ({ ok: false, status: 500, json: async () => ({ error: String(error) }) }))

        const rawPayload = await handoffResponse.json().catch((): Record<string, unknown> => ({}))
        const payload = unwrapCanonicalApiPayload(rawPayload)
        const handoffPayload = payload as DelegationHandoffPayload
        const handoffOk = handoffResponse.ok && handoffPayload.ok !== false
        const delegatedReply =
          (handoffPayload.to?.reply !== undefined && handoffPayload.to?.reply !== null ? String(handoffPayload.to.reply) : '') ||
          (handoffPayload.reply !== undefined && handoffPayload.reply !== null ? String(handoffPayload.reply) : '') ||
          `Delegated to ${target.id}.`

        await appendAgentDailyMemory(
          agent,
          `[turn] delegated to ${target.id} | ${trimTask(delegation.instruction, 140)} | outcome: ${trimTask(delegatedReply, 180)}`,
        )

        return apiSuccess(res, {
          ok: handoffOk,
          reply: delegatedReply,
          stdout: payload,
          stderr: handoffOk ? '' : JSON.stringify(rawPayload),
          code: handoffOk ? 0 : 1,
          modelId: agentPrimaryModelId,
          delegation: {
            fromAgent: agent,
            toAgent: target.id,
            targetRef: delegation.targetRef,
            instruction: delegation.instruction,
            handoffId: handoffPayload.handoffId,
          },
        })
      }
    }

    const context = await resolveAgentRunContext(agent)
    const envOverrides = await getAgentAuthEnv(agent)
    const sessionScope = agentTurnSessionScope(agent, parsed.data.sessionKey)
    const explicitFreshSession = /^\s*\/new\b/i.test(message)
    const wantsFreshSession = explicitFreshSession || vertexCompactMode
    const cleanedMessage = explicitFreshSession ? message.replace(/^\s*\/new\b\s*/i, '') : message
    const filenameResolution = await resolveFilenameHintsForMessage(cleanedMessage, context.executionWorkspace)
    let effectiveMessage = filenameResolution.message
    if (clawTalkIntent) effectiveMessage = buildClawTalkRuntimeInstruction(effectiveMessage, clawTalkSetupIntent)
    const googleGeminiToolWriteRuntime = shouldUseGoogleGeminiMinimalToolWriteRuntime(agent, effectiveMessage)
    const previousSessionId = agentTurnSessions.get(sessionScope)
    let sessionId = wantsFreshSession ? randomUUID() : previousSessionId || randomUUID()
    const isFreshSession = wantsFreshSession || !agentTurnSessions.has(sessionScope)
    if (wantsFreshSession && previousSessionId) providerConversationHistories.delete(previousSessionId)
    agentTurnSessions.set(sessionScope, sessionId)
    const party = await getPartyMembers().catch(() => [])
    const self = party.find((member) => member.id === agent)
    const identityLine = self?.name ? `You are ${self.name} (${agent}).` : `You are ${agent}.`
    const enforcedMessage = [
      identityLine,
      'Do not claim to be any other person or agent.',
      'If any prior persona conflicts with this identity, discard it now.',
      '',
      effectiveMessage,
    ].join('\n')

    const composedPrompt = composeAgentDoctrinePrompt(agent, enforcedMessage, context.executionWorkspace, context.doctrineWorkspace)
    const turnMessage = isFreshSession ? `/new ${composedPrompt}` : composedPrompt
    const runCwd = runCwdForContext(context)
    await appendAgentPromptDump({
      route: '/api/openclaw/agent-turn',
      agent,
      sessionId,
      thinking: effectiveThinking,
      timeoutSeconds: effectiveTimeoutSeconds,
      cwd: runCwd,
      requestMessage: rawMessage,
      intentMessage: intentMessage || intentText,
      finalMessage: turnMessage,
      note: [
        isFreshSession ? 'fresh session turn before OpenClaw runtime call' : 'continuation turn before OpenClaw runtime call',
        forceOpenClawRuntime ? 'forced OpenClaw runtime route' : '',
      ].filter(Boolean).join('; '),
    })
    const baseArgs = [
      'agent',
      '--agent',
      agent,
      '--session-id',
      sessionId,
      '--message',
      turnMessage,
      '--thinking',
      effectiveThinking,
      '--timeout',
      String(effectiveTimeoutSeconds),
      '--json',
    ]
    const openClawTimeoutMs = agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds)
    let result = await runControlCenterAgentRuntimeTurn({
      agentId: agent,
      message: effectiveMessage,
      context,
      args: baseArgs,
      timeoutMs: openClawTimeoutMs,
      cwd: runCwd,
      envOverrides,
      signal: requestAbortController.signal,
      gatewayChat: {
        enabled: !googleGeminiToolWriteRuntime,
        sessionId,
        requestedSessionKey: parsed.data.sessionKey,
        freshSession: isFreshSession,
        thinking: effectiveThinking,
        message: composedPrompt,
        attachments: parsed.data.attachments,
        streamObserverId: parsed.data.gatewayStreamObserverId,
      },
    })
    let reply = extractAgentReply(result.stdout, result.stderr)

    // A provider-side timeout can happen after the Gateway/OpenClaw session was
    // already created. Retry once in the same session with a longer window so
    // the agent can continue instead of leaving the user with a dead-end error.
    if (isAgentRuntimeTimeoutResult(result, reply) && !requestAbortController.signal.aborted) {
      const recoveryTimeoutSeconds = Math.max(effectiveTimeoutSeconds, OPENCLAW_TIMEOUT_RECOVERY_SECONDS)
      const recoveryInstruction = buildRuntimeTimeoutContinuationInstruction(effectiveMessage, recoveryTimeoutSeconds)
      const recoveryPrompt = composeAgentDoctrinePrompt(
        agent,
        recoveryInstruction,
        context.executionWorkspace,
        context.doctrineWorkspace,
      )
      await appendAgentPromptDump({
        route: '/api/openclaw/agent-turn',
        agent,
        sessionId,
        thinking: effectiveThinking,
        timeoutSeconds: recoveryTimeoutSeconds,
        cwd: runCwd,
        requestMessage: rawMessage,
        intentMessage: intentMessage || intentText,
        finalMessage: recoveryPrompt,
        note: 'timeout recovery turn using preserved OpenClaw session',
      })
      const retry = await runControlCenterAgentRuntimeTurn({
        agentId: agent,
        message: recoveryInstruction,
        context,
        args: [
          'agent',
          '--agent',
          agent,
          '--session-id',
          sessionId,
          '--message',
          recoveryPrompt,
          '--thinking',
          effectiveThinking,
          '--timeout',
          String(recoveryTimeoutSeconds),
          '--json',
        ],
        timeoutMs: agentWorkTimeoutWrapperMs(recoveryTimeoutSeconds),
        cwd: runCwd,
        envOverrides,
        signal: requestAbortController.signal,
        retry: false,
        gatewayChat: {
          enabled: !googleGeminiToolWriteRuntime,
          sessionId,
          requestedSessionKey: parsed.data.sessionKey,
          freshSession: isFreshSession,
          thinking: effectiveThinking,
          message: recoveryPrompt,
          attachments: parsed.data.attachments,
          streamObserverId: parsed.data.gatewayStreamObserverId,
        },
      }).catch(openClawErrorResult)

      const previousFailure = [result.stderr, result.stdout].filter(Boolean).join('\n')
      result = retry.code === 0
        ? retry
        : {
            ...retry,
            failureKind: retry.failureKind || classifyFailureKind(`${retry.stderr}\n${retry.stdout}`, 'failed') || 'unknown',
            stderr: [
              retry.stderr,
              previousFailure ? `Previous timeout: ${trimTask(previousFailure, 1200)}` : 'Previous runtime turn timed out before a final reply.',
            ].filter(Boolean).join('\n'),
          }
      reply = extractAgentReply(result.stdout, result.stderr)
    }

    // If the session context is bloated, retry once with a fresh session + /new.
    if (result.code === 0 && isContextOverflowReply(reply)) {
      const retrySessionId = randomUUID()
      agentTurnSessions.set(sessionScope, retrySessionId)
      sessionId = retrySessionId
      const retry = await runControlCenterAgentRuntimeTurn({
        agentId: agent,
        message: effectiveMessage,
        context,
        args: [
          'agent',
          '--agent',
          agent,
          '--session-id',
          retrySessionId,
          '--message',
          `/new ${composedPrompt}`,
          '--thinking',
          effectiveThinking,
          '--timeout',
          String(effectiveTimeoutSeconds),
          '--json',
        ],
        timeoutMs: openClawTimeoutMs,
        cwd: runCwdForContext(context),
        envOverrides,
        signal: requestAbortController.signal,
        retry: false,
        gatewayChat: {
          enabled: !googleGeminiToolWriteRuntime,
          sessionId: retrySessionId,
          requestedSessionKey: parsed.data.sessionKey,
          freshSession: true,
          thinking: effectiveThinking,
          message: composedPrompt,
          attachments: parsed.data.attachments,
          streamObserverId: parsed.data.gatewayStreamObserverId,
        },
      }).catch(openClawErrorResult)
      result = retry
      reply = extractAgentReply(retry.stdout, retry.stderr)
    }

    if (result.code === 0 && browserIntent && isBrowserServiceReadyOnlyReply(reply)) {
      const retrySessionId = randomUUID()
      const recoveryPrompt = composeAgentDoctrinePrompt(
        agent,
        buildBrowserRecoveryInstruction(message),
        context.executionWorkspace,
        context.doctrineWorkspace,
      )
      const recoveryMessage = `/new ${recoveryPrompt}`
      const retry = await runControlCenterAgentRuntimeTurn({
        agentId: agent,
        message: effectiveMessage,
        context,
        args: [
          'agent',
          '--agent',
          agent,
          '--session-id',
          retrySessionId,
          '--message',
          recoveryMessage,
          '--thinking',
          effectiveThinking,
          '--timeout',
          String(effectiveTimeoutSeconds),
          '--json',
        ],
        timeoutMs: openClawTimeoutMs,
        cwd: runCwdForContext(context),
        envOverrides,
        signal: requestAbortController.signal,
        retry: false,
        gatewayChat: {
          enabled: !googleGeminiToolWriteRuntime,
          sessionId: retrySessionId,
          requestedSessionKey: parsed.data.sessionKey,
          freshSession: true,
          thinking: effectiveThinking,
          message: recoveryPrompt,
          attachments: parsed.data.attachments,
          streamObserverId: parsed.data.gatewayStreamObserverId,
        },
      }).catch(openClawErrorResult)
      result = retry
      reply = extractAgentReply(retry.stdout, retry.stderr)
    }

    if (result.code === 0 && browserIntent && hasBrowserRelayPortConflict(result.stderr || '')) {
      const released = await tryReleaseBrowserRelayPort()
      if (released.released) {
        const retrySessionId = randomUUID()
        const recoveryPrompt = composeAgentDoctrinePrompt(
          agent,
          [
            'Browser relay was recovered after a transient port conflict.',
            buildBrowserRecoveryInstruction(message),
          ].join('\n'),
          context.executionWorkspace,
          context.doctrineWorkspace,
        )
        const recoveryMessage = `/new ${recoveryPrompt}`
        const retry = await runControlCenterAgentRuntimeTurn({
          agentId: agent,
          message: effectiveMessage,
          context,
          args: [
            'agent',
            '--agent',
            agent,
            '--session-id',
            retrySessionId,
            '--message',
            recoveryMessage,
            '--thinking',
            effectiveThinking,
            '--timeout',
            String(effectiveTimeoutSeconds),
            '--json',
          ],
          timeoutMs: openClawTimeoutMs,
          cwd: runCwdForContext(context),
          envOverrides,
          signal: requestAbortController.signal,
          retry: false,
          gatewayChat: {
            enabled: !googleGeminiToolWriteRuntime,
            sessionId: retrySessionId,
            requestedSessionKey: parsed.data.sessionKey,
            freshSession: true,
            thinking: effectiveThinking,
            message: recoveryPrompt,
            attachments: parsed.data.attachments,
            streamObserverId: parsed.data.gatewayStreamObserverId,
          },
        }).catch(openClawErrorResult)
        result = retry
        reply = extractAgentReply(retry.stdout, retry.stderr)
      }
    }

    if (result.code === 0 && browserIntent && hasBrowserRelayDisconnected(result.stderr || '')) {
      const gateway = await tryRestartGatewayService({ reason: 'agent turn browser relay recovery' })
      if (gateway.restarted) {
        const retrySessionId = randomUUID()
        const recoveryPrompt = composeAgentDoctrinePrompt(
          agent,
          [
            'Browser relay gateway was restarted after a transient disconnect.',
            buildBrowserRecoveryInstruction(message),
          ].join('\n'),
          context.executionWorkspace,
          context.doctrineWorkspace,
        )
        const recoveryMessage = `/new ${recoveryPrompt}`
        const retry = await runControlCenterAgentRuntimeTurn({
          agentId: agent,
          message: effectiveMessage,
          context,
          args: [
            'agent',
            '--agent',
            agent,
            '--session-id',
            retrySessionId,
            '--message',
            recoveryMessage,
            '--thinking',
            effectiveThinking,
            '--timeout',
            String(effectiveTimeoutSeconds),
            '--json',
          ],
          timeoutMs: openClawTimeoutMs,
          cwd: runCwdForContext(context),
          envOverrides,
          signal: requestAbortController.signal,
          retry: false,
          gatewayChat: {
            enabled: !googleGeminiToolWriteRuntime,
            sessionId: retrySessionId,
            requestedSessionKey: parsed.data.sessionKey,
            freshSession: true,
            thinking: effectiveThinking,
            message: recoveryPrompt,
            attachments: parsed.data.attachments,
            streamObserverId: parsed.data.gatewayStreamObserverId,
          },
        }).catch(openClawErrorResult)
        result = retry
        reply = extractAgentReply(retry.stdout, retry.stderr)
      }
    }

    let geminiArtifactFallback:
      | Awaited<ReturnType<typeof tryGoogleGeminiDirectArtifactWriteFallback>>
      | null = null
    if (googleGeminiToolWriteRuntime) {
      const target = resolveGoogleGeminiArtifactTarget(effectiveMessage, context.executionWorkspace)
      const targetExists = target ? await fileExists(target.absolutePath) : false
      if (result.code === 0 && isEmptyAgentNoResponseReply(reply) && targetExists && target) {
        reply = `${target.relativePath.replace(/\\/g, '/')} - File written.`
      } else if (result.code !== 0 || isEmptyAgentNoResponseReply(reply) || (target && !targetExists && !reply.trim())) {
        try {
          geminiArtifactFallback = await tryGoogleGeminiDirectArtifactWriteFallback({
            agentId: agent,
            modelId: agentPrimaryModelId,
            thinking: effectiveThinking,
            message: effectiveMessage,
            context,
            envOverrides,
            signal: requestAbortController.signal,
          })
          if (geminiArtifactFallback) {
            result = {
              stdout: JSON.stringify({
                status: 'ok',
                fallback: 'google-vertex-direct-artifact-write',
                file: geminiArtifactFallback.target.relativePath,
                contentLength: geminiArtifactFallback.contentLength,
              }),
              stderr: result.code === 0 ? result.stderr : [result.stderr, result.stdout].filter(Boolean).join('\n'),
              code: 0,
            }
            reply = geminiArtifactFallback.reply
          }
        } catch (error) {
          const fallbackError = `Google Vertex artifact fallback failed: ${String(error)}`
          if (result.code === 0 && !reply.trim()) {
            result = openClawErrorResult(error)
            reply = String(error)
          } else {
            result.stderr = [result.stderr, fallbackError].filter(Boolean).join('\n')
            if (result.code !== 0) {
              reply = [reply || result.stderr || result.stdout, fallbackError].filter(Boolean).join('\n')
            }
          }
        }
      }
    }

    if (isAgentRuntimeTimeoutResult(result, reply)) {
      reply = withRuntimeTimeoutResumeAdvice(reply, agent, sessionId)
    }

    await cleanupDoctrineMirrorsAfterRun(agent, context.executionWorkspace)

    await appendAgentDailyMemory(
      agent,
      `[turn] ${result.code === 0 ? 'completed' : 'failed'} | prompt: ${trimTask(message, 120)}${
        filenameResolution.notes.length ? ` | resolved: ${trimTask(filenameResolution.notes.join('; '), 120)}` : ''
      } | outcome: ${trimTask(
        reply || result.stderr || result.stdout || 'no response',
        220,
      )}`,
    )

    const doctrineSync = await buildDoctrineSyncReport(agent, context.executionWorkspace)
    const failureKind = result.code === 0
      ? undefined
      : result.failureKind || classifyFailureKind(`${reply}\n${result.stderr}\n${result.stdout}`, 'failed') || 'unknown'
    const runtimeRecovery = failureKind === 'timeout'
      ? {
          resumeAvailable: true,
          agent,
          sessionId,
          advice: runtimeTimeoutResumeAdvice(agent, sessionId),
        }
      : undefined

    return apiSuccess(res, compactHttpJsonPayload({
      ok: result.code === 0,
      reply,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      ...(failureKind ? { failureKind } : {}),
      ...(result.runtimeTransport ? { runtimeTransport: result.runtimeTransport } : {}),
      ...(result.gatewayFallbackDetail ? { gatewayFallbackDetail: result.gatewayFallbackDetail } : {}),
      ...(runtimeRecovery ? { runtimeRecovery } : {}),
      modelId: agentPrimaryModelId,
      ...(forceOpenClawRuntime ? {
        runtimeShortcut: {
          forced: true,
          command: runtimeShortcut?.command || 'runtime',
        },
      } : {}),
      doctrineSync,
      runtimeContext: agentRuntimeContextPayload(agent, context),
    }))
    } catch (error) {
      if (res.headersSent) return
      const requestedAgent = typeof req.body?.agent === 'string' ? req.body.agent.trim() : ''
      const modelId = requestedAgent && isValidAgentId(requestedAgent) && !isRetiredAgentId(requestedAgent)
        ? readAgentPrimaryModelIdSync(requestedAgent)
        : ''
      const rawMessage = error instanceof Error && error.message ? error.message : String(error)
      const detail = redactSensitiveText(rawMessage)
      const aborted = requestAbortController.signal.aborted
      const failureKind = classifyFailureKind(detail, aborted ? 'aborted' : 'failed') || 'unknown'
      const status = aborted
        ? 499
        : failureKind === 'auth_missing' || failureKind === 'auth_expired'
          ? 401
          : failureKind === 'provider_unsupported'
            ? 422
            : 500
      console.error(`[agent-turn] ${requestedAgent || 'unknown'} failed before OpenClaw reply:`, detail)
      return apiFailure(res, status, 'agent_turn_failed', aborted
        ? 'Agent turn was cancelled before completion.'
        : 'Agent turn failed before OpenClaw returned a reply.', compactHttpJsonPayload({
        ok: false,
        reply: aborted
          ? 'Agent turn was cancelled before completion.'
          : `Agent turn failed before OpenClaw returned a reply.\n\n${trimTask(detail, 1000)}`,
        stdout: '',
        stderr: detail,
        code: 1,
        failureKind,
        ...(modelId ? { modelId } : {}),
        doctrineSync: {
          attempted: false,
          skipped: true,
        },
      }))
    }
  })
}

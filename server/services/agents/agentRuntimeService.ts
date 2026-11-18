export type AgentRuntimeFlagMode = 'default' | 'gateway' | 'local'
export type AgentRuntimeThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AgentRuntimeFastModePreference = 'auto' | 'on' | 'off'

export type AgentRuntimeFallback = {
  source: 'gateway-chat' | 'gateway'
  destination: 'gateway' | 'local'
  trigger: 'gateway-chat-client-failed' | 'gateway-run-failed' | 'gateway-unavailable' | 'gateway-readiness-failed'
  detail: string
}

export type AgentRuntimeResult = {
  stdout: string
  stderr: string
  code: number
  controlCenterRunId?: string
  failureKind?: string
  elapsedMs?: number
  timedOut?: boolean
  runtimeTransport?: 'gateway-chat' | 'gateway' | 'local'
  gatewayFallbackDetail?: string
  runtimeFallback?: AgentRuntimeFallback
}

export type AgentRuntimeTurnParams = {
  agentId: string
  message: string
  context: { executionWorkspace: string; doctrineWorkspace: string }
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
    thinking: AgentRuntimeThinkingLevel
    fastMode?: AgentRuntimeFastModePreference
    message: string
    attachments?: unknown[]
    streamObserverId?: string
  }
}

export type AgentRuntimeServiceOptions = {
  controlCenterGatewayAgentSessions: boolean
  forceLocalAgentRuntime: boolean
  allowLocalAgentRuntimeFallback: boolean
  controlCenterGatewayChatClient: boolean
  gatewayHttpPort: number
  trafficGate?: () => {
    messageTrafficAllowed: boolean
    localAiAllowed: boolean
    blockMessage: string | null
  }
  runOpenClawWithGeminiToolWritePolicy: (
    agentId: string,
    message: string,
    context: { executionWorkspace: string; doctrineWorkspace: string },
    args: string[],
    timeoutMs: number,
    options?: {
      cwd?: string
      envOverrides?: Record<string, string>
      signal?: AbortSignal
      retry?: boolean
    },
  ) => Promise<AgentRuntimeResult>
  withAgentRuntimeFlags: (args: string[], options?: { mode?: AgentRuntimeFlagMode }) => string[]
  ensureGatewayRunning: () => Promise<void>
  startGatewayHealthMonitor: () => void
  isGatewayHealthy: () => Promise<boolean>
  runControlCenterGatewayChatTurn: (params: {
    agentId: string
    message: string
    attachments?: unknown[]
    sessionId: string
    requestedSessionKey?: string
    freshSession?: boolean
    thinking: AgentRuntimeThinkingLevel
    fastMode?: AgentRuntimeFastModePreference
    timeoutMs: number
    cwd: string
    streamObserverId?: string
    signal?: AbortSignal
  }) => Promise<AgentRuntimeResult>
  classifyFailureKind: (
    message: string,
    fallback?: 'failed' | 'timeout' | 'aborted' | 'interrupted' | null,
  ) => string | undefined
  redactSensitiveText: (value: string) => string
}

export function createAgentRuntimeService(options: AgentRuntimeServiceOptions) {
  function shouldFallbackGatewayAgentRun(result: AgentRuntimeResult) {
    if (result.code === 0) return false
    const combined = `${result.stderr || ''}\n${result.stdout || ''}`
    return (result.failureKind || options.classifyFailureKind(combined, 'failed')) === 'gateway_disconnect'
  }

  async function runControlCenterAgentRuntimeTurn(params: AgentRuntimeTurnParams): Promise<AgentRuntimeResult> {
    const trafficGate = options.trafficGate?.()
    if (trafficGate && (!trafficGate.messageTrafficAllowed || !trafficGate.localAiAllowed)) {
      const message = trafficGate.blockMessage
        || 'Starter Subscription and credit-refill access cannot use local AI runtime features.'
      return {
        stdout: '',
        stderr: message,
        code: trafficGate.messageTrafficAllowed ? 403 : 402,
        failureKind: trafficGate.messageTrafficAllowed ? 'provider_forbidden' : 'insufficient_credits',
        runtimeTransport: 'local',
      }
    }

    const run = (mode: AgentRuntimeFlagMode, extraEnv?: Record<string, string>) =>
      options.runOpenClawWithGeminiToolWritePolicy(
        params.agentId,
        params.message,
        params.context,
        options.withAgentRuntimeFlags(params.args, { mode }),
        params.timeoutMs,
        {
          cwd: params.cwd,
          envOverrides: {
            ...(params.envOverrides || {}),
            ...(extraEnv || {}),
          },
          signal: params.signal,
          retry: params.retry,
        },
      )

    if (!options.controlCenterGatewayAgentSessions || options.forceLocalAgentRuntime) {
      const local = await run('local')
      return { ...local, runtimeTransport: 'local' }
    }

    let gatewayFallbackDetail = ''
    let runtimeFallback: AgentRuntimeFallback | undefined
    const fallbackRecord = (
      source: AgentRuntimeFallback['source'],
      destination: AgentRuntimeFallback['destination'],
      trigger: AgentRuntimeFallback['trigger'],
      detail: string,
    ): AgentRuntimeFallback => ({
      source,
      destination,
      trigger,
      detail: options.redactSensitiveText(detail).trim().slice(0, 800),
    })
    try {
      await options.ensureGatewayRunning()
      options.startGatewayHealthMonitor()
      if (await options.isGatewayHealthy()) {
        if (options.controlCenterGatewayChatClient && params.gatewayChat?.enabled) {
          try {
            return await options.runControlCenterGatewayChatTurn({
              agentId: params.agentId,
              message: params.gatewayChat.message,
              attachments: params.gatewayChat.attachments,
              sessionId: params.gatewayChat.sessionId,
              requestedSessionKey: params.gatewayChat.requestedSessionKey,
              freshSession: params.gatewayChat.freshSession,
              thinking: params.gatewayChat.thinking,
              fastMode: params.gatewayChat.fastMode,
              timeoutMs: params.timeoutMs,
              cwd: params.cwd,
              streamObserverId: params.gatewayChat.streamObserverId,
              signal: params.signal,
            })
          } catch (error) {
            if (params.signal?.aborted) throw error
            gatewayFallbackDetail = options.redactSensitiveText(String(error).trim() || 'gateway chat client failed')
            runtimeFallback = fallbackRecord('gateway-chat', 'gateway', 'gateway-chat-client-failed', gatewayFallbackDetail)
            const dispatched = error as { gatewayDispatchState?: string; gatewayRunId?: string }
            if (dispatched?.gatewayDispatchState === 'uncertain' || dispatched?.gatewayDispatchState === 'accepted') {
              return {
                stdout: '',
                stderr: 'The Gateway connection was interrupted after this request was sent. Its outcome is not confirmed. Check this run in Runtime Monitor before retrying; it may still be running.',
                code: 503,
                failureKind: 'interrupted',
                runtimeTransport: 'gateway-chat',
                controlCenterRunId: dispatched.gatewayRunId,
                gatewayFallbackDetail,
              }
            }
          }
        }
        const gateway = await run('gateway')
        if (!shouldFallbackGatewayAgentRun(gateway)) {
          return {
            ...gateway,
            runtimeTransport: 'gateway',
            ...(runtimeFallback ? { runtimeFallback } : {}),
            ...(gatewayFallbackDetail
              ? {
                  gatewayFallbackDetail,
                  stderr: [gateway.stderr, `Gateway chat client fallback: ${gatewayFallbackDetail}`].filter(Boolean).join('\n'),
                }
              : {}),
          }
        }
        gatewayFallbackDetail = options.redactSensitiveText(
          [
            gatewayFallbackDetail,
            `${gateway.stderr || ''}\n${gateway.stdout || ''}`.trim() || 'gateway-backed agent run failed',
          ].filter(Boolean).join('\n'),
        )
        runtimeFallback = fallbackRecord('gateway', 'local', 'gateway-run-failed', gatewayFallbackDetail)
      } else {
        gatewayFallbackDetail = `gateway not healthy on port ${options.gatewayHttpPort}`
        runtimeFallback = fallbackRecord('gateway', 'local', 'gateway-unavailable', gatewayFallbackDetail)
      }
    } catch (error) {
      if (params.signal?.aborted) throw error
      gatewayFallbackDetail = options.redactSensitiveText(String(error))
      runtimeFallback = fallbackRecord('gateway', 'local', 'gateway-readiness-failed', gatewayFallbackDetail)
    }

    if (params.signal?.aborted) {
      throw Object.assign(new Error('gateway agent run aborted before fallback'), { name: 'AbortError' })
    }

    if (!options.allowLocalAgentRuntimeFallback) {
      const recovery = [
        'The OpenClaw Gateway is unavailable, so this request was not switched to the embedded local agent.',
        'Use Runtime Monitor to restart the Gateway, then retry the request.',
        'Local embedded fallback is disabled by default to keep failed Gateway turns isolated and predictable.',
      ].join(' ')
      return {
        stdout: '',
        stderr: recovery,
        code: 503,
        failureKind: 'gateway_unavailable',
        runtimeTransport: 'gateway',
        gatewayFallbackDetail,
      }
    }

    const local = await run('local')
    return {
      ...local,
      runtimeTransport: 'local',
      gatewayFallbackDetail,
      ...(runtimeFallback ? { runtimeFallback } : {}),
      stderr: [local.stderr, gatewayFallbackDetail ? `Gateway session fallback: ${gatewayFallbackDetail}` : '']
        .filter(Boolean)
        .join('\n'),
    }
  }

  return { runControlCenterAgentRuntimeTurn }
}

export type AgentRuntimeService = ReturnType<typeof createAgentRuntimeService>

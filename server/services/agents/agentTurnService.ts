import { gatewayChatAbortError } from '../gateway/gatewayChatService'
import type { AgentTurnStreamEmitter } from './gatewayAgentTurnService'

export type BufferedRuntimeReason = {
  code: string
  message: string
}

export type LocalJsonPostResponse = {
  ok: boolean
  status: number
  text: string
}

export type BufferedAgentTurnActiveRun = {
  id: string
  agentId?: string
  sessionId?: string
  status: string
  startedAt: string
  elapsedMs?: number
}

export type BufferedAgentTurnStream = {
  observer: {
    id: string
    textStreamed: boolean
  }
  dispose: () => void
}

export type BufferedAgentTurnServiceOptions = {
  registerGatewayChatStreamObserver: (
    emit: AgentTurnStreamEmitter,
    signal: AbortSignal,
  ) => BufferedAgentTurnStream
  runGatewayAgentTurnForStream: (
    body: Record<string, unknown>,
    streamObserverId: string,
    signal: AbortSignal,
    options: { route: string; note: string },
  ) => Promise<Record<string, unknown>>
  delayMs: (ms: number) => Promise<void>
  prewarmControlCenterGatewayAgentRuntime: (source: string) => void
  activeOpenClawRuns: () => Iterable<BufferedAgentTurnActiveRun>
  postLocalJsonNoHeaderTimeout: (
    pathname: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<LocalJsonPostResponse>
  unwrapCanonicalApiPayload: (payload: unknown) => unknown
  trimTask: (text: string, max: number) => string
  sanitizeUserVisibleRuntimeText: (text: string) => string
  redactHiddenReasoningAndSecrets: (text: string) => string
  classifyFailureKind: (text: string, status?: 'failed' | 'timeout' | 'aborted' | 'interrupted' | null) => string | undefined
}

export function createBufferedAgentTurnService(options: BufferedAgentTurnServiceOptions) {
  async function runBufferedAgentTurnForStream(
    body: Record<string, unknown>,
    emit: AgentTurnStreamEmitter,
    signal: AbortSignal,
    reason?: BufferedRuntimeReason,
  ): Promise<Record<string, unknown>> {
    if (signal.aborted) throw gatewayChatAbortError('gateway agent run aborted before start')
    const agent = typeof body.agent === 'string' ? body.agent.trim() : ''
    const quietRuntimeHandoff = reason?.code === 'forced-openclaw-runtime'
    const emitProgress = (id: string, text: string, extra: Record<string, unknown> = {}) => {
      emit('progress', {
        id,
        text,
        visibility: 'channel',
        privacy: 'public',
        transport: 'buffered-openclaw',
        ...extra,
      })
    }

    if (body.forceOpenClawRuntime === true) {
      const gatewayStream = options.registerGatewayChatStreamObserver(emit, signal)
      try {
        emit('status', {
          transport: 'gateway-chat',
          ...(reason ? { reason: reason.code } : {}),
          mode: 'progress',
          label: 'OpenClaw session',
          message: 'Agent accepted the turn; connecting to the Gateway chat session.',
          liveTokens: true,
        })
        emit('progress', {
          id: 'openclaw:gateway-chat',
          text: 'Dispatching directly through Gateway chat.',
          visibility: 'channel',
          privacy: 'public',
          transport: 'gateway-chat',
          agent,
          ...(reason ? { reason: reason.code } : {}),
          liveTokens: true,
        })
        await options.delayMs(0)
        if (signal.aborted) throw gatewayChatAbortError('gateway agent run aborted before Gateway dispatch')
        return await options.runGatewayAgentTurnForStream(body, gatewayStream.observer.id, signal, {
          route: body.source === 'clawtalk'
            ? '/api/openclaw/agent-turn/stream:clawtalk-direct'
            : '/api/openclaw/agent-turn/stream:command-console-direct',
          note: body.source === 'clawtalk'
            ? 'ClawTalk direct Gateway chat stream route'
            : 'Command Console direct Gateway chat stream route',
        })
      } finally {
        gatewayStream.dispose()
      }
    }

    emit('status', {
      transport: 'buffered-openclaw',
      ...(reason ? { reason: reason.code } : {}),
      mode: 'progress',
      label: 'Working',
      message: reason?.message || 'Agent is using tools for this request.',
    })
    emitProgress(
      'openclaw:handoff',
      reason?.message || 'Agent is using workspace or plugin tools.',
      reason ? { reason: reason.code } : {},
    )
    emitProgress('openclaw:doctrine', 'Loading mission instructions and agent doctrine.', {
      agent,
      reason: reason?.code || 'runtime',
    })
    emitProgress('openclaw:context', 'Building current workspace and session context.', {
      agent,
      reason: reason?.code || 'runtime',
    })
    emitProgress('openclaw:prompt', 'Preparing agent prompt and tool policy.', {
      agent,
      reason: reason?.code || 'runtime',
    })
    if (reason?.code === 'browser') {
      emitProgress('openclaw:browser', 'Preparing browser tool preflight and relay.', {
        agent,
        reason: reason.code,
      })
    }
    options.prewarmControlCenterGatewayAgentRuntime('runtime-stream')
    const gatewayStream = options.registerGatewayChatStreamObserver(emit, signal)
    const startedAt = Date.now()
    let lastRunId = ''
    let lastMilestoneAt = 0
    const keepAlive = setInterval(() => {
      const activeRun = agent
        ? Array.from(options.activeOpenClawRuns()).find((run) => run.agentId === agent && run.status === 'running')
        : undefined
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
      const runPayload = activeRun
        ? {
            runId: activeRun.id,
            sessionId: activeRun.sessionId,
            elapsedSeconds: Math.round((activeRun.elapsedMs || (Date.now() - Date.parse(activeRun.startedAt))) / 1000),
          }
        : { elapsedSeconds }

      if (activeRun && activeRun.id !== lastRunId) {
        lastRunId = activeRun.id
        lastMilestoneAt = Date.now()
        emitProgress('openclaw:process', quietRuntimeHandoff ? 'Agent process started.' : 'Tool process started.', runPayload)
      } else if (Date.now() - lastMilestoneAt >= 20_000) {
        lastMilestoneAt = Date.now()
        emitProgress(
          activeRun ? 'openclaw:working' : 'openclaw:waiting',
          quietRuntimeHandoff
            ? activeRun ? `Agent working for ${elapsedSeconds}s.` : `Waiting for agent process for ${elapsedSeconds}s.`
            : activeRun ? `Agent using tools for ${elapsedSeconds}s.` : `Waiting for tool process for ${elapsedSeconds}s.`,
          runPayload,
        )
      }

      emit('status', {
        transport: 'buffered-openclaw',
        ...(reason ? { reason: reason.code } : {}),
        mode: 'progress',
        keepAlive: true,
        ...runPayload,
        message: quietRuntimeHandoff
          ? activeRun ? 'Agent is still working.' : 'Waiting for agent process to start.'
          : activeRun ? 'Agent is still using tools.' : 'Waiting for tool process to start.',
      })
    }, 5_000)
    keepAlive.unref?.()

    let response: LocalJsonPostResponse
    try {
      response = await options.postLocalJsonNoHeaderTimeout('/api/openclaw/agent-turn', {
        ...body,
        gatewayStreamObserverId: gatewayStream.observer.id,
      }, signal)
    } catch (error) {
      throw new Error([
        'Control Center could not start the tool-backed agent turn.',
        'The backend may have restarted or the local gateway may have dropped.',
        `Original error: ${String(error)}`,
      ].join('\n'))
    } finally {
      clearInterval(keepAlive)
      gatewayStream.dispose()
    }
    const text = response.text || ''
    let payload: Record<string, unknown>
    try {
      const parsedPayload = text ? options.unwrapCanonicalApiPayload(JSON.parse(text) as unknown) : {}
      payload = parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)
        ? parsedPayload as Record<string, unknown>
        : {
            ok: false,
            reply: text.trim() ? `HTTP ${response.status}: ${options.trimTask(text, 300)}` : `HTTP ${response.status}`,
            stderr: text,
            code: response.status,
          }
    } catch {
      payload = {
        ok: false,
        reply: text.trim() ? `HTTP ${response.status}: ${options.trimTask(text, 300)}` : `HTTP ${response.status}`,
        stderr: text,
        code: response.status,
      }
    }
    const reply = typeof payload.reply === 'string' ? options.sanitizeUserVisibleRuntimeText(payload.reply) : ''
    if (typeof payload.reply === 'string' && reply !== payload.reply) {
      payload.reply = reply || 'No response returned.'
      payload.runtimeLogsFiltered = true
    }
    const finalOk = response.ok && payload.ok !== false
    emitProgress('openclaw:finalizing', finalOk ? 'Agent returned a final payload.' : 'Agent returned an error payload.', {
      ok: finalOk,
      failureKind: typeof payload.failureKind === 'string' ? payload.failureKind : undefined,
    })
    if (reply && !gatewayStream.observer.textStreamed) {
      emit('delta', { text: options.redactHiddenReasoningAndSecrets(reply), buffered: true, transport: 'buffered-openclaw' })
    }
    const liveGatewayStream = gatewayStream.observer.textStreamed && payload.runtimeTransport === 'gateway-chat'
    const failureKind = payload.failureKind || (!response.ok || payload.ok === false
      ? options.classifyFailureKind(
          `${reply}\n${typeof payload.stderr === 'string' ? payload.stderr : ''}`,
          'failed',
        ) || 'unknown'
      : undefined)
    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
      code: typeof payload.code === 'number' ? payload.code : response.status,
      ...(failureKind ? { failureKind } : {}),
      streaming: {
        transport: liveGatewayStream ? 'gateway-chat' : 'buffered-openclaw',
        liveTokens: liveGatewayStream,
        ...(liveGatewayStream ? { buffered: false } : {}),
      },
    }
  }

  return { runBufferedAgentTurnForStream }
}

export type BufferedAgentTurnService = ReturnType<typeof createBufferedAgentTurnService>

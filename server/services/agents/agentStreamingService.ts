import { randomUUID } from 'node:crypto'
import type { ProviderRequestAuth } from '../providers/providerSetupService'
import type { AgentTurnStreamEmitter } from './gatewayAgentTurnService'
import type { BufferedRuntimeReason } from './agentTurnService'

export type AgentStreamingThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type StreamingProviderKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'gemini-vertex-generate-content'

export type StreamingProviderConfig = {
  kind: StreamingProviderKind
  envKeys: string[]
  endpoint?: string
  docs: string
}

export type ProviderConversationMessage = {
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
}

export type AgentStreamingInput = {
  agent: string
  message: string
  intentMessage?: string
  thinking: AgentStreamingThinkingLevel
  timeoutSeconds?: number
  attachments?: unknown[]
  tools?: unknown[]
  sessionKey?: string
  source?: 'clawtalk'
  forceOpenClawRuntime?: boolean
}

export type AgentStreamingContext = {
  executionWorkspace: string
  doctrineWorkspace: string
}

export type AgentRuntimeShortcut = {
  command: 'work' | 'runtime' | 'openclaw'
  message: string
}

export type StreamedProviderReply = {
  content: string
  reasoningContent?: string
}

type HostedRelayCredentials = {
  email: string
  licenseKey: string
  mode: 'hosted_credits'
  usagePriority: 'automnia_first' | 'provider_first'
}

export type AgentStreamingServiceOptions = {
  streamingProviderConfig: Record<string, StreamingProviderConfig>
  isValidAgentId: (agentId: string) => boolean
  isRetiredAgentId: (agentId: string) => boolean
  parseAgentRuntimeShortcut: (message: string) => AgentRuntimeShortcut | null
  agentRuntimeShortcutReason: (shortcut?: AgentRuntimeShortcut | null) => BufferedRuntimeReason
  bufferedAgentRuntimeReason: (
    message: string,
    attachments?: unknown[],
    intentMessage?: string,
  ) => BufferedRuntimeReason | null
  getHostedRelayCredentials?: () => HostedRelayCredentials | null
  streamAutomniaCloudRelay?: (
    input: AgentStreamingInput,
    emit: AgentTurnStreamEmitter,
    signal: AbortSignal,
    credentials: HostedRelayCredentials,
  ) => Promise<Record<string, unknown>>
  runBufferedAgentTurnForStream: (
    input: Record<string, unknown>,
    emit: AgentTurnStreamEmitter,
    signal: AbortSignal,
    reason?: BufferedRuntimeReason,
  ) => Promise<Record<string, unknown>>
  resolveAgentPrimaryModelId: (agentId: string) => Promise<string>
  openAiCodexEmbeddedRuntimeReason: (
    modelId: string,
    message: string,
    intentMessage?: string,
  ) => BufferedRuntimeReason | null
  googleGeminiEmbeddedRuntimeReason: (
    modelId: string,
    message: string,
    intentMessage?: string,
  ) => BufferedRuntimeReason | null
  splitModelId: (modelId: string) => { provider: string; model: string }
  isOpenAiCodexSubscriptionModel: (modelId: string) => boolean
  getAgentAuthEnv: (agentId: string) => Promise<Record<string, string>>
  resolveOpenAiSubscriptionRequestAuth: (env: Record<string, string>) => Promise<{
    provider: string
    providerConfig: StreamingProviderConfig
    requestAuth: ProviderRequestAuth | null
  }>
  resolveProviderRequestAuth: (
    provider: string,
    env: Record<string, string>,
    envKeys: string[],
  ) => Promise<ProviderRequestAuth | null>
  anthropicSubscriptionAvailable?: () => boolean
  streamingCapabilityForModel: (modelId: string) => Record<string, unknown>
  resolveAgentRunContext: (agentId: string) => Promise<AgentStreamingContext>
  agentTurnSessionScope: (agentId: string, requestedSessionKey?: string) => string
  agentTurnSessions: Map<string, string>
  deleteProviderConversationHistory: (sessionId: string) => void
  resolveFilenameHintsForMessage: (
    message: string,
    executionWorkspace: string,
  ) => Promise<{ message: string; notes: string[] }>
  getPartyMembers: () => Promise<Array<{ id: string; name?: string }>>
  composeDirectProviderPrompt: (
    agentId: string,
    message: string,
    executionWorkspace?: string,
  ) => string
  providerConversationMessagesForRequest: (
    sessionId: string,
    provider: string,
    modelId: string,
    userContent: string,
  ) => ProviderConversationMessage[]
  streamOpenAiCompatibleCompletion: (params: {
    provider: string
    model: string
    endpoint: string
    apiKey: string
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  streamOpenAiResponsesCompletion: (params: {
    provider: string
    model: string
    endpoint: string
    apiKey: string
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  streamOpenAICodexResponsesCompletion: (params: {
    model: string
    accessToken: string
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    sessionId: string
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  streamAnthropicMessage: (params: {
    model: string
    apiKey: string
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  streamGoogleVertexContent: (params: {
    model: string
    auth: ProviderRequestAuth
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  streamGeminiContent: (params: {
    model: string
    auth: ProviderRequestAuth
    messages: ProviderConversationMessage[]
    thinking: AgentStreamingThinkingLevel
    signal: AbortSignal
    emit: AgentTurnStreamEmitter
  }) => Promise<StreamedProviderReply>
  classifyFailureKind: (
    message: string,
    fallback?: 'failed' | 'timeout' | 'aborted' | 'interrupted' | null,
  ) => string | undefined
  redactHiddenReasoningAndSecrets: (value: string) => string
  appendAgentDailyMemory: (agentId: string, entry: string) => Promise<unknown>
  trimTask: (value: string, maxChars: number) => string
  cleanupDoctrineMirrorsAfterRun: (agentId: string, executionWorkspace: string) => Promise<unknown>
  sanitizeUserVisibleRuntimeText: (value: string) => string
  saveProviderConversationTurn: (
    sessionId: string,
    provider: string,
    modelId: string,
    requestMessages: ProviderConversationMessage[],
    assistant: { content: string; reasoningContent?: string },
  ) => void
  buildDoctrineSyncReport: (agentId: string, executionWorkspace: string) => Promise<unknown>
  agentRuntimeContextPayload: (agentId: string, context: AgentStreamingContext) => unknown
  providerConversationMessageCount: (sessionId: string) => number
}

export function createAgentStreamingService(options: AgentStreamingServiceOptions) {
  async function streamProviderAgentTurn(
    input: AgentStreamingInput,
    emit: AgentTurnStreamEmitter,
    signal: AbortSignal,
    skipHostedRouting = false,
  ): Promise<Record<string, unknown>> {
    if (!options.isValidAgentId(input.agent) || options.isRetiredAgentId(input.agent)) {
      throw new Error('Invalid or retired agent id.')
    }

    const runtimeShortcut = options.parseAgentRuntimeShortcut(input.message)

    // Hosted members can choose which paid route is attempted first. Both
    // lanes are staged until success is known so a failed preferred route can
    // fall back without briefly rendering a terminal error in the UI.
    const hostedRelayCredentials = skipHostedRouting ? null : options.getHostedRelayCredentials?.()
    const streamHostedRelay = options.streamAutomniaCloudRelay
    if (hostedRelayCredentials && streamHostedRelay) {
      // Tool-capable and channel-originated turns must stay inside OpenClaw's
      // native loop. The gateway model is synchronised to the authenticated
      // Automnia OpenAI-compatible provider before startup, so this preserves
      // tool calls, channel delivery, and credit charging in one supported
      // OpenClaw path instead of collapsing a tool request into a text relay.
      if (input.forceOpenClawRuntime) {
        const runtimeResult = await streamProviderAgentTurn(input, emit, signal, true)
        return {
          ...runtimeResult,
          usagePriority: hostedRelayCredentials.usagePriority,
          fallbackUsed: false,
          billingRoute: 'openclaw-configured-automnia-provider',
        }
      }
      const hostedInput = runtimeShortcut
        ? {
            ...input,
            message: runtimeShortcut.message,
            intentMessage: runtimeShortcut.message,
          }
        : input
      const localInput = {
        ...hostedInput,
        forceOpenClawRuntime: true,
      }
      const runCloud = async () => {
        const events: Array<[string, Record<string, unknown>]> = []
        const result = await streamHostedRelay(
          hostedInput,
          (event, data) => events.push([event, data]),
          signal,
          hostedRelayCredentials,
        )
        return { events, result }
      }
      const replay = (events: Array<[string, Record<string, unknown>]>) => {
        for (const [event, data] of events) emit(event, data)
      }

      if (hostedRelayCredentials.usagePriority === 'provider_first') {
        const providerEvents: Array<[string, Record<string, unknown>]> = []
        const providerResult = await streamProviderAgentTurn(
          localInput,
          (event, data) => providerEvents.push([event, data]),
          signal,
          true,
        ).catch((error) => ({
          ok: false,
          reply: options.redactHiddenReasoningAndSecrets(String(error)),
          failureKind: options.classifyFailureKind(String(error), 'failed') || 'unknown',
        }))
        if (providerResult.ok === true) {
          replay(providerEvents)
          return {
            ...providerResult,
            usagePriority: 'provider_first',
            fallbackUsed: false,
          }
        }

        const fallbackMessage = 'Your connected provider could not complete this request. Using Automnia credits as the fallback.'
        emit('status', {
          transport: 'automnia-cloud-relay',
          reason: 'provider-to-automnia-fallback',
          mode: 'progress',
          label: 'Automnia credit fallback',
          message: fallbackMessage,
          liveTokens: false,
        })
        const cloud = await runCloud()
        const cloudReply = typeof cloud.result.reply === 'string' ? cloud.result.reply : ''
        const cloudText = typeof cloud.result.text === 'string' ? cloud.result.text : ''
        const hasCloudToolRequest = cloudReply.includes('[Runtime tool request:') || cloudText.includes('[Runtime tool request:') || cloud.events.some(([, data]) => typeof data?.text === 'string' && data.text.includes('[Runtime tool request:'))

      if (hasCloudToolRequest) {
        emit('status', {
          transport: 'openclaw-interceptor',
          reason: 'cloud-tool-request-intercepted',
          mode: 'progress',
          label: 'Tool Call Intercepted',
          message: 'Intercepted raw tool request from Automnia Cloud Relay. Routing to native local runtime execution...',
        })
        const interceptedInput = { ...localInput, forceOpenClawRuntime: true }
        const localResult = await streamProviderAgentTurn(interceptedInput, emit, signal, true)
        return {
          ...localResult,
          usagePriority: 'provider_first',
          fallbackUsed: true,
          billingRoute: 'openclaw-configured-automnia-provider',
        }
      }
        replay(cloud.events)
        return {
          ...cloud.result,
          usagePriority: 'provider_first',
          fallbackUsed: true,
        }
      }

      const cloud = await runCloud()
      const cloudReply = typeof cloud.result.reply === 'string' ? cloud.result.reply : ''
      const cloudText = typeof cloud.result.text === 'string' ? cloud.result.text : ''
      // Intercept and sanitize tool request syntax that might leak into the completion text.
      // We look for raw strings like "[Runtime tool request: ...]" and ensure they are parsed
      // or handled by the local runtime execution safety net instead of being rendered to the user.
      const hasCloudToolRequest = cloudReply.includes('[Runtime tool request:') || 
                                 cloudText.includes('[Runtime tool request:') || 
                                 cloud.events.some(([, data]) => typeof data?.text === 'string' && data.text.includes('[Runtime tool request:'))

      if (hasCloudToolRequest) {
        // Prevent infinite loops if we are already inside the native local runtime.
        if (input.forceOpenClawRuntime || (input.tools && input.tools.length > 0)) {
          if (cloud.result.ok === true) {
            replay(cloud.events)
            return {
              ...cloud.result,
              usagePriority: 'automnia_first',
              fallbackUsed: false,
            }
          }
        }

        emit('status', {
          transport: 'openclaw-interceptor',
          reason: 'cloud-tool-request-intercepted',
          mode: 'progress',
          label: 'Tool Call Intercepted',
          message: 'Intercepted raw tool request leak from Automnia Cloud Relay. Routing to native local runtime execution...',
        })
        
      // Use JSON-native tool call dispatch instead of regex parsing
        if (cloud.result.toolCalls && Array.isArray(cloud.result.toolCalls) && cloud.result.toolCalls.length > 0) {
           const call = cloud.result.toolCalls[0];
           const toolName = call.function.name;
           let toolArgs;
           try {
             toolArgs = JSON.parse(call.function.arguments);
           } catch {
             toolArgs = { input: call.function.arguments };
           }
           emit('status', { transport: 'openclaw-interceptor', label: 'Executing Native Tool', message: `Executing ${toolName}...` });
           const localResult = await options.runToolNative(toolName, toolArgs, signal);
           return { 
             ok: true, 
             reply: JSON.stringify(localResult), 
             usagePriority: hostedRelayCredentials.usagePriority, 
             fallbackUsed: true,
             billingRoute: 'openclaw-configured-automnia-provider'
           };
        }

        const interceptedInput = { ...localInput, forceOpenClawRuntime: true }
        const localResult = await streamProviderAgentTurn(interceptedInput, emit, signal, true)
        return {
          ...localResult,
          usagePriority: hostedRelayCredentials.usagePriority,
          fallbackUsed: true,
          billingRoute: 'openclaw-configured-automnia-provider',
        }
      }
      if (cloud.result.ok === true) {
        replay(cloud.events)
        return {
          ...cloud.result,
          usagePriority: 'automnia_first',
          fallbackUsed: false,
        }
      }

      // A transient Cloud capacity response is not permission to silently
      // change who bills the customer. The provisioner retries Vertex first;
      // if it is still busy, preserve the Automnia route and let the customer
      // retry instead of spending their connected-provider balance.
      if (cloud.result.retryable === true) {
        replay(cloud.events)
        return {
          ...cloud.result,
          usagePriority: 'automnia_first',
          fallbackUsed: false,
        }
      }

      const fallbackMessage = 'Automnia Cloud could not complete this request. Using the local fallback configured in Model Settings.'
      emit('status', {
        transport: 'gateway-chat',
        reason: 'automnia-cloud-local-fallback',
        mode: 'progress',
        label: 'Local model fallback',
        message: fallbackMessage,
        liveTokens: true,
      })
      const localResult = await streamProviderAgentTurn(localInput, emit, signal, true)
      return {
        ...localResult,
        usagePriority: 'automnia_first',
        fallbackUsed: true,
      }
    }

    if (runtimeShortcut) {
      return options.runBufferedAgentTurnForStream(
        {
          ...input,
          message: runtimeShortcut.message,
          intentMessage: runtimeShortcut.message,
          forceOpenClawRuntime: true,
        },
        emit,
        signal,
        options.agentRuntimeShortcutReason(runtimeShortcut),
      )
    }

    if (input.forceOpenClawRuntime) {
      return options.runBufferedAgentTurnForStream(
        {
          ...input,
          intentMessage: input.intentMessage || input.message,
          forceOpenClawRuntime: true,
        },
        emit,
        signal,
        options.agentRuntimeShortcutReason(),
      )
    }

    const bufferedReason = options.bufferedAgentRuntimeReason(input.message, input.attachments, input.intentMessage)
    if (bufferedReason) {
      return options.runBufferedAgentTurnForStream(input, emit, signal, bufferedReason)
    }

    const modelId = await options.resolveAgentPrimaryModelId(input.agent)
    const openAiCodexBufferedReason = options.openAiCodexEmbeddedRuntimeReason(modelId, input.message, input.intentMessage)
    if (openAiCodexBufferedReason) {
      return options.runBufferedAgentTurnForStream(input, emit, signal, openAiCodexBufferedReason)
    }

    const googleGeminiBufferedReason = options.googleGeminiEmbeddedRuntimeReason(modelId, input.message, input.intentMessage)
    if (googleGeminiBufferedReason) {
      return options.runBufferedAgentTurnForStream(input, emit, signal, googleGeminiBufferedReason)
    }

    const { provider: modelProvider, model } = options.splitModelId(modelId)
    const isCodexSubscriptionTurn = options.isOpenAiCodexSubscriptionModel(modelId)
    let provider = isCodexSubscriptionTurn ? 'openai' : modelProvider
    let providerConfig = options.streamingProviderConfig[provider]
    if (!providerConfig) {
      return options.runBufferedAgentTurnForStream(input, emit, signal, {
        code: 'unsupported-provider-streaming',
        message: `Direct token streaming is not configured for ${provider || 'this provider'}, so the agent is using the tool-capable path.`,
      })
    }

    const envOverrides = await options.getAgentAuthEnv(input.agent)
    const openAiSubscriptionAuth = isCodexSubscriptionTurn
      ? await options.resolveOpenAiSubscriptionRequestAuth(envOverrides)
      : null
    if (openAiSubscriptionAuth) {
      provider = openAiSubscriptionAuth.provider
      providerConfig = openAiSubscriptionAuth.providerConfig
    }
    const requestAuth: ProviderRequestAuth | null = openAiSubscriptionAuth
      ? openAiSubscriptionAuth.requestAuth
      : await options.resolveProviderRequestAuth(provider, envOverrides, providerConfig.envKeys)
    const capability = options.streamingCapabilityForModel(modelId)
    if (!requestAuth && provider === 'anthropic' && options.anthropicSubscriptionAvailable?.()) {
      return options.runBufferedAgentTurnForStream(input, emit, signal, {
        code: 'anthropic-claude-cli-runtime',
        message: 'Claude Code subscription authentication is being handled by the OpenClaw runtime.',
      })
    }
    if (!requestAuth) {
      const providerAuthRequirement = isCodexSubscriptionTurn
        ? 'OpenAI Codex OAuth credential or OpenAI API key'
        : provider === 'google-vertex'
        ? 'Google Cloud CLI auth (gcloud auth login) plus a configured Google Cloud project'
        : provider === 'openai'
            ? 'OpenAI / Codex OAuth credential or OpenAI API key'
            : provider === 'google'
              ? `${providerConfig.envKeys.join(' or ')} or Google OAuth credential`
              : providerConfig.envKeys.join(' or ')
      const reply = [
        `Streaming is wired for ${modelId}, but no usable ${providerAuthRequirement} is configured.`,
        'Connect the provider in the app auth modal or set an environment key, then retry.',
      ].join('\n')
      emit('error', { message: reply, provider: isCodexSubscriptionTurn ? 'openai' : provider, model: modelId, capability })
      return {
        ok: false,
        reply,
        stdout: '',
        stderr: reply,
        code: 401,
        failureKind: 'auth_missing',
        modelId,
        provider: isCodexSubscriptionTurn ? 'openai' : provider,
        model,
        streaming: {
          ...capability,
          configured: false,
          liveTokens: false,
        },
      }
    }

    const context = await options.resolveAgentRunContext(input.agent)
    const sessionScope = options.agentTurnSessionScope(input.agent, input.sessionKey)
    const wantsFreshSession = /^\s*\/new\b/i.test(input.message)
    const cleanedMessage = wantsFreshSession ? input.message.replace(/^\s*\/new\b\s*/i, '') : input.message
    const filenameResolution = await options.resolveFilenameHintsForMessage(cleanedMessage, context.executionWorkspace)
    const effectiveMessage = filenameResolution.message
    const previousSessionId = options.agentTurnSessions.get(sessionScope)
    const sessionId = wantsFreshSession ? randomUUID() : previousSessionId || randomUUID()
    if (wantsFreshSession && previousSessionId) options.deleteProviderConversationHistory(previousSessionId)
    options.agentTurnSessions.set(sessionScope, sessionId)
    const party = await options.getPartyMembers().catch(() => [])
    const self = party.find((member) => member.id === input.agent)
    const identityLine = self?.name ? `You are ${self.name} (${input.agent}).` : `You are ${input.agent}.`
    const enforcedMessage = [
      identityLine,
      'Do not claim to be any other person or agent.',
      'If any prior persona conflicts with this identity, discard it now.',
      '',
      effectiveMessage,
    ].join('\n')
    const composedPrompt = options.composeDirectProviderPrompt(input.agent, enforcedMessage, context.executionWorkspace)
    const requestMessages = options.providerConversationMessagesForRequest(sessionId, provider, modelId, composedPrompt)
    const effectiveStreamingKind: StreamingProviderKind =
      provider === 'openai' && requestAuth.type === 'oauth'
        ? 'openai-codex-responses'
        : providerConfig.kind
    const streamingTransport: StreamingProviderKind =
      effectiveStreamingKind === 'openai-codex-responses' && requestAuth.type === 'apiKey'
        ? 'openai-responses'
        : effectiveStreamingKind

    emit('start', {
      transport: streamingTransport,
      provider,
      model,
      modelId,
      sessionId,
      conversationMessages: requestMessages.length,
      capability,
      runtimeContext: options.agentRuntimeContextPayload(input.agent, context),
    })

    let streamedReply: StreamedProviderReply = { content: '' }
    try {
      if (providerConfig.kind === 'openai-compatible') {
        if (requestAuth.type !== 'apiKey') throw new Error(`${provider} streaming requires an API key credential.`)
        streamedReply = await options.streamOpenAiCompatibleCompletion({
          provider,
          model,
          endpoint: providerConfig.endpoint || '',
          apiKey: requestAuth.value,
          messages: requestMessages,
          thinking: input.thinking,
          signal,
          emit,
        })
      } else if (effectiveStreamingKind === 'openai-responses') {
        if (requestAuth.type !== 'apiKey') throw new Error('OpenAI Responses streaming requires an API key credential.')
        streamedReply = await options.streamOpenAiResponsesCompletion({
          provider,
          model,
          endpoint: providerConfig.endpoint || 'https://api.openai.com/v1/responses',
          apiKey: requestAuth.value,
          messages: requestMessages,
          thinking: input.thinking,
          signal,
          emit,
        })
      } else if (effectiveStreamingKind === 'openai-codex-responses') {
        if (requestAuth.type === 'oauth') {
          streamedReply = await options.streamOpenAICodexResponsesCompletion({
            model,
            accessToken: requestAuth.accessToken,
            messages: requestMessages,
            thinking: input.thinking,
            sessionId,
            signal,
            emit,
          })
        } else {
          throw new Error('OpenAI Codex streaming requires an OpenAI Codex OAuth credential.')
        }
      } else if (providerConfig.kind === 'anthropic-messages') {
        if (requestAuth.type !== 'apiKey') throw new Error('Anthropic streaming requires an API key credential.')
        streamedReply = await options.streamAnthropicMessage({
          model,
          apiKey: requestAuth.value,
          messages: requestMessages,
          thinking: input.thinking,
          signal,
          emit,
        })
      } else if (providerConfig.kind === 'gemini-vertex-generate-content') {
        streamedReply = await options.streamGoogleVertexContent({
          model,
          auth: requestAuth,
          messages: requestMessages,
          thinking: input.thinking,
          signal,
          emit,
        })
      } else {
        streamedReply = await options.streamGeminiContent({
          model,
          auth: requestAuth,
          messages: requestMessages,
          thinking: input.thinking,
          signal,
          emit,
        })
      }
    } catch (error) {
      const failure = options.redactHiddenReasoningAndSecrets(String(error))
      const failureKind = options.classifyFailureKind(failure, 'failed') || 'unknown'
      await options.appendAgentDailyMemory(
        input.agent,
        `[turn] failed streaming | prompt: ${options.trimTask(input.message, 120)} | outcome: ${options.trimTask(failure, 220)}`,
      ).catch(() => undefined)
      return {
        ok: false,
        reply: failure,
        stdout: '',
        stderr: failure,
        code: 1,
        failureKind,
        modelId,
        provider,
        model,
        runtimeContext: options.agentRuntimeContextPayload(input.agent, context),
        streaming: {
          ...capability,
          configured: true,
          liveTokens: true,
        },
      }
    }

    await options.cleanupDoctrineMirrorsAfterRun(input.agent, context.executionWorkspace)

    const finalReply = options.sanitizeUserVisibleRuntimeText(streamedReply.content).trim() || 'No response returned.'
    options.saveProviderConversationTurn(sessionId, provider, modelId, requestMessages, {
      content: finalReply,
      reasoningContent: streamedReply.reasoningContent,
    })
    await options.appendAgentDailyMemory(
      input.agent,
      `[turn] completed streaming | prompt: ${options.trimTask(input.message, 120)}${
        filenameResolution.notes.length ? ` | resolved: ${options.trimTask(filenameResolution.notes.join('; '), 120)}` : ''
      } | outcome: ${options.trimTask(finalReply, 220)}`,
    )

    const doctrineSync = await options.buildDoctrineSyncReport(input.agent, context.executionWorkspace)

    return {
      ok: true,
      reply: finalReply,
      stdout: '',
      stderr: '',
      code: 0,
      modelId,
      provider,
      model,
      doctrineSync,
      runtimeContext: options.agentRuntimeContextPayload(input.agent, context),
      streaming: {
        ...capability,
        configured: true,
        liveTokens: true,
        sessionId,
        conversationMessages: options.providerConversationMessageCount(sessionId) || requestMessages.length + 1,
      },
    }
  }

  return { streamProviderAgentTurn }
}

export type AgentStreamingService = ReturnType<typeof createAgentStreamingService>

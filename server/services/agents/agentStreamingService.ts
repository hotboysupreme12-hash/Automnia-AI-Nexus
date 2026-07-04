import { randomUUID } from 'node:crypto'
import type { ProviderRequestAuth } from '../providers/providerSetupService'
import type { AgentTurnStreamEmitter } from './gatewayAgentTurnService'
import type { BufferedRuntimeReason } from './agentTurnService'

export type AgentStreamingThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high'

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
  ): Promise<Record<string, unknown>> {
    if (!options.isValidAgentId(input.agent) || options.isRetiredAgentId(input.agent)) {
      throw new Error('Invalid or retired agent id.')
    }

    const runtimeShortcut = options.parseAgentRuntimeShortcut(input.message)
    if (runtimeShortcut || input.forceOpenClawRuntime) {
      return options.runBufferedAgentTurnForStream(
        {
          ...input,
          message: runtimeShortcut?.message || input.message,
          intentMessage: runtimeShortcut?.message || input.intentMessage || input.message,
          forceOpenClawRuntime: true,
        },
        emit,
        signal,
        options.agentRuntimeShortcutReason(runtimeShortcut),
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
    let provider = isCodexSubscriptionTurn ? 'openai-codex' : modelProvider
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
    if (!requestAuth) {
      const providerAuthRequirement = isCodexSubscriptionTurn
        ? 'OpenAI Codex OAuth credential or OpenAI API key'
        : provider === 'google-vertex'
        ? 'Google Cloud CLI auth (gcloud auth login) plus a configured Google Cloud project'
        : provider === 'openai-codex'
          ? 'OpenAI Codex OAuth credential'
          : provider === 'openai'
            ? 'OpenAI API key'
            : provider === 'google'
              ? `${providerConfig.envKeys.join(' or ')} or Google OAuth credential`
              : providerConfig.envKeys.join(' or ')
      const reply = [
        `Streaming is wired for ${modelId}, but no usable ${providerAuthRequirement} is configured.`,
        'Connect the provider in the app auth modal or set an environment key, then retry.',
      ].join('\n')
      emit('error', { message: reply, provider: isCodexSubscriptionTurn ? 'openai-codex' : provider, model: modelId, capability })
      return {
        ok: false,
        reply,
        stdout: '',
        stderr: reply,
        code: 401,
        failureKind: 'auth_missing',
        modelId,
        provider: isCodexSubscriptionTurn ? 'openai-codex' : provider,
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
      isCodexSubscriptionTurn && provider === 'openai-codex'
        ? 'openai-codex-responses'
        : provider === 'openai' && requestAuth.type === 'oauth'
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

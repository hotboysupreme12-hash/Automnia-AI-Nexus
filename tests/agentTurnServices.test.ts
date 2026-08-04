import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentRuntimeService } from '../server/services/agents/agentRuntimeService'
import { createAgentStreamingService } from '../server/services/agents/agentStreamingService'
import { createBufferedAgentTurnService } from '../server/services/agents/agentTurnService'
import { createGatewayAgentTurnService } from '../server/services/agents/gatewayAgentTurnService'
import type { ProviderRequestAuth } from '../server/services/providers/providerSetupService'

function createAbortSignal() {
  return new AbortController().signal
}

function createAbortedSignal() {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

test('gateway agent turn service prepares a Gateway chat turn with identity and session metadata', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const promptDumps: Record<string, unknown>[] = []
  let capturedGatewayTurn: Record<string, unknown> | null = null
  let healthMonitorStarts = 0
  const sessions = new Map<string, string>()

  const service = createGatewayAgentTurnService({
    gatewayHttpPort: 18789,
    openClawAgentTurnTimeoutFloorSeconds: 60,
    isValidAgentId: (agentId) => agentId === 'agent-alpha',
    isRetiredAgentId: () => false,
    streamObserver: () => ({ emit: (event, data) => events.push({ event, data }) }),
    ensureOpenclawAgentRunConfigDefaults: async () => undefined,
    readOpenclawConfig: async () => ({}),
    ensureAgentRuntimeHealthPreflight: async () => undefined,
    ensureAgentSandboxCompatibleWithHost: async () => undefined,
    startGatewayHealthMonitor: () => {
      healthMonitorStarts += 1
    },
    ensureGatewayRunning: async () => undefined,
    isGatewayHealthy: async () => true,
    isClawTalkSetupIntentMessage: () => false,
    isClawTalkIntentMessage: () => false,
    buildClawTalkRuntimeInstruction: (message) => message,
    readAgentPrimaryModelIdSync: () => 'openai:gpt-test',
    isGoogleGeminiModelId: () => false,
    thinkingForOpenClawRuntimeModel: (_modelId, thinking) => thinking,
    resolveEffectiveAgentFastMode: async () => 'auto',
    resolveEffectiveAgentWorkTimeoutSeconds: async () => 15,
    resolveAgentRunContext: async () => ({
      executionWorkspace: 'C:/workspace',
      doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha',
    }),
    agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
    agentTurnSessions: sessions,
    deleteProviderConversationHistory: () => undefined,
    resolveFilenameHintsForMessage: async (message) => ({ message: `${message} resolved` }),
    getPartyMembers: async () => [{ id: 'agent-alpha', name: 'Ada' }],
    composeAgentDoctrinePrompt: (_agentId, message) => `doctrine:\n${message}`,
    runCwdForContext: (context) => context.executionWorkspace,
    agentWorkTimeoutWrapperMs: (seconds) => seconds * 1000,
    appendAgentPromptDump: async (payload) => {
      promptDumps.push(payload)
    },
    runGatewayChatTurn: async (payload) => {
      capturedGatewayTurn = payload
      return { stdout: 'gateway stdout', stderr: '', code: 0 }
    },
    extractAgentReply: (stdout) => `reply from ${stdout}`,
  })

  const result = await service.runGatewayAgentTurnForStream({
    agent: 'agent-alpha',
    message: 'inspect logs',
    thinking: 'low',
    sessionKey: 'console',
    timeoutSeconds: 15,
    attachments: [{ id: 'upload-1' }],
  }, 'observer-1', createAbortSignal(), {
    route: '/api/openclaw/agent-turn/stream:command-console-direct',
    note: 'test route',
  })

  assert.equal(healthMonitorStarts, 1)
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'reply from gateway stdout')
  assert.equal(result.runtimeTransport, 'gateway-chat')
  assert.equal(result.sessionKey, 'console')
  assert.equal(sessions.has('agent-alpha:console'), true)
  assert.equal(promptDumps.length, 1)
  assert.equal(promptDumps[0]?.timeoutSeconds, 60)
  assert.equal(capturedGatewayTurn?.agentId, 'agent-alpha')
  assert.equal(capturedGatewayTurn?.requestedSessionKey, 'console')
  assert.equal(capturedGatewayTurn?.freshSession, true)
  assert.equal(capturedGatewayTurn?.thinking, 'low')
  assert.equal(capturedGatewayTurn?.fastMode, 'auto')
  assert.equal(capturedGatewayTurn?.timeoutMs, 60_000)
  assert.deepEqual(capturedGatewayTurn?.attachments, [{ id: 'upload-1' }])
  assert.match(String(capturedGatewayTurn?.message), /You are Ada \(agent-alpha\)\./)
  assert.match(String(capturedGatewayTurn?.message), /inspect logs resolved/)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.text === 'Connecting Gateway chat client.'), true)
})

test('gateway agent turn service resets and retries a stale Codex session for ClawTalk once', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const gatewayTurns: Array<Record<string, unknown>> = []
  const deletedSessionIds: string[] = []
  const sessions = new Map<string, string>()

  const service = createGatewayAgentTurnService({
    gatewayHttpPort: 18789,
    openClawAgentTurnTimeoutFloorSeconds: 60,
    isValidAgentId: (agentId) => agentId === 'agent-alpha',
    isRetiredAgentId: () => false,
    streamObserver: () => ({ emit: (event, data) => events.push({ event, data }) }),
    ensureOpenclawAgentRunConfigDefaults: async () => undefined,
    readOpenclawConfig: async () => ({}),
    ensureAgentRuntimeHealthPreflight: async () => undefined,
    ensureAgentSandboxCompatibleWithHost: async () => undefined,
    startGatewayHealthMonitor: () => undefined,
    ensureGatewayRunning: async () => undefined,
    isGatewayHealthy: async () => true,
    isClawTalkSetupIntentMessage: () => false,
    isClawTalkIntentMessage: () => false,
    buildClawTalkRuntimeInstruction: (message) => message,
    readAgentPrimaryModelIdSync: () => 'openai-codex/gpt-5',
    isGoogleGeminiModelId: () => false,
    thinkingForOpenClawRuntimeModel: (_modelId, thinking) => thinking,
    resolveEffectiveAgentFastMode: async () => 'auto',
    resolveEffectiveAgentWorkTimeoutSeconds: async () => 60,
    resolveAgentRunContext: async () => ({
      executionWorkspace: 'C:/workspace',
      doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha',
    }),
    agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
    agentTurnSessions: sessions,
    deleteProviderConversationHistory: (sessionId) => deletedSessionIds.push(sessionId),
    resolveFilenameHintsForMessage: async (message) => ({ message }),
    getPartyMembers: async () => [{ id: 'agent-alpha', name: 'Ada' }],
    composeAgentDoctrinePrompt: (_agentId, message) => message,
    runCwdForContext: (context) => context.executionWorkspace,
    agentWorkTimeoutWrapperMs: (seconds) => seconds * 1000,
    appendAgentPromptDump: async () => undefined,
    runGatewayChatTurn: async (payload) => {
      gatewayTurns.push(payload)
      if (gatewayTurns.length === 1) {
        return {
          stdout: '',
          stderr: 'Codex session generation is no longer current: stale-session-id',
          code: 1,
        }
      }
      return { stdout: 'fresh reply', stderr: '', code: 0 }
    },
    extractAgentReply: (stdout) => stdout,
  })

  const result = await service.runGatewayAgentTurnForStream({
    agent: 'agent-alpha',
    message: 'What can you help me do?',
    sessionKey: 'clawtalk:sms:example',
  }, 'observer-1', createAbortSignal(), {
    route: '/api/openclaw/agent-turn/stream:clawtalk-direct',
    note: 'ClawTalk direct Gateway chat stream route',
  })

  assert.equal(result.ok, true)
  assert.equal(result.reply, 'fresh reply')
  assert.equal(gatewayTurns.length, 2)
  assert.notEqual(gatewayTurns[0].sessionId, gatewayTurns[1].sessionId)
  assert.equal(gatewayTurns[1].freshSession, true)
  assert.deepEqual(deletedSessionIds, [gatewayTurns[0].sessionId])
  assert.equal(sessions.get('agent-alpha:clawtalk:sms:example'), gatewayTurns[1].sessionId)
  assert.equal(events.some((entry) => entry.data.retry === 'stale-codex-session'), true)
})

test('buffered agent turn service dispatches forced runtime turns directly to Gateway chat', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  let disposed = false
  let capturedRoute = ''

  const service = createBufferedAgentTurnService({
    registerGatewayChatStreamObserver: () => ({
      observer: { id: 'stream-1', textStreamed: false },
      dispose: () => {
        disposed = true
      },
    }),
    runGatewayAgentTurnForStream: async (_body, streamObserverId, _signal, options) => {
      assert.equal(streamObserverId, 'stream-1')
      capturedRoute = options.route
      return { ok: true, reply: 'gateway final' }
    },
    delayMs: async () => undefined,
    prewarmControlCenterGatewayAgentRuntime: () => undefined,
    activeOpenClawRuns: () => [],
    postLocalJsonNoHeaderTimeout: async () => ({ ok: true, status: 200, text: '{}' }),
    unwrapCanonicalApiPayload: (payload) => payload,
    trimTask: (text, max) => text.slice(0, max),
    sanitizeUserVisibleRuntimeText: (text) => text,
    redactHiddenReasoningAndSecrets: (text) => text,
    classifyFailureKind: () => undefined,
  })

  const result = await service.runBufferedAgentTurnForStream(
    { agent: 'agent-alpha', message: 'hello', forceOpenClawRuntime: true },
    (event, data) => events.push({ event, data }),
    createAbortSignal(),
    { code: 'forced-openclaw-runtime', message: 'forced' },
  )

  assert.equal(result.reply, 'gateway final')
  assert.equal(capturedRoute, '/api/openclaw/agent-turn/stream:command-console-direct')
  assert.equal(disposed, true)
  assert.equal(events.some((entry) => entry.event === 'status' && entry.data.transport === 'gateway-chat'), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.id === 'openclaw:gateway-chat'), true)
})

test('buffered agent turn service emits sanitized buffered replies when no live text streamed', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  let prewarmSource = ''

  const service = createBufferedAgentTurnService({
    registerGatewayChatStreamObserver: () => ({
      observer: { id: 'stream-2', textStreamed: false },
      dispose: () => undefined,
    }),
    runGatewayAgentTurnForStream: async () => ({ ok: true }),
    delayMs: async () => undefined,
    prewarmControlCenterGatewayAgentRuntime: (source) => {
      prewarmSource = source
    },
    activeOpenClawRuns: () => [],
    postLocalJsonNoHeaderTimeout: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: true, reply: 'hello [secret]world[/secret]', code: 0 }),
    }),
    unwrapCanonicalApiPayload: (payload) => payload,
    trimTask: (text, max) => text.slice(0, max),
    sanitizeUserVisibleRuntimeText: (text) => text.replace(/\[secret\].*?\[\/secret\]/gsu, '').trim(),
    redactHiddenReasoningAndSecrets: (text) => text.replace(/\[secret\].*?\[\/secret\]/gsu, ''),
    classifyFailureKind: () => undefined,
  })

  const result = await service.runBufferedAgentTurnForStream(
    { agent: 'agent-alpha', message: 'use tools' },
    (event, data) => events.push({ event, data }),
    createAbortSignal(),
    { code: 'tool-use', message: 'using tools' },
  )

  assert.equal(prewarmSource, 'runtime-stream')
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'hello')
  assert.equal((result.streaming as Record<string, unknown>).transport, 'buffered-openclaw')
  assert.equal(result.runtimeLogsFiltered, true)
  assert.equal(events.some((entry) => entry.event === 'delta' && entry.data.text === 'hello'), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.id === 'openclaw:finalizing'), true)
})

test('agent runtime service uses the local runtime only when the fallback is explicitly enabled', async () => {
  const modes: string[] = []
  let gatewayMonitorStarts = 0

  const service = createAgentRuntimeService({
    controlCenterGatewayAgentSessions: true,
    forceLocalAgentRuntime: false,
    allowLocalAgentRuntimeFallback: true,
    controlCenterGatewayChatClient: false,
    gatewayHttpPort: 18789,
    runOpenClawWithGeminiToolWritePolicy: async (_agentId, _message, _context, args) => {
      const mode = args.includes('--local') ? 'local' : 'gateway'
      modes.push(mode)
      if (mode === 'gateway') {
        return {
          stdout: 'lost gateway connection',
          stderr: 'Gateway disconnected with token=secret-123',
          code: 1,
          failureKind: 'gateway_disconnect',
        }
      }
      return { stdout: 'local ok', stderr: '', code: 0 }
    },
    withAgentRuntimeFlags: (args, options) => options?.mode === 'local' ? ['agent', '--local', ...args.slice(1)] : args,
    ensureGatewayRunning: async () => undefined,
    startGatewayHealthMonitor: () => {
      gatewayMonitorStarts += 1
    },
    isGatewayHealthy: async () => true,
    runControlCenterGatewayChatTurn: async () => {
      throw new Error('not used')
    },
    classifyFailureKind: (message) => /gateway/i.test(message) ? 'gateway_disconnect' : undefined,
    redactSensitiveText: (value) => value.replace(/secret-\d+/g, '[redacted]'),
  })

  const result = await service.runControlCenterAgentRuntimeTurn({
    agentId: 'agent-alpha',
    message: 'inspect workspace',
    context: { executionWorkspace: 'C:/workspace', doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha' },
    args: ['agent', '--agent', 'agent-alpha'],
    timeoutMs: 1000,
    cwd: 'C:/workspace',
    signal: createAbortSignal(),
  })

  assert.deepEqual(modes, ['gateway', 'local'])
  assert.equal(gatewayMonitorStarts, 1)
  assert.equal(result.runtimeTransport, 'local')
  assert.match(result.gatewayFallbackDetail || '', /\[redacted\]/)
  assert.doesNotMatch(result.stderr, /secret-123/)
})

test('agent runtime service returns a recoverable Gateway error instead of starting the embedded local agent by default', async () => {
  const modes: string[] = []
  const service = createAgentRuntimeService({
    controlCenterGatewayAgentSessions: true,
    forceLocalAgentRuntime: false,
    allowLocalAgentRuntimeFallback: false,
    controlCenterGatewayChatClient: false,
    gatewayHttpPort: 18789,
    runOpenClawWithGeminiToolWritePolicy: async (_agentId, _message, _context, args) => {
      const mode = args.includes('--local') ? 'local' : 'gateway'
      modes.push(mode)
      return { stdout: '', stderr: 'Gateway disconnected', code: 1, failureKind: 'gateway_disconnect' }
    },
    withAgentRuntimeFlags: (args, options) => options?.mode === 'local' ? ['agent', '--local', ...args.slice(1)] : args,
    ensureGatewayRunning: async () => undefined,
    startGatewayHealthMonitor: () => undefined,
    isGatewayHealthy: async () => true,
    runControlCenterGatewayChatTurn: async () => {
      throw new Error('not used')
    },
    classifyFailureKind: (message) => /gateway/i.test(message) ? 'gateway_disconnect' : undefined,
    redactSensitiveText: (value) => value,
  })

  const result = await service.runControlCenterAgentRuntimeTurn({
    agentId: 'agent-alpha',
    message: 'inspect workspace',
    context: { executionWorkspace: 'C:/workspace', doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha' },
    args: ['agent', '--agent', 'agent-alpha'],
    timeoutMs: 1000,
    cwd: 'C:/workspace',
    signal: createAbortSignal(),
  })

  assert.deepEqual(modes, ['gateway'])
  assert.equal(result.code, 503)
  assert.equal(result.failureKind, 'gateway_unavailable')
  assert.equal(result.runtimeTransport, 'gateway')
  assert.match(result.stderr, /not switched to the embedded local agent/i)
})

test('agent runtime service aborts before local fallback after Gateway failure', async () => {
  const modes: string[] = []

  const controller = new AbortController()
  const service = createAgentRuntimeService({
    controlCenterGatewayAgentSessions: true,
    forceLocalAgentRuntime: false,
    allowLocalAgentRuntimeFallback: false,
    controlCenterGatewayChatClient: false,
    gatewayHttpPort: 18789,
    runOpenClawWithGeminiToolWritePolicy: async (_agentId, _message, _context, args) => {
      const mode = args.includes('--local') ? 'local' : 'gateway'
      modes.push(mode)
      if (mode === 'gateway') {
        controller.abort()
        return {
          stdout: 'gateway dropped',
          stderr: 'Gateway disconnected',
          code: 1,
          failureKind: 'gateway_disconnect',
        }
      }
      throw new Error('local fallback should not run after abort')
    },
    withAgentRuntimeFlags: (args, options) => options?.mode === 'local' ? ['agent', '--local', ...args.slice(1)] : args,
    ensureGatewayRunning: async () => undefined,
    startGatewayHealthMonitor: () => undefined,
    isGatewayHealthy: async () => true,
    runControlCenterGatewayChatTurn: async () => {
      throw new Error('not used')
    },
    classifyFailureKind: (message) => /gateway/i.test(message) ? 'gateway_disconnect' : undefined,
    redactSensitiveText: (value) => value,
  })

  await assert.rejects(
    () => service.runControlCenterAgentRuntimeTurn({
      agentId: 'agent-alpha',
      message: 'inspect workspace',
      context: { executionWorkspace: 'C:/workspace', doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha' },
      args: ['agent', '--agent', 'agent-alpha'],
      timeoutMs: 1000,
      cwd: 'C:/workspace',
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  )
  assert.deepEqual(modes, ['gateway'])
})

test('agent streaming service streams direct provider turns and persists conversation metadata', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const sessions = new Map<string, string>()
  const histories = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()
  const memories: string[] = []
  let streamCalled = false

  const service = createAgentStreamingService({
    streamingProviderConfig: {
      deepseek: {
        kind: 'openai-compatible',
        envKeys: ['DEEPSEEK_API_KEY'],
        endpoint: 'https://api.deepseek.com/chat/completions',
        docs: 'docs',
      },
    },
    isValidAgentId: (agentId) => agentId === 'agent-alpha',
    isRetiredAgentId: () => false,
    parseAgentRuntimeShortcut: () => null,
    agentRuntimeShortcutReason: () => ({ code: 'runtime-shortcut', message: 'shortcut' }),
    bufferedAgentRuntimeReason: () => null,
    runBufferedAgentTurnForStream: async () => {
      throw new Error('buffered path should not run')
    },
    resolveAgentPrimaryModelId: async () => 'deepseek/deepseek-chat',
    openAiCodexEmbeddedRuntimeReason: () => null,
    googleGeminiEmbeddedRuntimeReason: () => null,
    splitModelId: (modelId) => {
      const [provider, ...rest] = modelId.split('/')
      return { provider, model: rest.join('/') }
    },
    isOpenAiCodexSubscriptionModel: () => false,
    getAgentAuthEnv: async () => ({ DEEPSEEK_API_KEY: 'test-key' }),
    resolveOpenAiSubscriptionRequestAuth: async () => {
      throw new Error('not used')
    },
    resolveProviderRequestAuth: async () => ({ type: 'apiKey', value: 'test-key', source: 'env' }),
    streamingCapabilityForModel: () => ({ supported: true, provider: 'deepseek', transport: 'openai-compatible' }),
    resolveAgentRunContext: async () => ({
      executionWorkspace: 'C:/workspace',
      doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha',
    }),
    agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
    agentTurnSessions: sessions,
    deleteProviderConversationHistory: (sessionId) => {
      histories.delete(sessionId)
    },
    resolveFilenameHintsForMessage: async (message) => ({ message: `${message} resolved`, notes: ['log.txt'] }),
    getPartyMembers: async () => [{ id: 'agent-alpha', name: 'Ada' }],
    composeDirectProviderPrompt: (_agentId, message, workspace) => `${workspace}\n${message}`,
    providerConversationMessagesForRequest: (sessionId, _provider, _modelId, userContent) => [
      ...(histories.get(sessionId) || []),
      { role: 'user', content: userContent },
    ],
    streamOpenAiCompatibleCompletion: async (params) => {
      streamCalled = true
      assert.equal(params.apiKey, 'test-key')
      assert.equal(params.messages.length, 1)
      return { content: 'direct streaming reply', reasoningContent: 'private' }
    },
    streamOpenAiResponsesCompletion: async () => {
      throw new Error('not used')
    },
    streamOpenAICodexResponsesCompletion: async () => {
      throw new Error('not used')
    },
    streamAnthropicMessage: async () => {
      throw new Error('not used')
    },
    streamGoogleVertexContent: async () => {
      throw new Error('not used')
    },
    streamGeminiContent: async () => {
      throw new Error('not used')
    },
    classifyFailureKind: () => undefined,
    redactHiddenReasoningAndSecrets: (value) => value,
    appendAgentDailyMemory: async (_agentId, entry) => {
      memories.push(entry)
    },
    trimTask: (value, maxChars) => value.slice(0, maxChars),
    cleanupDoctrineMirrorsAfterRun: async () => undefined,
    sanitizeUserVisibleRuntimeText: (value) => value,
    saveProviderConversationTurn: (sessionId, _provider, _modelId, requestMessages, assistant) => {
      histories.set(sessionId, [...requestMessages, { role: 'assistant', content: assistant.content }])
    },
    buildDoctrineSyncReport: async () => ({ ok: true }),
    agentRuntimeContextPayload: (_agentId, context) => ({ workspace: context.executionWorkspace }),
    providerConversationMessageCount: (sessionId) => histories.get(sessionId)?.length || 0,
  })

  const result = await service.streamProviderAgentTurn({
    agent: 'agent-alpha',
    message: 'summarize log.txt',
    thinking: 'low',
    sessionKey: 'console',
  }, (event, data) => events.push({ event, data }), createAbortSignal())

  assert.equal(streamCalled, true)
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'direct streaming reply')
  assert.equal(result.provider, 'deepseek')
  assert.equal((result.streaming as Record<string, unknown>).conversationMessages, 2)
  assert.equal(events.some((entry) => entry.event === 'start' && entry.data.transport === 'openai-compatible'), true)
  assert.equal(memories.some((entry) => entry.includes('completed streaming')), true)
})

test('agent streaming service dispatches Gemini 3.6 Flash through both native Google transports', async () => {
  const providerCases: Array<{
    modelId: string
    provider: 'google' | 'google-vertex'
    kind: 'gemini-generate-content' | 'gemini-vertex-generate-content'
    auth: ProviderRequestAuth
  }> = [
    {
      modelId: 'google/gemini-3.6-flash',
      provider: 'google',
      kind: 'gemini-generate-content',
      auth: { type: 'apiKey', value: 'gemini-test-key', source: 'test' },
    },
    {
      modelId: 'google-vertex/gemini-3.6-flash',
      provider: 'google-vertex',
      kind: 'gemini-vertex-generate-content',
      auth: {
        type: 'oauth',
        accessToken: 'vertex-test-token',
        projectId: 'test-project',
        location: 'global',
        source: 'test',
      },
    },
  ]

  for (const providerCase of providerCases) {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const nativeCalls: string[] = []
    const service = createAgentStreamingService({
      streamingProviderConfig: {
        google: {
          kind: 'gemini-generate-content',
          envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          docs: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash',
        },
        'google-vertex': {
          kind: 'gemini-vertex-generate-content',
          envKeys: ['GOOGLE_VERTEX_ACCESS_TOKEN'],
          docs: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash',
        },
      },
      isValidAgentId: (agentId) => agentId === 'agent-alpha',
      isRetiredAgentId: () => false,
      parseAgentRuntimeShortcut: () => null,
      agentRuntimeShortcutReason: () => ({ code: 'runtime-shortcut', message: 'shortcut' }),
      bufferedAgentRuntimeReason: () => null,
      runBufferedAgentTurnForStream: async () => {
        throw new Error('Gemini 3.6 should use its native direct streaming transport')
      },
      resolveAgentPrimaryModelId: async () => providerCase.modelId,
      openAiCodexEmbeddedRuntimeReason: () => null,
      googleGeminiEmbeddedRuntimeReason: () => null,
      splitModelId: (modelId) => {
        const [provider, ...rest] = modelId.split('/')
        return { provider, model: rest.join('/') }
      },
      isOpenAiCodexSubscriptionModel: () => false,
      getAgentAuthEnv: async () => ({}),
      resolveOpenAiSubscriptionRequestAuth: async () => {
        throw new Error('not used')
      },
      resolveProviderRequestAuth: async (provider) => {
        assert.equal(provider, providerCase.provider)
        return providerCase.auth
      },
      streamingCapabilityForModel: (modelId) => ({
        supported: true,
        provider: modelId.split('/')[0],
        transport: providerCase.kind,
      }),
      resolveAgentRunContext: async () => ({
        executionWorkspace: 'C:/workspace',
        doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha',
      }),
      agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
      agentTurnSessions: new Map<string, string>(),
      deleteProviderConversationHistory: () => undefined,
      resolveFilenameHintsForMessage: async (message) => ({ message, notes: [] }),
      getPartyMembers: async () => [{ id: 'agent-alpha', name: 'Ada' }],
      composeDirectProviderPrompt: (_agentId, message) => message,
      providerConversationMessagesForRequest: (_sessionId, _provider, _modelId, userContent) => [
        { role: 'user', content: userContent },
      ],
      streamOpenAiCompatibleCompletion: async () => {
        throw new Error('not used')
      },
      streamOpenAiResponsesCompletion: async () => {
        throw new Error('not used')
      },
      streamOpenAICodexResponsesCompletion: async () => {
        throw new Error('not used')
      },
      streamAnthropicMessage: async () => {
        throw new Error('not used')
      },
      streamGoogleVertexContent: async (params) => {
        nativeCalls.push('vertex')
        assert.equal(params.model, 'gemini-3.6-flash')
        assert.equal(params.auth.type, 'oauth')
        return { content: 'OK' }
      },
      streamGeminiContent: async (params) => {
        nativeCalls.push('google')
        assert.equal(params.model, 'gemini-3.6-flash')
        assert.equal(params.auth.type, 'apiKey')
        return { content: 'OK' }
      },
      classifyFailureKind: () => undefined,
      redactHiddenReasoningAndSecrets: (value) => value,
      appendAgentDailyMemory: async () => undefined,
      trimTask: (value, maxChars) => value.slice(0, maxChars),
      cleanupDoctrineMirrorsAfterRun: async () => undefined,
      sanitizeUserVisibleRuntimeText: (value) => value,
      saveProviderConversationTurn: () => undefined,
      buildDoctrineSyncReport: async () => ({ ok: true }),
      agentRuntimeContextPayload: (_agentId, context) => ({ workspace: context.executionWorkspace }),
      providerConversationMessageCount: () => 0,
    })

    const result = await service.streamProviderAgentTurn({
      agent: 'agent-alpha',
      message: 'Reply with exactly OK.',
      thinking: 'minimal',
      sessionKey: 'gemini-3-6-smoke',
    }, (event, data) => events.push({ event, data }), createAbortSignal())

    assert.equal(result.ok, true)
    assert.equal(result.reply, 'OK')
    assert.deepEqual(nativeCalls, [providerCase.provider === 'google' ? 'google' : 'vertex'])
    assert.equal(events.some((entry) => entry.event === 'start' && entry.data.transport === providerCase.kind), true)
  }
})

test('agent streaming service returns redacted direct provider failures', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const memories: string[] = []

  const service = createAgentStreamingService({
    streamingProviderConfig: {
      deepseek: {
        kind: 'openai-compatible',
        envKeys: ['DEEPSEEK_API_KEY'],
        endpoint: 'https://api.deepseek.com/chat/completions',
        docs: 'docs',
      },
    },
    isValidAgentId: (agentId) => agentId === 'agent-alpha',
    isRetiredAgentId: () => false,
    parseAgentRuntimeShortcut: () => null,
    agentRuntimeShortcutReason: () => ({ code: 'runtime-shortcut', message: 'shortcut' }),
    bufferedAgentRuntimeReason: () => null,
    runBufferedAgentTurnForStream: async () => {
      throw new Error('buffered path should not run')
    },
    resolveAgentPrimaryModelId: async () => 'deepseek/deepseek-chat',
    openAiCodexEmbeddedRuntimeReason: () => null,
    googleGeminiEmbeddedRuntimeReason: () => null,
    splitModelId: (modelId) => {
      const [provider, ...rest] = modelId.split('/')
      return { provider, model: rest.join('/') }
    },
    isOpenAiCodexSubscriptionModel: () => false,
    getAgentAuthEnv: async () => ({ DEEPSEEK_API_KEY: 'test-key' }),
    resolveOpenAiSubscriptionRequestAuth: async () => {
      throw new Error('not used')
    },
    resolveProviderRequestAuth: async () => ({ type: 'apiKey', value: 'test-key', source: 'env' }),
    streamingCapabilityForModel: () => ({ supported: true, provider: 'deepseek', transport: 'openai-compatible' }),
    resolveAgentRunContext: async () => ({
      executionWorkspace: 'C:/workspace',
      doctrineWorkspace: 'C:/workspace/.openclaw/agents/agent-alpha',
    }),
    agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
    agentTurnSessions: new Map<string, string>(),
    deleteProviderConversationHistory: () => undefined,
    resolveFilenameHintsForMessage: async (message) => ({ message, notes: [] }),
    getPartyMembers: async () => [{ id: 'agent-alpha', name: 'Ada' }],
    composeDirectProviderPrompt: (_agentId, message, workspace) => `${workspace}\n${message}`,
    providerConversationMessagesForRequest: (_sessionId, _provider, _modelId, userContent) => [
      { role: 'user', content: userContent },
    ],
    streamOpenAiCompatibleCompletion: async () => {
      throw new Error('provider failed with token=secret-123')
    },
    streamOpenAiResponsesCompletion: async () => {
      throw new Error('not used')
    },
    streamOpenAICodexResponsesCompletion: async () => {
      throw new Error('not used')
    },
    streamAnthropicMessage: async () => {
      throw new Error('not used')
    },
    streamGoogleVertexContent: async () => {
      throw new Error('not used')
    },
    streamGeminiContent: async () => {
      throw new Error('not used')
    },
    classifyFailureKind: (message) => /provider failed/i.test(message) ? 'provider_error' : undefined,
    redactHiddenReasoningAndSecrets: (value) => value.replace(/secret-\d+/g, '[redacted]'),
    appendAgentDailyMemory: async (_agentId, entry) => {
      memories.push(entry)
    },
    trimTask: (value, maxChars) => value.slice(0, maxChars),
    cleanupDoctrineMirrorsAfterRun: async () => undefined,
    sanitizeUserVisibleRuntimeText: (value) => value,
    saveProviderConversationTurn: () => undefined,
    buildDoctrineSyncReport: async () => ({ ok: true }),
    agentRuntimeContextPayload: (_agentId, context) => ({ workspace: context.executionWorkspace }),
    providerConversationMessageCount: () => 0,
  })

  const result = await service.streamProviderAgentTurn({
    agent: 'agent-alpha',
    message: 'summarize log.txt',
    thinking: 'low',
    sessionKey: 'console',
  }, (event, data) => events.push({ event, data }), createAbortSignal())

  assert.equal(result.ok, false)
  assert.equal(result.failureKind, 'provider_error')
  assert.match(String(result.reply), /\[redacted\]/)
  assert.doesNotMatch(String(result.reply), /secret-123/)
  assert.equal((result.streaming as Record<string, unknown>).liveTokens, true)
  assert.equal(events.some((entry) => entry.event === 'start' && entry.data.transport === 'openai-compatible'), true)
  assert.equal(memories.some((entry) => entry.includes('[redacted]')), true)
  assert.equal(memories.some((entry) => entry.includes('secret-123')), false)
})

test('gateway agent turn service rejects cancellation before dispatch', async () => {
  const service = createGatewayAgentTurnService({
    gatewayHttpPort: 18789,
    openClawAgentTurnTimeoutFloorSeconds: 60,
    isValidAgentId: (agentId) => agentId === 'agent-alpha',
    isRetiredAgentId: () => false,
    streamObserver: () => ({ emit: () => undefined }),
    ensureOpenclawAgentRunConfigDefaults: async () => undefined,
    readOpenclawConfig: async () => ({}),
    ensureAgentRuntimeHealthPreflight: async () => undefined,
    ensureAgentSandboxCompatibleWithHost: async () => undefined,
    startGatewayHealthMonitor: () => undefined,
    ensureGatewayRunning: async () => undefined,
    isGatewayHealthy: async () => true,
    isClawTalkSetupIntentMessage: () => false,
    isClawTalkIntentMessage: () => false,
    buildClawTalkRuntimeInstruction: (message) => message,
    readAgentPrimaryModelIdSync: () => 'openai:gpt-test',
    isGoogleGeminiModelId: () => false,
    thinkingForOpenClawRuntimeModel: (_modelId, thinking) => thinking,
    resolveEffectiveAgentFastMode: async () => 'auto',
    resolveEffectiveAgentWorkTimeoutSeconds: async () => 15,
    resolveAgentRunContext: async () => {
      throw new Error('context should not resolve after abort')
    },
    agentTurnSessionScope: (agentId, key) => `${agentId}:${key || 'default'}`,
    agentTurnSessions: new Map<string, string>(),
    deleteProviderConversationHistory: () => undefined,
    resolveFilenameHintsForMessage: async (message) => ({ message }),
    getPartyMembers: async () => [],
    composeAgentDoctrinePrompt: (_agentId, message) => message,
    runCwdForContext: (context) => context.executionWorkspace,
    agentWorkTimeoutWrapperMs: (seconds) => seconds * 1000,
    appendAgentPromptDump: async () => undefined,
    runGatewayChatTurn: async () => {
      throw new Error('Gateway chat should not run after abort')
    },
    extractAgentReply: (stdout) => stdout,
  })

  await assert.rejects(
    () => service.runGatewayAgentTurnForStream({
      agent: 'agent-alpha',
      message: 'inspect logs',
      thinking: 'low',
      sessionKey: 'console',
    }, 'observer-1', createAbortedSignal(), {
      route: '/api/openclaw/agent-turn/stream:command-console-direct',
      note: 'test route',
    }),
    { name: 'AbortError' },
  )
})

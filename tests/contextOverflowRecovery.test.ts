import { createBufferedAgentTurnService } from '../server/services/agents/agentTurnService'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGatewayAgentTurnService } from '../server/services/agents/gatewayAgentTurnService'
import { buildContextOverflowContinuationPrompt, isContextOverflowResult } from '../server/services/agents/contextOverflowRecovery'
const createAbortSignal = () => new AbortController().signal

for (const code of [0, 1, 400]) test(`gateway automatically recovers context overflow with exit code ${code}`, async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const gatewayTurns: Array<Record<string, unknown>> = []
  const deletedSessionIds: string[] = []
  const sessions = new Map<string, string>([['agent-alpha:clawtalk:sms:example', 'existing-session']])

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
    composeAgentDoctrinePrompt: (_agentId, message, _workspace, _doctrine, continuation) => `${continuation ? 'SHORT' : 'FULL'} ${message}`,
    runCwdForContext: (context) => context.executionWorkspace,
    agentWorkTimeoutWrapperMs: (seconds) => seconds * 1000,
    appendAgentPromptDump: async () => undefined,
    runGatewayChatTurn: async (payload) => {
      gatewayTurns.push(payload)
      if (gatewayTurns.length === 1) {
        return {
          stdout: code === 0 ? 'Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.' : '',
          stderr: code === 0 ? '' : 'context_length_exceeded',
          code,
        }
      }
      return { stdout: 'fresh reply', stderr: '', code: 0 }
    },
    extractAgentReply: (stdout) => stdout,
  })

  const result = await service.runGatewayAgentTurnForStream({
    agent: 'agent-alpha',
    message: 'What can you help me do?',
    attachments: [{ type: 'image', data: 'attachment' }],
    sessionKey: 'clawtalk:sms:example',
  }, 'observer-1', createAbortSignal(), {
    route: '/api/openclaw/agent-turn/stream',
    note: 'ClawTalk direct Gateway chat stream route',
  })

  assert.equal(gatewayTurns[0].sessionId, 'existing-session')
  assert.match(String(gatewayTurns[1].message), /FULL You are Ada/)
  assert.match(String(gatewayTurns[1].message), /What can you help me do/)
  assert.match(String(gatewayTurns[1].message), /verify whether actions already happened/)
  assert.deepEqual(gatewayTurns[1].attachments, gatewayTurns[0].attachments)
  assert.equal(gatewayTurns[1].requestedSessionKey, gatewayTurns[0].requestedSessionKey)
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'fresh reply')
  assert.ok(events.some((entry) => entry.event === 'delta' && entry.data.replace === true && entry.data.text === 'fresh reply'))
  assert.equal(gatewayTurns.length, 2)
  assert.notEqual(gatewayTurns[0].sessionId, gatewayTurns[1].sessionId)
  assert.equal(gatewayTurns[1].freshSession, true)
  assert.deepEqual(deletedSessionIds, [gatewayTurns[0].sessionId])
  assert.equal(sessions.get('agent-alpha:clawtalk:sms:example'), gatewayTurns[1].sessionId)
  assert.equal(events.some((entry) => entry.data.retry === 'context-overflow'), true)
})

for (const scenario of ['exhausted', 'cancel', 'unrelated']) test(`context recovery is bounded: ${scenario}`, async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const gatewayTurns: Array<Record<string, unknown>> = []
  const deletedSessionIds: string[] = []
  const controller = new AbortController()
  const sessions = new Map<string, string>([['agent-alpha:clawtalk:sms:example', 'existing-session']])

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
    composeAgentDoctrinePrompt: (_agentId, message, _workspace, _doctrine, continuation) => `${continuation ? 'SHORT' : 'FULL'} ${message}`,
    runCwdForContext: (context) => context.executionWorkspace,
    agentWorkTimeoutWrapperMs: (seconds) => seconds * 1000,
    appendAgentPromptDump: async () => undefined,
    runGatewayChatTurn: async (payload) => {
      gatewayTurns.push(payload)
      if (scenario === 'cancel') controller.abort()
      return scenario === 'unrelated'
        ? { stdout: 'To prevent context overflow, keep your prompts short.', stderr: '', code: 0 }
        : { stdout: 'Context overflow: prompt too large for the model.', stderr: '', code: 0 }
    },
    extractAgentReply: (stdout) => stdout,
  })

  const result = await service.runGatewayAgentTurnForStream({ agent: 'agent-alpha', message: 'Continue' }, 'observer', controller.signal, { route: '/api/openclaw/agent-turn/stream', note: 'test' })
  assert.equal(gatewayTurns.length, scenario === 'exhausted' ? 2 : 1)
  assert.equal(result.ok, scenario === 'unrelated')
  if (scenario !== 'unrelated') {
    assert.equal(result.failureKind, 'context_overflow')
    assert.equal(result.code, 1)
  }
})

test('context detection ignores echoed errors and generic new-session advice', () => {
  for (const reply of ['You can start a fresh session.', 'I fixed context overflow recovery.']) {
    assert.equal(isContextOverflowResult({ code: 0, stdout: 'context_length_exceeded', stderr: '' }, reply), false)
  }
})

test('context recovery does not resend an oversized doctrine prompt', () => {
  const prompt = buildContextOverflowContinuationPrompt('DOCTRINE '.repeat(20_000), 'Finish the SEO audit and save the report.', 2_400)
  assert.ok(prompt.length <= 2_400)
  assert.match(prompt, /Finish the SEO audit and save the report/)
  assert.match(prompt, /durable workspace and runtime state/)
  assert.doesNotMatch(prompt, /DOCTRINE DOCTRINE DOCTRINE DOCTRINE DOCTRINE DOCTRINE DOCTRINE DOCTRINE/)
})

test('buffered agent turn service replaces already streamed overflow text after recovery', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  let prewarmSource = ''

  const service = createBufferedAgentTurnService({
    registerGatewayChatStreamObserver: () => ({
      observer: { id: 'stream-2', textStreamed: true },
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
      text: JSON.stringify({ ok: true, reply: 'hello [secret]world[/secret]', code: 0, contextOverflowRecovered: true }),
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
  assert.equal(events.some((entry) => entry.event === 'delta' && entry.data.text === 'hello' && entry.data.replace === true), true)
  assert.equal(events.some((entry) => entry.event === 'progress' && entry.data.id === 'openclaw:finalizing'), true)
})

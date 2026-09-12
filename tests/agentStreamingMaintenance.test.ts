import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentStreamingService, type AgentStreamingServiceOptions } from '../server/services/agents/agentStreamingService'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture(overrides: Partial<AgentStreamingServiceOptions> = {}) {
  const saved: string[] = []
  const options: AgentStreamingServiceOptions = {
    streamingProviderConfig: { test: { kind: 'openai-compatible', envKeys: [], endpoint: 'https://provider.invalid', docs: '' } },
    isValidAgentId: () => true,
    isRetiredAgentId: () => false,
    parseAgentRuntimeShortcut: () => null,
    agentRuntimeShortcutReason: () => ({ code: 'runtime', message: 'runtime' }),
    bufferedAgentRuntimeReason: () => null,
    runBufferedAgentTurnForStream: async () => { throw new Error('unexpected runtime dispatch') },
    resolveAgentPrimaryModelId: async () => 'test/model',
    openAiCodexEmbeddedRuntimeReason: () => null,
    googleGeminiEmbeddedRuntimeReason: () => null,
    splitModelId: () => ({ provider: 'test', model: 'model' }),
    isOpenAiCodexSubscriptionModel: () => false,
    getAgentAuthEnv: async () => ({}),
    resolveOpenAiSubscriptionRequestAuth: async () => { throw new Error('unexpected subscription auth') },
    resolveProviderRequestAuth: async () => ({ type: 'apiKey', value: 'fixture', source: 'test' }),
    streamingCapabilityForModel: () => ({ supported: true }),
    resolveAgentRunContext: async () => ({ executionWorkspace: '/fixture', doctrineWorkspace: '/fixture' }),
    agentTurnSessionScope: (agent, session) => `${agent}:${session || 'default'}`,
    agentTurnSessions: new Map(),
    deleteProviderConversationHistory: () => undefined,
    resolveFilenameHintsForMessage: async (message) => ({ message, notes: [] }),
    getPartyMembers: async () => [],
    composeDirectProviderPrompt: (_agent, message) => message,
    providerConversationMessagesForRequest: (_session, _provider, _model, content) => [{ role: 'user', content }],
    streamOpenAiCompatibleCompletion: async () => ({ content: 'Completed answer' }),
    streamOpenAiResponsesCompletion: async () => ({ content: '' }),
    streamOpenAICodexResponsesCompletion: async () => ({ content: '' }),
    streamAnthropicMessage: async () => ({ content: '' }),
    streamGoogleVertexContent: async () => ({ content: '' }),
    streamGeminiContent: async () => ({ content: '' }),
    classifyFailureKind: () => undefined,
    redactHiddenReasoningAndSecrets: (text) => text.replaceAll('secret-value', '[redacted]'),
    appendAgentDailyMemory: async () => undefined,
    trimTask: (text, max) => text.slice(0, max),
    cleanupDoctrineMirrorsAfterRun: async () => undefined,
    sanitizeUserVisibleRuntimeText: (text) => text,
    saveProviderConversationTurn: (_session, _provider, _model, _request, assistant) => { saved.push(assistant.content) },
    buildDoctrineSyncReport: async () => ({ ok: true }),
    agentRuntimeContextPayload: () => ({}),
    providerConversationMessageCount: () => 2,
    ...overrides,
  }
  return { saved, service: createAgentStreamingService(options) }
}

test('same-conversation turns serialize history while other conversations remain independent', async () => {
  const firstStarted = deferred<void>()
  const firstReply = deferred<{ content: string }>()
  const otherStarted = deferred<void>()
  const secondStarted = deferred<void>()
  const requests: string[][] = []
  const histories = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()
  const { service } = fixture({
    providerConversationMessagesForRequest: (session, _provider, _model, content) => [
      ...(histories.get(session) || []), { role: 'user', content },
    ],
    saveProviderConversationTurn: (session, _provider, _model, request, answer) => {
      histories.set(session, [...request, { role: 'assistant', content: answer.content }])
    },
    streamOpenAiCompatibleCompletion: async ({ messages }) => {
      const request = messages.map((message) => message.content)
      requests.push(request)
      const prompt = request.at(-1) || ''
      if (prompt.endsWith('first')) {
        firstStarted.resolve()
        return firstReply.promise
      }
      if (prompt.endsWith('other')) otherStarted.resolve()
      if (prompt.endsWith('second')) secondStarted.resolve()
      return { content: prompt.endsWith('other') ? 'other answer' : 'second answer' }
    },
  })
  const run = (message: string, sessionKey: string) => service.streamProviderAgentTurn(
    { agent: 'agent', message, sessionKey, thinking: 'off' }, () => undefined, new AbortController().signal,
  )
  const first = run('first', 'shared')
  await firstStarted.promise
  const second = run('second', 'shared')
  const other = run('other', 'independent')
  await otherStarted.promise
  assert.equal(requests.length, 2)
  firstReply.resolve({ content: 'first answer' })
  await Promise.all([first, second, other, secondStarted.promise])
  const secondRequest = requests.find((messages) => messages.at(-1)?.endsWith('second'))
  assert.equal(secondRequest?.length, 3)
  assert.equal(secondRequest?.[1], 'first answer')
})

test('cancelling a queued conversation turn responds immediately without dispatching it', async () => {
  const firstStarted = deferred<void>()
  const firstReply = deferred<{ content: string }>()
  const queued = deferred<void>()
  let dispatches = 0
  const { service } = fixture({ streamOpenAiCompatibleCompletion: async () => {
    dispatches += 1
    firstStarted.resolve()
    return firstReply.promise
  } })
  const input = { agent: 'agent', message: 'hello', thinking: 'off' as const }
  const first = service.streamProviderAgentTurn(input, () => undefined, new AbortController().signal)
  await firstStarted.promise
  const controller = new AbortController()
  const second = service.streamProviderAgentTurn(input, (event, data) => {
    if (event === 'status' && data.label === 'Queued') queued.resolve()
  }, controller.signal)
  await queued.promise
  controller.abort()
  await assert.rejects(second, { name: 'AbortError' })
  assert.equal(dispatches, 1)
  firstReply.resolve({ content: 'done' })
  await first
})

for (const operation of ['cleanupDoctrineMirrorsAfterRun', 'appendAgentDailyMemory', 'buildDoctrineSyncReport'] as const) {
  test(`successful provider answer survives failed ${operation}`, async () => {
    const { service, saved } = fixture({ [operation]: async () => { throw new Error('permission denied: secret-value') } })
    const result = await service.streamProviderAgentTurn(
      { agent: 'agent', message: 'hello', thinking: 'off' },
      () => undefined,
      new AbortController().signal,
    )
    assert.equal(result.ok, true)
    assert.equal(result.reply, 'Completed answer')
    assert.deepEqual(saved, ['Completed answer'])
    const maintenance = result.maintenance as { ok: boolean; issues: Array<{ message: string }> }
    assert.equal(maintenance.ok, false)
    assert.equal(maintenance.issues.length, 1)
    assert.match(maintenance.issues[0].message, /permission denied/)
    assert.doesNotMatch(maintenance.issues[0].message, /secret-value/)
  })
}

test('direct provider streaming compacts and retries an overflow once', async () => {
  const attempts: string[] = []
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const { service } = fixture({
    composeDirectProviderPrompt: (_agent, message) => `DOCTRINE\n${message}`,
    streamOpenAiCompatibleCompletion: async ({ messages }) => {
      attempts.push(messages.at(-1)?.content || '')
      if (attempts.length === 1) throw new Error('context_length_exceeded: prompt too large for the model')
      return { content: 'continued after compaction' }
    },
  })

  const result = await service.streamProviderAgentTurn(
    { agent: 'agent', message: 'Finish the SEO audit and save the report.', thinking: 'off' },
    (event, data) => events.push({ event, data }),
    new AbortController().signal,
  )

  assert.equal(result.ok, true)
  assert.equal(result.reply, 'continued after compaction')
  assert.equal(attempts.length, 2)
  assert.match(attempts[1], /Finish the SEO audit and save the report/)
  assert.ok(events.some((entry) => entry.event === 'status' && entry.data.retry === 'context-overflow'))
})

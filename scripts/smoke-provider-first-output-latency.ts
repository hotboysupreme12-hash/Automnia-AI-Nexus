import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createAgentStreamingService } from '../server/services/agents/agentStreamingService'

const COLD_FIRST_OUTPUT_BUDGET_MS = 1_000
const WARM_FIRST_OUTPUT_BUDGET_MS = 750

let providerDispatches = 0
const service = createAgentStreamingService({
  streamingProviderConfig: {
    smoke: { kind: 'openai-compatible', envKeys: [], endpoint: 'https://smoke.invalid', docs: '' },
  },
  isValidAgentId: () => true,
  isRetiredAgentId: () => false,
  parseAgentRuntimeShortcut: () => null,
  agentRuntimeShortcutReason: () => ({ code: 'runtime', message: 'runtime' }),
  bufferedAgentRuntimeReason: () => null,
  runBufferedAgentTurnForStream: async () => { throw new Error('latency smoke unexpectedly entered the runtime path') },
  resolveAgentPrimaryModelId: async () => 'smoke/model',
  openAiCodexEmbeddedRuntimeReason: () => null,
  googleGeminiEmbeddedRuntimeReason: () => null,
  splitModelId: () => ({ provider: 'smoke', model: 'model' }),
  isOpenAiCodexSubscriptionModel: () => false,
  getAgentAuthEnv: async () => ({}),
  resolveOpenAiSubscriptionRequestAuth: async () => { throw new Error('unexpected subscription auth') },
  resolveProviderRequestAuth: async () => ({ type: 'apiKey', value: 'synthetic-smoke-auth', source: 'smoke' }),
  streamingCapabilityForModel: () => ({ supported: true }),
  resolveAgentRunContext: async () => ({ executionWorkspace: '.', doctrineWorkspace: '.' }),
  agentTurnSessionScope: (agent, sessionKey) => `${agent}:${sessionKey || 'default'}`,
  agentTurnSessions: new Map(),
  deleteProviderConversationHistory: () => undefined,
  resolveFilenameHintsForMessage: async (message) => ({ message, notes: [] }),
  getPartyMembers: async () => [],
  composeDirectProviderPrompt: (_agent, message) => message,
  providerConversationMessagesForRequest: (_session, _provider, _model, content) => [{ role: 'user', content }],
  streamOpenAiCompatibleCompletion: async ({ emit }) => {
    providerDispatches += 1
    emit('delta', { text: 'OK' })
    return { content: 'OK' }
  },
  streamOpenAiResponsesCompletion: async () => ({ content: '' }),
  streamOpenAICodexResponsesCompletion: async () => ({ content: '' }),
  streamAnthropicMessage: async () => ({ content: '' }),
  streamGoogleVertexContent: async () => ({ content: '' }),
  streamGeminiContent: async () => ({ content: '' }),
  classifyFailureKind: () => undefined,
  redactHiddenReasoningAndSecrets: (value) => value,
  appendAgentDailyMemory: async () => undefined,
  trimTask: (value, max) => value.slice(0, max),
  cleanupDoctrineMirrorsAfterRun: async () => undefined,
  sanitizeUserVisibleRuntimeText: (value) => value,
  saveProviderConversationTurn: () => undefined,
  buildDoctrineSyncReport: async () => ({ ok: true }),
  agentRuntimeContextPayload: () => ({}),
  providerConversationMessageCount: () => 2,
})

async function measureFirstOutput(message: string) {
  const startedAt = performance.now()
  let firstOutputMs: number | null = null
  const result = await service.streamProviderAgentTurn(
    { agent: 'latency-smoke', message, sessionKey: 'cold-warm-session', thinking: 'off' },
    (event) => {
      if (event === 'delta' && firstOutputMs === null) firstOutputMs = performance.now() - startedAt
    },
    new AbortController().signal,
  )
  assert.equal(result.ok, true, `synthetic ${message} turn should succeed`)
  assert.notEqual(firstOutputMs, null, `synthetic ${message} turn should emit first output`)
  return firstOutputMs as number
}

const coldFirstOutputMs = await measureFirstOutput('cold-start')
const warmFirstOutputMs = await measureFirstOutput('warm-session')

assert.equal(providerDispatches, 2, 'the smoke must use only its two synthetic provider adapters')
assert.ok(coldFirstOutputMs <= COLD_FIRST_OUTPUT_BUDGET_MS, `cold first output ${coldFirstOutputMs.toFixed(1)}ms exceeded ${COLD_FIRST_OUTPUT_BUDGET_MS}ms budget`)
assert.ok(warmFirstOutputMs <= WARM_FIRST_OUTPUT_BUDGET_MS, `warm first output ${warmFirstOutputMs.toFixed(1)}ms exceeded ${WARM_FIRST_OUTPUT_BUDGET_MS}ms budget`)

process.stdout.write(`${JSON.stringify({
  mode: 'synthetic-no-network-no-billing',
  coldFirstOutputMs: Number(coldFirstOutputMs.toFixed(1)),
  coldBudgetMs: COLD_FIRST_OUTPUT_BUDGET_MS,
  warmFirstOutputMs: Number(warmFirstOutputMs.toFixed(1)),
  warmBudgetMs: WARM_FIRST_OUTPUT_BUDGET_MS,
  providerDispatches,
})}\n`)

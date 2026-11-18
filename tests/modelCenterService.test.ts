import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createModelCenterService,
  explainModelFallback,
  MODEL_PROBE_MAX_OUTPUT_TOKENS,
  MODEL_PROBE_TIMEOUT_MS,
  type ModelCapabilityStoreState,
} from '../server/services/providers/modelCenterService'

function createHarness() {
  let state: ModelCapabilityStoreState | null = null
  let now = Date.parse('2026-11-17T12:00:00.000Z')
  let providerConfigured = true
  const calls: Array<{ args: string[]; timeoutMs: number }> = []
  const responses: Array<{ code: number; stdout?: string; stderr?: string }> = []
  const service = createModelCenterService({
    isProviderConfigured: () => providerConfigured,
    now: () => now,
    readState: () => state,
    runOpenClaw: async (args, timeoutMs) => {
      calls.push({ args, timeoutMs })
      return responses.shift() || { code: 1, stderr: 'no mock response' }
    },
    writeState: (next) => {
      state = JSON.parse(JSON.stringify(next)) as ModelCapabilityStoreState
      return true
    },
  })
  return {
    calls,
    responses,
    service,
    get state() { return state },
    get now() { return now },
    set now(value: number) { now = value },
    set providerConfigured(value: boolean) { providerConfigured = value },
  }
}

test('capability refresh persists only bounded provider metadata with source and verification time', async () => {
  const harness = createHarness()
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({
      providerOutcomes: [{ provider: 'xai', status: 'ready', profileId: 'private-profile-id' }],
      models: [
        {
          id: 'xai/grok-4.7',
          provider: 'xai',
          name: 'Grok 4.7',
          contextWindow: 500_000,
          contextTokens: 450_000,
          contextWindows: [{ contextWindow: 500_000, contextTokens: 450_000, region: 'global', apiKey: 'must-not-persist' }],
          input: ['text', 'image', 'unsupported-secret'],
          output: ['text'],
          reasoning: true,
          supportsTools: true,
          apiKey: 'must-not-persist',
        },
        { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', contextWindow: 1_000_000 },
        { id: 'xai/not-a-valid-ref with spaces', provider: 'xai' },
      ],
    }),
  })

  const result = await harness.service.refreshProviderCapabilities('xai')
  assert.equal(result.ok, true)
  assert.deepEqual(harness.calls[0]?.args, ['models', 'list', '--all', '--json', '--refresh', '--provider', 'xai'])
  assert.equal(harness.calls[0]?.timeoutMs, 30_000)
  assert.equal(result.snapshot?.source, 'openclaw-model-catalog')
  assert.equal(result.snapshot?.verifiedAt, '2026-11-17T12:00:00.000Z')
  assert.equal(result.snapshot?.catalogOutcome, 'ready')
  assert.equal(result.snapshot?.models.length, 1)
  assert.deepEqual(result.snapshot?.models[0], {
    id: 'xai/grok-4.7',
    provider: 'xai',
    name: 'Grok 4.7',
    contextWindow: 500_000,
    contextTokens: 450_000,
    contextWindows: [{ contextWindow: 500_000, contextTokens: 450_000, region: 'global' }],
    input: ['text', 'image'],
    output: ['text'],
    reasoning: true,
    thinkingDefault: 'low',
    supportsTools: true,
    source: 'openclaw-model-catalog',
    verifiedAt: '2026-11-17T12:00:00.000Z',
  })
  assert.doesNotMatch(JSON.stringify(harness.state), /must-not-persist|private-profile-id/)
})

test('capability refresh resolves reasoning defaults and invalidates them when normalized metadata changes', async () => {
  const harness = createHarness()
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({ models: [{ id: 'google/gemini-4-hydrogen', provider: 'google', reasoning: true }] }),
  })
  const first = await harness.service.refreshProviderCapabilities('google')
  assert.equal(first.ok, true)
  assert.equal(first.snapshot?.models[0]?.thinkingDefault, 'low')

  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({ models: [{ id: 'google/gemini-4-hydrogen', provider: 'google', reasoning: false }] }),
  })
  const refreshed = await harness.service.refreshProviderCapabilities('google')
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.snapshot?.models[0]?.thinkingDefault, 'off')
  assert.equal((await harness.service.getCapabilitySnapshots('google'))[0]?.models[0]?.thinkingDefault, 'off')
})

test('failed capability refresh keeps the last durable snapshot', async () => {
  const harness = createHarness()
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.7', provider: 'xai', reasoning: true }] }),
  })
  const first = await harness.service.refreshProviderCapabilities('xai')
  assert.equal(first.ok, true)

  harness.now += 1_000
  harness.responses.push({ code: 0, stdout: JSON.stringify({ models: [] }) })
  const second = await harness.service.refreshProviderCapabilities('xai')
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'empty_catalog')
  assert.equal(second.snapshot?.verifiedAt, '2026-11-17T12:00:00.000Z')
  assert.equal((await harness.service.getCapabilitySnapshots('xai'))[0]?.stale, false)
})

test('capability refresh refuses oversized catalog output and preserves the last good snapshot', async () => {
  const harness = createHarness()
  harness.responses.push({ code: 0, stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.7', provider: 'xai' }] }) })
  const initial = await harness.service.refreshProviderCapabilities('xai')
  assert.equal(initial.ok, true)

  harness.responses.push({ code: 0, stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.8', provider: 'xai' }], extra: 'x'.repeat(2 * 1024 * 1024) }) })
  const oversized = await harness.service.refreshProviderCapabilities('xai')
  assert.equal(oversized.ok, false)
  assert.equal(oversized.reason, 'invalid_catalog_response')
  assert.equal(oversized.snapshot?.models[0]?.id, 'xai/grok-4.7')
})

test('model probe requires a snapshotted configured model and uses strict request bounds', async () => {
  const harness = createHarness()
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.7', provider: 'xai', supportsTools: true }] }),
  })
  await harness.service.refreshProviderCapabilities('xai')
  harness.responses.push({ code: 0, stdout: JSON.stringify({ ok: true, final: 'OK' }) })

  const probe = await harness.service.probeModel('xai/grok-4.7')
  assert.equal(probe.ok, true)
  assert.equal(probe.result?.status, 'passed')
  assert.equal(probe.result?.timeoutMs, MODEL_PROBE_TIMEOUT_MS)
  assert.equal(probe.result?.maxOutputTokens, MODEL_PROBE_MAX_OUTPUT_TOKENS)
  const call = harness.calls[1]
  assert.equal(call?.timeoutMs, MODEL_PROBE_TIMEOUT_MS)
  assert.deepEqual(call?.args.slice(0, 2), ['agent', 'exec'])
  assert.ok(call?.args.includes('xai/grok-4.7'))
  assert.ok(call?.args.includes('--timeout'))
  assert.ok(call?.args.includes(String(MODEL_PROBE_TIMEOUT_MS / 1000)))
  const overrideIndex = call?.args.indexOf('--config-override') ?? -1
  const override = JSON.parse(call?.args[overrideIndex + 1] || '{}') as {
    agents?: { defaults?: { model?: { primary?: string; fallbacks?: string[] }; models?: Record<string, { params?: { maxTokens?: number } }> } }
    tools?: { deny?: string[] }
  }
  assert.equal(override.agents?.defaults?.model?.primary, 'xai/grok-4.7')
  assert.deepEqual(override.agents?.defaults?.model?.fallbacks, [])
  assert.equal(override.agents?.defaults?.models?.['xai/grok-4.7']?.params?.maxTokens, MODEL_PROBE_MAX_OUTPUT_TOKENS)
  assert.deepEqual(override.tools?.deny, ['*'])
  assert.equal(JSON.stringify(harness.state?.probes).includes('OK'), false)

  const cooldown = await harness.service.probeModel('xai/grok-4.7')
  assert.equal(cooldown.reason, 'cooldown')
  assert.equal(harness.calls.length, 2)
})

test('model probe declines missing auth and models without a persisted capability row', async () => {
  const harness = createHarness()
  harness.responses.push({ code: 0, stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.7', provider: 'xai' }] }) })
  await harness.service.refreshProviderCapabilities('xai')
  harness.providerConfigured = false
  assert.equal((await harness.service.probeModel('xai/grok-4.7')).reason, 'provider_not_configured')
  harness.providerConfigured = true
  assert.equal((await harness.service.probeModel('xai/unknown')).reason, 'model_not_snapshotted')
  assert.equal(harness.calls.length, 1)
})

test('provider onboarding reports auth, discovery, bounded opt-in contract, and advertised capabilities without probing', async () => {
  const harness = createHarness()
  harness.providerConfigured = false
  const missingAuth = await harness.service.checkProviderOnboarding('xai')
  assert.equal(missingAuth.status, 'authentication_required')
  assert.equal(missingAuth.probeContract.available, false)
  assert.equal(missingAuth.probeContract.executed, false)
  assert.equal(harness.calls.length, 0)

  harness.providerConfigured = true
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({
      providerOutcomes: [{ provider: 'xai', status: 'ready' }],
      models: [{
        id: 'xai/grok-4.7',
        provider: 'xai',
        contextWindow: 500_000,
        input: ['text', 'image'],
        output: ['text'],
        reasoning: true,
        supportsTools: true,
      }],
    }),
  })
  await harness.service.refreshProviderCapabilities('xai')
  const onboarding = await harness.service.checkProviderOnboarding('xai')

  assert.equal(onboarding.status, 'ready_for_opt_in_probe')
  assert.equal(onboarding.authentication.configured, true)
  assert.deepEqual(onboarding.catalog, {
    discovered: true,
    outcome: 'ready',
    verifiedAt: '2026-11-17T12:00:00.000Z',
    stale: false,
    modelCount: 1,
  })
  assert.deepEqual(onboarding.probeContract, {
    available: true,
    executed: false,
    requiresExplicitConfirmation: true,
    mayBeBillable: true,
    toolsDisabled: true,
    timeoutMs: MODEL_PROBE_TIMEOUT_MS,
    maxOutputTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS,
  })
  assert.deepEqual(onboarding.advertisedCapabilities, {
    inputModalities: ['image', 'text'],
    outputModalities: ['text'],
    reasoningModelCount: 1,
    toolCapableModelCount: 1,
    contextWindowModelCount: 1,
  })
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls.some((call) => call.args[0] === 'agent'), false)
})

test('model probe rejects oversized process output without persisting response content', async () => {
  const harness = createHarness()
  harness.responses.push({ code: 0, stdout: JSON.stringify({ models: [{ id: 'xai/grok-4.7', provider: 'xai' }] }) })
  await harness.service.refreshProviderCapabilities('xai')
  harness.responses.push({ code: 0, stdout: JSON.stringify({ ok: true, extra: 'x'.repeat(128 * 1024) }) })

  const result = await harness.service.probeModel('xai/grok-4.7')

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid_probe_response')
  assert.equal(result.result?.status, 'failed')
  assert.equal(JSON.stringify(harness.state?.probes).includes('extra'), false)
})

test('provider permission failures are stored as a safe auth or entitlement outcome', async () => {
  const harness = createHarness()
  harness.responses.push({
    code: 0,
    stdout: JSON.stringify({ models: [{ id: 'google-vertex/gemini-4-argon', provider: 'google-vertex' }] }),
  })
  await harness.service.refreshProviderCapabilities('google-vertex')
  harness.responses.push({
    code: 1,
    stderr: '403 PERMISSION_DENIED for projects/private-project aiplatform.endpoints.predict access_token=private-token',
  })

  const probe = await harness.service.probeModel('google-vertex/gemini-4-argon')
  assert.equal(probe.ok, false)
  assert.equal(probe.reason, 'provider_auth_or_entitlement_failed')
  assert.equal(probe.result?.status, 'blocked')
  assert.equal(probe.result?.reason, 'provider_auth_or_entitlement_failed')
  assert.doesNotMatch(JSON.stringify(probe), /private-project|private-token|PERMISSION_DENIED|403/)
  assert.doesNotMatch(JSON.stringify(harness.state), /private-project|private-token|PERMISSION_DENIED|403/)
})

test('fallback explanation names the requested and resolved model with a safe reason code', () => {
  assert.deepEqual(explainModelFallback({
    requestedModel: 'openai/gpt-6.2-astra',
    resolvedModel: 'anthropic/claude-sonnet-5-5',
    fallbacks: ['anthropic/claude-sonnet-5-5'],
    requestedModelUnavailable: true,
  }), {
    requestedModel: 'openai/gpt-6.2-astra',
    resolvedModel: 'anthropic/claude-sonnet-5-5',
    fallbackChain: ['anthropic/claude-sonnet-5-5'],
    selectedFrom: 'agent-fallback',
    reason: 'requested-model-unavailable',
  })
  assert.equal(explainModelFallback({
    requestedModel: 'openai/gpt-6.2-astra',
    resolvedModel: 'automnia-cloud/gemini-4-argon',
    billingPolicyOverride: true,
  }).reason, 'billing-policy-override')
  assert.equal(explainModelFallback({
    requestedModel: null,
    resolvedModel: 'automnia-cloud/gemini-4-hydrogen',
  }).reason, 'system-default-selected')
})

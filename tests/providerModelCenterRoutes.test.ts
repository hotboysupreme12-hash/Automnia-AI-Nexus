import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { createModelCenterService, type ModelCapabilityStoreState } from '../server/services/providers/modelCenterService'
import { registerProviderAuthRoutes } from '../server/routes/providerAuthRoutes'

async function withProviderRoutes<T>(run: (baseUrl: string, calls: string[][]) => Promise<T>, probePermissionFailure = false) {
  const calls: string[][] = []
  let storedState: unknown = null
  const modelCenter = createModelCenterService({
    isProviderConfigured: () => true,
    readState: () => storedState as ModelCapabilityStoreState | null,
    runOpenClaw: async (args) => {
      calls.push(args)
      if (args[0] === 'models') {
        return {
          code: 0,
          stdout: JSON.stringify({
            providerOutcomes: [{ provider: 'xai', status: 'ready' }],
            models: [{ id: 'xai/grok-4.7', provider: 'xai', contextWindow: 131_072, supportsTools: true }],
          }),
        }
      }
      return probePermissionFailure
        ? { code: 1, stderr: '403 PERMISSION_DENIED for projects/private-project access_token=private-token' }
        : { code: 0, stdout: JSON.stringify({ ok: true, final: 'OK' }) }
    },
    writeState: (state) => {
      storedState = structuredClone(state)
      return true
    },
  })
  const app = express()
  app.use(express.json())
  registerProviderAuthRoutes(app, {
    authEnvMap: {},
    authProviderCatalog: {},
    fallbackAvailableModels: () => [],
    getFastAvailableModelsCatalog: () => ({ models: [], source: 'test' }),
    anthropicOAuthRedirectUri: 'http://127.0.0.1/anthropic',
    googleOAuthRedirectUri: 'http://127.0.0.1/google',
    localAuthPath: 'test-auth-state',
    oauthSessions: new Map(),
    openAiCodexOAuthRedirectUri: 'http://127.0.0.1/openai',
    parseOpenAICodexAuthorizationInput: (input) => ({ code: input }),
    completeOpenAICodexOAuthSession: async () => undefined,
    submitAnthropicOAuthManualInput: async () => undefined,
    persistProviderAuth: async () => undefined,
    updateProviderOAuthSettings: async () => undefined,
    providerAuthStatus: () => ({}),
    refreshAvailableModelsCache: async () => ({ models: [], source: 'test', refreshedAt: 0 }),
    removeProviderAuth: async () => undefined,
    startGoogleOAuthSession: async () => ({ session: {} as never, launched: { ok: false } }),
    startAnthropicOAuthSession: async () => ({ session: {} as never, launched: { ok: false } }),
    startOpenAICodexOAuthSession: async () => ({ session: {} as never, launched: { ok: false } }),
    modelCenter,
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
  try {
    return await run(`http://127.0.0.1:${address.port}`, calls)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('provider model-center endpoints require an explicit bounded probe request', async () => {
  await withProviderRoutes(async (baseUrl, calls) => {
    const refresh = await fetch(`${baseUrl}/api/models/capabilities?provider=xai&refresh=1`)
    const refreshBody = await refresh.json() as { ok: boolean; data?: { refreshed?: boolean; snapshot?: { models?: Array<{ id: string }> } } }
    assert.equal(refresh.status, 200)
    assert.equal(refreshBody.data?.refreshed, true)
    assert.equal(refreshBody.data?.snapshot?.models?.[0]?.id, 'xai/grok-4.7')

    const onboardingResponse = await fetch(`${baseUrl}/api/models/onboarding?provider=xai`)
    const onboardingBody = await onboardingResponse.json() as {
      data?: {
        onboarding?: {
          status?: string
          probeContract?: { executed?: boolean; requiresExplicitConfirmation?: boolean; mayBeBillable?: boolean }
          advertisedCapabilities?: { toolCapableModelCount?: number }
        }
      }
    }
    assert.equal(onboardingResponse.status, 200)
    assert.equal(onboardingBody.data?.onboarding?.status, 'ready_for_opt_in_probe')
    assert.equal(onboardingBody.data?.onboarding?.probeContract?.executed, false)
    assert.equal(onboardingBody.data?.onboarding?.probeContract?.requiresExplicitConfirmation, true)
    assert.equal(onboardingBody.data?.onboarding?.probeContract?.mayBeBillable, true)
    assert.equal(onboardingBody.data?.onboarding?.advertisedCapabilities?.toolCapableModelCount, 1)
    assert.equal(calls.length, 1)

    const noConfirmation = await fetch(`${baseUrl}/api/models/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'xai/grok-4.7' }),
    })
    assert.equal(noConfirmation.status, 400)
    assert.equal(calls.length, 1)

    const probe = await fetch(`${baseUrl}/api/models/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'xai/grok-4.7', confirm: true }),
    })
    const probeBody = await probe.json() as { ok: boolean; data?: { passed?: boolean; reason?: string; probe?: { modelId?: string; maxOutputTokens?: number } } }
    assert.equal(probe.status, 200)
    assert.equal(probeBody.data?.passed, true)
    assert.equal(probeBody.data?.reason, 'ok')
    assert.equal(probeBody.data?.probe?.modelId, 'xai/grok-4.7')
    assert.equal(probeBody.data?.probe?.maxOutputTokens, 8)
    assert.deepEqual(calls[1]?.slice(0, 2), ['agent', 'exec'])
  })
})

test('provider model-center capability refresh requires one valid provider', async () => {
  await withProviderRoutes(async (baseUrl, calls) => {
    const missingProvider = await fetch(`${baseUrl}/api/models/capabilities?refresh=1`)
    assert.equal(missingProvider.status, 400)
    const invalidProvider = await fetch(`${baseUrl}/api/models/capabilities?provider=bad%20provider&refresh=1`)
    assert.equal(invalidProvider.status, 400)
    const missingOnboardingProvider = await fetch(`${baseUrl}/api/models/onboarding`)
    assert.equal(missingOnboardingProvider.status, 400)
    const invalidOnboardingProvider = await fetch(`${baseUrl}/api/models/onboarding?provider=bad%20provider`)
    assert.equal(invalidOnboardingProvider.status, 400)
    assert.equal(calls.length, 0)
  })
})

test('provider probe reports permission failure with a sanitized reason code', async () => {
  await withProviderRoutes(async (baseUrl, calls) => {
    await fetch(`${baseUrl}/api/models/capabilities?provider=xai&refresh=1`)
    const response = await fetch(`${baseUrl}/api/models/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'xai/grok-4.7', confirm: true }),
    })
    const body = await response.json() as {
      ok: boolean
      data: {
        passed: boolean
        reason: string
        probe: {
          modelId: string
          provider: string
          status: string
          reason: string
          checkedAt: string
          durationMs: number
          timeoutMs: number
          maxOutputTokens: number
        }
      }
    }
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.data.passed, false)
    assert.equal(body.data.reason, 'provider_auth_or_entitlement_failed')
    assert.equal(body.data.probe.status, 'blocked')
    assert.equal(body.data.probe.reason, 'provider_auth_or_entitlement_failed')
    assert.deepEqual(Object.keys(body.data.probe).sort(), [
      'checkedAt', 'durationMs', 'maxOutputTokens', 'modelId', 'provider', 'reason', 'status', 'timeoutMs',
    ])
    assert.doesNotMatch(JSON.stringify({
      reason: body.data.reason,
      modelId: body.data.probe.modelId,
      provider: body.data.probe.provider,
      status: body.data.probe.status,
      probeReason: body.data.probe.reason,
    }), /private-project|private-token|PERMISSION_DENIED|403/)
    assert.equal(calls.length, 2)
  }, true)
})

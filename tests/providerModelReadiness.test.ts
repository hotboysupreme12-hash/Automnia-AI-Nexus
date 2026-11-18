import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runBoundedProviderModelProbe, type ProviderModelOnboarding } from '../src/api/providerModelReadiness'
import { ProviderModelReadinessView } from '../src/components/auth/ProviderModelReadinessPanel'

test('provider model probe client refuses an unconfirmed request without making a network call', async () => {
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    calls += 1
    return Response.json({ ok: true, data: { passed: true, reason: 'ok', probe: null } })
  }) as typeof fetch
  try {
    await assert.rejects(runBoundedProviderModelProbe('xai/grok-4.7', false), /Explicit confirmation is required/)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('confirmed bounded probe sends the required explicit confirmation', async () => {
  const requests: Array<{ url: string; method: string; body: string }> = []
  const originalFetch = globalThis.fetch
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'http://localhost:4050/', port: '4050' },
      setTimeout,
      clearTimeout,
    },
  })
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method || 'GET',
      body: String(init?.body || ''),
    })
    return Response.json({ ok: true, data: { passed: true, reason: 'ok', probe: null } })
  }) as typeof fetch
  try {
    const result = await runBoundedProviderModelProbe('xai/grok-4.7', true)
    assert.equal(result.ok, true)
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, '/api/models/probe')
    assert.equal(requests[0]?.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0]?.body || '{}'), { modelId: 'xai/grok-4.7', confirm: true })
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('provider readiness view explains catalog and capability state before offering an explicit probe confirmation', () => {
  const onboarding: ProviderModelOnboarding = {
    provider: 'xai',
    checkedAt: '2026-11-17T12:00:00.000Z',
    status: 'ready_for_opt_in_probe',
    authentication: { configured: true },
    catalog: {
      discovered: true,
      outcome: 'ready',
      verifiedAt: '2026-11-17T11:00:00.000Z',
      stale: false,
      modelCount: 1,
    },
    probeContract: {
      available: true,
      executed: false,
      requiresExplicitConfirmation: true,
      mayBeBillable: true,
      toolsDisabled: true,
      timeoutMs: 15_000,
      maxOutputTokens: 8,
    },
    advertisedCapabilities: {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      reasoningModelCount: 1,
      toolCapableModelCount: 1,
      contextWindowModelCount: 1,
    },
  }
  const props = {
    providerLabel: 'xAI',
    authenticationConfigured: true,
    onboarding,
    models: [{ id: 'xai/grok-4.7', provider: 'xai', name: 'Grok 4.7', verifiedAt: onboarding.catalog.verifiedAt || '' }],
    selectedModelId: 'xai/grok-4.7',
    pendingProbeModelId: '',
    probeOutcome: null,
    loading: false,
    refreshing: false,
    probing: false,
    error: '',
    onRefresh: () => undefined,
    onSelectModel: () => undefined,
    onBeginProbe: () => undefined,
    onCancelProbe: () => undefined,
    onConfirmProbe: () => undefined,
  }
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
  try {
    const readyMarkup = renderToStaticMarkup(React.createElement(ProviderModelReadinessView, props))
    assert.match(readyMarkup, /Authentication[\s\S]*Configured/)
    assert.match(readyMarkup, /Ready for opt-in probe/)
    assert.match(readyMarkup, /Input: text, image · Output: text/)
    assert.match(readyMarkup, /Probe selected model/)
    assert.doesNotMatch(readyMarkup, /Confirm and run probe/)

    const confirmationMarkup = renderToStaticMarkup(React.createElement(ProviderModelReadinessView, {
      ...props,
      pendingProbeModelId: 'xai/grok-4.7',
    }))
    assert.match(confirmationMarkup, /Confirm a potentially billable probe/)
    assert.match(confirmationMarkup, /This can incur provider charges/)
    assert.match(confirmationMarkup, /Confirm and run probe/)
  } finally {
    Reflect.deleteProperty(globalThis, 'React')
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBrowserPreflightService,
  type BrowserPreflightServiceOptions,
} from '../server/services/browser/browserPreflightService'

function createHarness(overrides: Partial<BrowserPreflightServiceOptions> = {}) {
  let currentTime = 0
  let gatewayHealthyChecks = 0
  const state = {
    gatewayHealthyChecks: () => gatewayHealthyChecks,
    runBrowserToolProbeCalls: 0,
    tryReleaseBrowserRelayPortCalls: 0,
  }

  const service = createBrowserPreflightService({
    ensureOpenclawAgentRunConfigDefaults: async () => undefined,
    getOpenClawPluginEnabled: async () => ({ enabled: true, detail: 'browser plugin enabled' }),
    repairGatewayTokenConfigSync: () => ({ repaired: false }),
    ensureGatewayRunning: async () => undefined,
    startGatewayHealthMonitor: () => undefined,
    isGatewayHealthy: async () => {
      gatewayHealthyChecks += 1
      return true
    },
    tryRestartGatewayService: async () => ({ restarted: false, detail: 'restart skipped' }),
    tryStartBrowserRelayWithRepair: async () => ({ started: true, detail: 'browser relay ready' }),
    runBrowserToolProbe: async () => {
      state.runBrowserToolProbeCalls += 1
      return { ok: true, detail: 'probe ok' }
    },
    tryReleaseBrowserRelayPort: async () => {
      state.tryReleaseBrowserRelayPortCalls += 1
      return { released: true, detail: 'port released' }
    },
    hasBrowserRelayPortConflict: (detail) => /eaddrinuse|port conflict/i.test(detail),
    hasNoAttachedBrowserTab: (detail) => /no tab is connected|attach it/i.test(detail),
    redactSensitiveText: (value) => value.replace(/secret-[a-z0-9-]+/gi, '[redacted]'),
    delayMs: async () => undefined,
    now: () => {
      currentTime += 2
      return currentTime
    },
    gatewayRecoveryWaitMs: 1,
    gatewayRecoveryPollMs: 0,
    ...overrides,
  })

  return { service, state }
}

test('browser preflight reports disabled browser plugin without starting gateway work', async () => {
  const { service, state } = createHarness({
    getOpenClawPluginEnabled: async () => ({ enabled: false, detail: 'disabled by secret-token' }),
  })

  const result = await service.checkBrowserPreflight()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'browser_plugin_disabled')
  assert.match(result.message, /browser plugin is disabled/i)
  assert.equal(result.detail, 'disabled by [redacted]')
  assert.equal(state.gatewayHealthyChecks(), 0)
})

test('browser preflight reports offline gateway with redacted recovery detail', async () => {
  const { service } = createHarness({
    isGatewayHealthy: async () => false,
    tryRestartGatewayService: async () => ({ restarted: false, detail: 'restart failed with secret-gateway-token' }),
  })

  const result = await service.checkBrowserPreflight()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'gateway_unhealthy')
  assert.match(result.message, /gateway is not healthy/i)
  assert.match(result.detail || '', /gateway \/health did not respond/)
  assert.match(result.detail || '', /restart failed with \[redacted\]/)
  assert.doesNotMatch(result.detail || '', /secret-gateway-token/)
})

test('browser preflight reports missing relay attachment without leaking raw relay errors', async () => {
  const { service } = createHarness({
    tryStartBrowserRelayWithRepair: async () => ({
      started: false,
      detail: 'no tab is connected; attach it with secret-relay-token',
    }),
  })

  const result = await service.checkBrowserPreflight()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'relay_unreachable')
  assert.match(result.detail || '', /no tab is attached/i)
  assert.match(result.detail || '', /\[redacted\]/)
  assert.doesNotMatch(result.detail || '', /secret-relay-token/)
})

test('browser preflight treats an invalid relay payload as unreachable', async () => {
  const { service } = createHarness({
    tryStartBrowserRelayWithRepair: async () => 'not-json' as never,
  })

  const result = await service.checkBrowserPreflight()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'relay_unreachable')
  assert.match(result.detail || '', /invalid preflight payload/i)
})

test('browser preflight redacts probe warnings while allowing execution to continue', async () => {
  const { service, state } = createHarness({
    runBrowserToolProbe: async () => {
      state.runBrowserToolProbeCalls += 1
      return { ok: false, detail: 'browser tool unavailable: secret-probe-token' }
    },
  })

  const result = await service.checkBrowserPreflight('Ada')

  assert.equal(result.ok, true)
  assert.equal(result.reason, 'ready')
  assert.match(result.message, /probe warning/i)
  assert.match(result.detail || '', /\[redacted\]/)
  assert.doesNotMatch(result.detail || '', /secret-probe-token/)
  assert.equal(state.runBrowserToolProbeCalls, 1)
})

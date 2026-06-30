import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeRecoveryService,
  type RuntimeRecoveryServiceOptions,
} from '../server/services/runtime/runtimeRecoveryService'

type SessionLockSweepOptions = Parameters<RuntimeRecoveryServiceOptions['sweepOpenClawSessionLocks']>[1]

function createHarness(overrides: Partial<{
  now: Date
  sweepRejects: boolean
  gatewayStopRejects: boolean
  persistWait: Promise<void>
  onPersist: (reason: string) => void
}> = {}) {
  const state = {
    now: overrides.now || new Date('2026-06-30T13:00:00.000Z'),
    activeRuns: 2,
    recentRuns: 3,
    runtimeMonitorClearedAtMs: 0,
    invalidatedGatewayLedger: 0,
    invalidatedRuntimeStatus: 0,
    recentRunsCleared: 0,
    shutdownMarked: 0,
    pausedGatewayRestart: 0,
    timersCleared: 0,
    gatewayHealthStops: 0,
    missionCronStops: 0,
    persistedMissionReasons: [] as string[],
    clearedAgentSessions: 0,
    terminatedNowReasons: [] as string[],
    terminatedProcessExitReasons: [] as string[],
    gatewayClientStops: [] as string[],
    pluginTerminalStops: [] as string[],
    oauthShutdownReasons: [] as string[],
    oauthProcessExitReasons: [] as string[],
    gatewayStopReasons: [] as string[],
    gatewayHardStops: 0,
    browserCacheClears: 0,
    ledgerCloses: 0,
    markerDates: [] as Date[],
    sweepRequests: [] as Array<{ reason: string; options: SessionLockSweepOptions }>,
    logs: [] as Array<{ stream: string; message: string; level?: string }>,
  }
  const service = createRuntimeRecoveryService({
    now: () => state.now,
    clearAgentTurnSessions: () => {
      state.clearedAgentSessions += 1
      return { clearedSessions: 4, clearedHistories: 2 }
    },
    clearBrowserProbeCache: () => {
      state.browserCacheClears += 1
    },
    clearGatewayRuntimeMonitorHistory: () => ({ gatewayLogs: 7, channelEvents: 2 }),
    clearRecentOpenClawRuns: () => {
      state.recentRuns = 0
      state.recentRunsCleared += 1
    },
    clearShutdownPinnedTimers: () => {
      state.timersCleared += 1
    },
    closeOAuthCallbackServersForProcessExit: (reason) => {
      state.oauthProcessExitReasons.push(reason)
    },
    closeOAuthCallbackServersForShutdown: async (reason) => {
      state.oauthShutdownReasons.push(reason)
      return { closed: 2, failedPendingSessions: 1 }
    },
    closeRuntimeLedger: () => {
      state.ledgerCloses += 1
    },
    getActiveOpenClawRunCount: () => state.activeRuns,
    getRecentOpenClawRunCount: () => state.recentRuns,
    invalidateGatewayLedgerSnapshotCache: () => {
      state.invalidatedGatewayLedger += 1
    },
    invalidateRuntimeStatusCache: () => {
      state.invalidatedRuntimeStatus += 1
    },
    markShuttingDown: () => {
      state.shutdownMarked += 1
    },
    pauseGatewayAutoRestart: () => {
      state.pausedGatewayRestart += 1
    },
    persistAllMissionRecords: async (reason) => {
      state.persistedMissionReasons.push(reason)
      overrides.onPersist?.(reason)
      if (overrides.persistWait) await overrides.persistWait
    },
    pushGatewayLog: (stream, message, level) => {
      state.logs.push({ stream, message, level })
    },
    setRuntimeMonitorClearedAtMs: (value) => {
      state.runtimeMonitorClearedAtMs = value
    },
    stopAllPluginSetupTerminalSessions: (reason) => {
      state.pluginTerminalStops.push(reason)
      return 3
    },
    stopControlCenterGatewayClient: (reason) => {
      state.gatewayClientStops.push(reason)
    },
    stopGateway: () => {
      state.gatewayHardStops += 1
    },
    stopGatewayHealthMonitor: () => {
      state.gatewayHealthStops += 1
    },
    stopGatewayRuntime: async (reason) => {
      if (reason) state.gatewayStopReasons.push(reason)
      if (overrides.gatewayStopRejects) throw new Error('gateway stop failed with token=secret-123')
      return { stopped: true, detail: 'gateway stopped' }
    },
    stopMissionCronExpirySweep: () => {
      state.missionCronStops += 1
    },
    sweepOpenClawSessionLocks: async (reason, options) => {
      state.sweepRequests.push({ reason, options })
      if (overrides.sweepRejects) throw new Error('lock cleanup failed')
      return { scanned: 5, removed: [{ id: 'lock-1' }, { id: 'lock-2' }], errors: ['lock-3'] }
    },
    terminateAllOpenClawRuns: (reason) => {
      state.terminatedProcessExitReasons.push(reason)
    },
    terminateAllOpenClawRunsNow: async (reason) => {
      state.terminatedNowReasons.push(reason)
      return [{ id: 'run-1', pid: 1234, ok: true, detail: 'terminated' }]
    },
    writeRuntimeMonitorClearMarker: async (clearedAt) => {
      state.markerDates.push(clearedAt)
    },
  })
  return { service, state }
}

test('clearRuntimeMonitor clears monitor evidence and preserves active runtime work', async () => {
  const { service, state } = createHarness()

  const result = await service.clearRuntimeMonitor()

  assert.equal(result.ok, true)
  assert.equal(result.clearedAt, '2026-06-30T13:00:00.000Z')
  assert.deepEqual(result.cleared, { gatewayLogs: 7, channelEvents: 2, recentRuns: 3 })
  assert.equal(result.activeRuns, 2)
  assert.deepEqual(result.sessionLockCleanup, { scanned: 5, removed: 2, errors: 1 })
  assert.equal(state.runtimeMonitorClearedAtMs, Date.parse('2026-06-30T13:00:00.000Z'))
  assert.equal(state.invalidatedGatewayLedger, 1)
  assert.equal(state.invalidatedRuntimeStatus, 1)
  assert.equal(state.recentRunsCleared, 1)
  assert.equal(state.markerDates[0]?.toISOString(), '2026-06-30T13:00:00.000Z')
  assert.deepEqual(state.sweepRequests, [{
    reason: 'monitor clear',
    options: { minIntervalMs: 0, minAgeMs: 0 },
  }])
  assert.deepEqual(state.gatewayStopReasons, [])
  assert.deepEqual(state.terminatedNowReasons, [])
  assert.equal(state.gatewayHardStops, 0)
})

test('shutdownControlCenterRuntime deduplicates cleanup and returns structured evidence', async () => {
  let releasePersist: (() => void) | null = null
  let persistStarted = 0
  const persistWait = new Promise<void>((resolve) => {
    releasePersist = resolve
  })
  const { service, state } = createHarness({
    persistWait,
    onPersist: () => {
      persistStarted += 1
    },
  })

  const first = service.shutdownControlCenterRuntime('desktop quit')
  await Promise.resolve()
  const second = service.shutdownControlCenterRuntime('ignored shutdown')
  await Promise.resolve()
  assert.equal(persistStarted, 1)
  releasePersist?.()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.deepEqual(firstResult, secondResult)
  assert.deepEqual(firstResult.sessionLockCleanup, { scanned: 5, removed: 2, errors: 1 })
  assert.deepEqual(state.persistedMissionReasons, ['desktop quit:snapshot-before-shutdown'])
  assert.equal(state.shutdownMarked, 1)
  assert.equal(state.pausedGatewayRestart, 1)
  assert.equal(state.timersCleared, 1)
  assert.equal(state.gatewayHealthStops, 1)
  assert.equal(state.missionCronStops, 1)
  assert.equal(state.clearedAgentSessions, 1)
  assert.deepEqual(state.terminatedNowReasons, ['desktop quit'])
  assert.deepEqual(state.gatewayClientStops, ['desktop quit'])
  assert.deepEqual(state.pluginTerminalStops, ['desktop quit'])
  assert.deepEqual(state.oauthShutdownReasons, ['desktop quit'])
  assert.deepEqual(state.gatewayStopReasons, ['desktop quit'])
  assert.equal(state.browserCacheClears, 1)
  assert.equal(state.ledgerCloses, 1)
})

test('shutdown warnings are recorded without blocking later cleanup evidence', async () => {
  const { service, state } = createHarness({ gatewayStopRejects: true, sweepRejects: true })

  const result = await service.shutdownControlCenterRuntime('desktop quit')

  assert.equal(result.gateway, null)
  assert.equal(result.sessionLockCleanup, null)
  assert.equal(state.browserCacheClears, 1)
  assert.equal(state.ledgerCloses, 1)
  assert.equal(state.logs.length, 2)
  assert.match(state.logs[0].message, /gateway shutdown warning/)
  assert.match(state.logs[1].message, /session lock cleanup warning/)
})

test('processExitCleanup performs synchronous best-effort runtime cleanup', () => {
  const { service, state } = createHarness()

  service.processExitCleanup('process exit shutdown')

  assert.equal(state.shutdownMarked, 1)
  assert.equal(state.timersCleared, 1)
  assert.deepEqual(state.oauthProcessExitReasons, ['process exit shutdown'])
  assert.deepEqual(state.terminatedProcessExitReasons, ['process exit shutdown'])
  assert.equal(state.gatewayHardStops, 1)
  assert.equal(state.gatewayHealthStops, 1)
  assert.equal(state.missionCronStops, 1)
  assert.equal(state.ledgerCloses, 1)
})

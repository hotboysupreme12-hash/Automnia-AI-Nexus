import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeActionService,
  type RuntimeActionServiceOptions,
} from '../server/services/runtime/runtimeActionService'

type GatewayLogEntry = Awaited<ReturnType<RuntimeActionServiceOptions['readExternalGatewayLogEntries']>>[number]

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true)
  return value as unknown[]
}

function createActivity(entries: GatewayLogEntry[]) {
  const events = entries.map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    channel: entry.channel || 'gateway',
    direction: entry.direction || 'system',
    message: entry.message,
  }))
  return {
    active: events.length > 0,
    lastEventAt: events[0]?.timestamp || null,
    sourcePath: null,
    inboundCount: events.filter((entry) => entry.direction === 'inbound').length,
    outboundCount: events.filter((entry) => entry.direction === 'outbound').length,
    systemCount: events.filter((entry) => entry.direction === 'system').length,
    events,
  }
}

function createHarness(overrides: Partial<{
  healthy: boolean
  gatewayLogs: GatewayLogEntry[]
  channelLogs: GatewayLogEntry[]
}> = {}) {
  const state = {
    healthy: overrides.healthy ?? true,
    listenerPid: 4321,
    invalidations: 0,
    healthMonitorStarts: 0,
    scheduledSweeps: [] as string[],
    closedInputs: [] as unknown[],
    cleanupRequests: [] as unknown[],
    gatewayAbortInputs: [] as unknown[],
    staleAbortRequests: [] as Array<{ minAgeMs: number; reason: string }>,
    stoppedReasons: [] as string[],
    restartRequests: [] as unknown[],
    clearDates: [] as Date[],
    markerDates: [] as Date[],
    shutdownReasons: [] as string[],
    recoveryClearCalls: 0,
    listenerPortRequests: [] as number[],
    gatewayLogs: overrides.gatewayLogs || [
      {
        id: 1,
        timestamp: '2026-06-30T12:00:00.000Z',
        stream: 'gateway',
        message: 'Gateway online',
        direction: 'system',
      },
    ],
    channelLogs: overrides.channelLogs || [
      {
        id: 2,
        timestamp: '2026-06-30T12:00:01.000Z',
        stream: 'channel',
        message: 'Telegram inbound',
        channel: 'telegram',
        direction: 'inbound',
      },
    ],
  }
  const service = createRuntimeActionService({
    abortGatewayRuntimeSessionsForClose: async (input) => {
      state.gatewayAbortInputs.push(input)
      return [{ ok: true, method: 'sessions.abort', sessionKey: input.sessionKey || 'nova:session-1' }]
    },
    abortStaleGatewayChatWaiters: (minAgeMs, reason) => {
      state.staleAbortRequests.push({ minAgeMs, reason })
      return { aborted: 2, reason }
    },
    cleanupOpenClawSessionLocks: async (options) => {
      state.cleanupRequests.push(options)
      return { scanned: 3, removed: [{ id: 'lock-1' }], errors: ['lock-2'] }
    },
    closeRuntimeSessions: (input) => {
      state.closedInputs.push(input)
      return { closedSessions: 1, terminatedRuns: [{ id: 'run-1' }] }
    },
    ensureGatewayRunning: async () => {
      state.healthy = true
    },
    gatewayHttpPort: 17655,
    gatewayListenerPidForPort: async (port) => {
      state.listenerPortRequests.push(port)
      return state.listenerPid
    },
    gatewayStatusSnapshot: (healthy, listenerPid = null) => ({
      healthy,
      processRunning: healthy || Boolean(listenerPid),
      listenerPid,
    }),
    invalidateRuntimeStatusCache: () => {
      state.invalidations += 1
    },
    isGatewayHealthy: async () => state.healthy,
    openAgentSessionSnapshots: async (activity) => [{ id: 'session-1', activity }],
    readExternalChannelActivityEntries: async () => state.channelLogs,
    readExternalGatewayLogEntries: async () => state.gatewayLogs,
    runtimeRecovery: {
      clearRuntimeMonitor: async () => {
        state.recoveryClearCalls += 1
        return {
          ok: true,
          clearedAt: '2026-06-30T12:34:56.000Z',
          cleared: { gatewayLogs: 4, recentRuns: 2 },
          activeRuns: 1,
          sessionLockCleanup: { scanned: 4, removed: 2, errors: 0 },
        }
      },
      shutdownRuntime: async (reason = 'desktop quit') => {
        state.shutdownReasons.push(reason)
        return { ok: true, shutdown: { stopped: true } }
      },
    },
    scheduleOpenClawSessionLockSweep: (reason) => {
      state.scheduledSweeps.push(reason)
    },
    startGatewayHealthMonitor: () => {
      state.healthMonitorStarts += 1
    },
    stopGatewayRuntime: async (reason) => {
      if (reason) state.stoppedReasons.push(reason)
      state.healthy = false
      return { stopped: true }
    },
    summarizeGatewayActivity: createActivity,
    tryRestartGatewayService: async (options) => {
      state.restartRequests.push(options)
      state.healthy = true
      return { restarted: true, detail: 'gateway restarted' }
    },
  })
  return { service, state }
}

test('closeRuntimeSession coordinates local sessions, Gateway aborts, lock cleanup, and activity snapshots', async () => {
  const { service, state } = createHarness()

  const result = await service.closeRuntimeSession({ agentId: 'nova', sessionId: 'session-1' })
  const cleanup = record(result.sessionLockCleanup)
  const sessions = array(result.sessions)
  const session = record(sessions[0])
  const activity = record(session.activity)

  assert.equal(result.ok, true)
  assert.equal(result.closedSessions, 1)
  assert.equal(array(result.gatewayAborts).length, 1)
  assert.deepEqual(cleanup, { scanned: 3, removed: 1, errors: 1 })
  assert.equal(activity.inboundCount, 1)
  assert.equal(activity.systemCount, 1)
  assert.deepEqual(state.scheduledSweeps, ['runtime session close follow-up'])
  assert.deepEqual(state.closedInputs, [{ agentId: 'nova', sessionId: 'session-1' }])
  assert.deepEqual(state.gatewayAbortInputs, [{ agentId: 'nova', sessionId: 'session-1' }])
})

test('abortStaleGatewayChat records recovery intent and invalidates cached runtime status', () => {
  const { service, state } = createHarness()

  const result = service.abortStaleGatewayChat(300_000)

  assert.equal(result.ok, true)
  assert.equal(result.aborted, 2)
  assert.equal(state.invalidations, 1)
  assert.deepEqual(state.staleAbortRequests, [
    { minAgeMs: 300_000, reason: 'operator stale-turn recovery' },
  ])
})

test('clearRuntimeMonitor delegates clean-slate recovery and preserves result shape', async () => {
  const { service, state } = createHarness()

  const result = await service.clearRuntimeMonitor()
  const cleanup = record(result.sessionLockCleanup)

  assert.equal(result.ok, true)
  assert.equal(result.clearedAt, '2026-06-30T12:34:56.000Z')
  assert.deepEqual(cleanup, { scanned: 4, removed: 2, errors: 0 })
  assert.equal(state.recoveryClearCalls, 1)
})

test('Gateway actions preserve manual stop, start, and restart snapshots', async () => {
  const { service, state } = createHarness()

  const stop = await service.stopGateway()
  assert.equal(record(stop.gateway).healthy, false)
  assert.deepEqual(state.stoppedReasons, ['manual gateway stop requested'])
  assert.deepEqual(state.listenerPortRequests, [])

  const start = await service.startGateway()
  assert.equal(record(start.gateway).healthy, true)
  assert.equal(record(start.start).detail, 'gateway healthy')
  assert.equal(state.healthMonitorStarts, 1)
  assert.deepEqual(state.listenerPortRequests, [17655])

  const restart = await service.restartGateway()
  assert.equal(record(restart.gateway).healthy, true)
  assert.deepEqual(state.restartRequests, [{
    force: true,
    allowExternalTakeover: true,
    reason: 'manual gateway restart requested',
  }])
  assert.equal(state.invalidations, 3)
})

test('shutdownRuntime delegates the desktop shutdown reason', async () => {
  const { service, state } = createHarness()

  const result = await service.shutdownRuntime()

  assert.equal(result.ok, true)
  assert.deepEqual(result.shutdown, { stopped: true })
  assert.deepEqual(state.shutdownReasons, ['desktop quit'])
})

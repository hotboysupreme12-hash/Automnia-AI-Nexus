import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeStatusService,
  type RuntimeStatusServiceOptions,
} from '../server/services/runtime/runtimeStatusService'

type MutableRuntimeStatusState = {
  now: number
  healthy: boolean
  hangStatus: boolean
  sessions: unknown[]
  missions: Array<{ id: string; status: string }>
  missionViewCalls: number
  gatewayLedgerEntries: RuntimeStatusServiceOptions['readRuntimeGatewayLedgerSnapshot'] extends (limit?: number) => Promise<infer Snapshot>
    ? Snapshot['entries']
    : never
  gatewayRestart: RuntimeStatusServiceOptions['readRuntimeGatewayLedgerSnapshot'] extends (limit?: number) => Promise<infer Snapshot>
    ? Snapshot['restart']
    : never
  externalGatewayLogs: RuntimeStatusServiceOptions['readExternalGatewayLogEntries'] extends (limit?: number) => Promise<infer Logs>
    ? Logs
    : never
  externalGatewayReads: number
  externalChannelLogs: RuntimeStatusServiceOptions['readExternalChannelActivityEntries'] extends (limit?: number) => Promise<infer Logs>
    ? Logs
    : never
}

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

function createActivity(entries: MutableRuntimeStatusState['externalGatewayLogs']) {
  const events = entries.map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    channel: entry.channel || 'gateway',
    direction: entry.direction || 'system',
    message: entry.message,
    level: entry.level,
    source: entry.source,
    agentId: 'nova',
  }))
  return {
    active: events.length > 0,
    lastEventAt: events[0]?.timestamp || null,
    sourcePath: events[0]?.source || null,
    inboundCount: events.filter((entry) => entry.direction === 'inbound').length,
    outboundCount: events.filter((entry) => entry.direction === 'outbound').length,
    systemCount: events.filter((entry) => entry.direction === 'system').length,
    events,
  }
}

function createService(overrides: Partial<MutableRuntimeStatusState> = {}) {
  const state: MutableRuntimeStatusState = {
    now: Date.parse('2026-06-30T12:00:00.000Z'),
    healthy: true,
    hangStatus: false,
    sessions: [],
    missions: [{ id: 'mission-1', status: 'active' }],
    missionViewCalls: 0,
    gatewayLedgerEntries: [
      {
        id: 1,
        timestamp: '2026-06-30T11:59:58.000Z',
        stream: 'lifecycle',
        message: 'Gateway restart succeeded',
        level: 'info',
        source: 'control-center',
        direction: 'system',
      },
    ],
    gatewayRestart: {
      at: '2026-06-30T11:59:50.000Z',
      reason: 'health monitor recovery',
      outcome: 'succeeded',
      eventAt: '2026-06-30T11:59:58.000Z',
    },
    externalGatewayLogs: [],
    externalGatewayReads: 0,
    externalChannelLogs: [],
    ...overrides,
  }
  const requestedLedgerLimits: number[] = []
  const service = createRuntimeStatusService({
    openClawConfigPath: 'C:/state/openclaw.json',
    statusCacheMs: 100,
    summaryCacheMs: 100,
    statusResponseTimeoutMs: 10,
    summaryResponseTimeoutMs: 10,
    now: () => state.now,
    fetchGatewayHealthPayload: async () => ({
      healthy: state.healthy,
      payload: state.healthy ? { ok: true, plugins: { loaded: ['clawtalk'] } } : null,
    }),
    fetchGatewayReadinessPayload: async () => ({
      reachable: state.healthy,
      ready: state.healthy,
      degraded: false,
      checkedAt: state.healthy ? new Date(state.now).toISOString() : null,
      failing: [],
      uptimeMs: state.healthy ? 1200 : null,
      eventLoop: null,
      ...(state.healthy ? {} : { error: 'gateway unavailable' }),
    }),
    readRuntimeGatewayLedgerSnapshot: async (limit = 120) => {
      requestedLedgerLimits.push(limit)
      if (state.hangStatus) await new Promise(() => undefined)
      return {
        entries: state.gatewayLedgerEntries.slice(0, limit),
        restart: state.gatewayRestart,
        recentRestarts: state.gatewayRestart ? [state.gatewayRestart] : [],
      }
    },
    readExternalGatewayLogEntries: async (limit = 80) => {
      state.externalGatewayReads += 1
      return state.externalGatewayLogs.slice(0, limit)
    },
    readExternalChannelActivityEntries: async (limit = 80) => state.externalChannelLogs.slice(0, limit),
    listPluginControls: async () => ({
      plugins: [
        {
          id: 'clawtalk',
          name: 'ClawTalk',
          description: 'Communication bridge',
          origin: 'bundled',
          status: 'installed',
          enabled: false,
          configuredEnabled: true,
          runtimeLoaded: false,
          managed: true,
          category: 'communications',
          commands: ['send'],
          providers: [],
          channels: ['telegram'],
          missingDependencies: [],
          restartRequired: false,
        },
      ],
      cache: { source: 'test-cache', refreshedAt: state.now, refreshing: false },
    }),
    readOpenclawConfig: async () => ({ session: { dmScope: 'peer' } }),
    createInitialOpenclawConfig: () => ({ session: { dmScope: 'main' } }),
    openClawOptimizationStatus: (config) => ({ config }),
    readGatewayStabilitySnapshot: async () => ({
      available: state.healthy,
      source: state.healthy ? 'diagnostics.stability' : 'gateway-client-not-ready',
      generatedAt: state.healthy ? new Date(state.now).toISOString() : null,
      count: 0,
      dropped: 0,
      lastSeq: null,
      summary: {
        byType: {},
        active: 0,
        waiting: 0,
        queued: 0,
        maxQueueDepth: 0,
        warningCount: 0,
        latestEventType: null,
        latestEventAt: null,
        recentWarnings: [],
      },
      events: [],
    }),
    readDoctorDiagnosticsSummary: async () => ({
      lastRun: null,
      recent: [{ id: 'doctor-1' }],
      warningCount: 0,
      errorCount: 0,
      lastRunAt: null,
      cache: { source: 'jsonl-ledger', refreshedAt: state.now, refreshing: false },
    }),
    gatewayStatusSnapshot: (healthy, _listenerPid, restartSnapshot, recentRestarts) => ({
      healthy,
      processRunning: healthy,
      logs: [],
      lastRestartReason: restartSnapshot?.reason || null,
      recentRestarts,
    }),
    gatewayLogEntriesSinceCurrentStart: (entries) => entries,
    dedupeGatewayLogEntries: (entries, limit = 80) => entries.slice(0, limit),
    runtimeLoadedPluginIdsFromGatewayLogs: () => new Set<string>(),
    summarizeGatewayActivity: createActivity,
    openAgentSessionSnapshots: async () => state.sessions,
    listMissions: () => state.missions,
    missionView: (mission) => {
      state.missionViewCalls += 1
      return { id: mission.id, status: mission.status }
    },
    listActiveCronJobViews: () => ({ active: [{ id: 'shift-1' }] }),
    activeRunSnapshots: () => [{ id: 'run-active', status: 'running' }],
    recentRunSnapshots: (limit) => [{ id: 'run-recent', status: 'completed' }].slice(0, limit),
    runtimeVersionCheckPayload: () => ({ ok: true, current: '2026.6.11' }),
    runtimeLedgerStatus: () => ({ ok: true, source: 'jsonl-ledger' }),
    gatewayChatRuntimeSnapshot: () => ({ enabled: true, ready: state.healthy }),
    gatewayReadinessUnavailable: (error) => ({
      reachable: false,
      ready: false,
      degraded: false,
      checkedAt: null,
      failing: [],
      uptimeMs: null,
      eventLoop: null,
      ...(error ? { error } : {}),
    }),
    gatewayStabilityUnavailable: (source, error) => ({
      available: false,
      source,
      generatedAt: null,
      count: 0,
      dropped: 0,
      lastSeq: null,
      summary: {
        byType: {},
        active: null,
        waiting: null,
        queued: null,
        maxQueueDepth: null,
        warningCount: 0,
        latestEventType: null,
        latestEventAt: null,
        recentWarnings: [],
      },
      events: [],
      ...(error ? { error } : {}),
    }),
    cachedDoctorDiagnosticsSummary: () => ({
      lastRun: null,
      recent: [],
      warningCount: 0,
      errorCount: 0,
      lastRunAt: null,
      cache: { source: 'cache', refreshedAt: state.now, refreshing: false },
    }),
    sweepOpenClawSessionLocks: async () => ({ scanned: 0 }),
    sweepExpiredMissionCronJobs: async () => ({ scanned: 0 }),
    redactSensitiveText: (value) => value.replace(/secret-[a-z0-9-]+/giu, '[redacted]'),
  })
  return { service, state, requestedLedgerLimits }
}

test('runtime summary projects a healthy Gateway without changing API shape', async () => {
  const { service, state, requestedLedgerLimits } = createService({
    externalChannelLogs: [
      {
        id: 2,
        timestamp: '2026-06-30T11:59:59.000Z',
        stream: 'channel',
        message: 'message processed',
        channel: 'telegram',
        direction: 'inbound',
      },
    ],
  })

  const summary = await service.getRuntimeSummaryPayload(false)
  const monitor = record(summary.monitor)
  const gateway = record(summary.gateway)
  const activity = record(gateway.activity)
  const plugins = record(summary.plugins)
  const diagnostics = record(summary.diagnostics)
  const doctor = record(diagnostics.doctor)
  const sources = record(monitor.sources)

  assert.equal(summary.ok, true)
  assert.equal(monitor.summary, true)
  assert.equal(monitor.cached, false)
  assert.equal(gateway.healthy, true)
  assert.equal(gateway.lastRestartReason, 'health monitor recovery')
  assert.equal(array(activity.events).length, 2)
  assert.equal(activity.inboundCount, 1)
  assert.equal(plugins.enabledCount, 0)
  assert.equal(array(doctor.recent).length, 1)
  assert.equal(state.externalGatewayReads, 0)
  assert.equal(sources.gatewayExternalLogSource, 'skipped-ledger-hot-path')
  assert.deepEqual(requestedLedgerLimits, [48])
})

test('runtime summary falls back to external Gateway logs when the ledger is empty', async () => {
  const { service, state } = createService({
    gatewayLedgerEntries: [],
    gatewayRestart: null,
    externalGatewayLogs: [
      {
        id: 7,
        timestamp: '2026-06-30T11:59:57.000Z',
        stream: 'gateway',
        message: 'message processed: channel=telegram outcome=ok',
        channel: 'telegram',
        direction: 'outbound',
      },
    ],
  })

  const summary = await service.getRuntimeSummaryPayload(false)
  const monitor = record(summary.monitor)
  const sources = record(monitor.sources)
  const gateway = record(summary.gateway)
  const activity = record(gateway.activity)

  assert.equal(state.externalGatewayReads, 1)
  assert.equal(sources.gatewayExternalLogSource, 'fallback-log-tail')
  assert.equal(sources.gatewayExternalLogs, 1)
  assert.equal(array(activity.events).length, 1)
  assert.equal(activity.outboundCount, 1)
})

test('runtime summary uses Gateway ledger evidence when Gateway is missing', async () => {
  const { service } = createService({
    healthy: false,
    gatewayLedgerEntries: [
      {
        id: 5,
        timestamp: '2026-06-30T11:58:00.000Z',
        stream: 'lifecycle',
        message: 'Gateway restart failed after crash',
        level: 'warning',
      },
    ],
    gatewayRestart: {
      at: '2026-06-30T11:57:59.000Z',
      reason: 'process exited',
      outcome: 'failed',
    },
  })

  const summary = await service.getRuntimeSummaryPayload(false)
  const gateway = record(summary.gateway)
  const readiness = record(gateway.readiness)
  const monitor = record(summary.monitor)
  const sources = record(monitor.sources)

  assert.equal(gateway.healthy, false)
  assert.equal(gateway.processRunning, false)
  assert.equal(gateway.lastRestartReason, 'process exited')
  assert.equal(array(gateway.logs).length, 1)
  assert.equal(readiness.reachable, false)
  assert.equal(sources.gatewayLedgerLogs, 1)
})

test('runtime status preserves stale session evidence from the session snapshot dependency', async () => {
  const { service } = createService({
    sessions: [
      {
        agentId: 'nova',
        sessionId: 'session-1',
        active: false,
        sessionLock: {
          status: 'stale',
          ageMs: 900000,
          reason: 'lock older than active runtime window',
        },
      },
    ],
  })

  const status = await service.getRuntimeStatusPayload(false)
  const sessions = array(status.sessions)
  const stale = record(sessions[0])
  const sessionLock = record(stale.sessionLock)

  assert.equal(sessions.length, 1)
  assert.equal(stale.active, false)
  assert.equal(sessionLock.status, 'stale')
  assert.equal(record(status.monitor).forceRefresh, false)
})

test('forced runtime status refresh updates the summary cache without keeping the force flag', async () => {
  const { service, state } = createService()
  const status = await service.getRuntimeStatusPayload(true)
  const statusMonitor = record(status.monitor)
  assert.equal(statusMonitor.forceRefresh, true)

  state.now += 1
  const summary = await service.getRuntimeSummaryPayload(false)
  const monitor = record(summary.monitor)
  const plugins = record(summary.plugins)

  assert.equal(monitor.summary, true)
  assert.equal(monitor.cached, true)
  assert.equal(monitor.forceRefresh, false)
  assert.equal(plugins.enabledCount, 1)
  assert.equal(plugins.totalCount, 1)
})

test('forced runtime summary refresh updates the normalized summary cache', async () => {
  const { service, state } = createService()
  const first = await service.getRuntimeSummaryPayload(true)
  assert.equal(record(first.monitor).cached, false)

  state.now += 1
  const cached = await service.getRuntimeSummaryPayload(false)
  const monitor = record(cached.monitor)

  assert.equal(monitor.summary, true)
  assert.equal(monitor.cached, true)
  assert.equal(monitor.forceRefresh, false)
})

test('runtime payloads project only visible mission rows before shaping', async () => {
  const missions = Array.from({ length: 20 }, (_, index) => ({
    id: `mission-${index + 1}`,
    status: 'active',
  }))
  const { service, state } = createService({ missions })

  const summary = await service.getRuntimeSummaryPayload(false)
  assert.equal(array(record(summary.missions).active).length, 4)
  assert.equal(state.missionViewCalls, 4)

  state.now += 200
  state.missionViewCalls = 0
  const status = await service.getRuntimeStatusPayload(true)
  assert.equal(array(record(status.missions).active).length, 12)
  assert.equal(state.missionViewCalls, 12)
})

test('runtime status timeout falls back to the cached payload with redacted evidence', async () => {
  const { service, state } = createService()
  const first = await service.getRuntimeStatusPayload(false)
  assert.equal(record(first.monitor).cached, false)

  state.now += 1000
  state.hangStatus = true
  const fallback = await service.getRuntimeStatusPayload(false)
  const monitor = record(fallback.monitor)

  assert.equal(monitor.cached, true)
  assert.equal(monitor.fallback, true)
  assert.equal(monitor.degraded, true)
  assert.match(String(monitor.fallbackReason), /TimeoutError: runtime status refresh timed out/)
  assert.equal(record(fallback.gateway).healthy, true)
})

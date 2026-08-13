import type { GatewayHealthPayload, GatewayReadinessSummary, GatewayStabilityStatus } from '../gateway/gatewayDiagnosticsService'
import type { GatewayActivitySummary, GatewayLogEntry } from '../gateway/gatewayLogService'
import type { GatewayRestartLifecycleSnapshot } from '../gateway/gatewayLifecycleService'

type RuntimeStatusGatewaySnapshot = Record<string, unknown> & {
  logs?: GatewayLogEntry[]
}

type RuntimeStatusGatewayLedgerSnapshot = {
  entries: GatewayLogEntry[]
  restart: GatewayRestartLifecycleSnapshot | null
  recentRestarts: GatewayRestartLifecycleSnapshot[]
}

type RuntimeStatusGatewayHealth = {
  healthy: boolean
  payload: GatewayHealthPayload | null
}

type RuntimeStatusPluginControlEntry = {
  id: string
  name: string
  description: string
  icon?: string
  systemImage?: string
  packageName?: string
  installSpec?: string
  origin: string
  status: string
  enabled: boolean
  configuredEnabled: boolean | null
  runtimeLoaded?: boolean
  managed?: boolean
  category: string
  commands: string[]
  providers: string[]
  channels: string[]
  missingDependencies: string[]
  restartRequired: boolean
}

type RuntimeStatusPluginControls = {
  plugins: RuntimeStatusPluginControlEntry[]
  configPath?: string
  cache?: Record<string, unknown> & { source?: string }
  cliError?: string
}

type RuntimeStatusCronJobs = {
  active: unknown[]
  error?: unknown
}

type RuntimeStatusMission = {
  status?: string
  [key: string]: unknown
}

type RuntimeStatusDoctorDiagnostics = Record<string, unknown> & {
  recent: unknown[]
}

export type RuntimeStatusServiceOptions = {
  openClawConfigPath: string
  statusCacheMs: number
  summaryCacheMs: number
  statusResponseTimeoutMs: number
  summaryResponseTimeoutMs: number
  fetchGatewayHealthPayload: () => Promise<RuntimeStatusGatewayHealth>
  fetchGatewayReadinessPayload: () => Promise<GatewayReadinessSummary>
  readRuntimeGatewayLedgerSnapshot: (limit?: number) => Promise<RuntimeStatusGatewayLedgerSnapshot>
  readExternalGatewayLogEntries: (limit?: number) => Promise<GatewayLogEntry[]>
  readExternalChannelActivityEntries: (limit?: number) => Promise<GatewayLogEntry[]>
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<RuntimeStatusPluginControls>
  readOpenclawConfig: () => Promise<unknown>
  createInitialOpenclawConfig: () => unknown
  openClawOptimizationStatus: (config: unknown) => unknown
  readGatewayStabilitySnapshot: (limit?: number) => Promise<GatewayStabilityStatus>
  readDoctorDiagnosticsSummary: (forceRefresh?: boolean, options?: { sqlite?: boolean }) => Promise<RuntimeStatusDoctorDiagnostics>
  gatewayStatusSnapshot: (
    healthy: boolean,
    listenerPid?: number | null,
    restartSnapshot?: GatewayRestartLifecycleSnapshot | null,
    restartTimeline?: GatewayRestartLifecycleSnapshot[],
    stability?: GatewayStabilityStatus,
  ) => RuntimeStatusGatewaySnapshot
  gatewayLogEntriesSinceCurrentStart: (entries: GatewayLogEntry[]) => GatewayLogEntry[]
  dedupeGatewayLogEntries: (entries: GatewayLogEntry[], limit?: number) => GatewayLogEntry[]
  runtimeLoadedPluginIdsFromGatewayLogs: (entries: GatewayLogEntry[]) => Set<string>
  summarizeGatewayActivity: (entries: GatewayLogEntry[]) => GatewayActivitySummary
  openAgentSessionSnapshots: (gatewayActivity?: GatewayActivitySummary) => Promise<unknown[]>
  listMissions: () => RuntimeStatusMission[]
  missionView: (mission: RuntimeStatusMission) => unknown
  listActiveCronJobViews: (options?: { sqlite?: boolean }) => RuntimeStatusCronJobs
  activeRunSnapshots: () => unknown[]
  recentRunSnapshots: (limit: number) => unknown[]
  runtimeVersionCheckPayload: () => unknown
  runtimeLedgerStatus: (options?: { sqlite?: boolean }) => unknown
  gatewayChatRuntimeSnapshot: () => unknown
  gatewayReadinessUnavailable: (error?: string) => GatewayReadinessSummary
  gatewayStabilityUnavailable: (source: GatewayStabilityStatus['source'], error?: string) => GatewayStabilityStatus
  cachedDoctorDiagnosticsSummary: () => RuntimeStatusDoctorDiagnostics
  sweepOpenClawSessionLocks: (reason: string, options: { quiet?: boolean }) => Promise<unknown>
  sweepExpiredMissionCronJobs: (reason: string) => Promise<unknown>
  redactSensitiveText: (value: string) => string
  now?: () => number
}

export type RuntimeStatusService = ReturnType<typeof createRuntimeStatusService>

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function timeoutError(label: string, timeoutMs: number) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

function withResponseDeadline<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs)
    timeout.unref?.()
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function isRuntimeResponseTimeout(error: unknown) {
  return error instanceof Error && error.name === 'TimeoutError'
}

function gatewayLogs(gateway: RuntimeStatusGatewaySnapshot): GatewayLogEntry[] {
  return Array.isArray(gateway.logs) ? gateway.logs : []
}

function loadedPluginIdsFromGatewayHealth(payload: GatewayHealthPayload | null) {
  const loaded = Array.isArray(payload?.plugins?.loaded) ? payload.plugins.loaded : []
  return loaded
}

function pluginSummary(plugin: RuntimeStatusPluginControlEntry, runtimeLoaded: boolean) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    icon: plugin.icon,
    systemImage: plugin.systemImage,
    packageName: plugin.packageName,
    installSpec: plugin.installSpec,
    origin: plugin.origin,
    category: plugin.category,
    status: plugin.status,
    enabled: plugin.enabled || runtimeLoaded,
    configuredEnabled: plugin.configuredEnabled,
    runtimeLoaded,
    managed: plugin.managed,
    channels: plugin.channels,
    providers: plugin.providers,
    commands: plugin.commands,
    missingDependencies: plugin.missingDependencies,
    restartRequired: plugin.restartRequired,
  }
}

export function createRuntimeStatusService(options: RuntimeStatusServiceOptions) {
  const nowMs = options.now ?? (() => Date.now())
  let runtimeStatusPayloadCache: { builtAt: number; payload: Record<string, unknown> } | null = null
  let runtimeStatusPayloadInFlight: Promise<Record<string, unknown>> | null = null
  let runtimeSummaryPayloadCache: { builtAt: number; payload: Record<string, unknown> } | null = null
  let runtimeSummaryPayloadInFlight: Promise<Record<string, unknown>> | null = null

  function invalidateCache() {
    runtimeStatusPayloadCache = null
    runtimeSummaryPayloadCache = null
  }

  function runtimeStatusFromCache(payload: Record<string, unknown>, builtAt: number): Record<string, unknown> {
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    return {
      ...payload,
      monitor: {
        ...monitor,
        cached: true,
        cacheAgeMs: Math.max(0, nowMs() - builtAt),
        cacheTtlMs: options.statusCacheMs,
      },
    }
  }

  function runtimeSummaryFromCache(payload: Record<string, unknown>, builtAt: number): Record<string, unknown> {
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    return {
      ...payload,
      monitor: {
        ...monitor,
        cached: true,
        cacheAgeMs: Math.max(0, nowMs() - builtAt),
        cacheTtlMs: options.summaryCacheMs,
      },
    }
  }

  function cacheRuntimeStatusPayload(payload: Record<string, unknown>) {
    const builtAt = nowMs()
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    const cachedPayload = {
      ...payload,
      monitor: {
        ...monitor,
        cached: false,
        cacheAgeMs: 0,
        cacheTtlMs: options.statusCacheMs,
        forceRefresh: false,
      },
    }
    runtimeStatusPayloadCache = { builtAt, payload: cachedPayload }
    runtimeSummaryPayloadCache = {
      builtAt,
      payload: runtimeSummaryPayloadFromStatusPayload(cachedPayload, builtAt, { cached: false }),
    }
  }

  function cacheRuntimeSummaryPayload(payload: Record<string, unknown>, builtAt = nowMs()) {
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    runtimeSummaryPayloadCache = {
      builtAt,
      payload: {
        ...payload,
        monitor: {
          ...monitor,
          cached: false,
          summary: true,
          cacheAgeMs: 0,
          cacheTtlMs: options.summaryCacheMs,
          forceRefresh: false,
        },
      },
    }
  }

  function runtimeSummaryPayloadFromStatusPayload(
    payload: Record<string, unknown>,
    builtAt: number,
    summaryOptions: { cached: boolean } = { cached: false },
  ): Record<string, unknown> {
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    const gateway = isLooseRecord(payload.gateway) ? payload.gateway : {}
    const activity = isLooseRecord(gateway.activity) ? gateway.activity : {}
    const plugins = isLooseRecord(payload.plugins) ? payload.plugins : {}
    const shifts = isLooseRecord(payload.shifts) ? payload.shifts : {}
    const missions = isLooseRecord(payload.missions) ? payload.missions : {}
    const diagnostics = isLooseRecord(payload.diagnostics) ? payload.diagnostics : {}
    const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date(nowMs()).toISOString()
    const communicationPlugins = Array.isArray(plugins.communication) ? plugins.communication.slice(0, 4) : []
    const activeShifts = Array.isArray(shifts.active) ? shifts.active.slice(0, 4) : []
    const activeMissions = Array.isArray(missions.active) ? missions.active.slice(0, 4) : []

    return {
      ok: true,
      generatedAt,
      monitor: {
        ...monitor,
        cached: summaryOptions.cached,
        summary: true,
        cacheAgeMs: summaryOptions.cached ? Math.max(0, nowMs() - builtAt) : 0,
        cacheTtlMs: options.summaryCacheMs,
        derivedFrom: 'runtime-status',
      },
      gateway: {
        ...gateway,
        logs: Array.isArray(gateway.logs) ? gateway.logs.slice(0, 12) : [],
        activity: {
          ...activity,
          events: Array.isArray(activity.events) ? activity.events.slice(0, 8) : [],
        },
      },
      sessions: [],
      activeRuns: Array.isArray(payload.activeRuns) ? payload.activeRuns : [],
      recentRuns: [],
      plugins: {
        enabledCount: typeof plugins.enabledCount === 'number' ? plugins.enabledCount : 0,
        totalCount: typeof plugins.totalCount === 'number' ? plugins.totalCount : 0,
        enabled: [],
        communication: communicationPlugins,
        ...(plugins.cache ? { cache: plugins.cache } : {}),
        ...(plugins.cliError ? { cliError: plugins.cliError } : {}),
      },
      shifts: {
        activeCount: typeof shifts.activeCount === 'number' ? shifts.activeCount : activeShifts.length,
        active: activeShifts,
        ...(shifts.error ? { error: shifts.error } : {}),
      },
      missions: {
        activeCount: typeof missions.activeCount === 'number' ? missions.activeCount : activeMissions.length,
        active: activeMissions,
      },
      diagnostics,
    }
  }

  function runtimeFallbackReason(error: unknown) {
    const message = error instanceof Error && error.message ? `${error.name}: ${error.message}` : String(error)
    return options.redactSensitiveText(message)
  }

  function withRuntimeFallbackMonitor(
    payload: Record<string, unknown>,
    reason: string,
    responseTimeoutMs: number,
    fallbackOptions: { builtAt?: number; summary?: boolean } = {},
  ): Record<string, unknown> {
    const monitor = isLooseRecord(payload.monitor) ? payload.monitor : {}
    const builtAt = fallbackOptions.builtAt
    return {
      ...payload,
      monitor: {
        ...monitor,
        ...(fallbackOptions.summary ? { summary: true } : {}),
        cached: builtAt ? true : monitor.cached === true,
        cacheAgeMs: builtAt
          ? Math.max(0, nowMs() - builtAt)
          : typeof monitor.cacheAgeMs === 'number'
            ? monitor.cacheAgeMs
            : 0,
        degraded: true,
        fallback: true,
        fallbackReason: reason,
        responseTimeoutMs,
      },
    }
  }

  function minimalRuntimeStatusPayload(reason: string, responseTimeoutMs: number): Record<string, unknown> {
    const gateway = options.gatewayStatusSnapshot(false)
    const activeMissions = options.listMissions().filter((mission) => mission.status === 'active')
    // Cron state is owned by OpenClaw's durable scheduler database. Keep the
    // fallback payload truthful for jobs created outside the Control Center;
    // the list helper still falls back to in-memory shifts if SQLite is not
    // available.
    const cronJobs = options.listActiveCronJobViews()
    return {
      ok: true,
      generatedAt: new Date(nowMs()).toISOString(),
      monitor: {
        cached: false,
        cacheAgeMs: 0,
        cacheTtlMs: options.statusCacheMs,
        degraded: true,
        fallback: true,
        fallbackReason: reason,
        responseTimeoutMs,
        forceRefresh: false,
      },
      runtime: options.runtimeVersionCheckPayload(),
      persistence: options.runtimeLedgerStatus({ sqlite: false }),
      optimization: options.openClawOptimizationStatus(options.createInitialOpenclawConfig()),
      gateway: {
        ...gateway,
        readiness: options.gatewayReadinessUnavailable('skipped during runtime status fallback'),
        chat: options.gatewayChatRuntimeSnapshot(),
        activity: options.summarizeGatewayActivity([]),
        stability: options.gatewayStabilityUnavailable('diagnostics.stability', 'skipped during runtime status fallback'),
      },
      sessions: [],
      activeRuns: options.activeRunSnapshots(),
      recentRuns: options.recentRunSnapshots(8),
      plugins: {
        enabledCount: 0,
        totalCount: 0,
        all: [],
        enabled: [],
        communication: [],
        cache: { source: 'fallback', refreshedAt: nowMs(), refreshing: true },
      },
      shifts: {
        activeCount: cronJobs.active.length,
        active: cronJobs.active.slice(0, 4),
        ...(cronJobs.error ? { error: cronJobs.error } : {}),
      },
      missions: {
        activeCount: activeMissions.length,
        active: activeMissions.slice(0, 4).map((mission) => options.missionView(mission)),
      },
      diagnostics: {
        doctor: options.cachedDoctorDiagnosticsSummary(),
      },
    }
  }

  function fallbackRuntimeStatusPayload(error: unknown, responseTimeoutMs: number): Record<string, unknown> {
    const reason = runtimeFallbackReason(error)
    if (runtimeStatusPayloadCache) {
      return withRuntimeFallbackMonitor(
        runtimeStatusFromCache(runtimeStatusPayloadCache.payload, runtimeStatusPayloadCache.builtAt),
        reason,
        responseTimeoutMs,
        { builtAt: runtimeStatusPayloadCache.builtAt },
      )
    }
    return minimalRuntimeStatusPayload(reason, responseTimeoutMs)
  }

  function fallbackRuntimeSummaryPayload(error: unknown, responseTimeoutMs: number): Record<string, unknown> {
    const reason = runtimeFallbackReason(error)
    if (runtimeSummaryPayloadCache) {
      return withRuntimeFallbackMonitor(
        runtimeSummaryFromCache(runtimeSummaryPayloadCache.payload, runtimeSummaryPayloadCache.builtAt),
        reason,
        responseTimeoutMs,
        { builtAt: runtimeSummaryPayloadCache.builtAt, summary: true },
      )
    }
    if (runtimeStatusPayloadCache) {
      return withRuntimeFallbackMonitor(
        runtimeSummaryPayloadFromStatusPayload(runtimeStatusPayloadCache.payload, runtimeStatusPayloadCache.builtAt, { cached: true }),
        reason,
        responseTimeoutMs,
        { builtAt: runtimeStatusPayloadCache.builtAt, summary: true },
      )
    }
    const builtAt = nowMs()
    const minimal = minimalRuntimeStatusPayload(reason, responseTimeoutMs)
    return withRuntimeFallbackMonitor(
      runtimeSummaryPayloadFromStatusPayload(minimal, builtAt, { cached: false }),
      reason,
      responseTimeoutMs,
      { summary: true },
    )
  }

  async function buildRuntimeStatusPayload(forcePluginRefresh: boolean): Promise<Record<string, unknown>> {
    const builtStartedAt = nowMs()
    void options.sweepOpenClawSessionLocks('runtime status', { quiet: true }).catch(() => undefined)
    void options.sweepExpiredMissionCronJobs('runtime status mission cron expiry sweep').catch(() => undefined)
    const [
      gatewayHealth,
      gatewayReadiness,
      gatewayLedgerSnapshot,
      externalGatewayLogs,
      externalChannelActivityLogs,
      pluginControls,
      config,
      gatewayStability,
      doctorDiagnostics,
    ] = await Promise.all([
      options.fetchGatewayHealthPayload(),
      options.fetchGatewayReadinessPayload(),
      options.readRuntimeGatewayLedgerSnapshot(160),
      options.readExternalGatewayLogEntries(160),
      options.readExternalChannelActivityEntries(160),
      options.listPluginControls({ forceRefresh: forcePluginRefresh }).catch((error) => ({
        plugins: [],
        configPath: options.openClawConfigPath,
        cache: { source: 'unavailable', refreshedAt: 0, refreshing: false },
        cliError: String(error),
      })),
      options.readOpenclawConfig().catch(() => options.createInitialOpenclawConfig()),
      options.readGatewayStabilitySnapshot(18),
      options.readDoctorDiagnosticsSummary(false, { sqlite: false }),
    ])
    const probesMs = nowMs() - builtStartedAt
    const gateway = options.gatewayStatusSnapshot(gatewayHealth.healthy, null, gatewayLedgerSnapshot.restart, gatewayLedgerSnapshot.recentRestarts, gatewayStability)
    const ledgerGatewayLogs = gatewayLedgerSnapshot.entries
    const currentLedgerGatewayLogs = options.gatewayLogEntriesSinceCurrentStart(ledgerGatewayLogs)
    const currentExternalGatewayLogs = options.gatewayLogEntriesSinceCurrentStart(externalGatewayLogs)
    const currentChannelActivityLogs = options.gatewayLogEntriesSinceCurrentStart(externalChannelActivityLogs)
    const currentGatewayLogs = options.dedupeGatewayLogEntries([...currentLedgerGatewayLogs, ...currentExternalGatewayLogs], 120)
    const runtimeLoadedPluginIds = new Set(
      [
        ...loadedPluginIdsFromGatewayHealth(gatewayHealth.payload),
        ...options.runtimeLoadedPluginIdsFromGatewayLogs([...gatewayLogs(gateway), ...currentGatewayLogs]),
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    )
    const activity = options.summarizeGatewayActivity([...currentGatewayLogs, ...currentChannelActivityLogs])
    const sessionsStartedAt = nowMs()
    const sessions = await options.openAgentSessionSnapshots(activity)
    const sessionsMs = nowMs() - sessionsStartedAt
    const isPluginRuntimeLoaded = (plugin: RuntimeStatusPluginControlEntry) => {
      const status = plugin.status.trim().toLowerCase()
      return runtimeLoadedPluginIds.has(plugin.id) || plugin.runtimeLoaded || status === 'loaded'
    }
    const pluginSummaries = pluginControls.plugins.map((plugin) => pluginSummary(plugin, Boolean(isPluginRuntimeLoaded(plugin))))
    const enabledPluginSummaries = pluginSummaries.filter((plugin) => plugin.enabled)
    const communicationPluginSummaries = enabledPluginSummaries.filter((plugin) => plugin.category === 'communications' || plugin.channels.length)
    const activeMissions = options.listMissions().filter((mission) => mission.status === 'active')
    // The summary is what the Monitor shell renders, so it must include
    // durable OpenClaw jobs as well as Control Center-owned shifts.
    const cronJobs = options.listActiveCronJobViews()
    gateway.logs = options.dedupeGatewayLogEntries([...gatewayLogs(gateway), ...currentGatewayLogs], 80)

    return {
      ok: true,
      generatedAt: new Date(nowMs()).toISOString(),
      monitor: {
        cached: false,
        cacheAgeMs: 0,
        cacheTtlMs: options.statusCacheMs,
        buildMs: nowMs() - builtStartedAt,
        forceRefresh: forcePluginRefresh,
        timings: {
          probesMs,
          sessionsMs,
          totalMs: nowMs() - builtStartedAt,
        },
        sources: {
          gatewayLedgerLogs: currentLedgerGatewayLogs.length,
          gatewayExternalLogs: currentExternalGatewayLogs.length,
          channelExternalLogs: currentChannelActivityLogs.length,
          doctorRuns: doctorDiagnostics.recent.length,
          plugins: pluginControls.cache?.source || 'unknown',
        },
      },
      runtime: options.runtimeVersionCheckPayload(),
      persistence: options.runtimeLedgerStatus({ sqlite: false }),
      optimization: options.openClawOptimizationStatus(config),
      gateway: {
        ...gateway,
        readiness: gatewayReadiness,
        chat: options.gatewayChatRuntimeSnapshot(),
        activity,
        stability: gatewayStability,
      },
      sessions,
      activeRuns: options.activeRunSnapshots(),
      recentRuns: options.recentRunSnapshots(20),
      plugins: {
        enabledCount: enabledPluginSummaries.length,
        totalCount: pluginSummaries.length,
        all: pluginSummaries,
        enabled: enabledPluginSummaries.slice(0, 24),
        communication: communicationPluginSummaries.slice(0, 12),
        cache: pluginControls.cache,
        ...(pluginControls.cliError ? { cliError: pluginControls.cliError } : {}),
      },
      shifts: {
        activeCount: cronJobs.active.length,
        active: cronJobs.active.slice(0, 12),
        ...(cronJobs.error ? { error: cronJobs.error } : {}),
      },
      missions: {
        activeCount: activeMissions.length,
        active: activeMissions.slice(0, 12).map((mission) => options.missionView(mission)),
      },
      diagnostics: {
        doctor: doctorDiagnostics,
      },
    }
  }

  async function buildRuntimeSummaryPayload(): Promise<Record<string, unknown>> {
    const builtStartedAt = nowMs()
    const [gatewayHealth, gatewayReadiness, gatewayLedgerSnapshot, externalChannelActivityLogs, gatewayStability, doctorDiagnostics] = await Promise.all([
      options.fetchGatewayHealthPayload(),
      options.fetchGatewayReadinessPayload(),
      options.readRuntimeGatewayLedgerSnapshot(48),
      options.readExternalChannelActivityEntries(48),
      options.readGatewayStabilitySnapshot(8),
      options.readDoctorDiagnosticsSummary(false, { sqlite: false }),
    ])
    const gateway = options.gatewayStatusSnapshot(gatewayHealth.healthy, null, gatewayLedgerSnapshot.restart, gatewayLedgerSnapshot.recentRestarts, gatewayStability)
    const ledgerGatewayLogs = gatewayLedgerSnapshot.entries
    const currentLedgerGatewayLogs = options.gatewayLogEntriesSinceCurrentStart(ledgerGatewayLogs)
    const shouldReadExternalGatewayLogs = currentLedgerGatewayLogs.length === 0
    const externalGatewayLogs = shouldReadExternalGatewayLogs
      ? await options.readExternalGatewayLogEntries(48)
      : []
    const probesMs = nowMs() - builtStartedAt
    const currentExternalGatewayLogs = options.gatewayLogEntriesSinceCurrentStart(externalGatewayLogs)
    const currentGatewayLogs = options.dedupeGatewayLogEntries([
      ...currentLedgerGatewayLogs,
      ...currentExternalGatewayLogs,
    ], 48)
    const currentChannelActivityLogs = options.gatewayLogEntriesSinceCurrentStart(externalChannelActivityLogs)
    const activity = options.summarizeGatewayActivity([...currentGatewayLogs, ...currentChannelActivityLogs])
    const cronJobs = options.listActiveCronJobViews()
    const activeMissions = options.listMissions().filter((mission) => mission.status === 'active')
    const cachedPlugins = isLooseRecord(runtimeStatusPayloadCache?.payload?.plugins)
      ? runtimeStatusPayloadCache?.payload.plugins
      : null
    const pluginEnabledCount = typeof cachedPlugins?.enabledCount === 'number' ? cachedPlugins.enabledCount : 0
    const pluginTotalCount = typeof cachedPlugins?.totalCount === 'number' ? cachedPlugins.totalCount : 0
    const pluginCommunication = Array.isArray(cachedPlugins?.communication) ? cachedPlugins.communication.slice(0, 4) : []
    gateway.logs = options.dedupeGatewayLogEntries([...gatewayLogs(gateway), ...currentGatewayLogs], 12)

    return {
      ok: true,
      generatedAt: new Date(nowMs()).toISOString(),
      monitor: {
        cached: false,
        summary: true,
        cacheAgeMs: 0,
        cacheTtlMs: options.summaryCacheMs,
        buildMs: nowMs() - builtStartedAt,
        forceRefresh: false,
        timings: {
          probesMs,
          totalMs: nowMs() - builtStartedAt,
        },
        sources: {
          gatewayLedgerLogs: currentLedgerGatewayLogs.length,
          gatewayExternalLogs: currentExternalGatewayLogs.length,
          gatewayExternalLogSource: shouldReadExternalGatewayLogs ? 'fallback-log-tail' : 'skipped-ledger-hot-path',
          channelExternalLogs: externalChannelActivityLogs.length,
          doctorRuns: doctorDiagnostics.recent.length,
        },
      },
      gateway: {
        ...gateway,
        readiness: gatewayReadiness,
        chat: options.gatewayChatRuntimeSnapshot(),
        stability: gatewayStability,
        activity: {
          ...activity,
          events: activity.events.slice(0, 8),
        },
      },
      sessions: [],
      activeRuns: options.activeRunSnapshots(),
      recentRuns: [],
      plugins: {
        enabledCount: pluginEnabledCount,
        totalCount: pluginTotalCount,
        enabled: [],
        communication: pluginCommunication,
        ...(cachedPlugins?.cache ? { cache: cachedPlugins.cache } : {}),
        ...(cachedPlugins?.cliError ? { cliError: cachedPlugins.cliError } : {}),
      },
      shifts: {
        activeCount: cronJobs.active.length,
        active: cronJobs.active.slice(0, 4),
        ...(cronJobs.error ? { error: cronJobs.error } : {}),
      },
      missions: {
        activeCount: activeMissions.length,
        active: activeMissions.slice(0, 4).map((mission) => options.missionView(mission)),
      },
      diagnostics: {
        doctor: {
          ...doctorDiagnostics,
          recent: doctorDiagnostics.recent.slice(0, 2),
        },
      },
    }
  }

  async function getRuntimeStatusPayload(forcePluginRefresh: boolean): Promise<Record<string, unknown>> {
    const now = nowMs()
    if (!forcePluginRefresh && runtimeStatusPayloadCache && now - runtimeStatusPayloadCache.builtAt <= options.statusCacheMs) {
      return runtimeStatusFromCache(runtimeStatusPayloadCache.payload, runtimeStatusPayloadCache.builtAt)
    }
    if (!forcePluginRefresh && runtimeStatusPayloadInFlight) {
      try {
        const payload = await withResponseDeadline(runtimeStatusPayloadInFlight, 'runtime status refresh', options.statusResponseTimeoutMs)
        return runtimeStatusFromCache(payload, runtimeStatusPayloadCache?.builtAt || nowMs())
      } catch (error) {
        if (isRuntimeResponseTimeout(error)) {
          runtimeStatusPayloadInFlight = null
          return fallbackRuntimeStatusPayload(error, options.statusResponseTimeoutMs)
        }
        throw error
      }
    }

    const promise = buildRuntimeStatusPayload(forcePluginRefresh).then((payload) => {
      cacheRuntimeStatusPayload(payload)
      return payload
    }).finally(() => {
      if (runtimeStatusPayloadInFlight === promise) runtimeStatusPayloadInFlight = null
    })
    if (!forcePluginRefresh) runtimeStatusPayloadInFlight = promise
    try {
      return await withResponseDeadline(promise, 'runtime status refresh', options.statusResponseTimeoutMs)
    } catch (error) {
      if (isRuntimeResponseTimeout(error)) {
        if (runtimeStatusPayloadInFlight === promise) runtimeStatusPayloadInFlight = null
        return fallbackRuntimeStatusPayload(error, options.statusResponseTimeoutMs)
      }
      throw error
    }
  }

  async function getRuntimeSummaryPayload(forceRefresh: boolean): Promise<Record<string, unknown>> {
    const now = nowMs()
    if (!forceRefresh && runtimeSummaryPayloadCache && now - runtimeSummaryPayloadCache.builtAt <= options.summaryCacheMs) {
      return runtimeSummaryFromCache(runtimeSummaryPayloadCache.payload, runtimeSummaryPayloadCache.builtAt)
    }
    if (!forceRefresh && runtimeStatusPayloadCache && now - runtimeStatusPayloadCache.builtAt <= Math.min(options.statusCacheMs, options.summaryCacheMs)) {
      const builtAt = runtimeStatusPayloadCache.builtAt
      const summary = runtimeSummaryPayloadFromStatusPayload(runtimeStatusPayloadCache.payload, builtAt, { cached: true })
      cacheRuntimeSummaryPayload(runtimeSummaryPayloadFromStatusPayload(runtimeStatusPayloadCache.payload, builtAt, { cached: false }), builtAt)
      return summary
    }
    if (!forceRefresh && runtimeStatusPayloadInFlight) {
      try {
        const payload = await withResponseDeadline(runtimeStatusPayloadInFlight, 'runtime status refresh for summary', options.summaryResponseTimeoutMs)
        const builtAt = runtimeStatusPayloadCache?.builtAt || nowMs()
        const summary = runtimeSummaryPayloadFromStatusPayload(payload, builtAt, { cached: true })
        cacheRuntimeSummaryPayload(runtimeSummaryPayloadFromStatusPayload(payload, builtAt, { cached: false }), builtAt)
        return summary
      } catch (error) {
        if (isRuntimeResponseTimeout(error)) {
          runtimeStatusPayloadInFlight = null
          return fallbackRuntimeSummaryPayload(error, options.summaryResponseTimeoutMs)
        }
        throw error
      }
    }
    if (!forceRefresh && runtimeSummaryPayloadInFlight) {
      try {
        const payload = await withResponseDeadline(runtimeSummaryPayloadInFlight, 'runtime summary refresh', options.summaryResponseTimeoutMs)
        return runtimeSummaryFromCache(payload, runtimeSummaryPayloadCache?.builtAt || nowMs())
      } catch (error) {
        if (isRuntimeResponseTimeout(error)) {
          runtimeSummaryPayloadInFlight = null
          return fallbackRuntimeSummaryPayload(error, options.summaryResponseTimeoutMs)
        }
        throw error
      }
    }

    const promise = buildRuntimeSummaryPayload().then((payload) => {
      cacheRuntimeSummaryPayload(payload)
      return payload
    }).finally(() => {
      if (runtimeSummaryPayloadInFlight === promise) runtimeSummaryPayloadInFlight = null
    })
    if (!forceRefresh) runtimeSummaryPayloadInFlight = promise
    try {
      return await withResponseDeadline(promise, 'runtime summary refresh', options.summaryResponseTimeoutMs)
    } catch (error) {
      if (isRuntimeResponseTimeout(error)) {
        if (runtimeSummaryPayloadInFlight === promise) runtimeSummaryPayloadInFlight = null
        return fallbackRuntimeSummaryPayload(error, options.summaryResponseTimeoutMs)
      }
      throw error
    }
  }

  return {
    invalidateCache,
    getRuntimeStatusPayload,
    getRuntimeSummaryPayload,
  }
}

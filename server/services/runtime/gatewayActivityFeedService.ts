import type { GatewayLogEntry } from '../gateway/gatewayLogService'

export type GatewayActivityFeedSnapshot = {
  entries: GatewayLogEntry[]
  restart: unknown
  recentRestarts: unknown[]
}

export type GatewayActivityFeed = {
  generatedAt: string
  storage: 'durable-ledger'
  entries: GatewayLogEntry[]
}

export type GatewayActivityFeedServiceOptions = {
  readGatewayLedgerSnapshot: (limit?: number) => Promise<GatewayActivityFeedSnapshot>
  dedupeGatewayLogEntries: (entries: GatewayLogEntry[], limit?: number) => GatewayLogEntry[]
  isRuntimeMonitorEntryVisible: (timestamp: string | null | undefined) => boolean
  now?: () => number
}

const DEFAULT_ACTIVITY_FEED_LIMIT = 48
const MAX_ACTIVITY_FEED_LIMIT = 100

function normalizedLimit(value: number | undefined) {
  const candidate = Number.isFinite(value) ? Math.round(value as number) : DEFAULT_ACTIVITY_FEED_LIMIT
  return Math.max(1, Math.min(MAX_ACTIVITY_FEED_LIMIT, candidate))
}

/**
 * Supplies the Settings activity view from the durable Gateway ledger only.
 *
 * This deliberately does not call Gateway health/readiness APIs or tail any
 * external files. Those operations belong to the Monitor diagnostics path;
 * making the Settings screen depend on them caused a simple log view to wake
 * the Gateway and repeatedly parse large local logs.
 */
export function createGatewayActivityFeedService(options: GatewayActivityFeedServiceOptions) {
  const nowMs = options.now ?? (() => Date.now())

  async function getGatewayActivityFeed(limit?: number): Promise<GatewayActivityFeed> {
    const requestedLimit = normalizedLimit(limit)
    const snapshot = await options.readGatewayLedgerSnapshot(requestedLimit)
    const entries = options.dedupeGatewayLogEntries(
      snapshot.entries.filter((entry) => options.isRuntimeMonitorEntryVisible(entry.timestamp)),
      requestedLimit,
    )

    return {
      generatedAt: new Date(nowMs()).toISOString(),
      storage: 'durable-ledger',
      entries,
    }
  }

  return { getGatewayActivityFeed }
}

export type GatewayActivityFeedService = ReturnType<typeof createGatewayActivityFeedService>

import type { GatewayLogEntry } from '../gateway/gatewayLogService'

export type ChannelDeliveryCheck = 'pass' | 'warn' | 'fail' | 'unknown'
export type ChannelConnectionStatus = 'connected' | 'attention' | 'blocked' | 'starting' | 'not-configured' | 'unknown'
export type ChannelProbeState = 'live' | 'partial' | 'starting' | 'unavailable'
export type ChannelDeliveryEvidence = 'unavailable' | 'send-observed' | 'provider-confirmed' | 'failure-observed'

export type ChannelActivitySummary = {
  lastInboundObservedAt: string | null
  lastOutboundObservedAt: string | null
  lastObservedAt: string | null
  inboundObservedCount: number
  outboundObservedCount: number
  failureObservedCount: number
  lastFailureObservedAt: string | null
}

export type ChannelReliabilitySummary = {
  /** A normalized channel id. Account ids, names, targets, and message text are intentionally omitted. */
  id: string
  /** A control-character-safe display label from OpenClaw's verified channel metadata. */
  label: string
  status: ChannelConnectionStatus
  configuredAccounts: number
  enabledAccounts: number
  linkedAccounts: number
  connectedAccounts: number
  blockedAccounts: number
  recoveringAccounts: number
  activeRuns: number
  issueCount: number
  lastConnectedAt: string | null
  lastTransportActivityAt: string | null
  lastProbeAt: string | null
  activity: ChannelActivitySummary
  /** Observational evidence only. A send or log line never becomes a receipt by inference. */
  deliveryEvidence: ChannelDeliveryEvidence
}

export type ChannelDeliveryStatus = {
  checkedAt: string
  probe: {
    state: ChannelProbeState
    partial: boolean
    eventLoopDegraded: boolean | null
  }
  totals: {
    channels: number
    configuredAccounts: number
    connectedAccounts: number
    attentionChannels: number
    blockedChannels: number
    activeRuns: number
    observedInbound: number
    observedOutbound: number
    observedFailures: number
  }
  channels: ChannelReliabilitySummary[]
  /** Backwards-compatible Telegram summary used by existing settings consumers. */
  telegram: {
    status: 'connected' | 'attention' | 'not-configured' | 'unknown'
    configuredAccounts: number
    connectedAccounts: number
    pairing: { status: 'not-queried'; pendingCount: null }
  }
  /** ClawTalk runs outside the OpenClaw channel registry, so retain its own safe doctor summary. */
  clawTalk: {
    botConnected: ChannelDeliveryCheck
    websocketServer: ChannelDeliveryCheck
  }
  /** Aggregate observed traffic. It is intentionally not represented as a provider receipt. */
  activity: Pick<ChannelActivitySummary, 'lastInboundObservedAt' | 'lastOutboundObservedAt' | 'lastObservedAt'>
  deliveryReceiptStatus: 'provider-confirmed-when-reported'
}

type OpenClawCommandResult = { stdout?: string; stderr?: string; code: number }

type ChannelDeliveryStatusOptions = {
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<OpenClawCommandResult>
  readChannelActivity: (limit: number) => Promise<GatewayLogEntry[]>
  now?: () => Date
}

type JsonRecord = Record<string, unknown>

type ChannelEvent = {
  direction: 'inbound' | 'outbound' | 'system'
  timestamp: string
  failed: boolean
  providerConfirmed: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(stdout: string | undefined): JsonRecord | null {
  if (!stdout?.trim()) return null
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function safeChannelId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
}

function safeChannelLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

function getBoolean(record: JsonRecord, keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key] as boolean
  return undefined
}

function timestampFromUnknown(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 0 && value < 20_000_000_000 ? value * 1000 : value
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => b.time - a.time)
  return timestamps[0]?.value || null
}

function getLegacyChannelEntries(payload: JsonRecord | null): JsonRecord[] {
  if (!payload) return []
  const rawChannels = payload.channels
  if (Array.isArray(rawChannels)) return rawChannels.filter(isRecord).slice(0, 40)
  if (isRecord(rawChannels)) return Object.entries(rawChannels).slice(0, 40).map(([id, value]) => ({ id, ...(isRecord(value) ? value : {}) }))
  return []
}

function channelIds(payload: JsonRecord | null): string[] {
  if (!payload) return []
  const ids = new Set<string>()
  const append = (value: unknown) => {
    const id = safeChannelId(value)
    if (id) ids.add(id)
  }
  if (Array.isArray(payload.channelOrder)) payload.channelOrder.forEach(append)
  for (const key of ['channelAccounts', 'channels', 'channelLabels'] as const) {
    const record = payload[key]
    if (isRecord(record)) Object.keys(record).forEach(append)
  }
  getLegacyChannelEntries(payload).forEach((entry) => append(entry.id ?? entry.channel ?? entry.name))
  return Array.from(ids).slice(0, 40)
}

function entryForChannel(payload: JsonRecord | null, channelId: string): JsonRecord | null {
  if (!payload) return null
  const channels = payload.channels
  if (isRecord(channels)) {
    for (const [key, value] of Object.entries(channels)) {
      if (safeChannelId(key) === channelId && isRecord(value)) return value
    }
  }
  return getLegacyChannelEntries(payload).find((entry) => safeChannelId(entry.id ?? entry.channel ?? entry.name) === channelId) || null
}

function accountsForChannel(payload: JsonRecord | null, channelId: string): JsonRecord[] {
  if (!payload) return []
  const channelAccounts = payload.channelAccounts
  if (isRecord(channelAccounts)) {
    for (const [key, value] of Object.entries(channelAccounts)) {
      if (safeChannelId(key) === channelId && Array.isArray(value)) return value.filter(isRecord).slice(0, 40)
    }
  }
  const entry = entryForChannel(payload, channelId)
  if (!entry) return []
  if (Array.isArray(entry.accounts)) return entry.accounts.filter(isRecord).slice(0, 40)
  return Object.keys(entry).length ? [entry] : []
}

function labelForChannel(payload: JsonRecord | null, channelId: string): string {
  const labels = payload?.channelLabels
  if (isRecord(labels)) {
    for (const [key, value] of Object.entries(labels)) {
      if (safeChannelId(key) === channelId) return safeChannelLabel(value, channelId)
    }
  }
  const entry = entryForChannel(payload, channelId)
  return safeChannelLabel(entry?.label ?? entry?.name, channelId)
}

function accountConnected(account: JsonRecord): boolean | undefined {
  const probe = isRecord(account.probe) ? account.probe : {}
  const direct = getBoolean(account, ['connected', 'online'])
  if (direct !== undefined) return direct
  if (typeof probe.ok === 'boolean') return probe.ok
  const status = [account.status, account.state, account.healthState, probe.status]
    .find((value): value is string => typeof value === 'string')
    ?.trim().toLowerCase()
  if (status && ['connected', 'online', 'ready', 'ok', 'healthy'].includes(status)) return true
  if (status && ['disconnected', 'offline', 'stopped', 'failed', 'error', 'blocked'].includes(status)) return false
  return undefined
}

function accountBlocked(account: JsonRecord): boolean {
  const lifecycle = typeof account.lifecycle === 'string' ? account.lifecycle.trim().toLowerCase() : ''
  return lifecycle === 'blocked' || account.terminalDisconnect === true
}

function accountRecovering(account: JsonRecord): boolean {
  const lifecycle = typeof account.lifecycle === 'string' ? account.lifecycle.trim().toLowerCase() : ''
  return lifecycle === 'starting' || lifecycle === 'recovering' || account.restartPending === true
}

function getStatusIssues(payload: JsonRecord | null, channelId: string): JsonRecord[] {
  if (!payload || !Array.isArray(payload.statusIssues)) return []
  return payload.statusIssues
    .filter(isRecord)
    .filter((issue) => safeChannelId(issue.channel) === channelId)
    .slice(0, 50)
}

function looksLikeFailure(entry: GatewayLogEntry): boolean {
  if (entry.level && /(?:error|fatal|warn)/iu.test(entry.level)) return true
  const message = entry.message.replace(/\s+/gu, ' ')
  return /\b(?:failed|failure|error|exception|rejected|denied|timed?\s*out|rate[ -]?limit(?:ed)?)\b/iu.test(message)
    && !/\b(?:no|without) errors?\b/iu.test(message)
}

function providerConfirmed(entry: GatewayLogEntry): boolean {
  return /\b(?:delivery receipt|delivery confirmed|confirmed delivery|provider[- ]confirmed)\b/iu.test(entry.message)
}

function channelEvents(entries: GatewayLogEntry[], channelId: string): ChannelEvent[] {
  return entries
    .filter((entry) => safeChannelId(entry.channel) === channelId)
    .filter((entry) => entry.direction === 'inbound' || entry.direction === 'outbound' || looksLikeFailure(entry))
    .map((entry) => {
      const direction: ChannelEvent['direction'] = entry.direction === 'inbound' || entry.direction === 'outbound' ? entry.direction : 'system'
      return {
        direction,
        timestamp: timestampFromUnknown(entry.timestamp) || '',
        failed: looksLikeFailure(entry),
        providerConfirmed: providerConfirmed(entry),
      }
    })
    .filter((entry) => Boolean(entry.timestamp))
}

function summarizeActivity(events: ChannelEvent[], accounts: JsonRecord[]): ChannelActivitySummary {
  const inbound = events.filter((entry) => entry.direction === 'inbound')
  const outbound = events.filter((entry) => entry.direction === 'outbound')
  const failures = events.filter((entry) => entry.failed)
  return {
    lastInboundObservedAt: latestTimestamp([
      ...inbound.map((entry) => entry.timestamp),
      ...accounts.map((account) => timestampFromUnknown(account.lastInboundAt)),
    ]),
    lastOutboundObservedAt: latestTimestamp([
      ...outbound.map((entry) => entry.timestamp),
      ...accounts.map((account) => timestampFromUnknown(account.lastOutboundAt)),
    ]),
    lastObservedAt: latestTimestamp([
      ...events.map((entry) => entry.timestamp),
      ...accounts.map((account) => timestampFromUnknown(account.lastTransportActivityAt)),
      ...accounts.map((account) => timestampFromUnknown(account.lastInboundAt)),
      ...accounts.map((account) => timestampFromUnknown(account.lastOutboundAt)),
    ]),
    inboundObservedCount: inbound.length,
    outboundObservedCount: outbound.length,
    failureObservedCount: failures.length,
    lastFailureObservedAt: latestTimestamp(failures.map((entry) => entry.timestamp)),
  }
}

function deliveryEvidence(events: ChannelEvent[]): ChannelDeliveryEvidence {
  if (events.some((entry) => entry.failed)) return 'failure-observed'
  if (events.some((entry) => entry.providerConfirmed)) return 'provider-confirmed'
  if (events.some((entry) => entry.direction === 'outbound')) return 'send-observed'
  return 'unavailable'
}

function summarizeChannel(payload: JsonRecord | null, entries: GatewayLogEntry[], channelId: string): ChannelReliabilitySummary {
  const accounts = accountsForChannel(payload, channelId)
  const events = channelEvents(entries, channelId)
  const configuredAccounts = accounts.filter((account) => getBoolean(account, ['configured']) !== false).length
  const enabledAccounts = accounts.filter((account) => getBoolean(account, ['enabled']) !== false).length
  const linkedAccounts = accounts.filter((account) => getBoolean(account, ['linked']) === true).length
  const connectedAccounts = accounts.filter((account) => accountConnected(account) === true).length
  const blockedAccounts = accounts.filter(accountBlocked).length
  const recoveringAccounts = accounts.filter(accountRecovering).length
  const activeRuns = accounts.reduce((count, account) => count + (typeof account.activeRuns === 'number' && Number.isFinite(account.activeRuns) ? Math.max(0, Math.floor(account.activeRuns)) : 0), 0)
  const issues = getStatusIssues(payload, channelId)
  const activity = summarizeActivity(events, accounts)
  const hasConnectionEvidence = accounts.some((account) => accountConnected(account) !== undefined)
  const hasAccountError = accounts.some((account) => typeof account.lastError === 'string' && Boolean(account.lastError.trim()))
  const status: ChannelConnectionStatus = blockedAccounts > 0
    ? 'blocked'
    : recoveringAccounts > 0
      ? 'starting'
      : connectedAccounts > 0
        ? 'connected'
        : configuredAccounts === 0
          ? 'not-configured'
          : hasConnectionEvidence || hasAccountError || issues.length > 0
            ? 'attention'
            : 'unknown'
  return {
    id: channelId,
    label: labelForChannel(payload, channelId),
    status,
    configuredAccounts,
    enabledAccounts,
    linkedAccounts,
    connectedAccounts,
    blockedAccounts,
    recoveringAccounts,
    activeRuns,
    issueCount: issues.length,
    lastConnectedAt: latestTimestamp(accounts.map((account) => timestampFromUnknown(account.lastConnectedAt))),
    lastTransportActivityAt: latestTimestamp(accounts.map((account) => timestampFromUnknown(account.lastTransportActivityAt))),
    lastProbeAt: latestTimestamp(accounts.map((account) => timestampFromUnknown(account.lastProbeAt))),
    activity,
    deliveryEvidence: deliveryEvidence(events),
  }
}

function clawTalkCheckStatus(stdout: string | undefined, stderr: string | undefined, check: string): ChannelDeliveryCheck {
  const lines = `${stdout || ''}\n${stderr || ''}`.split(/\r?\n/u)
  for (const line of lines) {
    const match = new RegExp(`\\b${check}\\b`, 'i').exec(line)
    if (!match) continue
    if (/[\u00D7\u2717]|\b(?:fail|failed|error)\b/i.test(line)) return 'fail'
    if (/[\u26A0\u2757]|\b(?:warn|warning)\b/i.test(line)) return 'warn'
    if (/[\u2705\u2714]|\b(?:pass|passed|ok)\b/i.test(line)) return 'pass'
  }
  return 'unknown'
}

function probeState(payload: JsonRecord | null, commandSucceeded: boolean): ChannelDeliveryStatus['probe'] {
  const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
  const starting = status === 'starting' || typeof payload?.startupPhase === 'string'
  const partial = payload?.partial === true || (Array.isArray(payload?.warnings) && payload.warnings.length > 0)
  const eventLoop = isRecord(payload?.eventLoop) && typeof payload?.eventLoop.degraded === 'boolean'
    ? payload.eventLoop.degraded
    : null
  return {
    state: starting ? 'starting' : commandSucceeded && payload ? partial ? 'partial' : 'live' : 'unavailable',
    partial,
    eventLoopDegraded: eventLoop,
  }
}

function legacyTelegram(channels: ChannelReliabilitySummary[]): ChannelDeliveryStatus['telegram'] {
  const telegram = channels.find((channel) => channel.id === 'telegram')
  if (!telegram) return { status: 'not-configured', configuredAccounts: 0, connectedAccounts: 0, pairing: { status: 'not-queried', pendingCount: null } }
  return {
    status: telegram.status === 'connected' ? 'connected' : telegram.status === 'not-configured' ? 'not-configured' : telegram.status === 'unknown' ? 'unknown' : 'attention',
    configuredAccounts: telegram.configuredAccounts,
    connectedAccounts: telegram.connectedAccounts,
    pairing: { status: 'not-queried', pendingCount: null },
  }
}

export function createChannelDeliveryStatusService(options: ChannelDeliveryStatusOptions) {
  const now = options.now || (() => new Date())

  return {
    async getStatus(): Promise<ChannelDeliveryStatus> {
      const [channelResult, clawTalkResult, activityEntries] = await Promise.all([
        options.runOpenClaw(['channels', 'status', '--probe', '--timeout', '10000', '--json'], 25_000)
          .catch(() => ({ stdout: '', stderr: '', code: 1 })),
        options.runOpenClaw(['clawtalk', 'doctor'], 20_000)
          .catch(() => ({ stdout: '', stderr: '', code: 1 })),
        options.readChannelActivity(160).catch(() => []),
      ])
      const payload = parseJson(channelResult.stdout)
      const channels = channelIds(payload)
        .map((channelId) => summarizeChannel(payload, activityEntries, channelId))
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      const aggregateActivity: ChannelActivitySummary = {
        lastInboundObservedAt: latestTimestamp(channels.map((channel) => channel.activity.lastInboundObservedAt)),
        lastOutboundObservedAt: latestTimestamp(channels.map((channel) => channel.activity.lastOutboundObservedAt)),
        lastObservedAt: latestTimestamp(channels.map((channel) => channel.activity.lastObservedAt)),
        inboundObservedCount: channels.reduce((count, channel) => count + channel.activity.inboundObservedCount, 0),
        outboundObservedCount: channels.reduce((count, channel) => count + channel.activity.outboundObservedCount, 0),
        failureObservedCount: channels.reduce((count, channel) => count + channel.activity.failureObservedCount, 0),
        lastFailureObservedAt: latestTimestamp(channels.map((channel) => channel.activity.lastFailureObservedAt)),
      }
      return {
        checkedAt: now().toISOString(),
        probe: probeState(payload, channelResult.code === 0),
        totals: {
          channels: channels.length,
          configuredAccounts: channels.reduce((count, channel) => count + channel.configuredAccounts, 0),
          connectedAccounts: channels.reduce((count, channel) => count + channel.connectedAccounts, 0),
          attentionChannels: channels.filter((channel) => channel.status === 'attention' || channel.status === 'starting').length,
          blockedChannels: channels.filter((channel) => channel.status === 'blocked').length,
          activeRuns: channels.reduce((count, channel) => count + channel.activeRuns, 0),
          observedInbound: aggregateActivity.inboundObservedCount,
          observedOutbound: aggregateActivity.outboundObservedCount,
          observedFailures: aggregateActivity.failureObservedCount,
        },
        channels,
        telegram: legacyTelegram(channels),
        clawTalk: {
          botConnected: clawTalkCheckStatus(clawTalkResult.stdout, clawTalkResult.stderr, 'bot_connected'),
          websocketServer: clawTalkCheckStatus(clawTalkResult.stdout, clawTalkResult.stderr, 'websocket_server'),
        },
        activity: {
          lastInboundObservedAt: aggregateActivity.lastInboundObservedAt,
          lastOutboundObservedAt: aggregateActivity.lastOutboundObservedAt,
          lastObservedAt: aggregateActivity.lastObservedAt,
        },
        deliveryReceiptStatus: 'provider-confirmed-when-reported',
      }
    },
  }
}

import type { GatewayLogEntry } from '../gateway/gatewayLogService'

export type ChannelDeliveryCheck = 'pass' | 'warn' | 'fail' | 'unknown'

export type ChannelDeliveryStatus = {
  checkedAt: string
  telegram: {
    status: 'connected' | 'attention' | 'not-configured' | 'unknown'
    configuredAccounts: number
    connectedAccounts: number
    pairing: { status: 'not-queried'; pendingCount: null }
  }
  clawTalk: {
    botConnected: ChannelDeliveryCheck
    websocketServer: ChannelDeliveryCheck
  }
  activity: {
    lastInboundObservedAt: string | null
    lastOutboundObservedAt: string | null
    lastObservedAt: string | null
  }
  deliveryReceiptStatus: 'unavailable'
}

type OpenClawCommandResult = { stdout?: string; stderr?: string; code: number }

type ChannelDeliveryStatusOptions = {
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<OpenClawCommandResult>
  readChannelActivity: (limit: number) => Promise<GatewayLogEntry[]>
  now?: () => Date
}

type JsonRecord = Record<string, unknown>

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

function getChannelEntries(payload: JsonRecord | null): JsonRecord[] {
  if (!payload) return []
  const rawChannels = payload.channels
  if (Array.isArray(rawChannels)) return rawChannels.filter(isRecord).slice(0, 20)
  if (isRecord(rawChannels)) {
    return Object.entries(rawChannels).slice(0, 20).map(([id, value]) => ({ id, ...(isRecord(value) ? value : {}) }))
  }
  return []
}

function getBoolean(record: JsonRecord, keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key] as boolean
  return undefined
}

function accountConnected(account: JsonRecord): boolean | undefined {
  const probe = isRecord(account.probe) ? account.probe : {}
  const direct = getBoolean(account, ['connected', 'online'])
  if (direct !== undefined) return direct
  if (typeof probe.ok === 'boolean') return probe.ok
  const status = [account.status, account.state, probe.status]
    .find((value): value is string => typeof value === 'string')
    ?.trim().toLowerCase()
  if (status && ['connected', 'online', 'ready', 'running', 'ok', 'healthy'].includes(status)) return true
  if (status && ['disconnected', 'offline', 'stopped', 'failed', 'error'].includes(status)) return false
  return undefined
}

function summarizeTelegram(payload: JsonRecord | null, commandSucceeded: boolean): ChannelDeliveryStatus['telegram'] {
  const telegram = getChannelEntries(payload).find((entry) => {
    const id = entry.id ?? entry.channel ?? entry.name
    return typeof id === 'string' && id.trim().toLowerCase() === 'telegram'
  })
  if (!telegram) {
    return {
      status: commandSucceeded ? 'not-configured' : 'unknown',
      configuredAccounts: 0,
      connectedAccounts: 0,
      pairing: { status: 'not-queried', pendingCount: null },
    }
  }

  const accounts = Array.isArray(telegram.accounts)
    ? telegram.accounts.filter(isRecord).slice(0, 20)
    : [telegram]
  const configuredAccounts = accounts.filter((account) => getBoolean(account, ['configured']) !== false).length
  const connectedAccounts = accounts.filter((account) => accountConnected(account) === true).length
  const hasConnectionEvidence = accounts.some((account) => accountConnected(account) !== undefined)
  const status = connectedAccounts > 0
    ? 'connected'
    : configuredAccounts === 0
      ? 'not-configured'
      : hasConnectionEvidence || commandSucceeded
        ? 'attention'
        : 'unknown'
  return {
    status,
    configuredAccounts,
    connectedAccounts,
    pairing: { status: 'not-queried', pendingCount: null },
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

function toSafeTimestamp(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function getActivitySummary(entries: GatewayLogEntry[]): ChannelDeliveryStatus['activity'] {
  const relevantChannels = new Set(['telegram', 'clawtalk'])
  const bounded = entries.slice(0, 80)
  const timestamps = bounded
    .filter((entry) => {
      const channel = entry.channel?.trim().toLowerCase()
      return Boolean(channel && relevantChannels.has(channel))
        && (entry.direction === 'inbound' || entry.direction === 'outbound')
    })
    .map((entry) => ({ direction: entry.direction, timestamp: toSafeTimestamp(entry.timestamp) }))
    .filter((entry): entry is { direction: 'inbound' | 'outbound'; timestamp: string } => Boolean(entry.timestamp))
  const latest = (direction?: 'inbound' | 'outbound') => timestamps
    .filter((entry) => !direction || entry.direction === direction)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]?.timestamp || null
  return {
    lastInboundObservedAt: latest('inbound'),
    lastOutboundObservedAt: latest('outbound'),
    lastObservedAt: latest(),
  }
}

export function createChannelDeliveryStatusService(options: ChannelDeliveryStatusOptions) {
  const now = options.now || (() => new Date())

  return {
    async getStatus(): Promise<ChannelDeliveryStatus> {
      const [telegramResult, clawTalkResult, activity] = await Promise.all([
        options.runOpenClaw(['channels', 'status', '--channel', 'telegram', '--probe', '--timeout', '10000', '--json'], 15_000)
          .catch(() => ({ stdout: '', stderr: '', code: 1 })),
        options.runOpenClaw(['clawtalk', 'doctor'], 20_000)
          .catch(() => ({ stdout: '', stderr: '', code: 1 })),
        options.readChannelActivity(80).catch(() => []),
      ])
      const telegram = summarizeTelegram(parseJson(telegramResult.stdout), telegramResult.code === 0)
      return {
        checkedAt: now().toISOString(),
        telegram,
        clawTalk: {
          botConnected: clawTalkCheckStatus(clawTalkResult.stdout, clawTalkResult.stderr, 'bot_connected'),
          websocketServer: clawTalkCheckStatus(clawTalkResult.stdout, clawTalkResult.stderr, 'websocket_server'),
        },
        activity: getActivitySummary(activity),
        deliveryReceiptStatus: 'unavailable',
      }
    },
  }
}

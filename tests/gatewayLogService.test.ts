import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createGatewayLogService,
  type GatewayLogClient,
  type GatewayLogEntry,
} from '../server/services/gateway/gatewayLogService'

const fixedNow = Date.parse('2026-06-30T08:08:00.000Z')

function redact(value: string) {
  return value
    .replace(/secret-[a-z0-9-]+/giu, '[redacted]')
    .replace(/\btoken=[^\s)]+/giu, 'token=[redacted]')
}

function createService(options: {
  logPath?: string
  stateRoot?: string
  nativeStateRoot?: string
  client?: GatewayLogClient | null
  ledger?: GatewayLogEntry[]
  startedAt?: string | null
  clearedAtMs?: number
  configLogPath?: string
  now?: number
} = {}) {
  const ledger = options.ledger ?? []
  const service = createGatewayLogService({
    openClawGatewayLogPath: options.logPath ?? path.join(tmpdir(), 'missing-gateway.log'),
    openClawStateRoot: options.stateRoot ?? path.join(tmpdir(), 'missing-openclaw-state'),
    nativeOpenClawStateRoot: options.nativeStateRoot ?? path.join(tmpdir(), 'missing-native-openclaw-state'),
    controlCenterStartedAtMs: Date.parse('2026-06-30T08:00:00.000Z'),
    readOpenclawConfig: async () => options.configLogPath ? { logging: { file: options.configLogPath } } : null,
    getGatewayClient: () => options.client ?? null,
    appendGatewayLogEntry: (entry) => {
      ledger.push(entry)
    },
    getGatewayLastStartedAt: () => options.startedAt ?? '2026-06-30T08:00:00.000Z',
    getRuntimeMonitorClearedAtMs: () => options.clearedAtMs ?? 0,
    applyDiagnosticRedactions: redact,
    redactSensitiveText: redact,
    stripAnsi: (value) => value,
    now: () => options.now ?? fixedNow,
    includeSharedOpenClawTempLogs: false,
    externalLogCacheMs: 5,
    rpcLogFailureNoticeMs: 1,
  })
  return { ledger, service }
}

test('pushGatewayLog normalizes channel activity and redacts persisted entries', () => {
  const { ledger, service } = createService()

  service.pushGatewayLog('stdout', '[clawtalk] SMS received from operator token=secret-alpha')

  const [entry] = service.getGatewayLogs()
  assert.equal(entry.stream, 'channel')
  assert.equal(entry.channel, 'clawtalk')
  assert.equal(entry.direction, 'inbound')
  assert.match(entry.message, /token=\[redacted]/)
  assert.doesNotMatch(entry.message, /secret-alpha/)
  assert.equal(ledger.length, 1)
  assert.doesNotMatch(ledger[0]?.message ?? '', /secret-alpha/)
})

test('readExternalGatewayLogEntries prefers logs.tail RPC entries', async () => {
  const requests: Array<{ method: string; params: unknown; timeoutMs?: number | null }> = []
  const { service } = createService({
    client: {
      request: async (method, params, rpcOptions) => {
        requests.push({ method, params, timeoutMs: rpcOptions?.timeoutMs })
        return {
          file: 'gateway:logs.tail',
          lines: [
            '[2026-06-30T08:01:00.000Z] [stdout] message processed: channel=telegram outcome=ok inbound token=secret-beta',
            JSON.stringify({
              time: '2026-06-30T08:02:00.000Z',
              subsystem: 'channels/sms',
              direction: 'outbound',
              message: 'SMS reply sent token=secret-gamma',
            }),
          ],
        }
      },
    },
  })

  const entries = await service.readExternalGatewayLogEntries(10)

  assert.equal(requests[0]?.method, 'logs.tail')
  assert.deepEqual(requests[0]?.params, { limit: 40, maxBytes: 250_000 })
  assert.equal(requests[0]?.timeoutMs, 2500)
  assert.equal(entries.length, 2)
  assert.deepEqual(new Set(entries.map((entry) => entry.channel)), new Set(['telegram', 'sms']))
  assert.equal(entries.some((entry) => /secret-/.test(entry.message)), false)
})

test('readExternalGatewayLogEntries falls back to file tails and redacts RPC failure logs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dystopai-gateway-log-'))
  try {
    const logPath = path.join(root, 'gateway.log')
    await writeFile(logPath, [
      '[2026-06-30T08:03:00.000Z] [stdout] message processed: channel=telegram outcome=ok inbound token=secret-delta',
      '(node:1234) [DEP0005] DeprecationWarning: Buffer() is deprecated',
      JSON.stringify({
        time: '2026-06-30T08:04:00.000Z',
        subsystem: 'channels/sms',
        direction: 'outbound',
        message: 'SMS reply sent token=secret-epsilon',
      }),
      '',
    ].join('\n'))
    const { service } = createService({
      logPath,
      client: {
        request: async () => {
          throw new Error('token=secret-rpc unavailable')
        },
      },
    })

    const entries = await service.readExternalGatewayLogEntries(10)
    const warning = service.getGatewayLogs().find((entry) => entry.message.includes('logs.tail unavailable'))

    assert.equal(entries.length, 2)
    assert.equal(entries.some((entry) => /DeprecationWarning/.test(entry.message)), false)
    assert.deepEqual(new Set(entries.map((entry) => entry.channel)), new Set(['telegram', 'sms']))
    assert.ok(warning, 'logs.tail fallback warning should be mirrored into Gateway logs')
    assert.equal(warning?.level, 'warning')
    assert.match(warning?.message ?? '', /token=\[redacted]/)
    assert.doesNotMatch(warning?.message ?? '', /secret-rpc/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readExternalChannelActivityEntries parses ClawTalk websocket activity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dystopai-clawtalk-log-'))
  try {
    const stateRoot = path.join(root, 'state')
    const nativeStateRoot = path.join(root, 'native')
    const wsDir = path.join(stateRoot, 'plugins', 'clawtalk')
    await mkdir(wsDir, { recursive: true })
    await mkdir(path.join(nativeStateRoot, 'plugins', 'clawtalk'), { recursive: true })
    await writeFile(path.join(wsDir, 'ws.log'), [
      '2026-06-30T08:05:00.000Z <<< {"event":"sms.received","body":"hello secret-zeta"}',
      '2026-06-30T08:06:00.000Z >>> {"event":"sms.reply.sent","reply":"done"}',
      '2026-06-30T08:07:00.000Z --- heartbeat',
      '',
    ].join('\n'))
    const { service } = createService({ stateRoot, nativeStateRoot })

    const entries = await service.readExternalChannelActivityEntries(10)

    assert.equal(entries.length, 2)
    assert.deepEqual(entries.map((entry) => entry.direction), ['outbound', 'inbound'])
    assert.equal(entries.every((entry) => entry.stream === 'channel' && entry.channel === 'clawtalk'), true)
    assert.match(entries[1]?.message ?? '', /SMS received: hello \[redacted]/)
    assert.doesNotMatch(entries[1]?.message ?? '', /secret-zeta/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('activity helpers filter current-start entries, dedupe noisy rows, and expose plugin ids', () => {
  const { service } = createService({
    startedAt: '2026-06-30T08:00:00.000Z',
    clearedAtMs: Date.parse('2026-06-30T08:02:00.000Z'),
  })
  const entries: GatewayLogEntry[] = [
    {
      id: 1,
      timestamp: '2026-06-30T07:59:00.000Z',
      stream: 'gateway',
      message: 'message processed: channel=telegram inbound',
      channel: 'telegram',
      direction: 'inbound',
    },
    {
      id: 2,
      timestamp: '2026-06-30T08:03:00.000Z',
      stream: 'channel',
      message: 'message processed: channel=telegram inbound',
      channel: 'telegram',
      direction: 'inbound',
      source: 'gateway.log',
    },
    {
      id: 3,
      timestamp: '2026-06-30T08:03:01.000Z',
      stream: 'channel',
      message: 'message processed: channel=telegram inbound',
      channel: 'telegram',
      direction: 'inbound',
      source: 'gateway.log',
    },
    {
      id: 4,
      timestamp: '2026-06-30T08:04:00.000Z',
      stream: 'channel',
      message: 'SMS reply sent',
      channel: 'sms',
      direction: 'outbound',
      source: 'gateway.log',
    },
  ]

  const sinceStart = service.gatewayLogEntriesSinceCurrentStart(entries)
  const deduped = service.dedupeGatewayLogEntries(sinceStart)
  const summary = service.summarizeGatewayActivity(deduped)
  const pluginIds = service.runtimeLoadedPluginIdsFromGatewayLogs([
    {
      id: 5,
      timestamp: '2026-06-30T08:05:00.000Z',
      stream: 'stdout',
      message: 'http server listening (3 plugins: clawtalk, telegram, bad id!)',
    },
  ])

  assert.deepEqual(sinceStart.map((entry) => entry.id), [2, 3, 4])
  assert.deepEqual(deduped.map((entry) => entry.id), [4, 3])
  assert.equal(summary.active, true)
  assert.equal(summary.inboundCount, 1)
  assert.equal(summary.outboundCount, 1)
  assert.equal(summary.sourcePath, 'gateway.log')
  assert.deepEqual(Array.from(pluginIds), ['clawtalk', 'telegram'])
})

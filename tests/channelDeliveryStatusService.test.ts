import assert from 'node:assert/strict'
import test from 'node:test'
import type { GatewayLogEntry } from '../server/services/gateway/gatewayLogService'
import { createChannelDeliveryStatusService } from '../server/services/channels/channelDeliveryStatusService'

test('channel reliability projects every configured channel without exposing identities, payloads, or errors', async () => {
  const commands: Array<{ args: string[]; timeoutMs: number }> = []
  const activity: GatewayLogEntry[] = [
    { id: 1, timestamp: '2026-11-17T10:00:00Z', stream: 'channel', channel: 'telegram', direction: 'inbound', message: 'private inbound body secret=abc123' },
    { id: 2, timestamp: '2026-11-17T10:01:00Z', stream: 'channel', channel: 'telegram', direction: 'outbound', message: 'delivery receipt received for +15551234567' },
    { id: 3, timestamp: '2026-11-17T10:02:00Z', stream: 'channel', channel: 'slack', direction: 'outbound', level: 'error', message: 'private Slack message failed for team=automnia' },
    { id: 4, timestamp: '2026-11-17T10:03:00Z', stream: 'channel', channel: 'discord', direction: 'inbound', message: 'private Discord body' },
    { id: 5, timestamp: '2026-11-17T10:04:00Z', stream: 'channel', channel: 'unknown-channel', direction: 'outbound', message: 'stale channel must not become a configured row' },
  ]
  const service = createChannelDeliveryStatusService({
    runOpenClaw: async (args, timeoutMs) => {
      commands.push({ args, timeoutMs })
      if (args[0] === 'channels') return {
        code: 0,
        stdout: JSON.stringify({
          channelOrder: ['telegram', 'slack', 'discord'],
          channelLabels: { telegram: 'Telegram', slack: 'Slack\u001b[31m', discord: 'Discord' },
          channelAccounts: {
            telegram: [{ accountId: 'private-bot-id', configured: true, enabled: true, linked: true, connected: true, activeRuns: 2, lastConnectedAt: 1_794_861_000_000, lastInboundAt: 1_794_861_200_000, lastOutboundAt: 1_794_861_260_000, lastTransportActivityAt: 1_794_861_270_000, lastProbeAt: 1_794_861_280_000 }],
            slack: [{ accountId: 'workspace-owner@example.com', configured: true, enabled: true, connected: false, lifecycle: 'blocked', terminalDisconnect: true, lastError: 'token is private' }],
            discord: [{ accountId: 'discord-private', configured: true, enabled: false, running: true, lifecycle: 'recovering', restartPending: true }],
          },
          statusIssues: [{ channel: 'slack', accountId: 'workspace-owner@example.com', kind: 'auth', message: 'private detail that must not leak' }],
          partial: true,
          warnings: ['private warning that must not leak'],
          eventLoop: { degraded: false },
        }),
      }
      return { code: 0, stdout: 'bot_connected: pass\nwebsocket_server: pass\n', stderr: '' }
    },
    readChannelActivity: async (limit) => {
      assert.equal(limit, 160)
      return activity
    },
    now: () => new Date('2026-11-17T10:05:00Z'),
  })

  const result = await service.getStatus()
  assert.equal(result.checkedAt, '2026-11-17T10:05:00.000Z')
  assert.deepEqual(result.probe, { state: 'partial', partial: true, eventLoopDegraded: false })
  assert.deepEqual(result.totals, {
    channels: 3,
    configuredAccounts: 3,
    connectedAccounts: 1,
    attentionChannels: 1,
    blockedChannels: 1,
    activeRuns: 2,
    observedInbound: 2,
    observedOutbound: 2,
    observedFailures: 1,
  })
  assert.deepEqual(result.channels.map((channel) => channel.id), ['discord', 'slack', 'telegram'])
  assert.deepEqual(result.channels.find((channel) => channel.id === 'telegram'), {
    id: 'telegram',
    label: 'Telegram',
    status: 'connected',
    configuredAccounts: 1,
    enabledAccounts: 1,
    linkedAccounts: 1,
    connectedAccounts: 1,
    blockedAccounts: 0,
    recoveringAccounts: 0,
    activeRuns: 2,
    issueCount: 0,
    lastConnectedAt: '2026-11-16T20:30:00.000Z',
    lastTransportActivityAt: '2026-11-16T20:34:30.000Z',
    lastProbeAt: '2026-11-16T20:34:40.000Z',
    activity: {
      lastInboundObservedAt: '2026-11-17T10:00:00.000Z',
      lastOutboundObservedAt: '2026-11-17T10:01:00.000Z',
      lastObservedAt: '2026-11-17T10:01:00.000Z',
      inboundObservedCount: 1,
      outboundObservedCount: 1,
      failureObservedCount: 0,
      lastFailureObservedAt: null,
    },
    deliveryEvidence: 'provider-confirmed',
  })
  const slack = result.channels.find((channel) => channel.id === 'slack')
  assert.equal(slack?.label, 'Slack [31m')
  assert.equal(slack?.status, 'blocked')
  assert.equal(slack?.issueCount, 1)
  assert.equal(slack?.deliveryEvidence, 'failure-observed')
  assert.equal(slack?.activity.failureObservedCount, 1)
  const discord = result.channels.find((channel) => channel.id === 'discord')
  assert.equal(discord?.status, 'starting')
  assert.equal(discord?.enabledAccounts, 0)
  assert.equal(discord?.recoveringAccounts, 1)
  assert.deepEqual(result.telegram, {
    status: 'connected',
    configuredAccounts: 1,
    connectedAccounts: 1,
    pairing: { status: 'not-queried', pendingCount: null },
  })
  assert.deepEqual(result.clawTalk, { botConnected: 'pass', websocketServer: 'pass' })
  assert.equal(result.deliveryReceiptStatus, 'provider-confirmed-when-reported')
  assert.deepEqual(commands[0], {
    args: ['channels', 'status', '--probe', '--timeout', '10000', '--json'],
    timeoutMs: 25_000,
  })
  assert.deepEqual(commands[1], { args: ['clawtalk', 'doctor'], timeoutMs: 20_000 })
  const exposed = JSON.stringify(result)
  for (const privateValue of ['private inbound body', 'private Slack message', 'abc123', '+15551234567', 'private-bot-id', 'workspace-owner@example.com', 'token is private', 'private detail', 'private warning']) {
    assert.equal(exposed.includes(privateValue), false)
  }
})

test('channel reliability reports Gateway startup without treating it as a failed channel probe', async () => {
  const service = createChannelDeliveryStatusService({
    runOpenClaw: async (args) => args[0] === 'channels'
      ? { code: 0, stdout: JSON.stringify({ status: 'starting', startupPhase: 'loading channel runtime', channelOrder: [], channelLabels: {}, channelAccounts: {} }) }
      : { code: 1, stdout: '', stderr: '' },
    readChannelActivity: async () => [],
  })

  const result = await service.getStatus()
  assert.deepEqual(result.probe, { state: 'starting', partial: false, eventLoopDegraded: null })
  assert.deepEqual(result.channels, [])
  assert.deepEqual(result.totals, {
    channels: 0,
    configuredAccounts: 0,
    connectedAccounts: 0,
    attentionChannels: 0,
    blockedChannels: 0,
    activeRuns: 0,
    observedInbound: 0,
    observedOutbound: 0,
    observedFailures: 0,
  })
  assert.equal(result.telegram.status, 'not-configured')
})

test('channel reliability fails closed when commands or activity readers fail', async () => {
  const commands: string[][] = []
  const service = createChannelDeliveryStatusService({
    runOpenClaw: async (args) => {
      commands.push(args)
      throw new Error('C:\\Users\\private\\state\\credentials.json')
    },
    readChannelActivity: async () => { throw new Error('log path leaked') },
  })

  const result = await service.getStatus()
  assert.equal(result.probe.state, 'unavailable')
  assert.equal(result.telegram.status, 'not-configured')
  assert.equal(result.clawTalk.botConnected, 'unknown')
  assert.equal(result.clawTalk.websocketServer, 'unknown')
  assert.deepEqual(result.channels, [])
  assert.equal(JSON.stringify(result).includes('credentials.json'), false)
  assert.equal(commands.some((args) => args[0] === 'pairing'), false)
})

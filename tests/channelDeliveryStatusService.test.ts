import assert from 'node:assert/strict'
import test from 'node:test'
import type { GatewayLogEntry } from '../server/services/gateway/gatewayLogService'
import { createChannelDeliveryStatusService } from '../server/services/channels/channelDeliveryStatusService'

test('channel status projects bounded health and timestamps without log bodies or pairing codes', async () => {
  const commands: Array<{ args: string[]; timeoutMs: number }> = []
  const activity: GatewayLogEntry[] = [
    { id: 1, timestamp: '2026-11-17T10:00:00Z', stream: 'channel', channel: 'telegram', direction: 'inbound', message: 'private inbound body secret=abc123' },
    { id: 2, timestamp: '2026-11-17T10:01:00Z', stream: 'channel', channel: 'clawtalk', direction: 'inbound', message: 'private ClawTalk body' },
    { id: 3, timestamp: '2026-11-17T10:02:00Z', stream: 'channel', channel: 'telegram', direction: 'outbound', message: 'private outbound body to=+15551234567' },
    { id: 4, timestamp: '2026-11-17T10:02:30Z', stream: 'channel', channel: 'discord', direction: 'inbound', message: 'unrelated later activity' },
  ]
  const service = createChannelDeliveryStatusService({
    runOpenClaw: async (args, timeoutMs) => {
      commands.push({ args, timeoutMs })
      if (args[0] === 'channels') return {
        code: 0,
        stdout: JSON.stringify({ channels: [{ id: 'telegram', accounts: [
          { configured: true, connected: true, botToken: 'token-must-not-leak' },
          { configured: true, connected: false },
        ] }] }),
      }
      return { code: 0, stdout: 'bot_connected: pass\nwebsocket_server: pass\n', stderr: '' }
    },
    readChannelActivity: async (limit) => {
      assert.equal(limit, 80)
      return activity
    },
    now: () => new Date('2026-11-17T10:03:00Z'),
  })

  const result = await service.getStatus()
  assert.equal(result.checkedAt, '2026-11-17T10:03:00.000Z')
  assert.deepEqual(result.telegram, {
    status: 'connected',
    configuredAccounts: 2,
    connectedAccounts: 1,
    pairing: { status: 'not-queried', pendingCount: null },
  })
  assert.deepEqual(result.clawTalk, { botConnected: 'pass', websocketServer: 'pass' })
  assert.deepEqual(result.activity, {
    lastInboundObservedAt: '2026-11-17T10:01:00.000Z',
    lastOutboundObservedAt: '2026-11-17T10:02:00.000Z',
    lastObservedAt: '2026-11-17T10:02:00.000Z',
  })
  assert.equal(result.deliveryReceiptStatus, 'unavailable')
  assert.equal(commands.length, 2)
  assert.deepEqual(commands[0], {
    args: ['channels', 'status', '--channel', 'telegram', '--probe', '--timeout', '10000', '--json'],
    timeoutMs: 15_000,
  })
  assert.deepEqual(commands[1], { args: ['clawtalk', 'doctor'], timeoutMs: 20_000 })
  const exposed = JSON.stringify(result)
  for (const privateValue of ['private inbound body', 'private outbound body', 'abc123', '+15551234567', 'token-must-not-leak']) {
    assert.equal(exposed.includes(privateValue), false)
  }
})

test('channel status degrades safely when probes fail and never requests pairing codes', async () => {
  const commands: string[][] = []
  const service = createChannelDeliveryStatusService({
    runOpenClaw: async (args) => {
      commands.push(args)
      throw new Error('C:\\Users\\private\\state\\credentials.json')
    },
    readChannelActivity: async () => { throw new Error('log path leaked') },
  })

  const result = await service.getStatus()
  assert.equal(result.telegram.status, 'unknown')
  assert.equal(result.telegram.pairing.status, 'not-queried')
  assert.equal(result.clawTalk.botConnected, 'unknown')
  assert.equal(result.clawTalk.websocketServer, 'unknown')
  assert.deepEqual(result.activity, { lastInboundObservedAt: null, lastOutboundObservedAt: null, lastObservedAt: null })
  assert.equal(commands.some((args) => args[0] === 'pairing'), false)
  assert.equal(JSON.stringify(result).includes('credentials.json'), false)
})

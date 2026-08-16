import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGatewayActivityFeedService,
} from '../server/services/runtime/gatewayActivityFeedService'

test('Gateway activity feed reads a bounded durable snapshot and omits cleared rows', async () => {
  const requestedLimits: number[] = []
  const service = createGatewayActivityFeedService({
    now: () => Date.parse('2026-08-15T16:00:00.000Z'),
    readGatewayLedgerSnapshot: async (limit = 120) => {
      requestedLimits.push(limit)
      return {
        entries: [
          {
            id: 2,
            timestamp: '2026-08-15T15:59:58.000Z',
            stream: 'channel',
            channel: 'telegram',
            direction: 'inbound',
            message: 'New message',
          },
          {
            id: 1,
            timestamp: '2026-08-15T15:55:00.000Z',
            stream: 'lifecycle',
            message: 'Cleared entry',
          },
        ],
        restart: null,
        recentRestarts: [],
      }
    },
    dedupeGatewayLogEntries: (entries, limit = 80) => entries.slice(0, limit),
    isRuntimeMonitorEntryVisible: (timestamp) => timestamp !== '2026-08-15T15:55:00.000Z',
  })

  const feed = await service.getGatewayActivityFeed(500)

  assert.deepEqual(requestedLimits, [100])
  assert.equal(feed.storage, 'durable-ledger')
  assert.equal(feed.generatedAt, '2026-08-15T16:00:00.000Z')
  assert.deepEqual(feed.entries.map((entry) => entry.message), ['New message'])
})

test('Gateway activity feed uses a small default window', async () => {
  const requestedLimits: number[] = []
  const service = createGatewayActivityFeedService({
    readGatewayLedgerSnapshot: async (limit = 120) => {
      requestedLimits.push(limit)
      return { entries: [], restart: null, recentRestarts: [] }
    },
    dedupeGatewayLogEntries: (entries) => entries,
    isRuntimeMonitorEntryVisible: () => true,
  })

  await service.getGatewayActivityFeed()

  assert.deepEqual(requestedLimits, [48])
})

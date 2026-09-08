import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { writeBoundedSseEvent } from '../server/services/agents/downstreamSse'

class SlowConsumer extends EventEmitter {
  writableLength = 0
  destroyed = false
  frames: string[] = []
  write(frame: string) { this.frames.push(frame); this.writableLength += Buffer.byteLength(frame); return false }
  destroy() { this.destroyed = true; this.emit('close') }
}
test('slow event consumers are disconnected at a bounded byte budget', () => {
  const consumer = new SlowConsumer()
  for (let index = 0; index < 100; index++) writeBoundedSseEvent(consumer, 'delta', { text: 'x'.repeat(16_000) })
  assert.equal(consumer.destroyed, true)
  assert.ok(consumer.writableLength <= 1024 * 1024)
  assert.ok(consumer.frames.length < 100)
})
test('drain cancels the stall deadline and idle blocked consumers eventually close', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const consumer = new SlowConsumer()
  writeBoundedSseEvent(consumer, 'delta', { text: 'hello', id: 'event-1' })
  assert.match(consumer.frames[0], /^id: event-1\nevent: delta\ndata: /)
  consumer.writableLength = 0
  consumer.emit('drain')
  assert.equal(consumer.listenerCount('close'), 0)
  context.mock.timers.tick(15_000)
  assert.equal(consumer.destroyed, false)
  writeBoundedSseEvent(consumer, 'delta', { text: 'later' })
  context.mock.timers.tick(15_000)
  assert.equal(consumer.destroyed, true)
})

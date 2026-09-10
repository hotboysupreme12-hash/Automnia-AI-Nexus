import assert from 'node:assert/strict'
import test from 'node:test'
import { startForegroundPolling } from '../src/utils/foregroundPolling'

class Visibility extends EventTarget {
  hidden = false
  setHidden(hidden: boolean) { this.hidden = hidden; this.dispatchEvent(new Event('visibilitychange')) }
}
const settle = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve() }

test('hidden windows stop polling and resume without overlapping requests', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const visibility = new Visibility()
  visibility.hidden = true
  const signals: AbortSignal[] = []
  const stop = startForegroundPolling(async (signal) => {
    signals.push(signal)
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  }, 2000, visibility)
  assert.equal(signals.length, 0)
  visibility.setHidden(false)
  assert.equal(signals.length, 1)
  visibility.setHidden(false)
  context.mock.timers.tick(10000)
  assert.equal(signals.length, 1)
  visibility.setHidden(true)
  assert.equal(signals[0].aborted, true)
  await settle()
  context.mock.timers.tick(60000)
  assert.equal(signals.length, 1)
  visibility.setHidden(false)
  assert.equal(signals.length, 2)
  stop()
  assert.equal(signals[1].aborted, true)
  await settle()
  visibility.setHidden(false)
  context.mock.timers.tick(60000)
  assert.equal(signals.length, 2)
})

test('failed polls recover and completed polls wait before requesting again', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const visibility = new Visibility()
  let calls = 0
  const stop = startForegroundPolling(async () => { calls += 1; if (calls === 1) throw new Error('offline') }, 2000, visibility)
  await settle()
  context.mock.timers.tick(1999)
  assert.equal(calls, 1)
  context.mock.timers.tick(1)
  assert.equal(calls, 2)
  await settle()
  stop()
  context.mock.timers.tick(60000)
  assert.equal(calls, 2)
})

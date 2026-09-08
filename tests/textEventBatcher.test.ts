import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextEventBatcher } from '../src/store/textEventBatcher'

type Frame = { run: string; event: string; text: string; replace?: boolean }
test('token bursts publish once, while final flushes its own lane in order', () => {
  const frames: Frame[] = []
  const batch = createTextEventBatcher<Frame>((frame) => frames.push(frame), (frame) => frame.run)
  for (let i = 0; i < 1000; i++) batch.push({ run: 'a', event: 'delta', text: 'x' })
  batch.push({ run: 'b', event: 'delta', text: 'other' })
  assert.equal(frames.length, 0)
  batch.push({ run: 'a', event: 'final', text: '' })
  assert.deepEqual(frames.map((frame) => [frame.run, frame.event, frame.text.length]), [['a', 'delta', 1000], ['a', 'final', 0]])
  batch.flush()
  assert.equal(frames[2].text, 'other')
})
test('replacement discards earlier deltas, accepts subsequent text, and clearing prevents resurrection', () => {
  const frames: Frame[] = []
  const batch = createTextEventBatcher<Frame>((frame) => frames.push(frame), (frame) => frame.run)
  batch.push({ run: 'a', event: 'delta', text: 'discard' })
  batch.push({ run: 'a', event: 'delta', text: 'new', replace: true })
  batch.push({ run: 'a', event: 'delta', text: ' answer' })
  batch.flush()
  assert.equal(frames[0].text, 'new answer')
  assert.equal(frames[0].replace, true)
  batch.push({ run: 'a', event: 'delta', text: 'stale' })
  batch.clear()
  batch.flush()
  assert.equal(frames.length, 1)
})

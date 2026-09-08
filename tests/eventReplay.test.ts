import assert from 'node:assert/strict'
import test from 'node:test'
import { replayAfterCursor } from '../server/services/agents/eventReplay'

test('event replay resumes strictly after the cursor in original order', () => {
  const events = [{ id: 'c' }, { id: 'b' }, { id: 'a' }]
  assert.deepEqual(replayAfterCursor(events, 'a'), { events: [{ id: 'b' }, { id: 'c' }], gap: false })
  assert.deepEqual(replayAfterCursor(events, 'c'), { events: [], gap: false })
  assert.deepEqual(replayAfterCursor(events, 'expired'), { events: [...events].reverse(), gap: true })
  assert.equal(replayAfterCursor(events).gap, false)
  assert.deepEqual(events.map((event) => event.id), ['c', 'b', 'a'])
})

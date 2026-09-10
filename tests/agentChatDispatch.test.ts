import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchAgentChat } from '../src/store/agentChatDispatch'
import { readConsolePreferences, saveConsolePreferences } from '../src/components/settings/workspaceSettings'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('parallel chat starts the second agent before the first finishes', async () => {
  const first = deferred()
  const started: string[] = []
  const finished: string[] = []
  const work = dispatchAgentChat(['a', 'b'], true, async (id) => {
    started.push(id)
    if (id === 'a') await first.promise
    finished.push(id)
  })
  assert.deepEqual(started, ['a', 'b'])
  assert.deepEqual(finished, ['b'])
  first.resolve()
  await work
  assert.deepEqual(finished, ['b', 'a'])
})

test('turning parallel chat off waits for the preceding agent', async () => {
  const first = deferred()
  const started: string[] = []
  const work = dispatchAgentChat(['a', 'b'], false, async (id) => {
    started.push(id)
    if (id === 'a') await first.promise
  })
  assert.deepEqual(started, ['a'])
  first.resolve()
  await work
  assert.deepEqual(started, ['a', 'b'])
})

test('one rejected parallel agent does not prevent the other from completing', async () => {
  const finished: string[] = []
  await dispatchAgentChat(['a', 'b'], true, async (id) => {
    if (id === 'a') throw new Error('Agent unavailable')
    finished.push(id)
  })
  assert.deepEqual(finished, ['b'])
})

test('sequential cancellation stops later dispatches', async () => {
  const started: string[] = []
  await dispatchAgentChat(['a', 'b'], false, async (id) => {
    started.push(id)
    return { cancelled: true }
  })
  assert.deepEqual(started, ['a'])
})

test('parallel chat defaults off and preference changes affect subsequent reads', () => {
  assert.equal(readConsolePreferences().parallelAgentChat, false)
  saveConsolePreferences({ ...readConsolePreferences(), parallelAgentChat: false })
  assert.equal(readConsolePreferences().parallelAgentChat, false)
  saveConsolePreferences({ ...readConsolePreferences(), parallelAgentChat: true })
  assert.equal(readConsolePreferences().parallelAgentChat, true)
})

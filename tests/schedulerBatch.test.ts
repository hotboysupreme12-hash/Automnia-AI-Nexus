import assert from 'node:assert/strict'
import test from 'node:test'
import { stopScheduledTaskBatch } from '../src/components/monitor/schedulerBatch'

test('batch stop attempts later tasks after failure and retries only failures', async () => {
  const tasks = ['first', 'second', 'third'].map((id) => ({ id, name: id }))
  const attempted: string[] = []
  const result = await stopScheduledTaskBatch(tasks, async (task) => {
    attempted.push(task.id)
    if (task.id === 'first') throw new Error('Gateway refused stop')
  })
  assert.deepEqual(attempted, ['first', 'second', 'third'])
  assert.deepEqual(result.stopped.map((task) => task.id), ['second', 'third'])
  assert.deepEqual(result.failed, [{ task: tasks[0], message: 'Gateway refused stop' }])
  const retry = await stopScheduledTaskBatch(result.failed.map(({ task }) => task), async (task) => { attempted.push(task.id) })
  assert.deepEqual(retry.stopped.map((task) => task.id), ['first'])
  assert.deepEqual(retry.failed, [])
  assert.deepEqual(attempted, ['first', 'second', 'third', 'first'])
})

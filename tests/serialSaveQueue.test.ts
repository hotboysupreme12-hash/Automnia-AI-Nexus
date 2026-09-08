import assert from 'node:assert/strict'
import test from 'node:test'
import { createSerialSaveQueue } from '../src/components/monitor/serialSaveQueue'

test('newer saves wait for slow older writes and remain usable after failures', async () => {
  const save = createSerialSaveQueue()
  const writes: string[] = []
  let finishFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { finishFirst = resolve })
  const first = save(async () => { await firstGate; writes.push('old') })
  const second = save(async () => { writes.push('new') })
  await Promise.resolve()
  assert.deepEqual(writes, [])
  finishFirst()
  await Promise.all([first, second])
  assert.deepEqual(writes, ['old', 'new'])
  const failed = save(async () => { throw new Error('offline') })
  const recovered = save(async () => { writes.push('recovered') })
  await assert.rejects(failed, /offline/)
  await recovered
  assert.deepEqual(writes, ['old', 'new', 'recovered'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIdempotentShiftService, ShiftCreationUnconfirmed } from '../server/services/runtime/idempotentShiftService'
import type { Shift, StartShiftPayload } from '../server/shiftContracts'

const input: StartShiftPayload = { idempotencyKey: 'request-123', name: 'Research', agent: 'a', message: 'Read the brief', every: '1m' }
const shift: Shift = { id: 'shift-123', name: 'Research', agent: 'a', message: input.message, every: '1m', durationMinutes: 10, cronId: '', startedAt: '2026-09-07T12:00:00Z', endsAt: null }
async function setup(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'automnia-shift-idempotency-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let dispatches = 0
  let found: string | null = null
  let loseAck = false
  const options = {
    directory,
    prepare: async () => ({ shift, args: ['cron', 'add'] }),
    dispatch: async () => { dispatches++; if (loseAck) throw new Error('lost acknowledgement'); return 'cron-123' },
    reconcile: async () => found,
    activate: () => undefined,
  }
  return { options, count: () => dispatches, lose: (existing: string | null) => { loseAck = true; found = existing } }
}
test('concurrent requests and completed receipts after restart create one scheduled job', async (t) => {
  const fixture = await setup(t)
  const service = createIdempotentShiftService(fixture.options)
  const results = await Promise.all(Array.from({ length: 12 }, () => service.create(input)))
  assert.equal(fixture.count(), 1)
  assert.ok(results.every((result) => result.cronId === 'cron-123'))
  const restart = createIdempotentShiftService(fixture.options)
  assert.equal((await restart.create(input)).id, shift.id)
  assert.equal(fixture.count(), 1)
  await assert.rejects(restart.create({ ...input, message: 'different work' }), ShiftCreationUnconfirmed)
})
test('a lost acknowledgement reconciles the created cron job without another add command', async (t) => {
  const fixture = await setup(t)
  fixture.lose('recovered-cron')
  const service = createIdempotentShiftService(fixture.options)
  assert.equal((await service.create(input)).cronId, 'recovered-cron')
  assert.equal(fixture.count(), 1)
})
test('an unconfirmed creation remains protected across retries and restart, then recovers', async (t) => {
  const fixture = await setup(t)
  fixture.lose(null)
  await assert.rejects(createIdempotentShiftService(fixture.options).create(input), ShiftCreationUnconfirmed)
  const restart = createIdempotentShiftService(fixture.options)
  await assert.rejects(restart.create(input), ShiftCreationUnconfirmed)
  assert.equal(fixture.count(), 1)
  fixture.lose('eventually-visible-cron')
  assert.equal((await restart.create(input)).cronId, 'eventually-visible-cron')
  assert.equal(fixture.count(), 1)
})
test('a truncated durable receipt fails closed and cannot cause a second job', async (t) => {
  const fixture = await setup(t)
  await createIdempotentShiftService(fixture.options).create(input)
  const [file] = await fs.readdir(fixture.options.directory)
  await fs.writeFile(path.join(fixture.options.directory, file), '{')
  await assert.rejects(createIdempotentShiftService(fixture.options).create(input), ShiftCreationUnconfirmed)
  assert.equal(fixture.count(), 1)
})

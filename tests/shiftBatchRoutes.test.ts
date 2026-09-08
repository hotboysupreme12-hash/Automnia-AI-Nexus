import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import { registerShiftRoutes } from '../server/routes/shiftRoutes'
import type { Shift } from '../server/shiftContracts'

async function batchRequest(failCreate: boolean, failCoordination: boolean) {
  const app = express()
  app.use(express.json())
  const created: Shift[] = [], attempted: string[] = []
  registerShiftRoutes(app, {
    activeShifts: new Map(), clearShiftRuntimeState: () => undefined,
    createShiftFromPayload: async (input) => {
      attempted.push(input.agent || '')
      if (failCreate && input.agent === 'b') throw Object.assign(new Error('entitlement changed'), { statusCode: 403 })
      const shift: Shift = { ...input, id: `shift-${input.agent}`, cronId: `cron-${input.agent}`, agent: input.agent || '', every: input.every || '1m', durationMinutes: 10, startedAt: new Date().toISOString(), endsAt: null }
      created.push(shift)
      return shift
    },
    invalidateRuntimeStatusCache: () => undefined, isValidAgentId: () => true,
    listActiveCronJobViews: () => ({ active: [] }), mergeHeartbeatRuntimeDefaults: (base) => base,
    readHeartbeatRuntimeDefaults: async () => ({ model: 'fixture/model', thinking: 'low', timeoutSeconds: 300, wake: 'now', session: 'main', announce: false, leadAgent: 'a' }),
    readHeartbeatRuntimePerAgent: async () => ({}), runOpenClaw: async () => ({ stdout: '', stderr: '', code: 0 }),
    startManagedTeamSyncOrchestrator: async () => { if (failCoordination) throw new Error('injected orchestrator failure') },
    sweepExpiredMissionCronJobs: async () => undefined, writeHeartbeatRuntimeDefaults: async () => undefined,
    writeHeartbeatRuntimePerAgent: async () => undefined,
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shifts/start-batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: ['a', 'b', 'c'], every: '1m', managedTeamSync: true }),
    })
    return { status: response.status, payload: await response.json(), created, attempted }
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

test('batch entitlement loss retains created IDs and explicitly lists every unstarted agent', async () => {
  const { status, payload, created, attempted } = await batchRequest(true, false)
  assert.equal(status, 200)
  assert.deepEqual(attempted, ['a', 'b'])
  assert.equal(created.length, 1)
  assert.equal(payload.data.outcome, 'partial')
  assert.equal(payload.data.startedCount, 1)
  assert.equal(payload.data.failedCount, 2)
  assert.deepEqual(payload.data.unstartedAgentIds, ['b', 'c'])
  assert.deepEqual(payload.data.shifts.map((shift: Shift) => shift.id), ['shift-a'])
  assert.equal(payload.data.managedTeamSync, false)
})

test('failed coordination never reports managed mode as running and explains created-job policy', async () => {
  const { status, payload, created } = await batchRequest(false, true)
  assert.equal(status, 200)
  assert.equal(created.length, 3)
  assert.equal(payload.data.managedTeamSync, false)
  assert.equal(payload.data.orchestration.status, 'not_started')
  assert.equal(payload.data.orchestration.jobPolicy, 'preserve-created-jobs')
  assert.deepEqual(payload.data.orchestration.affectedShiftIds, ['shift-a', 'shift-b', 'shift-c'])
  assert.match(payload.data.orchestration.detail, /failed to start/)
  assert.equal(payload.data.outcome, 'partial')
})

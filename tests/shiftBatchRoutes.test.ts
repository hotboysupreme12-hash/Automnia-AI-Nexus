import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import {
  buildStaggeredCronExpression,
  isValidAtScheduleValue,
  isValidCronScheduleExpression,
  normalizeAtScheduleValue,
  normalizeCronScheduleExpression,
  registerShiftRoutes,
} from '../server/routes/shiftRoutes'
import type { RuntimeCronJobSummary, Shift, StartShiftPayload } from '../server/shiftContracts'

async function withShiftTestServer<T>(
  overrides: {
    failCreateOnAgent?: string
    failCoordination?: boolean
    activeShifts?: Map<string, Shift>
    extraListedJobs?: RuntimeCronJobSummary[]
    onCreateShift?: (input: StartShiftPayload) => void
    onOpenClaw?: (args: string[]) => { stdout: string; stderr: string; code: number }
    isValidAgentId?: (agentId: string) => boolean
  },
  run: (baseUrl: string, state: { created: Shift[]; attempted: string[]; inputs: StartShiftPayload[]; openClawCalls: string[][] }) => Promise<T>,
): Promise<T> {
  const app = express()
  app.use(express.json())
  const created: Shift[] = []
  const attempted: string[] = []
  const inputs: StartShiftPayload[] = []
  const openClawCalls: string[][] = []
  const activeShifts = overrides.activeShifts || new Map<string, Shift>()

  registerShiftRoutes(app, {
    activeShifts,
    clearShiftRuntimeState: () => undefined,
    createShiftFromPayload: async (input) => {
      inputs.push(input)
      overrides.onCreateShift?.(input)
      attempted.push(input.agent || '')
      if (overrides.failCreateOnAgent && input.agent === overrides.failCreateOnAgent) {
        throw Object.assign(new Error('entitlement changed'), { statusCode: 403 })
      }
      const shift: Shift = {
        ...input,
        id: `shift-${input.agent || 'default'}`,
        cronId: `cron-${input.agent || 'default'}`,
        agent: input.agent || 'a',
        every: input.schedule || input.every || '1m',
        scheduleKind: input.scheduleKind || 'every',
        scheduleLabel: input.schedule || input.every || '1m',
        durationMinutes: input.durationMinutes || 10,
        startedAt: new Date().toISOString(),
        endsAt: null,
      }
      activeShifts.set(shift.id, shift)
      created.push(shift)
      return shift
    },
    invalidateRuntimeStatusCache: () => undefined,
    isValidAgentId: overrides.isValidAgentId || ((agentId) => /^[a-z0-9-]+$/i.test(agentId)),
    listActiveCronJobViews: () => ({
      active: [
        ...Array.from(activeShifts.values()).map((shift) => ({
          ...shift,
          source: 'control-center' as const,
          status: 'active',
        })),
        ...(overrides.extraListedJobs || []),
      ],
    }),
    mergeHeartbeatRuntimeDefaults: (base, patch) => ({ ...base, ...(patch || {}) }),
    readHeartbeatRuntimeDefaults: async () => ({
      model: 'fixture/model',
      thinking: 'low',
      timeoutSeconds: 300,
      wake: 'now',
      session: 'main',
      announce: false,
      leadAgent: 'a',
    }),
    readHeartbeatRuntimePerAgent: async () => ({}),
    runOpenClaw: async (args) => {
      openClawCalls.push(args)
      return overrides.onOpenClaw ? overrides.onOpenClaw(args) : { stdout: '', stderr: '', code: 0 }
    },
    startManagedTeamSyncOrchestrator: async () => {
      if (overrides.failCoordination) throw new Error('injected orchestrator failure')
    },
    sweepExpiredMissionCronJobs: async () => undefined,
    writeHeartbeatRuntimeDefaults: async () => undefined,
    writeHeartbeatRuntimePerAgent: async () => undefined,
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return await run(baseUrl, { created, attempted, inputs, openClawCalls })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

async function batchRequest(failCreate: boolean, failCoordination: boolean) {
  return withShiftTestServer(
    { failCreateOnAgent: failCreate ? 'b' : undefined, failCoordination },
    async (baseUrl, { created, attempted }) => {
      const response = await fetch(`${baseUrl}/api/shifts/start-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: ['a', 'b', 'c'], every: '1m', managedTeamSync: true }),
      })
      return { status: response.status, payload: await response.json(), created, attempted }
    },
  )
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

test('--at schedule validator and normalizer enforce strict ISO-8601 calendar bounds and relative offsets', () => {
  assert.equal(isValidAtScheduleValue('+15m'), true)
  assert.equal(normalizeAtScheduleValue('  15M  '), '+15m')
  assert.equal(normalizeAtScheduleValue('+365d'), '+365d')
  assert.equal(normalizeAtScheduleValue('2026-06-22 12:30:45.250-04:00'), '2026-06-22T12:30:45.250-04:00')
  assert.equal(isValidAtScheduleValue('2024-02-29T00:00:00Z'), true)
  assert.equal(isValidAtScheduleValue('2026-11-26'), true)

  assert.equal(isValidAtScheduleValue(''), false)
  assert.equal(isValidAtScheduleValue('   '), false)
  assert.equal(isValidAtScheduleValue('-15m'), false)
  assert.equal(isValidAtScheduleValue('--delete'), false)
  assert.equal(isValidAtScheduleValue('+0m'), false)
  assert.equal(isValidAtScheduleValue('0s'), false)
  assert.equal(isValidAtScheduleValue('2026-02-29T12:00:00Z'), false)
  assert.equal(isValidAtScheduleValue('2026-02-31T12:00:00Z'), false)
  assert.equal(isValidAtScheduleValue('2026-04-31T08:00:00Z'), false)
  assert.equal(isValidAtScheduleValue('2026-13-01T00:00:00Z'), false)
  assert.equal(isValidAtScheduleValue('2026-06-22T24:00:00Z'), false)
  assert.equal(isValidAtScheduleValue('2026-06-22T12:00:00+25:00'), false)
  assert.equal(isValidAtScheduleValue('2026-06-22T12:00:00Z\n--system-event'), false)
})

test('cron schedule validator blocks CLI flag injection and enforces 5/6-field bounds', () => {
  assert.equal(isValidCronScheduleExpression('0,20,40 * * * *'), true)
  assert.equal(isValidCronScheduleExpression('7,27,47 * * * *'), true)
  assert.equal(isValidCronScheduleExpression('14,34,54 * * * *'), true)
  assert.equal(isValidCronScheduleExpression('*/15 9-17 * * MON-FRI'), true)
  assert.equal(isValidCronScheduleExpression('0 0 12 L * ?'), true)
  assert.equal(isValidCronScheduleExpression('0 9 * * 1#2'), true)
  assert.equal(normalizeCronScheduleExpression('  @Hourly  '), '@hourly')
  assert.equal(normalizeCronScheduleExpression('  0,20,40   *  * *   * '), '0,20,40 * * * *')

  assert.equal(isValidCronScheduleExpression('--help * * * *'), false)
  assert.equal(isValidCronScheduleExpression('-v * * * *'), false)
  assert.equal(isValidCronScheduleExpression('* * * * -'), false)
  assert.equal(isValidCronScheduleExpression('1--5 * * * *'), false)
  assert.equal(isValidCronScheduleExpression('*/0 * * * *'), false)
  assert.equal(isValidCronScheduleExpression('*/65 * * * *'), false)
  assert.equal(isValidCronScheduleExpression('60 * * * *'), false)
  assert.equal(isValidCronScheduleExpression('0 24 * * *'), false)
  assert.equal(isValidCronScheduleExpression('0 0 32 * *'), false)
  assert.equal(isValidCronScheduleExpression('0 0 * 13 *'), false)
  assert.equal(isValidCronScheduleExpression('0 0 * * 8'), false)
  assert.equal(isValidCronScheduleExpression('10-5 * * * *'), false)
  assert.equal(isValidCronScheduleExpression('FOO * * * *'), false)
})

test('buildStaggeredCronExpression produces deterministic team stagger slots and rejects invalid inputs', () => {
  assert.equal(buildStaggeredCronExpression('20m', 0, 3), '0,20,40 * * * *')
  assert.equal(buildStaggeredCronExpression('20m', 1, 3), '7,27,47 * * * *')
  assert.equal(buildStaggeredCronExpression('20m', 2, 3), '14,34,54 * * * *')

  assert.equal(buildStaggeredCronExpression('2h', 0, 3), '0 */2 * * *')
  assert.equal(buildStaggeredCronExpression('2h', 1, 3), '20 */2 * * *')
  assert.equal(buildStaggeredCronExpression('120m', 2, 3), '40 */2 * * *')

  assert.equal(buildStaggeredCronExpression('30m', 1, 2, 12), '12,42 * * * *')
  assert.equal(buildStaggeredCronExpression('45m', 0, 3), null)
  assert.equal(buildStaggeredCronExpression('20m', Number.NaN, 3), null)
  assert.equal(buildStaggeredCronExpression('20m', 0, Number.NaN), null)
  assert.equal(buildStaggeredCronExpression('20m', 0, 3, 0), null)
  assert.equal(buildStaggeredCronExpression('20m', 0, 3, 60), null)
})

test('start-batch staggers multi-agent every intervals while respecting per-agent schedule overrides', async () => {
  await withShiftTestServer({}, async (baseUrl, { inputs }) => {
    const response = await fetch(`${baseUrl}/api/shifts/start-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        namePrefix: 'AutomniaShift',
        agentIds: ['hn-coordinator', 'hn-architect', 'engineering-senior-developer'],
        every: '20m',
        stagger: true,
        agentOverrides: {
          ' engineering-senior-developer ': {
            scheduleKind: 'at',
            schedule: '  2026-11-26 23:45:00Z  ',
          },
        },
      }),
    })
    assert.equal(response.status, 200)
    assert.equal(inputs.length, 3)
    assert.deepEqual(
      inputs.map((entry) => ({
        agent: entry.agent,
        scheduleKind: entry.scheduleKind,
        schedule: entry.schedule,
      })),
      [
        { agent: 'hn-coordinator', scheduleKind: 'cron', schedule: '0,20,40 * * * *' },
        { agent: 'hn-architect', scheduleKind: 'cron', schedule: '7,27,47 * * * *' },
        { agent: 'engineering-senior-developer', scheduleKind: 'at', schedule: '2026-11-26T23:45:00Z' },
      ],
    )
  })
})

test('start-batch inherits batch scheduleKind for per-agent schedule overrides and rejects duplicate trimmed override keys', async () => {
  await withShiftTestServer({}, async (baseUrl, { inputs }) => {
    const okRes = await fetch(`${baseUrl}/api/shifts/start-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentIds: ['a', 'b'],
        scheduleKind: 'at',
        schedule: '15m',
        agentOverrides: {
          b: { schedule: '2026-11-27 01:00:00Z' },
        },
      }),
    })
    assert.equal(okRes.status, 200)
    assert.deepEqual(
      inputs.map((entry) => ({ agent: entry.agent, scheduleKind: entry.scheduleKind, schedule: entry.schedule })),
      [
        { agent: 'a', scheduleKind: 'at', schedule: '+15m' },
        { agent: 'b', scheduleKind: 'at', schedule: '2026-11-27T01:00:00Z' },
      ],
    )

    const dupRes = await fetch(`${baseUrl}/api/shifts/start-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentIds: ['a', 'b'],
        every: '20m',
        agentOverrides: {
          a: { every: '10m' },
          ' a ': { every: '15m' },
        },
      }),
    })
    assert.equal(dupRes.status, 400)
  })
})

test('start and update routes normalize valid --at/--cron schedules and block malformed or CLI-flag payloads', async () => {
  const existingShift: Shift = {
    id: 'shift-1',
    name: 'Existing',
    agent: 'a',
    every: '20m',
    scheduleKind: 'every',
    scheduleLabel: '20m',
    durationMinutes: 60,
    message: 'Check status',
    cronId: 'cron-1',
    startedAt: new Date().toISOString(),
    endsAt: null,
  }
  const activeShifts = new Map<string, Shift>([[existingShift.id, existingShift]])

  await withShiftTestServer({ activeShifts }, async (baseUrl, { inputs, openClawCalls }) => {
    for (const badStart of [
      { name: '--help', every: '10m', message: 'Valid instruction' },
      { name: 'Shift', scheduleKind: 'cron', schedule: '--help * * * *', message: 'Valid instruction' },
      { name: 'Shift', scheduleKind: 'at', schedule: '2026-02-31T12:00:00Z', message: 'Valid instruction' },
      { name: 'Shift', every: '10m', model: '--inject', message: 'Valid instruction' },
    ]) {
      const res = await fetch(`${baseUrl}/api/shifts/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(badStart),
      })
      assert.equal(res.status, 400)
    }
    assert.equal(inputs.length, 0)

    const goodStart = await fetch(`${baseUrl}/api/shifts/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '  Precision Wake  ',
        agent: 'a',
        scheduleKind: 'at',
        schedule: '  2026-11-27 04:15:00Z ',
        message: '- Read TEAM_SYNC.md and execute assigned task.',
      }),
    })
    assert.equal(goodStart.status, 200)
    assert.equal(inputs[0].name, 'Precision Wake')
    assert.equal(inputs[0].scheduleKind, 'at')
    assert.equal(inputs[0].schedule, '2026-11-27T04:15:00Z')

    const badUpdate = await fetch(`${baseUrl}/api/shifts/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shiftId: 'shift-1',
        scheduleKind: 'at',
        schedule: '-20m',
      }),
    })
    assert.equal(badUpdate.status, 400)
    assert.equal(openClawCalls.length, 0)

    const goodUpdate = await fetch(`${baseUrl}/api/shifts/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shiftId: 'shift-1',
        name: '  Updated Shift ',
        scheduleKind: 'at',
        schedule: ' 25m ',
        message: '- Execute checklist item and report.',
      }),
    })
    assert.equal(goodUpdate.status, 200)
    assert.deepEqual(openClawCalls[0], [
      'cron',
      'edit',
      'cron-1',
      '--name',
      'Updated Shift',
      '--at',
      '+25m',
      '--message',
      '- Execute checklist item and report.',
    ])
    assert.equal(activeShifts.get('shift-1')?.scheduleKind, 'at')
    assert.equal(activeShifts.get('shift-1')?.scheduleLabel, '+25m')
  })
})

test('stop, run, and update routes reject read-only OS system-cron jobs and system-owned manual triggers before spawning CLI', async () => {
  const extraListedJobs: RuntimeCronJobSummary[] = [
    {
      id: 'system-cron-abc123def456',
      cronId: 'system-cron-abc123def456',
      source: 'system-cron',
      status: 'active',
      name: 'Nightly backup',
      agent: 'system',
      every: '1d',
      durationMinutes: 0,
      message: '/usr/local/bin/backup.sh',
      startedAt: new Date().toISOString(),
      endsAt: null,
      nextRunAt: null,
      scheduleKind: 'cron',
      scheduleLabel: '0 0 * * *',
    },
    {
      id: 'cron:internal-heartbeat',
      cronId: 'internal-heartbeat',
      source: 'openclaw',
      status: 'active',
      name: 'Heartbeat Monitor',
      agent: 'hn-coordinator',
      every: '15m',
      durationMinutes: 60,
      message: 'System heartbeat',
      startedAt: new Date().toISOString(),
      endsAt: null,
      nextRunAt: null,
      systemOwned: true,
    },
  ]

  await withShiftTestServer({ extraListedJobs }, async (baseUrl, { openClawCalls }) => {
    for (const [endpoint, body] of [
      ['/api/shifts/stop', { shiftId: 'system-cron-abc123def456' }],
      ['/api/shifts/run', { shiftId: 'system-cron-abc123def456' }],
      ['/api/shifts/update', { shiftId: 'system-cron-abc123def456', name: 'Edited' }],
      ['/api/shifts/run', { shiftId: 'cron:internal-heartbeat' }],
    ] as const) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 400)
      const json = await response.json()
      assert.equal(json.ok, false)
      assert.equal(json.error.code, 'invalid_payload')
    }
    assert.equal(openClawCalls.length, 0)
  })
})

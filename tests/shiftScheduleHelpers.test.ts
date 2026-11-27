import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStaggeredCronExpression } from '../server/routes/shiftRoutes'
import {
  buildClientStaggeredCronExpression,
  canRunShiftNow,
  canStopShiftInControlCenter,
  computeTeamStaggerPreview,
  formatShiftScheduleSummary,
  validateClientShiftSchedule,
} from '../src/components/monitor/shiftScheduleHelpers'

test('validateClientShiftSchedule validates and normalizes every, cron, and at schedule modes', () => {
  assert.deepEqual(validateClientShiftSchedule('every', '  20M '), {
    valid: true,
    normalized: '20m',
  })
  assert.equal(validateClientShiftSchedule('every', '0m').valid, false)
  assert.equal(validateClientShiftSchedule('every', '--every').valid, false)

  assert.deepEqual(validateClientShiftSchedule('cron', '  0,20,40   * * * * '), {
    valid: true,
    normalized: '0,20,40 * * * *',
  })
  assert.deepEqual(validateClientShiftSchedule('cron', ' @Daily '), {
    valid: true,
    normalized: '@daily',
  })
  assert.equal(validateClientShiftSchedule('cron', '0 0 12 L * ?').valid, true)
  assert.equal(validateClientShiftSchedule('cron', '0 9 * * MON#2').valid, true)
  assert.equal(validateClientShiftSchedule('cron', '--help * * * *').valid, false)
  assert.equal(validateClientShiftSchedule('cron', '60 * * * *').valid, false)

  assert.deepEqual(validateClientShiftSchedule('at', ' 15M '), {
    valid: true,
    normalized: '+15m',
  })
  assert.deepEqual(validateClientShiftSchedule('at', '2026-11-27 04:00:00Z'), {
    valid: true,
    normalized: '2026-11-27T04:00:00Z',
  })
  assert.equal(validateClientShiftSchedule('at', '2024-02-29T00:00:00Z').valid, true)
  assert.equal(validateClientShiftSchedule('at', '2026-02-29T00:00:00Z').valid, false)
  assert.equal(validateClientShiftSchedule('at', '-15m').valid, false)
  assert.equal(validateClientShiftSchedule('at', '2026-11-27T24:00:00Z').valid, false)
})

test('buildClientStaggeredCronExpression stays in lockstep parity with server buildStaggeredCronExpression', () => {
  const cases: Array<[string, number, number, number | undefined]> = [
    ['20m', 0, 3, undefined],
    ['20m', 1, 3, undefined],
    ['20m', 2, 3, undefined],
    ['2h', 0, 3, undefined],
    ['2h', 1, 3, undefined],
    ['120m', 2, 3, undefined],
    ['30m', 1, 2, 12],
    ['45m', 0, 3, undefined],
    ['1d', 0, 3, undefined],
    ['20m', 0, 3, 0],
    ['20m', 0, 3, 60],
  ]

  for (const [interval, agentIndex, agentCount, staggerMinutes] of cases) {
    assert.equal(
      buildClientStaggeredCronExpression(interval, agentIndex, agentCount, staggerMinutes),
      buildStaggeredCronExpression(interval, agentIndex, agentCount, staggerMinutes),
      `Mismatch for interval=${interval} idx=${agentIndex} count=${agentCount} offset=${String(staggerMinutes)}`,
    )
  }
})

test('computeTeamStaggerPreview produces staggered cron slots and falls back cleanly for non-divisible intervals', () => {
  const staggered = computeTeamStaggerPreview({
    agentIds: ['hn-coordinator', 'hn-architect', 'engineering-senior-developer'],
    leadAgent: 'hn-coordinator',
    leadEvery: '20m',
    workerEvery: '20m',
    stagger: true,
  })
  assert.deepEqual(staggered, [
    {
      agentId: 'hn-coordinator',
      isLead: true,
      scheduleKind: 'cron',
      schedule: '0,20,40 * * * *',
      staggered: true,
    },
    {
      agentId: 'hn-architect',
      isLead: false,
      scheduleKind: 'cron',
      schedule: '7,27,47 * * * *',
      staggered: true,
    },
    {
      agentId: 'engineering-senior-developer',
      isLead: false,
      scheduleKind: 'cron',
      schedule: '14,34,54 * * * *',
      staggered: true,
    },
  ])

  const fallback = computeTeamStaggerPreview({
    agentIds: ['hn-coordinator', 'hn-architect'],
    leadAgent: 'hn-architect',
    leadEvery: '45m',
    workerEvery: '30m',
    stagger: true,
  })
  assert.deepEqual(fallback, [
    {
      agentId: 'hn-coordinator',
      isLead: false,
      scheduleKind: 'cron',
      schedule: '0,30 * * * *',
      staggered: true,
    },
    {
      agentId: 'hn-architect',
      isLead: true,
      scheduleKind: 'every',
      schedule: '45m',
      staggered: false,
    },
  ])
})

test('formatShiftScheduleSummary and system-cron guards enforce read-only OS crontab behavior', () => {
  assert.equal(
    formatShiftScheduleSummary({ every: '20m', scheduleKind: 'cron', scheduleLabel: '0,20,40 * * * *' }),
    'Cron: 0,20,40 * * * *',
  )
  assert.equal(
    formatShiftScheduleSummary({ every: '+15m', scheduleKind: 'at', scheduleLabel: '+15m' }),
    'At: +15m',
  )
  assert.equal(
    formatShiftScheduleSummary({ every: '30m', scheduleKind: 'every' }),
    'Every: 30m',
  )

  assert.equal(canStopShiftInControlCenter({ source: 'control-center' }), true)
  assert.equal(canStopShiftInControlCenter({ source: 'openclaw' }), true)
  assert.equal(canStopShiftInControlCenter({ source: 'system-cron' }), false)

  assert.equal(canRunShiftNow({ source: 'control-center', systemOwned: false }), true)
  assert.equal(canRunShiftNow({ source: 'openclaw', systemOwned: true }), false)
  assert.equal(canRunShiftNow({ source: 'system-cron', systemOwned: false }), false)
})

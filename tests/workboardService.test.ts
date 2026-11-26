import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkboardService, WorkboardServiceError } from '../server/services/workboardService'

function createHarness() {
  let persisted: unknown = null
  let id = 0
  let clock = 0
  const options = {
    readState: () => persisted,
    writeState: (value: unknown) => { persisted = structuredClone(value); return true },
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)),
    randomId: () => `task-${++id}`,
  }
  return { options, service: createWorkboardService(options), readPersisted: () => persisted }
}

test('workboard persists mission-linked task cards and reloads them from durable state', async () => {
  const harness = createHarness()
  const task = await harness.service.createTask({ title: 'Review model route', description: 'Check endpoint ownership.', missionId: 'mission-1' })
  const restarted = createWorkboardService(harness.options)

  assert.equal(task.missionId, 'mission-1')
  assert.deepEqual((await restarted.listTasks()).map((entry) => entry.id), [task.id])
  assert.deepEqual((harness.readPersisted() as { version: number }).version, 1)
})

test('workboard dependency graph rejects cycles and blocks execution until prerequisites finish', async () => {
  const { service } = createHarness()
  const prerequisite = await service.createTask({ title: 'Prepare' })
  const dependent = await service.createTask({ title: 'Execute' })
  await service.updateTask(dependent.id, { dependsOn: [prerequisite.id] })

  await assert.rejects(
    service.updateTask(dependent.id, { status: 'in_progress' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_prerequisites_open',
  )
  await assert.rejects(
    service.updateTask(prerequisite.id, { dependsOn: [dependent.id] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_cycle',
  )

  await service.updateTask(prerequisite.id, { status: 'completed' })
  assert.equal((await service.updateTask(dependent.id, { status: 'in_progress' })).status, 'in_progress')
})

test('completed tasks reject status, assignment, and dependency mutations while accepting comments', async () => {
  const { service } = createHarness()
  const completed = await service.createTask({ title: 'Finished work', assignedAgentId: 'agent-a' })
  const prerequisite = await service.createTask({ title: 'Unrelated prerequisite' })
  await service.updateTask(completed.id, { status: 'completed' })

  const rejectTerminalMutation = (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_task_terminal'
  await assert.rejects(service.updateTask(completed.id, { dependsOn: [prerequisite.id] }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(completed.id, { assignedAgentId: 'agent-b' }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(completed.id, { status: 'open' }), rejectTerminalMutation)

  const unchanged = (await service.listTasks()).find((task) => task.id === completed.id)
  assert.equal(unchanged?.status, 'completed')
  assert.equal(unchanged?.assignedAgentId, 'agent-a')
  assert.deepEqual(unchanged?.dependsOn, [])
  await service.addComment(completed.id, { body: 'Follow-up evidence remains append-only.' })
  assert.deepEqual((await service.listTasks()).find((task) => task.id === completed.id)?.comments.map((comment) => comment.body), [
    'Follow-up evidence remains append-only.',
  ])
})

test('in-progress tasks reject dependency changes while prerequisites remain open', async () => {
  const { service } = createHarness()
  const prerequisite = await service.createTask({ title: 'Prerequisite work' })
  const active = await service.createTask({ title: 'Active work' })
  await service.updateTask(active.id, { status: 'in_progress' })

  await assert.rejects(
    service.updateTask(active.id, { dependsOn: [prerequisite.id] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_prerequisites_open',
  )
  assert.deepEqual((await service.listTasks()).find((task) => task.id === active.id)?.dependsOn, [])

  await service.updateTask(prerequisite.id, { status: 'completed' })
  assert.deepEqual((await service.updateTask(active.id, { dependsOn: [prerequisite.id] })).dependsOn, [prerequisite.id])
})

test('workboard comments and evidence are append-only coordination receipts', async () => {
  const { service } = createHarness()
  const task = await service.createTask({ title: 'Collect evidence' })
  const first = await service.addComment(task.id, {
    body: 'Verified the provider is available.',
    actor: 'operator',
    evidence: [{ label: 'Provider docs', uri: 'https://example.test/provider' }],
  })
  const second = await service.addComment(task.id, { body: 'Added the route check.' })
  const persisted = (await service.listTasks())[0]

  assert.notEqual(first.id, second.id)
  assert.deepEqual(persisted.comments.map((entry) => entry.body), ['Verified the provider is available.', 'Added the route check.'])
  assert.deepEqual(persisted.comments[0].evidence, [{ label: 'Provider docs', uri: 'https://example.test/provider' }])
})

test('workboard enforces renewable task leases, heartbeats, and expiry-aware takeover', async () => {
  let nowMs = Date.UTC(2026, 10, 25, 20, 0, 0)
  let persisted: unknown = null
  let id = 0
  const service = createWorkboardService({
    readState: () => persisted,
    writeState: (value: unknown) => { persisted = structuredClone(value); return true },
    now: () => new Date(nowMs),
    randomId: () => `lease-task-${++id}`,
  })

  const task = await service.createTask({
    title: 'Harden atomic coordination',
    assignedAgentId: 'hn-architect',
    leaseOwnerAgentId: 'hn-architect',
    leaseTtlMs: 60_000,
  })
  assert.equal(task.leaseOwnerAgentId, 'hn-architect')
  assert.equal(task.leaseExpiresAt, new Date(nowMs + 60_000).toISOString())

  await assert.rejects(
    service.updateTask(task.id, { status: 'in_progress', actorAgentId: 'engineering-senior-developer' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_lease_conflict',
  )

  nowMs += 30_000
  const renewed = await service.updateTask(task.id, { heartbeat: true, actorAgentId: 'hn-architect', leaseTtlMs: 120_000 })
  assert.equal(renewed.lastHeartbeatAt, new Date(nowMs).toISOString())
  assert.equal(renewed.leaseExpiresAt, new Date(nowMs + 120_000).toISOString())

  // Still active after 90s because heartbeat renewed for 120s
  nowMs += 90_000
  await assert.rejects(
    service.updateTask(task.id, { assignedAgentId: 'hn-coordinator', actorAgentId: 'hn-coordinator' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_lease_conflict',
  )

  // Once expired (beyond 120s), another agent can safely claim without forceTakeover
  nowMs += 35_000
  const claimed = await service.updateTask(task.id, {
    status: 'in_progress',
    assignedAgentId: 'hn-coordinator',
    leaseOwnerAgentId: 'hn-coordinator',
    actorAgentId: 'hn-coordinator',
    leaseTtlMs: 60_000,
  })
  assert.equal(claimed.leaseOwnerAgentId, 'hn-coordinator')
  assert.equal(claimed.status, 'in_progress')
})

test('workboard enforces exclusive claimed file locks and releases locks on expiry or completion', async () => {
  let nowMs = Date.UTC(2026, 10, 25, 21, 0, 0)
  let persisted: unknown = null
  let id = 0
  const service = createWorkboardService({
    readState: () => persisted,
    writeState: (value: unknown) => { persisted = structuredClone(value); return true },
    now: () => new Date(nowMs),
    randomId: () => `file-lock-${++id}`,
  })

  await assert.rejects(
    service.createTask({ title: 'Bad traversal claim', assignedAgentId: 'hn-architect', claimedFiles: ['../secret.env'] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'invalid_payload',
  )

  const first = await service.createTask({
    title: 'Refactor workboard service',
    assignedAgentId: 'hn-architect',
    leaseTtlMs: 60_000,
    claimedFiles: ['.\\server\\services\\workboardService.ts', 'server/routes/workboardRoutes.ts'],
  })
  assert.deepEqual(first.claimedFiles, ['server/services/workboardService.ts', 'server/routes/workboardRoutes.ts'])

  // Case-insensitive and slash-normalized collision detection
  await assert.rejects(
    service.createTask({
      title: 'Conflicting edit',
      assignedAgentId: 'engineering-senior-developer',
      claimedFiles: ['SERVER/SERVICES/WORKBOARDSERVICE.TS'],
    }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_file_lock_conflict',
  )

  // Completing the task automatically releases all claimed file locks and clears lease
  const completed = await service.updateTask(first.id, { status: 'completed', actorAgentId: 'hn-architect' })
  assert.deepEqual(completed.claimedFiles, [])
  assert.equal(completed.leaseOwnerAgentId, null)

  // Now the second agent can claim the file cleanly
  const second = await service.createTask({
    title: 'Follow-up workboard polish',
    assignedAgentId: 'engineering-senior-developer',
    leaseTtlMs: 60_000,
    claimedFiles: ['server/services/workboardService.ts'],
  })
  assert.deepEqual(second.claimedFiles, ['server/services/workboardService.ts'])

  // Expiry also releases file locks if an agent stops heartbeating
  nowMs += 65_000
  const third = await service.createTask({
    title: 'Post-expiry recovery',
    assignedAgentId: 'hn-coordinator',
    claimedFiles: ['server/services/workboardService.ts'],
  })
  assert.deepEqual(third.claimedFiles, ['server/services/workboardService.ts'])
})

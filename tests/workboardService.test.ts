import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'

import { registerWorkboardRoutes } from '../server/routes/workboardRoutes'
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
  assert.equal(task.executionState, 'queued')
  assert.deepEqual((await restarted.listTasks()).map((entry) => entry.id), [task.id])
  assert.deepEqual((harness.readPersisted() as { version: number }).version, 1)
})

test('workboard dependency graph rejects cycles and blocks execution until prerequisites finish', async () => {
  const { service } = createHarness()
  const prerequisite = await service.createTask({ title: 'Prepare' })
  const dependent = await service.createTask({ title: 'Execute', dependsOn: [prerequisite.id] })
  assert.deepEqual(dependent.dependsOn, [prerequisite.id])

  await assert.rejects(
    service.createTask({ title: 'Missing prereq', dependsOn: ['non-existent-task'] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_dependency_not_found',
  )

  await assert.rejects(
    service.updateTask(dependent.id, { status: 'in_progress' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_prerequisites_open',
  )
  await assert.rejects(
    service.updateTask(prerequisite.id, { dependsOn: [dependent.id] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_cycle',
  )

  await service.updateTask(prerequisite.id, { status: 'completed' })
  const started = await service.updateTask(dependent.id, { status: 'in_progress' })
  assert.equal(started.status, 'in_progress')
  assert.equal(started.executionState, 'running')
})

test('completed and cancelled tasks reject state, lease, file-lock, and handoff mutations while accepting comments', async () => {
  const { service } = createHarness()
  const completed = await service.createTask({ title: 'Finished work', assignedAgentId: 'agent-a' })
  const cancelled = await service.createTask({ title: 'Cancelled work', assignedAgentId: 'agent-a', claimedFiles: ['src/App.tsx'] })
  const prerequisite = await service.createTask({ title: 'Unrelated prerequisite' })
  await service.updateTask(completed.id, { status: 'completed' })
  const cancelledResult = await service.updateTask(cancelled.id, { status: 'cancelled', actorAgentId: 'agent-a' })
  assert.deepEqual(cancelledResult.claimedFiles, [])
  assert.equal(cancelledResult.leaseOwnerAgentId, null)

  const rejectTerminalMutation = (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_task_terminal'
  await assert.rejects(service.updateTask(completed.id, { dependsOn: [prerequisite.id] }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(completed.id, { assignedAgentId: 'agent-b' }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(completed.id, { status: 'open' }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(cancelled.id, { heartbeat: true, actorAgentId: 'agent-a' }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(cancelled.id, { claimedFiles: ['src/App.tsx'] }), rejectTerminalMutation)
  await assert.rejects(service.updateTask(cancelled.id, { status: 'in_progress' }), rejectTerminalMutation)

  const unchanged = (await service.listTasks()).find((task) => task.id === completed.id)
  assert.equal(unchanged?.status, 'completed')
  assert.equal(unchanged?.executionState, 'completed')
  assert.equal(unchanged?.assignedAgentId, 'agent-a')
  assert.deepEqual(unchanged?.dependsOn, [])
  await service.addComment(completed.id, { body: 'Follow-up evidence remains append-only.' })
  await service.addComment(cancelled.id, { body: 'Cancellation reason recorded.' })
  assert.deepEqual((await service.listTasks()).find((task) => task.id === completed.id)?.comments.map((comment) => comment.body), [
    'Follow-up evidence remains append-only.',
  ])
  assert.deepEqual((await service.listTasks()).find((task) => task.id === cancelled.id)?.comments.map((comment) => comment.body), [
    'Cancellation reason recorded.',
  ])
})

test('in-progress tasks reject dependency changes while prerequisites remain open unless entering waiting_for_dependency', async () => {
  const { service } = createHarness()
  const prerequisite = await service.createTask({ title: 'API contract definition', assignedAgentId: 'engineering-senior-developer' })
  const active = await service.createTask({ title: 'Architecture integration', assignedAgentId: 'hn-architect' })
  await service.updateTask(active.id, { status: 'in_progress', actorAgentId: 'hn-architect' })

  await assert.rejects(
    service.updateTask(active.id, { dependsOn: [prerequisite.id], actorAgentId: 'hn-architect' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_prerequisites_open',
  )
  assert.deepEqual((await service.listTasks()).find((task) => task.id === active.id)?.dependsOn, [])

  const waiting = await service.updateTask(active.id, {
    actorAgentId: 'hn-architect',
    waitingDependency: {
      dependencyTaskId: prerequisite.id,
      responsibleAgentId: 'engineering-senior-developer',
      deliverable: 'Finalized shift batch schema',
      nextCheckAt: '2026-11-26T23:30:00.000Z',
      fallbackTask: 'Audit recovery state tests',
    },
  })
  assert.equal(waiting.status, 'in_progress')
  assert.equal(waiting.executionState, 'waiting_for_dependency')
  assert.deepEqual(waiting.dependsOn, [prerequisite.id])
  assert.equal(waiting.waitingDependency?.deliverable, 'Finalized shift batch schema')

  // Cannot mark completed while the waited dependency is still incomplete
  await assert.rejects(
    service.updateTask(active.id, { status: 'completed', actorAgentId: 'hn-architect' }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_prerequisites_open',
  )

  await service.updateTask(prerequisite.id, { status: 'completed', actorAgentId: 'engineering-senior-developer' })
  const resumed = await service.updateTask(active.id, { waitingDependency: null, actorAgentId: 'hn-architect' })
  assert.equal(resumed.executionState, 'running')
  assert.equal(resumed.waitingDependency, null)

  const finished = await service.updateTask(active.id, { status: 'completed', actorAgentId: 'hn-architect' })
  assert.equal(finished.status, 'completed')
  assert.equal(finished.executionState, 'completed')
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

test('workboard enforces exclusive claimed file locks including operator locks and releases locks on lease release, expiry, or completion', async () => {
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

  // Unassigned task claiming files receives an enforceable operator lease lock
  const operatorTask = await service.createTask({
    title: 'Operator lock check',
    claimedFiles: ['src/main.tsx'],
  })
  assert.equal(operatorTask.leaseOwnerAgentId, 'operator')
  await assert.rejects(
    service.createTask({ title: 'Conflicting agent lock', assignedAgentId: 'hn-architect', claimedFiles: ['src/main.tsx'] }),
    (error: unknown) => error instanceof WorkboardServiceError && error.code === 'workboard_file_lock_conflict',
  )
  // Releasing lease during break releases unnecessary file locks cleanly
  const releasedOperator = await service.updateTask(operatorTask.id, { leaseOwnerAgentId: null, actorAgentId: 'operator', executionState: 'break' })
  assert.equal(releasedOperator.leaseOwnerAgentId, null)
  assert.deepEqual(releasedOperator.claimedFiles, [])
  assert.equal(releasedOperator.executionState, 'break')

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

test('workboard HTTP routes validate structured agent-to-agent handoffs and receiver acknowledgment', async () => {
  const { service } = createHarness()
  const app = express()
  app.use(express.json())
  registerWorkboardRoutes(app, {
    workboard: service,
    isMissionKnown: (missionId) => missionId === 'mission-shift-1',
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    const createRes = await fetch(`${baseUrl}/api/workboard/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Implement shift batch stagger validation',
        missionId: 'mission-shift-1',
        assignedAgentId: 'hn-architect',
        leaseOwnerAgentId: 'hn-architect',
        claimedFiles: ['server/routes/shiftRoutes.ts'],
      }),
    })
    assert.equal(createRes.status, 200)
    const createdTask = (await createRes.json()).data.task

    // Sender initiates structured handoff, releasing sender lease & file locks for receiver
    const handoffRes = await fetch(`${baseUrl}/api/workboard/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorAgentId: 'hn-architect',
        executionState: 'waiting_for_integration',
        handoff: {
          fromAgentId: 'hn-architect',
          toAgentId: 'engineering-senior-developer',
          summary: 'Designed --at validator contract and interface boundaries.',
          filesModified: ['server/routes/shiftRoutes.ts'],
          testsExecuted: 'npm run typecheck (0 errors)',
          nextAction: 'Add unit tests in tests/shiftBatchRoutes.test.ts and finalize route.',
        },
      }),
    })
    assert.equal(handoffRes.status, 200)
    const handedOffTask = (await handoffRes.json()).data.task
    assert.equal(handedOffTask.assignedAgentId, 'engineering-senior-developer')
    assert.equal(handedOffTask.leaseOwnerAgentId, null)
    assert.deepEqual(handedOffTask.claimedFiles, [])
    assert.equal(handedOffTask.handoff.status, 'pending')
    assert.equal(handedOffTask.executionState, 'waiting_for_integration')

    // Non-designated agent cannot acknowledge handoff without forceTakeover
    const wrongAckRes = await fetch(`${baseUrl}/api/workboard/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorAgentId: 'hn-coordinator',
        acknowledgeHandoff: true,
      }),
    })
    assert.equal(wrongAckRes.status, 409)
    assert.equal((await wrongAckRes.json()).error.code, 'workboard_handoff_conflict')

    // Designated receiver acknowledges handoff and acquires renewable lease + file lock
    const ackRes = await fetch(`${baseUrl}/api/workboard/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorAgentId: 'engineering-senior-developer',
        acknowledgeHandoff: true,
        status: 'in_progress',
        claimedFiles: ['server/routes/shiftRoutes.ts', 'tests/shiftBatchRoutes.test.ts'],
      }),
    })
    assert.equal(ackRes.status, 200)
    const ackedTask = (await ackRes.json()).data.task
    assert.equal(ackedTask.handoff.status, 'acknowledged')
    assert.equal(ackedTask.handoff.acknowledgedBy, 'engineering-senior-developer')
    assert.ok(ackedTask.handoff.acknowledgedAt)
    assert.equal(ackedTask.leaseOwnerAgentId, 'engineering-senior-developer')
    assert.equal(ackedTask.executionState, 'running')
    assert.deepEqual(ackedTask.claimedFiles, ['server/routes/shiftRoutes.ts', 'tests/shiftBatchRoutes.test.ts'])
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

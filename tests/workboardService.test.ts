import assert from 'node:assert/strict'
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

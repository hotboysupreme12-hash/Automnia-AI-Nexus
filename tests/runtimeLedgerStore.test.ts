import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CONTROL_CENTER_STATE_KEYS,
  createRuntimeLedgerStore,
  runtimeLedgerPathsForStateRoot,
} from '../server/state/runtimeLedgerStore'

async function withRuntimeLedgerStore<T>(
  name: string,
  run: (store: ReturnType<typeof createRuntimeLedgerStore>) => Promise<T>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `dystopai-${name}-`))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(tempDir))
  try {
    return await run(store)
  } finally {
    store.close()
    await rm(tempDir, { recursive: true, force: true })
  }
}

test('runtime ledger store preserves JSONL fallback diagnostics', async () => {
  await withRuntimeLedgerStore('ledger-store-tail', async (store) => {
    await mkdir(path.dirname(store.paths.runtimeRunsJsonl), { recursive: true })
    const partialPrefix = 'partial-line-without-json'.repeat(24_000)
    const rows = [
      JSON.stringify({ id: 'run-a', status: 'completed' }),
      '{"id":"broken"',
      JSON.stringify({ id: 'run-b', status: 'failed' }),
      JSON.stringify({ id: 'run-c', status: 'completed' }),
    ]
    await writeFile(store.paths.runtimeRunsJsonl, `${partialPrefix}\n${rows.join('\n')}\n`, 'utf-8')

    const records = await store.readRuntimeRuns<{ id: string }>(10, { sqlite: false })
    assert.deepEqual(records.map((record) => record.id), ['run-a', 'run-b', 'run-c'])

    const status = store.status({ sqlite: false })
    assert.equal(status.jsonlTailDiagnostic?.ledger, 'runtime-runs')
    assert.equal(status.jsonlTailDiagnostic?.malformedRows, 1)
    assert.equal(status.jsonlTailDiagnostic?.discardedPartialLine, true)
  })
})

test('runtime ledger store wraps JSONL fallback append and read helpers', async () => {
  await withRuntimeLedgerStore('ledger-store-jsonl', async (store) => {
    await store.appendRuntimeRun({ id: 'run-1', status: 'completed' }, { sqlite: false })
    await store.appendGatewayEvent({ timestamp: '2026-06-30T12:00:00.000Z', stream: 'lifecycle', message: 'ready' }, { sqlite: false })
    await store.appendDiagnosticRun({ id: 'doctor-1', startedAt: '2026-06-30T12:00:00.000Z', ok: true }, { sqlite: false })
    await store.appendMissionRecord({ missionId: 'mission-1', lifecycleState: 'running' }, { sqlite: false })
    await store.appendMissionEvent({ id: 'event-1', missionId: 'mission-1', nextState: 'running' }, { sqlite: false })
    await store.appendMissionReport({ id: 'report-1', missionId: 'mission-1' }, { sqlite: false })

    assert.deepEqual((await store.readRuntimeRuns<{ id: string }>(5, { sqlite: false })).map((row) => row.id), ['run-1'])
    assert.deepEqual((await store.readGatewayEvents<{ message: string }>(5, { sqlite: false })).map((row) => row.message), ['ready'])
    assert.deepEqual((await store.readDiagnosticRuns<{ id: string }>(5, { sqlite: false })).map((row) => row.id), ['doctor-1'])
    assert.deepEqual((await store.readMissionRecords<{ missionId: string }>(5, { sqlite: false })).map((row) => row.missionId), ['mission-1'])
    assert.deepEqual((await store.readMissionEvents<{ id: string }>(5, { sqlite: false })).map((row) => row.id), ['event-1'])
    assert.deepEqual((await store.readMissionReports<{ id: string }>(5, { sqlite: false })).map((row) => row.id), ['report-1'])
  })
})

test('runtime ledger store owns control-center state namespace', async () => {
  await withRuntimeLedgerStore('ledger-store-state', async (store) => {
    const status = store.status()
    if (!status.sqliteAvailable) {
      assert.equal(store.writeControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults, { model: 'fallback' }), false)
      assert.ok(status.fallback)
      return
    }

    assert.equal(store.writeControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults, {
      model: 'google/gemini-3.5-flash',
    }), true)
    assert.equal(
      store.readControlCenterState<{ model: string }>(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults)?.model,
      'google/gemini-3.5-flash',
    )
    assert.equal(store.deleteControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults), true)
    assert.equal(store.readControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults), null)
    assert.equal(existsSync(store.paths.sqlite), true)
  })
})

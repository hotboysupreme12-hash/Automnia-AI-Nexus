import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeLedgerStore, runtimeLedgerPathsForStateRoot } from '../server/state/runtimeLedgerStore'
import { readMissionEventLedgerTail, readMissionRecordLedgerTail, readMissionReportLedgerTail, readGatewayEventLedgerTail } from '../server/runtimeLedger'

test('a legacy gateway table upgrades without losing events and reopens successfully', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-upgrade-'))
  const paths = runtimeLedgerPathsForStateRoot(root)
  await mkdir(paths.directory, { recursive: true })
  const legacy = new DatabaseSync(paths.sqlite)
  legacy.exec(`CREATE TABLE gateway_events (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, stream TEXT, channel TEXT,
    direction TEXT, message TEXT, created_at_ms INTEGER NOT NULL, payload_json TEXT NOT NULL
  )`)
  legacy.prepare('INSERT INTO gateway_events (created_at_ms, payload_json) VALUES (?, ?)')
    .run(1, JSON.stringify({ message: 'retained legacy message' }))
  legacy.close()
  const store = createRuntimeLedgerStore(paths)
  try {
    assert.equal(store.status().sqliteAvailable, true)
    assert.deepEqual(await store.readGatewayEvents(5), [{ message: 'retained legacy message' }])
    store.close()
    assert.equal(store.status().sqliteAvailable, true)
    await store.appendGatewayEvent({ timestamp: '2026-09-07T00:00:00Z', message: 'new message' }, { mirrorJsonl: false })
    assert.equal((await store.readGatewayEvents(5)).length, 2)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('mission SQLite queries apply mission scope before the row limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-scope-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  try {
    for (const [missionId, timestamp] of [['wanted', '2026-01-01T00:00:00Z'], ['other', '2026-09-01T00:00:00Z']]) {
      await store.appendMissionRecord({ missionId, updatedAt: timestamp }, { mirrorJsonl: false })
      await store.appendMissionEvent({ id: `event-${missionId}`, missionId, timestamp }, { mirrorJsonl: false })
      await store.appendMissionReport({ id: `report-${missionId}`, missionId, generatedAt: timestamp }, { mirrorJsonl: false })
    }
    assert.equal((await readMissionRecordLedgerTail<{ missionId: string }>(1, { missionId: 'wanted' }))[0]?.missionId, 'wanted')
    assert.equal((await readMissionEventLedgerTail<{ id: string }>(1, { missionId: 'wanted' }))[0]?.id, 'event-wanted')
    assert.equal((await readMissionReportLedgerTail<{ id: string }>(1, { missionId: 'wanted' }))[0]?.id, 'report-wanted')
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('scoped JSONL fallback finds an older mission beyond unrelated byte and row tails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-jsonl-scope-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  try {
    await mkdir(store.paths.directory, { recursive: true })
    const wanted = [1, 2, 3].map((id) => ({ id: `wanted-${id}`, missionId: 'wanted', text: '🌊'.repeat(11) }))
    const unrelated = Array.from({ length: 1400 }, (_, id) => ({ id, missionId: 'other', text: 'x'.repeat(512) }))
    const content = [...wanted, ...unrelated].map((row) => JSON.stringify(row)).join('\n') + '\n'
    for (const file of [store.paths.missionRecordsJsonl, store.paths.missionEventsJsonl, store.paths.missionReportsJsonl]) {
      await writeFile(file, content)
    }
    for (const read of [readMissionRecordLedgerTail, readMissionEventLedgerTail, readMissionReportLedgerTail]) {
      assert.deepEqual(await read(2, { sqlite: false, missionId: 'wanted' }), wanted.slice(-2))
      assert.deepEqual(await read(2, { sqlite: false, missionId: 'missing' }), [])
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('a JSONL tail beginning exactly at a row boundary retains the first complete row', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-boundary-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  try {
    await mkdir(store.paths.directory, { recursive: true })
    const wanted = JSON.stringify({ id: 'first-complete' }) + '\n'
    const fillerOverhead = JSON.stringify({ text: '' }).length + 1
    const filler = JSON.stringify({ text: 'x'.repeat(512 * 1024 - wanted.length - fillerOverhead) }) + '\n'
    await writeFile(store.paths.gatewayEventsJsonl, '{"id":"outside-tail"}\n' + wanted + filler)
    const rows = await readGatewayEventLedgerTail<{ id?: string }>(2, { sqlite: false })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].id, 'first-complete')
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('concurrent appends retain invocation order and snapshot caller-owned values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-order-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  try {
    const value = { id: 'first', updatedAt: '2026-09-07T00:00:00Z', status: 'running' }
    const first = store.appendMissionRecord(value, { sqlite: false })
    value.status = 'mutated-later'
    const rest = Array.from({ length: 25 }, (_, index) => store.appendMissionRecord({ id: String(index), status: 'queued' }, { sqlite: false }))
    await Promise.all([first, ...rest])
    const records = await readMissionRecordLedgerTail<{ id: string; status: string }>(30, { sqlite: false })
    assert.equal(records[0].status, 'running')
    assert.deepEqual(records.map((row) => row.id), ['first', ...Array.from({ length: 25 }, (_, index) => String(index))])
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('hot SQLite writes reuse their prepared statement and recreate it after close', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-prepared-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  const original = DatabaseSync.prototype.prepare
  let eventInsertPreparations = 0
  DatabaseSync.prototype.prepare = function (sql: string) {
    if (/INSERT OR IGNORE INTO gateway_events/.test(sql)) eventInsertPreparations += 1
    return original.call(this, sql)
  }
  try {
    for (let index = 0; index < 20; index++) await store.appendGatewayEvent({ message: `Event ${index}` }, { mirrorJsonl: false })
    assert.equal(eventInsertPreparations, 1)
    store.close()
    await store.appendGatewayEvent({ message: 'After reopening' }, { mirrorJsonl: false })
    assert.equal(eventInsertPreparations, 2)
  } finally { DatabaseSync.prototype.prepare = original; store.close(); await rm(root, { recursive: true, force: true }) }
})

test('an open database write failure falls back durably and stays visible after recovery and restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-write-failure-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  let external: DatabaseSync | undefined
  try {
    const before = { id: 'before', timestamp: '2026-09-07T00:00:00Z', message: 'Before failure' }
    const fallback = { id: 'fallback', timestamp: '2026-09-07T00:00:01Z', message: 'During failure' }
    const after = { id: 'after', timestamp: '2026-09-07T00:00:02Z', message: 'After recovery' }
    await store.appendGatewayEvent(before, { mirrorJsonl: false })
    external = new DatabaseSync(store.paths.sqlite)
    external.exec("CREATE TRIGGER fail_gateway_insert BEFORE INSERT ON gateway_events BEGIN SELECT RAISE(FAIL, 'injected write failure'); END")
    await store.appendGatewayEvent(fallback, { mirrorJsonl: false })
    assert.match(await readFile(store.paths.gatewayEventsJsonl, 'utf8'), /During failure/)
    assert.match(store.status().sqliteWriteWarning || '', /injected write failure/)
    external.exec('DROP TRIGGER fail_gateway_insert')
    await store.appendGatewayEvent(after, { mirrorJsonl: false })
    // Replaying the fallback into SQLite must not duplicate the visible event.
    await store.appendGatewayEvent(fallback, { mirrorJsonl: false })
    assert.deepEqual(await store.readGatewayEvents(5), [before, fallback, after])
    store.close()
    assert.deepEqual(await store.readGatewayEvents(5), [before, fallback, after])
  } finally { external?.close(); store.close(); await rm(root, { recursive: true, force: true }) }
})

test('complete report evidence reads every scoped database batch and its JSONL fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-ledger-complete-evidence-'))
  const store = createRuntimeLedgerStore(runtimeLedgerPathsForStateRoot(root))
  let db: DatabaseSync | undefined
  try {
    assert.equal(store.status().sqliteAvailable, true)
    db = new DatabaseSync(store.paths.sqlite)
    const insert = db.prepare('INSERT INTO mission_events(id, mission_id, created_at_ms, payload_json) VALUES (?, ?, ?, ?)')
    db.exec('BEGIN')
    for (let index = 0; index < 2405; index++) insert.run(`event-${index}`, 'wanted', index, JSON.stringify({ id: `event-${index}`, missionId: 'wanted', message: index === 0 ? 'Verification failed' : 'Progress' }))
    insert.run('unrelated', 'other', 3000, JSON.stringify({ id: 'unrelated', missionId: 'other' }))
    db.exec('COMMIT')
    await writeFile(store.paths.missionEventsJsonl, [
      { id: 'fallback-only', missionId: 'wanted' },
      { id: 'event-2404', missionId: 'wanted', message: 'Progress' },
      { id: 'unrelated-fallback', missionId: 'other' },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n')
    const all = await store.readAllMissionEvents<{ id: string }>('wanted')
    assert.equal(all.length, 2406)
    assert.equal(all.some((event) => event.id === 'event-0'), true)
    assert.equal(all.some((event) => event.id === 'fallback-only'), true)
    store.close()
    assert.equal((await store.readAllMissionEvents('wanted')).length, 2406)
  } finally { db?.close(); store.close(); await rm(root, { recursive: true, force: true }) }
})

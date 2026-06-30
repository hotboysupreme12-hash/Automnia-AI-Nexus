import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTROL_CENTER_STATE_KEYS,
  createRuntimeLedgerStore,
} from '../server/state/runtimeLedgerStore.ts'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dystopai-control-state-'))
const runtimeRunsJsonl = path.join(tempDir, 'runtime-runs.jsonl')
const runtimeLedgerStore = createRuntimeLedgerStore({
  directory: tempDir,
  sqlite: path.join(tempDir, 'control-center.sqlite'),
  runtimeRunsJsonl,
  gatewayEventsJsonl: path.join(tempDir, 'gateway-events.jsonl'),
  diagnosticRunsJsonl: path.join(tempDir, 'diagnostic-runs.jsonl'),
  missionRecordsJsonl: path.join(tempDir, 'mission-records.jsonl'),
  missionEventsJsonl: path.join(tempDir, 'mission-events.jsonl'),
  missionReportsJsonl: path.join(tempDir, 'mission-reports.jsonl'),
})

try {
  assert.equal(runtimeLedgerStore.writeControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults, {
    model: 'google/gemini-3.5-flash',
    thinking: 'minimal',
  }), true, String(runtimeLedgerStore.status().fallback || 'SQLite should be available for control center state'))

  const heartbeat = runtimeLedgerStore.readControlCenterState<{ model: string }>(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults)
  assert.equal(heartbeat?.model, 'google/gemini-3.5-flash')

  assert.equal(runtimeLedgerStore.deleteControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults), true)
  assert.equal(runtimeLedgerStore.readControlCenterState(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults), null)

  await runtimeLedgerStore.appendRuntimeRun({
    id: 'run-sqlite-primary',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
  }, { mirrorJsonl: false })
  const runtimeRuns = await runtimeLedgerStore.readRuntimeRuns<{ id: string }>(5)
  assert.deepEqual(runtimeRuns.map((run) => run.id), ['run-sqlite-primary'])
  assert.equal(existsSync(runtimeRunsJsonl), false, 'SQLite-primary runtime snapshots should not mirror JSONL when SQLite writes')

  const runtimeLedgerSource = readFileSync(path.join(rootDir, 'server/runtimeLedger.ts'), 'utf8')
  assert.match(runtimeLedgerSource, /CREATE TABLE IF NOT EXISTS control_center_state/)
  assert.match(runtimeLedgerSource, /PRAGMA busy_timeout = 5000/)
  assert.match(runtimeLedgerSource, /export function readControlCenterState/)
  assert.match(runtimeLedgerSource, /export function writeControlCenterState/)
  const runtimeLedgerStoreSource = readFileSync(path.join(rootDir, 'server/state/runtimeLedgerStore.ts'), 'utf8')
  assert.match(runtimeLedgerStoreSource, /export function createRuntimeLedgerStore/)
  assert.match(runtimeLedgerStoreSource, /CONTROL_CENTER_STATE_NAMESPACE = 'control-center'/)
  assert.match(runtimeLedgerStoreSource, /appendRuntimeRunLedger/)

  const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS/)
  assert.match(serverSource, /readControlCenterStateRecord<LocalAuthStore>/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.heartbeatDefaults/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.heartbeatPerAgent/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.partyProfiles/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.pluginListCache/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.pluginRuntimeState/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.retiredAgentIds/)
  assert.match(serverSource, /CONTROL_CENTER_STATE_KEYS\.runtimeMonitorClear/)
  assert.match(serverSource, /runtimeLedgerStore\.appendRuntimeRun\(openClawRunLedgerPayload\(record\), \{ mirrorJsonl: false \}\)/)
  assert.doesNotMatch(serverSource, /runtimeLedgerStore\.appendRuntimeRun\(openClawRunLedgerPayload\(record\), \{ sqlite: false \}\)/)
} finally {
  runtimeLedgerStore.close()
  await rm(tempDir, { recursive: true, force: true })
}

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  closeRuntimeLedger,
  configureRuntimeLedger,
  readRuntimeRunLedgerTail,
  runtimeLedgerStatus,
} from '../server/runtimeLedger.ts'

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dystopai-ledger-tail-'))

try {
  const runtimeRunsJsonl = path.join(tempDir, 'runtime-runs.jsonl')
  configureRuntimeLedger({
    directory: tempDir,
    runtimeRunsJsonl,
    gatewayEventsJsonl: path.join(tempDir, 'gateway-events.jsonl'),
    diagnosticRunsJsonl: path.join(tempDir, 'diagnostic-runs.jsonl'),
    missionRecordsJsonl: path.join(tempDir, 'mission-records.jsonl'),
    missionEventsJsonl: path.join(tempDir, 'mission-events.jsonl'),
    missionReportsJsonl: path.join(tempDir, 'mission-reports.jsonl'),
  })

  const partialPrefix = 'partial-line-without-json'.repeat(24_000)
  const rows = [
    JSON.stringify({ id: 'run-a', status: 'completed' }),
    '{"id":"broken"',
    JSON.stringify({ id: 'run-b', status: 'failed' }),
    JSON.stringify({ id: 'run-c', status: 'completed' }),
  ]
  await writeFile(runtimeRunsJsonl, `${partialPrefix}\n${rows.join('\n')}\n`, 'utf-8')

  const records = await readRuntimeRunLedgerTail<{ id: string }>(10, { sqlite: false })
  assert.deepEqual(
    records.map((record) => record.id),
    ['run-a', 'run-b', 'run-c'],
  )

  const status = runtimeLedgerStatus({ sqlite: false })
  assert.equal(status.jsonlTailDiagnostic?.ledger, 'runtime-runs')
  assert.equal(status.jsonlTailDiagnostic?.malformedRows, 1)
  assert.equal(status.jsonlTailDiagnostic?.discardedPartialLine, true)
  assert.equal(typeof status.jsonlTailDiagnostic?.startOffset, 'number')
} finally {
  closeRuntimeLedger()
  await rm(tempDir, { recursive: true, force: true })
}

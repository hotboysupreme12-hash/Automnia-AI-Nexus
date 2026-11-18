import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPluginActionLedgerService } from '../server/services/plugins/pluginActionLedgerService'

test('plugin action ledger appends durable records without changing earlier entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-plugin-actions-'))
  try {
    let tick = 0
    const ledger = createPluginActionLedgerService(path.join(root, 'plugin-actions.jsonl'), () => new Date(Date.UTC(2026, 10, 17, 10, 0, tick++)))
    const started = await ledger.append({
      actionId: 'repair-1',
      action: 'repair',
      pluginId: 'codex',
      outcome: 'started',
      failureClass: 'loader_error',
      idempotencyKey: 'a'.repeat(64),
      attempt: 1,
      retryable: false,
      terminal: false,
      summary: 'Targeted plugin reload accepted.',
    })
    const completed = await ledger.append({
      actionId: 'repair-1',
      action: 'repair',
      pluginId: 'codex',
      outcome: 'succeeded',
      failureClass: 'loader_error',
      idempotencyKey: 'a'.repeat(64),
      attempt: 1,
      retryable: false,
      terminal: true,
      summary: 'Targeted plugin reload completed.',
    })

    assert.deepEqual(await ledger.readTail(10), [started, completed])
    assert.equal((await readFile(ledger.path, 'utf8')).trim().split(/\r?\n/u).length, 2)
    assert.equal((await ledger.findLatestRepair('a'.repeat(64)))?.outcome, 'succeeded')
    assert.deepEqual(await ledger.readRepairHistory('a'.repeat(64)), { entries: [started, completed], complete: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('plugin action ledger refuses to treat partial lines as a complete repair history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-plugin-actions-incomplete-'))
  try {
    const ledger = createPluginActionLedgerService(path.join(root, 'plugin-actions.jsonl'))
    await ledger.append({
      actionId: 'repair-started',
      action: 'repair',
      pluginId: 'codex',
      outcome: 'started',
      failureClass: 'loader_error',
      idempotencyKey: 'b'.repeat(64),
      attempt: 1,
      terminal: false,
      summary: 'Started.',
    })
    await appendFile(ledger.path, '{"broken":', 'utf8')

    const history = await ledger.readRepairHistory('b'.repeat(64))
    assert.deepEqual(history, { entries: [], complete: false })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

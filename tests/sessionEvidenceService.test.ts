import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readSessionLinesReverse } from '../server/services/missions/sessionEvidenceService'

test('reverse session scanning preserves split UTF-8 rows and exact newline boundaries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'session-reverse-'))
  try {
    const file = path.join(root, 'session.jsonl')
    const rows = ['{"text":"first"}', '{"text":"🎉 café"}', '{"text":"last"}']
    await writeFile(file, rows.join('\r\n') + '\r\n')
    for (const chunk of [1, 5, 16, 65536]) {
      const actual: string[] = []
      for await (const row of readSessionLinesReverse(file, chunk)) actual.push(row.trim())
      assert.deepEqual(actual, [...rows].reverse())
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reverse scanning skips oversized rows and continues to valid older evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'session-oversize-'))
  try {
    const file = path.join(root, 'session.jsonl')
    await writeFile(file, 'older\n' + 'x'.repeat(1024 * 1024) + '\nlatest\n')
    const actual: string[] = []
    for await (const row of readSessionLinesReverse(file)) actual.push(row)
    assert.deepEqual(actual, ['latest', 'older'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

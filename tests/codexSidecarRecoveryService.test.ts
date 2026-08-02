import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { recoverMalformedCodexBindingSidecars } from '../server/services/runtime/codexSidecarRecoveryService'

test('recovers malformed Codex binding sidecars without touching valid JSON', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'automnia-codex-sidecar-'))
  try {
    const sessions = path.join(root, 'agents', 'hn-coordinator', 'sessions')
    await mkdir(sessions, { recursive: true })
    const malformed = path.join(sessions, 'turn.jsonl.codex-app-server.json')
    const valid = path.join(sessions, 'valid.jsonl.codex-app-server.json')
    await writeFile(malformed, '""', 'utf8')
    await writeFile(valid, JSON.stringify({ binding: 'valid' }), 'utf8')

    const result = await recoverMalformedCodexBindingSidecars(root)

    assert.equal(result.warnings.length, 0)
    assert.equal(result.recovered.length, 1)
    assert.equal(result.recovered[0]?.agentId, 'hn-coordinator')
    await assert.rejects(readFile(malformed, 'utf8'), { code: 'ENOENT' })
    assert.equal(await readFile(valid, 'utf8'), JSON.stringify({ binding: 'valid' }))
    assert.equal(await readFile(result.recovered[0]!.recoveryPath, 'utf8'), '""')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not create recovery files when all Codex sidecars are valid', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'automnia-codex-sidecar-'))
  try {
    const sessions = path.join(root, 'agents', 'hn-architect', 'sessions')
    await mkdir(sessions, { recursive: true })
    await writeFile(path.join(sessions, 'turn.jsonl.codex-app-server.json'), JSON.stringify({ version: 1 }), 'utf8')

    const result = await recoverMalformedCodexBindingSidecars(root)

    assert.deepEqual(result, { recovered: [], warnings: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

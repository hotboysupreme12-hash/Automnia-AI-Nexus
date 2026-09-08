import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ControlFileConflict, controlFileRevision, writeAtomicControlFile } from '../server/services/filesystem/atomicControlFile'

test('stale and concurrent saves preserve the last accepted file and clean temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-control-file-'))
  const file = path.join(root, 'SOUL.md')
  try {
    await writeFile(file, 'Original')
    const originalRevision = controlFileRevision('Original')
    const results = await Promise.allSettled([writeAtomicControlFile(file, 'First edit', originalRevision), writeAtomicControlFile(file, 'Stale edit', originalRevision)])
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected')
    assert.equal(await readFile(file, 'utf8'), 'First edit')
    assert.deepEqual(await readdir(root), ['SOUL.md'])
    await writeFile(file, 'External edit')
    await assert.rejects(writeAtomicControlFile(file, 'Overwrite', controlFileRevision('First edit')), ControlFileConflict)
    assert.equal(await readFile(file, 'utf8'), 'External edit')
    await writeAtomicControlFile(file, 'Reviewed edit', controlFileRevision('External edit'))
    assert.equal(await readFile(file, 'utf8'), 'Reviewed edit')
  } finally { await rm(root, { recursive: true, force: true }) }
})

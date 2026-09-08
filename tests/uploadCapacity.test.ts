import assert from 'node:assert/strict'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withUploadCapacity } from '../server/services/filesystem/uploadCapacity'

test('concurrent upload admission includes the previous write before accepting another', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-capacity-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const results = await Promise.allSettled(Array.from({ length: 3 }, (_, index) => withUploadCapacity(root, 100, { bytes: 100_000, files: 2 }, async () => {
    await fs.writeFile(path.join(root, `file-${index}`), 'x')
    await fs.writeFile(path.join(root, `file-${index}.upload.json`), '{}')
  })))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((await fs.readdir(root)).length, 2)
})

test('byte capacity rejects additions without deleting existing uploads', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-capacity-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'existing'), Buffer.alloc(1000))
  await assert.rejects(withUploadCapacity(root, 1000, { bytes: 18_000, files: 20 }, async () => { throw new Error('write must not run') }), /storage is full/)
  assert.equal((await fs.stat(path.join(root, 'existing'))).size, 1000)
})

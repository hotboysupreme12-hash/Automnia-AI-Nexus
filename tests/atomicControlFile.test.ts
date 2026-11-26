import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  ControlFileConflict,
  assertContainedRegularFilePath,
  controlFileRevision,
  normalizedLockKey,
  replaceFileAtomicallyWithLockRetry,
  writeAtomicControlFile,
} from '../server/services/filesystem/atomicControlFile'

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

test('normalizedLockKey folds drive and filename case on Windows only', () => {
  const sample = path.resolve('Team_Communication.md')
  assert.equal(normalizedLockKey(sample, 'win32'), sample.toLowerCase())
  assert.equal(normalizedLockKey(sample, 'linux'), sample)
})

test('replaceFileAtomicallyWithLockRetry falls back to copyFile on Windows EPERM overwrite', async () => {
  let renameCalls = 0
  let copyCalls = 0
  await replaceFileAtomicallyWithLockRetry('a.tmp', 'a.md', {
    platform: 'win32',
    rename: async () => {
      renameCalls += 1
      const err = new Error('EPERM') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    },
    copyFile: async () => {
      copyCalls += 1
    },
  })
  assert.equal(renameCalls, 8)
  assert.equal(copyCalls, 1)

  await assert.rejects(
    replaceFileAtomicallyWithLockRetry('a.tmp', 'a.md', {
      platform: 'linux',
      rename: async () => {
        const err = new Error('EEXIST') as NodeJS.ErrnoException
        err.code = 'EEXIST'
        throw err
      },
      copyFile: async () => {
        throw new Error('copyFile must not run on linux')
      },
    }),
    (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'EEXIST',
  )
})

test('assertContainedRegularFilePath enforces workspace containment and blocks directory or symlink escapes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-contained-path-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  const exactShared = path.join(root, 'shared', 'TEAM_SYNC.md')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  await mkdir(path.dirname(exactShared), { recursive: true })
  await writeFile(exactShared, '# shared\n', 'utf8')

  try {
    const insideTarget = path.join(workspace, 'nested', 'TEAM_SYNC.md')
    const resolvedInside = await assertContainedRegularFilePath(insideTarget, {
      allowedRoots: [workspace],
      allowedExactFiles: [exactShared],
      label: 'TEAM_SYNC.md',
    })
    assert.ok(resolvedInside.endsWith(path.join('nested', 'TEAM_SYNC.md')))

    const resolvedExact = await assertContainedRegularFilePath(exactShared, {
      allowedRoots: [workspace],
      allowedExactFiles: [exactShared],
      label: 'TEAM_SYNC.md',
    })
    assert.ok(resolvedExact.endsWith('TEAM_SYNC.md'))

    await assert.rejects(
      assertContainedRegularFilePath(path.join(outside, 'TEAM_SYNC.md'), {
        allowedRoots: [workspace],
        allowedExactFiles: [exactShared],
        label: 'TEAM_SYNC.md',
      }),
      /outside allowed workspace root/,
    )

    const dirCollision = path.join(workspace, 'dir-as-file')
    await mkdir(dirCollision)
    await assert.rejects(
      assertContainedRegularFilePath(dirCollision, {
        allowedRoots: [workspace],
        label: 'TEAM_SYNC.md',
      }),
      /must be a regular file/,
    )

    const outsideSecret = path.join(outside, 'secret.md')
    await writeFile(outsideSecret, 'secret\n', 'utf8')
    const linkPath = path.join(workspace, 'linked-sync.md')
    try {
      await symlink(outsideSecret, linkPath, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
        t.skip(`symlinks unavailable in test environment: ${code}`)
        return
      }
      throw error
    }

    await assert.rejects(
      assertContainedRegularFilePath(linkPath, {
        allowedRoots: [workspace],
        label: 'TEAM_SYNC.md',
      }),
      /must be a regular file/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createControlFilesService } from '../server/services/controlFilesService'

async function createTempWorkspace(t: { after(callback: () => Promise<void> | void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dystopai-control-files-'))
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}

test('control files service reads and writes allowed control files inside the workspace root', async (t) => {
  const workspaceRoot = await createTempWorkspace(t)
  const service = createControlFilesService(workspaceRoot)

  await service.writeFile('AGENTS.md', '# Agent doctrine\n')

  assert.equal(await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf-8'), '# Agent doctrine\n')
  assert.equal(await service.readFile('AGENTS.md'), '# Agent doctrine\n')
  assert.equal(service.resolveFilePath('AGENTS.md'), path.resolve(workspaceRoot, 'AGENTS.md'))
})

test('control files service rejects traversal and non-control file names at the boundary', async (t) => {
  const workspaceRoot = await createTempWorkspace(t)
  const outsidePath = path.join(path.dirname(workspaceRoot), 'AGENTS.md')
  await fs.writeFile(outsidePath, 'outside\n', 'utf-8')

  const service = createControlFilesService(workspaceRoot)

  await assert.rejects(
    service.writeFile('../AGENTS.md', 'pwned\n'),
    /allowed control list/,
  )
  await assert.rejects(
    service.readFile('AGENTS.md/../USER.md'),
    /allowed control list/,
  )
  await assert.rejects(
    service.writeFile('TOOLS.md', 'not a command-console control file\n'),
    /allowed control list/,
  )
  assert.equal(await fs.readFile(outsidePath, 'utf-8'), 'outside\n')
})

test('control files service rejects separator-mixed traversal attempts before disk access', async (t) => {
  const workspaceRoot = await createTempWorkspace(t)
  const service = createControlFilesService(workspaceRoot)

  for (const attempt of [
    '../AGENTS.md',
    '..\\AGENTS.md',
    'AGENTS.md/../USER.md',
    'AGENTS.md\\..\\USER.md',
    'AGENTS.md%2f..%2fUSER.md',
    'AGENTS.md%5c..%5cUSER.md',
  ]) {
    assert.throws(
      () => service.resolveFilePath(attempt),
      /allowed control list/,
      `expected ${attempt} to be rejected`,
    )
  }
})

test('control files service enforces resolved workspace containment before read and write', async (t) => {
  const workspaceRoot = await createTempWorkspace(t)
  const checks: Array<{ baseDir: string; targetPath: string }> = []
  const service = createControlFilesService(workspaceRoot, {
    isPathUnder: (baseDir, targetPath) => {
      checks.push({ baseDir, targetPath })
      return false
    },
  })

  await assert.rejects(
    service.readFile('USER.md'),
    /outside workspace root/,
  )
  await assert.rejects(
    service.writeFile('USER.md', '# User\n'),
    /outside workspace root/,
  )

  assert.deepEqual(checks, [
    { baseDir: path.resolve(workspaceRoot), targetPath: path.resolve(workspaceRoot, 'USER.md') },
    { baseDir: path.resolve(workspaceRoot), targetPath: path.resolve(workspaceRoot, 'USER.md') },
  ])
})

test('control files service rejects symlink escapes before read and write', async (t) => {
  const workspaceRoot = await createTempWorkspace(t)
  const outsidePath = path.join(path.dirname(workspaceRoot), 'outside-agents.md')
  const linkPath = path.join(workspaceRoot, 'AGENTS.md')
  await fs.writeFile(outsidePath, 'outside doctrine\n', 'utf-8')
  try {
    await fs.symlink(outsidePath, linkPath, 'file')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
      t.skip(`filesystem symlinks are unavailable in this environment: ${code}`)
      return
    }
    throw error
  }

  const service = createControlFilesService(workspaceRoot)

  await assert.rejects(
    service.readFile('AGENTS.md'),
    /outside workspace root/,
  )
  await assert.rejects(
    service.writeFile('AGENTS.md', 'pwned\n'),
    /outside workspace root/,
  )
  assert.equal(await fs.readFile(outsidePath, 'utf-8'), 'outside doctrine\n')
})

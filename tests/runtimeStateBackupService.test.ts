import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Worker } from 'node:worker_threads'
import { createRuntimeStateBackupService, RuntimeStateBackupBusyError } from '../server/services/runtime/runtimeStateBackupService'

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-runtime-backup-service-'))
}

test('manual runtime backup runs off-thread, reports verified completion, and persists recovery location', async () => {
  const root = temporaryRoot()
  try {
    const backupParent = path.join(root, 'backups')
    const schedulePath = path.join(backupParent, '.schedule.json')
    let expectedBackupPath = ''
    fs.mkdirSync(backupParent, { recursive: true })
    for (const [name, createdAt] of [
      ['automnia-runtime-oldest', '2026-10-01T00:00:00.000Z'],
      ['automnia-runtime-older', '2026-10-10T00:00:00.000Z'],
      ['automnia-runtime-newer', '2026-10-20T00:00:00.000Z'],
      ['telegram-session-pretrim', '2026-10-21T00:00:00.000Z'],
    ]) {
      const directory = path.join(backupParent, name)
      fs.mkdirSync(directory)
      fs.writeFileSync(path.join(directory, 'backup-manifest.json'), JSON.stringify({ product: name.startsWith('automnia-runtime-') ? 'Automnia' : 'Other', createdAt }))
    }
    const service = createRuntimeStateBackupService({
      sourceRoot: path.join(root, 'state'),
      backupParent,
      schedulePath,
      helperPath: path.join(root, 'helper.cjs'),
      getActiveRunCount: () => 0,
      now: () => new Date('2026-10-23T12:00:00.000Z'),
      workerFactory: (workerData) => {
        assert.equal(workerData.sourceRoot, path.join(root, 'state'))
        const worker = new EventEmitter()
        queueMicrotask(() => {
          const generatedPath = path.join(String(workerData.backupParent), String(workerData.backupName))
          expectedBackupPath = generatedPath
          fs.mkdirSync(generatedPath)
          fs.writeFileSync(path.join(generatedPath, 'backup-manifest.json'), JSON.stringify({ product: 'Automnia', createdAt: '2026-10-23T12:00:00.000Z' }))
          worker.emit('message', { type: 'progress', completed: 1, total: 4 })
          worker.emit('message', { type: 'complete', result: { backupRoot: generatedPath, fileCount: 4, totalBytes: 1_024 } })
        })
        return worker as unknown as Pick<Worker, 'on' | 'terminate'>
      },
    })

    const accepted = service.createBackup()
    assert.equal(accepted.state, 'running')
    const deadline = Date.now() + 500
    while (!service.status().lastBackupAt && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    const result = service.status()
    assert.equal(result.state, 'idle')
    assert.equal(result.lastBackupPath, expectedBackupPath)
    assert.equal(result.lastBackupAt, '2026-10-23T12:00:00.000Z')
    assert.match(result.message, /Backup verified: 4 files/)
    assert.deepEqual(JSON.parse(fs.readFileSync(schedulePath, 'utf8')), {
      lastBackupAt: '2026-10-23T12:00:00.000Z',
      lastBackupPath: expectedBackupPath,
    })
    const remaining = fs.readdirSync(backupParent).filter((name) => name.startsWith('automnia-runtime-')).sort()
    assert.deepEqual(remaining, [
      path.basename(expectedBackupPath),
      'automnia-runtime-newer',
    ].sort())
    assert.equal(fs.existsSync(path.join(backupParent, 'telegram-session-pretrim')), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('manual runtime backup refuses to compete with active agent turns', () => {
  const root = temporaryRoot()
  try {
    const service = createRuntimeStateBackupService({
      sourceRoot: root,
      backupParent: path.join(root, 'backups'),
      schedulePath: path.join(root, 'backups', '.schedule.json'),
      helperPath: path.join(root, 'helper.cjs'),
      getActiveRunCount: () => 2,
      workerFactory: () => { throw new Error('worker must not start while agents are active') },
    })
    assert.throws(() => service.createBackup(), RuntimeStateBackupBusyError)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('weekly automatic backup waits for idle agent runs, then completes without user action', async () => {
  const root = temporaryRoot()
  let activeRuns = 1
  let workerStarts = 0
  let service: ReturnType<typeof createRuntimeStateBackupService> | undefined
  try {
    service = createRuntimeStateBackupService({
      sourceRoot: path.join(root, 'state'),
      backupParent: path.join(root, 'backups'),
      schedulePath: path.join(root, 'backups', '.schedule.json'),
      helperPath: path.join(root, 'helper.cjs'),
      getActiveRunCount: () => activeRuns,
      startupDelayMs: 5,
      intervalMs: 5,
      now: () => new Date('2026-10-23T12:00:00.000Z'),
      workerFactory: () => {
        workerStarts += 1
        const worker = new EventEmitter()
        queueMicrotask(() => worker.emit('message', {
          type: 'complete',
          result: { backupRoot: path.join(root, 'backups', 'automnia-runtime-test'), fileCount: 1, totalBytes: 32 },
        }))
        return worker as unknown as Pick<Worker, 'on' | 'terminate'>
      },
    })
    service.startScheduler()
    const deadline = Date.now() + 500
    while (service.status().state !== 'deferred' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(service.status().state, 'deferred')
    assert.equal(workerStarts, 0)

    activeRuns = 0
    while (!service.status().lastBackupAt && Date.now() < deadline + 500) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(workerStarts, 1)
    assert.equal(service.status().state, 'idle')
    assert.equal(service.status().automatic.enabled, true)
  } finally {
    service?.stopScheduler()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('default background worker creates a verifiable backup without blocking the caller', async () => {
  const root = temporaryRoot()
  try {
    const sourceRoot = path.join(root, 'state')
    const backupParent = path.join(root, 'backups')
    fs.mkdirSync(sourceRoot, { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, 'openclaw.json'), '{"agents":[]}\n')
    const service = createRuntimeStateBackupService({
      sourceRoot,
      backupParent,
      schedulePath: path.join(backupParent, '.schedule.json'),
      helperPath: path.resolve('scripts/lib/runtime-state-backup.cjs'),
      getActiveRunCount: () => 0,
    })

    assert.equal(service.createBackup().state, 'running')
    const deadline = Date.now() + 5_000
    while (!service.status().lastBackupAt && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    const result = service.status()
    assert.equal(result.state, 'idle', result.message)
    assert.ok(result.lastBackupPath)
    assert.equal(fs.readFileSync(path.join(result.lastBackupPath as string, 'openclaw.json'), 'utf8'), '{"agents":[]}\n')
    const manifest = JSON.parse(fs.readFileSync(path.join(result.lastBackupPath as string, 'backup-manifest.json'), 'utf8'))
    assert.equal(manifest.product, 'Automnia')
    assert.equal(manifest.fileCount, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

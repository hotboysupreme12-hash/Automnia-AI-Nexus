import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

export type RuntimeStateBackupStatus = {
  state: 'idle' | 'running' | 'deferred' | 'failed'
  automatic: { enabled: true; cadenceDays: number; retention: number }
  progress: { completed: number; total: number } | null
  lastBackupAt: string | null
  lastBackupPath: string | null
  message: string
}

type RuntimeStateBackupOptions = {
  sourceRoot: string
  backupParent: string
  schedulePath: string
  helperPath: string
  getActiveRunCount: () => number
  intervalMs?: number
  startupDelayMs?: number
  workerFactory?: (workerData: Record<string, unknown>) => Pick<Worker, 'on' | 'terminate'>
  now?: () => Date
}

type PersistedSchedule = { lastBackupAt?: string; lastBackupPath?: string }
type BackupWorkerResult = { backupRoot: string; fileCount: number; totalBytes: number }
type WorkerMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'complete'; result: BackupWorkerResult }
  | { type: 'error'; message: string }

export class RuntimeStateBackupBusyError extends Error {
  constructor(activeRuns: number) {
    super(`Runtime backup waits for ${activeRuns} active agent run${activeRuns === 1 ? '' : 's'} to finish.`)
    this.name = 'RuntimeStateBackupBusyError'
  }
}

const CADENCE_DAYS = 7
const RETENTION_COUNT = 2
const BACKUP_PREFIX = 'automnia-runtime-'
let backupSequence = 0
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
try {
  const { createStateBackup, verifyStateBackup } = require(workerData.helperPath)
  const result = createStateBackup({
    sourceRoot: workerData.sourceRoot,
    backupParent: workerData.backupParent,
    backupName: workerData.backupName,
    onProgress: (progress) => parentPort.postMessage({ type: 'progress', completed: progress.completed, total: progress.total }),
  })
  const manifest = verifyStateBackup(result.backupRoot)
  parentPort.postMessage({ type: 'complete', result: { backupRoot: result.backupRoot, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes } })
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
}
`

function readSchedule(schedulePath: string): PersistedSchedule {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(schedulePath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const record = value as Record<string, unknown>
    return {
      ...(typeof record.lastBackupAt === 'string' ? { lastBackupAt: record.lastBackupAt } : {}),
      ...(typeof record.lastBackupPath === 'string' ? { lastBackupPath: record.lastBackupPath } : {}),
    }
  } catch {
    return {}
  }
}

function persistSchedule(schedulePath: string, schedule: PersistedSchedule) {
  fs.mkdirSync(path.dirname(schedulePath), { recursive: true })
  const temporaryPath = `${schedulePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(schedule, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, schedulePath)
}

function dateSlug(value: Date) {
  return value.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function isManagedBackup(directoryName: string) {
  return directoryName.startsWith(BACKUP_PREFIX)
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function pruneOldBackups(backupParent: string) {
  const valid: Array<{ name: string; createdAt: number }> = []
  for (const name of fs.readdirSync(backupParent)) {
    if (!isManagedBackup(name)) continue
    const directory = path.join(backupParent, name)
    try {
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      const manifestPath = path.join(directory, 'backup-manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { product?: unknown; createdAt?: unknown }
      if (manifest.product !== 'Automnia') continue
      const parsedAt = typeof manifest.createdAt === 'string' ? Date.parse(manifest.createdAt) : Number.NaN
      valid.push({ name, createdAt: Number.isFinite(parsedAt) ? parsedAt : stat.mtimeMs })
    } catch {
      // Leave unreadable and unrecognized directories untouched.
    }
  }
  valid.sort((left, right) => right.createdAt - left.createdAt || right.name.localeCompare(left.name))
  for (const backup of valid.slice(RETENTION_COUNT)) {
    await fs.promises.rm(path.join(backupParent, backup.name), { recursive: true, force: false })
  }
}

async function cleanupStalePartialBackups(backupParent: string, nowMs: number) {
  let entries: string[]
  try {
    entries = fs.readdirSync(backupParent)
  } catch {
    return
  }
  for (const name of entries) {
    if (!isManagedBackup(name)) continue
    const directory = path.resolve(backupParent, name)
    if (!isWithin(backupParent, directory) || directory === path.resolve(backupParent)) continue
    try {
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink() || nowMs - stat.mtimeMs < 60 * 60_000) continue
      if (fs.existsSync(path.join(directory, 'backup-manifest.json'))) continue
      await fs.promises.rm(directory, { recursive: true, force: false })
    } catch {
      // A locked partial snapshot is harmless; preserve it for a later cleanup pass.
    }
  }
}

export function createRuntimeStateBackupService(options: RuntimeStateBackupOptions) {
  const now = options.now || (() => new Date())
  const intervalMs = Math.max(1, options.intervalMs || 30 * 60_000)
  const schedule = readSchedule(options.schedulePath)
  let timer: ReturnType<typeof setInterval> | null = null
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let worker: Pick<Worker, 'on' | 'terminate'> | null = null
  let activeBackupPath = ''
  let running = false
  let state: RuntimeStateBackupStatus['state'] = 'idle'
  let message = 'Automatic weekly backups run when no agent is working.'
  let progress: RuntimeStateBackupStatus['progress'] = null
  let nextAutomaticRetryAt = 0

  const workerFactory = options.workerFactory || ((workerData) => new Worker(WORKER_SOURCE, { eval: true, workerData }))

  function status(): RuntimeStateBackupStatus {
    return {
      state,
      automatic: { enabled: true, cadenceDays: CADENCE_DAYS, retention: RETENTION_COUNT },
      progress: progress ? { ...progress } : null,
      lastBackupAt: schedule.lastBackupAt || null,
      lastBackupPath: schedule.lastBackupPath || null,
      message,
    }
  }

  async function runBackup(automatic: boolean) {
    if (running) return status()
    const activeRuns = Math.max(0, Math.floor(options.getActiveRunCount()))
    if (activeRuns > 0) {
      state = automatic ? 'deferred' : 'idle'
      message = automatic
        ? `Automatic backup is waiting for ${activeRuns} active agent run${activeRuns === 1 ? '' : 's'} to finish.`
        : `Backup paused to protect responsiveness while ${activeRuns} agent run${activeRuns === 1 ? ' is' : 's are'} active. Try again when work is idle.`
      return status()
    }

    running = true
    state = 'running'
    progress = { completed: 0, total: 0 }
    message = automatic ? 'Creating the scheduled runtime backup…' : 'Creating a verified runtime backup…'
    backupSequence += 1
    const backupName = `${BACKUP_PREFIX}${dateSlug(now())}-${String(backupSequence).padStart(4, '0')}`
    activeBackupPath = path.join(options.backupParent, backupName)
    try {
      fs.mkdirSync(options.backupParent, { recursive: true })
      const result = await new Promise<BackupWorkerResult>((resolve, reject) => {
        let settled = false
        const createdWorker = workerFactory({
          sourceRoot: options.sourceRoot,
          backupParent: options.backupParent,
          helperPath: options.helperPath,
          backupName,
        })
        worker = createdWorker
        createdWorker.on('message', (raw: unknown) => {
          if (!raw || typeof raw !== 'object' || !('type' in raw)) return
          const event = raw as WorkerMessage
          if (event.type === 'progress') {
            progress = { completed: Math.max(0, event.completed), total: Math.max(0, event.total) }
          } else if (event.type === 'complete' && !settled) {
            settled = true
            resolve(event.result)
          } else if (event.type === 'error' && !settled) {
            settled = true
            reject(new Error(event.message))
          }
        })
        createdWorker.on('error', (error: Error) => {
          if (settled) return
          settled = true
          reject(error)
        })
        createdWorker.on('exit', (code: number) => {
          if (!settled) {
            settled = true
            reject(new Error(`Backup worker exited before completion (code ${code}).`))
          }
        })
      })
      message = 'Snapshot verified; finalizing backup retention…'
      let retentionWarning = false
      try {
        await pruneOldBackups(options.backupParent)
      } catch {
        retentionWarning = true
      }
      schedule.lastBackupAt = now().toISOString()
      schedule.lastBackupPath = result.backupRoot
      persistSchedule(options.schedulePath, schedule)
      state = 'idle'
      message = `Backup verified: ${result.fileCount} files (${result.totalBytes} bytes).${retentionWarning ? ' An older snapshot could not be removed; the new backup is safe.' : ''}`
    } catch (error) {
      state = 'failed'
      message = error instanceof Error ? error.message.slice(0, 500) : 'Runtime backup failed.'
    } finally {
      running = false
      worker = null
      activeBackupPath = ''
      progress = null
    }
    return status()
  }

  function isDue() {
    const lastBackup = schedule.lastBackupAt ? Date.parse(schedule.lastBackupAt) : Number.NaN
    return !Number.isFinite(lastBackup) || now().getTime() - lastBackup >= CADENCE_DAYS * 24 * 60 * 60_000
  }

  async function automaticCheck() {
    if (!isDue() || running || now().getTime() < nextAutomaticRetryAt) return
    const result = await runBackup(true)
    if (result.state === 'failed') nextAutomaticRetryAt = now().getTime() + 6 * 60 * 60_000
  }

  function startScheduler() {
    if (timer) return
    void cleanupStalePartialBackups(options.backupParent, now().getTime())
    startupTimer = setTimeout(() => {
      startupTimer = null
      void automaticCheck()
    }, Math.max(1, options.startupDelayMs || 10 * 60_000))
    startupTimer.unref?.()
    timer = setInterval(() => void automaticCheck(), intervalMs)
    timer.unref?.()
  }

  function stopScheduler() {
    if (startupTimer) clearTimeout(startupTimer)
    if (timer) clearInterval(timer)
    startupTimer = null
    timer = null
    const activeWorker = worker
    const partialBackupPath = activeBackupPath
    if (activeWorker && partialBackupPath) {
      void activeWorker.terminate().then(() => {
        if (path.dirname(path.resolve(partialBackupPath)) === path.resolve(options.backupParent)
          && path.basename(partialBackupPath).startsWith(BACKUP_PREFIX)) {
          fs.rmSync(partialBackupPath, { recursive: true, force: true })
        }
      }).catch(() => undefined)
    }
    worker = null
  }

  return {
    status,
    createBackup: () => {
      const activeRuns = Math.max(0, Math.floor(options.getActiveRunCount()))
      if (activeRuns > 0) throw new RuntimeStateBackupBusyError(activeRuns)
      if (!running) void runBackup(false)
      return status()
    },
    startScheduler,
    stopScheduler,
  }
}

export type RuntimeStateBackupService = ReturnType<typeof createRuntimeStateBackupService>

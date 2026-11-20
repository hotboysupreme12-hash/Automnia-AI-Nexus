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
  isGatewayReady?: () => boolean | Promise<boolean>
  getLastActivityAt?: () => number | null | Promise<number | null>
  minimumIdleMs?: number
  intervalMs?: number
  startupDelayMs?: number
  activityCheckIntervalMs?: number
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
const DEFAULT_MINIMUM_IDLE_MS = 15 * 60_000
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
    entries = await fs.promises.readdir(backupParent)
  } catch {
    return
  }
  for (const name of entries) {
    if (!isManagedBackup(name)) continue
    const directory = path.resolve(backupParent, name)
    if (!isWithin(backupParent, directory) || directory === path.resolve(backupParent)) continue
    try {
      const stat = await fs.promises.lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink() || nowMs - stat.mtimeMs < 60 * 60_000) continue
      try {
        await fs.promises.stat(path.join(directory, 'backup-manifest.json'))
        continue
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') continue
        await fs.promises.rm(directory, { recursive: true, force: false })
      }
    } catch {
      // A locked partial snapshot is harmless; preserve it for a later cleanup pass.
    }
  }
}

export function createRuntimeStateBackupService(options: RuntimeStateBackupOptions) {
  const now = options.now || (() => new Date())
  const intervalMs = Math.max(1, options.intervalMs || 5 * 60_000)
  const minimumIdleMs = Math.max(0, options.minimumIdleMs ?? DEFAULT_MINIMUM_IDLE_MS)
  const schedule = readSchedule(options.schedulePath)
  let timer: ReturnType<typeof setInterval> | null = null
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let backupWatchTimer: ReturnType<typeof setInterval> | null = null
  let worker: Pick<Worker, 'on' | 'terminate'> | null = null
  let activeBackupPath = ''
  let running = false
  let checkInFlight = false
  let backupWatchInFlight = false
  let interruptedReason: string | null = null
  let manualBackupRequested = false
  let gatewayReadySinceMs = 0
  let state: RuntimeStateBackupStatus['state'] = 'idle'
  let message = 'Automatic weekly backups wait for a ready, idle Gateway.'
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

  function interruptBackup(reason: string, expectedWorker: Pick<Worker, 'on' | 'terminate'>) {
    if (!running || worker !== expectedWorker || interruptedReason) return
    interruptedReason = reason
    void expectedWorker.terminate().catch(() => undefined)
  }

  async function watchBackupActivity(activityCheckpointAt: number, expectedWorker: Pick<Worker, 'on' | 'terminate'>) {
    if (!running || worker !== expectedWorker || backupWatchInFlight || interruptedReason) return
    backupWatchInFlight = true
    try {
      const activeRuns = Math.max(0, Math.floor(options.getActiveRunCount()))
      if (activeRuns > 0) {
        interruptBackup(`Gateway activity resumed (${activeRuns} active agent run${activeRuns === 1 ? '' : 's'}).`, expectedWorker)
        return
      }

      if (options.isGatewayReady && !(await options.isGatewayReady())) {
        interruptBackup('Gateway readiness changed during backup.', expectedWorker)
        return
      }
      if (options.getLastActivityAt) {
        const lastActivityAt = await options.getLastActivityAt()
        if (Number.isFinite(lastActivityAt) && Number(lastActivityAt) > activityCheckpointAt) {
          interruptBackup('New Gateway activity arrived during backup.', expectedWorker)
        }
      }
    } catch {
      interruptBackup('Gateway activity could not be checked safely during backup.', expectedWorker)
    } finally {
      backupWatchInFlight = false
    }
  }

  async function runBackup(automatic: boolean, activityCheckpointAt: number) {
    if (running) return status()
    const activeRuns = Math.max(0, Math.floor(options.getActiveRunCount()))
    if (activeRuns > 0) {
      state = 'deferred'
      message = `${automatic ? 'Automatic' : 'Requested'} backup is waiting for ${activeRuns} active agent run${activeRuns === 1 ? '' : 's'} to finish.`
      return status()
    }

    running = true
    interruptedReason = null
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
        backupWatchTimer = setInterval(() => void watchBackupActivity(activityCheckpointAt, createdWorker), Math.max(250, options.activityCheckIntervalMs || 5_000))
        backupWatchTimer.unref?.()
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
      if (interruptedReason) {
        try {
          if (activeBackupPath && path.dirname(path.resolve(activeBackupPath)) === path.resolve(options.backupParent)
            && path.basename(activeBackupPath).startsWith(BACKUP_PREFIX)) {
            await fs.promises.rm(activeBackupPath, { recursive: true, force: true })
          }
        } catch {
          // Keep the next idle pass responsible for removing any interrupted partial snapshot.
        }
        state = 'deferred'
        message = `${automatic ? 'Automatic' : 'Requested'} backup paused. ${interruptedReason} It will retry after the Gateway is quiet again.`
      } else {
        state = 'failed'
        message = error instanceof Error ? error.message.slice(0, 500) : 'Runtime backup failed.'
      }
    } finally {
      if (backupWatchTimer) clearInterval(backupWatchTimer)
      backupWatchTimer = null
      running = false
      worker = null
      activeBackupPath = ''
      progress = null
      interruptedReason = null
    }
    return status()
  }

  function isDue() {
    const lastBackup = schedule.lastBackupAt ? Date.parse(schedule.lastBackupAt) : Number.NaN
    return !Number.isFinite(lastBackup) || now().getTime() - lastBackup >= CADENCE_DAYS * 24 * 60 * 60_000
  }

  async function automaticCheck() {
    if ((!manualBackupRequested && !isDue()) || running || checkInFlight || now().getTime() < nextAutomaticRetryAt) return
    checkInFlight = true
    try {
      const activeRuns = Math.max(0, Math.floor(options.getActiveRunCount()))
      if (activeRuns > 0) {
        state = 'deferred'
        message = `${manualBackupRequested ? 'Requested' : 'Automatic'} backup is waiting for ${activeRuns} active agent run${activeRuns === 1 ? '' : 's'} to finish.`
        return
      }

      let gatewayReady = true
      try {
        gatewayReady = options.isGatewayReady ? await options.isGatewayReady() : true
      } catch {
        gatewayReady = false
      }
      if (!gatewayReady) {
        gatewayReadySinceMs = 0
        state = 'deferred'
        message = `${manualBackupRequested ? 'Requested' : 'Automatic'} backup is queued until the Gateway is fully ready.`
        return
      }

      const checkedAt = now().getTime()
      if (!gatewayReadySinceMs) gatewayReadySinceMs = checkedAt
      let lastActivityAt: number | null = null
      try {
        lastActivityAt = options.getLastActivityAt ? await options.getLastActivityAt() : null
      } catch {
        state = 'deferred'
        message = `${manualBackupRequested ? 'Requested' : 'Automatic'} backup is queued until Gateway activity can be checked safely.`
        return
      }
      const activityAt = Number.isFinite(lastActivityAt) ? Number(lastActivityAt) : 0
      const idleSinceMs = Math.max(gatewayReadySinceMs, activityAt)
      const idleForMs = Math.max(0, checkedAt - idleSinceMs)
      if (idleForMs < minimumIdleMs) {
        const remainingMinutes = Math.max(1, Math.ceil((minimumIdleMs - idleForMs) / 60_000))
        state = 'deferred'
        message = `${manualBackupRequested ? 'Requested' : 'Automatic'} backup is queued until the Gateway has been ready and quiet for ${Math.ceil(minimumIdleMs / 60_000)} minutes (about ${remainingMinutes} minutes remaining).`
        return
      }

      const manual = manualBackupRequested
      const result = await runBackup(!manual, activityAt)
      if (result.state !== 'deferred' && manual) manualBackupRequested = false
      if (result.state === 'failed' && !manual) nextAutomaticRetryAt = now().getTime() + 6 * 60 * 60_000
    } finally {
      checkInFlight = false
    }
  }

  function startScheduler() {
    if (timer) return
    setImmediate(() => void cleanupStalePartialBackups(options.backupParent, now().getTime()))
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
      if (running) return status()
      manualBackupRequested = true
      state = 'deferred'
      message = `Requested backup is queued until the Gateway is ready and has been quiet for ${Math.ceil(minimumIdleMs / 60_000)} minutes.`
      void automaticCheck()
      return status()
    },
    startScheduler,
    stopScheduler,
  }
}

export type RuntimeStateBackupService = ReturnType<typeof createRuntimeStateBackupService>

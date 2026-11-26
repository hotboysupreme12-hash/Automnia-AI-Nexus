import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isPathUnder as defaultIsPathUnder, samePath as defaultSamePath } from './safePathService'

const writes = new Map<string, Promise<unknown>>()
export function controlFileRevision(content: string) { return createHash('sha256').update(content).digest('hex') }
export class ControlFileConflict extends Error {
  constructor() { super('This file changed after it was opened. Review the version on disk before saving.'); this.name = 'ControlFileConflict' }
}

const TRANSIENT_FILE_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function normalizedLockKey(filePath: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(filePath)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

export async function retryTransientFileLock<T>(operation: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (!code || !TRANSIENT_FILE_LOCK_CODES.has(code) || attempt === attempts - 1) throw error
      const waitMs = Math.min(400, 25 * Math.pow(1.6, attempt))
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  throw new Error('Unreachable retry state')
}

export function withSerializedFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = normalizedLockKey(filePath)
  const pending = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(operation)
  writes.set(key, pending)
  void pending.finally(() => { if (writes.get(key) === pending) writes.delete(key) }).catch(() => undefined)
  return pending
}

export async function assertRegularDestinationFile(destinationPath: string, label = 'Control file') {
  const existing = await fs.lstat(destinationPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing && !existing.isFile()) {
    throw new Error(`${label} must be a regular file.`)
  }
  return existing
}

async function resolveRealPathThroughExistingAncestor(candidatePath: string): Promise<string> {
  const absolute = path.resolve(candidatePath)
  let current = absolute
  const remainder: string[] = []
  while (true) {
    try {
      const realCurrent = await fs.realpath(current)
      return remainder.length ? path.join(realCurrent, ...remainder.reverse()) : realCurrent
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) return absolute
      remainder.push(path.basename(current))
      current = parent
    }
  }
}

export async function assertContainedRegularFilePath(
  targetPath: string,
  options: {
    allowedRoots?: string[]
    allowedExactFiles?: string[]
    isPathUnder?: (baseDir: string, targetPath: string) => boolean
    samePath?: (left: string, right: string) => boolean
    label?: string
  },
): Promise<string> {
  const label = options.label || 'Target file'
  const isPathUnder = options.isPathUnder || defaultIsPathUnder
  const samePath = options.samePath || defaultSamePath
  const resolvedTarget = path.resolve(targetPath)

  await assertRegularDestinationFile(resolvedTarget, label)
  const realTarget = await resolveRealPathThroughExistingAncestor(resolvedTarget)

  const roots = options.allowedRoots || []
  for (const root of roots) {
    const realRoot = await resolveRealPathThroughExistingAncestor(root)
    if (isPathUnder(realRoot, realTarget)) return realTarget
  }

  const exactFiles = options.allowedExactFiles || []
  for (const allowedFile of exactFiles) {
    await assertRegularDestinationFile(path.resolve(allowedFile), label)
    const realAllowed = await resolveRealPathThroughExistingAncestor(allowedFile)
    if (samePath(realAllowed, realTarget)) return realTarget
  }

  throw new Error(`${label} resolved outside allowed workspace root.`)
}

export async function replaceFileAtomicallyWithLockRetry(
  temporaryPath: string,
  destinationPath: string,
  options: { platform?: NodeJS.Platform; rename?: typeof fs.rename; copyFile?: typeof fs.copyFile } = {},
) {
  const rename = options.rename || fs.rename
  const copyFile = options.copyFile || fs.copyFile
  const platform = options.platform || process.platform
  try {
    await retryTransientFileLock(() => rename(temporaryPath, destinationPath))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (platform !== 'win32' || (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EACCES')) throw error
    await retryTransientFileLock(() => copyFile(temporaryPath, destinationPath))
  }
}

/** Serialize the compare/write boundary and publish a fully flushed temporary file. */
export function writeAtomicControlFile(file: string, content: string, expectedRevision?: string): Promise<string> {
  const destination = path.resolve(file)
  const readCurrent = () => fs.readFile(destination, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
  return withSerializedFileLock(destination, async () => {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    if (expectedRevision !== undefined && controlFileRevision(await readCurrent()) !== expectedRevision) throw new ControlFileConflict()
    const existing = await assertRegularDestinationFile(destination, 'Control file')
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`)
    try {
      const handle = await fs.open(temporary, 'wx', existing ? existing.mode & 0o777 : 0o600)
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      if (expectedRevision !== undefined && controlFileRevision(await readCurrent()) !== expectedRevision) throw new ControlFileConflict()
      await replaceFileAtomicallyWithLockRetry(temporary, destination)
      return controlFileRevision(content)
    } finally {
      await fs.unlink(temporary).catch(() => undefined)
    }
  })
}

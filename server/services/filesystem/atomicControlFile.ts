import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const writes = new Map<string, Promise<unknown>>()
export function controlFileRevision(content: string) { return createHash('sha256').update(content).digest('hex') }
export class ControlFileConflict extends Error {
  constructor() { super('This file changed after it was opened. Review the version on disk before saving.'); this.name = 'ControlFileConflict' }
}

/** Serialize the compare/write boundary and publish a fully flushed temporary file. */
export function writeAtomicControlFile(file: string, content: string, expectedRevision?: string): Promise<string> {
  const destination = path.resolve(file)
  const readCurrent = () => fs.readFile(destination, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
  const write = (writes.get(destination) || Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    if (expectedRevision !== undefined && controlFileRevision(await readCurrent()) !== expectedRevision) throw new ControlFileConflict()
    const existing = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    if (existing && !existing.isFile()) throw new Error('Control file must be a regular file.')
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`)
    try {
      const handle = await fs.open(temporary, 'wx', existing ? existing.mode & 0o777 : 0o600)
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      if (expectedRevision !== undefined && controlFileRevision(await readCurrent()) !== expectedRevision) throw new ControlFileConflict()
      await fs.rename(temporary, destination)
      return controlFileRevision(content)
    } finally { await fs.unlink(temporary).catch(() => undefined) }
  })
  writes.set(destination, write)
  void write.finally(() => { if (writes.get(destination) === write) writes.delete(destination) }).catch(() => undefined)
  return write
}

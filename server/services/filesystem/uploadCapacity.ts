import { promises as fs } from 'node:fs'
import path from 'node:path'

const queues = new Map<string, { tail: Promise<unknown>; pending: number }>()
/** Admission checks and writes share a queue across service instances in this process. */
export async function withUploadCapacity<T>(directory: string, bytes: number, limits: { bytes: number; files: number }, write: () => Promise<T>): Promise<T> {
  const root = path.resolve(directory)
  const queue = queues.get(root) || { tail: Promise.resolve(), pending: 0 }
  if (queue.pending >= 16) throw new Error('Several attachments are uploading. Wait for them to finish, then retry.')
  queue.pending += 1
  queues.set(root, queue)
  const pending = queue.tail.catch(() => undefined).then(async () => {
    await fs.mkdir(root, { recursive: true })
    let totalBytes = 0
    let totalFiles = 0
    const entries = await fs.opendir(root)
    for await (const entry of entries) {
      totalFiles += 1
      // Count metadata, old uploads and unknown files too. Never follow symlinks.
      if (totalFiles + 2 > limits.files) throw new Error('Attachment storage reached its file limit. Archive older files from the command uploads folder before retrying.')
      const stat = await fs.lstat(path.join(root, entry.name))
      totalBytes += stat.size
      if (totalBytes + bytes + 16_384 > limits.bytes) throw new Error('Attachment storage is full. Archive older files from the command uploads folder before retrying.')
    }
    if (bytes + 16_384 > limits.bytes || 2 > limits.files) throw new Error('This attachment exceeds the available upload storage capacity.')
    return write()
  })
  queue.tail = pending
  try { return await pending } finally {
    queue.pending -= 1
    if (!queue.pending && queues.get(root) === queue) queues.delete(root)
  }
}

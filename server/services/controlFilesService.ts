import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ControlFileConflict,
  assertContainedRegularFilePath,
  controlFileRevision,
  writeAtomicControlFile,
} from './filesystem/atomicControlFile'
import { isPathUnder as defaultIsPathUnder } from './filesystem/safePathService'

export { ControlFileConflict, controlFileRevision }

export const CONTROL_FILES = ['AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'] as const

export type ControlFile = (typeof CONTROL_FILES)[number]
export type ControlFilesServiceOptions = {
  isPathUnder?: (baseDir: string, targetPath: string) => boolean
}

export function isAllowedControlFile(file: string): file is ControlFile {
  return (CONTROL_FILES as readonly string[]).includes(file)
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

export function createControlFilesService(workspaceRoot: string, options: ControlFilesServiceOptions = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  const isPathUnder = options.isPathUnder ?? defaultIsPathUnder

  function resolveControlFilePath(file: string) {
    if (!isAllowedControlFile(file)) {
      throw new Error('File is not in allowed control list.')
    }
    const targetPath = path.resolve(resolvedWorkspaceRoot, file)
    if (!isPathUnder(resolvedWorkspaceRoot, targetPath)) {
      throw new Error('Control file path resolved outside workspace root.')
    }
    return targetPath
  }

  async function assertContainedControlFile(targetPath: string) {
    let realWorkspaceRoot: string
    try {
      realWorkspaceRoot = await resolveRealPathThroughExistingAncestor(resolvedWorkspaceRoot)
    } catch {
      throw new Error('Control file path resolved outside workspace root.')
    }

    const rootStats = await fs.lstat(resolvedWorkspaceRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (rootStats && (rootStats.isSymbolicLink() || !rootStats.isDirectory())) {
      throw new Error('Control file workspace root must be a regular directory (outside workspace root).')
    }

    const stats = await fs.lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })

    if (stats?.isSymbolicLink()) {
      const realTargetPath = await fs.realpath(targetPath).catch(() => null)
      if (!realTargetPath || !defaultIsPathUnder(realWorkspaceRoot, realTargetPath)) {
        throw new Error('Control file path resolved outside workspace root.')
      }
      throw new Error('Control file must be a regular file.')
    }

    if (stats && !stats.isFile()) {
      throw new Error('Control file must be a regular file.')
    }

    try {
      await assertContainedRegularFilePath(targetPath, {
        allowedRoots: [resolvedWorkspaceRoot],
        label: 'Control file',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/outside allowed workspace root/i.test(message)) {
        throw new Error('Control file path resolved outside workspace root.')
      }
      throw error
    }
  }

  return {
    files: CONTROL_FILES,
    isAllowedFile: isAllowedControlFile,
    resolveFilePath: resolveControlFilePath,
    revision: controlFileRevision,
    async readFile(file: string) {
      const targetPath = resolveControlFilePath(file)
      await assertContainedControlFile(targetPath)
      const content = await fs.readFile(targetPath, 'utf-8')
      await assertContainedControlFile(targetPath)
      return content
    },
    async readFileWithRevision(file: string) {
      const targetPath = resolveControlFilePath(file)
      await assertContainedControlFile(targetPath)
      const content = await fs.readFile(targetPath, 'utf-8')
      await assertContainedControlFile(targetPath)
      return { content, revision: controlFileRevision(content) }
    },
    async writeFile(file: string, content: string, expectedRevision?: string) {
      const targetPath = resolveControlFilePath(file)
      await assertContainedControlFile(targetPath)
      return writeAtomicControlFile(targetPath, content, expectedRevision)
    },
  }
}

export type ControlFilesService = ReturnType<typeof createControlFilesService>

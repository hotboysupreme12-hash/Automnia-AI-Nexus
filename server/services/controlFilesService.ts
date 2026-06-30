import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isPathUnder as defaultIsPathUnder } from './filesystem/safePathService'

export const CONTROL_FILES = ['AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'] as const

export type ControlFile = (typeof CONTROL_FILES)[number]
export type ControlFilesServiceOptions = {
  isPathUnder?: (baseDir: string, targetPath: string) => boolean
}

export function isAllowedControlFile(file: string): file is ControlFile {
  return (CONTROL_FILES as readonly string[]).includes(file)
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

  async function assertExistingControlFilePathInsideWorkspace(targetPath: string) {
    let stats: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stats = await fs.lstat(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    if (!stats.isSymbolicLink()) return

    let realWorkspaceRoot: string
    let realTargetPath: string
    try {
      [realWorkspaceRoot, realTargetPath] = await Promise.all([
        fs.realpath(resolvedWorkspaceRoot),
        fs.realpath(targetPath),
      ])
    } catch {
      throw new Error('Control file path resolved outside workspace root.')
    }

    if (!isPathUnder(realWorkspaceRoot, realTargetPath)) {
      throw new Error('Control file path resolved outside workspace root.')
    }
  }

  return {
    files: CONTROL_FILES,
    isAllowedFile: isAllowedControlFile,
    resolveFilePath: resolveControlFilePath,
    async readFile(file: string) {
      const targetPath = resolveControlFilePath(file)
      await assertExistingControlFilePathInsideWorkspace(targetPath)
      return fs.readFile(targetPath, 'utf-8')
    },
    async writeFile(file: string, content: string) {
      const targetPath = resolveControlFilePath(file)
      await assertExistingControlFilePathInsideWorkspace(targetPath)
      await fs.writeFile(targetPath, content, 'utf-8')
    },
  }
}

export type ControlFilesService = ReturnType<typeof createControlFilesService>

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const CONTROL_FILES = ['AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'] as const

export type ControlFile = (typeof CONTROL_FILES)[number]

export function isAllowedControlFile(file: string): file is ControlFile {
  return (CONTROL_FILES as readonly string[]).includes(file)
}

export function createControlFilesService(workspaceRoot: string) {
  return {
    files: CONTROL_FILES,
    isAllowedFile: isAllowedControlFile,
    async readFile(file: string) {
      return fs.readFile(path.join(workspaceRoot, file), 'utf-8')
    },
    async writeFile(file: string, content: string) {
      await fs.writeFile(path.join(workspaceRoot, file), content, 'utf-8')
    },
  }
}

export type ControlFilesService = ReturnType<typeof createControlFilesService>

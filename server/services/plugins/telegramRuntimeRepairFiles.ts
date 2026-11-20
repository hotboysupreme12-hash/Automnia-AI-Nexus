import { promises as fs } from 'node:fs'
import path from 'node:path'

// Only repair the runtime that will actually be launched. Packaged resources
// are an immutable template; scanning them as well can fail under Program Files.
export async function telegramRuntimeRepairFiles(activeRoot: string): Promise<string[]> {
  if (!activeRoot) return []
  const distRoot = path.join(activeRoot, 'dist')
  const entries = await fs.readdir(distRoot, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => {
      const lowerName = entry.name.toLowerCase()
      return entry.isFile() && (lowerName.includes('telegram') || lowerName.startsWith('bot-message-'))
    })
    .map((entry) => path.join(distRoot, entry.name))
}

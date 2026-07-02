import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export type LegacyConfigHealthCleanupResult = {
  archived: boolean
  reason: string
  sourcePath: string
  archivePath?: string
  entries: number
}

export type LegacyConfigHealthCleanupOptions = {
  stateRoot: string
}

function legacyConfigHealthPath(stateRoot: string) {
  return path.join(stateRoot, 'logs', 'config-health.json')
}

function archiveStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function countLegacyConfigHealthEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0

  const record = value as Record<string, unknown>
  for (const key of ['entries', 'health', 'snapshots', 'history', 'fingerprints']) {
    const candidate = record[key]
    if (Array.isArray(candidate)) return candidate.length
    if (candidate && typeof candidate === 'object') return Object.keys(candidate).length
  }
  return Object.keys(record).length ? 1 : 0
}

function parseLegacyConfigHealthEntries(raw: string) {
  try {
    return countLegacyConfigHealthEntries(JSON.parse(raw.replace(/^\uFEFF/, '')))
  } catch {
    return 0
  }
}

async function nextArchivePath(archiveDir: string) {
  const base = `config-health.legacy-${archiveStamp()}`
  let candidate = path.join(archiveDir, `${base}.json`)
  for (let index = 2; existsSync(candidate); index += 1) {
    candidate = path.join(archiveDir, `${base}-${index}.json`)
  }
  return candidate
}

export async function archiveCoveredLegacyConfigHealthState(
  options: LegacyConfigHealthCleanupOptions,
): Promise<LegacyConfigHealthCleanupResult> {
  const sourcePath = legacyConfigHealthPath(options.stateRoot)
  if (!existsSync(sourcePath)) {
    return {
      archived: false,
      reason: 'legacy config health state not present',
      sourcePath,
      entries: 0,
    }
  }

  const raw = await fs.readFile(sourcePath, 'utf-8').catch(() => '')
  const entries = parseLegacyConfigHealthEntries(raw)
  const archiveDir = path.join(path.dirname(sourcePath), 'archive')
  await fs.mkdir(archiveDir, { recursive: true })
  const archivePath = await nextArchivePath(archiveDir)
  await fs.rename(sourcePath, archivePath)

  return {
    archived: true,
    reason: 'legacy config health state archived because OpenClaw stores config health in SQLite',
    sourcePath,
    archivePath,
    entries,
  }
}

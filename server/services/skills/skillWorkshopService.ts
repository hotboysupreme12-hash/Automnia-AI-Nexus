import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type Dirent } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, opendir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SkillWorkshopSource = 'library' | 'agent'
export type SkillIntegrityFile = { path: string; sizeBytes: number; mode: number; sha256: string }
export type SkillIntegrity = {
  files: SkillIntegrityFile[]
  totalBytes: number
  sha256: string
  symlinksSkipped: number
}
export type SkillIntegrityComparison = {
  status: 'unverified' | 'unchanged' | 'changed'
  baseline: { revisionId: string; verifiedAt: string; sha256: string } | null
  revisionCount: number
  canRollback: boolean
  current: SkillIntegrity
  added: string[]
  removed: string[]
  modified: string[]
}

type SkillRevision = {
  revisionId: string
  verifiedAt: string
  sha256: string
  files: SkillIntegrityFile[]
}

type QuarantineRecord = {
  quarantineId: string
  reason: string
  movedAt: string
}

type SkillRecord = {
  source: SkillWorkshopSource
  agentId: string | null
  skillId: string
  revisions: SkillRevision[]
  activeRevisionId: string | null
  quarantine?: QuarantineRecord
}

type SkillLedger = { version: 1; skills: Record<string, SkillRecord> }

const MAX_SKILL_FILES = 400
const MAX_SKILL_BYTES = 32 * 1024 * 1024
const MAX_SKILL_FILE_BYTES = 8 * 1024 * 1024
const MAX_SKILL_DEPTH = 10
const MAX_SKILL_ENTRIES = 2_000
const MAX_SKILL_DIRECTORIES = 256
const MAX_REVISIONS_PER_SKILL = 12
const MAX_SKILL_RECORDS = 1_000
const MAX_SNAPSHOT_SCAN_ENTRIES = 100_000
export const MAX_SKILL_WORKSHOP_LEDGER_BYTES = 4 * 1024 * 1024
export const MAX_SKILL_WORKSHOP_TOTAL_SNAPSHOT_BYTES = 512 * 1024 * 1024
export const MAX_SKILL_WORKSHOP_SKILL_SNAPSHOT_BYTES = 96 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const HARD_STORAGE_LIMITS = {
  ledgerBytes: MAX_SKILL_WORKSHOP_LEDGER_BYTES,
  totalSnapshotBytes: MAX_SKILL_WORKSHOP_TOTAL_SNAPSHOT_BYTES,
  perSkillSnapshotBytes: MAX_SKILL_WORKSHOP_SKILL_SNAPSHOT_BYTES,
  revisionsPerSkill: MAX_REVISIONS_PER_SKILL,
  skillRecords: MAX_SKILL_RECORDS,
} as const
export type SkillWorkshopStorageLimits = {
  ledgerBytes: number
  totalSnapshotBytes: number
  perSkillSnapshotBytes: number
  revisionsPerSkill: number
  skillRecords: number
}
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const REVISION_ID_PATTERN = /^[a-f0-9-]{36}$/i

export class SkillWorkshopError extends Error {
  readonly code: 'skill_invalid' | 'skill_path_unsafe' | 'skill_not_found' | 'skill_revision_missing' | 'skill_quarantined' | 'skill_workshop_limit'

  constructor(code: SkillWorkshopError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'SkillWorkshopError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeSkillId(value: string) {
  const id = value.trim()
  if (!SKILL_ID_PATTERN.test(id)) throw new SkillWorkshopError('skill_path_unsafe', 'Skill id is invalid.')
  return id
}

function recordKey(source: SkillWorkshopSource, agentId: string | undefined, skillId: string) {
  return JSON.stringify([source, source === 'agent' ? agentId?.trim() || '' : '', skillId.toLowerCase()])
}

function isMissing(error: unknown) {
  return isRecord(error) && error.code === 'ENOENT'
}

function boundedLimit(value: number | undefined, maximum: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : maximum
}

function resolveSkillDirectory(rootInput: string, skillIdInput: string) {
  const root = path.resolve(rootInput)
  const skillId = safeSkillId(skillIdInput)
  const target = path.resolve(root, skillId)
  const relative = path.relative(root, target)
  if (relative !== skillId || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new SkillWorkshopError('skill_path_unsafe', 'Skill path is outside its configured root.')
  }
  return { root, target, skillId }
}

async function assertNoSymlinkComponents(targetInput: string) {
  const target = path.resolve(targetInput)
  const parsed = path.parse(target)
  let current = parsed.root
  const components = target.slice(parsed.root.length).split(path.sep).filter(Boolean)
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]!)
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
    if (stat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill paths cannot traverse symbolic links.')
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new SkillWorkshopError('skill_path_unsafe', 'A skill path component is not a directory.')
    }
  }
  return true
}

async function ensureDirectoryWithoutSymlinks(targetInput: string) {
  const target = path.resolve(targetInput)
  const parsed = path.parse(target)
  let current = parsed.root
  for (const component of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if (!isMissing(error)) throw error
      await mkdir(current).catch((mkdirError) => {
        if (!isRecord(mkdirError) || mkdirError.code !== 'EEXIST') throw mkdirError
      })
      stat = await lstat(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill workshop paths cannot traverse symbolic links or files.')
  }
}

async function assertSafeSkillDirectory(root: string, directory: string) {
  const relative = path.relative(root, directory)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SkillWorkshopError('skill_path_unsafe', 'Skill path is outside its configured root.')
  }
  if (!await assertNoSymlinkComponents(root) || !await assertNoSymlinkComponents(directory)) {
    throw new SkillWorkshopError('skill_not_found', 'Skill files are unavailable.')
  }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillWorkshopError('skill_invalid', 'Skill directory is invalid.')
}

function safeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return false
  const parts = normalized.split('/')
  return parts.every((part) => Boolean(part) && part !== '.' && part !== '..')
}

async function collectSkillIntegrityFiles(root: string, skillDir: string): Promise<SkillIntegrity> {
  const files: SkillIntegrityFile[] = []
  let totalBytes = 0
  let entriesVisited = 0
  let directoriesVisited = 0

  async function visit(currentDir: string, relativeDir: string, depth: number): Promise<void> {
    if (depth > MAX_SKILL_DEPTH) throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceed the maximum directory depth.')
    directoriesVisited += 1
    if (directoriesVisited > MAX_SKILL_DIRECTORIES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceed the directory scan limit.')
    await assertSafeSkillDirectory(root, currentDir)
    const entries: Dirent[] = []
    const directory = await opendir(currentDir)
    for await (const entry of directory) {
      entriesVisited += 1
      if (entriesVisited > MAX_SKILL_ENTRIES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceed the entry scan limit.')
      entries.push(entry)
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      const relativePath = path.posix.join(relativeDir, entry.name)
      if (!safeRelativePath(relativePath)) throw new SkillWorkshopError('skill_path_unsafe', 'Skill support file path is unsafe.')
      if (entry.isSymbolicLink()) throw new SkillWorkshopError('skill_invalid', 'Skill support files cannot be symbolic links.')
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= MAX_SKILL_FILES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceed the file scan limit.')
      const before = await lstat(absolutePath)
      if (!before.isFile() || before.isSymbolicLink()) throw new SkillWorkshopError('skill_invalid', 'Skill support file is invalid.')
      if (before.size > MAX_SKILL_FILE_BYTES) throw new SkillWorkshopError('skill_workshop_limit', 'A skill support file exceeds the per-file scan limit.')
      if (totalBytes + before.size > MAX_SKILL_BYTES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceed the total scan limit.')
      const hash = createHash('sha256')
      let sizeBytes = 0
      const stream = createReadStream(absolutePath, { highWaterMark: READ_CHUNK_BYTES })
      try {
        for await (const chunk of stream) {
          sizeBytes += chunk.byteLength
          if (sizeBytes > MAX_SKILL_FILE_BYTES || totalBytes + sizeBytes > MAX_SKILL_BYTES) {
            throw new SkillWorkshopError('skill_workshop_limit', 'Skill support files exceeded a byte limit while being read.')
          }
          hash.update(chunk)
        }
      } catch (error) {
        stream.destroy()
        throw error
      }
      const after = await lstat(absolutePath)
      if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new SkillWorkshopError('skill_invalid', 'A skill support file changed while it was being inspected.')
      }
      totalBytes += sizeBytes
      files.push({ path: relativePath, sizeBytes, mode: before.mode & 0o777, sha256: hash.digest('hex') })
    }
  }

  await visit(skillDir, '', 0)
  return {
    files,
    totalBytes,
    symlinksSkipped: 0,
    sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  }
}

function emptyLedger(): SkillLedger {
  return { version: 1, skills: {} }
}

function normalizeRevision(value: unknown): SkillRevision | null {
  if (!isRecord(value) || typeof value.revisionId !== 'string' || !REVISION_ID_PATTERN.test(value.revisionId)
    || typeof value.verifiedAt !== 'string' || typeof value.sha256 !== 'string' || !Array.isArray(value.files)) return null
  const files = value.files.flatMap((file) => {
    if (!isRecord(file) || typeof file.path !== 'string' || !safeRelativePath(file.path)
      || typeof file.sizeBytes !== 'number' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0
      || typeof file.mode !== 'number' || !Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)) return []
    return [{ path: file.path, sizeBytes: file.sizeBytes, mode: file.mode, sha256: file.sha256 }]
  })
  if (files.length !== value.files.length || files.length > MAX_SKILL_FILES
    || files.some((file) => file.sizeBytes > MAX_SKILL_FILE_BYTES)
    || files.reduce((total, file) => total + file.sizeBytes, 0) > MAX_SKILL_BYTES) return null
  return { revisionId: value.revisionId, verifiedAt: value.verifiedAt, sha256: value.sha256, files }
}

function normalizeLedger(value: unknown, limits: SkillWorkshopStorageLimits): SkillLedger {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.skills)) return emptyLedger()
  if (Object.keys(value.skills).length > limits.skillRecords) {
    throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the record limit.')
  }
  const skills: Record<string, SkillRecord> = {}
  for (const [key, item] of Object.entries(value.skills)) {
    if (!isRecord(item) || (item.source !== 'agent' && item.source !== 'library') || typeof item.skillId !== 'string'
      || !SKILL_ID_PATTERN.test(item.skillId) || (item.agentId !== null && typeof item.agentId !== 'string')
      || !Array.isArray(item.revisions)) continue
    const normalizedRevisions = item.revisions.flatMap((revision) => {
      const normalized = normalizeRevision(revision)
      return normalized ? [normalized] : []
    })
    const activeRevisionId = typeof item.activeRevisionId === 'string'
      && normalizedRevisions.some((revision) => revision.revisionId === item.activeRevisionId)
      ? item.activeRevisionId
      : null
    let revisions = normalizedRevisions
    if (revisions.length > limits.revisionsPerSkill) {
      const recent = revisions.slice(-limits.revisionsPerSkill)
      if (activeRevisionId && !recent.some((revision) => revision.revisionId === activeRevisionId)) {
        revisions = [...normalizedRevisions.filter((revision) => revision.revisionId === activeRevisionId), ...recent.slice(-(limits.revisionsPerSkill - 1))]
      } else revisions = recent
    }
    const quarantine = isRecord(item.quarantine) && typeof item.quarantine.quarantineId === 'string'
      && REVISION_ID_PATTERN.test(item.quarantine.quarantineId) && typeof item.quarantine.reason === 'string'
      && typeof item.quarantine.movedAt === 'string'
      ? { quarantineId: item.quarantine.quarantineId, reason: item.quarantine.reason.slice(0, 200), movedAt: item.quarantine.movedAt }
      : undefined
    skills[key] = {
      source: item.source,
      agentId: typeof item.agentId === 'string' ? item.agentId : null,
      skillId: item.skillId,
      revisions,
      activeRevisionId,
      ...(quarantine ? { quarantine } : {}),
    }
  }
  return { version: 1, skills }
}

export function createSkillWorkshopService(
  sharedSkillsRoot: string,
  now: () => Date = () => new Date(),
  requestedLimits: Partial<SkillWorkshopStorageLimits> = {},
) {
  const limits: SkillWorkshopStorageLimits = {
    ledgerBytes: boundedLimit(requestedLimits.ledgerBytes, HARD_STORAGE_LIMITS.ledgerBytes),
    totalSnapshotBytes: boundedLimit(requestedLimits.totalSnapshotBytes, HARD_STORAGE_LIMITS.totalSnapshotBytes),
    perSkillSnapshotBytes: boundedLimit(requestedLimits.perSkillSnapshotBytes, HARD_STORAGE_LIMITS.perSkillSnapshotBytes),
    revisionsPerSkill: Math.max(2, boundedLimit(requestedLimits.revisionsPerSkill, HARD_STORAGE_LIMITS.revisionsPerSkill)),
    skillRecords: boundedLimit(requestedLimits.skillRecords, HARD_STORAGE_LIMITS.skillRecords),
  }
  const sharedRoot = path.resolve(sharedSkillsRoot)
  const storeRoot = path.join(path.dirname(sharedRoot), `.${path.basename(sharedRoot)}-automnia-skill-workshop`)
  const statePath = path.join(storeRoot, 'state.json')
  let mutationQueue: Promise<void> = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  function keyFor(source: SkillWorkshopSource, agentId: string | undefined, skillId: string) {
    return recordKey(source, agentId, safeSkillId(skillId))
  }

  function safeRecordDirectory(relativeDir: string) {
    const target = path.resolve(storeRoot, relativeDir)
    const relative = path.relative(storeRoot, target)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SkillWorkshopError('skill_path_unsafe', 'Skill workshop storage path is unsafe.')
    }
    return target
  }

  function snapshotDirectory(key: string, revisionId: string) {
    return safeRecordDirectory(path.join('revisions', createHash('sha256').update(key).digest('hex'), revisionId))
  }

  function cloneLedger(ledger: SkillLedger): SkillLedger {
    return JSON.parse(JSON.stringify(ledger)) as SkillLedger
  }

  function serializedLedgerBytes(ledger: SkillLedger) {
    return Buffer.byteLength(`${JSON.stringify(ledger)}\n`, 'utf8')
  }

  function ledgerSnapshotBytes(ledger: SkillLedger) {
    let total = 0
    for (const record of Object.values(ledger.skills)) {
      for (const revision of record.revisions) {
        total += revision.files.reduce((revisionTotal, file) => revisionTotal + file.sizeBytes, 0)
      }
    }
    return total
  }

  function skillSnapshotBytes(record: SkillRecord | undefined) {
    return (record?.revisions || []).reduce((recordTotal, revision) =>
      recordTotal + revision.files.reduce((revisionTotal, file) => revisionTotal + file.sizeBytes, 0), 0)
  }

  async function removeOrphanSnapshots(ledger: SkillLedger) {
    const revisionsRoot = safeRecordDirectory('revisions')
    try {
      const stat = await lstat(revisionsRoot)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision storage is unsafe.')
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    const referenced = new Set<string>()
    for (const [key, record] of Object.entries(ledger.skills)) {
      const hash = createHash('sha256').update(key).digest('hex')
      for (const revision of record.revisions) referenced.add(`${hash}/${revision.revisionId}`)
    }
    let scanned = 0
    const root = await opendir(revisionsRoot)
    for await (const keyEntry of root) {
      scanned += 1
      if (scanned > MAX_SKILL_RECORDS * 2) throw new SkillWorkshopError('skill_workshop_limit', 'Skill revision storage exceeds the scan limit.')
      if (!keyEntry.isDirectory() || keyEntry.isSymbolicLink() || !/^[a-f0-9]{64}$/i.test(keyEntry.name)) {
        throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision storage contains an unsafe path.')
      }
      const keyDirectory = path.join(revisionsRoot, keyEntry.name)
      const revisions = await opendir(keyDirectory)
      for await (const revisionEntry of revisions) {
        scanned += 1
        if (scanned > MAX_SKILL_RECORDS * (MAX_REVISIONS_PER_SKILL + 2)) {
          throw new SkillWorkshopError('skill_workshop_limit', 'Skill revision storage exceeds the scan limit.')
        }
        if (!revisionEntry.isDirectory() || revisionEntry.isSymbolicLink() || !REVISION_ID_PATTERN.test(revisionEntry.name)) {
          throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision storage contains an unsafe path.')
        }
        if (!referenced.has(`${keyEntry.name}/${revisionEntry.name}`)) {
          await rm(path.join(keyDirectory, revisionEntry.name), { recursive: true, force: true })
        }
      }
    }
  }

  async function validateSnapshotAccounting(ledger: SkillLedger) {
    let totalScannedEntries = 0
    let totalSnapshotBytes = 0
    for (const [key, record] of Object.entries(ledger.skills)) {
      for (const revision of record.revisions) {
        const revisionDir = snapshotDirectory(key, revision.revisionId)
        if (!await assertNoSymlinkComponents(revisionDir)) {
          throw new SkillWorkshopError('skill_invalid', 'A verified skill snapshot is missing.')
        }
        const rootStat = await lstat(revisionDir)
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision storage is unsafe.')
        let revisionBytes = 0
        let fileCount = 0
        let directoryCount = 0
        let entryCount = 0
        const visit = async (directoryPath: string, depth: number): Promise<void> => {
          if (depth > MAX_SKILL_DEPTH) throw new SkillWorkshopError('skill_workshop_limit', 'Skill revision exceeds the directory depth limit.')
          directoryCount += 1
          if (directoryCount > MAX_SKILL_DIRECTORIES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill revision exceeds the directory scan limit.')
          const directory = await opendir(directoryPath)
          for await (const entry of directory) {
            entryCount += 1
            totalScannedEntries += 1
            if (entryCount > MAX_SKILL_ENTRIES || totalScannedEntries > MAX_SNAPSHOT_SCAN_ENTRIES) {
              throw new SkillWorkshopError('skill_workshop_limit', 'Skill snapshots exceed the storage scan limit.')
            }
            if (entry.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill snapshots cannot contain symbolic links.')
            const absolutePath = path.join(directoryPath, entry.name)
            if (entry.isDirectory()) {
              await visit(absolutePath, depth + 1)
              continue
            }
            if (!entry.isFile()) throw new SkillWorkshopError('skill_invalid', 'Skill snapshot contains an unsupported filesystem entry.')
            fileCount += 1
            if (fileCount > MAX_SKILL_FILES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill snapshot exceeds the file scan limit.')
            const stat = await lstat(absolutePath)
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_FILE_BYTES) {
              throw new SkillWorkshopError('skill_invalid', 'Skill snapshot file is invalid.')
            }
            revisionBytes += stat.size
            if (revisionBytes > MAX_SKILL_BYTES) throw new SkillWorkshopError('skill_workshop_limit', 'Skill snapshot exceeds its byte limit.')
          }
        }
        await visit(revisionDir, 0)
        const expectedRevisionBytes = revision.files.reduce((sum, file) => sum + file.sizeBytes, 0)
        if (revisionBytes !== expectedRevisionBytes) throw new SkillWorkshopError('skill_invalid', 'Skill snapshot size differs from its verified manifest.')
        totalSnapshotBytes += revisionBytes
      }
    }
    if (totalSnapshotBytes !== ledgerSnapshotBytes(ledger)) {
      throw new SkillWorkshopError('skill_invalid', 'Skill snapshot storage differs from its verified manifests.')
    }
    return totalScannedEntries
  }

  function planRevisionEvictions(ledger: SkillLedger, key: string, revision: SkillRevision) {
    const candidate = cloneLedger(ledger)
    const originalRecord = ledger.skills[key]
    const originalActiveId = originalRecord?.activeRevisionId || null
    const record = candidate.skills[key] || {
      source: originalRecord?.source || 'library',
      agentId: originalRecord?.agentId || null,
      skillId: originalRecord?.skillId || key,
      revisions: [],
      activeRevisionId: null,
    }
    candidate.skills[key] = record
    record.revisions.push(revision)
    record.activeRevisionId = revision.revisionId

    const protectedIds = new Set<string>([revision.revisionId])
    for (const oldRecord of Object.values(ledger.skills)) {
      if (oldRecord.activeRevisionId) protectedIds.add(oldRecord.activeRevisionId)
    }
    const removeOneOldRevision = () => {
      const removable = Object.entries(candidate.skills).flatMap(([recordKey, item]) => item.revisions
        .filter((itemRevision) => !protectedIds.has(itemRevision.revisionId))
        .map((itemRevision) => ({ recordKey, itemRevision })))
        .sort((left, right) => left.itemRevision.verifiedAt.localeCompare(right.itemRevision.verifiedAt))[0]
      if (!removable) return false
      const target = candidate.skills[removable.recordKey]!
      target.revisions = target.revisions.filter((itemRevision) => itemRevision.revisionId !== removable.itemRevision.revisionId)
      return true
    }

    if (Object.keys(candidate.skills).length > limits.skillRecords) {
      throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the record limit.')
    }
    while (true) {
      const hasTooManyRevisions = Object.values(candidate.skills).some((item) => item.revisions.length > limits.revisionsPerSkill)
      const hasOversizedSkill = Object.values(candidate.skills).some((item) => skillSnapshotBytes(item) > limits.perSkillSnapshotBytes)
      const hasOversizedStore = ledgerSnapshotBytes(candidate) > limits.totalSnapshotBytes
      const hasOversizedLedger = serializedLedgerBytes(candidate) > limits.ledgerBytes
      if (!hasTooManyRevisions && !hasOversizedSkill && !hasOversizedStore && !hasOversizedLedger) break
      if (!removeOneOldRevision()) {
        throw new SkillWorkshopError('skill_workshop_limit', 'Verified snapshots exceed the configured storage limits; active baselines were preserved.')
      }
    }

    const retained = new Map(Object.entries(candidate.skills).map(([recordKey, item]) =>
      [recordKey, new Set(item.revisions.map((itemRevision) => itemRevision.revisionId))]))
    const evicted = Object.entries(ledger.skills).flatMap(([recordKey, oldRecord]) => oldRecord.revisions
      .filter((oldRevision) => !retained.get(recordKey)?.has(oldRevision.revisionId))
      .map((oldRevision) => ({ key: recordKey, revisionId: oldRevision.revisionId })))

    const interim = cloneLedger(candidate)
    const interimTarget = interim.skills[key]
    if (interimTarget) {
      interimTarget.revisions = interimTarget.revisions.filter((itemRevision) => itemRevision.revisionId !== revision.revisionId)
      interimTarget.activeRevisionId = originalActiveId
      if (!originalRecord) delete interim.skills[key]
    }
    return { candidate, interim, evicted, hasEvictions: evicted.length > 0 }
  }

  async function ensureStore() {
    await ensureDirectoryWithoutSymlinks(storeRoot)
  }

  async function readLedger() {
    await ensureStore()
    let stateWasFound = false
    try {
      const stateStat = await lstat(statePath)
      stateWasFound = true
      if (!stateStat.isFile() || stateStat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill workshop state path is unsafe.')
      if (stateStat.size > limits.ledgerBytes) throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the storage limit.')
      const chunks: Buffer[] = []
      let bytesRead = 0
      const stream = createReadStream(statePath, { highWaterMark: READ_CHUNK_BYTES })
      try {
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytesRead += bytes.byteLength
          if (bytesRead > limits.ledgerBytes) {
            stream.destroy()
            throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the storage limit.')
          }
          chunks.push(bytes)
        }
      } catch (error) {
        stream.destroy()
        throw error
      }
      const after = await lstat(statePath)
      if (!after.isFile() || after.isSymbolicLink() || after.size !== stateStat.size || bytesRead !== stateStat.size) {
        throw new SkillWorkshopError('skill_invalid', 'Skill workshop state changed while it was being read.')
      }
      return normalizeLedger(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown, limits)
    } catch (error) {
      if (isMissing(error) && !stateWasFound) return emptyLedger()
      if (error instanceof SkillWorkshopError) throw error
      throw new SkillWorkshopError('skill_invalid', 'Skill workshop state could not be read safely.')
    }
  }

  async function writeLedger(ledger: SkillLedger) {
    await ensureStore()
    try {
      const currentStat = await lstat(statePath)
      if (!currentStat.isFile() || currentStat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill workshop state path is unsafe.')
      if (currentStat.size > limits.ledgerBytes) throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the storage limit.')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const temporary = `${statePath}.${randomUUID()}.tmp`
    const serialized = `${JSON.stringify(ledger)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > limits.ledgerBytes) {
      throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the storage limit.')
    }
    let renamed = false
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
      const temporaryStat = await lstat(temporary)
      if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink() || temporaryStat.size > limits.ledgerBytes) {
        throw new SkillWorkshopError('skill_workshop_limit', 'Skill workshop state exceeds the storage limit.')
      }
      await rename(temporary, statePath)
      renamed = true
    } catch (error) {
      if (!renamed) await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function checkedSkillDir(rootInput: string, skillId: string) {
    const resolved = resolveSkillDirectory(rootInput, skillId)
    await assertSafeSkillDirectory(resolved.root, resolved.target)
    return resolved
  }

  async function snapshotFiles(sourceDir: string, revisionDir: string, files: SkillIntegrityFile[]) {
    await ensureDirectoryWithoutSymlinks(revisionDir)
    for (const file of files) {
      if (!safeRelativePath(file.path)) throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision contains an unsafe file path.')
      const sourcePath = path.resolve(sourceDir, ...file.path.split('/'))
      const targetPath = path.resolve(revisionDir, ...file.path.split('/'))
      for (const [base, child] of [[sourceDir, sourcePath], [revisionDir, targetPath]] as const) {
        const relative = path.relative(base, child)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new SkillWorkshopError('skill_path_unsafe', 'Skill revision file escaped its directory.')
        }
      }
      await assertSafeSkillDirectory(path.resolve(sourceDir, '..'), sourceDir)
      const sourceStat = await lstat(sourcePath)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new SkillWorkshopError('skill_invalid', 'A skill file changed before its revision was saved.')
      await ensureDirectoryWithoutSymlinks(path.dirname(targetPath))
      await copyFile(sourcePath, targetPath)
      await chmod(targetPath, file.mode).catch(() => undefined)
    }
    const saved = await collectSkillIntegrityFiles(path.dirname(revisionDir), revisionDir)
    if (saved.sha256 !== createHash('sha256').update(JSON.stringify(files)).digest('hex')) {
      throw new SkillWorkshopError('skill_invalid', 'Skill files changed while a verified revision was being saved.')
    }
  }

  async function scan(root: string, skillId: string) {
    const resolved = await checkedSkillDir(root, skillId)
    return { resolved, integrity: await collectSkillIntegrityFiles(resolved.root, resolved.target) }
  }

  async function readTextPreview(root: string, skillId: string, relativePath: string, maxBytes = 4 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024) {
      throw new SkillWorkshopError('skill_workshop_limit', 'Skill text preview exceeds the byte limit.')
    }
    const resolved = resolveSkillDirectory(root, skillId)
    await assertSafeSkillDirectory(resolved.root, resolved.target)
    const normalizedPath = relativePath.replace(/\\/g, '/')
    if (!safeRelativePath(normalizedPath)) throw new SkillWorkshopError('skill_path_unsafe', 'Skill file path is unsafe.')
    const filePath = path.resolve(resolved.target, ...normalizedPath.split('/'))
    const relative = path.relative(resolved.target, filePath)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SkillWorkshopError('skill_path_unsafe', 'Skill file path is outside its directory.')
    }
    if (!await assertNoSymlinkComponents(filePath)) throw new SkillWorkshopError('skill_not_found', 'Skill file is unavailable.')
    const before = await lstat(filePath)
    if (!before.isFile() || before.isSymbolicLink()) throw new SkillWorkshopError('skill_invalid', 'Skill preview file is invalid.')
    const readBytes = Math.min(before.size, maxBytes)
    const chunks: Buffer[] = []
    if (readBytes > 0) {
      const stream = createReadStream(filePath, { start: 0, end: readBytes - 1, highWaterMark: Math.min(READ_CHUNK_BYTES, maxBytes) })
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const after = await lstat(filePath)
    if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new SkillWorkshopError('skill_invalid', 'Skill preview file changed while it was being read.')
    }
    const content = Buffer.concat(chunks)
    if (content.includes(0)) return { kind: 'binary' as const }
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content) } catch { return { kind: 'binary' as const } }
    text = text.replace(/\r\n/g, '\n')
    let sanitizedText = ''
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 0
      const isDisallowedControl = (codePoint >= 1 && codePoint <= 8)
        || codePoint === 11
        || codePoint === 12
        || (codePoint >= 14 && codePoint <= 31)
        || codePoint === 127
      sanitizedText += isDisallowedControl ? '�' : character
    }
    text = sanitizedText
    return { kind: 'text' as const, text, truncated: before.size > readBytes }
  }

  function activeRevision(record: SkillRecord | undefined) {
    return record?.revisions.find((revision) => revision.revisionId === record.activeRevisionId) || null
  }

  async function inspect(root: string, skillId: string, source: SkillWorkshopSource, agentId?: string): Promise<SkillIntegrityComparison> {
    const { integrity } = await scan(root, skillId)
    const ledger = await readLedger()
    const record = ledger.skills[keyFor(source, agentId, skillId)]
    const baseline = activeRevision(record)
    const activeIndex = record?.revisions.findIndex((revision) => revision.revisionId === record.activeRevisionId) ?? -1
    const revisionCount = record?.revisions.length || 0
    if (!baseline) return { status: 'unverified', baseline: null, revisionCount, canRollback: false, current: integrity, added: [], removed: [], modified: [] }
    const oldFiles = new Map(baseline.files.map((file) => [file.path, file]))
    const newFiles = new Map(integrity.files.map((file) => [file.path, file]))
    const added = integrity.files.filter((file) => !oldFiles.has(file.path)).map((file) => file.path)
    const removed = baseline.files.filter((file) => !newFiles.has(file.path)).map((file) => file.path)
    const modified = integrity.files.filter((file) => {
      const old = oldFiles.get(file.path)
      return old && (old.sha256 !== file.sha256 || old.mode !== file.mode)
    }).map((file) => file.path)
    const matches = !added.length && !removed.length && !modified.length
    return {
      status: matches ? 'unchanged' : 'changed',
      baseline: { revisionId: baseline.revisionId, verifiedAt: baseline.verifiedAt, sha256: baseline.sha256 },
      revisionCount,
      canRollback: activeIndex > 0,
      current: integrity,
      added,
      removed,
      modified,
    }
  }

  async function verify(root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) {
    const { resolved, integrity } = await scan(root, skillId)
    const ledger = await readLedger()
    const key = keyFor(source, agentId, skillId)
    const existing = ledger.skills[key] || { source, agentId: agentId || null, skillId, revisions: [], activeRevisionId: null }
    const active = activeRevision(existing)
    if (active?.sha256 === integrity.sha256) return { revision: active, integrity, unchanged: true }

    await removeOrphanSnapshots(ledger)
    await validateSnapshotAccounting(ledger)
    const revisionId = randomUUID()
    const revision: SkillRevision = { revisionId, verifiedAt: now().toISOString(), sha256: integrity.sha256, files: integrity.files }
    const revisionDir = snapshotDirectory(key, revisionId)
    const { candidate, interim, evicted, hasEvictions } = planRevisionEvictions(ledger, key, revision)
    const candidateRecord = candidate.skills[key]!
    candidateRecord.source = source
    candidateRecord.agentId = agentId || null
    candidateRecord.skillId = skillId

    if (hasEvictions) {
      await writeLedger(interim)
      for (const item of evicted) await rm(snapshotDirectory(item.key, item.revisionId), { recursive: true, force: true })
    }

    try {
      await snapshotFiles(resolved.target, revisionDir, integrity.files)
    } catch (error) {
      await rm(revisionDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    try {
      await writeLedger(candidate)
    } catch (error) {
      await rm(revisionDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return { revision, integrity, unchanged: false }
  }

  async function rollback(root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) {
    const { resolved, integrity } = await scan(root, skillId)
    const ledger = await readLedger()
    const key = keyFor(source, agentId, skillId)
    const record = ledger.skills[key]
    const active = activeRevision(record)
    if (!record || !active) throw new SkillWorkshopError('skill_revision_missing', 'Verify this skill before rolling it back.')
    const currentMatches = active.sha256 === integrity.sha256
    if (!currentMatches) throw new SkillWorkshopError('skill_invalid', 'This skill has changed since its last verification; quarantine or verify it before rollback.')
    const activeIndex = record.revisions.findIndex((revision) => revision.revisionId === active.revisionId)
    const previous = activeIndex > 0 ? record.revisions[activeIndex - 1] : null
    if (!previous) throw new SkillWorkshopError('skill_revision_missing', 'No prior verified skill revision is available.')
    const revisionDir = safeRecordDirectory(path.join('revisions', createHash('sha256').update(key).digest('hex'), previous.revisionId))
    await assertNoSymlinkComponents(revisionDir)

    const replacement = `${resolved.target}.rollback-${randomUUID()}`
    await mkdir(replacement, { recursive: false })
    let displaced = ''
    try {
      await snapshotFiles(revisionDir, replacement, previous.files)
      displaced = `${resolved.target}.displaced-${randomUUID()}`
      await rename(resolved.target, displaced)
      try {
        await rename(replacement, resolved.target)
      } catch (error) {
        await rename(displaced, resolved.target).catch(() => undefined)
        throw error
      }
      const priorActive = record.activeRevisionId
      record.activeRevisionId = previous.revisionId
      try {
        await writeLedger(ledger)
      } catch (error) {
        await rm(resolved.target, { recursive: true, force: true }).catch(() => undefined)
        await rename(displaced, resolved.target).catch(() => undefined)
        record.activeRevisionId = priorActive
        throw error
      }
      await rm(displaced, { recursive: true, force: true })
    } catch (error) {
      await rm(replacement, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return { revision: previous, integrity: await scan(root, skillId).then((value) => value.integrity) }
  }

  async function quarantine(root: string, skillIdInput: string, source: SkillWorkshopSource, agentId: string | undefined, reason: string) {
    const { root: resolvedRoot, target, skillId } = resolveSkillDirectory(root, skillIdInput)
    if (!await assertNoSymlinkComponents(resolvedRoot)) throw new SkillWorkshopError('skill_not_found', 'Skill root is unavailable.')
    const rootStat = await lstat(resolvedRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill root is unsafe.')
    const stat = await lstat(target).catch((error) => { if (isMissing(error)) return null; throw error })
    if (!stat) throw new SkillWorkshopError('skill_not_found', 'Skill not found.')
    if (stat.isDirectory() && !stat.isSymbolicLink()) await assertSafeSkillDirectory(resolvedRoot, target)
    const ledger = await readLedger()
    const key = keyFor(source, agentId, skillId)
    const record = ledger.skills[key] || { source, agentId: agentId || null, skillId, revisions: [], activeRevisionId: null }
    if (record.quarantine) throw new SkillWorkshopError('skill_quarantined', 'This skill is already quarantined.')
    const quarantineId = randomUUID()
    const quarantineDir = safeRecordDirectory(path.join('quarantine', quarantineId))
    await ensureDirectoryWithoutSymlinks(path.dirname(quarantineDir))
    await rename(target, quarantineDir)
    record.quarantine = { quarantineId, reason: reason.slice(0, 200), movedAt: now().toISOString() }
    ledger.skills[key] = record
    try {
      await writeLedger(ledger)
    } catch (error) {
      await rename(quarantineDir, target).catch(() => undefined)
      throw error
    }
    return { skillId, source, quarantined: true, reason: record.quarantine.reason, movedAt: record.quarantine.movedAt }
  }

  async function restore(root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) {
    const { root: resolvedRoot, target } = resolveSkillDirectory(root, skillId)
    if (!await assertNoSymlinkComponents(resolvedRoot)) throw new SkillWorkshopError('skill_not_found', 'Skill root is unavailable.')
    const key = keyFor(source, agentId, skillId)
    const ledger = await readLedger()
    const record = ledger.skills[key]
    if (!record?.quarantine) throw new SkillWorkshopError('skill_revision_missing', 'No quarantined skill is available to restore.')
    const targetExists = await lstat(target).then(() => true).catch((error) => { if (isMissing(error)) return false; throw error })
    if (targetExists) throw new SkillWorkshopError('skill_invalid', 'A skill with this id already exists; move it before restoring.')
    const quarantineDir = safeRecordDirectory(path.join('quarantine', record.quarantine.quarantineId))
    if (!await assertNoSymlinkComponents(quarantineDir)) throw new SkillWorkshopError('skill_not_found', 'Quarantined skill files are unavailable.')
    const quarantinedIntegrity = await collectSkillIntegrityFiles(path.dirname(quarantineDir), quarantineDir)
    const quarantinedFiles = await readdir(quarantineDir, { withFileTypes: true })
    if (!quarantinedFiles.some((file) => file.isFile() && ['skill.md', 'skills.md'].includes(file.name.toLowerCase()))) {
      throw new SkillWorkshopError('skill_invalid', 'The quarantined skill has no supported SKILL.md entry file.')
    }
    await rename(quarantineDir, target)
    try {
      const restored = await collectSkillIntegrityFiles(resolvedRoot, target)
      if (restored.sha256 !== quarantinedIntegrity.sha256) throw new SkillWorkshopError('skill_invalid', 'Quarantined files changed while being restored.')
    } catch (error) {
      await rename(target, quarantineDir).catch(() => undefined)
      throw error
    }
    delete record.quarantine
    try {
      await writeLedger(ledger)
    } catch (error) {
      await rename(target, quarantineDir).catch(() => undefined)
      record.quarantine = { quarantineId: path.basename(quarantineDir), reason: 'Restore state could not be saved.', movedAt: now().toISOString() }
      throw error
    }
    return { skillId, source, restored: true }
  }

  async function listQuarantined(source?: SkillWorkshopSource, agentId?: string) {
    const ledger = await readLedger()
    return Object.values(ledger.skills)
      .filter((record) => record.quarantine && (!source || record.source === source)
        && (record.source !== 'agent' || !agentId || record.agentId === agentId))
      .map((record) => ({
        skillId: record.skillId,
        source: record.source,
        agentId: record.agentId,
        reason: record.quarantine!.reason,
        movedAt: record.quarantine!.movedAt,
      }))
      .slice(-200)
  }

  async function quarantineChangedSkills(root: string, source: SkillWorkshopSource, agentId?: string, quarantineChanges = true) {
    if (!await assertNoSymlinkComponents(root)) return []
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillWorkshopError('skill_path_unsafe', 'Skill root is unsafe.')
    const entries: Dirent[] = []
    const directory = await opendir(root)
    for await (const entry of directory) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const quarantined: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (!SKILL_ID_PATTERN.test(entry.name)) continue
      const key = keyFor(source, agentId, entry.name)
      const ledger = await readLedger()
      const record = ledger.skills[key]
      if (record?.quarantine) continue
      if (entry.isSymbolicLink()) {
        await quarantine(root, entry.name, source, agentId, 'A symbolic link was found in the skill root.')
        quarantined.push(entry.name)
        continue
      }
      if (!entry.isDirectory()) continue
      let files: string[]
      try {
        files = await (async () => {
          const skillDir = await checkedSkillDir(root, entry.name)
          const children = await readdir(skillDir.target, { withFileTypes: true })
          return children.filter((child) => child.isFile()).map((child) => child.name.toLowerCase())
        })()
      } catch {
        await quarantine(root, entry.name, source, agentId, 'Skill files failed path or integrity validation.')
        quarantined.push(entry.name)
        continue
      }
      if (!files.some((file) => ['skill.md', 'skills.md'].includes(file))) {
        await quarantine(root, entry.name, source, agentId, 'The skill has no supported SKILL.md entry file.')
        quarantined.push(entry.name)
        continue
      }
      let currentIntegrity: SkillIntegrity
      try {
        currentIntegrity = (await scan(root, entry.name)).integrity
      } catch (error) {
        if (error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit') throw error
        await quarantine(root, entry.name, source, agentId, 'Skill files failed path or integrity validation.')
        quarantined.push(entry.name)
        continue
      }
      if (!activeRevision(record) || !quarantineChanges) continue
      try {
        const comparison = await inspect(root, entry.name, source, agentId)
        if (comparison.status === 'changed' || comparison.current.sha256 !== currentIntegrity.sha256) {
          await quarantine(root, entry.name, source, agentId, 'Support-file hashes differ from the verified baseline.')
          quarantined.push(entry.name)
        }
      } catch {
        await quarantine(root, entry.name, source, agentId, 'Skill files failed path or integrity validation.')
        quarantined.push(entry.name)
      }
    }
    return quarantined
  }

  return {
    scanIntegrity: async (root: string, skillId: string) => (await scan(root, skillId)).integrity,
    readTextPreview,
    inspect,
    verify: (root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) =>
      serialize(() => verify(root, skillId, source, agentId)),
    rollback: (root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) =>
      serialize(() => rollback(root, skillId, source, agentId)),
    quarantine: (root: string, skillId: string, source: SkillWorkshopSource, agentId: string | undefined, reason: string) =>
      serialize(() => quarantine(root, skillId, source, agentId, reason)),
    restore: (root: string, skillId: string, source: SkillWorkshopSource, agentId?: string) =>
      serialize(() => restore(root, skillId, source, agentId)),
    listQuarantined,
    quarantineChangedSkills: (root: string, source: SkillWorkshopSource, agentId?: string, quarantineChanges = true) =>
      serialize(() => quarantineChangedSkills(root, source, agentId, quarantineChanges)),
  }
}

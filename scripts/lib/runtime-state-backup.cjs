const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_EXCLUDES = [
  /(^|\/)\.cache(\/|$)/i,
  /(^|\/)cache(\/|$)/i,
  /(^|\/)tmp(\/|$)/i,
  /(^|\/)temp(\/|$)/i,
  /(^|\/)gateway\.log$/i,
  /\.lock$/i,
  /\.pid$/i,
  /(^|\/)Singleton(?:Cookie|Lock|Socket)$/i,
]

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let position = 0
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    fs.closeSync(descriptor)
  }
}

function isSqliteDatabase(relative) {
  return /\.(?:sqlite|sqlite3|db)$/i.test(relative)
}

function isSqliteSidecar(relative) {
  return /\.(?:sqlite|sqlite3|db)-(?:wal|shm)$/i.test(relative)
}

function sqliteStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function createSqliteSnapshot(sourcePath, targetPath) {
  const { DatabaseSync } = require('node:sqlite')
  ensureDirectory(path.dirname(targetPath))
  const database = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec(`VACUUM INTO ${sqliteStringLiteral(targetPath)}`)
  } finally {
    database.close()
  }
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function shouldExclude(relative, patterns = DEFAULT_EXCLUDES) {
  const normalized = normalizeRelative(relative)
  return patterns.some((pattern) => pattern.test(normalized))
}

function skippedSymlinkEntry(relative) {
  return {
    path: normalizeRelative(relative),
    kind: 'symbolic-link',
    reason: 'symbolic_link_not_followed',
  }
}

function collectSourceFiles(sourceRoot, options = {}) {
  const root = path.resolve(sourceRoot)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`State source directory does not exist: ${root}`)
  const files = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      const relative = normalizeRelative(path.relative(root, fullPath))
      if (shouldExclude(relative, options.excludePatterns || DEFAULT_EXCLUDES)) continue
      if (entry.isSymbolicLink()) {
        if (typeof options.onSkippedEntry === 'function') options.onSkippedEntry(skippedSymlinkEntry(relative))
        continue
      }
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile()) files.push({ fullPath, relative })
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative))
}

function copyFileVerified(sourcePath, targetPath, expectedSha256) {
  ensureDirectory(path.dirname(targetPath))
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
  const actual = sha256File(targetPath)
  if (actual !== expectedSha256) throw new Error(`Backup copy verification failed for ${targetPath}`)
}

function createStateBackup(options) {
  const sourceRoot = path.resolve(options.sourceRoot)
  const backupParent = path.resolve(options.backupParent)
  const backupName = options.backupName || `automnia-state-${timestampSlug()}`
  const backupRoot = path.resolve(backupParent, backupName)
  if (!isWithin(backupParent, backupRoot)) throw new Error('Backup destination escapes backup parent')
  const backupParentRelativeToSource = path.relative(sourceRoot, backupParent)
  if (isWithin(sourceRoot, backupParent)) {
    throw new Error('Backup destination must be outside the runtime state directory')
  }
  if (fs.existsSync(backupRoot)) throw new Error(`Backup destination already exists: ${backupRoot}`)

  const skippedEntries = []
  const discoveredFiles = collectSourceFiles(sourceRoot, {
    ...options,
    onSkippedEntry(entry) {
      skippedEntries.push(entry)
      if (typeof options.onSkippedEntry === 'function') options.onSkippedEntry(entry)
    },
  })
  const sqliteDatabases = new Set(discoveredFiles
    .filter((file) => isSqliteDatabase(file.relative))
    .map((file) => file.relative.toLowerCase()))
  const files = discoveredFiles.filter((file) => {
    if (!isSqliteSidecar(file.relative)) return true
    const databasePath = file.relative.slice(0, -4).toLowerCase()
    return !sqliteDatabases.has(databasePath)
  })
  ensureDirectory(backupParent)
  if (typeof fs.statfsSync === 'function') {
    const estimatedBytes = files.reduce((total, file) => total + fs.statSync(file.fullPath).size, 0)
    const filesystem = fs.statfsSync(backupParent)
    const availableBytes = filesystem.bavail * filesystem.bsize
    const requiredBytes = estimatedBytes + Math.max(128 * 1024 * 1024, Math.ceil(estimatedBytes * 0.05))
    if (availableBytes < requiredBytes) {
      throw new Error(`Not enough free disk space for a safe runtime backup (need about ${requiredBytes} bytes including margin).`)
    }
  }
  ensureDirectory(backupRoot)
  const manifestFiles = []
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const targetPath = path.join(backupRoot, file.relative)
      let size
      let sha256
      let strategy
      if (isSqliteDatabase(file.relative)) {
        createSqliteSnapshot(file.fullPath, targetPath)
        const targetStat = fs.statSync(targetPath)
        size = targetStat.size
        sha256 = sha256File(targetPath)
        strategy = 'sqlite-vacuum-into'
      } else {
        const stat = fs.statSync(file.fullPath)
        const expectedSha256 = sha256File(file.fullPath)
        copyFileVerified(file.fullPath, targetPath, expectedSha256)
        size = stat.size
        sha256 = expectedSha256
      }
      manifestFiles.push({ path: file.relative, size, sha256, ...(strategy ? { strategy } : {}) })
      options.onProgress?.({ phase: 'copying', completed: index + 1, total: files.length })
    }
    const manifest = {
      schema: 1,
      product: 'Automnia',
      createdAt: new Date().toISOString(),
      sourceName: path.basename(sourceRoot),
      fileCount: manifestFiles.length,
      totalBytes: manifestFiles.reduce((total, entry) => total + entry.size, 0),
      skippedEntryCount: skippedEntries.length,
      skippedEntries: skippedEntries.sort((left, right) => left.path.localeCompare(right.path)),
      files: manifestFiles,
    }
    fs.writeFileSync(path.join(backupRoot, 'backup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    options.onProgress?.({ phase: 'complete', completed: files.length, total: files.length })
    return { backupRoot, manifest }
  } catch (error) {
    fs.rmSync(backupRoot, { recursive: true, force: true })
    throw error
  }
}

function verifyStateBackup(backupRoot) {
  const root = path.resolve(backupRoot)
  const manifestPath = path.join(root, 'backup-manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Backup manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error('Backup manifest schema is invalid')
  if (manifest.fileCount !== manifest.files.length) throw new Error('Backup manifest fileCount does not match files')
  const skippedEntries = Array.isArray(manifest.skippedEntries) ? manifest.skippedEntries : []
  if (manifest.skippedEntryCount !== undefined && manifest.skippedEntryCount !== skippedEntries.length) {
    throw new Error('Backup manifest skippedEntryCount does not match skipped entries')
  }
  let totalBytes = 0
  const seen = new Set()
  for (const entry of manifest.files) {
    const relative = normalizeRelative(entry.path)
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Unsafe backup path: ${relative}`)
    if (seen.has(relative)) throw new Error(`Duplicate backup path: ${relative}`)
    seen.add(relative)
    const filePath = path.resolve(root, relative)
    if (!isWithin(root, filePath)) throw new Error(`Backup path escapes root: ${relative}`)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Backup file is missing: ${relative}`)
    const stat = fs.statSync(filePath)
    if (stat.size !== entry.size) throw new Error(`Backup file size mismatch: ${relative}`)
    if (sha256File(filePath) !== entry.sha256) throw new Error(`Backup file checksum mismatch: ${relative}`)
    totalBytes += stat.size
  }
  for (const entry of skippedEntries) {
    const relative = normalizeRelative(entry.path)
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Unsafe skipped backup path: ${relative}`)
    if (seen.has(relative)) throw new Error(`Duplicate backup path: ${relative}`)
    seen.add(relative)
    if (entry.kind !== 'symbolic-link' || entry.reason !== 'symbolic_link_not_followed') {
      throw new Error(`Unknown skipped backup entry: ${relative}`)
    }
  }
  if (totalBytes !== manifest.totalBytes) throw new Error('Backup manifest totalBytes does not match files')
  return manifest
}

function directoryHasEntries(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length > 0
}

function restoreStateBackup(options) {
  const backupRoot = path.resolve(options.backupRoot)
  const targetRoot = path.resolve(options.targetRoot)
  const manifest = verifyStateBackup(backupRoot)
  if (directoryHasEntries(targetRoot) && !options.force) {
    throw new Error(`Restore target is not empty: ${targetRoot}. Set force only after stopping Automnia and confirming a backup.`)
  }

  const parent = path.dirname(targetRoot)
  ensureDirectory(parent)
  const stagingRoot = path.join(parent, `.${path.basename(targetRoot)}.restore-${process.pid}-${Date.now()}`)
  const previousRoot = path.join(parent, `.${path.basename(targetRoot)}.pre-restore-${timestampSlug()}`)
  fs.rmSync(stagingRoot, { recursive: true, force: true })
  ensureDirectory(stagingRoot)

  try {
    for (const entry of manifest.files) {
      const sourcePath = path.join(backupRoot, entry.path)
      const targetPath = path.join(stagingRoot, entry.path)
      copyFileVerified(sourcePath, targetPath, entry.sha256)
    }
    fs.writeFileSync(path.join(stagingRoot, 'restored-from.json'), `${JSON.stringify({
      schema: 1,
      restoredAt: new Date().toISOString(),
      backupCreatedAt: manifest.createdAt,
      backupRoot,
    }, null, 2)}\n`, { mode: 0o600 })

    if (fs.existsSync(targetRoot)) {
      if (options.force && directoryHasEntries(targetRoot)) fs.renameSync(targetRoot, previousRoot)
      else fs.rmSync(targetRoot, { recursive: true, force: true })
    }
    fs.renameSync(stagingRoot, targetRoot)
    return { targetRoot, previousRoot: fs.existsSync(previousRoot) ? previousRoot : null, manifest }
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    if (!fs.existsSync(targetRoot) && fs.existsSync(previousRoot)) fs.renameSync(previousRoot, targetRoot)
    throw error
  }
}

module.exports = {
  collectSourceFiles,
  createStateBackup,
  restoreStateBackup,
  sha256File,
  verifyStateBackup,
}

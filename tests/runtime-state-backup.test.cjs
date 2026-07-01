const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  collectSourceFiles,
  createStateBackup,
  restoreStateBackup,
  verifyStateBackup,
} = require('../scripts/lib/runtime-state-backup.cjs')

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function createState(root) {
  const state = path.join(root, 'state')
  fs.mkdirSync(path.join(state, 'agents', 'alpha'), { recursive: true })
  fs.mkdirSync(path.join(state, 'control-center-ledger'), { recursive: true })
  fs.mkdirSync(path.join(state, 'cache'), { recursive: true })
  fs.writeFileSync(path.join(state, 'openclaw.json'), '{"agents":{}}\n')
  fs.writeFileSync(path.join(state, 'agents', 'alpha', 'IDENTITY.md'), '# Alpha\n')
  fs.writeFileSync(path.join(state, 'control-center-ledger', 'mission-records.jsonl'), '{"id":"m1"}\n')
  fs.writeFileSync(path.join(state, 'gateway.lock'), 'transient')
  fs.writeFileSync(path.join(state, 'gateway.log'), 'transient')
  fs.writeFileSync(path.join(state, 'cache', 'skip.txt'), 'transient')
  return state
}

test('runtime state backup verifies and restores durable files', () => {
  const root = tempRoot('dystopai-backup-test-')
  try {
    const state = createState(root)
    const backups = path.join(root, 'backups')
    const restored = path.join(root, 'restored')

    const backup = createStateBackup({ sourceRoot: state, backupParent: backups, backupName: 'snapshot' })
    assert.equal(backup.manifest.fileCount, 3)
    assert.equal(fs.existsSync(path.join(backup.backupRoot, 'gateway.lock')), false)
    assert.equal(fs.existsSync(path.join(backup.backupRoot, 'gateway.log')), false)
    assert.equal(verifyStateBackup(backup.backupRoot).fileCount, 3)

    const result = restoreStateBackup({ backupRoot: backup.backupRoot, targetRoot: restored })
    assert.equal(result.previousRoot, null)
    assert.equal(fs.readFileSync(path.join(restored, 'agents', 'alpha', 'IDENTITY.md'), 'utf8'), '# Alpha\n')
    assert.equal(fs.existsSync(path.join(restored, 'restored-from.json')), true)

    fs.appendFileSync(path.join(backup.backupRoot, 'openclaw.json'), 'tamper')
    assert.throws(() => verifyStateBackup(backup.backupRoot), /size mismatch|checksum mismatch/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('force restore preserves the prior state and non-force restore refuses data loss', () => {
  const root = tempRoot('dystopai-backup-force-')
  try {
    const state = createState(root)
    const backup = createStateBackup({ sourceRoot: state, backupParent: path.join(root, 'backups'), backupName: 'snapshot' })
    const target = path.join(root, 'target')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'existing.txt'), 'keep me')
    assert.throws(() => restoreStateBackup({ backupRoot: backup.backupRoot, targetRoot: target }), /not empty/)

    const restored = restoreStateBackup({ backupRoot: backup.backupRoot, targetRoot: target, force: true })
    assert.ok(restored.previousRoot)
    assert.equal(fs.readFileSync(path.join(restored.previousRoot, 'existing.txt'), 'utf8'), 'keep me')
    assert.equal(fs.existsSync(path.join(target, 'openclaw.json')), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('backup validation rejects missing sources, duplicate and unsafe manifest paths', () => {
  const root = tempRoot('dystopai-backup-invalid-')
  try {
    assert.throws(() => collectSourceFiles(path.join(root, 'missing')), /does not exist/)
    const state = createState(root)
    const symlinkPath = path.join(state, 'unsafe-link')
    try {
      fs.symlinkSync(path.join(state, 'openclaw.json'), symlinkPath)
      const skipped = []
      const files = collectSourceFiles(state, { onSkippedEntry: (entry) => skipped.push(entry) })
      assert.equal(files.some((file) => file.relative === 'unsafe-link'), false)
      assert.deepEqual(skipped, [{
        path: 'unsafe-link',
        kind: 'symbolic-link',
        reason: 'symbolic_link_not_followed',
      }])

      const symlinkBackup = createStateBackup({
        sourceRoot: state,
        backupParent: path.join(root, 'symlink-backups'),
        backupName: 'snapshot',
      })
      assert.equal(symlinkBackup.manifest.fileCount, 3)
      assert.equal(symlinkBackup.manifest.skippedEntryCount, 1)
      assert.equal(fs.existsSync(path.join(symlinkBackup.backupRoot, 'unsafe-link')), false)
      assert.equal(verifyStateBackup(symlinkBackup.backupRoot).skippedEntryCount, 1)
      fs.unlinkSync(symlinkPath)
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    }

    const backup = createStateBackup({ sourceRoot: state, backupParent: path.join(root, 'backups'), backupName: 'snapshot' })
    assert.throws(() => createStateBackup({ sourceRoot: state, backupParent: path.join(root, 'backups'), backupName: 'snapshot' }), /already exists/)

    const manifestPath = path.join(backup.backupRoot, 'backup-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.files.push({ ...manifest.files[0] })
    manifest.fileCount = manifest.files.length
    manifest.totalBytes += manifest.files[0].size
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.throws(() => verifyStateBackup(backup.backupRoot), /Duplicate backup path/)

    manifest.files.pop()
    manifest.fileCount = manifest.files.length
    manifest.totalBytes -= manifest.files[0].size
    manifest.files[1].path = '../escape'
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.throws(() => verifyStateBackup(backup.backupRoot), /Unsafe backup path/)

    manifest.files[1].path = 'control-center-ledger/mission-records.jsonl'
    manifest.skippedEntryCount = 1
    manifest.skippedEntries = [{ path: '../escaped-link', kind: 'symbolic-link', reason: 'symbolic_link_not_followed' }]
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.throws(() => verifyStateBackup(backup.backupRoot), /Unsafe skipped backup path/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

#!/usr/bin/env node
const os = require('node:os')
const path = require('node:path')
const {
  createStateBackup,
  restoreStateBackup,
  verifyStateBackup,
} = require('./lib/runtime-state-backup.cjs')

const command = process.argv[2] || 'backup'
const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
const sourceRoot = path.resolve(process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || path.join(home, '.openclaw'))
const backupParent = path.resolve(process.env.AUTOMNIA_STATE_BACKUP_DIR || path.join(home, 'Automnia Backups'))

try {
  if (command === 'backup') {
    const result = createStateBackup({ sourceRoot, backupParent })
    console.log(`[state-backup] created ${result.backupRoot}`)
    console.log(`[state-backup] verified ${result.manifest.fileCount} file(s), ${result.manifest.totalBytes} byte(s)`)
    if (result.manifest.skippedEntryCount) {
      console.log(`[state-backup] skipped ${result.manifest.skippedEntryCount} symlink entr${result.manifest.skippedEntryCount === 1 ? 'y' : 'ies'}`)
    }
  } else if (command === 'verify') {
    const backupRoot = process.env.AUTOMNIA_STATE_BACKUP_PATH || process.argv[3]
    if (!backupRoot) throw new Error('Set AUTOMNIA_STATE_BACKUP_PATH or provide the backup path as the third argument')
    const manifest = verifyStateBackup(backupRoot)
    console.log(`[state-backup] verified ${manifest.fileCount} file(s), ${manifest.totalBytes} byte(s)`)
    if (manifest.skippedEntryCount) {
      console.log(`[state-backup] verified ${manifest.skippedEntryCount} skipped symlink entr${manifest.skippedEntryCount === 1 ? 'y' : 'ies'}`)
    }
  } else if (command === 'restore') {
    const backupRoot = process.env.AUTOMNIA_STATE_BACKUP_PATH || process.argv[3]
    const targetRoot = process.env.AUTOMNIA_STATE_RESTORE_TARGET || process.argv[4]
    if (!backupRoot || !targetRoot) throw new Error('Restore requires a backup path and an explicit target path')
    const result = restoreStateBackup({
      backupRoot,
      targetRoot,
      force: /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_STATE_RESTORE_FORCE || '')),
    })
    console.log(`[state-backup] restored ${result.manifest.fileCount} file(s) into ${result.targetRoot}`)
    if (result.previousRoot) console.log(`[state-backup] previous state preserved at ${result.previousRoot}`)
  } else {
    throw new Error(`Unknown state-backup command: ${command}`)
  }
} catch (error) {
  console.error(`[state-backup] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

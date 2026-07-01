import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const scripts = packageJson.scripts || {}
const lifecycle = read('scripts/windows-release-lifecycle.ps1')
const updateLibrary = read('scripts/lib/update-manifest.cjs')
const updateGenerator = read('scripts/generate-update-manifest.cjs')
const updateVerifier = read('scripts/verify-update-manifest.cjs')
const backupLibrary = read('scripts/lib/runtime-state-backup.cjs')
const releaseValidator = read('scripts/validate-release-artifacts.cjs')

assert.match(updateLibrary, /crypto\.sign\(null, bytes, privateKey\)/, 'update manifests must use detached Ed25519 signatures')
assert.match(updateLibrary, /Update artifact checksum mismatch/, 'update verification must reject tampered artifacts')
assert.match(updateLibrary, /isWithin\(artifactRoot, filePath\)/, 'update artifact paths must remain contained')
assert.match(updateGenerator, /DYSTOPAI_UPDATE_REQUIRE_SIGNING/, 'update generation must support a fail-closed public release mode')
assert.match(updateVerifier, /verifyUpdateManifest/, 'update verification must execute artifact and signature checks')
assert.match(releaseValidator, /validateUpdateChannelIfPresent/, 'release validation must verify the update manifest, not trust a boolean evidence claim')

assert.match(lifecycle, /Get-AuthenticodeSignature/, 'Windows lifecycle validation must inspect Authenticode')
assert.match(lifecycle, /signtool\.exe/, 'Windows lifecycle validation must verify timestamped platform signatures')
assert.match(lifecycle, /fresh-install\.log/, 'Windows lifecycle validation must retain fresh-install evidence')
assert.match(lifecycle, /upgrade\.log/, 'Windows lifecycle validation must retain upgrade evidence')
assert.match(lifecycle, /uninstall\.log/, 'Windows lifecycle validation must retain uninstall evidence')
assert.match(lifecycle, /corrupted-update\.log/, 'Windows lifecycle validation must retain corrupted-update evidence')
assert.match(lifecycle, /rollback-existing-version/, 'corrupted update rejection must prove the installed prior version still launches')
assert.match(lifecycle, /distribution-signing\.json/, 'Windows lifecycle validation must emit release-consumable evidence')

assert.match(backupLibrary, /backup-manifest\.json/, 'state backups must carry a verification manifest')
assert.match(backupLibrary, /symbolic_link_not_followed/, 'state backups must skip symlink traversal without following targets')
assert.match(backupLibrary, /skippedEntries/, 'state backups must record skipped symlink entries in the manifest')
assert.match(backupLibrary, /Backup file checksum mismatch/, 'state backups must fail verification after tampering')
assert.match(backupLibrary, /pre-restore/, 'forced restores must preserve the previous state directory')

assert.equal(scripts['release:update-manifest'], 'node scripts/generate-update-manifest.cjs')
assert.equal(scripts['release:update-verify'], 'node scripts/verify-update-manifest.cjs')
assert.equal(scripts['release:lifecycle:windows'], 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-release-lifecycle.ps1')
assert.equal(scripts['state:backup'], 'node scripts/runtime-state-backup.cjs backup')
assert.equal(scripts['state:restore'], 'node scripts/runtime-state-backup.cjs restore')
assert.match(scripts['test:ci'] || '', /smoke:release-lifecycle/, 'release lifecycle contracts must remain in the production gate')

console.log('release lifecycle and recovery contract ok')

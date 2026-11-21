import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyOfficialExtensions } from '../scripts/post-upgrade-openclaw-readiness.mjs'

test('bundled official extensions must match the OpenClaw host version', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'automnia-extension-versions-'))
  try {
    mkdirSync(path.join(root, 'telegram'))
    mkdirSync(path.join(root, 'third-party'))
    const write = (dir, value) => writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(value))
    assert.throws(() => verifyOfficialExtensions(root, '2026.11.6'), /extensions are missing/)
    write('third-party', { name: 'other-plugin', version: '1.0.0' })
    write('telegram', { name: '@openclaw/telegram', version: '2026.11.4' })
    assert.throws(() => verifyOfficialExtensions(root, '2026.11.6'), /does not match the host/)
    write('telegram', { name: '@openclaw/telegram', version: '2026.11.6' })
    assert.equal(verifyOfficialExtensions(root, '2026.11.6'), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

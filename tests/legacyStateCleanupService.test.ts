import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { archiveCoveredLegacyConfigHealthState } from '../server/services/gateway/legacyStateCleanupService'

async function createTempStateRoot(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('archiveCoveredLegacyConfigHealthState returns a quiet no-op when no legacy file exists', async () => {
  const stateRoot = await createTempStateRoot('automnia-legacy-config-health-missing-')
  try {
    const result = await archiveCoveredLegacyConfigHealthState({ stateRoot })

    assert.equal(result.archived, false)
    assert.equal(result.entries, 0)
    assert.equal(result.sourcePath, path.join(stateRoot, 'logs', 'config-health.json'))
  } finally {
    await fs.rm(stateRoot, { recursive: true, force: true })
  }
})

test('archiveCoveredLegacyConfigHealthState archives stale config health JSON', async () => {
  const stateRoot = await createTempStateRoot('automnia-legacy-config-health-')
  try {
    const logsDir = path.join(stateRoot, 'logs')
    const sourcePath = path.join(logsDir, 'config-health.json')
    const legacyState = {
      entries: {
        [path.join(stateRoot, 'openclaw.json')]: {
          lastKnownGood: { providers: { openai: { enabled: true } } },
          lastObservedSuspiciousSignature: 'old-json-state',
        },
        [path.join(stateRoot, 'profile-openclaw.json')]: {
          lastPromotedGood: { providers: { ollama: { enabled: true } } },
        },
      },
    }
    await fs.mkdir(logsDir, { recursive: true })
    await fs.writeFile(sourcePath, JSON.stringify(legacyState, null, 2), 'utf-8')

    const result = await archiveCoveredLegacyConfigHealthState({ stateRoot })

    assert.equal(result.archived, true)
    assert.equal(result.entries, 2)
    assert.equal(result.sourcePath, sourcePath)
    assert.ok(result.archivePath)
    assert.equal(existsSync(sourcePath), false)
    assert.equal(JSON.parse(await fs.readFile(result.archivePath!, 'utf-8')).entries[path.join(stateRoot, 'openclaw.json')].lastObservedSuspiciousSignature, 'old-json-state')
    assert.equal(path.dirname(result.archivePath!), path.join(logsDir, 'archive'))
  } finally {
    await fs.rm(stateRoot, { recursive: true, force: true })
  }
})

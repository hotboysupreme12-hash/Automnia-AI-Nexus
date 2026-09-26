import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { patchRestartRecoveryStaleClaimSource } = require('../scripts/lib/restart-recovery-stale-claim-patch.cjs')

const source = `function normalizeFiniteTimestamp(value) { return value; }
async function markStartupOrphanedMainSessionsForRecovery(params) {
  const updatedAt = normalizeFiniteTimestamp(entry.updatedAt);
  if (updatedBeforeMs !== void 0 && updatedAt !== void 0 && updatedAt > updatedBeforeMs) return;
  return isMainRestartRecoveryAggregateTerminalOnly(entry) ? { action: "retire_terminal" } : { action: "mark" };
}`

test('startup recovery patch repairs only an old, orphaned recovery claim', () => {
  const patched = patchRestartRecoveryStaleClaimSource(source)

  assert.match(patched, /Automnia: recover a pre-start restart claim refreshed by ingress retries/)
  assert.match(patched, /activeWriterRunId === claimRunId && lifecycleRunId === claimRunId/)
  assert.match(patched, /!isAutomniaPreStartupRestartRecoveryClaim\(entry, updatedBeforeMs\)/)
  assert.match(patched, /forceRestartSafeTools: true/)
  assert.equal(patchRestartRecoveryStaleClaimSource(patched), patched)
})

test('startup recovery patch fails closed when OpenClaw changes its marker loop', () => {
  assert.throws(
    () => patchRestartRecoveryStaleClaimSource('async function markStartupOrphanedMainSessionsForRecovery(params) {}'),
    /freshness guard changed/,
  )
})

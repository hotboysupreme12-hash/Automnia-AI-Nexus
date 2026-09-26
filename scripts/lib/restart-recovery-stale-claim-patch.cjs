const fs = require('node:fs')
const path = require('node:path')

const marker = 'Automnia: recover a pre-start restart claim refreshed by ingress retries'
const helperMarker = 'function isAutomniaPreStartupRestartRecoveryClaim(entry, startupAt) {'
const startupAnchor = 'async function markStartupOrphanedMainSessionsForRecovery(params) {'
const freshnessGuard = 'if (updatedBeforeMs !== void 0 && updatedAt !== void 0 && updatedAt > updatedBeforeMs) return;'
const patchedFreshnessGuard = 'if (updatedBeforeMs !== void 0 && updatedAt !== void 0 && updatedAt > updatedBeforeMs && !isAutomniaPreStartupRestartRecoveryClaim(entry, updatedBeforeMs)) return;'
const recoveryPlan = 'return isMainRestartRecoveryAggregateTerminalOnly(entry) ? { action: "retire_terminal" } : { action: "mark" };'
const patchedRecoveryPlan = 'return isMainRestartRecoveryAggregateTerminalOnly(entry) ? { action: "retire_terminal" } : isAutomniaPreStartupRestartRecoveryClaim(entry, updatedBeforeMs) ? { action: "mark", forceRestartSafeTools: true } : { action: "mark" };'

function patchRestartRecoveryStaleClaimSource(source) {
  if (source.includes(marker)) return source
  if (!source.includes(startupAnchor)) {
    throw new Error('OpenClaw startup recovery marker changed; cannot apply stale-claim repair')
  }
  if (!source.includes(freshnessGuard)) {
    throw new Error('OpenClaw startup recovery freshness guard changed; cannot apply stale-claim repair')
  }
  if (!source.includes(recoveryPlan)) {
    throw new Error('OpenClaw startup recovery plan changed; cannot apply stale-claim repair')
  }

  const helper = String.raw`// ${marker}.
function isAutomniaPreStartupRestartRecoveryClaim(entry, startupAt) {
	const claimRunId = typeof entry.restartRecoveryDeliveryRunId === "string" ? entry.restartRecoveryDeliveryRunId.trim() : "";
	if (!claimRunId) return false;
	const startedAt = normalizeFiniteTimestamp(entry.startedAt);
	if (startedAt === void 0 || startedAt > startupAt) return false;
	const activeWriterRunId = typeof entry.activeWriterRunId === "string" ? entry.activeWriterRunId.trim() : "";
	const lifecycleRunId = typeof entry.lifecycleRunId === "string" ? entry.lifecycleRunId.trim() : "";
	return activeWriterRunId === claimRunId && lifecycleRunId === claimRunId;
}
`

  return source
    .replace(startupAnchor, `${helper}${startupAnchor}`)
    .replace(freshnessGuard, patchedFreshnessGuard)
    .replace(recoveryPlan, patchedRecoveryPlan)
}

function ensureRestartRecoveryClaimStartupRepair(vendorRoot) {
  const dist = path.join(vendorRoot, 'dist')
  const candidates = fs.readdirSync(dist)
    .filter((name) => /^main-session-restart-recovery-marking-.*\.js$/.test(name))
  if (!candidates.length) {
    throw new Error('Missing OpenClaw startup restart-recovery marker runtime for stale-claim repair')
  }

  let patchedRuntime = false
  for (const name of candidates) {
    const file = path.join(dist, name)
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes(startupAnchor)) continue
    const patched = patchRestartRecoveryStaleClaimSource(source)
    if (patched !== source) fs.writeFileSync(file, patched)
    patchedRuntime = true
  }

  if (!patchedRuntime) {
    throw new Error('Missing OpenClaw startup restart-recovery implementation for stale-claim repair')
  }
}

module.exports = {
  ensureRestartRecoveryClaimStartupRepair,
  patchRestartRecoveryStaleClaimSource,
}

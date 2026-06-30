import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionRecoveryServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionRecoveryService.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(missionRecoveryServiceSource, /type MissionGatewaySessionReconciliationStatus = 'verified' \| 'missing' \| 'unavailable' \| 'not-checked'/)
assert.match(missionRecoveryServiceSource, /type MissionGatewaySessionReconciliationResult =/)
assert.match(serverSource, /getRuntimeRunStatus: \(id\) => \{[\s\S]*activeOpenClawRuns\.get\(cleanId\)\?\.status \|\| recentOpenClawRuns\.find/)
assert.match(missionRecoveryServiceSource, /function gatewayErrorLooksNotFound/)
assert.match(missionRecoveryServiceSource, /function reconcileMissionGatewaySessions/)
assert.match(missionRecoveryServiceSource, /missionGatewaySessionReconciliationCandidates\(mission\)/)
assert.match(missionRecoveryServiceSource, /options\.ensureGatewayClient\(AbortSignal\.timeout\(5_000\)\)/)
assert.match(missionRecoveryServiceSource, /state\.client\.request\('sessions\.describe', \{ key: job\.sessionKey \}, \{ timeoutMs: 3_000 \}\)/)
assert.match(missionRecoveryServiceSource, /gatewayErrorLooksNotFound\(error\) \? 'missing' : 'unavailable'/)
assert.match(missionRecoveryServiceSource, /gatewaySessionReconciliation/)
assert.match(missionRecoveryServiceSource, /idempotencyKey: `\$\{mission\.id\}:gateway-session-reconciled:\$\{options\.controlCenterStartedAtMs\}`/)
assert.match(missionRecoveryServiceSource, /options\.persistMissionRecord\(mission, 'gateway-session-reconciled'\)/)
assert.match(serverSource, /await hydrateRecentOpenClawRunsFromLedger\(\)\s*\n\s*await hydrateMissionRecordsFromLedger\(\)/)
assert.match(serverSource, /ensureGatewayClient: ensureControlCenterGatewayClient/)
assert.match(serverSource, /const hydrateMissionRecordsFromLedger = missionRecoveryService\.hydrateMissionRecordsFromLedger/)

const helperStart = missionRecoveryServiceSource.indexOf('async function reconcileMissionGatewaySessions')
const helperEnd = missionRecoveryServiceSource.indexOf('async function hydrateMissionRecordsFromLedger', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const helperSource = missionRecoveryServiceSource.slice(helperStart, helperEnd)
assert.doesNotMatch(helperSource, /mission\.status\s*=/)
assert.doesNotMatch(helperSource, /mission\.lifecycleState\s*=/)
assert.doesNotMatch(helperSource, /job\.status\s*=/)
assert.doesNotMatch(serverSource, /async function reconcileMissionGatewaySessions/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-gateway-reconciliation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-gateway-reconciliation/)

console.log('mission gateway reconciliation contract ok')

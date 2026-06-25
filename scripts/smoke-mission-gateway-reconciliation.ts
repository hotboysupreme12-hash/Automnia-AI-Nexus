import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(serverSource, /type MissionGatewaySessionReconciliationStatus = 'verified' \| 'missing' \| 'unavailable' \| 'not-checked'/)
assert.match(serverSource, /type MissionGatewaySessionReconciliationResult =/)
assert.match(serverSource, /function runtimeRunRecordById/)
assert.match(serverSource, /activeOpenClawRuns\.get\(cleanId\) \|\| recentOpenClawRuns\.find/)
assert.match(serverSource, /function gatewayErrorLooksNotFound/)
assert.match(serverSource, /function reconcileMissionGatewaySessions/)
assert.match(serverSource, /missionGatewaySessionReconciliationCandidates\(mission\)/)
assert.match(serverSource, /ensureControlCenterGatewayClient\(AbortSignal\.timeout\(5_000\)\)/)
assert.match(serverSource, /state\.client\.request\('sessions\.describe', \{ key: job\.sessionKey \}, \{ timeoutMs: 3_000 \}\)/)
assert.match(serverSource, /gatewayErrorLooksNotFound\(error\) \? 'missing' : 'unavailable'/)
assert.match(serverSource, /gatewaySessionReconciliation/)
assert.match(serverSource, /idempotencyKey: `\$\{mission\.id\}:gateway-session-reconciled:\$\{CONTROL_CENTER_STARTED_AT_MS\}`/)
assert.match(serverSource, /persistMissionRecord\(mission, 'gateway-session-reconciled'\)/)
assert.match(serverSource, /await hydrateRecentOpenClawRunsFromLedger\(\)\s*\n\s*await hydrateMissionRecordsFromLedger\(\)/)

const helperStart = serverSource.indexOf('async function reconcileMissionGatewaySessions')
const helperEnd = serverSource.indexOf('function rehydrateRecurringMissionShifts', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const helperSource = serverSource.slice(helperStart, helperEnd)
assert.doesNotMatch(helperSource, /mission\.status\s*=/)
assert.doesNotMatch(helperSource, /mission\.lifecycleState\s*=/)
assert.doesNotMatch(helperSource, /job\.status\s*=/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-gateway-reconciliation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-gateway-reconciliation/)

console.log('mission gateway reconciliation contract ok')

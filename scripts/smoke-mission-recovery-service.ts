import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(path.join(rootDir, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const missionRecoveryService = read('server/services/missions/missionRecoveryService.ts')
const missionRecoveryTests = read('tests/missionRecoveryService.test.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(missionRecoveryService, /export function createMissionRecoveryService/, 'mission recovery service should expose a service factory')
assert.match(missionRecoveryService, /export type MissionCronReconciliationSnapshot =/, 'mission recovery service should own mission cron reconciliation contracts')
assert.match(missionRecoveryService, /export type MissionGatewaySessionReconciliationResult =/, 'mission recovery service should own Gateway session reconciliation contracts')
assert.match(missionRecoveryService, /normalizeMissionRecordSnapshot/, 'mission recovery service should normalize durable mission records during hydration')
assert.match(missionRecoveryService, /\bfunction failRehydratedMissionScheduler\b/, 'mission recovery service should own failed scheduler recovery transitions')
assert.match(missionRecoveryService, /\bfunction reconcileRehydratedMissionCronJobs\b/, 'mission recovery service should own recovered cron reconciliation')
assert.match(missionRecoveryService, /\basync function reconcileMissionGatewaySessions\b/, 'mission recovery service should own Gateway session reconciliation')
assert.match(missionRecoveryService, /\basync function hydrateMissionRecordsFromLedger\b/, 'mission recovery service should own durable mission hydration')
assert.match(missionRecoveryService, /options\.rehydrateRecurringMissionShifts\(mission, cronState\)/, 'mission recovery should delegate recurring shift projection through the scheduler service boundary')
assert.match(missionRecoveryService, /options\.armRehydratedMissionTimer\(mission, assignments, activity\)/, 'mission recovery should delegate recovered timer arming through the scheduler service boundary')
assert.match(missionRecoveryService, /idempotencyKey: `\$\{mission\.id\}:gateway-session-reconciled:\$\{options\.controlCenterStartedAtMs\}`/, 'Gateway reconciliation events should remain idempotent across one startup')
assert.match(missionRecoveryService, /client\.request\('sessions\.describe', \{ key: job\.sessionKey \}, \{ timeoutMs: 3_000 \}\)/, 'Gateway session reconciliation should verify durable session references')
assert.match(missionRecoveryService, /gatewayErrorLooksNotFound\(error\) \? 'missing' : 'unavailable'/, 'Gateway session reconciliation should classify missing sessions separately from unavailable Gateway')

assert.match(controlPlane, /from '\.\/services\/missions\/missionRecoveryService'/, 'controlPlane.ts should import the mission recovery service boundary')
assert.match(controlPlane, /createMissionRecoveryService\(\{/, 'controlPlane.ts should compose the mission recovery service')
assert.match(controlPlane, /const hydrateMissionRecordsFromLedger = missionRecoveryService\.hydrateMissionRecordsFromLedger/, 'startup mission hydration should delegate through the recovery service')
assert.match(controlPlane, /getRuntimeRunStatus: \(id\) => \{[\s\S]*activeOpenClawRuns\.get\(cleanId\)\?\.status \|\| recentOpenClawRuns\.find/, 'controlPlane.ts should provide runtime run lookup as a dependency')
assert.match(controlPlane, /listMissionCronReconciliationSnapshot: listMissionCronReconciliationSnapshotFromStateDb/, 'controlPlane.ts should provide cron state snapshots as a dependency')
assert.match(controlPlane, /ensureGatewayClient: ensureControlCenterGatewayClient/, 'controlPlane.ts should provide Gateway client access as a dependency')
assert.match(controlPlane, /await hydrateRecentOpenClawRunsFromLedger\(\)\s*\n\s*await hydrateMissionRecordsFromLedger\(\)/, 'runtime run hydration must still precede mission recovery')

assert.doesNotMatch(controlPlane, /\bfunction\s+failRehydratedMissionScheduler\b/, 'failed scheduler recovery must stay out of controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+reconcileRehydratedMissionCronJobs\b/, 'cron reconciliation decisions must stay out of controlPlane.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+reconcileMissionGatewaySessions\b/, 'Gateway session reconciliation must stay out of controlPlane.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+hydrateMissionRecordsFromLedger\b/, 'durable mission hydration must stay out of controlPlane.ts')

assert.match(missionRecoveryTests, /hydrateMissionRecordsFromLedger restores active missions/, 'unit tests should cover active mission hydration')
assert.match(missionRecoveryTests, /reconcileRehydratedMissionCronJobs fails recovered missions/, 'unit tests should cover missing and disabled cron jobs')
assert.match(missionRecoveryTests, /redacted unavailable evidence/, 'unit tests should cover redacted Gateway unavailable evidence')
assert.match(missionRecoveryTests, /classifies missing Gateway sessions/, 'unit tests should cover missing Gateway session classification')

const scripts = packageJson.scripts || {}
assert.equal(scripts['smoke:mission-recovery'], 'tsx scripts/smoke-mission-recovery-service.ts')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-recovery/)

console.log('mission recovery service contract ok')

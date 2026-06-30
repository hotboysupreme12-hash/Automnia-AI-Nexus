import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionSchedulerServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionSchedulerService.ts'), 'utf8')
const missionRecoveryServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionRecoveryService.ts'), 'utf8')
const missionRecoveryTestsSource = readFileSync(path.join(rootDir, 'tests/missionRecoveryService.test.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(missionRecoveryServiceSource, /type MissionCronReconciliationSnapshot/)
assert.match(serverSource, /listMissionCronReconciliationSnapshotFromStateDb/)
assert.match(serverSource, /missionCronRowLooksLikeControlCenterMission/)
assert.match(missionRecoveryServiceSource, /reconcileRehydratedMissionCronJobs/)
assert.match(missionRecoveryServiceSource, /failRehydratedMissionScheduler/)
assert.match(missionRecoveryServiceSource, /Mission scheduler reconciliation failed/)
assert.match(missionRecoveryServiceSource, /missingCronIds/)
assert.match(missionRecoveryServiceSource, /disabledCronIds/)
assert.match(missionRecoveryServiceSource, /mission\.scheduler\.status = 'failed'/)
assert.match(missionRecoveryServiceSource, /mission\.status = 'cancelled'/)
assert.match(missionRecoveryServiceSource, /options\.recordMissionReport\(mission\)/)
assert.match(missionRecoveryServiceSource, /const cronState = options\.listMissionCronReconciliationSnapshot\(\)/)
assert.match(missionRecoveryServiceSource, /const schedulerRecovered = reconcileRehydratedMissionCronJobs\(mission, cronState\)/)
assert.match(missionRecoveryServiceSource, /options\.rehydrateRecurringMissionShifts\(mission, cronState\)/)
assert.match(missionRecoveryServiceSource, /options\.armRehydratedMissionTimer\(mission, assignments, activity\)/)
assert.match(missionRecoveryServiceSource, /function redactedRecoveryDetail\(value: unknown/)
assert.match(missionRecoveryServiceSource, /redactedRecoveryDetail\(cronState\.error \|\| 'OpenClaw cron state unavailable'\)/)
assert.match(missionRecoveryServiceSource, /cronReconciliationError: redactedRecoveryDetail\(cronState\.error\)/)
assert.match(serverSource, /listMissionCronReconciliationSnapshot: listMissionCronReconciliationSnapshotFromStateDb/)
assert.match(missionSchedulerServiceSource, /function rehydrateRecurringMissionShifts\(mission: Mission, cronState: MissionCronRehydrationState\)/)
assert.match(missionSchedulerServiceSource, /cronState\.available && !cronState\.activeCronIds\.has\(job\.cronId\)/)
assert.doesNotMatch(serverSource, /function reconcileRehydratedMissionCronJobs\(mission: Mission/)
assert.doesNotMatch(serverSource, /function failRehydratedMissionScheduler\(/)
assert.doesNotMatch(serverSource, /function rehydrateRecurringMissionShifts\(mission: Mission/)
assert.match(missionRecoveryTestsSource, /preserves recovered missions when cron jobs remain active/)
assert.match(missionRecoveryTestsSource, /fails recovered missions when cron jobs disappeared/)
assert.match(missionRecoveryTestsSource, /defers unavailable cron state with redacted evidence/)
assert.match(missionRecoveryTestsSource, /records redacted unavailable cron reconciliation evidence/)
assert.match(missionRecoveryTestsSource, /missingCronIds: \['cron-missing'\]/)
assert.match(missionRecoveryTestsSource, /disabledCronIds: \['cron-disabled'\]/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-cron-reconciliation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-cron-reconciliation/)

console.log('mission cron reconciliation contract ok')

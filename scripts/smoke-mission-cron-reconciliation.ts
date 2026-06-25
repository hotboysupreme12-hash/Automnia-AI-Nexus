import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(serverSource, /type MissionCronReconciliationSnapshot/)
assert.match(serverSource, /listMissionCronReconciliationSnapshotFromStateDb/)
assert.match(serverSource, /missionCronRowLooksLikeControlCenterMission/)
assert.match(serverSource, /reconcileRehydratedMissionCronJobs/)
assert.match(serverSource, /failRehydratedMissionScheduler/)
assert.match(serverSource, /Mission scheduler reconciliation failed/)
assert.match(serverSource, /missingCronIds/)
assert.match(serverSource, /disabledCronIds/)
assert.match(serverSource, /mission\.scheduler\.status = 'failed'/)
assert.match(serverSource, /mission\.status = 'cancelled'/)
assert.match(serverSource, /recordMissionReport\(mission\)/)
assert.match(serverSource, /const cronState = listMissionCronReconciliationSnapshotFromStateDb\(\)/)
assert.match(serverSource, /const schedulerRecovered = reconcileRehydratedMissionCronJobs\(mission, cronState\)/)
assert.match(serverSource, /rehydrateRecurringMissionShifts\(mission, cronState\)/)
assert.match(serverSource, /cronState\.available && !cronState\.activeCronIds\.has\(job\.cronId\)/)
assert.doesNotMatch(serverSource, /function rehydrateRecurringMissionShifts\(mission: Mission\) \{\s*const every[\s\S]*?if \(job\.status !== 'created' && job\.status !== 'running'\) continue[\s\S]*?activeShifts\.set/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-cron-reconciliation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-cron-reconciliation/)

console.log('mission cron reconciliation contract ok')

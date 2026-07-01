import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionRoutesSource = readFileSync(path.join(rootDir, 'server/routes/missionRoutes.ts'), 'utf8')
const missionStateServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionStateService.ts'), 'utf8')
const missionSchedulerServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionSchedulerService.ts'), 'utf8')
const missionStateTestsSource = readFileSync(path.join(rootDir, 'tests/missionStateService.test.ts'), 'utf8')
const missionApiSource = readFileSync(path.join(rootDir, 'src/api/missions.ts'), 'utf8')
const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(missionSchedulerServiceSource, /MissionCronCleanupResult/)
assert.match(missionSchedulerServiceSource, /MissionCronCleanupSummary/)
assert.match(missionSchedulerServiceSource, /missionCronCleanupResult/)
assert.match(missionSchedulerServiceSource, /summarizeMissionCronCleanupResults/)
assert.match(missionSchedulerServiceSource, /missionCronCleanupFailureSummary/)
assert.match(missionSchedulerServiceSource, /async function removeMissionCronJob\(job: MissionCronJob, signal\?: AbortSignal\): Promise<MissionCronCleanupResult>/)
assert.match(missionSchedulerServiceSource, /async function cleanupMissionCronJobs\(mission: Mission\)/)
assert.match(missionSchedulerServiceSource, /return summarizeMissionCronCleanupResults\(results\)/)
assert.doesNotMatch(serverSource, /async function cleanupMissionCronJobs\(mission: Mission\)/)
assert.match(serverSource, /registerMissionRoutes\(app, \{/, 'Mission routes must be registered from the extracted module')
assert.match(serverSource, /missionStateService,/, 'Mission routes must receive the mission state service')
assert.doesNotMatch(serverSource, /app\.post\('\/api\/missions\/stop'/, 'server index must not inline mission stop route')
assert.match(missionRoutesSource, /options\.missionStateService\.stopMission\(parsed\.data\)/)
assert.match(missionStateServiceSource, /cleanup\.failed > 0/)
assert.match(missionStateServiceSource, /Mission cancellation cleanup failed/)
assert.match(missionStateServiceSource, /persistMissionRecord\(mission, 'cancellation-requested'\)/)
assert.match(missionStateServiceSource, /Mission cancellation requested/)
assert.match(missionStateServiceSource, /transitionMissionState\(mission, 'cancelled', 'mission_cancelled'/)
assert.match(missionStateServiceSource, /evidence:\s*\{[\s\S]*cleanup,[\s\S]*\}/)
assert.match(missionStateServiceSource, /options\.recordMissionReport\(mission\)/)
assert.match(missionRoutesSource, /return apiSuccess\(res, \{\s*mission:\s*result\.mission,\s*cleanup:\s*result\.cleanup\s*\}\)/)
assert.doesNotMatch(missionRoutesSource, /void options\.cleanupMissionCronJobs\(mission\)\.then\(\(\) => \{\s*mission\.scheduler\.status = 'stopped'\s*\}\)/)
assert.match(missionStateTestsSource, /stopMission cancels recovered active work after backend restart/, 'unit tests should cover cancelling a recovered mission after backend restart')
assert.match(missionStateTestsSource, /hydrateMissionRecordsFromLedger\(\)/, 'restart cancellation coverage should hydrate from durable mission records first')
assert.match(missionStateTestsSource, /operator cancelled after backend restart/, 'restart cancellation coverage should preserve operator cancellation evidence')

assert.match(missionApiSource, /\/api\/missions\/stop/)
assert.match(missionApiSource, /timeoutMs: 120_000/)
assert.match(storeSource, /requestMissionStop\(current\.id\)/)
assert.doesNotMatch(storeSource, /\/api\/missions\/stop/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-cancellation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-cancellation/)

console.log('mission cancellation contract ok')

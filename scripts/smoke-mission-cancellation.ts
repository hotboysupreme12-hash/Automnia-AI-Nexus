import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionRoutesSource = readFileSync(path.join(rootDir, 'server/routes/missionRoutes.ts'), 'utf8')
const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(serverSource, /type MissionCronCleanupResult/)
assert.match(serverSource, /type MissionCronCleanupSummary/)
assert.match(serverSource, /missionCronCleanupResult/)
assert.match(serverSource, /summarizeMissionCronCleanupResults/)
assert.match(serverSource, /missionCronCleanupFailureSummary/)
assert.match(serverSource, /async function removeMissionCronJob\(job: MissionCronJob, signal\?: AbortSignal\): Promise<MissionCronCleanupResult>/)
assert.match(serverSource, /async function cleanupMissionCronJobs\(mission: Mission\)/)
assert.match(serverSource, /return summarizeMissionCronCleanupResults\(results\)/)
assert.match(serverSource, /registerMissionRoutes\(app, \{/, 'Mission routes must be registered from the extracted module')
assert.doesNotMatch(serverSource, /app\.post\('\/api\/missions\/stop'/, 'server index must not inline mission stop route')
assert.match(missionRoutesSource, /cleanup\.failed > 0/)
assert.match(missionRoutesSource, /Mission cancellation cleanup failed/)
assert.match(missionRoutesSource, /options\.persistMissionRecord\(mission, 'cancellation-requested'\)/)
assert.match(missionRoutesSource, /Mission cancellation requested/)
assert.match(missionRoutesSource, /options\.transitionMissionState\(mission, 'cancelled', 'mission_cancelled'/)
assert.match(missionRoutesSource, /evidence:\s*\{[\s\S]*cleanup,[\s\S]*\}/)
assert.match(missionRoutesSource, /options\.recordMissionReport\(mission\)/)
assert.match(missionRoutesSource, /return apiSuccess\(res, \{\s*mission:\s*options\.missionView\(mission\),\s*cleanup\s*\}\)/)
assert.doesNotMatch(missionRoutesSource, /void options\.cleanupMissionCronJobs\(mission\)\.then\(\(\) => \{\s*mission\.scheduler\.status = 'stopped'\s*\}\)/)

assert.match(storeSource, /\/api\/missions\/stop/)
assert.match(storeSource, /timeoutMs: 120_000/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-cancellation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-cancellation/)

console.log('mission cancellation contract ok')

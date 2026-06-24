import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/index.ts'), 'utf8')
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
assert.match(serverSource, /cleanup\.failed > 0/)
assert.match(serverSource, /Mission cancellation cleanup failed/)
assert.match(serverSource, /persistMissionRecord\(mission, 'cancellation-requested'\)/)
assert.match(serverSource, /Mission cancellation requested/)
assert.match(serverSource, /transitionMissionState\(mission, 'cancelled', 'mission_cancelled'/)
assert.match(serverSource, /evidence:\s*\{[\s\S]*cleanup,[\s\S]*\}/)
assert.match(serverSource, /recordMissionReport\(mission\)/)
assert.match(serverSource, /return apiSuccess\(res, \{\s*mission:\s*missionView\(mission\),\s*cleanup\s*\}\)/)
assert.doesNotMatch(serverSource, /void cleanupMissionCronJobs\(mission\)\.then\(\(\) => \{\s*mission\.scheduler\.status = 'stopped'\s*\}\)/)

assert.match(storeSource, /\/api\/missions\/stop/)
assert.match(storeSource, /timeoutMs: 120_000/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-cancellation'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-cancellation/)

console.log('mission cancellation contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/index.ts'), 'utf8')
const missionRoutesSource = readFileSync(path.join(rootDir, 'server/routes/missionRoutes.ts'), 'utf8')
const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const shellSource = readFileSync(path.join(rootDir, 'src/components/layout/NexusShell.tsx'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(serverSource, /type MissionLifecycleProjection =/)
assert.match(serverSource, /function missionFeedEventFromLifecycleEvent/)
assert.match(serverSource, /function mergeMissionFeedEvents/)
assert.match(serverSource, /async function listMissionRecordsForProjection/)
assert.match(serverSource, /readMissionRecordLedgerTail<MissionRecordSnapshot>/)
assert.match(serverSource, /async function buildMissionLifecycleProjection/)
assert.match(serverSource, /source: 'memory\+ledger'/)
assert.match(serverSource, /import \{ registerMissionRoutes \} from '\.\/routes\/missionRoutes'/)
assert.match(serverSource, /registerMissionRoutes\(app, \{/)
assert.doesNotMatch(serverSource, /app\.get\('\/api\/missions'/)
assert.match(missionRoutesSource, /app\.get\('\/api\/missions', async \(_req, res\) => \{\s*\n\s*return apiSuccess\(res, await options\.buildMissionLifecycleProjection/)
assert.match(missionRoutesSource, /app\.get\('\/api\/missions\/projection'/)
assert.match(missionRoutesSource, /app\.get\('\/api\/missions\/:missionId\/lifecycle'/)
assert.match(missionRoutesSource, /Mission lifecycle not found/)

assert.match(storeSource, /syncMissionProjection: \(\) => Promise<void>/)
assert.match(storeSource, /apiRequest<BackendMissionsPayload>\('\/api\/missions\/projection'\)/)
assert.match(storeSource, /projection\?: \{/)
assert.match(storeSource, /const syncMissionProjection = async \(\) => \{/)
assert.match(storeSource, /await syncBackendMissions\(\)/)
assert.match(storeSource, /if \(get\(\)\.activeMission\?\.status === 'running'\) startMissionBackendPolling\(\)/)
assert.match(storeSource, /syncMissionProjection,\s*\n\s*\n\s*steerMission:/)

assert.match(shellSource, /const syncMissionProjection = useNexusStore\(\(s\) => s\.syncMissionProjection\)/)
assert.match(shellSource, /useEffect\(\(\) => \{ void syncMissionProjection\(\) \}, \[syncMissionProjection\]\)/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-lifecycle-projection'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-lifecycle-projection/)

console.log('mission lifecycle projection contract ok')

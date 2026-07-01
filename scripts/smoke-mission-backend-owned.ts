import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const storeSource = readFileSync(path.join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const missionApiSource = readFileSync(path.join(rootDir, 'src/api/missions.ts'), 'utf8')
const engineIndexSource = readFileSync(path.join(rootDir, 'src/engine/index.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

const missionStartCalls = missionApiSource.match(/apiRequest<[^>]+>\('\/api\/missions\/start'/g) || []
const missionStopCalls = missionApiSource.match(/apiRequest\('\/api\/missions\/stop'/g) || []

assert.equal(missionStartCalls.length, 1, 'mission deployment must have exactly one backend start path')
assert.equal(missionStopCalls.length, 1, 'mission stop must have exactly one backend stop path')
assert.match(storeSource, /requestMissionStart\(\{/, 'renderer store should launch missions through src/api/missions.ts')
assert.match(storeSource, /requestMissionStop\(current\.id\)/, 'renderer store should stop missions through src/api/missions.ts')
assert.doesNotMatch(storeSource, /['"`]\/api\/missions\//, 'mission endpoint literals should stay out of the renderer store')
assert.doesNotMatch(engineIndexSource, /MissionOrchestrator/)
assert.doesNotMatch(storeSource, /MissionOrchestrator/)
assert.doesNotMatch(storeSource, /\borchestrator\b/)
assert.doesNotMatch(storeSource, /const m = .*\.start\(\{ agents: s\.agents/)
assert.doesNotMatch(storeSource, /runOpeningTurns/)
assert.doesNotMatch(storeSource, /Continuous heartbeat deployed/)
assert.doesNotMatch(storeSource, /dispatch launched/)
assert.doesNotMatch(storeSource, /Mission deployed with/)
assert.doesNotMatch(storeSource, /Mission completed|Mission failed/)
assert.match(storeSource, /Cron scheduler request sent/)
assert.match(storeSource, /Cron mission deployed/)
assert.match(storeSource, /Cron mission stop requested/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-backend-owned'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-backend-owned/)

console.log('mission backend-owned lifecycle contract ok')

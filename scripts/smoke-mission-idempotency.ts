import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionRoutesSource = readFileSync(join(rootDir, 'server/routes/missionRoutes.ts'), 'utf8')
const missionStateServiceSource = readFileSync(join(rootDir, 'server/services/missions/missionStateService.ts'), 'utf8')
const storeSource = readFileSync(join(rootDir, 'src/store/nexusStore.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
const scripts = packageJson.scripts || {}

assert.match(missionStateServiceSource, /idempotencyKey\?: string/, 'Mission records must retain a launch idempotency key')
assert.match(missionStateServiceSource, /normalizeMissionLaunchIdempotencyKey/, 'Mission launch idempotency keys must be normalized')
assert.match(missionStateServiceSource, /function findMissionByIdempotencyKey/, 'Mission starts must lookup existing launches by idempotency key')
assert.match(serverSource, /registerMissionRoutes\(app, \{/, 'Mission routes must be registered from the extracted module')
assert.match(serverSource, /missionStateService,/, 'Mission routes must receive the mission state service')
assert.doesNotMatch(serverSource, /app\.post\('\/api\/missions\/start'/, 'server index must not inline mission start route')
assert.match(missionRoutesSource, /idempotencyKey:\s*z\.string\(\)\.trim\(\)\.min\(8\)\.max\(160\)\.optional\(\)/, 'Mission start payload must accept bounded idempotency keys')
assert.match(
  missionStateServiceSource,
  /const existingMission = findMissionByIdempotencyKey\(idempotencyKey\)[\s\S]*?deduped:\s*true[\s\S]*?mission:\s*missionView\(existingMission\)/,
  'Duplicate mission launch requests must return the existing mission instead of creating another one',
)
assert.match(
  missionStateServiceSource,
  /const mission: Mission = \{[\s\S]*?\.\.\.\(idempotencyKey \? \{ idempotencyKey \} : \{\}\)/,
  'New backend missions must persist the launch idempotency key',
)
assert.match(
  missionRoutesSource,
  /const result = await options\.missionStateService\.startMission\(parsed\.data\)[\s\S]*?deduped:\s*result\.deduped[\s\S]*?idempotencyKey:\s*result\.idempotencyKey[\s\S]*?mission:\s*result\.mission/,
  'Fresh mission launch responses should expose the launch idempotency result',
)

assert.match(storeSource, /idempotencyKey\?: string/, 'Renderer backend mission type must include idempotencyKey')
assert.match(storeSource, /idempotencyKey:\s*requestId/, 'Renderer must send the stable launch request id as the mission idempotency key')
assert.match(storeSource, /deduped\?: boolean/, 'Renderer must understand backend dedupe responses')
assert.match(storeSource, /Cron mission launch deduplicated/, 'Renderer mission feed should surface deduped launches')

assert.equal(typeof scripts['smoke:mission-idempotency'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-idempotency/)

console.log('mission idempotency contract ok')

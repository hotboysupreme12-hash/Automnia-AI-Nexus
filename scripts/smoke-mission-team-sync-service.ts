import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const missionTeamSyncService = read('server/services/missions/missionTeamSyncService.ts')
const missionStateService = read('server/services/missions/missionStateService.ts')
const missionSchedulerService = read('server/services/missions/missionSchedulerService.ts')
const partyCoordinationRoutes = read('server/routes/partyCoordinationRoutes.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(missionTeamSyncService, /export function createMissionTeamSyncService/, 'Team Sync service should expose a service factory')
assert.match(missionTeamSyncService, /\basync function ensureTeamSyncFile\b/, 'Team Sync service should own missing-file repair')
assert.match(missionTeamSyncService, /\bfunction teamSyncMarkdown\b/, 'Team Sync service should own snapshot markdown generation')
assert.match(missionTeamSyncService, /\basync function writeTeamSyncSnapshot\b/, 'Team Sync service should own snapshot writes')
assert.match(missionTeamSyncService, /params\.activity\.slice\(0, 80\)/, 'Team Sync service should cap snapshot activity at the established limit')
assert.match(missionTeamSyncService, /resolveDoctrineWorkspaceForRun\(agentId, workspace, options\.canonicalDoctrineRoot\(agentId\)\)/, 'Team Sync service should preserve canonical doctrine target selection')
assert.match(missionTeamSyncService, /resolveSharedTeamSyncPath\(agentIds\[0\]\)/, 'Team Sync service should preserve shared TEAM_SYNC path mirroring')
assert.match(missionTeamSyncService, /path\.join\(options\.workspaceRoot, 'TEAM_SYNC\.md'\)/, 'Team Sync service should preserve legacy workspace-root mirroring')

assert.match(controlPlane, /from '\.\/services\/missions\/missionTeamSyncService'/, 'controlPlane.ts should import the Team Sync service')
assert.match(controlPlane, /const missionTeamSyncService = createMissionTeamSyncService\(\{/, 'controlPlane.ts should compose the Team Sync service')
assert.match(controlPlane, /const ensureTeamSyncFile = missionTeamSyncService\.ensureTeamSyncFile/, 'controlPlane.ts should delegate missing-file repair to the Team Sync service')
assert.match(controlPlane, /const writeTeamSyncSnapshot = missionTeamSyncService\.writeTeamSyncSnapshot/, 'controlPlane.ts should delegate snapshot writes to the Team Sync service')
assert.doesNotMatch(controlPlane, /\bfunction teamSyncMarkdown\b/, 'Team Sync markdown generation must not return to controlPlane.ts')
assert.doesNotMatch(controlPlane, /\basync function writeTeamSyncSnapshot\b/, 'Team Sync snapshot writes must not return to controlPlane.ts')
assert.doesNotMatch(controlPlane, /\basync function ensureTeamSyncFile\b/, 'Team Sync missing-file repair must not return to controlPlane.ts')

assert.match(missionStateService, /writeTeamSyncSnapshot: \(params: \{/, 'mission state service should receive Team Sync writes through options')
assert.match(missionSchedulerService, /ensureTeamSyncFile: \(filePath: string\) => Promise<unknown>/, 'mission scheduler should receive Team Sync file repair through options')
assert.match(missionSchedulerService, /writeTeamSyncSnapshot: \(params: \{/, 'mission scheduler should receive Team Sync writes through options')
assert.match(partyCoordinationRoutes, /ensureTeamSyncFile: \(filePath: string\) => Promise<void>/, 'party routes should receive Team Sync file repair through options')
assert.match(partyCoordinationRoutes, /writeTeamSyncSnapshot: \(params: \{/, 'party routes should receive Team Sync snapshots through options')
assert.match(partyCoordinationRoutes, /fs\.appendFile\(targetPath/, 'Team Sync append endpoint should remain append-only at the route')

assert.equal(packageJson.scripts?.['smoke:mission-team-sync'], 'tsx scripts/smoke-mission-team-sync-service.ts')
assert.match(packageJson.scripts?.['test:ci'] || '', /npm run smoke:mission-team-sync/)

console.log('mission team sync service contract ok')

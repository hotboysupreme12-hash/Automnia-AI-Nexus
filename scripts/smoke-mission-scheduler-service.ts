import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const controlPlane = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionStateService = readFileSync(path.join(rootDir, 'server/services/missions/missionStateService.ts'), 'utf8')
const missionSchedulerService = readFileSync(path.join(rootDir, 'server/services/missions/missionSchedulerService.ts'), 'utf8')
const schedulerTests = readFileSync(path.join(rootDir, 'tests/missionSchedulerService.test.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(controlPlane, /from '\.\/services\/missions\/missionSchedulerService'/, 'controlPlane.ts must import the mission scheduler service')
assert.match(controlPlane, /const missionSchedulerService: MissionSchedulerService/, 'scheduler service should be composed as an explicit dependency')
assert.match(controlPlane, /createMissionSchedulerService\(\{/, 'controlPlane.ts must compose the scheduler service')
assert.match(controlPlane, /missionSchedulerService\.startRecurringMissionCronJobs/, 'mission state should delegate recurring arming through scheduler service')
assert.match(controlPlane, /missionSchedulerService\.scheduleNextMissionRound/, 'mission state should delegate instant scheduling through scheduler service')
assert.match(controlPlane, /missionSchedulerService\.cleanupMissionCronJobs/, 'mission state should delegate cancellation cleanup through scheduler service')
assert.match(controlPlane, /missionSchedulerService\.completeCronMission/, 'mission timers should delegate completion through scheduler service')
assert.match(controlPlane, /missionSchedulerService\.rehydrateRecurringMissionShifts\(mission, cronState\)/, 'mission recovery should rehydrate cron shifts through scheduler service')
assert.match(controlPlane, /missionSchedulerService\.armRehydratedMissionTimer\(mission, assignments, activity\)/, 'mission recovery should arm timers through scheduler service')

assert.doesNotMatch(controlPlane, /\bfunction\s+startRecurringMissionCronJobs\b/, 'recurring mission cron arming must not live in controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+scheduleNextMissionRound\b/, 'instant mission round scheduling must not live in controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+runMissionCronRound\b/, 'mission round execution must not live in controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+createMissionCronJob\b/, 'mission cron job creation must not live in controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+cleanupMissionCronJobs\b/, 'mission cron cleanup must not live in controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+completeCronMission\b/, 'mission completion orchestration must not live in controlPlane.ts')

assert.match(missionSchedulerService, /export function createMissionSchedulerService/, 'scheduler service must expose a factory')
assert.match(missionSchedulerService, /\basync function\s+createMissionCronJob\b/, 'scheduler service must own one-shot cron job creation')
assert.match(missionSchedulerService, /\basync function\s+createRecurringMissionCronJob\b/, 'scheduler service must own recurring cron job creation')
assert.match(missionSchedulerService, /\basync function\s+runMissionCronRound\b/, 'scheduler service must own round orchestration')
assert.match(missionSchedulerService, /\basync function\s+cleanupMissionCronJobs\b/, 'scheduler service must own cron cleanup')
assert.match(missionSchedulerService, /\basync function\s+completeCronMission\b/, 'scheduler service must own scheduler-driven mission completion')
assert.match(missionSchedulerService, /options\.runOpenClaw\(cronArgs, 90000/, 'scheduler service must construct OpenClaw cron add commands')
assert.match(missionSchedulerService, /\['cron', 'run', job\.cronId, '--wait'/, 'scheduler service must execute OpenClaw cron runs')
assert.match(missionSchedulerService, /\['cron', 'rm', job\.cronId, '--json'\]/, 'scheduler service must remove cron jobs during cleanup')
assert.match(missionSchedulerService, /appendAgentDailyMemory/, 'scheduler service must preserve agent memory handoff evidence')
assert.match(missionSchedulerService, /writeTeamSyncSnapshot/, 'scheduler service must preserve Team Sync scheduler evidence')
assert.match(missionSchedulerService, /extractCronRunReference/, 'scheduler service must capture cron runtime references')

assert.match(missionStateService, /scheduleNextMissionRound: \(/, 'mission state service should receive scheduler behavior through options')
assert.match(missionStateService, /startRecurringMissionCronJobs: \(/, 'mission state service should receive recurring scheduler behavior through options')
assert.match(schedulerTests, /startRecurringMissionCronJobs arms leader and worker cron pulses/, 'scheduler service needs recurring unit coverage')
assert.match(schedulerTests, /scheduleNextMissionRound drives an instant mission/, 'scheduler service needs instant scheduling unit coverage')
assert.match(schedulerTests, /cleanupMissionCronJobs disables a cron job when removal fails/, 'scheduler service needs cleanup unit coverage')

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-scheduler'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-scheduler/)

console.log('mission scheduler service contract ok')

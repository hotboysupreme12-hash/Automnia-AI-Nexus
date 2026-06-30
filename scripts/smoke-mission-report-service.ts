import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const controlPlane = read('server/controlPlane.ts')
const missionRoutes = read('server/routes/missionRoutes.ts')
const missionStateService = read('server/services/missions/missionStateService.ts')
const missionSchedulerService = read('server/services/missions/missionSchedulerService.ts')
const missionReportService = read('server/services/missions/missionReportService.ts')
const missionReportTests = read('tests/missionReportService.test.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(missionReportService, /export function createMissionReportService/, 'mission report service should expose a service factory')
assert.match(missionReportService, /type BackendMissionReportEvidence =/, 'mission report evidence contract should live in the report service')
assert.match(missionReportService, /type MissionLifecycleProjection =/, 'mission lifecycle projection contract should live in the report service')
assert.match(missionReportService, /\bfunction buildMissionReport\b/, 'mission report service should own backend report generation')
assert.match(missionReportService, /\bfunction recordMissionReport\b/, 'mission report service should own report recording')
assert.match(missionReportService, /\basync function listMissionReports\b/, 'mission report service should own durable report listing')
assert.match(missionReportService, /\basync function buildMissionLifecycleProjection\b/, 'mission report service should own lifecycle projection reports/feed merging')
assert.match(missionReportService, /\bfunction missionReportUnavailableMetrics\b/, 'mission report service should keep unavailable metrics explicit')
assert.match(missionReportService, /runtimeRunIds/, 'mission report service should preserve runtime run references')
assert.match(missionReportService, /cronRunIds/, 'mission report service should preserve cron run references')
assert.match(missionReportService, /sessionIds/, 'mission report service should preserve Gateway session ids')
assert.match(missionReportService, /sessionKeys/, 'mission report service should preserve Gateway session keys')
assert.match(missionReportService, /readMissionReports<BackendMissionReport>/, 'mission report service should read durable backend reports')
assert.match(missionReportService, /readMissionRecords<MissionRecordSnapshot>/, 'mission projection should read durable mission records through the service')
assert.match(missionReportService, /readMissionEvents<MissionLifecycleEvent>/, 'mission projection should read durable mission events through the service')

assert.match(controlPlane, /from '\.\/services\/missions\/missionReportService'/, 'controlPlane.ts should import the mission report service')
assert.match(controlPlane, /createMissionReportService\(\{/, 'controlPlane.ts should compose the mission report service')
assert.match(controlPlane, /const buildMissionLifecycleProjection = missionReportService\.buildMissionLifecycleProjection/, 'controlPlane.ts should expose projection through the service seam')
assert.match(controlPlane, /const listMissionReports = missionReportService\.listMissionReports/, 'controlPlane.ts should expose report listing through the service seam')
assert.match(controlPlane, /const recordMissionReport = missionReportService\.recordMissionReport/, 'controlPlane.ts should expose report recording through the service seam')
assert.doesNotMatch(controlPlane, /type BackendMissionReportEvidence =/, 'backend report evidence types must not return to controlPlane.ts')
assert.doesNotMatch(controlPlane, /type MissionLifecycleProjection =/, 'mission projection types must not return to controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction buildBackendMissionReport\b/, 'backend report generation must not return to controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction missionReportUnavailableMetrics\b/, 'mission report metric ownership must stay out of controlPlane.ts')
assert.doesNotMatch(controlPlane, /\basync function listMissionReports\b/, 'durable report listing must stay out of controlPlane.ts')

assert.match(missionRoutes, /MissionLifecycleProjection.*missionReportService/, 'mission routes should use the mission report service projection contract')
assert.match(missionRoutes, /BackendMissionReport.*missionReportService/, 'mission routes should use the backend report service contract')
assert.match(missionStateService, /options\.recordMissionReport\(mission\)/, 'mission state service should receive report recording through options')
assert.match(missionSchedulerService, /options\.recordMissionReport\(mission\)/, 'mission scheduler service should receive report recording through options')

assert.match(missionReportTests, /runtime-backed cron\/session evidence/, 'unit tests should cover runtime-backed report evidence')
assert.match(missionReportTests, /mission-feed evidence without runtime references/, 'unit tests should cover mission-feed fallback evidence')
assert.match(missionReportTests, /no-evidence reports/, 'unit tests should cover explicit no-evidence reports')
assert.match(missionReportTests, /lifecycle projection merge/, 'unit tests should cover projection/listing behavior')

const scripts = packageJson.scripts || {}
assert.equal(scripts['smoke:mission-report-service'], 'tsx scripts/smoke-mission-report-service.ts')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-report-service/, 'test:ci must include mission report service boundary coverage')

console.log('mission report service contract ok')

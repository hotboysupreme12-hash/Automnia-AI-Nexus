import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const entry = read('server/index.ts')
const controlPlane = read('server/controlPlane.ts')
const runtimeRoutes = read('server/routes/runtimeRoutes.ts')
const missionRoutes = read('server/routes/missionRoutes.ts')
const diagnosticsRoutes = read('server/routes/diagnosticsRoutes.ts')
const agentTurnRoutes = read('server/routes/agentTurnRoutes.ts')
const shiftRoutes = read('server/routes/shiftRoutes.ts')
const partyManagementRoutes = read('server/routes/partyManagementRoutes.ts')
const agentConfigRoutes = read('server/routes/agentConfigRoutes.ts')
const browserRoutes = read('server/routes/browserRoutes.ts')
const staticUi = read('server/staticUi.ts')
const providerCatalog = read('server/catalogs/providerCatalog.ts')
const routingHelpers = read('server/integrations/agentRoutingHelpers.ts')
const gatewayLifecycleService = read('server/services/gateway/gatewayLifecycleService.ts')
const gatewayDiagnosticsService = read('server/services/gateway/gatewayDiagnosticsService.ts')
const gatewayLogService = read('server/services/gateway/gatewayLogService.ts')
const gatewayChatService = read('server/services/gateway/gatewayChatService.ts')
const runtimeStatusService = read('server/services/runtime/runtimeStatusService.ts')
const runtimeActionService = read('server/services/runtime/runtimeActionService.ts')
const runtimeRecoveryService = read('server/services/runtime/runtimeRecoveryService.ts')
const missionStateService = read('server/services/missions/missionStateService.ts')
const missionSchedulerService = read('server/services/missions/missionSchedulerService.ts')
const missionReportService = read('server/services/missions/missionReportService.ts')
const missionRecoveryService = read('server/services/missions/missionRecoveryService.ts')
const missionTeamSyncService = read('server/services/missions/missionTeamSyncService.ts')
const runtimeLedgerStore = read('server/state/runtimeLedgerStore.ts')
const reporter = read('scripts/report-server-index-architecture.mjs')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const CONTROL_PLANE_MAX_LINES = 29_000
const CONTROL_PLANE_GUARD_COMMENT = 'No new domain logic goes here.'

const entryLines = entry.split(/\r?\n/).length
const controlPlaneLines = controlPlane.split(/\r?\n/).length
const inlineRoutes = [...controlPlane.matchAll(/\bapp\.(?:get|post|put|patch|delete|options|head)\(\s*['"]\/api\//g)]

assert.ok(entryLines <= 20, `server/index.ts must remain a tiny executable facade, found ${entryLines} lines`)
assert.match(entry, /import ['"]\.\/controlPlane['"]/, 'entrypoint should import the control-plane composition root')
assert.doesNotMatch(entry, /\bexpress\b|process\.env|\bapp\.(?:get|post|use)\(|['"]\/api\//, 'entrypoint must not own runtime or route policy')
assert.ok(controlPlane.startsWith('// No new domain logic goes here.'), 'controlPlane.ts must start with the Phase A no-domain-logic guard')
assert.match(controlPlane, /target service folder from docs\/BETA_CODEBASE_SPLIT_PLAN\.md/, 'controlPlane.ts guard must direct new backend behavior to a target service folder')
assert.ok(CONTROL_PLANE_MAX_LINES <= 29_000, `controlPlane.ts extraction budget must not be loosened above 29,000 lines: ${CONTROL_PLANE_MAX_LINES}`)
assert.ok(controlPlaneLines <= CONTROL_PLANE_MAX_LINES, `controlPlane.ts exceeded the current extraction budget: ${controlPlaneLines} lines`)
assert.equal(inlineRoutes.length, 0, `controlPlane.ts must not own inline API routes: ${inlineRoutes.length}`)
assert.match(controlPlane, /prepareSourceOpenClawVendorIfMissing/, 'controlPlane.ts should self-heal source OpenClaw vendor artifacts before runtime resolution')

for (const contract of [
  ["import { registerBrowserRoutes } from './routes/browserRoutes'", 'browser route import'],
  ["import { registerShiftRoutes } from './routes/shiftRoutes'", 'shift route import'],
  ["import { registerPartyManagementRoutes } from './routes/partyManagementRoutes'", 'party management route import'],
  ["import { registerAgentConfigRoutes } from './routes/agentConfigRoutes'", 'agent config route import'],
  ["import { registerRuntimeRoutes } from './routes/runtimeRoutes'", 'runtime route import'],
  ["import { registerStaticUi } from './staticUi'", 'static UI import'],
  ["from './services/gateway/gatewayLifecycleService'", 'Gateway lifecycle service import'],
  ["from './services/gateway/gatewayDiagnosticsService'", 'Gateway diagnostics service import'],
  ["from './services/gateway/gatewayLogService'", 'Gateway log service import'],
  ["from './services/gateway/gatewayChatService'", 'Gateway chat service import'],
  ["from './services/runtime/runtimeStatusService'", 'runtime status service import'],
  ["from './services/runtime/runtimeActionService'", 'runtime action service import'],
  ["from './services/runtime/runtimeRecoveryService'", 'runtime recovery service import'],
  ["from './services/missions/missionStateService'", 'mission state service import'],
  ["from './services/missions/missionSchedulerService'", 'mission scheduler service import'],
  ["from './services/missions/missionReportService'", 'mission report service import'],
  ["from './services/missions/missionRecoveryService'", 'mission recovery service import'],
  ["from './services/missions/missionTeamSyncService'", 'mission Team Sync service import'],
  ["from './state/runtimeLedgerStore'", 'runtime ledger store import'],
  ["from './catalogs/providerCatalog'", 'provider catalog import'],
  ["from './integrations/agentRoutingHelpers'", 'routing patch import'],
  ['registerBrowserRoutes(app, { checkBrowserPreflight })', 'browser route registration'],
  ['registerShiftRoutes(app, {', 'shift route registration'],
  ['registerPartyManagementRoutes(app, partyManagementRoutesContext)', 'party management route registration'],
  ['registerAgentConfigRoutes(app, agentConfigRoutesContext)', 'agent config route registration'],
  ['registerRuntimeRoutes(app, {', 'runtime route registration'],
  ['createGatewayLifecycleService({', 'Gateway lifecycle service composition'],
  ['createGatewayDiagnosticsService({', 'Gateway diagnostics service composition'],
  ['createGatewayLogService({', 'Gateway log service composition'],
  ['createGatewayChatService({', 'Gateway chat service composition'],
  ['createRuntimeStatusService({', 'runtime status service composition'],
  ['createRuntimeActionService({', 'runtime action service composition'],
  ['createRuntimeRecoveryService({', 'runtime recovery service composition'],
  ['createMissionStateService({', 'mission state service composition'],
  ['createMissionSchedulerService({', 'mission scheduler service composition'],
  ['createMissionReportService({', 'mission report service composition'],
  ['createMissionRecoveryService({', 'mission recovery service composition'],
  ['createMissionTeamSyncService({', 'mission Team Sync service composition'],
  ['createRuntimeLedgerStore(', 'runtime ledger store composition'],
  ['missionStateService,', 'mission route state service injection'],
  ['registerStaticUi(app, {', 'static UI registration'],
] as const) {
  assert.ok(controlPlane.includes(contract[0]), `controlPlane.ts is missing ${contract[1]}`)
}

assert.doesNotMatch(controlPlane, /\bapp\.(?:get|post|put|patch|delete|options|head)\(\s*['"]\/api\//, 'all API endpoints must remain outside controlPlane.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+spawnGateway\b|\bfunction\s+scheduleGatewayRestart\b/, 'Gateway process lifecycle helpers must stay in gatewayLifecycleService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+buildRuntimeStatusPayload\b|\bfunction\s+buildRuntimeSummaryPayload\b/, 'runtime status payload builders must stay in runtimeStatusService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+shutdownControlCenterRuntime\b|\bfunction\s+clearRuntimeMonitorHistory\b/, 'runtime shutdown and clean-slate recovery must stay in runtimeRecoveryService.ts')
assert.doesNotMatch(controlPlane, /from ['"]\.\/runtimeLedger['"]/, 'runtime ledger helpers must stay behind runtimeLedgerStore.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+findMissionByIdempotencyKey\b|\bfunction\s+normalizeMissionLaunchIdempotencyKey\b/, 'mission launch idempotency helpers must stay in missionStateService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+transitionMissionState\b|\bfunction\s+pushMissionEvent\b|\bfunction\s+persistMissionRecord\b/, 'mission state transitions and ledger persistence must stay in missionStateService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+scheduleNextMissionRound\b|\bfunction\s+startRecurringMissionCronJobs\b|\bfunction\s+runMissionCronRound\b|\bfunction\s+createMissionCronJob\b/, 'mission cron scheduling must stay in missionSchedulerService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+cleanupMissionCronJobs\b|\bfunction\s+removeMissionCronJob\b|\bfunction\s+completeCronMission\b|\bfunction\s+armRehydratedMissionTimer\b/, 'mission cron cleanup/completion/timer logic must stay in missionSchedulerService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+buildBackendMissionReport\b|\bfunction\s+missionReportUnavailableMetrics\b|\basync function\s+listMissionReports\b/, 'mission report generation/listing must stay in missionReportService.ts')
assert.doesNotMatch(controlPlane, /type BackendMissionReportEvidence =|type MissionLifecycleProjection =/, 'mission report/projection contracts must stay in missionReportService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+failRehydratedMissionScheduler\b|\bfunction\s+reconcileRehydratedMissionCronJobs\b|\basync function\s+reconcileMissionGatewaySessions\b|\basync function\s+hydrateMissionRecordsFromLedger\b/, 'mission restart/recovery logic must stay in missionRecoveryService.ts')
assert.doesNotMatch(controlPlane, /type MissionGatewaySessionReconciliationResult =|type MissionGatewaySessionReconciliationStatus =/, 'mission Gateway reconciliation contracts must stay in missionRecoveryService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+teamSyncMarkdown\b|\basync function\s+writeTeamSyncSnapshot\b|\basync function\s+ensureTeamSyncFile\b/, 'mission Team Sync snapshot logic must stay in missionTeamSyncService.ts')
assert.doesNotMatch(controlPlane, /\bclass\s+LightweightGatewayClient\b/, 'Gateway websocket chat client must stay in gatewayChatService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+discoverGatewayLogPaths\b|\bfunction\s+readGatewayLogTailEntries\b/, 'Gateway log discovery/tailing must stay in gatewayLogService.ts')
assert.doesNotMatch(controlPlane, /app\.(?:get|post)\(['"]\/api\/shifts/, 'shift endpoints must remain outside controlPlane.ts')
assert.doesNotMatch(controlPlane, /app\.get\(['"]\/api\/browser\/preflight/, 'browser preflight must remain outside controlPlane.ts')
assert.match(runtimeRoutes, /runtimeActions: RuntimeActionService/, 'runtime routes should receive runtime actions through a service option')
assert.match(controlPlane, /runtimeActions: runtimeActionService/, 'controlPlane.ts should inject the runtime action service into runtime routes')
assert.match(runtimeActionService, /ensureGatewayRunning: \(\) => Promise<void>/, 'runtime action service should accept Gateway lifecycle start through options')
assert.match(runtimeActionService, /gatewayStatusSnapshot: \(healthy: boolean, listenerPid\?: number \| null\) => GatewayStatusSnapshot/, 'runtime action service should receive Gateway Monitor status through options')
assert.match(runtimeActionService, /tryRestartGatewayService: \(options: \{ force\?: boolean; allowExternalTakeover\?: boolean; reason\?: string \}\) => Promise<unknown>/, 'runtime action service should receive Gateway restart through options')
assert.match(runtimeActionService, /runtimeRecovery: Pick<RuntimeRecoveryService, 'clearRuntimeMonitor' \| 'shutdownRuntime'>/, 'runtime action service should receive clean-slate and shutdown recovery through options')
assert.match(runtimeActionService, /allowExternalTakeover: true/, 'manual Monitor restarts should explicitly opt into external listener takeover')
assert.match(diagnosticsRoutes, /gatewayChatRuntimeSnapshot: \(\) => Record<string, unknown>/, 'diagnostics routes should receive Gateway chat runtime projection through options')
assert.match(agentTurnRoutes, /gatewayChat\?: \{/, 'agent turn route/service seam should keep Gateway chat inputs explicit')
assert.match(gatewayLifecycleService, /\bfunction\s+spawnGateway\b/, 'Gateway lifecycle service should own process spawning')
assert.match(gatewayLifecycleService, /\bfunction\s+scheduleGatewayRestart\b/, 'Gateway lifecycle service should own restart scheduling')
assert.match(gatewayLifecycleService, /\ballowExternalTakeover\b/, 'Gateway lifecycle service should guard external listener takeover')
assert.match(gatewayDiagnosticsService, /\bfunction\s+fetchGatewayHealthPayload\b/, 'Gateway diagnostics service should own health probing')
assert.match(gatewayDiagnosticsService, /\bfunction\s+fetchGatewayReadinessPayload\b/, 'Gateway diagnostics service should own readiness probing')
assert.match(gatewayDiagnosticsService, /\bfunction\s+readGatewayStabilitySnapshot\b/, 'Gateway diagnostics service should own stability probing')
assert.match(gatewayLogService, /\bfunction\s+readTailTextWithSignature\b/, 'Gateway log service should own file log tailing')
assert.match(gatewayLogService, /client\.request\('logs\.tail'/, 'Gateway log service should own logs.tail RPC reads')
assert.match(gatewayLogService, /\bfunction\s+pushGatewayLog\b/, 'Gateway log service should own in-memory log mirroring')
assert.match(gatewayChatService, /\bclass\s+LightweightGatewayClient\b/, 'Gateway chat service should own the backend websocket client')
assert.match(gatewayChatService, /request\('chat\.send'/, 'Gateway chat service should own chat.send orchestration')
assert.match(gatewayChatService, /request\('chat\.abort'/, 'Gateway chat service should own chat abort orchestration')
assert.match(runtimeStatusService, /\bfunction\s+buildRuntimeStatusPayload\b/, 'runtime status service should own full status payload construction')
assert.match(runtimeStatusService, /\bfunction\s+buildRuntimeSummaryPayload\b/, 'runtime status service should own summary payload construction')
assert.match(runtimeStatusService, /readRuntimeGatewayLedgerSnapshot\(160\)/, 'runtime status service should read the bounded Gateway ledger snapshot for full status')
assert.match(runtimeStatusService, /readRuntimeGatewayLedgerSnapshot\(48\)/, 'runtime status service should read the bounded Gateway ledger snapshot for summaries')
assert.match(runtimeActionService, /\basync function\s+closeRuntimeSession\b/, 'runtime action service should own runtime session close orchestration')
assert.match(runtimeActionService, /\bfunction\s+abortStaleGatewayChat\b/, 'runtime action service should own stale Gateway chat recovery')
assert.match(runtimeActionService, /\basync function\s+clearRuntimeMonitor\b/, 'runtime action service should own runtime monitor clear orchestration')
assert.match(runtimeActionService, /\basync function\s+shutdownRuntime\b/, 'runtime action service should own runtime shutdown orchestration')
assert.match(runtimeActionService, /\basync function\s+restartGateway\b/, 'runtime action service should own manual Gateway restart orchestration')
assert.match(runtimeRecoveryService, /\basync function\s+clearRuntimeMonitor\b/, 'runtime recovery service should own clean-slate monitor recovery')
assert.match(runtimeRecoveryService, /writeRuntimeMonitorClearMarker\(clearedAt\)/, 'runtime recovery service should persist monitor clear markers')
assert.match(runtimeRecoveryService, /getActiveOpenClawRunCount\(\)/, 'runtime recovery clean-slate should preserve and report active runtime work')
assert.match(runtimeRecoveryService, /\blet shutdownInFlight\b/, 'runtime recovery service should dedupe concurrent shutdown cleanup')
assert.match(runtimeRecoveryService, /\basync function\s+shutdownControlCenterRuntime\b/, 'runtime recovery service should own runtime shutdown cleanup')
assert.match(runtimeRecoveryService, /stopControlCenterGatewayClient\(reason\)/, 'runtime recovery shutdown should stop the Gateway websocket client')
assert.match(runtimeRecoveryService, /closeOAuthCallbackServersForShutdown\(reason\)/, 'runtime recovery shutdown should close OAuth callback servers')
assert.match(runtimeRecoveryService, /\bfunction\s+processExitCleanup\b/, 'runtime recovery service should own process-exit cleanup')
assert.match(missionRoutes, /missionStateService: Pick<MissionStateService, 'startMission' \| 'stopMission'>/, 'mission routes should receive mission state through a service option')
assert.match(missionRoutes, /options\.missionStateService\.startMission\(parsed\.data\)/, 'mission start route should delegate creation/idempotency to missionStateService')
assert.match(missionRoutes, /options\.missionStateService\.stopMission\(parsed\.data\)/, 'mission stop route should delegate cancellation transitions to missionStateService')
assert.match(missionStateService, /\bfunction\s+findMissionByIdempotencyKey\b/, 'mission state service should own launch idempotency lookup')
assert.match(missionStateService, /\basync function\s+startMission\b/, 'mission state service should own mission creation orchestration')
assert.match(missionStateService, /\basync function\s+stopMission\b/, 'mission state service should own mission cancellation orchestration')
assert.match(missionStateService, /\bfunction\s+transitionMissionState\b/, 'mission state service should own lifecycle transitions')
assert.match(missionStateService, /appendMissionEvent\(ledgerEvent\)/, 'mission state service should persist lifecycle events through injected ledger appends')
assert.match(missionStateService, /appendMissionRecord\(missionRecordSnapshot\(mission, reason\)\)/, 'mission state service should persist mission records through injected ledger appends')
assert.match(missionSchedulerService, /export function createMissionSchedulerService/, 'mission scheduler service should expose a service factory')
assert.match(missionSchedulerService, /\basync function\s+startRecurringMissionCronJobs\b/, 'mission scheduler service should own recurring cron arming')
assert.match(missionSchedulerService, /\bfunction\s+scheduleNextMissionRound\b/, 'mission scheduler service should own instant round scheduling')
assert.match(missionSchedulerService, /\basync function\s+runMissionCronRound\b/, 'mission scheduler service should own mission round execution')
assert.match(missionSchedulerService, /\basync function\s+cleanupMissionCronJobs\b/, 'mission scheduler service should own cron cleanup')
assert.match(missionSchedulerService, /\bfunction\s+armRehydratedMissionTimer\b/, 'mission scheduler service should own rehydrated mission timer arming')
assert.match(missionReportService, /export function createMissionReportService/, 'mission report service should expose a service factory')
assert.match(missionReportService, /\bfunction\s+buildMissionReport\b/, 'mission report service should own backend report generation')
assert.match(missionReportService, /\bfunction\s+recordMissionReport\b/, 'mission report service should own report recording')
assert.match(missionReportService, /\basync function\s+listMissionReports\b/, 'mission report service should own report listing')
assert.match(missionReportService, /\basync function\s+buildMissionLifecycleProjection\b/, 'mission report service should own report-backed lifecycle projection')
assert.match(missionReportService, /readMissionReports<BackendMissionReport>/, 'mission report service should read durable reports')
assert.match(missionRecoveryService, /export function createMissionRecoveryService/, 'mission recovery service should expose a service factory')
assert.match(missionRecoveryService, /type MissionCronReconciliationSnapshot =/, 'mission recovery service should own cron reconciliation contracts')
assert.match(missionRecoveryService, /type MissionGatewaySessionReconciliationResult =/, 'mission recovery service should own Gateway session reconciliation contracts')
assert.match(missionRecoveryService, /\bfunction\s+reconcileRehydratedMissionCronJobs\b/, 'mission recovery service should own recovered cron reconciliation')
assert.match(missionRecoveryService, /\basync function\s+reconcileMissionGatewaySessions\b/, 'mission recovery service should own Gateway session reconciliation')
assert.match(missionRecoveryService, /\basync function\s+hydrateMissionRecordsFromLedger\b/, 'mission recovery service should own durable mission hydration')
assert.match(missionRecoveryService, /options\.rehydrateRecurringMissionShifts\(mission, cronState\)/, 'mission recovery service should delegate recovered shift projection through scheduler options')
assert.match(missionRecoveryService, /options\.armRehydratedMissionTimer\(mission, assignments, activity\)/, 'mission recovery service should delegate recovered timer arming through scheduler options')
assert.match(missionTeamSyncService, /export function createMissionTeamSyncService/, 'mission Team Sync service should expose a service factory')
assert.match(missionTeamSyncService, /\bfunction\s+teamSyncMarkdown\b/, 'mission Team Sync service should own snapshot markdown')
assert.match(missionTeamSyncService, /\basync function\s+writeTeamSyncSnapshot\b/, 'mission Team Sync service should own snapshot writes')
assert.match(missionTeamSyncService, /\basync function\s+ensureTeamSyncFile\b/, 'mission Team Sync service should own missing-file repair')
assert.match(controlPlane, /missionSchedulerService\.scheduleNextMissionRound/, 'mission state composition should delegate scheduling through the scheduler service')
assert.match(controlPlane, /const recordMissionReport = missionReportService\.recordMissionReport/, 'controlPlane.ts should delegate report recording through the mission report service')
assert.match(controlPlane, /const buildMissionLifecycleProjection = missionReportService\.buildMissionLifecycleProjection/, 'controlPlane.ts should delegate mission projection through the mission report service')
assert.match(controlPlane, /const hydrateMissionRecordsFromLedger = missionRecoveryService\.hydrateMissionRecordsFromLedger/, 'controlPlane.ts should delegate mission restart hydration through the mission recovery service')
assert.match(controlPlane, /const writeTeamSyncSnapshot = missionTeamSyncService\.writeTeamSyncSnapshot/, 'controlPlane.ts should delegate Team Sync snapshot writes through the Team Sync service')
assert.match(runtimeLedgerStore, /export function createRuntimeLedgerStore/, 'runtime ledger store should expose a state boundary factory')
assert.match(runtimeLedgerStore, /configureRuntimeLedger\(normalizedPaths\)/, 'runtime ledger store should own raw ledger configuration')
assert.match(runtimeLedgerStore, /appendRuntimeRunLedger\(value, options\)/, 'runtime ledger store should wrap runtime run appends')
assert.match(runtimeLedgerStore, /readRuntimeRunLedgerTail<T>\(limit, options\)/, 'runtime ledger store should wrap runtime run reads')
assert.match(runtimeLedgerStore, /readGatewayEventLedgerTail<T>\(limit, options\)/, 'runtime ledger store should wrap Gateway event reads')
assert.match(runtimeLedgerStore, /runtimeLedgerStatus\(options\)/, 'runtime ledger store should expose ledger status')
assert.match(controlPlane, /runtimeLedgerStore\.appendRuntimeRun\(openClawRunLedgerPayload\(record\), \{ mirrorJsonl: false \}\)/, 'controlPlane.ts should persist runtime runs through the ledger store')
assert.match(controlPlane, /runtimeLedgerStatus: runtimeLedgerStore\.status/, 'controlPlane.ts should inject ledger status through the store')
assert.match(controlPlane, /closeRuntimeLedger: runtimeLedgerStore\.close/, 'controlPlane.ts should inject ledger close through the store')
assert.match(shiftRoutes, /export function registerShiftRoutes/, 'shift route module should expose a typed registration boundary')
assert.match(browserRoutes, /export function registerBrowserRoutes/, 'browser route module should expose a typed registration boundary')
assert.match(partyManagementRoutes, /export function registerPartyManagementRoutes/, 'party management route module should expose a typed registration boundary')
assert.match(agentConfigRoutes, /export function registerAgentConfigRoutes/, 'agent config route module should expose a typed registration boundary')
for (const route of [
  '/api/party/overview',
  '/api/party/recruit',
  '/api/party/workspace',
  '/api/party/avatar-upload/:agentId',
]) {
  assert.ok(partyManagementRoutes.includes(route), `party management route module is missing ${route}`)
}
for (const route of [
  '/api/party/agent/:agentId/config',
  '/api/party/configs/sync',
  '/api/party/agent/:agentId/model',
]) {
  assert.ok(agentConfigRoutes.includes(route), `agent config route module is missing ${route}`)
}
assert.match(staticUi, /export function registerStaticUi/, 'static UI module should expose a registration boundary')
assert.match(providerCatalog, /export const AUTH_PROVIDER_CATALOG/, 'provider catalog should remain extracted')
assert.match(routingHelpers, /export const CLAWTALK_CORE_BRIDGE_ROUTING_HELPER/, 'ClawTalk patch source should remain extracted')
assert.match(reporter, /server', 'controlPlane\.ts'/, 'architecture reporter should analyze the composition root')
assert.match(reporter, /Control-plane composition lines/, 'architecture reporter should publish control-plane line-count evidence')

for (const script of ['dev:server', 'build:server', 'start']) {
  assert.ok(packageJson.scripts?.[script]?.includes('server/index.ts'), `${script} should continue targeting the executable facade`)
}
assert.equal(packageJson.scripts?.['smoke:server-architecture'], 'tsx scripts/smoke-server-entrypoint-boundary.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:server-architecture'))

console.log(`server architecture contract ok (${entryLines} entry lines, ${controlPlaneLines}/${CONTROL_PLANE_MAX_LINES} composition lines, ${inlineRoutes.length} inline routes, guard: ${CONTROL_PLANE_GUARD_COMMENT})`)

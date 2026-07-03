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
const modelCatalogService = read('server/services/providers/modelCatalogService.ts')
const providerAuthService = read('server/services/providers/providerAuthService.ts')
const oauthCallbackService = read('server/services/providers/oauthCallbackService.ts')
const providerSetupService = read('server/services/providers/providerSetupService.ts')
const pluginInventoryService = read('server/services/plugins/pluginInventoryService.ts')
const pluginInstallService = read('server/services/plugins/pluginInstallService.ts')
const pluginDiagnosticsService = read('server/services/plugins/pluginDiagnosticsService.ts')
const pluginRuntimeService = read('server/services/plugins/pluginRuntimeService.ts')
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
const controlFilesService = read('server/services/controlFilesService.ts')
const avatarFileService = read('server/services/filesystem/avatarFileService.ts')
const safePathService = read('server/services/filesystem/safePathService.ts')
const commandConsoleUploadService = read('server/services/filesystem/commandConsoleUploadService.ts')
const pickerSessionService = read('server/services/filesystem/pickerSessionService.ts')
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
  ["from './services/providers/modelCatalogService'", 'model catalog service import'],
  ["from './services/providers/providerAuthService'", 'provider auth service import'],
  ["from './services/providers/oauthCallbackService'", 'OAuth callback service import'],
  ["from './services/providers/providerSetupService'", 'provider setup service import'],
  ["from './services/plugins/pluginInventoryService'", 'plugin inventory service import'],
  ["from './services/plugins/pluginInstallService'", 'plugin install service import'],
  ["from './services/plugins/pluginDiagnosticsService'", 'plugin diagnostics service import'],
  ["from './services/plugins/pluginRuntimeService'", 'plugin runtime service import'],
  ["from './services/controlFilesService'", 'control-files service import'],
  ["from './services/filesystem/avatarFileService'", 'avatar file service import'],
  ["from './services/filesystem/safePathService'", 'safe path service import'],
  ["from './services/filesystem/commandConsoleUploadService'", 'command-console upload service import'],
  ["from './services/filesystem/pickerSessionService'", 'picker session service import'],
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
  ['createModelCatalogService({', 'model catalog service composition'],
  ['createProviderAuthService({', 'provider auth service composition'],
  ['createOAuthCallbackService({', 'OAuth callback service composition'],
  ['createProviderSetupService({', 'provider setup service composition'],
  ['createPluginInventoryService({', 'plugin inventory service composition'],
  ['createPluginInstallService({', 'plugin install service composition'],
  ['createPluginDiagnosticsService({', 'plugin diagnostics service composition'],
  ['createPluginRuntimeService({', 'plugin runtime service composition'],
  ['createSafePathService()', 'safe path service composition'],
  ['createCommandConsoleUploadService({', 'command-console upload service composition'],
  ['createPickerSessionService({', 'picker session service composition'],
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
assert.doesNotMatch(controlPlane, /\bfunction\s+loadAvailableModelsFromOpenClaw\b|\bfunction\s+fallbackAvailableModels\b|\bfunction\s+mergeAvailableModels\b|\bfunction\s+ensureConfiguredProviderModel\b/, 'provider model catalog loading and normalization must stay in modelCatalogService.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+ensureLocalAuthStoreLoaded\b|\basync function\s+persistProviderAuth\b|\basync function\s+persistProviderOAuth\b|\basync function\s+removeProviderAuth\b/, 'provider auth storage mutations must stay in providerAuthService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+providerAuthStatus\b|\bfunction\s+modelAuthProblem\b|\bfunction\s+authProfileProvidersFor\b|\basync function\s+writeProviderApiKeyAuthProfiles\b/, 'provider auth status/profile logic must stay in providerAuthService.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+startGoogleOAuthSession\b|\basync function\s+startOpenAICodexOAuthSession\b|\basync function\s+closeOAuthCallbackServersForShutdown\b/, 'OAuth callback lifecycle must stay in oauthCallbackService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+parseOpenAICodexAuthorizationInput\b|\bfunction\s+failPendingOAuthSessionsForShutdown\b|server\.listen\(1455, '127\.0\.0\.1'/, 'OAuth callback parsing/listeners must stay in oauthCallbackService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+googleVertexGcloudStatus\b|\bfunction\s+resolveGoogleOAuthClientConfig\b|\basync function\s+resolveProviderRequestAuth\b/, 'provider setup checks must stay in providerSetupService.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+importOpenAICodexOAuthModule\b|\bfunction\s+openAICodexOAuthTesting\b|\bfunction\s+runGcloud\b/, 'provider runtime setup/probing helpers must stay in providerSetupService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+loadBundledPluginManifestList\b|\basync function\s+getPluginList\b|\basync function\s+listPluginControls\b/, 'plugin inventory listing and cache reads must stay in pluginInventoryService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+buildPluginControlEntry\b|\bfunction\s+knownPluginConfigFields\b|\bfunction\s+pluginGuidance\b|\bfunction\s+parsePluginList\b/, 'plugin inventory normalization must stay in pluginInventoryService.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+installOpenClawPlugin\b|\basync function\s+updateOpenClawPlugin\b|\basync function\s+updateAllOpenClawPlugins\b|\basync function\s+uninstallOpenClawPlugin\b/, 'plugin install/update/remove mutations must stay in pluginInstallService.ts')
assert.doesNotMatch(controlPlane, /\basync function\s+recordPluginInstallRuntimeState\b|\basync function\s+touchPluginManagedRuntimeState\b|\basync function\s+forgetPluginRuntimeState\b/, 'plugin install runtime-state writes must stay in pluginInstallService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+parsePluginInstallInput\b|\bfunction\s+repairPluginInstallRenameFailure\b|\bfunction\s+parsePluginInstallRenameFailure\b/, 'plugin install parsing and repair logic must stay in pluginInstallService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+normalizeClawTalkApiKeyInput\b|\bfunction\s+normalizeClawTalkServerInput\b|\bfunction\s+parseClawTalkDoctorSummary\b|\basync function\s+waitForClawTalkDoctor\b|\basync function\s+setupClawTalkPlugin\b/, 'plugin doctor/setup output must stay in pluginDiagnosticsService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+isPathUnder\b|\bfunction\s+isInsidePath\b|\bfunction\s+samePath\b/, 'safe path containment and comparison helpers must stay in safePathService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+commandConsoleUploadFileName\b|\bfunction\s+normalizeCommandConsoleAttachment\b|\btype\s+CommandConsoleUploadAttachment\b/, 'command-console upload naming and attachment normalization must stay in commandConsoleUploadService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+avatarUploadFileName\b|\bfunction\s+managedAvatarFileName\b|\bfunction\s+isSupportedAvatarImagePath\b/, 'avatar upload naming and image allowlist helpers must stay in avatarFileService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+startFolderPickerSession\b|\bfunction\s+startImagePickerSession\b|\bfunction\s+serializeFolderPickerSession\b|\bfunction\s+serializeImagePickerSession\b/, 'folder/image picker session state must stay in pickerSessionService.ts')
assert.doesNotMatch(controlPlane, /\bfunction\s+launchWindowsFolderPickerSession\b|\bfunction\s+launchWindowsImagePickerSession\b|\bfunction\s+runPickerCommand\b|\bfunction\s+normalizePickerStartPath\b|\bfunction\s+pickFolderWithOsDialog\b|\bfunction\s+pickImageWithOsDialog\b/, 'native picker command handling must stay in pickerSessionService.ts')
assert.doesNotMatch(controlPlane, /app\.(?:get|post)\(['"]\/api\/shifts/, 'shift endpoints must remain outside controlPlane.ts')
assert.doesNotMatch(controlPlane, /app\.get\(['"]\/api\/browser\/preflight/, 'browser preflight must remain outside controlPlane.ts')
assert.match(runtimeRoutes, /runtimeActions: RuntimeActionService/, 'runtime routes should receive runtime actions through a service option')
assert.match(controlPlane, /runtimeActions: runtimeActionService/, 'controlPlane.ts should inject the runtime action service into runtime routes')
assert.match(runtimeActionService, /ensureGatewayRunning: \(\) => Promise<void>/, 'runtime action service should accept Gateway lifecycle start through options')
assert.match(runtimeActionService, /gatewayStatusSnapshot: \(healthy: boolean, listenerPid\?: number \| null\) => GatewayStatusSnapshot/, 'runtime action service should receive Gateway Monitor status through options')
assert.match(runtimeActionService, /tryRestartGatewayService: \(options: \{ force\?: boolean; allowExternalTakeover\?: boolean; reason\?: string \}\) => Promise<unknown>/, 'runtime action service should receive Gateway restart through options')
assert.match(runtimeActionService, /runtimeRecovery: Pick<RuntimeRecoveryService, 'clearRuntimeMonitor' \| 'shutdownRuntime'>/, 'runtime action service should receive clean-slate and shutdown recovery through options')
assert.match(runtimeActionService, /allowExternalTakeover: true/, 'manual Gateway restarts should explicitly opt into external listener takeover')
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
assert.match(modelCatalogService, /export function createModelCatalogService/, 'model catalog service should expose a service factory')
assert.match(modelCatalogService, /export const FALLBACK_MODELS/, 'model catalog service should own fallback model metadata')
assert.match(modelCatalogService, /export const KNOWN_UNAVAILABLE_MODEL_IDS/, 'model catalog service should own unavailable model metadata')
assert.match(modelCatalogService, /\bfunction\s+ensureConfiguredModelAllowlist\b/, 'model catalog service should own configured model allowlist normalization')
assert.match(modelCatalogService, /\bfunction\s+ensureOpenRouterModelCatalogAllowlist\b/, 'model catalog service should own OpenRouter allowlist normalization')
assert.match(modelCatalogService, /\basync function\s+loadAvailableModelsFromOpenClaw\b/, 'model catalog service should own model catalog loading')
assert.match(providerAuthService, /export function createProviderAuthService/, 'provider auth service should expose a service factory')
assert.match(providerAuthService, /\basync function\s+ensureLocalAuthStoreLoaded\b/, 'provider auth service should own credential-store hydration')
assert.match(providerAuthService, /\basync function\s+persistProviderAuth\b/, 'provider auth service should own API-key persistence')
assert.match(providerAuthService, /\basync function\s+persistProviderOAuth\b/, 'provider auth service should own OAuth persistence')
assert.match(providerAuthService, /\basync function\s+removeProviderAuth\b/, 'provider auth service should own auth removal')
assert.match(providerAuthService, /\bfunction\s+providerAuthStatus\b/, 'provider auth service should own provider status shaping')
assert.match(providerAuthService, /\bfunction\s+modelAuthProblem\b/, 'provider auth service should own missing-auth model checks')
assert.match(providerAuthService, /\basync function\s+writeProviderApiKeyAuthProfiles\b/, 'provider auth service should own OpenClaw API-key profile writes')
assert.match(providerAuthService, /\basync function\s+writeProviderOAuthAuthProfiles\b/, 'provider auth service should own OpenClaw OAuth profile writes')
assert.match(oauthCallbackService, /export function createOAuthCallbackService/, 'OAuth callback service should expose a service factory')
assert.match(oauthCallbackService, /const oauthSessions = new Map<string, ProviderOAuthSession>\(\)/, 'OAuth callback service should own session storage')
assert.match(oauthCallbackService, /\basync function\s+startGoogleOAuthSession\b/, 'OAuth callback service should own Google OAuth start lifecycle')
assert.match(oauthCallbackService, /\basync function\s+startOpenAICodexOAuthSession\b/, 'OAuth callback service should own OpenAI Codex OAuth start lifecycle')
assert.match(oauthCallbackService, /\basync function\s+closeOAuthCallbackServersForShutdown\b/, 'OAuth callback service should own listener shutdown cleanup')
assert.match(oauthCallbackService, /\bfunction\s+parseOpenAICodexAuthorizationInput\b/, 'OAuth callback service should own manual code parsing')
assert.match(oauthCallbackService, /server\.listen\(openAiCodexCallbackPort, '127\.0\.0\.1'/, 'OpenAI Codex callback listener should stay loopback-only')
assert.match(providerSetupService, /export function createProviderSetupService/, 'provider setup service should expose a service factory')
assert.match(providerSetupService, /\bfunction\s+googleVertexGcloudStatus\b/, 'provider setup service should own Google Vertex readiness checks')
assert.match(providerSetupService, /\bfunction\s+resolveGoogleOAuthClientConfig\b/, 'provider setup service should own Google OAuth client setup checks')
assert.match(providerSetupService, /\basync function\s+resolveProviderRequestAuth\b/, 'provider setup service should own provider request auth checks')
assert.match(providerSetupService, /\basync function\s+importOpenAICodexOAuthModule\b/, 'provider setup service should own OpenAI Codex OAuth runtime loading')
assert.match(pluginInventoryService, /export function createPluginInventoryService/, 'plugin inventory service should expose a service factory')
assert.match(pluginInventoryService, /\bfunction\s+loadBundledPluginManifestList\b/, 'plugin inventory service should own bundled manifest discovery')
assert.match(pluginInventoryService, /\basync function\s+refreshPluginListCache\b/, 'plugin inventory service should own plugin list cache refresh')
assert.match(pluginInventoryService, /\basync function\s+getPluginList\b/, 'plugin inventory service should own plugin list cache reads')
assert.match(pluginInventoryService, /\basync function\s+listPluginControls\b/, 'plugin inventory service should own plugin control payload shaping')
assert.match(pluginInventoryService, /\bfunction\s+buildPluginControlEntry\b/, 'plugin inventory service should own plugin control entry normalization')
assert.match(pluginInventoryService, /\bfunction\s+knownPluginConfigFields\b/, 'plugin inventory service should own plugin setup field projection')
assert.match(pluginInstallService, /export function createPluginInstallService/, 'plugin install service should expose a service factory')
assert.match(pluginInstallService, /\basync function\s+installOpenClawPlugin\b/, 'plugin install service should own plugin install orchestration')
assert.match(pluginInstallService, /\basync function\s+updateOpenClawPlugin\b/, 'plugin install service should own plugin update orchestration')
assert.match(pluginInstallService, /\basync function\s+updateAllOpenClawPlugins\b/, 'plugin install service should own plugin update-all orchestration')
assert.match(pluginInstallService, /\basync function\s+uninstallOpenClawPlugin\b/, 'plugin install service should own plugin uninstall orchestration')
assert.match(pluginInstallService, /\bfunction\s+recordPluginInstallRuntimeState\b/, 'plugin install service should own install runtime-state records')
assert.match(pluginInstallService, /\bfunction\s+touchPluginManagedRuntimeState\b/, 'plugin install service should own update runtime-state touches')
assert.match(pluginInstallService, /\bfunction\s+forgetPluginRuntimeState\b/, 'plugin install service should own uninstall runtime-state cleanup')
assert.match(pluginInstallService, /\bfunction\s+repairPluginInstallRenameFailure\b/, 'plugin install service should own install rename-failure repair')
assert.match(pluginInstallService, /options\.schedulePluginGatewayRestart\(\)/, 'plugin install service should schedule Gateway restarts after plugin mutations')
assert.match(pluginInstallService, /options\.refreshPluginListCache\(\)/, 'plugin install service should refresh plugin controls after plugin mutations')
assert.match(pluginInstallService, /options\.redactSensitiveText/, 'plugin install service should redact command output and errors')
assert.match(pluginDiagnosticsService, /export function createPluginDiagnosticsService/, 'plugin diagnostics service should expose a service factory')
assert.match(pluginDiagnosticsService, /\bfunction\s+normalizeClawTalkApiKeyInput\b/, 'plugin diagnostics service should own ClawTalk API key normalization')
assert.match(pluginDiagnosticsService, /\bfunction\s+normalizeClawTalkServerInput\b/, 'plugin diagnostics service should own ClawTalk server normalization')
assert.match(pluginDiagnosticsService, /\bfunction\s+parseClawTalkDoctorSummary\b/, 'plugin diagnostics service should own ClawTalk doctor output parsing')
assert.match(pluginDiagnosticsService, /\basync function\s+waitForClawTalkDoctor\b/, 'plugin diagnostics service should own ClawTalk doctor polling')
assert.match(pluginDiagnosticsService, /\basync function\s+waitForClawTalkRuntimeInspect\b/, 'plugin diagnostics service should own ClawTalk runtime inspect polling')
assert.match(pluginDiagnosticsService, /\basync function\s+setupClawTalkPlugin\b/, 'plugin diagnostics service should own ClawTalk setup orchestration')
assert.match(pluginDiagnosticsService, /options\.redactSensitiveText/, 'plugin diagnostics service should redact ClawTalk doctor command output')
assert.match(controlPlane, /const setupClawTalkPlugin: PluginDiagnosticsService\['setupClawTalkPlugin'\]/, 'controlPlane.ts should expose only a thin plugin diagnostics wrapper')
assert.match(controlPlane, /activePluginDiagnosticsService\(\)\.setupClawTalkPlugin\(params\)/, 'controlPlane.ts should delegate ClawTalk setup through the plugin diagnostics service')
assert.match(pluginRuntimeService, /export function createPluginRuntimeService/, 'plugin runtime service should expose a service factory')
assert.match(pluginRuntimeService, /\basync function\s+inspectOpenClawPluginRuntime\b/, 'plugin runtime service should own plugin runtime inspect')
assert.match(pluginRuntimeService, /\bfunction\s+summarizePluginRuntimeInspect\b/, 'plugin runtime service should own runtime inspect summaries')
assert.match(pluginRuntimeService, /\bfunction\s+startPluginSetupTerminalSession\b/, 'plugin runtime service should own setup terminal starts')
assert.match(pluginRuntimeService, /\bfunction\s+attachPluginSetupTerminalClient\b/, 'plugin runtime service should own setup terminal client attachments')
assert.match(pluginRuntimeService, /\bfunction\s+writePluginSetupTerminalInput\b/, 'plugin runtime service should own terminal input writes')
assert.match(pluginRuntimeService, /\bfunction\s+resizePluginSetupTerminalSession\b/, 'plugin runtime service should own terminal resize commands')
assert.match(pluginRuntimeService, /\bfunction\s+stopAllPluginSetupTerminalSessions\b/, 'plugin runtime service should own terminal shutdown cleanup')
assert.match(pluginRuntimeService, /options\.runOpenClaw\(args, 120_000\)/, 'plugin runtime inspect should execute bounded OpenClaw commands')
assert.match(pluginRuntimeService, /options\.redactSensitiveText/, 'plugin runtime service should redact command output and errors')
assert.match(safePathService, /export function createSafePathService/, 'safe path service should expose a service factory')
assert.match(safePathService, /\bfunction\s+resolvedComparisonPath\b/, 'safe path service should own path normalization for comparison')
assert.match(safePathService, /export function isPathUnder/, 'safe path service should own containment checks')
assert.match(safePathService, /export function samePath/, 'safe path service should own path equality checks')
assert.match(controlPlane, /const isPathUnder = safePathService\.isPathUnder/, 'controlPlane.ts should delegate path containment through the safe path service')
assert.match(controlPlane, /const samePath = safePathService\.samePath/, 'controlPlane.ts should delegate path equality through the safe path service')
assert.match(controlFilesService, /export function createControlFilesService/, 'control-files service should expose a service factory')
assert.match(controlFilesService, /\bfunction\s+resolveControlFilePath\b/, 'control-files service should own control-file path resolution')
assert.match(controlFilesService, /isPathUnder\(resolvedWorkspaceRoot, targetPath\)/, 'control-files service should enforce workspace containment')
assert.match(controlFilesService, /\basync\s+readFile\b/, 'control-files service should own control-file reads')
assert.match(controlFilesService, /\basync\s+writeFile\b/, 'control-files service should own control-file writes')
assert.match(controlPlane, /createControlFilesService\(WORKSPACE_ROOT,\s*\{\s*isPathUnder\s*\}\)/, 'controlPlane.ts should compose control-files service with safe path containment')
assert.match(avatarFileService, /export const AVATAR_UPLOAD_LIMIT_BYTES/, 'avatar file service should own avatar upload size limits')
assert.match(avatarFileService, /export function assertAvatarUploadBytes/, 'avatar file service should own avatar upload byte validation')
assert.match(avatarFileService, /export function assertAvatarUploadSize/, 'avatar file service should own avatar upload stat-size validation')
assert.match(avatarFileService, /export function avatarUploadFileName/, 'avatar file service should own avatar upload file naming')
assert.match(avatarFileService, /export function managedAvatarFileName/, 'avatar file service should own managed avatar file naming')
assert.match(avatarFileService, /export function isSupportedAvatarImagePath/, 'avatar file service should own avatar image allowlist checks')
assert.match(avatarFileService, /extFromName && !AVATAR_IMAGE_EXTENSIONS\.has\(extFromName\)/, 'avatar file service should reject unsupported explicit extensions before MIME fallback')
assert.match(controlPlane, /assertAvatarUploadBytes\(bytes, AVATAR_UPLOAD_LIMIT_BYTES\)/, 'avatar byte persistence should use the service-owned size validator')
assert.match(controlPlane, /assertAvatarUploadSize\(stat\.size, AVATAR_UPLOAD_LIMIT_BYTES\)/, 'avatar path persistence should use the service-owned size validator')
assert.match(commandConsoleUploadService, /export function createCommandConsoleUploadService/, 'command-console upload service should expose a service factory')
assert.match(commandConsoleUploadService, /\bfunction\s+commandConsoleUploadFileName\b/, 'command-console upload service should own file naming')
assert.match(commandConsoleUploadService, /\basync function\s+persistUpload\b/, 'command-console upload service should own upload persistence')
assert.match(commandConsoleUploadService, /\basync function\s+assertUploadWriteRoot\b/, 'command-console upload service should own realpath upload write-root validation')
assert.match(commandConsoleUploadService, /flag: 'wx'/, 'command-console upload service should create upload files without following existing targets')
assert.match(commandConsoleUploadService, /\bfunction\s+normalizeAttachment\b/, 'command-console upload service should own attachment normalization')
assert.match(commandConsoleUploadService, /\basync function\s+gatewayAttachmentsFromTurnAttachments\b/, 'command-console upload service should own Gateway attachment conversion')
assert.match(controlPlane, /approvedRootDir:\s*WORKSPACE_ROOT/, 'controlPlane.ts should compose command-console uploads with the approved workspace root')
assert.match(controlPlane, /return commandConsoleUploadService\.persistUpload\(\s*bytes,\s*sourceName,\s*rawMimeType\s*\)/, 'controlPlane.ts should keep only a thin upload persistence delegate')
assert.match(controlPlane, /return commandConsoleUploadService\.gatewayAttachmentsFromTurnAttachments\(attachments\)/, 'controlPlane.ts should keep only a thin Gateway attachment delegate')
assert.match(pickerSessionService, /export function createPickerSessionService/, 'picker session service should expose a service factory')
assert.match(pickerSessionService, /\bfunction\s+startFolderPickerSession\b/, 'picker session service should own folder session starts')
assert.match(pickerSessionService, /\bfunction\s+startImagePickerSession\b/, 'picker session service should own image session starts')
assert.match(pickerSessionService, /\bfunction\s+launchWindowsFolderPickerSession\b/, 'picker session service should own Windows folder picker launchers')
assert.match(pickerSessionService, /\bfunction\s+launchWindowsImagePickerSession\b/, 'picker session service should own Windows image picker launchers')
assert.match(pickerSessionService, /\bfunction\s+runPickerCommand\b/, 'picker session service should own native picker command execution')
assert.match(pickerSessionService, /\bfunction\s+normalizePickerStartPath\b/, 'picker session service should own picker start-path normalization')
assert.match(controlPlane, /const pickerSessionService = createPickerSessionService\(\{/, 'controlPlane.ts should compose picker session service')
assert.match(controlPlane, /pickerSessions: pickerSessionService/, 'controlPlane.ts should inject picker sessions into filesystem routes')
assert.match(controlPlane, /missionSchedulerService\.scheduleNextMissionRound/, 'mission state composition should delegate scheduling through the scheduler service')
assert.match(controlPlane, /const recordMissionReport = missionReportService\.recordMissionReport/, 'controlPlane.ts should delegate report recording through the mission report service')
assert.match(controlPlane, /const buildMissionLifecycleProjection = missionReportService\.buildMissionLifecycleProjection/, 'controlPlane.ts should delegate mission projection through the mission report service')
assert.match(controlPlane, /const hydrateMissionRecordsFromLedger = missionRecoveryService\.hydrateMissionRecordsFromLedger/, 'controlPlane.ts should delegate mission restart hydration through the mission recovery service')
assert.match(controlPlane, /const writeTeamSyncSnapshot = missionTeamSyncService\.writeTeamSyncSnapshot/, 'controlPlane.ts should delegate Team Sync snapshot writes through the Team Sync service')
assert.match(controlPlane, /const fallbackAvailableModels = modelCatalogService\.fallbackAvailableModels/, 'controlPlane.ts should delegate fallback model catalog reads through the model catalog service')
assert.match(controlPlane, /const refreshAvailableModelsCache = modelCatalogService\.refreshAvailableModelsCache/, 'controlPlane.ts should delegate model catalog refresh through the model catalog service')
assert.match(controlPlane, /const persistProviderAuth = providerAuthService\.persistProviderAuth/, 'controlPlane.ts should delegate provider auth saves through the provider auth service')
assert.match(controlPlane, /const providerAuthStatus = providerAuthService\.providerAuthStatus/, 'controlPlane.ts should delegate provider auth status through the provider auth service')
assert.match(controlPlane, /const startGoogleOAuthSession = oauthCallbackService\.startGoogleOAuthSession/, 'controlPlane.ts should delegate Google OAuth starts through the OAuth callback service')
assert.match(controlPlane, /const closeOAuthCallbackServersForShutdown = oauthCallbackService\.closeOAuthCallbackServersForShutdown/, 'controlPlane.ts should delegate OAuth listener shutdown through the OAuth callback service')
assert.match(controlPlane, /const googleVertexGcloudStatus = providerSetupService\.googleVertexGcloudStatus/, 'controlPlane.ts should delegate Google Vertex readiness through the provider setup service')
assert.match(controlPlane, /const resolveProviderRequestAuth = providerSetupService\.resolveProviderRequestAuth/, 'controlPlane.ts should delegate provider request auth through the provider setup service')
assert.match(controlPlane, /function listPluginControls\(options\?: \{ forceRefresh\?: boolean \}\)/, 'controlPlane.ts should expose only a thin plugin inventory payload wrapper')
assert.match(controlPlane, /activePluginInventoryService\(\)\.listPluginControls\(options\)/, 'controlPlane.ts should delegate plugin inventory payloads through the plugin inventory service')
assert.match(controlPlane, /const installOpenClawPlugin: PluginInstallService\['installOpenClawPlugin'\]/, 'controlPlane.ts should expose only a thin plugin install wrapper')
assert.match(controlPlane, /activePluginInstallService\(\)\.installOpenClawPlugin\(params\)/, 'controlPlane.ts should delegate plugin install through the plugin install service')
assert.match(controlPlane, /activePluginInventoryService\(\)\.refreshPluginListCache\(\)/, 'controlPlane.ts should delegate plugin inventory cache refresh through the plugin inventory service')
assert.match(controlPlane, /const inspectOpenClawPluginRuntime: PluginRuntimeService\['inspectOpenClawPluginRuntime'\]/, 'controlPlane.ts should expose only a thin plugin runtime inspect wrapper')
assert.match(controlPlane, /activePluginRuntimeService\(\)\.stopAllPluginSetupTerminalSessions\(reason\)/, 'controlPlane.ts should delegate plugin terminal shutdown through the plugin runtime service')
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

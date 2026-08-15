import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function routeBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `Missing route marker: ${marker}`)
  const remaining = source.slice(start + marker.length)
  const nextMatch = /\n\s+app\./.exec(remaining)
  const next = nextMatch ? start + marker.length + nextMatch.index : -1
  return source.slice(start, next >= 0 ? next : source.length)
}

const server = readWorkspaceFile('server/controlPlane.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const diagnosticsRoutes = readWorkspaceFile('server/routes/diagnosticsRoutes.ts')
const providerAuthRoutes = readWorkspaceFile('server/routes/providerAuthRoutes.ts')
const runtimeRoutes = readWorkspaceFile('server/routes/runtimeRoutes.ts')
const gatewayLifecycleService = readWorkspaceFile('server/services/gateway/gatewayLifecycleService.ts')
const gatewayChatService = readWorkspaceFile('server/services/gateway/gatewayChatService.ts')
const oauthCallbackService = readWorkspaceFile('server/services/providers/oauthCallbackService.ts')
const pluginRuntimeService = readWorkspaceFile('server/services/plugins/pluginRuntimeService.ts')
const runtimeActionService = readWorkspaceFile('server/services/runtime/runtimeActionService.ts')
const runtimeRecoveryService = readWorkspaceFile('server/services/runtime/runtimeRecoveryService.ts')
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
const liveMonitor = readWorkspaceFile('src/components/monitor/LiveOperationMonitor.tsx')
const phaseKGatewayRestartSmoke = readWorkspaceFile('scripts/smoke-phase-k-gateway-restart-ui.ts')
const phaseKGatewayTrayRecoverySmoke = readWorkspaceFile('scripts/smoke-phase-k-gateway-tray-recovery.ts')
const electronMain = readWorkspaceFile('electron/main.cjs')
const editor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const store = readWorkspaceFile('src/store/nexusStore.ts')
const agentTurnsApi = readWorkspaceFile('src/api/agentTurns.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'doctor_operation_failed',
  'model_catalog_failed',
  'runtime_action_failed',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.post('/api/doctor/run'",
  "app.post('/api/doctor/repair'",
  "app.get('/api/doctor/recent'",
]) {
  const block = routeBlock(diagnosticsRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

for (const marker of [
  "app.post('/api/openclaw/runtime/session/close'",
  "app.post('/api/openclaw/runtime/chat/abort-stale'",
  "app.post('/api/openclaw/runtime/run/abort'",
  "app.post('/api/openclaw/runtime/monitor/clear'",
  "app.post('/api/openclaw/runtime/shutdown'",
  "app.post('/api/openclaw/runtime/gateway/stop'",
  "app.post('/api/openclaw/runtime/gateway/start'",
  "app.post('/api/openclaw/runtime/gateway/restart'",
]) {
  const block = routeBlock(runtimeRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
  assert(!server.includes(marker), `${marker} should be owned by server/routes/runtimeRoutes.ts, not server/index.ts`)
}

{
  const marker = "app.get('/api/models/available'"
  const block = routeBlock(providerAuthRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}
assert(server.includes('registerRuntimeRoutes(app, {'), 'server/index.ts should register extracted runtime routes')
assert(server.includes('registerProviderAuthRoutes(app, {'), 'server/index.ts should register extracted provider auth routes')
assert(server.includes("from './services/runtime/runtimeActionService'"), 'server/index.ts should import the runtime action service')
assert(server.includes("from './services/runtime/runtimeRecoveryService'"), 'server/index.ts should import the runtime recovery service')
assert(server.includes('createRuntimeRecoveryService({'), 'server/index.ts should compose the runtime recovery service')
assert(server.includes('createRuntimeActionService({'), 'server/index.ts should compose the runtime action service')
assert(server.includes('runtimeActions: runtimeActionService'), 'server/index.ts should inject runtime actions through route options')
assert(server.includes('runtimeRecovery: runtimeRecoveryService'), 'server/index.ts should inject runtime recovery through runtime actions')
assert(runtimeRoutes.includes('runtimeActions: RuntimeActionService'), 'runtime routes should receive the runtime action service through options')
for (const fragment of [
  'options.runtimeActions.closeRuntimeSession',
  'options.runtimeActions.abortStaleGatewayChat',
  'options.runtimeActions.abortOpenClawRun',
  'options.runtimeActions.clearRuntimeMonitor',
  'options.runtimeActions.shutdownRuntime',
  'options.runtimeActions.stopGateway',
  'options.runtimeActions.startGateway',
  'options.runtimeActions.restartGateway',
]) {
  assert(runtimeRoutes.includes(fragment), `runtime routes should delegate to ${fragment}`)
}
for (const fragment of [
  'abortGatewayRuntimeSessionsForClose',
  'cleanupOpenClawSessionLocks',
  'readExternalGatewayLogEntries',
  'shutdownControlCenterRuntime',
  'tryRestartGatewayService',
]) {
  assert(!runtimeRoutes.includes(fragment), `runtime routes should not orchestrate ${fragment} directly`)
}
assert(runtimeActionService.includes('export function createRuntimeActionService'), 'runtime action service should expose a service factory')
assert(runtimeActionService.includes('async function closeRuntimeSession'), 'runtime action service should own session close orchestration')
assert(runtimeActionService.includes('function abortStaleGatewayChat'), 'runtime action service should own stale Gateway chat aborts')
assert(runtimeActionService.includes("runtimeRecovery: Pick<RuntimeRecoveryService, 'clearRuntimeMonitor' | 'shutdownRuntime'>"), 'runtime action service should receive runtime recovery through options')
assert(runtimeActionService.includes('async function clearRuntimeMonitor'), 'runtime action service should expose the monitor clear action')
assert(runtimeActionService.includes('return options.runtimeRecovery.clearRuntimeMonitor()'), 'runtime action service should delegate clean-slate recovery to the recovery service')
assert(runtimeActionService.includes('async function shutdownRuntime'), 'runtime action service should expose runtime shutdown')
assert(runtimeActionService.includes("return options.runtimeRecovery.shutdownRuntime('desktop quit')"), 'runtime action service should delegate shutdown cleanup to the recovery service')
assert(runtimeActionService.includes('async function stopGateway'), 'runtime action service should own Gateway stop orchestration')
assert(runtimeActionService.includes('async function startGateway'), 'runtime action service should own Gateway start orchestration')
assert(runtimeActionService.includes('async function restartGateway'), 'runtime action service should own Gateway restart orchestration')
assert(runtimeActionService.includes("reason: 'manual gateway restart requested'"), 'manual Gateway restarts should pass a structured restart reason')
assert(runtimeActionService.includes('allowExternalTakeover: true'), 'manual Gateway restarts should explicitly opt into external listener takeover')
assert(runtimeActionService.includes("'operator stale-turn recovery'"), 'stale Gateway chat recovery should keep the operator evidence reason')
assert(runtimeActionService.includes("'runtime session close follow-up'"), 'session close should schedule a follow-up lock sweep')
assert(runtimeRecoveryService.includes('export function createRuntimeRecoveryService'), 'runtime recovery service should expose a service factory')
assert(runtimeRecoveryService.includes('async function clearRuntimeMonitor'), 'runtime recovery service should own clean-slate monitor recovery')
assert(runtimeRecoveryService.includes("sweepOpenClawSessionLocks('monitor clear'"), 'clean-slate recovery should sweep stale session locks')
assert(runtimeRecoveryService.includes('writeRuntimeMonitorClearMarker(clearedAt)'), 'clean-slate recovery should persist the clear marker')
assert(runtimeRecoveryService.includes('getActiveOpenClawRunCount()'), 'clean-slate recovery should report active runs without stopping them')
assert(runtimeRecoveryService.includes('let shutdownInFlight'), 'runtime recovery service should dedupe concurrent shutdown cleanup')
assert(runtimeRecoveryService.includes('async function shutdownControlCenterRuntime'), 'runtime recovery service should own runtime shutdown cleanup')
assert(runtimeRecoveryService.includes('stopControlCenterGatewayClient(reason)'), 'runtime recovery shutdown should stop the Control Center Gateway websocket client')
assert(runtimeRecoveryService.includes('stopAllPluginSetupTerminalSessions(reason)'), 'runtime recovery shutdown should stop plugin setup terminal child processes')
assert(runtimeRecoveryService.includes('closeOAuthCallbackServersForShutdown(reason)'), 'runtime recovery shutdown should close fixed-port OAuth callback servers')
assert(runtimeRecoveryService.includes('oauthCallbackServers,'), 'runtime recovery shutdown result should report OAuth callback cleanup')
assert(runtimeRecoveryService.includes('function processExitCleanup'), 'runtime recovery service should own process-exit cleanup')
assert(runtimeRecoveryService.includes('closeOAuthCallbackServersForProcessExit(reason)'), 'process-exit cleanup should close OAuth callback listeners synchronously')

assert(
  runtimeHook.includes("import { apiErrorMessage, apiRequest, type ApiErrorEnvelope, type ApiRequestOptions } from '../api/client'"),
  'useRuntimeStatus should import the shared API client and request options',
)
assert(runtimeHook.includes('async function runtimeActionRequest<T>'), 'runtime actions should use a shared apiRequest wrapper')
assert(!runtimeHook.includes('fetchJsonWithTimeout'), 'useRuntimeStatus should not keep a bespoke JSON fetch helper')
assert(!runtimeHook.includes('apiUrl('), 'useRuntimeStatus should not build raw API URLs for JSON actions')
assert(!/\bfetch\s*\(/.test(runtimeHook), 'useRuntimeStatus should not use direct fetch')

for (const fragment of [
  "runtimeActionRequest<RuntimeSessionCloseResult>('/api/openclaw/runtime/session/close'",
  "runtimeActionRequest<GatewayChatAbortStaleResult>('/api/openclaw/runtime/chat/abort-stale'",
  "runtimeActionRequest<RuntimeRunAbortResult>('/api/openclaw/runtime/run/abort'",
  "runtimeActionRequest<{ ok?: boolean; stop?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/stop'",
  "runtimeActionRequest<{ ok?: boolean; start?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/start'",
  "runtimeActionRequest<{ ok?: boolean; restart?: unknown; gateway?: unknown }>('/api/openclaw/runtime/gateway/restart'",
  "runtimeActionRequest<{ restart?: { detail?: string; scheduled?: boolean; restarted?: boolean } }>(`/api/plugins/${encodeURIComponent(pluginId)}`",
  "runtimeActionRequest<unknown>('/api/openclaw/runtime/monitor/clear'",
  "runtimeActionRequest<DoctorRun>('/api/doctor/run'",
  "runtimeActionRequest<DoctorRepairRun>('/api/doctor/repair'",
]) {
  assert(runtimeHook.includes(fragment), `useRuntimeStatus is missing ${fragment}`)
}

assert(diagnosticsRoutes.includes('runDoctorRepair: () => Promise<unknown>'), 'diagnostics routes should accept an injected Doctor repair action')
assert(server.includes('function stopControlCenterGatewayClient'), 'shutdown should explicitly stop the Control Center Gateway websocket client')
assert(gatewayChatService.includes('abortAndRejectGatewayChatWaiters(reason)'), 'Gateway client shutdown should abort pending Gateway chat waiters')
assert(server.includes("const stopAllPluginSetupTerminalSessions: PluginRuntimeService['stopAllPluginSetupTerminalSessions']"), 'shutdown should stop plugin setup terminal child processes through the plugin runtime service')
assert(pluginRuntimeService.includes('function stopAllPluginSetupTerminalSessions'), 'plugin runtime service should own plugin setup terminal child process cleanup')
assert(oauthCallbackService.includes('async function closeOAuthCallbackServersForShutdown'), 'shutdown should close fixed-port OAuth callback servers through the OAuth callback service')
assert(oauthCallbackService.includes('failPendingOAuthSessionsForShutdown(reason)'), 'shutdown should fail pending OAuth sessions instead of leaving listeners active')
assert(server.includes('const closeOAuthCallbackServersForShutdown = oauthCallbackService.closeOAuthCallbackServersForShutdown'), 'control plane should inject OAuth callback shutdown cleanup from the service')
assert(gatewayChatService.includes('if (prewarmTimer) {'), 'Gateway prewarm timer should be tracked for shutdown cleanup')
assert(server.includes('gatewayAutostartTimer'), 'Gateway autostart timer should be tracked for shutdown cleanup')
assert(gatewayLifecycleService.includes('stopControlCenterGatewayClient(`${reason}: gateway runtime stop`)'), 'manual gateway runtime stop should stop the Gateway client too')
assert(server.includes('async function openClawDoctorLintCheck()'), 'Doctor checks should include the upstream OpenClaw lint integration')
assert(server.includes("const args = ['doctor', '--lint', '--json', '--severity-min', 'warning']"), 'Doctor lint should use the documented structured OpenClaw automation posture')
assert(server.includes('type DoctorFindingCategory'), 'Doctor checks should expose structured finding categories')
assert(server.includes('type DoctorGuidedAction'), 'Doctor checks should expose structured guided finding actions')
assert(server.includes('function categorizeDoctorFinding'), 'Doctor checks should categorize upstream findings for operator guidance')
assert(server.includes('function doctorGuidedActionForFinding'), 'Doctor checks should map findings to documented guided actions')
assert(server.includes("['openclaw', 'plugins', 'inspect', pluginId, '--json']"), 'Plugin Doctor findings should point at plugin inspect diagnostics')
assert(server.includes("['openclaw', 'secrets', 'audit', '--check']"), 'Secret Doctor findings should point at the read-only secrets audit')
assert(server.includes("['openclaw', 'sessions', 'cleanup', '--all-agents', '--dry-run', '--json']"), 'Session Doctor findings should point at dry-run cleanup')
assert(server.includes('function normalizeDoctorFinding'), 'Doctor checks should normalize and redact structured finding details')
assert(server.includes('const structuredFindings = findings'), 'Doctor lint should normalize structured OpenClaw findings before persisting them')
assert(server.includes('findings: structuredFindings'), 'Doctor lint should persist categorized findings with checkId/fixHint context')
assert(server.includes('checks.push(await openClawDoctorLintCheck())'), 'Runtime Doctor should include the OpenClaw lint check in persisted diagnostics')
assert(server.includes("const args = ['doctor', '--fix', '--non-interactive', '--yes', '--no-workspace-suggestions']"), 'Doctor repair should use the documented non-interactive OpenClaw repair posture')
assert(server.includes('const doctor = await runDoctorChecks()'), 'Doctor repair should rerun diagnostics after the repair command')
assert(runtimeHook.includes('export type DoctorFindingCategory'), 'runtime status types should expose Doctor finding categories')
assert(runtimeHook.includes('export type DoctorGuidedAction'), 'runtime status types should expose Doctor guided action metadata')
assert(runtimeHook.includes('findings?: DoctorFinding[]'), 'runtime status types should expose structured Doctor findings')
assert(liveMonitor.includes('dy-doctor-finding-list'), 'Runtime Monitor should render structured Doctor findings')
assert(liveMonitor.includes('doctorFindingAction'), 'Runtime Monitor should surface Doctor finding fix hints or repair actions')
assert(liveMonitor.includes('guidedAction.command.join'), 'Runtime Monitor should render guided action commands when available')
assert(!liveMonitor.includes('Gateway Runtime'), 'Runtime Monitor should not render the removed Gateway Runtime strip')
assert(!liveMonitor.includes('restartGatewayFromMonitor'), 'Runtime Monitor should not keep the removed Gateway restart click handler')
assert(liveMonitor.includes('restartGatewayRuntime'), 'Runtime Monitor should import the Gateway restart action for the toolbar button')
assert(liveMonitor.includes('dy-gateway-restart-button'), 'Runtime Monitor should expose a Gateway restart toolbar button')
assert(liveMonitor.includes('Restart Gateway'), 'Runtime Monitor Gateway restart button should be labeled Restart Gateway')
assert(phaseKGatewayRestartSmoke.includes('completedItems: [123]'), 'Phase K Gateway restart smoke should record item 123 completion')
assert(phaseKGatewayRestartSmoke.includes('/api/openclaw/runtime/gateway/restart'), 'Phase K Gateway restart smoke should call the runtime Gateway restart endpoint')
assert(phaseKGatewayRestartSmoke.includes('manual gateway restart requested'), 'Phase K Gateway restart smoke should verify the manual Gateway restart reason')
assert(phaseKGatewayRestartSmoke.includes('monitorRestartButtonPresent'), 'Phase K Gateway restart smoke should pin the Monitor restart UI contract')
assert(electronMain.includes("label: shutdownLabel"), 'Electron tray menu should expose the Gateway shutdown label')
assert(electronMain.includes("const shutdownLabel = gatewayShutdownInFlight && !isQuitting ? 'Shutting Gateway Off...' : 'Shut Gateway Off'"), 'Electron tray menu should label Gateway shutdown clearly')
assert(electronMain.includes('void stopGatewayCompletely()'), 'Electron tray shutdown item should call stopGatewayCompletely')
assert(electronMain.includes('void resetGateway()'), 'Electron tray restart item should call resetGateway')
assert(electronMain.includes("postControlApi('/api/openclaw/runtime/gateway/stop'"), 'Electron tray shutdown should call the runtime Gateway stop endpoint')
assert(electronMain.includes("postControlApi('/api/openclaw/runtime/gateway/restart'"), 'Electron tray recovery should call the runtime Gateway restart endpoint')
assert(electronMain.includes('GATEWAY_CONTROL_ACTION_TIMEOUT_MS'), 'Electron tray Gateway controls should use a shared configurable timeout')
assert(electronMain.includes('AUTOMNIA_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY'), 'Electron E2E should expose tray Gateway recovery assertions')
assert(electronMain.includes('tray-gateway-stop-ok'), 'Electron E2E should log tray Gateway shutdown evidence')
assert(electronMain.includes('tray-gateway-recovery-ok'), 'Electron E2E should log tray Gateway recovery evidence')
assert(phaseKGatewayTrayRecoverySmoke.includes('completedItems: [124]'), 'Phase K tray recovery smoke should record item 124 completion')
assert(phaseKGatewayTrayRecoverySmoke.includes('scripts/smoke-runtime-actions-control-plane.ts'), 'Phase K tray recovery smoke should validate source smoke pinning')
assert(phaseKGatewayTrayRecoverySmoke.includes('AUTOMNIA_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY'), 'Phase K tray recovery smoke should enable the Electron tray Gateway recovery assertion')
assert(phaseKGatewayTrayRecoverySmoke.includes('/api/openclaw/runtime/gateway/stop'), 'Phase K tray recovery smoke should verify the Gateway stop route')
assert(phaseKGatewayTrayRecoverySmoke.includes('/api/openclaw/runtime/gateway/restart'), 'Phase K tray recovery smoke should verify the Gateway recovery route')

assert(editor.includes("apiRequest<{ models?: unknown }>(path, { timeoutMs: EDITOR_MODEL_FETCH_TIMEOUT_MS })"), 'AgentEditorModal should load models through apiRequest')
assert(!editor.includes('fetchWithTimeout'), 'AgentEditorModal should not keep the model fetch timeout helper')
assert(!editor.includes('readJsonResponse'), 'AgentEditorModal should not keep a bespoke JSON parser for models')
assert(!editor.includes('fetch(apiUrl(path)'), 'AgentEditorModal should not use direct fetch for models')

const storeFetchMatches = [...store.matchAll(/\bfetch\s*\(/g)]
assert(storeFetchMatches.length === 0, `nexusStore should not own direct fetch calls after renderer API extraction, found ${storeFetchMatches.length}`)
assert(
  agentTurnsApi.includes("fetchControlCenterWithAuth(apiUrl('/api/openclaw/agent-turn/stream')"),
  'SSE agent-turn endpoint should live in src/api/agentTurns.ts',
)
assert(store.includes('sendStreamingAgentTurn('), 'nexusStore should delegate SSE agent-turn transport to src/api/agentTurns.ts')

assert(
  packageJson.scripts?.['smoke:runtime-actions-control-plane'] === 'tsx scripts/smoke-runtime-actions-control-plane.ts',
  'package.json should expose smoke:runtime-actions-control-plane',
)
assert(
  packageJson.scripts?.['smoke:phase-k-gateway-restart-ui'] === 'tsx scripts/smoke-phase-k-gateway-restart-ui.ts',
  'package.json should expose smoke:phase-k-gateway-restart-ui',
)
assert(
  packageJson.scripts?.['smoke:phase-k-gateway-tray-recovery'] === 'tsx scripts/smoke-phase-k-gateway-tray-recovery.ts',
  'package.json should expose smoke:phase-k-gateway-tray-recovery',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:runtime-actions-control-plane'),
  'test:ci should run the runtime actions control-plane smoke',
)

console.log('runtime actions control-plane contract ok')

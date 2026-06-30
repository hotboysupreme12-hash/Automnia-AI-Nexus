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
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
const liveMonitor = readWorkspaceFile('src/components/monitor/LiveOperationMonitor.tsx')
const editor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const store = readWorkspaceFile('src/store/nexusStore.ts')
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
assert(server.includes('abortAndRejectGatewayChatWaiters(reason)'), 'Gateway client shutdown should abort pending Gateway chat waiters')
assert(server.includes('function stopAllPluginSetupTerminalSessions'), 'shutdown should stop plugin setup terminal child processes')
assert(server.includes('function closeOAuthCallbackServersForShutdown'), 'shutdown should close fixed-port OAuth callback servers')
assert(server.includes('failPendingOAuthSessionsForShutdown(reason)'), 'shutdown should fail pending OAuth sessions instead of leaving listeners active')
assert(server.includes('oauthCallbackServers: Awaited<ReturnType<typeof closeOAuthCallbackServersForShutdown>>'), 'shutdown result should report OAuth callback cleanup')
assert(server.includes('closeOAuthCallbackServersForProcessExit(`${signalName} shutdown`)'), 'process-exit cleanup should close OAuth callback listeners synchronously')
assert(server.includes('controlCenterGatewayPrewarmTimer'), 'Gateway prewarm timer should be tracked for shutdown cleanup')
assert(server.includes('gatewayAutostartTimer'), 'Gateway autostart timer should be tracked for shutdown cleanup')
assert(server.includes('stopControlCenterGatewayClient(`${reason}: gateway runtime stop`)'), 'manual gateway runtime stop should stop the Gateway client too')
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

assert(editor.includes("apiRequest<{ models?: unknown }>(path, { timeoutMs: EDITOR_MODEL_FETCH_TIMEOUT_MS })"), 'AgentEditorModal should load models through apiRequest')
assert(!editor.includes('fetchWithTimeout'), 'AgentEditorModal should not keep the model fetch timeout helper')
assert(!editor.includes('readJsonResponse'), 'AgentEditorModal should not keep a bespoke JSON parser for models')
assert(!editor.includes('fetch(apiUrl(path)'), 'AgentEditorModal should not use direct fetch for models')

const storeFetchMatches = [...store.matchAll(/\bfetch\s*\(/g)]
assert(storeFetchMatches.length === 1, `nexusStore should keep exactly one direct fetch for SSE, found ${storeFetchMatches.length}`)
assert(
  store.includes("fetch(apiUrl('/api/openclaw/agent-turn/stream')"),
  'the remaining nexusStore direct fetch should be the SSE agent-turn stream',
)

assert(
  packageJson.scripts?.['smoke:runtime-actions-control-plane'] === 'tsx scripts/smoke-runtime-actions-control-plane.ts',
  'package.json should expose smoke:runtime-actions-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:runtime-actions-control-plane'),
  'test:ci should run the runtime actions control-plane smoke',
)

console.log('runtime actions control-plane contract ok')

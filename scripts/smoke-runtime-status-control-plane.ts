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
const runtimeRoutes = readWorkspaceFile('server/routes/runtimeRoutes.ts')
const gatewayLifecycleService = readWorkspaceFile('server/services/gateway/gatewayLifecycleService.ts')
const gatewayLogService = readWorkspaceFile('server/services/gateway/gatewayLogService.ts')
const runtimeStatusService = readWorkspaceFile('server/services/runtime/runtimeStatusService.ts')
const runtimeActionService = readWorkspaceFile('server/services/runtime/runtimeActionService.ts')
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
const liveMonitor = readWorkspaceFile('src/components/monitor/LiveOperationMonitor.tsx')
const nexusShell = readWorkspaceFile('src/components/layout/NexusShell.tsx')
const phaseKMonitorSmoke = readWorkspaceFile('scripts/smoke-phase-k-monitor-runtime-evidence.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['runtime_status_failed', 'runtime_summary_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/openclaw/runtime/status'",
  "app.get('/api/openclaw/runtime/summary'",
]) {
  const block = routeBlock(runtimeRoutes, marker)
  assert(block.includes('apiSuccess(res'), `${marker} should return canonical success envelopes`)
  assert(block.includes('apiFailure(res'), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
  assert(!server.includes(marker), `${marker} should be owned by server/routes/runtimeRoutes.ts, not server/index.ts`)
}

assert(server.includes('registerRuntimeRoutes(app, {'), 'server/index.ts should register extracted runtime routes')
assert(server.includes('getRuntimeStatusPayload'), 'server/index.ts should inject the runtime status payload builder')
assert(server.includes('getRuntimeSummaryPayload'), 'server/index.ts should inject the runtime summary payload builder')
assert(server.includes("createRuntimeStatusService"), 'server/index.ts should compose the runtime status service')
assert(server.includes('runtimeStatusService.getRuntimeStatusPayload'), 'server/index.ts should delegate runtime status payloads to the service')
assert(server.includes('runtimeStatusService.getRuntimeSummaryPayload'), 'server/index.ts should delegate runtime summary payloads to the service')
assert(!server.includes('async function buildRuntimeStatusPayload'), 'runtime status building should live in server/services/runtime/runtimeStatusService.ts')
assert(!server.includes('async function buildRuntimeSummaryPayload'), 'runtime summary building should live in server/services/runtime/runtimeStatusService.ts')
assert(runtimeStatusService.includes('export function createRuntimeStatusService'), 'runtime status service should expose a service factory')
assert(runtimeStatusService.includes('function buildRuntimeStatusPayload'), 'runtime status service should own full status payload construction')
assert(runtimeStatusService.includes('function buildRuntimeSummaryPayload'), 'runtime status service should own summary payload construction')
assert(gatewayLifecycleService.includes('gatewayLastRestartReason'), 'runtime status should track the last Gateway restart reason')
assert(gatewayLifecycleService.includes('const lastRestartReason = gatewayLastRestartReason || lastRestart?.reason || null'), 'runtime status should fall back to the ledger restart reason')
assert(gatewayLifecycleService.includes('const lastRestartOutcome = gatewayLastRestartOutcome || lastRestart?.outcome || null'), 'runtime status should fall back to the ledger restart outcome')
assert(gatewayLifecycleService.includes("event: 'gateway.restart.lifecycle'"), 'Gateway restart lifecycle should be written as a structured ledger event')
assert(server.includes('gatewayRestartLifecycleSnapshotFromRecords'), 'runtime status should read restart lifecycle back from the Gateway ledger')
assert(server.includes('gatewayRestartLifecycleSnapshotsFromRecords'), 'runtime status should build a bounded Gateway restart lifecycle timeline')
assert(server.includes('gatewayRestartLifecycleTimelineWithMemory'), 'runtime status should merge in-process restart lifecycle with the ledger timeline')
assert(server.includes('recentRestarts: gatewayRestartLifecycleSnapshotsFromRecords(records)'), 'Gateway ledger snapshots should expose recent restart lifecycle rows')
assert(server.includes('const GATEWAY_LEDGER_SNAPSHOT_CACHE_MS'), 'runtime polling should bound Gateway ledger snapshot cache freshness')
assert(server.includes('let gatewayLedgerSnapshotInFlight'), 'runtime polling should coalesce concurrent Gateway ledger snapshot reads')
assert(server.includes('function readRuntimeGatewayLedgerSnapshot'), 'runtime polling should use a hot-path Gateway ledger snapshot cache')
assert(runtimeStatusService.includes('readRuntimeGatewayLedgerSnapshot(160)'), 'full runtime status should use the cached Gateway ledger snapshot reader')
assert(runtimeStatusService.includes('readRuntimeGatewayLedgerSnapshot(48)'), 'runtime summary should use the cached Gateway ledger snapshot reader')
assert(!server.includes('readGatewayLedgerSnapshot(160, { sqlite: false })'), 'full runtime status should not perform an uncached Gateway JSONL tail read')
assert(!server.includes('readGatewayLedgerSnapshot(48, { sqlite: false })'), 'runtime summary should not perform an uncached Gateway JSONL tail read')
assert(runtimeStatusService.includes('gatewayStatusSnapshot(gatewayHealth.healthy, null, gatewayLedgerSnapshot.restart, gatewayLedgerSnapshot.recentRestarts, gatewayStability)'), 'runtime status should hydrate restart lifecycle and stability diagnostics from the ledger snapshot')
assert(gatewayLifecycleService.includes('function restartDiagnostics'), 'runtime status should derive restart diagnostics from the lifecycle timeline')
assert(gatewayLifecycleService.includes('restartDiagnostics: diagnostics'), 'Gateway status payload should expose derived restart diagnostics')
assert(gatewayLifecycleService.includes('activeWork = Math.max(0, stability.summary.active ?? 0, stability.summary.waiting ?? 0)'), 'restart diagnostics should correlate active Gateway work from diagnostics.stability')
assert(gatewayLifecycleService.includes('queuedWork = Math.max(0, stability.summary.queued ?? 0, stability.summary.maxQueueDepth ?? 0)'), 'restart diagnostics should correlate queued Gateway work from diagnostics.stability')
assert(server.includes('gatewayLifecycleEvidence'), 'Doctor gateway diagnostics should include Gateway lifecycle context')
assert(server.includes("const gatewayLifecycleLedger = await boundedOperation('Gateway lifecycle ledger', 3000, async () => readGatewayLedgerSnapshot(80))"), 'Doctor gateway diagnostics should read recent Gateway lifecycle ledger rows')
assert(server.includes("const gatewayStabilityCheck = await boundedOperation('Gateway stability diagnostics', 3000, async () => readGatewayStabilitySnapshot(8))"), 'Doctor gateway diagnostics should correlate Gateway stability recorder data')
assert(server.includes('const gatewayDoctorRestartSnapshot = gatewayLifecycleLedger.value?.restart || null'), 'Doctor gateway diagnostics should derive restart lifecycle from the ledger snapshot')
assert(server.includes('gatewayLifecycleLedger.value?.recentRestarts || []'), 'Doctor gateway diagnostics should include multiple recent restart lifecycle rows')
assert(server.includes('const gatewayDoctorLastRestartReason = gatewayLifecycleState.lastRestartReason || gatewayDoctorLastRestart?.reason || null'), 'Doctor gateway diagnostics should fall back to the ledger restart reason after process restart')
assert(server.includes('Recent restarts:'), 'Doctor gateway diagnostics should summarize a compact restart timeline when multiple rows exist')
assert(server.includes('Restart diagnostics: ${gatewayDoctorRestartDiagnostics.summary}'), 'Doctor gateway diagnostics should include derived restart repair guidance')
assert(runtimeActionService.includes("reason: 'manual gateway restart requested'"), 'manual gateway restarts should pass a structured restart reason')
assert(gatewayLogService.includes('function isGatewayPollingIngressLifecycle'), 'gateway activity should classify polling ingress lifecycle separately')
assert(
  gatewayLogService.includes("if (isGatewayPollingIngressLifecycle(text)) return 'system'"),
  'polling ingress startup/shutdown logs should not count as inbound channel traffic',
)
assert(
  gatewayLogService.includes('if (isGatewayPollingIngressLifecycle(text)) return false'),
  'polling ingress startup/shutdown logs should be excluded from Channel Activity message rows',
)

assert(
  runtimeHook.includes("import { apiErrorMessage, apiRequest, type ApiErrorEnvelope"),
  'useRuntimeStatus should import the shared API client',
)
assert(runtimeHook.includes('function runtimeApiRequestError'), 'useRuntimeStatus should map structured API errors for legacy timeout UX')
assert(runtimeHook.includes('function isRuntimeStatusPayload'), 'useRuntimeStatus should validate runtime status payload shape')
assert(
  runtimeHook.includes("apiRequest<RuntimeStatus>(`/api/openclaw/runtime/status${forceRefresh ? '?refresh=1' : ''}`"),
  'runtime status polling should use apiRequest',
)
assert(
  runtimeHook.includes("apiRequest<RuntimeStatus>(`/api/openclaw/runtime/summary${forceRefresh ? '?refresh=1' : ''}`"),
  'runtime summary polling should use apiRequest',
)
assert(!runtimeHook.includes("fetch(apiUrl(`/api/openclaw/runtime/status"), 'runtime status polling should not use direct fetch')
assert(!runtimeHook.includes("fetch(apiUrl(`/api/openclaw/runtime/summary"), 'runtime summary polling should not use direct fetch')
assert(runtimeHook.includes('runtimeStatusRequestAbortReason === \'idle\''), 'runtime status polling should preserve idle-abort handling')
assert(runtimeHook.includes('runtimeSummaryRequestAbortReason === \'idle\''), 'runtime summary polling should preserve idle-abort handling')
assert(runtimeHook.includes("error.code === 'timeout'"), 'runtime polling should preserve timeout-specific status messages')
assert(runtimeHook.includes('timeoutMs: requestTimeoutMs'), 'runtime polling should pass bounded request timeouts into apiRequest')
assert(runtimeHook.includes('function listCronShiftsForHydration'), 'full runtime status should dedupe cron shift hydration requests')
assert(runtimeHook.includes('RUNTIME_CRON_SHIFT_HYDRATION_CACHE_MS'), 'cron shift hydration should have a short client cache')
assert(runtimeHook.includes('cachedRuntimeSummaryStatus = result.data'), 'runtime summary polling should not hydrate cron shifts with a second request')
assert(runtimeStatusService.includes('gatewayExternalLogSource'), 'runtime summary should expose whether log tails were skipped or used as fallback')
assert(runtimeStatusService.includes("'skipped-ledger-hot-path'"), 'runtime summary should skip external log tails when Gateway ledger evidence is already available')
assert(runtimeHook.includes('lastRestartReason?: string | null'), 'runtime status types should include the last Gateway restart reason')
assert(runtimeHook.includes('recentRestarts?: GatewayRestartLifecycleEntry[]'), 'runtime status types should include the Gateway restart timeline')
assert(runtimeHook.includes('export type GatewayRestartDiagnostics'), 'runtime status types should include Gateway restart diagnostics')
assert(runtimeHook.includes('restartDiagnostics?: GatewayRestartDiagnostics'), 'runtime status Gateway payload should include restart diagnostics')

assert(nexusShell.includes("monitor: { label: 'Monitor'"), 'NexusShell should expose the Monitor workspace')
assert(nexusShell.includes("onClick={() => selectTab('monitor')}"), 'runtime status chrome should open the Monitor workspace')
assert(nexusShell.includes("{tab === 'monitor' &&"), 'NexusShell should mount Monitor when the Monitor tab is active')
assert(nexusShell.includes('<LiveOperationMonitor />'), 'Monitor workspace should render LiveOperationMonitor')
assert(liveMonitor.includes('data-dui-panel="monitor"'), 'LiveOperationMonitor should expose the Monitor panel marker')
assert(!liveMonitor.includes('function runtimeStatusEvidenceLabel'), 'Monitor should not keep the removed runtime evidence label helper')
assert(!liveMonitor.includes('Gateway Runtime'), 'Monitor should not render the removed Gateway Runtime status strip')
assert(!liveMonitor.includes('Ledger fast path'), 'Monitor should not render the removed Gateway ledger fast-path label')
assert(!liveMonitor.includes('Log-tail fallback'), 'Monitor should not render the removed Gateway log-tail fallback label')
assert(liveMonitor.includes("const [tab, setTab] = useState<MonitorTab>('gateway')"), 'Monitor should open on the Gateway runtime tab')
assert(liveMonitor.includes('useRuntimeStatus(5000)'), 'Monitor should subscribe to full runtime status')
assert(liveMonitor.includes('RuntimeGatewayPanel status={runtimeStatus}'), 'Monitor should pass runtime status into the Gateway panel')
assert(liveMonitor.includes('GatewayActivityCard activity={activity}'), 'Monitor should render Gateway channel activity evidence')
assert(liveMonitor.includes('<GatewayLogTailCard logs={logs} />'), 'Monitor should render Gateway log-tail evidence')
assert(liveMonitor.includes('Active Cron Jobs'), 'Monitor should render active cron job evidence')
assert(liveMonitor.includes('DoctorPanel run={displayedDoctorRun}'), 'Monitor should render persisted Doctor runtime diagnostics')
assert(phaseKMonitorSmoke.includes('completedItems: [122]'), 'Phase K Monitor smoke should record item 122 completion')
assert(phaseKMonitorSmoke.includes('/api/openclaw/runtime/status?refresh=1'), 'Phase K Monitor smoke should fetch the full runtime status payload')
assert(phaseKMonitorSmoke.includes('/api/openclaw/runtime/summary?refresh=1'), 'Phase K Monitor smoke should fetch the runtime summary payload')
assert(phaseKMonitorSmoke.includes('Gateway channel activity'), 'Phase K Monitor smoke should pin the visible channel activity surface')
assert(phaseKMonitorSmoke.includes('Gateway log tail'), 'Phase K Monitor smoke should pin the visible log-tail surface')

assert(
  packageJson.scripts?.['smoke:runtime-status-control-plane'] === 'tsx scripts/smoke-runtime-status-control-plane.ts',
  'package.json should expose smoke:runtime-status-control-plane',
)
assert(
  packageJson.scripts?.['smoke:phase-k-monitor-runtime-evidence'] === 'tsx scripts/smoke-phase-k-monitor-runtime-evidence.ts',
  'package.json should expose smoke:phase-k-monitor-runtime-evidence',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:runtime-status-control-plane'),
  'test:ci should run the runtime status control-plane smoke',
)

console.log('runtime status control-plane contract ok')

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
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
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
assert(server.includes('gatewayLastRestartReason'), 'runtime status should track the last Gateway restart reason')
assert(server.includes('const lastRestartReason = gatewayLastRestartReason || lastRestart?.reason || null'), 'runtime status should fall back to the ledger restart reason')
assert(server.includes('const lastRestartOutcome = gatewayLastRestartOutcome || lastRestart?.outcome || null'), 'runtime status should fall back to the ledger restart outcome')
assert(server.includes("event: 'gateway.restart.lifecycle'"), 'Gateway restart lifecycle should be written as a structured ledger event')
assert(server.includes('gatewayRestartLifecycleSnapshotFromRecords'), 'runtime status should read restart lifecycle back from the Gateway ledger')
assert(server.includes('gatewayRestartLifecycleSnapshotsFromRecords'), 'runtime status should build a bounded Gateway restart lifecycle timeline')
assert(server.includes('gatewayRestartLifecycleTimelineWithMemory'), 'runtime status should merge in-process restart lifecycle with the ledger timeline')
assert(server.includes('recentRestarts: gatewayRestartLifecycleSnapshotsFromRecords(records)'), 'Gateway ledger snapshots should expose recent restart lifecycle rows')
assert(server.includes('const GATEWAY_LEDGER_SNAPSHOT_CACHE_MS'), 'runtime polling should bound Gateway ledger snapshot cache freshness')
assert(server.includes('let gatewayLedgerSnapshotInFlight'), 'runtime polling should coalesce concurrent Gateway ledger snapshot reads')
assert(server.includes('function readRuntimeGatewayLedgerSnapshot'), 'runtime polling should use a hot-path Gateway ledger snapshot cache')
assert(server.includes('readRuntimeGatewayLedgerSnapshot(160)'), 'full runtime status should use the cached Gateway ledger snapshot reader')
assert(server.includes('readRuntimeGatewayLedgerSnapshot(48)'), 'runtime summary should use the cached Gateway ledger snapshot reader')
assert(!server.includes('readGatewayLedgerSnapshot(160, { sqlite: false })'), 'full runtime status should not perform an uncached Gateway JSONL tail read')
assert(!server.includes('readGatewayLedgerSnapshot(48, { sqlite: false })'), 'runtime summary should not perform an uncached Gateway JSONL tail read')
assert(server.includes('gatewayStatusSnapshot(gatewayHealth.healthy, null, gatewayLedgerSnapshot.restart, gatewayLedgerSnapshot.recentRestarts, gatewayStability)'), 'runtime status should hydrate restart lifecycle and stability diagnostics from the ledger snapshot')
assert(server.includes('function gatewayRestartDiagnostics'), 'runtime status should derive restart diagnostics from the lifecycle timeline')
assert(server.includes('restartDiagnostics,'), 'Gateway status payload should expose derived restart diagnostics')
assert(server.includes('activeWork = Math.max(0, stability.summary.active ?? 0, stability.summary.waiting ?? 0)'), 'restart diagnostics should correlate active Gateway work from diagnostics.stability')
assert(server.includes('queuedWork = Math.max(0, stability.summary.queued ?? 0, stability.summary.maxQueueDepth ?? 0)'), 'restart diagnostics should correlate queued Gateway work from diagnostics.stability')
assert(server.includes('gatewayLifecycleEvidence'), 'Doctor gateway diagnostics should include Gateway lifecycle context')
assert(server.includes("const gatewayLifecycleLedger = await boundedOperation('Gateway lifecycle ledger', 3000, async () => readGatewayLedgerSnapshot(80))"), 'Doctor gateway diagnostics should read recent Gateway lifecycle ledger rows')
assert(server.includes("const gatewayStabilityCheck = await boundedOperation('Gateway stability diagnostics', 3000, async () => readGatewayStabilitySnapshot(8))"), 'Doctor gateway diagnostics should correlate Gateway stability recorder data')
assert(server.includes('const gatewayDoctorRestartSnapshot = gatewayLifecycleLedger.value?.restart || null'), 'Doctor gateway diagnostics should derive restart lifecycle from the ledger snapshot')
assert(server.includes('gatewayLifecycleLedger.value?.recentRestarts || []'), 'Doctor gateway diagnostics should include multiple recent restart lifecycle rows')
assert(server.includes('const gatewayDoctorLastRestartReason = gatewayLastRestartReason || gatewayDoctorLastRestart?.reason || null'), 'Doctor gateway diagnostics should fall back to the ledger restart reason after process restart')
assert(server.includes('Recent restarts:'), 'Doctor gateway diagnostics should summarize a compact restart timeline when multiple rows exist')
assert(server.includes('Restart diagnostics: ${gatewayDoctorRestartDiagnostics.summary}'), 'Doctor gateway diagnostics should include derived restart repair guidance')
assert(runtimeRoutes.includes("reason: 'manual restart requested from monitor'"), 'manual monitor restarts should pass a structured restart reason')
assert(server.includes('function isGatewayPollingIngressLifecycle'), 'gateway activity should classify polling ingress lifecycle separately')
assert(
  server.includes("if (isGatewayPollingIngressLifecycle(text)) return 'system'"),
  'polling ingress startup/shutdown logs should not count as inbound channel traffic',
)
assert(
  server.includes('if (isGatewayPollingIngressLifecycle(text)) return false'),
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
assert(runtimeHook.includes('lastRestartReason?: string | null'), 'runtime status types should include the last Gateway restart reason')
assert(runtimeHook.includes('recentRestarts?: GatewayRestartLifecycleEntry[]'), 'runtime status types should include the Gateway restart timeline')
assert(runtimeHook.includes('export type GatewayRestartDiagnostics'), 'runtime status types should include Gateway restart diagnostics')
assert(runtimeHook.includes('restartDiagnostics?: GatewayRestartDiagnostics'), 'runtime status Gateway payload should include restart diagnostics')

assert(
  packageJson.scripts?.['smoke:runtime-status-control-plane'] === 'tsx scripts/smoke-runtime-status-control-plane.ts',
  'package.json should expose smoke:runtime-status-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:runtime-status-control-plane'),
  'test:ci should run the runtime status control-plane smoke',
)

console.log('runtime status control-plane contract ok')

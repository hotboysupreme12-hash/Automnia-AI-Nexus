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
const shiftRoutes = readWorkspaceFile('server/routes/shiftRoutes.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
const schedulerPanel = readWorkspaceFile('src/components/monitor/HeartbeatSchedulerPanel.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['shift_command_failed', 'shift_operation_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const shiftRouteMarkers = [
  "app.post('/api/shifts/start'",
  "app.post('/api/shifts/start-batch'",
  "app.post('/api/shifts/stop'",
  "app.post('/api/shifts/update'",
  "app.get('/api/shifts'",
  "app.get('/api/shifts/defaults'",
  "app.post('/api/shifts/defaults'",
  "app.get('/api/shifts/defaults/:agentId'",
  "app.post('/api/shifts/defaults/:agentId'",
]

for (const marker of shiftRouteMarkers) {
  const block = routeBlock(shiftRoutes, marker)
  assert(block.includes('apiSuccess(res'), `${marker} should return canonical success envelopes`)
  assert(block.includes('apiFailure(res'), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

const batchBlock = routeBlock(shiftRoutes, "app.post('/api/shifts/start-batch'")
assert(batchBlock.includes('if (!shifts.length)'), 'start-batch should explicitly fail when no cron jobs start')
assert(batchBlock.includes("'Failed to start team workflow'"), 'start-batch should surface all-failed launch errors')
assert(!batchBlock.includes('ok: shifts.length > 0'), 'start-batch should not encode all-failed state as a successful payload')
assert(batchBlock.includes('const leadAgent = requestedLeadAgent || uniqueAgents[0]'), 'start-batch should honor an explicitly selected lead agent')
assert(batchBlock.includes("'Lead agent must be included in agentIds'"), 'start-batch should reject a lead agent outside the selected team')
assert(batchBlock.includes('const invalidAgent = uniqueAgents.find'), 'start-batch should validate every selected agent id')

assert(server.includes("import { registerShiftRoutes } from './routes/shiftRoutes'"), 'control plane should import extracted shift routes')
assert(server.includes('registerShiftRoutes(app, {'), 'control plane should register extracted shift routes')
assert(server.includes('controlCenterCronExpiryInfo'), 'control plane should parse durable Control Center cron expiry metadata')
assert(server.includes('listActiveControlCenterCronExpiryRowsFromStateDb'), 'control plane should sweep expired Control Center-owned cron jobs from SQLite')
assert(server.includes('rehydrateControlCenterShiftRuntimeStateFromCronDb'), 'control plane should rehydrate scheduled shifts from OpenClaw cron state after restart')
assert(server.includes('armShiftExpiryTimer(shift)'), 'created and recovered shifts should have app-owned expiry timers')
assert(server.includes('control-center shift=${shiftId} expiresAt=${endsAt} durationMinutes=${durationMinutes}'), 'shift cron creation should write durable ownership and expiry metadata')
assert(server.includes('failed disabling scheduled shift'), 'expired shift disable failures should remain observable for retry')
for (const marker of shiftRouteMarkers) {
  assert(!server.includes(marker), `${marker} should be owned by server/routes/shiftRoutes.ts`)
}

assert(
  runtimeHook.includes("apiRequest<{ shiftId: string; cronId: string }>('/api/shifts/stop'"),
  'stopCronShift should use apiRequest',
)
assert(
  runtimeHook.includes("apiRequest<{ shiftId: string; cronId: string; shift: RuntimeCronJob | null }>('/api/shifts/update'"),
  'updateCronShift should use apiRequest',
)
assert(
  runtimeHook.includes("apiRequest<{ shifts?: RuntimeCronJob[] }>('/api/shifts'"),
  'listCronShifts should use apiRequest',
)
assert(!runtimeHook.includes("fetchJsonWithTimeout<{ ok?: boolean; error?: string; detail?: unknown; shiftId?: string }>(apiUrl('/api/shifts/stop')"), 'stopCronShift should not use legacy fetch helper')
assert(!runtimeHook.includes("fetchJsonWithTimeout<{ ok?: boolean; error?: string; detail?: unknown; shift?: RuntimeCronJob }>(apiUrl('/api/shifts/update')"), 'updateCronShift should not use legacy fetch helper')
assert(!runtimeHook.includes("fetchJsonWithTimeout<{ shifts?: RuntimeCronJob[]; error?: string; detail?: unknown }>(apiUrl('/api/shifts')"), 'listCronShifts should not use legacy fetch helper')

assert(
  schedulerPanel.includes("import { apiErrorMessage, apiRequest, type ApiRequestOptions } from '../../api/client'"),
  'HeartbeatSchedulerPanel should import the shared API client',
)
assert(schedulerPanel.includes('async function schedulerApiData'), 'HeartbeatSchedulerPanel should centralize scheduler API handling')
assert(!/\bfetch\s*\(/.test(schedulerPanel), 'HeartbeatSchedulerPanel should not call fetch directly')
assert(!schedulerPanel.includes('body: JSON.stringify'), 'HeartbeatSchedulerPanel should pass structured JSON bodies to apiRequest')
assert(!schedulerPanel.includes("'Content-Type': 'application/json'"), 'HeartbeatSchedulerPanel should let apiRequest set JSON headers')

for (const endpoint of [
  '/api/shifts',
  '/api/shifts/start',
  '/api/shifts/start-batch',
  '/api/shifts/stop',
  '/api/shifts/defaults',
]) {
  assert(schedulerPanel.includes(endpoint), `HeartbeatSchedulerPanel is missing scheduler endpoint ${endpoint}`)
}

assert(schedulerPanel.includes('Autosave'), 'HeartbeatSchedulerPanel should surface silent defaults save failures')
assert(schedulerPanel.includes('function isControlCenterShift'), 'HeartbeatSchedulerPanel should centralize Control Center cron ownership checks')
assert(
  schedulerPanel.includes('const controlCenterShifts = shifts.filter(isControlCenterShift)'),
  'bulk Stop Cron should only consider Control Center-owned cron shifts',
)
assert(
  !schedulerPanel.includes('const targetShifts = scopedAgent ? shifts.filter((shift) => shift.agent === scopedAgent) : shifts'),
  'bulk Stop Cron should not disable every OpenClaw cron job in the active list',
)

assert(
  packageJson.scripts?.['smoke:shifts-control-plane'] === 'tsx scripts/smoke-shifts-control-plane.ts',
  'package.json should expose smoke:shifts-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:shifts-control-plane'),
  'test:ci should run the shifts control-plane smoke',
)

console.log('shifts control-plane contract ok')

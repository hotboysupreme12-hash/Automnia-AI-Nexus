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
  const next = source.indexOf('\napp.', start + marker.length)
  return source.slice(start, next >= 0 ? next : source.length)
}

const server = readWorkspaceFile('server/index.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['runtime_status_failed', 'runtime_summary_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/openclaw/runtime/status'",
  "app.get('/api/openclaw/runtime/summary'",
]) {
  const block = routeBlock(server, marker)
  assert(block.includes('apiSuccess(res'), `${marker} should return canonical success envelopes`)
  assert(block.includes('apiFailure(res'), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

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

assert(
  packageJson.scripts?.['smoke:runtime-status-control-plane'] === 'tsx scripts/smoke-runtime-status-control-plane.ts',
  'package.json should expose smoke:runtime-status-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:runtime-status-control-plane'),
  'test:ci should run the runtime status control-plane smoke',
)

console.log('runtime status control-plane contract ok')

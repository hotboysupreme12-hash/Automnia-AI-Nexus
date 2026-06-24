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

const server = readWorkspaceFile('server/index.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const diagnosticsRoutes = readWorkspaceFile('server/routes/diagnosticsRoutes.ts')
const runtimeHook = readWorkspaceFile('src/hooks/useRuntimeStatus.ts')
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
  "app.get('/api/models/available'",
]) {
  const block = routeBlock(server, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

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
]) {
  assert(runtimeHook.includes(fragment), `useRuntimeStatus is missing ${fragment}`)
}

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

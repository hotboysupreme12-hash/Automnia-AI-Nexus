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
const filesystemRoutes = readWorkspaceFile('server/routes/filesystemRoutes.ts')
const editorModal = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const nexusStore = readWorkspaceFile('src/store/nexusStore.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of [
  'filesystem_operation_failed',
  'folder_list_failed',
  'folder_picker_failed',
  'image_picker_failed',
  'resource_not_found',
]) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const canonicalRouteMarkers = [
  "app.get('/api/party/resources/:agentId'",
  "app.get('/api/party/resources/:agentId/:file'",
  "app.put('/api/party/resources/:agentId/:file'",
  "app.get('/api/party/folders'",
  "app.post('/api/party/folder-picker'",
  "app.post('/api/party/folder-picker/start'",
  "app.get('/api/party/folder-picker/:sessionId'",
  "app.post('/api/party/avatar-picker/start'",
  "app.get('/api/party/avatar-picker/:sessionId'",
]

for (const marker of canonicalRouteMarkers) {
  const block = routeBlock(filesystemRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
  assert(!server.includes(marker), `${marker} should be owned by server/routes/filesystemRoutes.ts, not server/index.ts`)
}

assert(server.includes('registerFilesystemRoutes(app, {'), 'server/index.ts should register extracted filesystem routes')
assert(server.includes('editorResourceFiles: EDITOR_RESOURCE_FILES'), 'server/index.ts should inject editor resource files')
assert(server.includes('sharedTeamFiles: SHARED_TEAM_FILES'), 'server/index.ts should inject shared team files')

const serializerStart = server.indexOf('function serializeFolderPickerSession')
const serializerEnd = server.indexOf('function serializeImagePickerSession', serializerStart)
assert(serializerStart >= 0 && serializerEnd > serializerStart, 'Missing folder picker serializer block')
const serializerBlock = server.slice(serializerStart, serializerEnd)
assert(!/\bok:\s*/.test(serializerBlock), 'Picker session data should not include a nested ok flag')
assert(serializerBlock.includes("cancelled: session.status === 'cancelled'"), 'Picker session data should make cancellation explicit')

const directPickerBlock = routeBlock(filesystemRoutes, "app.post('/api/party/folder-picker'")
assert(directPickerBlock.includes("status: 'cancelled'"), 'Immediate folder picker should model cancellation as a state')
assert(directPickerBlock.includes('cancelled: true'), 'Immediate folder picker should include cancelled=true')
assert(!directPickerBlock.includes('ok: false, path: null, cancelled: true'), 'Cancelled folder picker should not use legacy ok=false payloads')

assert(
  editorModal.includes("import { apiErrorMessage, apiRequest } from '../../api/client'"),
  'AgentEditorModal should import the shared API client',
)

for (const fragment of [
  'apiRequest<FolderListPayload>(`/api/party/folders',
  "apiRequest<FolderPickerSessionPayload>('/api/party/folder-picker/start'",
  'apiRequest<FolderPickerSessionPayload>(`/api/party/folder-picker/${encodeURIComponent(d.sessionId)}`',
  'apiRequest<AgentResourceListPayload>(`/api/party/resources/${encodeURIComponent(agentId)}`',
  'apiRequest<AgentResourceContentPayload>(`/api/party/resources/${encodeURIComponent(agentId)}/${encodeURIComponent(f)}`',
  'apiRequest<AgentResourceSavePayload>(`/api/party/resources/${encodeURIComponent(agent.id)}/${encodeURIComponent(rfile)}`',
]) {
  assert(editorModal.includes(fragment), `AgentEditorModal is missing API-client fragment ${fragment}`)
}

for (const legacyFragment of [
  'fetchWithTimeout(`/api/party/folders',
  'fetchWithTimeout(`/api/party/resources',
  "fetchWithTimeout('/api/party/folder-picker/start'",
  'fetchWithTimeout(`/api/party/folder-picker/',
]) {
  assert(!editorModal.includes(legacyFragment), `AgentEditorModal should not use legacy ${legacyFragment}`)
}

assert(
  nexusStore.includes('apiRequest<{ file?: string; resourcePath?: string }>(`/api/party/resources/${encodeURIComponent(agentId)}/${encodeURIComponent(entry.file)}`'),
  'Recruit resource bootstrap should use apiRequest',
)
assert(
  !nexusStore.includes('fetch(`/api/party/resources/${agentId}/${encodeURIComponent(entry.file)}`'),
  'Recruit resource bootstrap should not use direct fetch',
)

assert(
  packageJson.scripts?.['smoke:filesystem-control-plane'] === 'tsx scripts/smoke-filesystem-control-plane.ts',
  'package.json should expose smoke:filesystem-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:filesystem-control-plane'),
  'test:ci should run the filesystem control-plane smoke',
)

console.log('filesystem control-plane contract ok')

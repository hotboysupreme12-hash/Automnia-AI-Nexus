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
const filesystemRoutes = readWorkspaceFile('server/routes/filesystemRoutes.ts')
const avatarFileService = readWorkspaceFile('server/services/filesystem/avatarFileService.ts')
const pickerSessionService = readWorkspaceFile('server/services/filesystem/pickerSessionService.ts')
const avatarFileTests = readWorkspaceFile('tests/avatarFileService.test.ts')
const partyAvatarUploadTests = readWorkspaceFile('tests/partyAvatarUploadRoutes.test.ts')
const safePathTests = readWorkspaceFile('tests/safePathService.test.ts')
const pickerSessionTests = readWorkspaceFile('tests/pickerSessionService.test.ts')
const editorModal = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const nexusStore = readWorkspaceFile('src/store/nexusStore.ts')
const partyApi = readWorkspaceFile('src/api/party.ts')
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
assert(server.includes("from './services/filesystem/pickerSessionService'"), 'server/index.ts should import the picker session service')
assert(server.includes("from './services/filesystem/avatarFileService'"), 'server/index.ts should import the avatar file service')
assert(server.includes('createPickerSessionService({'), 'server/index.ts should compose the picker session service')
assert(server.includes('pickerSessions: pickerSessionService'), 'server/index.ts should inject picker sessions through a service option')
assert(filesystemRoutes.includes('pickerSessions: PickerSessionService'), 'filesystem routes should receive picker sessions through a service boundary')
assert(avatarFileService.includes('export const AVATAR_UPLOAD_LIMIT_BYTES'), 'avatar file service should own avatar upload size limits')
assert(avatarFileService.includes('export function assertAvatarUploadBytes'), 'avatar file service should own avatar upload byte validation')
assert(avatarFileService.includes('export function assertAvatarUploadSize'), 'avatar file service should own avatar upload stat-size validation')
assert(avatarFileService.includes('export function avatarUploadFileName'), 'avatar file service should own avatar upload file naming')
assert(avatarFileService.includes('export function isSupportedAvatarImagePath'), 'avatar file service should own avatar image extension checks')
assert(avatarFileService.includes('if (extFromName && !AVATAR_IMAGE_EXTENSIONS.has(extFromName))'), 'avatar file service should reject unsupported explicit extensions before MIME fallback')
assert(pickerSessionService.includes('isSupportedAvatarImagePath(selectedPath)'), 'picker service should enforce image type allowlist before avatar persistence')
assert(server.includes('assertAvatarUploadBytes(bytes, AVATAR_UPLOAD_LIMIT_BYTES)'), 'avatar byte persistence should use the service-owned upload size validator')
assert(server.includes('assertAvatarUploadSize(stat.size, AVATAR_UPLOAD_LIMIT_BYTES)'), 'avatar path persistence should use the service-owned upload size validator')
assert(server.includes('avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES'), 'party management routes should receive the avatar upload byte limit from composition')

const serializerStart = pickerSessionService.indexOf('function serializeFolderPickerSession')
const serializerEnd = pickerSessionService.indexOf('function serializeImagePickerSession', serializerStart)
assert(serializerStart >= 0 && serializerEnd > serializerStart, 'Missing picker service serializer block')
const serializerBlock = pickerSessionService.slice(serializerStart, serializerEnd)
assert(!/\bok:\s*/.test(serializerBlock), 'Picker session data should not include a nested ok flag')
assert(serializerBlock.includes("cancelled: session.status === 'cancelled'"), 'Picker session data should make cancellation explicit')
assert(/function\s+startFolderPickerSession/.test(pickerSessionService), 'picker service should own folder picker sessions')
assert(/function\s+startImagePickerSession/.test(pickerSessionService), 'picker service should own image picker sessions')
assert(/function\s+launchWindowsFolderPickerSession/.test(pickerSessionService), 'picker service should own Windows folder picker launchers')
assert(/function\s+launchWindowsImagePickerSession/.test(pickerSessionService), 'picker service should own Windows image picker launchers')
assert(/function\s+normalizePickerStartPath/.test(pickerSessionService), 'picker service should own picker start-path normalization')
assert(pickerSessionService.includes('isPathUnder(fallback, candidate)'), 'picker service should reject relative start-path traversal outside the fallback')
assert(!/\bfunction\s+startFolderPickerSession\b/.test(server), 'folder picker session logic must stay out of server/index.ts')
assert(!/\bfunction\s+launchWindowsFolderPickerSession\b/.test(server), 'Windows folder picker launcher logic must stay out of server/index.ts')
assert(!/\bfunction\s+pickFolderWithOsDialog\b/.test(server), 'native picker command logic must stay out of server/index.ts')
assert(safePathTests.includes('multi-segment traversal attempts across POSIX and Windows paths'), 'safePathService.test.ts should cover cross-platform traversal attempts')
assert(pickerSessionTests.includes('relative start paths under fallback and rejects traversal starts'), 'pickerSessionService.test.ts should cover traversal start paths')
assert(avatarFileTests.includes('avatar file service rejects unsupported explicit extensions before MIME fallback'), 'avatarFileService.test.ts should cover avatar allowlist rejection')
assert(avatarFileTests.includes('avatar file service enforces avatar upload byte limits for persistence helpers'), 'avatarFileService.test.ts should cover avatar upload size-limit helpers')
assert(pickerSessionTests.includes('unsupported image picker file types before avatar persistence'), 'pickerSessionService.test.ts should cover image picker allowlist rejection')
assert(partyAvatarUploadTests.includes('avatar upload route rejects unsupported file types before persistence'), 'partyAvatarUploadRoutes.test.ts should cover avatar upload allowlist rejection')
assert(partyAvatarUploadTests.includes('avatar upload route enforces byte limits before avatar persistence'), 'partyAvatarUploadRoutes.test.ts should cover avatar upload raw-body size limits')

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
  partyApi.includes('apiRequest<AgentResourceSavePayload>(`/api/party/resources/${encodeURIComponent(agentId)}/${encodeURIComponent(file)}`'),
  'Recruit resource bootstrap endpoint should use apiRequest in src/api/party.ts',
)
assert(
  nexusStore.includes('saveAgentResource(agentId, entry.file'),
  'Recruit resource bootstrap should delegate through the party API helper',
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

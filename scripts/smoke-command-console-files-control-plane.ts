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
const commandConsoleFileRoutes = readWorkspaceFile('server/routes/commandConsoleFileRoutes.ts')
const controlFilesService = readWorkspaceFile('server/services/controlFilesService.ts')
const controlFilesTests = readWorkspaceFile('tests/controlFilesService.test.ts')
const commandConsoleUploadService = readWorkspaceFile('server/services/filesystem/commandConsoleUploadService.ts')
const commandConsoleUploadTests = readWorkspaceFile('tests/commandConsoleUploadService.test.ts')
const consolePanel = readWorkspaceFile('src/components/monitor/AgentResponseConsole.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['control_file_operation_failed', 'file_upload_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

assert(
  server.includes('registerCommandConsoleFileRoutes(app, {'),
  'server index should register extracted command-console file routes',
)
assert(
  server.includes('controlFiles: controlFilesService'),
  'server index should inject the control-files service into command-console file routes',
)
assert(
  /createControlFilesService\(WORKSPACE_ROOT,\s*\{\s*isPathUnder\s*\}\)/.test(server),
  'server index should compose control-files service with safe path containment',
)
assert(
  server.includes('persistCommandConsoleUpload'),
  'server index should inject the existing upload persistence helper into command-console file routes',
)
assert(
  server.includes("from './services/filesystem/commandConsoleUploadService'"),
  'server index should import the command-console upload service',
)
assert(
  server.includes('createCommandConsoleUploadService({'),
  'server index should compose the command-console upload service',
)
assert(!server.includes("app.get('/api/files'"), 'server index should not inline the command-console files list route')
assert(!server.includes("app.post('/api/files/upload'"), 'server index should not inline the command-console upload route')
assert(!/\bfunction\s+commandConsoleUploadFileName\b/.test(server), 'server index should not own command-console upload file naming')
assert(!/\bfunction\s+normalizeCommandConsoleAttachment\b/.test(server), 'server index should not own command-console attachment normalization')
assert(controlFilesService.includes('export const CONTROL_FILES'), 'control-files service should own the allowed control-file list')
assert(controlFilesService.includes('isAllowedControlFile'), 'control-files service should own control-file validation')
assert(controlFilesService.includes('function resolveControlFilePath'), 'control-files service should own control-file path resolution')
assert(controlFilesService.includes('isPathUnder(resolvedWorkspaceRoot, targetPath)'), 'control-files service should enforce workspace containment before reads and writes')
assert(controlFilesService.includes('fs.realpath(resolvedWorkspaceRoot)'), 'control-files service should realpath-check symlinked control files')
assert(controlFilesService.includes('async readFile'), 'control-files service should own control-file reads')
assert(controlFilesService.includes('async writeFile'), 'control-files service should own control-file writes')
assert(controlFilesTests.includes('control files service reads and writes allowed control files inside the workspace root'), 'controlFilesService.test.ts should cover allowed read/write behavior')
assert(controlFilesTests.includes('rejects traversal and non-control file names'), 'controlFilesService.test.ts should cover traversal and invalid control-file names')
assert(controlFilesTests.includes('separator-mixed traversal attempts'), 'controlFilesService.test.ts should cover separator-mixed traversal attempts')
assert(controlFilesTests.includes('enforces resolved workspace containment before read and write'), 'controlFilesService.test.ts should cover containment failures')
assert(controlFilesTests.includes('rejects symlink escapes before read and write'), 'controlFilesService.test.ts should cover symlink escape rejection')
assert(commandConsoleUploadService.includes('export const COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES'), 'upload service should own the upload size limit')
assert(commandConsoleUploadService.includes('function contentTypeFromUploadName'), 'upload service should own upload content-type fallback')
assert(commandConsoleUploadService.includes('function commandConsoleUploadFileName'), 'upload service should own upload file naming')
assert(commandConsoleUploadService.includes('if (extFromName && !COMMAND_CONSOLE_UPLOAD_EXTENSIONS.has(extFromName))'), 'upload service should reject unsupported explicit extensions before MIME fallback')
assert(commandConsoleUploadService.includes('async function persistUpload'), 'upload service should own upload persistence')
assert(commandConsoleUploadService.includes('function normalizeAttachment'), 'upload service should own attachment normalization')
assert(commandConsoleUploadService.includes('async function resolveAttachmentReadPath'), 'upload service should own realpath validation before attachment reads')
assert(commandConsoleUploadService.includes('async function gatewayAttachmentsFromTurnAttachments'), 'upload service should own Gateway attachment conversion')
assert(commandConsoleUploadService.includes('isPathUnder(resolvedUploadDir, resolvedUploadPath)'), 'upload service should enforce upload-root containment before writes')
assert(commandConsoleUploadService.includes('isPathUnder(resolvedUploadDir, resolvedPath)'), 'upload service should enforce upload-root containment when normalizing attachments')
assert(commandConsoleUploadService.includes('fs.realpath(resolvedUploadDir)'), 'upload service should realpath-check attachment reads')
assert(commandConsoleUploadTests.includes('command console upload service persists sanitized supported uploads inside the upload root'), 'commandConsoleUploadService.test.ts should cover upload persistence')
assert(commandConsoleUploadTests.includes('strips traversal segments from upload source names'), 'commandConsoleUploadService.test.ts should cover traversal source names')
assert(commandConsoleUploadTests.includes('accepts supported extension and MIME fallback upload types'), 'commandConsoleUploadService.test.ts should cover supported upload allowlist paths')
assert(commandConsoleUploadTests.includes('unsupported file types and oversized uploads'), 'commandConsoleUploadService.test.ts should cover upload allowlist and size failures')
assert(commandConsoleUploadTests.includes('without allowing root escapes'), 'commandConsoleUploadService.test.ts should cover upload-root escapes')
assert(commandConsoleUploadTests.includes('containment guard rejects writes'), 'commandConsoleUploadService.test.ts should cover containment guard upload failures')
assert(commandConsoleUploadTests.includes('Gateway attachment payloads'), 'commandConsoleUploadService.test.ts should cover Gateway attachment shaping')
assert(commandConsoleUploadTests.includes('skips symlinked attachment escapes before inline Gateway reads'), 'commandConsoleUploadService.test.ts should cover symlink escape attachment reads')

for (const marker of [
  "app.get('/api/files'",
  "app.post('/api/files/upload'",
  "app.get('/api/files/:file'",
  "app.put('/api/files/:file'",
]) {
  const block = routeBlock(commandConsoleFileRoutes, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(marker === "app.get('/api/files'" || /apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

const uploadBlock = routeBlock(commandConsoleFileRoutes, "app.post('/api/files/upload'")
assert(uploadBlock.includes('persistCommandConsoleUpload(bytes, name, mimeType)'), 'Upload route should persist via the command-console upload helper')
assert(uploadBlock.includes("apiFailure(res, 400, 'file_upload_failed'"), 'Upload failures should use file_upload_failed')
assert(!uploadBlock.includes('ok: false'), 'Upload route should not return legacy ok=false payloads')

assert(
  consolePanel.includes("import { apiErrorMessage, apiRequest } from '../../api/client'"),
  'AgentResponseConsole should import the shared API client',
)
assert(
  consolePanel.includes('apiRequest<CommandConsoleUploadPayload>(`/api/files/upload?name=${encodeURIComponent(uploadFile.name)}'),
  'AgentResponseConsole upload should use apiRequest',
)
assert(consolePanel.includes('timeoutMs: 90_000'), 'AgentResponseConsole upload should use an explicit timeout')
assert(consolePanel.includes("'X-File-Type': uploadFile.type || 'application/octet-stream'"), 'AgentResponseConsole upload should preserve source MIME header')
assert(consolePanel.includes('apiErrorMessage(result.error)'), 'AgentResponseConsole upload errors should use canonical API messages')
assert(!consolePanel.includes('const res = await fetch(`/api/files/upload'), 'AgentResponseConsole should not use direct fetch for uploads')
assert(!consolePanel.includes('await res.json().catch'), 'AgentResponseConsole should not hand-parse upload JSON')

assert(
  packageJson.scripts?.['smoke:command-console-files'] === 'tsx scripts/smoke-command-console-files-control-plane.ts',
  'package.json should expose smoke:command-console-files',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:command-console-files'),
  'test:ci should run the command-console files smoke',
)

console.log('command-console files control-plane contract ok')

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
const consolePanel = readWorkspaceFile('src/components/monitor/AgentResponseConsole.tsx')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['control_file_operation_failed', 'file_upload_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

for (const marker of [
  "app.get('/api/files'",
  "app.post('/api/files/upload'",
  "app.get('/api/files/:file'",
  "app.put('/api/files/:file'",
]) {
  const block = routeBlock(server, marker)
  assert(/apiSuccess\s*\(\s*res/.test(block), `${marker} should return canonical success envelopes`)
  assert(marker === "app.get('/api/files'" || /apiFailure\s*\(\s*res/.test(block), `${marker} should return canonical error envelopes`)
  assert(!/\breturn\s+res\.json\s*\(/.test(block), `${marker} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(block), `${marker} should not return raw status JSON errors`)
}

const uploadBlock = routeBlock(server, "app.post('/api/files/upload'")
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

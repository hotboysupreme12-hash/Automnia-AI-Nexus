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
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

assert(server.includes("| 'team_sync_failed'"), 'ApiErrorCode is missing team_sync_failed')

const teamSyncBlock = routeBlock(server, "app.post('/api/team-sync/append'")

assert(teamSyncBlock.includes('apiSuccess(res'), 'team-sync append should return canonical success envelopes')
assert(teamSyncBlock.includes('apiFailure(res'), 'team-sync append should return canonical error envelopes')
assert(!/\breturn\s+res\.json\s*\(/.test(teamSyncBlock), 'team-sync append should not return raw res.json payloads')
assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(teamSyncBlock), 'team-sync append should not return raw status JSON errors')

assert(teamSyncBlock.includes("'invalid_payload'"), 'team-sync append should type malformed payload errors')
assert(teamSyncBlock.includes("'team_sync_failed'"), 'team-sync append should type TEAM_SYNC policy and write failures')
assert(teamSyncBlock.includes('isValidAgentId(agentId)'), 'team-sync append should validate agent ids before path work')
assert(teamSyncBlock.includes('isPathUnder(executionWorkspace, targetPath)'), 'team-sync append should enforce path containment')
assert(teamSyncBlock.includes("path.basename(targetPath).toLowerCase() !== 'team_sync.md'"), 'team-sync append should only allow TEAM_SYNC.md targets')
assert(teamSyncBlock.includes('CANONICAL_DOCTRINE_ONLY'), 'team-sync append should respect canonical doctrine-only mode')
assert(teamSyncBlock.includes('splitTextForAppend'), 'team-sync append should preserve bounded append chunking')
assert(teamSyncBlock.includes('ok: true'), 'team-sync append should preserve compatibility ok in canonical data')
assert(teamSyncBlock.includes('line: appendLines[0]'), 'team-sync append should preserve first-line evidence')
assert(teamSyncBlock.includes('lines: appendLines'), 'team-sync append should preserve split-line evidence')

assert(
  packageJson.scripts?.['smoke:team-sync-control-plane'] === 'tsx scripts/smoke-team-sync-control-plane.ts',
  'package.json should expose smoke:team-sync-control-plane',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:team-sync-control-plane'),
  'test:ci should run the Team Sync control-plane smoke',
)

console.log('team-sync control-plane contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const server = read('server/index.ts')
const skillsPanel = read('src/components/monitor/SkillsPanel.tsx')
const editor = read('src/components/editor/AgentEditorModal.tsx')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

const skillsRouteStart = server.indexOf("app.get('/api/skills/check'")
const skillsRouteEnd = server.indexOf("app.get('/api/party/agent/:agentId/config'", skillsRouteStart)
assert.notEqual(skillsRouteStart, -1, 'skills route block must exist')
assert.notEqual(skillsRouteEnd, -1, 'skills route block must end before agent config routes')
const skillsRoutes = server.slice(skillsRouteStart, skillsRouteEnd)

for (const route of [
  "app.get('/api/skills/check'",
  "app.get('/api/skills/list'",
  "app.get('/api/skills/info/:skillName'",
  "app.get('/api/skills/library'",
  "app.get('/api/skills/library/:skillId'",
  "app.post('/api/skills/learn'",
  "app.get('/api/skills/clawhub/search'",
  "app.post('/api/skills/clawhub/install'",
  "app.post('/api/skills/clawhub/update'",
]) {
  assert.ok(skillsRoutes.includes(route), `skills control plane must expose ${route}`)
}

assert.match(server, /'skill_command_failed'/, 'server API error codes must include skill command failures')
assert.match(server, /'skill_operation_failed'/, 'server API error codes must include skill operation failures')
assert.match(server, /'skill_not_found'/, 'server API error codes must include missing skill failures')
assert.match(skillsRoutes, /apiSuccess\(res/, 'skills routes must use canonical success envelopes')
assert.match(skillsRoutes, /apiFailure\(res/, 'skills routes must use canonical error envelopes')
assert.doesNotMatch(skillsRoutes, /res\.json\(\{\s*ok:/, 'skills routes must not return legacy ok payloads directly')
assert.doesNotMatch(skillsRoutes, /res\.status\([^)]*\)\.json\(\{\s*ok:/, 'skills route failures must not return legacy ok:false payloads')
assert.match(skillsRoutes, /apiFailure\([\s\S]*?502,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub search failed'/, 'ClawHub search command failures must be typed')
assert.match(skillsRoutes, /apiFailure\([\s\S]*?500,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub skill install failed'/, 'ClawHub install command failures must be typed')
assert.match(skillsRoutes, /apiFailure\([\s\S]*?500,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub skill update failed'/, 'ClawHub update command failures must be typed')

const avatarUploadStart = server.indexOf("app.post('/api/party/avatar-upload/:agentId'")
const avatarUploadEnd = server.indexOf('registerFilesystemRoutes(app, {', avatarUploadStart)
assert.notEqual(avatarUploadStart, -1, 'avatar upload route must exist')
assert.notEqual(avatarUploadEnd, -1, 'avatar upload route block must end before extracted filesystem routes')
const avatarUploadRoute = server.slice(avatarUploadStart, avatarUploadEnd)
assert.match(avatarUploadRoute, /apiSuccess\(res/, 'avatar uploads must use canonical success envelopes')
assert.match(avatarUploadRoute, /apiFailure\([\s\S]*?400,[\s\S]*?'avatar_upload_failed'/, 'avatar upload failures must use canonical typed errors')

assert.match(skillsPanel, /apiRequest/, 'SkillsPanel must use the canonical API client')
assert.match(skillsPanel, /apiErrorMessage/, 'SkillsPanel must surface canonical API errors')
assert.doesNotMatch(skillsPanel, /fetch\(/, 'SkillsPanel must not bypass the canonical API client')
assert.doesNotMatch(skillsPanel, /apiUrl/, 'SkillsPanel must not hand-roll API base URL resolution')
assert.match(skillsPanel, /apiRequest<ClawHubSearchPayload>\(`\/api\/skills\/clawhub\/search/, 'SkillsPanel ClawHub search must use apiRequest')
assert.match(skillsPanel, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/install'/, 'SkillsPanel ClawHub install must use apiRequest')
assert.match(skillsPanel, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/update'/, 'SkillsPanel ClawHub update must use apiRequest')
assert.match(skillsPanel, /apiRequest<\{ skill\?: AgentSkillEntry \}>\('\/api\/skills\/learn'/, 'SkillsPanel learned-skill saves must use apiRequest')

const editorAvatarStart = editor.indexOf('const UploadPortraitFile')
const editorAvatarEnd = editor.indexOf('const PickPortrait', editorAvatarStart)
assert.notEqual(editorAvatarStart, -1, 'agent editor avatar upload block must exist')
assert.notEqual(editorAvatarEnd, -1, 'agent editor avatar upload block must end before picker action')
const editorAvatarBlock = editor.slice(editorAvatarStart, editorAvatarEnd)
assert.match(editorAvatarBlock, /apiRequest<AvatarPickerPayload>\(`\/api\/party\/avatar-upload/, 'agent editor avatar upload must use apiRequest')
assert.doesNotMatch(editorAvatarBlock, /fetchWithTimeout|fetch\(/, 'agent editor avatar upload must not bypass the canonical API client')

const editorSkillsStart = editor.indexOf('const LdSharedSkills')
const editorSkillsEnd = editor.indexOf('const ToggleInstalledSkill', editorSkillsStart)
assert.notEqual(editorSkillsStart, -1, 'agent editor skills block must exist')
assert.notEqual(editorSkillsEnd, -1, 'agent editor skills block must end before toggle action')
const editorSkillsBlock = editor.slice(editorSkillsStart, editorSkillsEnd)
assert.match(editorSkillsBlock, /apiRequest<\{shared\?:AgentSkillEntry\[\]; agent\?:AgentSkillEntry\[\]\}>/, 'agent editor skill library load must use apiRequest')
assert.match(editorSkillsBlock, /apiRequest<ClawHubSearchPayload>\(`\/api\/skills\/clawhub\/search/, 'agent editor ClawHub search must use apiRequest')
assert.match(editorSkillsBlock, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/install'/, 'agent editor ClawHub install must use apiRequest')
assert.match(editorSkillsBlock, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/update'/, 'agent editor ClawHub update must use apiRequest')
assert.doesNotMatch(editorSkillsBlock, /fetchWithTimeout|fetch\(|apiUrl\(/, 'agent editor skill install/update paths must not bypass the canonical API client')

assert.match(packageJson.scripts?.['smoke:skills-control-plane'] || '', /smoke-skills-control-plane\.ts/, 'package must expose skills control-plane smoke')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:skills-control-plane/, 'test:ci must include skills control-plane smoke')

console.log('skills control-plane contract ok')

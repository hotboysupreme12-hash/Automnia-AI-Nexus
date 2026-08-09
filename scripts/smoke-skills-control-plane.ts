import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const server = read('server/controlPlane.ts')
const skillRoutesModule = read('server/routes/skillRoutes.ts')
const partyManagementRoutes = read('server/routes/partyManagementRoutes.ts')
const skillsPanel = read('src/components/monitor/SkillsPanel.tsx')
const editor = read('src/components/editor/AgentEditorModal.tsx')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(server, /import \{ registerSkillRoutes \} from '\.\/routes\/skillRoutes'/, 'server index must import the extracted skills route module')
assert.match(server, /registerSkillRoutes\(app, \{/, 'server index must register extracted skills routes')
assert.ok(
  server.indexOf('registerSkillRoutes(app, {') < server.indexOf('registerAgentConfigRoutes(app, agentConfigRoutesContext)'),
  'skills routes must remain registered before agent config routes',
)
assert.doesNotMatch(server, /app\.get\('\/api\/skills\/check'/, 'server index must not inline skills check route')
assert.doesNotMatch(server, /app\.get\('\/api\/skills\/list'/, 'server index must not inline skills list route')
assert.doesNotMatch(server, /app\.get\('\/api\/skills\/clawhub\/search'/, 'server index must not inline ClawHub search route')
assert.doesNotMatch(server, /app\.post\('\/api\/skills\/clawhub\/install'/, 'server index must not inline ClawHub install route')
assert.doesNotMatch(server, /app\.post\('\/api\/skills\/clawhub\/update'/, 'server index must not inline ClawHub update route')
assert.match(skillRoutesModule, /type SkillRoutesOptions = \{/, 'skills route module must own an explicit dependency-injection surface')

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
  assert.ok(skillRoutesModule.includes(route), `skills control plane must expose ${route}`)
}

assert.match(skillRoutesModule, /'skill_command_failed'/, 'skills routes must include skill command failures')
assert.match(skillRoutesModule, /'skill_operation_failed'/, 'skills routes must include skill operation failures')
assert.match(skillRoutesModule, /'skill_not_found'/, 'skills routes must include missing skill failures')
assert.match(skillRoutesModule, /apiSuccess\(res/, 'skills routes must use canonical success envelopes')
assert.match(skillRoutesModule, /apiFailure\(res/, 'skills routes must use canonical error envelopes')
assert.doesNotMatch(skillRoutesModule, /res\.json\(\{\s*ok:/, 'skills routes must not return legacy ok payloads directly')
assert.doesNotMatch(skillRoutesModule, /res\.status\([^)]*\)\.json\(\{\s*ok:/, 'skills route failures must not return legacy ok:false payloads')
assert.match(skillRoutesModule, /apiFailure\([\s\S]*?502,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub search failed'/, 'ClawHub search command failures must be typed')
assert.match(skillRoutesModule, /apiFailure\([\s\S]*?500,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub skill install failed'/, 'ClawHub install command failures must be typed')
assert.match(skillRoutesModule, /apiFailure\([\s\S]*?500,[\s\S]*?'skill_command_failed',[\s\S]*?'ClawHub skill update failed'/, 'ClawHub update command failures must be typed')
assert.match(skillRoutesModule, /CLAWHUB_SKILL_REFERENCE_PATTERN/, 'ClawHub routes must validate publisher-qualified skill references')
assert.match(skillRoutesModule, /reference\.includes\('\/'\) && !reference\.startsWith\('@'\) \? `@\$\{reference\}` : reference/, 'ClawHub routes must normalize owner-qualified references to the @owner/skill CLI form')
assert.match(skillRoutesModule, /\['skills', 'install', skillRef, '--global'\]/, 'ClawHub installs must target the shared managed skills directory')
assert.match(skillRoutesModule, /\['skills', 'update', '--all', '--global'\]/, 'bulk ClawHub updates must target shared managed skills')
assert.match(skillRoutesModule, /\['skills', 'update', skillRef, '--global'\]/, 'ClawHub updates must preserve the publisher-qualified skill reference')

const avatarUploadStart = partyManagementRoutes.indexOf("app.post('/api/party/avatar-upload/:agentId'")
const avatarUploadEnd = partyManagementRoutes.indexOf('\n}', avatarUploadStart)
assert.notEqual(avatarUploadStart, -1, 'avatar upload route must exist')
assert.notEqual(avatarUploadEnd, -1, 'avatar upload route block must have a module boundary')
const avatarUploadRoute = partyManagementRoutes.slice(avatarUploadStart, avatarUploadEnd)
assert.match(avatarUploadRoute, /apiSuccess\(res/, 'avatar uploads must use canonical success envelopes')
assert.match(avatarUploadRoute, /apiFailure\([\s\S]*?400,[\s\S]*?'avatar_upload_failed'/, 'avatar upload failures must use canonical typed errors')

assert.match(skillsPanel, /apiRequest/, 'SkillsPanel must use the canonical API client')
assert.match(skillsPanel, /apiErrorMessage/, 'SkillsPanel must surface canonical API errors')
assert.doesNotMatch(skillsPanel, /fetch\(/, 'SkillsPanel must not bypass the canonical API client')
assert.doesNotMatch(skillsPanel, /apiUrl/, 'SkillsPanel must not hand-roll API base URL resolution')
assert.match(skillsPanel, /apiRequest<ClawHubSearchPayload>\(`\/api\/skills\/clawhub\/search/, 'SkillsPanel ClawHub search must use apiRequest')
assert.match(skillsPanel, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/install'/, 'SkillsPanel ClawHub install must use apiRequest')
assert.match(skillsPanel, /apiRequest<ClawHubInstallPayload>\('\/api\/skills\/clawhub\/update'/, 'SkillsPanel ClawHub update must use apiRequest')
assert.match(skillsPanel, /body: \{ skillRef \}/, 'SkillsPanel must send the publisher-qualified ClawHub reference')
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
assert.match(editorSkillsBlock, /body:\{skillRef\}/, 'agent editor must send the publisher-qualified ClawHub reference')
assert.doesNotMatch(editorSkillsBlock, /fetchWithTimeout|fetch\(|apiUrl\(/, 'agent editor skill install/update paths must not bypass the canonical API client')

assert.match(packageJson.scripts?.['smoke:skills-control-plane'] || '', /smoke-skills-control-plane\.ts/, 'package must expose skills control-plane smoke')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:skills-control-plane/, 'test:ci must include skills control-plane smoke')

console.log('skills control-plane contract ok')

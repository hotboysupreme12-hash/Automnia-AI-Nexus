import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const workflowPath = path.join(root, '.github', 'workflows', 'control-plane-ci.yml')
const publicReleasePath = path.join(root, '.github', 'workflows', 'public-release.yml')
const qualityPath = path.join(root, '.github', 'workflows', 'quality-matrix.yml')
const auditPath = path.join(root, '.github', 'workflows', 'dependency-audit.yml')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const scripts = packageJson.scripts || {}
const testCiScript = scripts['test:ci'] || ''

for (const filePath of [workflowPath, publicReleasePath, qualityPath, auditPath]) {
  assert.ok(existsSync(filePath), `required CI workflow must exist: ${path.relative(root, filePath)}`)
}
assert.equal(existsSync(path.join(root, '.github', 'workflows', 'source-snapshot.yml')), false, 'temporary source snapshot workflow must be removed')
assert.equal(existsSync(path.join(root, '.github', 'workflows', 'apply-production-readiness-delta.yml')), false, 'one-shot encoded delta workflow must be removed')
assert.equal(existsSync(path.join(root, 'scripts', 'apply-production-readiness-delta.py')), false, 'one-shot delta applicator must be removed')

const workflow = read('.github/workflows/control-plane-ci.yml')
const publicRelease = read('.github/workflows/public-release.yml')
const quality = read('.github/workflows/quality-matrix.yml')
const dependencyAudit = read('.github/workflows/dependency-audit.yml')
const secretScanner = read('scripts/secret-scan.cjs')
const packageDesktop = read('scripts/package-desktop.cjs')
const electronE2eSmoke = read('scripts/smoke-electron-e2e.ts')

const assertPinnedActions = (source: string, label: string) => {
  const actions = [...source.matchAll(/uses:\s*([^\s]+\/[^\s]+)@([^\s]+)/g)]
  assert.ok(actions.length > 0, `${label} must use reusable GitHub Actions`)
  for (const action of actions) {
    assert.match(action[2], /^[a-f0-9]{40}$/, `${label} action ${action[1]} must be pinned to an immutable commit SHA`)
  }
}
assertPinnedActions(workflow, 'control-plane CI')
assertPinnedActions(publicRelease, 'public-release CI')
assertPinnedActions(quality, 'cross-platform CI')
assertPinnedActions(dependencyAudit, 'dependency audit CI')

assert.match(workflow, /name:\s*Control Plane CI/, 'workflow must keep a stable branch-protection check name')
assert.match(workflow, /runs-on:\s*windows-latest/, 'control-plane CI must exercise Windows desktop packaging')
for (const command of [
  'npm ci',
  'npm run prepare:openclaw-vendor',
  'npm run audit:dependencies',
  'npm run secret:scan',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test:unit:coverage',
  'npm run build:server',
  'npm run build:client',
  'npm run check:bundle-budgets',
  'npm run smoke:electron-e2e',
  'npm run prepare:runtime-bundles',
  'node scripts/package-desktop.cjs --dir',
  'npm run smoke:packaged-electron-launch',
  'npm run release:evidence',
  'npm run release:validate',
]) {
  assert.ok(workflow.includes(command), `control-plane CI must run ${command}`)
}
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/, 'control-plane CI must use read-only repository permissions')
assert.match(workflow, /if-no-files-found:\s*error/, 'control-plane CI must fail when evidence artifacts are missing')

const order = [
  'npm ci',
  'npm run prepare:openclaw-vendor',
  'npm run audit:dependencies',
  'npm run secret:scan',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test:unit:coverage',
  'npm run build:server',
  'npm run build:client',
  'npm run smoke:electron-e2e',
  'npm run prepare:runtime-bundles',
  'node scripts/package-desktop.cjs --dir',
  'npm run smoke:packaged-electron-launch',
  'npm run release:evidence',
  'npm run release:validate',
]
let previous = -1
for (const command of order) {
  const index = workflow.indexOf(command)
  assert.ok(index > previous, `${command} must remain in production-safe workflow order`)
  previous = index
}

assert.match(publicRelease, /tags:\s*\n\s*- 'v\*'/, 'version tags must trigger the dedicated public release workflow')
assert.match(publicRelease, /DYSTOPAI_RELEASE_REQUIRE_SIGNING:\s*'1'/, 'public releases must fail closed without release signing')
assert.match(publicRelease, /DYSTOPAI_UPDATE_REQUIRE_SIGNING:\s*'1'/, 'public releases must fail closed without update signing')
for (const secret of [
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM',
  'DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_PEM',
  'MAC_CSC_LINK',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
]) {
  assert.ok(publicRelease.includes(secret), `public release workflow must require ${secret}`)
}
for (const command of [
  'npm run dist:win',
  'npm run release:update-manifest',
  'npm run release:update-verify',
  'npm run release:lifecycle:windows',
  'npm run release:evidence',
  'npm run release:sign',
  'npm run release:validate',
  'npm run dist:mac',
  'xcrun stapler validate',
  'npm run dist:linux',
]) {
  assert.ok(publicRelease.includes(command), `public release workflow must run ${command}`)
}
assert.match(publicRelease, /fresh|lifecycle/i, 'public release workflow must retain installer lifecycle evidence')
assert.match(publicRelease, /retention-days:\s*90/, 'public release evidence must be retained for review')

assert.match(quality, /ubuntu-latest/, 'cross-platform quality must cover Linux')
assert.match(quality, /macos-latest/, 'cross-platform quality must cover macOS')
assert.match(quality, /npm run test:unit:coverage/, 'cross-platform quality must enforce behavioral unit coverage')
assert.match(dependencyAudit, /npm audit --json > full-dependency-audit\.json/, 'scheduled audit must capture development and build dependency findings')
assert.match(dependencyAudit, /npm run audit:dependencies/, 'scheduled audit must still fail on production dependency policy')

assert.match(scripts['smoke:ci-workflow'] || '', /tsx scripts\/smoke-ci-workflow\.ts/)
assert.match(scripts['audit:dependencies'] || '', /npm audit --omit=dev --audit-level=high/)
assert.match(scripts['smoke:dependency-audit-clean'] || '', /tsx scripts\/smoke-dependency-audit-clean\.ts/)
assert.match(scripts['smoke:private-beta-handoff'] || '', /tsx scripts\/smoke-private-beta-review-handoff\.ts/)
assert.match(scripts['secret:scan'] || '', /node scripts\/secret-scan\.cjs/)
assert.match(scripts['release:validate'] || '', /node scripts\/validate-release-artifacts\.cjs/)
assert.match(scripts['release:update-manifest'] || '', /generate-update-manifest\.cjs/)
assert.match(scripts['release:lifecycle:windows'] || '', /windows-release-lifecycle\.ps1/)
assert.match(testCiScript, /npm run lint && npm run typecheck && npm run test:unit/, 'test:ci must run behavioral units after semantic checks')
assert.match(testCiScript, /npm run smoke:runtime-recovery-soak/, 'test:ci must exercise durable restart recovery')
assert.match(testCiScript, /npm run smoke:release-lifecycle/, 'test:ci must preserve release and recovery contracts')
assert.match(testCiScript, /npm run smoke:ci-workflow/, 'test:ci must finish with CI workflow contract checks')

assert.match(electronE2eSmoke, /renderer-journey/, 'Electron E2E must exercise rendered primary navigation')
assert.match(packageDesktop, /prepare-openclaw-vendor\.cjs/, 'desktop packaging must prepare vendored OpenClaw dependencies when invoked directly')
assert.match(secretScanner, /private-key/, 'secret scan must detect private key material')
assert.match(secretScanner, /github-token/, 'secret scan must detect GitHub tokens')
assert.match(secretScanner, /allowlist\\s\+secret/, 'secret scan must support explicit allowlist markers')

console.log('ci workflow contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const electronMain = read('electron/main.cjs')
const screenshotCapture = read('scripts/capture-packaged-beta-screenshots.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const releaseGovernance = read('docs/RELEASE_GOVERNANCE.md')

const requiredSurfaces = [
  ['agents', 'Agents'],
  ['missions', 'Missions'],
  ['monitor', 'Monitor'],
  ['plugins', 'Plugins'],
  ['settings', 'Settings'],
  ['agent-editor', 'Agent Editor'],
] as const
const requiredViewports = ['desktop', 'compact', 'mobile'] as const
const expectedScreenshotCount = requiredSurfaces.length * requiredViewports.length

for (const [id, label] of requiredSurfaces) {
  assert.match(electronMain, new RegExp(`id: '${id}'[\\s\\S]*label: '${label}'`), `${label} must be included in packaged screenshot capture`)
}
for (const viewport of requiredViewports) {
  assert.match(electronMain, new RegExp(`label: '${viewport}'`), `${viewport} viewport must be included in packaged screenshot capture`)
}

assert.match(electronMain, /data-dui-modal="agent-editor"/, 'packaged screenshot capture must open the Agent Editor modal')
assert.match(electronMain, /data-editor-panel="profile"/, 'Agent Editor screenshot must wait for editor content, not just the overlay')
assert.match(electronMain, /navId = workspaceMode === 'agent-editor' \? 'agents'/, 'packaged screenshot capture must route Agent Editor through the Agents workspace')
assert.match(electronMain, /'#nexus-nav-' \+ navId/, 'packaged screenshot capture must navigate through stable shell nav ids')
assert.match(electronMain, /bodyTextLength > 120/, 'packaged screenshots must prove visible page text rendered')
assert.match(electronMain, /focusRing/, 'packaged screenshots must prove focus tokens resolved')
assert.match(electronMain, /ariaCurrent === 'page'/, 'packaged screenshots must prove navigation state')
assert.match(electronMain, new RegExp(`screenshots-ok:\\$\\{captured\\.length\\}`), 'Electron E2E must log the captured screenshot count')

assert.match(screenshotCapture, new RegExp(`screenshots-ok:${expectedScreenshotCount}`), 'packaged capture script must require all core screenshots')
assert.match(screenshotCapture, new RegExp(`expected ${expectedScreenshotCount} packaged beta screenshots`), 'packaged capture script must validate screenshot file count')
assert.match(screenshotCapture, /manifest\.json/, 'packaged capture script must write a screenshot manifest')
assert.match(screenshotCapture, /mode: 'packaged-production-dir'/, 'screenshot manifest must identify packaged production mode')
assert.match(screenshotCapture, /packaged screenshot capture requires/, 'packaged capture must fail closed when packaging output is missing')
assert.match(screenshotCapture, /createRuntimeLedgerStore/, 'packaged screenshot capture must seed its disposable renderer entitlement')
assert.match(screenshotCapture, /license:activation/, 'packaged screenshot capture must seed an active license state')

assert.match(releaseGovernance, /Packaged screenshots are optional/, 'release governance must document the optional packaged screenshot baseline')
assert.match(releaseGovernance, /Agents, Missions, Monitor, Plugins, Settings, and Agent Editor/, 'release governance must define the core packaged screenshot surface set')

assert.equal(packageJson.scripts?.['smoke:packaged-beta-screenshots-contract'], 'tsx scripts/smoke-packaged-beta-screenshots-contract.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:packaged-beta-screenshots-contract'), 'npm test must keep packaged screenshot coverage in the local gate')

console.log(`packaged beta screenshot contract ok (${requiredSurfaces.length} surfaces, ${requiredViewports.length} viewports, ${expectedScreenshotCount} screenshots)`)

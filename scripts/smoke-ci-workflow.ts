import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const workflowPath = path.join(root, '.github', 'workflows', 'control-plane-ci.yml')
const publicReleasePath = path.join(root, '.github', 'workflows', 'public-release.yml')
const qualityPath = path.join(root, '.github', 'workflows', 'quality-matrix.yml')
const auditPath = path.join(root, '.github', 'workflows', 'dependency-audit.yml')
const packageJson = JSON.parse(read('package.json')) as {
  name?: string
  scripts?: Record<string, string>
  build?: { linux?: { executableName?: string } }
}
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
const updatePromotion = read('.github/workflows/promote-desktop-update.yml')
const quality = read('.github/workflows/quality-matrix.yml')
const dependencyAudit = read('.github/workflows/dependency-audit.yml')
const releaseGovernance = read('docs/RELEASE_GOVERNANCE.md')
const secretScanner = read('scripts/secret-scan.cjs')
const packageDesktop = read('scripts/package-desktop.cjs')
const packagedElectronLaunchSmoke = read('scripts/smoke-packaged-electron-launch.ts')
const packagedOpenClawGatewaySmoke = read('scripts/smoke-packaged-openclaw-gateway.ts')
const electronE2eSmoke = read('scripts/smoke-electron-e2e.ts')
const controlPlaneSource = read('server/controlPlane.ts')

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
assert.match(workflow, /release\/evidence\/ci-logs\/npm-test\.log/, 'control-plane CI must preserve full npm test logs')
assert.match(workflow, /release\/evidence\/ci-logs\/unit-coverage\.log/, 'control-plane CI must preserve coverage logs')
assert.match(workflow, /release\/evidence\/bundle-budgets\/renderer-bundle-budgets\.log/, 'control-plane CI must preserve bundle budget output')
assert.match(workflow, /release\/evidence\/ci-logs\/packaged-electron-launch\.log/, 'control-plane CI must preserve packaged launch smoke logs')
assert.match(workflow, /name:\s*automnia-release-evidence[\s\S]*path:\s*release\/evidence\/\*\*/m, 'control-plane CI must upload release evidence artifacts')

const order = [
  'npm ci',
  'npm run prepare:openclaw-vendor',
  'npm run prepare:runtime-bundles',
  'npm run audit:dependencies',
  'npm run secret:scan',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test:unit:coverage',
  'npm run build:server',
  'npm run build:client',
  'npm run smoke:electron-e2e',
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
assert.match(publicRelease, /workflow_dispatch:/, 'public release workflow must support a build-only manual verification run')
assert.match(publicRelease, /publish-updates:[\s\S]*?if:\s*\$\{\{\s*github\.event_name\s*==\s*'push'\s*\}\}/, 'manual installer verification must never publish production aliases')
assert.match(publicRelease, /AUTOMNIA_RELEASE_REQUIRE_SIGNING:\s*'0'/, 'early public releases must allow unsigned platform artifacts')
assert.match(publicRelease, /AUTOMNIA_UPDATE_REQUIRE_SIGNING:\s*'1'/, 'public releases must fail closed without update signing')
assert.match(publicRelease, /AUTOMNIA_UPDATE_REQUIRE_EMBEDDED_CONFIG:\s*'1'/, 'public release builds must verify the embedded updater trust configuration')
assert.match(publicRelease, /AUTOMNIA_SKIP_PLATFORM_SIGNING:\s*'1'/, 'early public releases must explicitly select unsigned platform packaging')
assert.ok(publicRelease.includes('AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM'), 'public release workflow must require the update signing secret')
assert.match(publicRelease, /macos:\s*\n\s*name: Unsigned macOS DMG and ZIP\s*\n\s*runs-on: macos-15-intel/, 'Intel macOS release dependencies must be installed on a native Intel runner')
assert.ok(publicRelease.includes('npm run dist:mac -- --x64'), 'public release must build an Intel macOS artifact')
assert.ok(publicRelease.includes('npm run dist:mac -- --arm64'), 'public release must build an Apple silicon macOS artifact')
assert.match(publicRelease, /Build unsigned Intel Mac DMG and ZIP[\s\S]*?AUTOMNIA_TARGET_ARCH:\s*x64/, 'Intel macOS packaging must prepare an Intel Node runtime even on Apple silicon runners')
assert.match(publicRelease, /macos-arm64:\s*\n\s*name: Unsigned Apple silicon macOS DMG and ZIP\s*\n\s*runs-on: macos-15[\s\S]*?npm run dist:mac -- --arm64/, 'Apple silicon packaging must run on the GitHub ARM macOS runner')
assert.match(publicRelease, /AUTOMNIA_UPDATE_CHANNEL:\s*stable-x64/, 'x64 update artifacts must use the isolated signed update channel')
assert.match(publicRelease, /node scripts\/publish-update-channel\.cjs release/, 'x64 releases must use the dual-bucket channel publisher')
assert.match(publicRelease, /AUTOMNIA_LEGACY_UPDATE_BUCKET/, 'the release publisher must require the legacy bucket')
assert.match(publicRelease, /AUTOMNIA_UPDATE_TRUSTED_KEY_SHA256/, 'the release publisher must pin the installed update key')
assert.match(publicRelease, /node scripts\/publish-update-channel\.cjs preflight/, 'both update buckets must be checked before publication')
assert.ok(publicRelease.indexOf('node scripts/publish-update-channel.cjs preflight') < publicRelease.indexOf('Publish customer installers'), 'both update buckets must be checked before publishing download aliases')
assert.match(updatePromotion, /AUTOMNIA_UPDATE_CHANNEL:\s*\$\{\{\s*inputs\.channel\s*\}\}/, 'rollout promotion must select the signed release channel')
assert.match(updatePromotion, /node scripts\/publish-update-channel\.cjs verify/, 'rollout promotion must verify the original signed release')
assert.match(updatePromotion, /node scripts\/publish-update-channel\.cjs promote/, 'rollout promotion must update both buckets')
assert.match(publicRelease, /AUTOMNIA_INSTALLER_BUCKET/, 'public release must publish customer installers to the configured private bucket')
assert.match(publicRelease, /AUTOMNIA_WINDOWS_INSTALLER=%s\\nAUTOMNIA_MAC_X64=%s\\nAUTOMNIA_MAC_ARM64=%s\\nAUTOMNIA_LINUX_APPIMAGE=%s\\nAUTOMNIA_LINUX_DEB=%s\\n[\s\S]*>> "\$GITHUB_ENV"/, 'all installer paths must persist between the private and public publication steps')
assert.match(publicRelease, /"\$AUTOMNIA_WINDOWS_INSTALLER" "gs:\/\/\$PUBLIC_DOWNLOAD_BUCKET\/releases\/current\/Automnia-Setup-x64\.exe"/, 'public download aliases must use the persisted Windows installer path')
assert.match(publicRelease, /"\$AUTOMNIA_MAC_X64" "gs:\/\/\$PUBLIC_DOWNLOAD_BUCKET\/releases\/current\/Automnia-AI-Nexus-x64\.dmg"/, 'public download aliases must use the persisted Intel macOS installer path')
assert.match(publicRelease, /"\$AUTOMNIA_MAC_ARM64" "gs:\/\/\$PUBLIC_DOWNLOAD_BUCKET\/releases\/current\/Automnia-AI-Nexus-arm64\.dmg"/, 'public download aliases must use the persisted Apple silicon installer path')
assert.match(publicRelease, /"\$AUTOMNIA_LINUX_APPIMAGE" "gs:\/\/\$PUBLIC_DOWNLOAD_BUCKET\/releases\/current\/Automnia-AI-Nexus-x86_64\.AppImage"/, 'public download aliases must use the persisted Linux installer path')
assert.match(publicRelease, /"\$AUTOMNIA_LINUX_DEB" "gs:\/\/\$PUBLIC_DOWNLOAD_BUCKET\/releases\/current\/Automnia-AI-Nexus-x86_64\.deb"/, 'public download aliases must use the persisted Debian package path')
assert.match(publicRelease, /Automnia-AI-Nexus-x64\.dmg/, 'public release must publish the Intel DMG under the portal object name')
assert.match(publicRelease, /Automnia-AI-Nexus-arm64\.dmg/, 'public release must publish the Apple silicon DMG under the portal object name')
assert.match(publicRelease, /Automnia-Setup-x64\.exe/, 'public release must publish the Windows installer under the portal object name')
assert.match(publicRelease, /Automnia-AI-Nexus-x86_64\.deb/, 'public release must publish the current Debian package under the portal object name')
assert.ok(publicRelease.includes('AUTOMNIA_PACKAGED_MAC_APP_PATH'), 'public release must launch the app copied from each mounted Mac DMG')
assert.ok(publicRelease.includes('lipo -archs'), 'public release must verify the native architecture inside both Mac DMGs')
assert.ok(publicRelease.includes('dpkg-deb -f'), 'public release must inspect Debian package metadata')
assert.ok(publicRelease.includes('deb_path="$(realpath "$deb_path")"'), 'public release must pass apt-get an absolute local Debian package path')
assert.ok(publicRelease.includes('test -x "$app_root/$linux_executable_name"'), 'public release must validate the Debian package executable name from package metadata')
assert.ok(publicRelease.includes('AUTOMNIA_PACKAGED_LINUX_ROOT'), 'public release must launch the installed Debian package')
assert.ok(publicRelease.includes('AUTOMNIA_PACKAGED_LINUX_APPIMAGE'), 'public release must launch the built AppImage')
assert.ok(publicRelease.includes('APPIMAGE_EXTRACT_AND_RUN=1'), 'public release must smoke-test AppImage without requiring FUSE on the runner')
assert.match(publicRelease, /AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN:\s*'1'/, 'AppImage smoke must keep its test window hidden on interactive runners')
assert.ok(publicRelease.includes('readelf -h'), 'public release must verify the AppImage ELF architecture')
assert.equal(packageJson.build?.linux?.executableName, packageJson.name, 'Linux executable name must match the installed Debian package executable')
assert.ok(packagedElectronLaunchSmoke.includes('linuxExecutableName'), 'packaged Linux launch smoke must use the configured Linux executable name')
assert.match(packagedElectronLaunchSmoke, /process.platform === 'darwin' || process.platform === 'linux' ? 60_000 : 10_000/, 'packaged macOS and Linux startup smoke must allow slow first-launch runtime staging')
assert.match(packagedElectronLaunchSmoke, /useLinuxAppImage\s*\?\s*180_000/, 'AppImage extract-and-run smoke must allow time to unpack the bundled Linux application')
assert.ok(packagedElectronLaunchSmoke.includes("AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS: useLinuxAppImage ? '15000' : '1500'"), 'AppImage smoke must keep its temporary extraction available while the runtime is verified')
assert.ok(packagedElectronLaunchSmoke.includes("AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN: '1'"), 'packaged launch smoke must avoid showing a test window on an interactive desktop')
assert.ok(packagedOpenClawGatewaySmoke.includes("AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN: '1'"), 'packaged Gateway smoke must avoid showing a test window on an interactive desktop')
assert.match(read('electron/main.cjs'), /AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN === '1'/, 'Electron E2E must support hidden-window startup validation')
assert.match(controlPlaneSource, /startup defaults raced with another config writer; rebasing/, 'Gateway plugin defaults must retry a config snapshot conflict during first startup')
assert.ok(packagedElectronLaunchSmoke.indexOf('await waitForLogPatterns(logPath, [') < packagedElectronLaunchSmoke.indexOf('const launcherStatus = await new Promise'), 'packaged startup must verify the writable runtime before collecting launch completion evidence')
assert.match(packagedElectronLaunchSmoke, /process\.platform === 'win32' && launcher\.exitCode === 0/, 'Windows smoke must treat the branded launcher as a successful fire-and-forget wrapper and validate the spawned Electron app through its E2E markers')
const afterPack = read('scripts/after-pack.cjs')
assert.match(afterPack, /const archiveMember = \(\.\.\.segments\) => path\.join\(\.\.\.segments\)/, 'packaged archive validation must use host-native member paths for Windows')
assert.ok(!afterPack.includes("'electron/update-config.json'"), 'packaged archive validation must not hard-code POSIX member separators')
for (const command of [
  'npm run dist:win',
  'npm run release:update-manifest',
  'npm run release:update-verify',
  'npm run release:lifecycle:windows',
  'npm run release:evidence',
  'npm run release:sign',
  'npm run release:validate',
  'npm run dist:mac',
  'npm run dist:linux',
]) {
  assert.ok(publicRelease.includes(command), `public release workflow must run ${command}`)
}
assert.match(publicRelease, /fresh|lifecycle/i, 'public release workflow must retain installer lifecycle evidence')
assert.match(publicRelease, /Download the currently published installer for a real upgrade check[\s\S]*?AUTOMNIA_PREVIOUS_WINDOWS_INSTALLER_PATH/, 'public release must test an upgrade from the installer customers currently use')
assert.match(publicRelease, /retention-days:\s*90/, 'public release evidence must be retained for review')

assert.match(quality, /ubuntu-latest/, 'cross-platform quality must cover Linux')
assert.match(quality, /macos-latest/, 'cross-platform quality must cover macOS')
assert.match(quality, /npm run test:unit:coverage/, 'cross-platform quality must enforce behavioral unit coverage')
assert.match(dependencyAudit, /npm audit --json > full-dependency-audit\.json/, 'scheduled audit must capture development and build dependency findings')
assert.match(dependencyAudit, /npm run audit:dependencies/, 'scheduled audit must still fail on production dependency policy')
assert.match(releaseGovernance, /Beta-Ready Release Gate/, 'release governance must document the beta-ready release gate')
assert.match(releaseGovernance, /Control Plane CI \/ Hardened control plane/, 'release governance must name the required Control Plane CI check')
assert.match(releaseGovernance, /automnia-release-evidence/, 'release governance must name the release evidence artifact')
assert.match(releaseGovernance, /Packaged screenshots are optional/, 'release governance must document screenshots as optional visual evidence')

assert.match(scripts['smoke:ci-workflow'] || '', /tsx scripts\/smoke-ci-workflow\.ts/)
assert.match(scripts['audit:dependencies'] || '', /npm audit --omit=dev --audit-level=high/)
assert.match(scripts['smoke:dependency-audit-clean'] || '', /tsx scripts\/smoke-dependency-audit-clean\.ts/)
assert.match(scripts['smoke:private-beta-handoff'] || '', /tsx scripts\/smoke-private-beta-review-handoff\.ts/)
assert.match(scripts['smoke:packaged-beta-screenshots-contract'] || '', /tsx scripts\/smoke-packaged-beta-screenshots-contract\.ts/)
assert.match(scripts['secret:scan'] || '', /node scripts\/secret-scan\.cjs/)
assert.match(scripts['release:validate'] || '', /node scripts\/validate-release-artifacts\.cjs/)
assert.match(scripts['release:update-manifest'] || '', /generate-update-manifest\.cjs/)
assert.match(scripts['release:lifecycle:windows'] || '', /windows-release-lifecycle\.ps1/)
assert.match(testCiScript, /npm run lint && npm run typecheck && npm run test:unit/, 'test:ci must run behavioral units after semantic checks')
assert.match(testCiScript, /npm run smoke:runtime-recovery-soak/, 'test:ci must exercise durable restart recovery')
assert.match(testCiScript, /npm run smoke:release-lifecycle/, 'test:ci must preserve release and recovery contracts')
assert.match(testCiScript, /npm run smoke:packaged-beta-screenshots-contract/, 'test:ci must preserve packaged screenshot coverage contracts')
assert.match(testCiScript, /npm run smoke:ci-workflow/, 'test:ci must finish with CI workflow contract checks')

assert.match(electronE2eSmoke, /renderer-journey/, 'Electron E2E must exercise rendered primary navigation')
assert.match(electronE2eSmoke, /runChecked\('tar', \['-xf', zipPath, '-C', destination\], 'Electron extract'\)/, 'Windows Electron E2E must extract the verified binary with tar instead of PowerShell Archive module')
assert.match(packageDesktop, /prepare-openclaw-vendor\.cjs/, 'desktop packaging must prepare vendored OpenClaw dependencies when invoked directly')
assert.match(packageDesktop, /killGeneratedWindowsPackageProcesses/, 'Windows packaging must stop packaged child processes before replacing output')
assert.match(packageDesktop, /StartsWith\(\$target/, 'Windows packaging cleanup must be scoped to the generated package directory')
assert.match(packageDesktop, /config\.directories\.output=release\/win-installer/, 'Windows installers must use an isolated output directory after launch smoke')
assert.match(read('scripts/after-pack.cjs'), /AUTOMNIA_UPDATE_REQUIRE_EMBEDDED_CONFIG/, 'packaging must support a release-only embedded updater trust check')
assert.match(read('scripts/after-pack.cjs'), /validateBundledOpenClawRuntime/, 'packaging must validate the bundled OpenClaw runtime payload')
assert.match(secretScanner, /private-key/, 'secret scan must detect private key material')
assert.match(secretScanner, /github-token/, 'secret scan must detect GitHub tokens')
assert.match(secretScanner, /allowlist\\s\+secret/, 'secret scan must support explicit allowlist markers')

console.log('ci workflow contract ok')

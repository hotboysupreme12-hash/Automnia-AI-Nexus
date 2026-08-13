import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const server = read('server/controlPlane.ts')
const controlPlaneHttp = read('server/controlPlaneHttp.ts')
const staticUi = read('server/staticUi.ts')
const electronMain = read('electron/main.cjs')
const runtimeDownloadSecurity = read('electron/runtime-download-security.cjs')
const packageSource = read('package.json')
const gatewayAuthSetup = read('scripts/setup-openclaw-gateway-auth.mjs')
const sessionTokenStore = read('server/sessionTokenStore.ts')
const packageJson = JSON.parse(packageSource) as {
  homepage?: string
  scripts?: Record<string, string>
  build?: {
    win?: { target?: string[] }
  }
}

assert.match(controlPlaneHttp, /CONTROL_CENTER_CONTENT_SECURITY_POLICY/, 'server must define a packaged UI CSP')
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://huggingface.co",
]) {
  assert.ok(controlPlaneHttp.includes(directive), `CSP must include ${directive}`)
}
assert.match(controlPlaneHttp, /setHeader\('Content-Security-Policy', CONTROL_CENTER_CONTENT_SECURITY_POLICY\)/, 'HTML static responses must receive the CSP header')
assert.match(controlPlaneHttp, /setHeader\('X-Content-Type-Options', 'nosniff'\)/, 'static responses must set nosniff')
assert.match(controlPlaneHttp, /setHeader\('Referrer-Policy', 'no-referrer'\)/, 'static responses must set no-referrer')
assert.match(staticUi, /setStaticSecurityHeaders\(res, file\.filePath\)/, 'static file streaming must apply security headers')
assert.match(server, /registerStaticUi\(app, \{/, 'control plane must register the extracted static UI boundary')

assert.match(electronMain, /function openAllowedExternalUrl/, 'Electron must centralize external URL handling')
assert.match(electronMain, /parsed\.protocol === 'https:' && !parsed\.username && !parsed\.password && !isInternalAppUrl\(targetUrl\)/, 'Electron external opening must be HTTPS-only and non-internal')
assert.match(electronMain, /setWindowOpenHandler\(handleWindowOpen\)/, 'Electron popup policy must be wired through the tested handler')
assert.match(electronMain, /function handleWindowOpen\(\{ url \}\) \{[\s\S]*openAllowedExternalUrl\(url\)[\s\S]*return \{ action: 'deny' \}/, 'Electron popup creation must be denied by default')
assert.match(electronMain, /will-navigate', handleWillNavigate\)/, 'Electron navigation policy must be wired through the tested handler')
assert.match(electronMain, /function handleWillNavigate\(event, url\) \{[\s\S]*if \(isInternalAppUrl\(url\)\) return[\s\S]*event\.preventDefault\(\)[\s\S]*openAllowedExternalUrl\(url\)/, 'Electron navigation must allow exact internal URLs and deny/open externally otherwise')
assert.match(electronMain, /AUTOMNIA_ELECTRON_E2E_ASSERT_NAVIGATION/, 'Electron must expose E2E-only navigation policy assertions')
assert.match(electronMain, /AUTOMNIA_ELECTRON_E2E_ASSERT_RENDERER_EXTERNALS/, 'Electron E2E must assert renderer-originated external navigation attempts')
assert.match(electronMain, /AUTOMNIA_ELECTRON_E2E_ASSERT_RENDERER_RECOVERY/, 'Electron E2E must assert renderer crash recovery')
assert.match(electronMain, /AUTOMNIA_ELECTRON_E2E_ASSERT_RENDERER_JOURNEY/, 'Electron E2E must exercise primary renderer workspaces')
assert.match(electronMain, /AUTOMNIA_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR/, 'Electron E2E must assert tray hide and restore behavior')
assert.match(electronMain, /tray\.emit\('click'\)/, 'Electron tray E2E must restore the window through the tray click path')
assert.doesNotMatch(electronMain, /return \{ action: 'allow' \}/, 'Electron popup policy must not allow unexpected windows')
assert.doesNotMatch(electronMain, /WINDOWS_PACKAGED_SINGLE_PROCESS/, 'Electron must not keep a production packaged single-process escape hatch')
assert.doesNotMatch(electronMain, /AUTOMNIA_WINDOWS_SINGLE_PROCESS/, 'Electron must not expose the old production single-process env flag')
assert.match(electronMain, /const WINDOWS_DIAGNOSTIC_SINGLE_PROCESS = process\.platform === 'win32' &&[\s\S]*isDev[\s\S]*AUTOMNIA_WINDOWS_DIAGNOSTIC_SINGLE_PROCESS[\s\S]*AUTOMNIA_ACK_UNSAFE_ELECTRON_SANDBOX_DIAGNOSTIC/, 'Unsafe single-process mode must require explicit development-only diagnostic acknowledgement')
assert.match(electronMain, /if \(WINDOWS_DIAGNOSTIC_SINGLE_PROCESS\) \{[\s\S]*appendSwitch\('single-process'\)[\s\S]*appendSwitch\('in-process-gpu'\)[\s\S]*appendSwitch\('disable-gpu-sandbox'\)/, 'Unsafe Electron process switches must be gated behind diagnostic mode only')
assert.match(electronMain, /function configureRendererPermissionPolicy/, 'Electron must centralize renderer permission policy')
assert.match(electronMain, /permission !== 'media'/, 'Electron permissions must deny every capability except explicitly handled media')
assert.match(electronMain, /webContents !== win\.webContents/, 'Electron microphone permission must be scoped to the application webContents')
assert.match(electronMain, /requestedMediaTypes\.includes\('audio'\)[^]*every\(\(mediaType\) => mediaType === 'audio'\)/, 'Electron media permission must allow audio-only capture')
assert.match(electronMain, /setDevicePermissionHandler\(\(\) => false\)/, 'Electron device permissions must remain denied by default')
assert.match(electronMain, /will-redirect', handleWillNavigate/, 'Electron redirects must use the same navigation policy')
assert.match(electronMain, /event\.sender !== mainWindow\.webContents/, 'IPC sender validation must bind to the actual application webContents')
assert.match(electronMain, /event\.senderFrame !== event\.sender\.mainFrame/, 'IPC must reject subframe senders')
assert.match(electronMain, /parsed\.protocol !== 'http:'/, 'internal app navigation must require the expected HTTP protocol')
assert.match(electronMain, /webSecurity: true,/, 'BrowserWindow must explicitly keep web security enabled')
assert.match(electronMain, /allowRunningInsecureContent: false,/, 'BrowserWindow must reject insecure mixed content')
assert.match(electronMain, /parseSha256Manifest/, 'managed Node provisioning must resolve a published archive checksum')
assert.match(electronMain, /SHASUMS256\.txt/, 'managed Node provisioning must verify against Node.js SHASUMS256')
assert.match(electronMain, /Node\.js archive checksum mismatch/, 'managed Node provisioning must fail closed on checksum mismatch')
assert.match(runtimeDownloadSecurity, /parsed\.protocol !== 'https:'/, 'runtime downloads must require HTTPS')
assert.match(runtimeDownloadSecurity, /untrusted host/, 'runtime downloads must enforce a hostname allowlist')
assert.match(electronMain, /partial-\$\{process\.pid\}/, 'runtime downloads must stage into atomic partial files')

assert.match(electronMain, /sandbox: true,/, 'BrowserWindow must always request renderer sandboxing')
assert.doesNotMatch(electronMain, /sandbox:\s*!/, 'BrowserWindow sandbox must not depend on an unsafe mode flag')
assert.equal(existsSync(join(rootDir, 'main.cjs')), false, 'stale root Electron entrypoint must not exist')

assert.doesNotMatch(server, /OPENCLAW_GATEWAY_PASSWORD\?\.trim\(\) \|\| 'default'/, 'gateway auth must never synthesize a fixed default password')
assert.doesNotMatch(gatewayAuthSetup, /DEFAULT_PASSWORD\s*=\s*['"]default['"]/, 'gateway auth setup must be token-only by default')
assert.match(gatewayAuthSetup, /writePassword: false/, 'gateway auth setup must require explicit password opt-in')
assert.match(sessionTokenStore, /randomBytes\(32\)\.toString\('base64url'\)/, 'session tokens must use 256 bits of entropy')
assert.match(sessionTokenStore, /timingSafeEqual/, 'launch token comparison must support constant-time equality')
assert.match(controlPlaneHttp, /secureTokenEqual\(token, options\.authToken\)/, 'privileged launch-token checks must use constant-time equality')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:session-tokens/, 'test:ci must cover session expiry and revocation')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:gateway-auth-hardening/, 'test:ci must cover token-only gateway auth defaults')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:security/, 'test:ci must include security hardening smoke')
assert.equal(packageJson.homepage, 'https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus', 'package metadata must point at the public project URL')
assert.ok(packageJson.build?.win?.target?.includes('nsis'), 'Windows consumer distribution must target an installer')
assert.doesNotMatch(packageSource, /automnia\.local|support@automnia\.local/, 'package metadata must not publish stale .local support URLs')

console.log('security hardening contract ok')

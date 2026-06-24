import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const server = read('server/index.ts')
const electronMain = read('electron/main.cjs')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(server, /CONTROL_CENTER_CONTENT_SECURITY_POLICY/, 'server must define a packaged UI CSP')
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
]) {
  assert.ok(server.includes(directive), `CSP must include ${directive}`)
}
assert.match(server, /setHeader\('Content-Security-Policy', CONTROL_CENTER_CONTENT_SECURITY_POLICY\)/, 'HTML static responses must receive the CSP header')
assert.match(server, /setHeader\('X-Content-Type-Options', 'nosniff'\)/, 'static responses must set nosniff')
assert.match(server, /setHeader\('Referrer-Policy', 'no-referrer'\)/, 'static responses must set no-referrer')
assert.match(server, /setStaticSecurityHeaders\(res, file\.filePath\)/, 'static file streaming must apply security headers')

assert.match(electronMain, /function openAllowedExternalUrl/, 'Electron must centralize external URL handling')
assert.match(electronMain, /parsed\.protocol === 'https:' && !isInternalAppUrl\(targetUrl\)/, 'Electron external opening must be HTTPS-only and non-internal')
assert.match(electronMain, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*openAllowedExternalUrl\(url\)[\s\S]*return \{ action: 'deny' \}/, 'Electron popup creation must be denied by default')
assert.match(electronMain, /will-navigate'[\s\S]*if \(isInternalAppUrl\(url\)\) return[\s\S]*event\.preventDefault\(\)[\s\S]*openAllowedExternalUrl\(url\)/, 'Electron navigation must allow exact internal URLs and deny/open externally otherwise')
assert.doesNotMatch(electronMain, /return \{ action: 'allow' \}/, 'Electron popup policy must not allow unexpected windows')
assert.doesNotMatch(electronMain, /WINDOWS_PACKAGED_SINGLE_PROCESS/, 'Electron must not keep a production packaged single-process escape hatch')
assert.doesNotMatch(electronMain, /DYSTOPAI_WINDOWS_SINGLE_PROCESS/, 'Electron must not expose the old production single-process env flag')
assert.match(electronMain, /const WINDOWS_DIAGNOSTIC_SINGLE_PROCESS = process\.platform === 'win32' &&[\s\S]*isDev[\s\S]*DYSTOPAI_WINDOWS_DIAGNOSTIC_SINGLE_PROCESS[\s\S]*DYSTOPAI_ACK_UNSAFE_ELECTRON_SANDBOX_DIAGNOSTIC/, 'Unsafe single-process mode must require explicit development-only diagnostic acknowledgement')
assert.match(electronMain, /if \(WINDOWS_DIAGNOSTIC_SINGLE_PROCESS\) \{[\s\S]*appendSwitch\('single-process'\)[\s\S]*appendSwitch\('in-process-gpu'\)[\s\S]*appendSwitch\('disable-gpu-sandbox'\)/, 'Unsafe Electron process switches must be gated behind diagnostic mode only')
assert.match(electronMain, /sandbox: true,/, 'BrowserWindow must always request renderer sandboxing')
assert.doesNotMatch(electronMain, /sandbox:\s*!/, 'BrowserWindow sandbox must not depend on an unsafe mode flag')

assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:security/, 'test:ci must include security hardening smoke')

console.log('security hardening contract ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const app = read('src/App.tsx')
const main = read('src/main.tsx')
const authContext = read('src/context/AuthContext.tsx')
const loginModal = read('src/components/auth/LoginModal.tsx')
const recruitModal = read('src/components/recruit/RecruitAgentModal.tsx')
const apiClient = read('src/api/client.ts')
const authenticatedFetch = read('src/api/authenticatedFetch.ts')
const authTokenStore = read('src/api/authTokenStore.ts')
const electronMain = read('electron/main.cjs')
const preload = read('electron/preload.cjs')
const server = read('server/controlPlane.ts')
const agentTurnRoutes = read('server/routes/agentTurnRoutes.ts')
const controlPlaneHttp = read('server/controlPlaneHttp.ts')
const authRoutes = read('server/routes/authRoutes.ts')
const loginAttemptLimiter = read('server/loginAttemptLimiter.ts')
const diagnosticsRoutes = read('server/routes/diagnosticsRoutes.ts')
const readme = read('README.md')
const userGuide = read('docs/USER_GUIDE.md')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const forbiddenDefaultToken = 'dev-token-change-me'

assert.match(app, /<AuthProvider>/, 'App must mount AuthProvider in the live render tree')
assert.match(app, /<LoginModal \/>/, 'Unauthenticated app state must render LoginModal')
assert.match(app, /<NexusShell \/>/, 'Authenticated app state must render NexusShell')
assert.match(main, /installAuthenticatedFetch\(\)/, 'Renderer entry must install authenticated fetch bridge for legacy API calls')

assert.match(authContext, /apiRequest<[\s\S]*\/api\/auth\/login/, 'AuthContext login must use the canonical API client')
assert.match(authContext, /apiRequest<[\s\S]*\/api\/auth\/status/, 'AuthContext status checks must use the canonical API client')
assert.match(authContext, /bootstrapControlCenterSession/, 'AuthContext must bootstrap desktop auth through a server-issued session capability')
assert.match(authContext, /DESKTOP_BOOTSTRAP_ATTEMPTS/, 'AuthContext must retry desktop session bootstrap during first-run startup')
assert.match(authContext, /DESKTOP_BOOTSTRAP_TIMEOUT_MS/, 'AuthContext must bound desktop session bootstrap so the spinner cannot hang forever')
assert.match(apiClient, /Authorization/, 'Canonical API client must attach bearer auth')
assert.match(authenticatedFetch, /pathname\.startsWith\('\/api'\)/, 'Fetch bridge must only target Control Center API paths')
assert.match(authenticatedFetch, /headers\.set\('Authorization', `Bearer \$\{token\}`\)/, 'Fetch bridge must attach stored bearer token')
assert.match(authTokenStore, /window\.sessionStorage/, 'Renderer session tokens must be process/tab scoped')
assert.match(authTokenStore, /storageRemove\(local\)/, 'Legacy persistent bearer tokens must be removed after migration')
assert.match(recruitModal, /apiRequest<\{ models\?: unknown \}>\('\/api\/models\/available\?background=0'/, 'Recruit model lookup must use canonical API client')
assert.match(recruitModal, /apiRequest<\{ providers\?: unknown \}>\('\/api\/auth\/providers'/, 'Recruit provider lookup must use canonical API client')
assert.match(recruitModal, /apiRequest<AutoForgeApiResponse>\('\/api\/party\/recruit\/auto-markdown'/, 'Recruit Auto Forge must use canonical API client')
assert.match(recruitModal, /apiRequest\(`\/api\/auth\/providers\/\$\{encodeURIComponent\(authModalProvider\.provider\)\}`/, 'Recruit provider key save must use canonical API client')
assert.doesNotMatch(recruitModal, /fetch\(/, 'Recruit modal must not bypass canonical API client')

assert.match(electronMain, /randomBytes\(32\)\.toString\('base64url'\)/, 'Electron must generate a strong per-launch control token')
assert.match(electronMain, /process\.env\.CONTROL_CENTER_TOKEN = controlCenterLaunchToken/, 'Electron must pass the launch token to the child API server')
assert.match(electronMain, /path: '\/api\/ready'/, 'Electron startup readiness probe must use the lightweight ready endpoint')
assert.match(electronMain, /CONTROL_SERVER_STARTUP_TIMEOUT_MS[\s\S]*180_000/, 'Electron startup readiness must allow slow packaged Windows runtime preflight')
assert.match(electronMain, /ipcMain\.handle\('dystopai:bootstrap-control-center-session'/, 'Electron must expose a narrow session-bootstrap IPC capability')
assert.match(electronMain, /isTrustedRendererSender\(event\)/, 'Electron IPC handlers must validate renderer sender origin')
assert.match(preload, /bootstrapControlCenterSession/, 'Preload must expose only the short-lived session bootstrap capability')
assert.doesNotMatch(preload, /getControlCenterToken|get-control-center-token/, 'Preload must never expose the long-lived launch token')
assert.doesNotMatch(electronMain, /ipcMain\.handle\('dystopai:get-control-center-token'/, 'Electron must keep the long-lived launch token in the main process')

assert.doesNotMatch(server, /app\.use\(cors\(\)\)/, 'Server must not use permissive default CORS')
assert.match(server, /installControlPlaneHttp\(app, \{[\s\S]*authToken: AUTH_TOKEN[\s\S]*sessionTokens/, 'Server must install the shared API auth guard before privileged routes')
assert.match(server, /registerAuthRoutes\(app, \{ authToken: AUTH_TOKEN, loginAttempts, sessionTokens \}\)/, 'Server must mount extracted public auth routes')
assert.match(authRoutes, /app\.post\('\/api\/auth\/login'/, 'Auth routes module must own login')
assert.match(authRoutes, /app\.get\('\/api\/auth\/status'/, 'Auth routes module must own status')
assert.match(authRoutes, /options\.sessionTokens\.issue\(\)/, 'Auth login must mint expiring live session tokens')
assert.match(authRoutes, /app\.post\('\/api\/auth\/logout'/, 'Auth routes must revoke sessions on logout')
assert.match(authRoutes, /secureTokenEqual/, 'Launch-token verification must be constant-time')
assert.match(authRoutes, /options\.sessionTokens\.has\(token\) \|\| secureTokenEqual\(token, options\.authToken\)/, 'Auth status must accept both live sessions and the Electron launch token')
assert.match(authRoutes, /Retry-After/, 'Login throttling must expose a retry window')
assert.match(authRoutes, /rate_limited/, 'Login throttling must fail with a bounded API error code')
assert.doesNotMatch(authRoutes, /req\.get\(['"]x-forwarded-for['"]\)/i, 'Loopback login throttling must not trust caller-controlled proxy headers')
assert.match(loginAttemptLimiter, /maxEntries/, 'Login throttling storage must be bounded')
assert.match(loginAttemptLimiter, /2 \*\* exponent/, 'Repeated login failures must receive exponential backoff')
assert.match(controlPlaneHttp, /function isAllowedControlCenterOrigin/, 'Server must validate exact request origins')
assert.match(controlPlaneHttp, /PUBLIC_API_PATHS = new Set\(\['\/api\/ready', '\/api\/health', '\/api\/auth\/login', '\/api\/auth\/status'\]\)/, 'Only ready/health/login/status should bypass auth')
assert.match(controlPlaneHttp, /app\.use\('\/api', \(req, res, next\) => \{[\s\S]*auth_required/, 'Server must register an API auth guard before privileged routes')
assert.match(controlPlaneHttp, /options\.sessionTokens\.has\(token\) && !secureTokenEqual\(token, options\.authToken\)/, 'Server auth guard must reject tokens outside live sessions or the Electron launch token')
assert.match(agentTurnRoutes, /agent-to-agent`[\s\S]*Authorization: `Bearer \$\{AUTH_TOKEN\}`/, 'Internal server-to-server API calls must authenticate through the guard')
assert.match(diagnosticsRoutes, /app\.get\('\/api\/ready'[\s\S]*ready: true/, 'Diagnostics routes must expose a lightweight desktop readiness endpoint')
assert.match(server, /CONFIGURED_AUTH_TOKEN = process\.env\.CONTROL_CENTER_TOKEN\?\.trim\(\)/, 'Server must read an explicit configured auth token')
assert.match(server, /const AUTH_TOKEN = CONFIGURED_AUTH_TOKEN \|\| randomBytes\(32\)\.toString\('base64url'\)/, 'Server must generate a per-launch auth token when none is configured')
assert.match(controlPlaneHttp, /X-Request-Id/, 'Server must expose request IDs for diagnostics')

for (const [name, content] of [
  ['LoginModal', loginModal],
  ['server', server],
  ['auth routes', authRoutes],
  ['README', readme],
  ['USER_GUIDE', userGuide],
] as const) {
  assert.doesNotMatch(content, new RegExp(forbiddenDefaultToken), `${name} must not expose a fixed default token`)
}

assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:auth/, 'test:ci must include auth control-plane smoke')

console.log('auth control-plane contract ok')

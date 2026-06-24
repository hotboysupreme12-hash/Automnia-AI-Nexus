import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const server = read('server/index.ts')
const controlPlaneHttp = read('server/controlPlaneHttp.ts')
const authRoutes = read('server/routes/authRoutes.ts')
const missionRoutes = read('server/routes/missionRoutes.ts')
const apiClient = read('src/api/client.ts')
const editor = read('src/components/editor/AgentEditorModal.tsx')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing slice start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing slice end after ${start}: ${end}`)
  return source.slice(startIndex, endIndex)
}

function sliceFrom(source: string, start: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing slice start: ${start}`)
  return source.slice(startIndex)
}

function assertCanonicalRouteSlice(name: string, source: string): void {
  assert.match(source, /apiSuccess\(res,/, `${name} must use canonical API success envelopes`)
  assert.match(source, /apiFailure\(res,/, `${name} must use canonical API error envelopes`)
  assert.doesNotMatch(source, /res\.status\([^)]*\)\.json\(\{\s*(?:ok:\s*false,\s*)?error:/, `${name} must not emit ad hoc error JSON`)
  assert.doesNotMatch(source, /res\.json\(\{\s*ok:\s*true/, `${name} must not emit ad hoc success JSON`)
}

assert.match(server, /installControlPlaneHttp\(app, \{/, 'server must install shared control-plane HTTP middleware')
assert.match(server, /registerAuthRoutes\(app, \{ authToken: AUTH_TOKEN, sessionTokens \}\)/, 'server must register extracted auth routes')
assert.doesNotMatch(server, /app\.post\('\/api\/auth\/login'/, 'server index must not inline auth login routes')
assert.doesNotMatch(server, /app\.get\('\/api\/auth\/status'/, 'server index must not inline auth status routes')
assert.doesNotMatch(server, /app\.use\(cors\(/, 'server index must not own CORS/auth middleware directly')
assert.doesNotMatch(server, /express\.json\(\{ limit: '4mb' \}\)/, 'server index must not own JSON parsing middleware directly')
assert.match(controlPlaneHttp, /export type ApiErrorCode =/, 'control-plane HTTP module must define bounded API error codes')
assert.match(controlPlaneHttp, /export function apiSuccess<[\s\S]*requestId: responseRequestId\(res\)/, 'apiSuccess must include the response request id')
assert.match(controlPlaneHttp, /export function apiFailure[\s\S]*ok: false,[\s\S]*error,[\s\S]*requestId: responseRequestId\(res\)/, 'apiFailure must emit a standard error envelope')
assert.match(controlPlaneHttp, /apiFailure\(res, 403, 'origin_not_allowed'/, 'origin guard must use canonical errors')
assert.match(controlPlaneHttp, /apiFailure\(res, 401, 'auth_required'/, 'auth guard must use canonical errors')
assert.match(controlPlaneHttp, /apiFailure\([\s\S]*'invalid_json'/, 'JSON parse failures must use canonical errors')

assert.match(apiClient, /function successPayloadData/, 'API client must unwrap canonical success envelopes')
assert.match(apiClient, /payload\.ok === true && Object\.prototype\.hasOwnProperty\.call\(payload, 'data'\)/, 'API client must only unwrap explicit data envelopes')
assert.match(apiClient, /if \(isRecord\(error\)\)/, 'API client must parse structured error envelopes')
assert.match(apiClient, /message: typeof error\.message === 'string'/, 'API client must read structured error messages')

assert.match(server, /import \{ registerMissionRoutes \} from '\.\/routes\/missionRoutes'/, 'server index must import extracted mission routes')
assert.match(server, /registerMissionRoutes\(app, \{/, 'server index must register extracted mission routes')
assert.doesNotMatch(server, /app\.get\('\/api\/missions'/, 'server index must not inline mission read routes')
assert.doesNotMatch(server, /app\.post\('\/api\/missions\/start'/, 'server index must not inline mission start route')
assert.doesNotMatch(server, /app\.post\('\/api\/missions\/stop'/, 'server index must not inline mission stop route')
const missionSlice = sliceFrom(missionRoutes, "app.get('/api/missions'")
assertCanonicalRouteSlice('mission control-plane routes', missionSlice)
assert.match(missionSlice, /apiFailure\(res, 400, 'invalid_payload'/, 'mission routes must expose invalid-payload codes')
assert.match(missionSlice, /apiFailure\(res, 404, 'mission_not_found'/, 'mission routes must expose not-found codes')
assert.match(missionSlice, /apiFailure\(res, 400, 'mission_invalid_state'/, 'mission stop must expose state-conflict codes')
assert.match(missionSlice, /apiFailure\(res, 500, 'mission_scheduler_failed'/, 'mission scheduler failures must be typed')

const configGetSlice = sliceBetween(server, "app.get('/api/party/agent/:agentId/config'", "app.post('/api/party/configs/sync'")
assertCanonicalRouteSlice('agent config read route', configGetSlice)
assert.match(configGetSlice, /apiFailure\(res, 404, 'agent_not_found'/, 'agent config read must expose not-found codes')

const configPostSlice = sliceBetween(server, "app.post('/api/party/agent/:agentId/config'", "app.get('/api/party/agent/:agentId/model'")
assertCanonicalRouteSlice('agent config mutation route', configPostSlice)
assert.match(configPostSlice, /apiFailure\(res, 400, 'invalid_payload'/, 'agent config mutation must expose invalid-payload codes')
assert.match(configPostSlice, /apiFailure\(res, 400, 'workspace_unwritable'/, 'agent config mutation must type workspace validation failures')
assert.match(editor, /if\(result\.ok&&result\.data\.config\)/, 'editor config load must accept unwrapped canonical config data')

const authLoginSlice = sliceBetween(authRoutes, "app.post('/api/auth/login'", "app.get('/api/auth/status'")
assertCanonicalRouteSlice('auth login route', authLoginSlice)
assert.match(authLoginSlice, /apiFailure\(res, 401, 'invalid_token'/, 'login failures must expose invalid-token codes')

const authStatusSlice = sliceFrom(authRoutes, "app.get('/api/auth/status'")
assert.match(authStatusSlice, /apiSuccess\(res, \{ authenticated: true \}\)/, 'auth status success must use canonical true envelope')
assert.match(authStatusSlice, /apiSuccess\(res, \{ authenticated: false \}\)/, 'auth status false must use canonical false envelope')
assert.doesNotMatch(authStatusSlice, /res\.json\(/, 'auth status must not emit ad hoc JSON')

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:api-envelope'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:api-envelope/, 'test:ci must include API envelope coverage')

console.log('api envelope contract ok')

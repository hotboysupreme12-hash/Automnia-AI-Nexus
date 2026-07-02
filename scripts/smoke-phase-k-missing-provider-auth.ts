import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AUTH_ENV_MAP } from '../server/catalogs/providerCatalog'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-missing-provider-auth'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'missing-provider-auth-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'MISSING_PROVIDER_AUTH_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '15-missing-provider-auth-smoke.log')
const startedAt = new Date().toISOString()
const targetProvider = 'deepseek'
const targetModel = 'deepseek/deepseek-v4-pro'
const agentId = 'phase-k-missing-auth-agent'

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type ProviderStatus = {
  provider?: string
  label?: string
  configured?: boolean
  mode?: string
  envKeys?: string[]
  stored?: boolean
  optionalAuth?: boolean
  apiKey?: {
    configured?: boolean
    stored?: boolean
    envConfigured?: boolean
    configConfigured?: boolean
    envKeys?: string[]
  }
  oauth?: {
    supported?: boolean
    configured?: boolean
    available?: boolean
    missing?: string[]
    refreshAvailable?: boolean
  }
}

type ProviderStatusesPayload = {
  providers?: ProviderStatus[]
  persistencePath?: string
}

type ApiCallResult<T = unknown> = {
  response: Response
  payload: ApiEnvelope<T>
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not allocate a local TCP port'))
      })
    })
  })
}

function credentialScrubbedEnv(extra: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  for (const key of new Set(Object.values(AUTH_ENV_MAP).flat())) {
    env[key] = ''
  }
  return env
}

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const configPath = path.join(stateDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n', 'utf8')
  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: credentialScrubbedEnv({
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONTROL_CENTER_PORT: String(port),
      CONTROL_CENTER_TOKEN: CONTROL_TOKEN,
      CONTROL_CENTER_LOGIN_MAX_ATTEMPTS: '3',
      CONTROL_CENTER_LOGIN_BASE_LOCKOUT_MS: '1000',
      CONTROL_CENTER_LOGIN_MAX_LOCKOUT_MS: '4000',
      CONTROL_CENTER_EXIT_ON_PORT_ERROR: '1',
      CONTROL_CENTER_AUTOSTART_GATEWAY: '0',
      CONTROL_CENTER_GATEWAY_AGENT_SESSIONS: '0',
      CONTROL_CENTER_GATEWAY_CHAT_CLIENT: '0',
      CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC: '0',
      CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC: '0',
      CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS: '0',
      CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN: '1',
      CONTROL_CENTER_WORKSPACE_ROOT: workspaceRoot,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_HOME: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_LOG_PATH: path.join(stateDir, 'gateway.log'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function waitForReady(child: ChildProcessWithoutNullStreams, port: number) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Control Center exited ${child.exitCode}\n${output.slice(-3000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
      if (response.ok) return output
    } catch {
      // Retry until startup either succeeds or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Control Center did not become ready\n${output.slice(-3000)}`)
}

async function api<T>(
  port: number,
  apiPath: string,
  options: { method?: string; token?: string; body?: unknown; requestId?: string; expectOk?: boolean } = {},
): Promise<ApiCallResult<T>> {
  const requestId = options.requestId || `phase-k-${Math.random().toString(36).slice(2)}`
  const headers = new Headers({ 'X-Request-Id': requestId })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json() as ApiEnvelope<T>
  assert.equal(response.headers.get('x-request-id'), requestId)
  assert.equal(payload.requestId, requestId)
  const expectOk = options.expectOk !== false
  if (expectOk && (!response.ok || !payload.ok)) {
    const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
    throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
  }
  if (!expectOk) {
    assert.equal(payload.ok, false, `${options.method || 'GET'} ${apiPath} should fail`)
    assert.equal(response.ok, false, `${options.method || 'GET'} ${apiPath} should return a non-2xx status`)
  }
  return { response, payload }
}

async function login(port: number) {
  const { payload } = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-missing-auth-login',
  })
  assert.equal(payload.ok, true)
  assert.match(payload.data.token, /^[A-Za-z0-9_-]{40,}$/)
  return payload.data.token
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ])
  if (child.exitCode === null && child.pid && process.platform !== 'win32') child.kill('SIGKILL')
}

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function apiErrorDetail(payload: ApiEnvelope): Record<string, unknown> {
  assert.equal(payload.ok, false)
  const detail = payload.error.detail
  assert.ok(detail && typeof detail === 'object' && !Array.isArray(detail), 'error detail should be an object')
  return detail as Record<string, unknown>
}

function assertMissingAuthFailure(result: ApiCallResult, expected: { status: number; code: string; message: RegExp }) {
  assert.equal(result.response.status, expected.status)
  assert.equal(result.payload.ok, false)
  assert.equal(result.payload.error.code, expected.code)
  assert.match(result.payload.error.message, expected.message)
  const detail = apiErrorDetail(result.payload)
  assert.equal(detail.provider, targetProvider)
  assert.ok(detail.providerStatus && typeof detail.providerStatus === 'object', 'error detail should include provider status')
  const providerStatus = detail.providerStatus as ProviderStatus
  assert.equal(providerStatus.provider, targetProvider)
  assert.equal(providerStatus.configured, false)
  assert.equal(Boolean(providerStatus.apiKey?.configured), false)
  assert.ok(providerStatus.envKeys?.includes('DEEPSEEK_API_KEY'), 'provider status should explain the expected env key')
}

function evidenceHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,}|session[_-]?token["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

function sourceAssertions() {
  const controlPlane = read('server/controlPlane.ts')
  const agentConfigRoutes = read('server/routes/agentConfigRoutes.ts')
  const partyManagementRoutes = read('server/routes/partyManagementRoutes.ts')
  const providerAuthService = read('server/services/providers/providerAuthService.ts')
  const agentConsole = read('src/components/monitor/AgentResponseConsole.tsx')
  const agentEditor = read('src/components/editor/AgentEditorModal.tsx')
  const modelSelector = read('src/components/party/ModelSelectorModal.tsx')
  const recruitModal = read('src/components/recruit/RecruitAgentModal.tsx')
  const uiSmoke = read('scripts/smoke-ui-render.mjs')
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

  assert.match(providerAuthService, /function\s+modelAuthProblem\b/, 'missing-auth decisions must stay in providerAuthService')
  assert.match(controlPlane, /Connect this provider before using Auto Forge/, 'Auto Forge runtime helper must explain missing provider auth')
  assert.match(agentConfigRoutes, /model_auth_required[\s\S]*Connect this provider before saving the model/, 'agent model save must explain missing provider auth')
  assert.match(partyManagementRoutes, /Connect this provider before recruiting with this model/, 'recruit route must explain missing provider auth')
  assert.match(agentConsole, /case 'auth_missing':[\s\S]*label: 'Connect provider'/, 'Command Console must show a Connect provider CTA for auth_missing')
  assert.match(agentConsole, /Refresh credentials, then retry this turn\./, 'Command Console auth_missing CTA must explain the retry path')
  assert.match(agentEditor, /Connect this provider before saving\./, 'Agent editor must explain missing auth before saving')
  assert.match(modelSelector, /Connect it before using this model\./, 'Model selector must explain missing auth before model use')
  assert.match(recruitModal, /auth required\.[\s\S]*title=\{`Connect \$\{selectedProviderAuth\.label \|\| selectedProviderAuth\.provider\} authentication`\}/, 'Recruit modal must show a connect-provider control near missing auth')
  assert.match(uiSmoke, /seedMissingProviderAuthCommandConsole/, 'UI smoke must exercise the missing-provider-auth Command Console path')
  assert.match(uiSmoke, /authMissingCtaText/, 'UI smoke must assert the rendered auth-missing CTA text')
  assert.equal(
    packageJson.scripts?.['smoke:phase-k-missing-provider-auth'],
    'tsx scripts/smoke-phase-k-missing-provider-auth.ts',
    'package.json should expose smoke:phase-k-missing-provider-auth',
  )
}

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-missing-provider-auth-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const agentWorkspace = path.join(workspaceRoot, agentId)
mkdirSync(agentWorkspace, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  sourceAssertions()
  const startupOutput = await waitForReady(child, port)
  const token = await login(port)

  const providersResult = await api<ProviderStatusesPayload>(port, '/api/auth/providers?refresh=1', {
    token,
    requestId: 'phase-k-missing-auth-provider-status',
  })
  assert.equal(providersResult.payload.ok, true)
  const deepseekStatus = providersResult.payload.data.providers?.find((entry) => entry.provider === targetProvider)
  assert.ok(deepseekStatus, 'provider status should include DeepSeek')
  assert.equal(deepseekStatus.configured, false)
  assert.equal(deepseekStatus.apiKey?.configured, false)
  assert.ok(deepseekStatus.envKeys?.includes('DEEPSEEK_API_KEY'), 'DeepSeek status should list DEEPSEEK_API_KEY')

  const blockedRecruit = await api(port, '/api/party/recruit', {
    method: 'POST',
    token,
    requestId: 'phase-k-missing-auth-recruit-blocked',
    expectOk: false,
    body: {
      agentId,
      name: 'Phase K Missing Auth Agent',
      workspace: agentWorkspace,
      model: { primary: targetModel },
      profile: {
        className: 'Beta Auth Check',
        role: 'Verifies missing-provider-auth user guidance.',
        behaviorProfile: 'hybrid',
      },
    },
  })
  assertMissingAuthFailure(blockedRecruit, {
    status: 409,
    code: 'recruit_failed',
    message: /Missing auth for deepseek\. Connect this provider before recruiting with this model\./,
  })

  const recruit = await api<{ agentId?: string }>(port, '/api/party/recruit', {
    method: 'POST',
    token,
    requestId: 'phase-k-missing-auth-recruit-agent',
    body: {
      agentId,
      name: 'Phase K Missing Auth Agent',
      workspace: agentWorkspace,
      profile: {
        className: 'Beta Auth Check',
        role: 'Verifies missing-provider-auth user guidance.',
        behaviorProfile: 'hybrid',
      },
    },
  })
  assert.equal(recruit.payload.ok, true)
  assert.equal(recruit.payload.data.agentId, agentId)

  const blockedModelSave = await api(port, `/api/party/agent/${encodeURIComponent(agentId)}/model`, {
    method: 'POST',
    token,
    requestId: 'phase-k-missing-auth-model-save-blocked',
    expectOk: false,
    body: {
      primary: targetModel,
      fallbacks: [],
    },
  })
  assertMissingAuthFailure(blockedModelSave, {
    status: 409,
    code: 'model_auth_required',
    message: /Missing auth for deepseek\. Connect this provider before saving the model\./,
  })

  const blockedAutoForge = await api(port, '/api/party/recruit/auto-markdown', {
    method: 'POST',
    token,
    requestId: 'phase-k-missing-auth-auto-forge-blocked',
    expectOk: false,
    body: {
      model: targetModel,
      name: 'Phase K Missing Auth Agent',
      agentId,
      className: 'Beta Auth Check',
      role: 'Verifies missing-provider-auth user guidance.',
      behaviorProfile: 'hybrid',
      files: ['IDENTITY.md'],
    },
  })
  assertMissingAuthFailure(blockedAutoForge, {
    status: 409,
    code: 'recruit_failed',
    message: /Missing auth for deepseek\. Connect this provider before using Auto Forge\./,
  })

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems: [127],
    blockedItems: [],
    startedAt,
    completedAt,
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
    },
    provider: {
      provider: targetProvider,
      model: targetModel,
      configured: false,
      envKeys: deepseekStatus.envKeys || [],
      statusRoute: '/api/auth/providers?refresh=1',
      localAuthPathIsIsolated: Boolean(
        providersResult.payload.data.persistencePath
          && path.resolve(providersResult.payload.data.persistencePath).startsWith(path.resolve(stateDir)),
      ),
    },
    backendPaths: {
      recruit: {
        route: '/api/party/recruit',
        status: blockedRecruit.response.status,
        code: blockedRecruit.payload.ok ? '' : blockedRecruit.payload.error.code,
        message: blockedRecruit.payload.ok ? '' : blockedRecruit.payload.error.message,
      },
      modelSave: {
        route: `/api/party/agent/${agentId}/model`,
        status: blockedModelSave.response.status,
        code: blockedModelSave.payload.ok ? '' : blockedModelSave.payload.error.code,
        message: blockedModelSave.payload.ok ? '' : blockedModelSave.payload.error.message,
      },
      autoForge: {
        route: '/api/party/recruit/auto-markdown',
        status: blockedAutoForge.response.status,
        code: blockedAutoForge.payload.ok ? '' : blockedAutoForge.payload.error.code,
        message: blockedAutoForge.payload.ok ? '' : blockedAutoForge.payload.error.message,
      },
    },
    uiEvidence: {
      commandConsoleSourceCta: 'Connect provider',
      commandConsoleSourceDetail: 'Refresh credentials, then retry this turn.',
      uiRenderSmoke: 'npm run smoke:ui asserts authMissingCtaText through seedMissingProviderAuthCommandConsole',
      providerModalTitle: 'Connect {label}',
    },
    server: {
      port,
      sessionTokenLength: token.length,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(evidenceHasSecretMaterial(evidence), false, 'Phase K evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    'completedItems=127',
    'blockedItems=none',
    `provider=${targetProvider}`,
    `model=${targetModel}`,
    'providerConfigured=false',
    `recruitStatus=${blockedRecruit.response.status}`,
    `modelSaveStatus=${blockedModelSave.response.status}`,
    `autoForgeStatus=${blockedAutoForge.response.status}`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Missing Provider Auth Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta item covered:',
    '',
    '- 127. Complete: triggered missing-provider-auth backend paths and verified the UI explanation path.',
    '',
    'Evidence:',
    '',
    `- Provider/model: ${targetProvider} / ${targetModel}`,
    '- `/api/auth/providers?refresh=1` reported the provider unconfigured in isolated state.',
    '- `/api/party/recruit` returned 409 with "Connect this provider before recruiting with this model."',
    '- `/api/party/agent/:agentId/model` returned 409 with "Connect this provider before saving the model."',
    '- `/api/party/recruit/auto-markdown` returned 409 with "Connect this provider before using Auto Forge."',
    '- `npm run smoke:ui` now asserts the rendered Command Console `Connect provider` CTA for `auth_missing` results.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K missing-provider-auth smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

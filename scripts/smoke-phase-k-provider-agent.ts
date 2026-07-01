import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = process.cwd()
const CONTROL_TOKEN = 'phase-k-provider-agent'
const phaseKEvidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const evidenceJsonPath = path.join(phaseKEvidenceDir, 'provider-agent-smoke.json')
const evidenceMarkdownPath = path.join(phaseKEvidenceDir, 'PROVIDER_AGENT_SMOKE.md')
const evidenceLogPath = path.join(phaseKEvidenceDir, '06-provider-agent-smoke.log')
const startedAt = new Date().toISOString()

const MODEL_PROVIDER_IDS = new Set([
  'openai',
  'openai-codex',
  'anthropic',
  'opencode',
  'google',
  'google-vertex',
  'deepseek',
  'openrouter',
])

type ApiEnvelope<T = unknown> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: unknown }; requestId: string }

type ProviderStatus = {
  provider: string
  label?: string
  configured?: boolean
  mode?: string
  envKeys?: string[]
  optionalAuth?: boolean
  stored?: boolean
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
    clientIdEnvKeys?: string[]
    projectIdEnvKeys?: string[]
  }
}

type ProviderStatusesPayload = {
  providers?: ProviderStatus[]
  persistencePath?: string
}

type RecruitPayload = {
  agentId?: string
}

type PartyOverviewPayload = {
  party?: Array<{ id?: string; name?: string; workspace?: string }>
}

type AgentConfigPayload = {
  agentId?: string
  path?: string
  config?: {
    agent?: { id?: string; displayName?: string }
    identity?: { name?: string }
    routing?: { workspace?: string }
    profile?: { role?: string; behaviorProfile?: string }
  }
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

function samePath(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

function spawnServer(port: number, stateDir: string, workspaceRoot: string, homeDir: string) {
  mkdirSync(stateDir, { recursive: true })
  const configPath = path.join(stateDir, 'openclaw.json')
  if (!existsSync(configPath)) writeFileSync(configPath, '{}\n', 'utf8')
  return spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
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
    },
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
  options: { method?: string; token?: string; body?: unknown; requestId?: string } = {},
) {
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
  if (!response.ok || !payload.ok) {
    const message = payload.ok ? `HTTP ${response.status}` : `${payload.error.code}: ${payload.error.message}`
    throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${message}`)
  }
  return payload.data
}

async function login(port: number) {
  const data = await api<{ token: string }>(port, '/api/auth/login', {
    method: 'POST',
    body: { token: CONTROL_TOKEN },
    requestId: 'phase-k-provider-agent-login',
  })
  assert.match(data.token, /^[A-Za-z0-9_-]{40,}$/)
  return data.token
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

function sanitizeProviderStatus(status: ProviderStatus) {
  return {
    provider: status.provider,
    label: status.label || status.provider,
    configured: Boolean(status.configured),
    mode: status.mode || '',
    optionalAuth: Boolean(status.optionalAuth),
    stored: Boolean(status.stored),
    envKeys: status.envKeys || [],
    apiKey: {
      configured: Boolean(status.apiKey?.configured),
      stored: Boolean(status.apiKey?.stored),
      envConfigured: Boolean(status.apiKey?.envConfigured),
      configConfigured: Boolean(status.apiKey?.configConfigured),
      envKeys: status.apiKey?.envKeys || status.envKeys || [],
    },
    oauth: {
      supported: Boolean(status.oauth?.supported),
      configured: Boolean(status.oauth?.configured),
      available: Boolean(status.oauth?.available),
      missing: status.oauth?.missing || [],
      refreshAvailable: Boolean(status.oauth?.refreshAvailable),
      clientIdEnvKeys: status.oauth?.clientIdEnvKeys || [],
      projectIdEnvKeys: status.oauth?.projectIdEnvKeys || [],
    },
  }
}

function providerStatusHasSecretMaterial(value: unknown) {
  const encoded = JSON.stringify(value)
  return /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|access[_-]?token|refresh[_-]?token|api[_-]?key["']?\s*:\s*["'][^"']{8,})/i.test(encoded)
}

const port = await freePort()
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-phase-k-provider-agent-'))
const stateDir = path.join(tempRoot, 'state')
const workspaceRoot = path.join(tempRoot, 'workspace-root')
const homeDir = path.join(tempRoot, 'home')
const initialWorkspace = path.join(workspaceRoot, 'phase-k-beta-agent-initial')
const editedWorkspace = path.join(workspaceRoot, 'phase-k-beta-agent-edited')
const agentId = 'phase-k-beta-agent'
mkdirSync(initialWorkspace, { recursive: true })
mkdirSync(editedWorkspace, { recursive: true })
mkdirSync(homeDir, { recursive: true })
mkdirSync(phaseKEvidenceDir, { recursive: true })

const child = spawnServer(port, stateDir, workspaceRoot, homeDir)

try {
  const startupOutput = await waitForReady(child, port)
  const token = await login(port)
  const providerPayload = await api<ProviderStatusesPayload>(port, '/api/auth/providers', {
    token,
    requestId: 'phase-k-provider-status',
  })
  const sanitizedProviders = (providerPayload.providers || [])
    .filter((provider) => MODEL_PROVIDER_IDS.has(provider.provider))
    .map(sanitizeProviderStatus)
  assert.ok(sanitizedProviders.length > 0, 'provider status should include model providers')
  assert.equal(providerStatusHasSecretMaterial(sanitizedProviders), false, 'provider evidence must not contain credential material')

  const configuredModelProviders = sanitizedProviders.filter((provider) => provider.configured)
  const providerItemBlocked = configuredModelProviders.length === 0

  const recruit = await api<RecruitPayload>(port, '/api/party/recruit', {
    method: 'POST',
    token,
    requestId: 'phase-k-recruit-agent',
    body: {
      agentId,
      name: 'Phase K Beta Agent',
      workspace: initialWorkspace,
      emoji: '@',
      theme: 'hybrid',
      profile: {
        className: 'Beta Operator',
        role: 'Manual beta smoke agent for recruitment and workspace persistence.',
        behaviorProfile: 'hybrid',
        level: 3,
        motto: 'Verify real local control-plane paths.',
        bio: 'Created by the Phase K manual beta smoke in isolated state.',
        skills: ['local validation', 'workspace editing'],
        abilities: ['recruitment verification', 'state persistence'],
        tools: ['filesystem'],
        stats: {
          execution: 64,
          reliability: 72,
          speed: 58,
          analysis: 69,
          communication: 61,
        },
      },
      runtime: {
        thinkingDefault: 'minimal',
        timeoutSeconds: 120,
        parallelPreferred: false,
        fastModeDefault: 'auto',
      },
      attributes: {
        intelligence: 62,
        speed: 58,
        precision: 66,
        creativity: 54,
        stability: 72,
        compute: 48,
        parallelism: 35,
      },
      mds: {
        maxContextTokens: 4096,
        delegationAllowed: false,
        subAgentSpawnLimit: 0,
        toolAccess: ['filesystem'],
        capabilities: {
          codeGeneration: true,
          planning: true,
          research: false,
          orchestration: false,
          memoryManagement: true,
        },
      },
      heartbeat: {
        tickIntervalMs: 5000,
        maxExecutionTimeMs: 120000,
        continuous: false,
        idleTimeoutMs: 60000,
        recoveryMode: true,
      },
      soul: {
        personality: 'analytical',
        autonomyLevel: 40,
        riskTolerance: 20,
        reflectionDepth: 45,
        goalOrientation: 70,
        persistence: 68,
        alignmentMode: 'balanced',
      },
      sandbox: {
        mode: 'off',
        scope: 'agent',
        workspaceAccess: 'rw',
      },
      tools: {
        profile: 'minimal',
        allow: ['filesystem'],
        deny: [],
      },
    },
  })
  assert.equal(recruit.agentId, agentId)

  const workspaceUpdate = await api<{ ok?: boolean; agentId?: string; workspace?: string }>(port, '/api/party/workspace', {
    method: 'POST',
    token,
    requestId: 'phase-k-edit-agent-workspace',
    body: { agentId, workspace: editedWorkspace },
  })
  assert.equal(workspaceUpdate.ok, true)
  assert.equal(workspaceUpdate.agentId, agentId)
  assert.ok(samePath(workspaceUpdate.workspace, editedWorkspace), 'workspace update should return the edited workspace')

  const config = await api<AgentConfigPayload>(port, `/api/party/agent/${encodeURIComponent(agentId)}/config`, {
    token,
    requestId: 'phase-k-agent-config-after-edit',
  })
  assert.equal(config.agentId, agentId)
  assert.equal(config.config?.identity?.name, 'Phase K Beta Agent')
  assert.equal(config.config?.profile?.behaviorProfile, 'hybrid')
  assert.ok(samePath(config.config?.routing?.workspace, editedWorkspace), 'agent local config should persist the edited workspace')

  const overview = await api<PartyOverviewPayload>(port, '/api/party/overview', {
    token,
    requestId: 'phase-k-party-overview-after-recruit',
  })
  const recruitedAgent = (overview.party || []).find((agent) => agent.id === agentId)
  assert.ok(recruitedAgent, 'party overview should include the recruited beta agent')
  assert.ok(samePath(recruitedAgent?.workspace, editedWorkspace), 'party overview should project the edited workspace')

  const completedItems = providerItemBlocked ? [115, 116] : [114, 115, 116]
  const blockedItems = providerItemBlocked
    ? [{
        item: 114,
        reason: 'No real model provider credentials were visible to the isolated Phase K control-plane smoke.',
        checkedProviderIds: Array.from(MODEL_PROVIDER_IDS).sort(),
      }]
    : []

  const completedAt = new Date().toISOString()
  const evidence = {
    phase: 'K',
    completedItems,
    blockedItems,
    startedAt,
    completedAt,
    isolatedState: {
      stateDir,
      workspaceRoot,
      homeDir,
    },
    providerStatus: {
      modelProviderIds: Array.from(MODEL_PROVIDER_IDS).sort(),
      configuredModelProviders: configuredModelProviders.map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        mode: provider.mode,
        stored: provider.stored,
        apiKeyConfigured: provider.apiKey.configured,
        oauthConfigured: provider.oauth.configured,
      })),
      blocked: providerItemBlocked,
      localAuthPathIsIsolated: Boolean(providerPayload.persistencePath && path.resolve(providerPayload.persistencePath).startsWith(path.resolve(stateDir))),
      redactedSnapshot: sanitizedProviders,
    },
    recruit: {
      agentId,
      name: 'Phase K Beta Agent',
      initialWorkspace,
      editedWorkspace,
      route: '/api/party/recruit',
      verifiedInOverview: true,
    },
    workspaceEdit: {
      route: '/api/party/workspace',
      persistedInAgentConfig: true,
      persistedInPartyOverview: true,
    },
    server: {
      port,
      startupOutputLines: startupOutput.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    },
  }
  assert.equal(providerStatusHasSecretMaterial(evidence), false, 'Phase K evidence must not contain credential material')

  writeFileSync(evidenceJsonPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  writeFileSync(evidenceLogPath, [
    `startedAt=${startedAt}`,
    `completedAt=${completedAt}`,
    `completedItems=${completedItems.join(',')}`,
    `blockedItems=${blockedItems.map((item) => item.item).join(',') || 'none'}`,
    `configuredModelProviders=${configuredModelProviders.map((provider) => provider.provider).join(',') || 'none'}`,
    `agentId=${agentId}`,
    `workspaceEdited=true`,
    `evidenceJson=${path.relative(root, evidenceJsonPath)}`,
  ].join('\n') + '\n', 'utf8')
  writeFileSync(evidenceMarkdownPath, [
    '# Phase K Provider And Agent Smoke',
    '',
    `Started: ${startedAt}`,
    `Completed: ${completedAt}`,
    '',
    'Manual beta items covered:',
    '',
    ...(providerItemBlocked
      ? ['- 114. Blocked: no real model provider credentials were visible to the isolated control-plane smoke.']
      : ['- 114. Complete: at least one real model provider was configured in the isolated control-plane environment.']),
    '- 115. Recruited one new test agent.',
    '- 116. Edited the recruited agent workspace and verified persistence.',
    '',
    'Evidence:',
    '',
    `- Configured model providers: ${configuredModelProviders.map((provider) => provider.provider).join(', ') || 'none'}`,
    `- Recruited agent: ${agentId}`,
    '- Provider status evidence stores env key names and boolean readiness only; credential material is not written.',
    `- Evidence JSON: ${path.relative(root, evidenceJsonPath)}`,
    `- Evidence log: ${path.relative(root, evidenceLogPath)}`,
    '',
  ].join('\n'), 'utf8')

  console.log(`Phase K provider/agent smoke ok: ${evidenceJsonPath}`)
} finally {
  await stopProcess(child)
  rmSync(tempRoot, { recursive: true, force: true })
}

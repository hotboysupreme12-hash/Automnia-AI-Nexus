import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createProviderAuthService,
  type ProviderAuthOpenClawConfig,
} from '../server/services/providers/providerAuthService'
import { AUTH_ENV_MAP, AUTH_PROVIDER_CATALOG } from '../server/catalogs/providerCatalog'
import {
  canonicalAgentModelId,
  isOpenAiCodexSubscriptionModel,
} from '../server/services/providers/modelCatalogService'

type HarnessOptions = {
  authEnvMap?: Record<string, string[]>
  authProviderCatalog?: typeof AUTH_PROVIDER_CATALOG
  config?: ProviderAuthOpenClawConfig
  configuredProviderApiKeyMarker?: (provider: string) => string
  googleOAuthClientStatus?: { available: boolean; missing: string[] }
  googleVertexGcloudStatus?: (options?: { probeGcloud?: boolean }) => unknown
  isGoogleVertexConfigured?: (options?: { probeGcloud?: boolean }) => boolean
  isGoogleVertexLocalOAuthConfigured?: (env?: Record<string, string>, options?: { probeGcloud?: boolean }) => boolean
  stateStore?: Record<string, unknown>
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as T
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

async function createHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-auth-service-'))
  const homeDir = path.join(root, 'home')
  const stateRoot = path.join(root, 'state')
  const localAuthPath = path.join(stateRoot, 'local-auth.json')
  const agentsRoot = path.join(stateRoot, 'agents')
  const stateStore = { ...(options.stateStore || {}) }
  const state = {
    config: options.config || { agents: { list: [] }, plugins: { entries: {} } },
    invalidations: 0,
    bundledProviderPluginCalls: [] as string[],
    openRouterAllowlistCalls: 0,
    openRouterPluginCalls: 0,
    writes: [] as unknown[],
  }

  const service = createProviderAuthService({
    authEnvMap: options.authEnvMap || AUTH_ENV_MAP,
    authProviderCatalog: options.authProviderCatalog || AUTH_PROVIDER_CATALOG,
    canonicalAgentModelId,
    configuredProviderApiKeyMarker: options.configuredProviderApiKeyMarker || (() => ''),
    createInitialOpenclawConfig: () => ({ agents: { list: [] }, plugins: { entries: {} } }),
    ensureBundledProviderPluginEnabledForProviderAuth: (config, pluginId) => {
      state.bundledProviderPluginCalls.push(pluginId)
      config.plugins ||= {}
      config.plugins.entries ||= {}
      config.plugins.entries[pluginId] = { enabled: true }
    },
    ensureOpenRouterModelCatalogAllowlist: (config) => {
      state.openRouterAllowlistCalls += 1
      config.agents ||= {}
      config.agents.list ||= []
    },
    ensureOpenRouterPluginEnabledForProviderAuth: (config) => {
      state.openRouterPluginCalls += 1
      config.plugins ||= {}
      config.plugins.entries ||= {}
      config.plugins.entries.openrouter = { enabled: true }
    },
    googleOAuthClientConfigStatus: () => options.googleOAuthClientStatus || ({ available: true, missing: [] }),
    googleVertexGcloudStatus: options.googleVertexGcloudStatus || (() => ({ supported: true, configured: false, missing: ['not configured'] })),
    homeDir,
    invalidateAvailableModelsForAuthChange: () => {
      state.invalidations += 1
    },
    isGoogleVertexConfigured: options.isGoogleVertexConfigured || (() => false),
    isGoogleVertexLocalOAuthConfigured: options.isGoogleVertexLocalOAuthConfigured || (() => false),
    isOpenAiCodexSubscriptionModel,
    isValidAgentId: (agentId) => Boolean(agentId && /^[a-z0-9-]+$/i.test(agentId)),
    localAuthPath,
    localAuthStateKey: 'localAuth',
    openclawAgentFolder: (agentId) => path.join(agentsRoot, agentId, 'agent'),
    readAgentLocalConfigIfPresent: async () => null,
    readControlCenterStateRecord: <T>(stateKey: string) => (stateStore[stateKey] as T | undefined) || null,
    readOpenclawConfig: async () => state.config,
    resolveGoogleProjectId: () => '',
    writeControlCenterStateRecord: (stateKey, value) => {
      stateStore[stateKey] = value
      return true
    },
    writeOpenclawConfig: async (config) => {
      state.config = config as ProviderAuthOpenClawConfig
      state.writes.push(config)
    },
    writePrivateJsonFileAtomically: writeJson,
    writePrivateTextFileAtomically: async (filePath, content) => {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, content, 'utf-8')
    },
  })

  return {
    agentsRoot,
    cleanup: () => rm(root, { recursive: true, force: true }),
    homeDir,
    localAuthPath,
    service,
    state,
    stateStore,
  }
}

test('persists API keys to local auth and agent auth profiles without exposing key material in status', async () => {
  const harness = await createHarness({
    config: { agents: { list: [{ id: 'worker-one' }] }, plugins: { entries: {} } },
  })
  try {
    await harness.service.persistProviderAuth('deepseek', 'sk-deepseek-secret')

    assert.equal(harness.state.invalidations, 1)
    assert.equal(harness.service.getLocalAuthEnv().DEEPSEEK_API_KEY, 'sk-deepseek-secret')

    const mainProfile = await readJson<{
      profiles: Record<string, { type: string; provider: string; key?: string }>
      order: Record<string, string[]>
      lastGood: Record<string, string>
    }>(path.join(harness.agentsRoot, 'main', 'agent', 'auth-profiles.json'))
    const workerProfile = await readJson<typeof mainProfile>(path.join(harness.agentsRoot, 'worker-one', 'agent', 'auth-profiles.json'))

    assert.equal(mainProfile.profiles['deepseek:default'].key, 'sk-deepseek-secret')
    assert.equal(workerProfile.profiles['deepseek:default'].key, 'sk-deepseek-secret')
    assert.deepEqual(mainProfile.order.deepseek, ['deepseek:default'])
    assert.equal(mainProfile.lastGood.deepseek, 'deepseek:default')

    const status = harness.service.providerAuthStatus('deepseek')
    const encodedStatus = JSON.stringify(status)
    assert.equal(status.configured, true)
    assert.equal(status.stored, true)
    assert.doesNotMatch(encodedStatus, /sk-deepseek-secret/)
  } finally {
    await harness.cleanup()
  }
})

test('persists OpenAI Codex OAuth into OpenAI-compatible auth profile and removes legacy records', async () => {
  const harness = await createHarness()
  try {
    const authPath = path.join(harness.agentsRoot, 'main', 'agent', 'auth-profiles.json')
    await writeJson(authPath, {
      version: 1,
      profiles: {
        'openai-codex:legacy': { type: 'oauth', provider: 'openai-codex', access: 'legacy-access' },
      },
      order: { 'openai-codex': ['openai-codex:legacy'] },
      lastGood: { 'openai-codex': 'openai-codex:legacy' },
    })

    await harness.service.persistProviderOAuth('openai', {
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: 1782826384447,
      accountId: 'acct_123',
    })

    const profile = await readJson<{
      profiles: Record<string, { type: string; provider: string; access?: string; refresh?: string; accountId?: string }>
      order: Record<string, string[]>
      lastGood: Record<string, string>
    }>(authPath)

    assert.equal(profile.profiles['openai-codex:legacy'], undefined)
    assert.equal(profile.profiles['openai:chatgpt-default'].provider, 'openai')
    assert.equal(profile.profiles['openai:chatgpt-default'].access, 'codex-access-token')
    assert.equal(profile.profiles['openai:chatgpt-default'].refresh, 'codex-refresh-token')
    assert.equal(profile.profiles['openai:chatgpt-default'].accountId, 'acct_123')
    assert.deepEqual(profile.order.openai, ['openai:chatgpt-default'])
    assert.equal(profile.lastGood.openai, 'openai:chatgpt-default')

    const status = harness.service.providerAuthStatus('openai')
    assert.equal(status.oauth.configured, true)
    assert.equal(status.oauth.accountId, 'acct_123')
    assert.equal(status.oauth.refreshAvailable, true)
    assert.doesNotMatch(JSON.stringify(status), /codex-access-token|codex-refresh-token/)
  } finally {
    await harness.cleanup()
  }
})

test('removes provider credentials from local auth and propagated auth profiles', async () => {
  const harness = await createHarness({
    config: { agents: { list: [{ id: 'worker-one' }] }, plugins: { entries: {} } },
  })
  try {
    await harness.service.persistProviderAuth('deepseek', 'sk-deepseek-secret')
    await harness.service.removeProviderAuth('deepseek')

    assert.equal(harness.service.getLocalAuthEnv().DEEPSEEK_API_KEY, undefined)
    assert.equal(harness.state.invalidations, 2)

    const mainProfile = await readJson<{
      profiles: Record<string, unknown>
      order: Record<string, string[]>
      lastGood: Record<string, string>
    }>(path.join(harness.agentsRoot, 'main', 'agent', 'auth-profiles.json'))
    assert.equal(mainProfile.profiles['deepseek:default'], undefined)
    assert.deepEqual(mainProfile.order.deepseek, [])
    assert.equal(mainProfile.lastGood.deepseek, undefined)

    const status = harness.service.providerAuthStatus('deepseek')
    assert.equal(status.configured, false)
    assert.equal(status.stored, false)
  } finally {
    await harness.cleanup()
  }
})

test('reports missing credential states for API-key, OAuth, and Vertex providers without leaking credential markers', async () => {
  const authEnvMap = {
    ...AUTH_ENV_MAP,
    anthropic: ['AUTOMNIA_TEST_MISSING_ANTHROPIC_API_KEY'],
    deepseek: ['AUTOMNIA_TEST_MISSING_DEEPSEEK_API_KEY'],
    google: ['AUTOMNIA_TEST_MISSING_GOOGLE_API_KEY'],
  }
  const harness = await createHarness({
    authEnvMap,
    configuredProviderApiKeyMarker: (provider) =>
      provider === 'deepseek' ? 'SecretRef:sk-deepseek-should-not-leak' : '',
    googleOAuthClientStatus: {
      available: false,
      missing: ['Set AUTOMNIA_GOOGLE_OAUTH_CLIENT_ID', 'Set AUTOMNIA_GOOGLE_OAUTH_CLIENT_SECRET'],
    },
    googleVertexGcloudStatus: () => ({
      supported: true,
      installed: false,
      authenticated: false,
      configured: false,
      projectId: '',
      missing: [
        'Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install',
        'Set a Google Cloud project with gcloud config set project YOUR_PROJECT_ID.',
      ],
    }),
  })
  try {
    const anthropicStatus = harness.service.providerAuthStatus('anthropic')
    assert.equal(anthropicStatus.configured, false)
    assert.equal(anthropicStatus.stored, false)
    assert.equal(anthropicStatus.apiKey.configured, false)
    assert.equal(anthropicStatus.oauth.supported, true)
    assert.equal(anthropicStatus.oauth.available, true)

    const deepSeekStatus = harness.service.providerAuthStatus('deepseek')
    assert.equal(deepSeekStatus.configured, true)
    assert.equal(deepSeekStatus.stored, false)
    assert.equal(deepSeekStatus.apiKey.configConfigured, true)
    assert.doesNotMatch(JSON.stringify(deepSeekStatus), /sk-deepseek-should-not-leak|SecretRef/)

    const googleStatus = harness.service.providerAuthStatus('google')
    assert.equal(googleStatus.configured, false)
    assert.equal(googleStatus.apiKey.configured, false)
    assert.equal(googleStatus.oauth.supported, true)
    assert.equal(googleStatus.oauth.available, false)
    assert.deepEqual(googleStatus.oauth.missing, [
      'Set AUTOMNIA_GOOGLE_OAUTH_CLIENT_ID',
      'Set AUTOMNIA_GOOGLE_OAUTH_CLIENT_SECRET',
    ])

    const vertexStatus = harness.service.providerAuthStatus('google-vertex')
    assert.equal(vertexStatus.configured, false)
    assert.equal(vertexStatus.stored, false)
    assert.equal(vertexStatus.gcloud.configured, false)
    assert.ok(vertexStatus.gcloud.missing.some((entry: string) => entry.includes('Install Google Cloud CLI')))
  } finally {
    await harness.cleanup()
  }
})

test('exposes one shared Google OAuth connection for Vertex while requiring a project for readiness', async () => {
  const harness = await createHarness({
    googleVertexGcloudStatus: () => ({
      supported: true,
      installed: false,
      authenticated: true,
      configured: false,
      missing: ['Set a Google Cloud project.'],
    }),
    isGoogleVertexLocalOAuthConfigured: (_env, options) => options?.probeGcloud !== true,
  })
  try {
    await harness.service.persistProviderOAuth('google', {
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      email: 'operator@example.test',
      projectId: 'vertex-project',
      expiresAt: Date.now() + 3_600_000,
    })

    const vertexStatus = harness.service.providerAuthStatus('google-vertex')
    assert.equal(vertexStatus.oauth.supported, true)
    assert.equal(vertexStatus.oauth.configured, true)
    assert.equal(vertexStatus.oauth.email, 'operator@example.test')
    assert.equal(vertexStatus.oauth.projectId, 'vertex-project')
    assert.equal(vertexStatus.configured, true)
    assert.doesNotMatch(JSON.stringify(vertexStatus), /google-access-token|google-refresh-token/)
  } finally {
    await harness.cleanup()
  }
})

test('updates the Google OAuth Vertex project without requiring another sign-in', async () => {
  const harness = await createHarness()
  try {
    await harness.service.persistProviderOAuth('google', {
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      projectId: 'old-project',
    })

    await harness.service.updateProviderOAuthSettings('google-vertex', { projectId: 'new-project' })

    const status = harness.service.providerAuthStatus('google')
    assert.equal(status.oauth.projectId, 'new-project')
    assert.equal(status.oauth.configured, true)
    assert.doesNotMatch(JSON.stringify(status), /google-access-token|google-refresh-token/)
  } finally {
    await harness.cleanup()
  }
})

test('openrouter saves enable plugin/catalog repair and missing Codex models report connect-provider status', async () => {
  const harness = await createHarness()
  try {
    const missingCodex = harness.service.modelAuthProblem('openai/gpt-5.3-codex-spark')
    assert.equal(missingCodex?.provider, 'openai')
    assert.equal(missingCodex?.providerStatus.oauth.supported, true)

    await harness.service.persistProviderAuth('openrouter', 'sk-openrouter-secret')

    assert.equal(harness.state.openRouterPluginCalls, 1)
    assert.equal(harness.state.openRouterAllowlistCalls, 1)
    assert.equal(harness.state.writes.length, 1)
    assert.equal(harness.state.config.plugins?.entries?.openrouter?.enabled, true)
    assert.equal(harness.service.isProviderConfigured('openrouter'), true)
  } finally {
    await harness.cleanup()
  }
})

test('meta saves enable the bundled provider plugin before model use', async () => {
  const harness = await createHarness()
  try {
    await harness.service.persistProviderAuth('meta', 'meta-api-secret')

    assert.deepEqual(harness.state.bundledProviderPluginCalls, ['meta'])
    assert.equal(harness.state.writes.length, 1)
    assert.equal(harness.state.config.plugins?.entries?.meta?.enabled, true)
    assert.equal(harness.service.isProviderConfigured('meta'), true)
  } finally {
    await harness.cleanup()
  }
})

test('blocks unconfigured model providers while allowing configured and optional-auth selections', async () => {
  const authEnvMap = {
    ...AUTH_ENV_MAP,
    deepseek: ['AUTOMNIA_TEST_MISSING_DEEPSEEK_API_KEY'],
    openai: ['AUTOMNIA_TEST_MISSING_OPENAI_API_KEY'],
  }
  const harness = await createHarness({ authEnvMap })
  try {
    const missingDeepSeek = harness.service.modelAuthProblem('deepseek/deepseek-v4-pro')
    assert.equal(missingDeepSeek?.provider, 'deepseek')
    assert.equal(missingDeepSeek?.providerStatus.configured, false)
    assert.equal(missingDeepSeek?.providerStatus.apiKey.configured, false)

    const optionalLocalModel = harness.service.modelAuthProblem('ollama/llama3.2')
    assert.equal(optionalLocalModel, null)

    await harness.service.persistProviderAuth('deepseek', 'sk-deepseek-secret')
    assert.equal(harness.service.modelAuthProblem('deepseek/deepseek-v4-pro'), null)

    const missingCodex = harness.service.modelAuthProblem('openai/gpt-5.3-codex-spark')
    assert.equal(missingCodex?.provider, 'openai')

    await harness.service.persistProviderAuth('openai', 'sk-openai-secret')
    assert.equal(harness.service.modelAuthProblem('openai/gpt-5.3-codex-spark'), null)
  } finally {
    await harness.cleanup()
  }
})

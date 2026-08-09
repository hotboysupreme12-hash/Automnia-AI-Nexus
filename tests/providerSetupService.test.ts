import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createProviderSetupService,
  GOOGLE_VERTEX_ACCESS_TOKEN_KEYS,
  type ProviderSetupServiceOptions,
} from '../server/services/providers/providerSetupService'
import type { LocalOAuthCredential } from '../server/services/providers/providerAuthService'

type HarnessOptions = {
  existsSync?: ProviderSetupServiceOptions['existsSync']
  fetch?: ProviderSetupServiceOptions['fetch']
  importModule?: ProviderSetupServiceOptions['importModule']
  localOAuth?: Record<string, LocalOAuthCredential | undefined>
  modes?: Record<string, 'oauth' | 'apiKey' | undefined>
  now?: number
  platform?: NodeJS.Platform
  processEnv?: NodeJS.ProcessEnv
  spawnSync?: ProviderSetupServiceOptions['spawnSync']
}

async function createHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-setup-service-'))
  const workspaceRoot = path.join(root, 'workspace')
  const openClawStateRoot = path.join(root, 'state')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(openClawStateRoot, { recursive: true })
  const state = {
    ensureCalls: 0,
    localOAuth: { ...(options.localOAuth || {}) },
    modes: { ...(options.modes || {}) },
    persisted: [] as Array<{ provider: 'google' | 'openai'; oauth: LocalOAuthCredential }>,
  }

  const service = createProviderSetupService({
    ensureLocalAuthStoreLoaded: async () => {
      state.ensureCalls += 1
    },
    existsSync: options.existsSync,
    fetch: options.fetch,
    getLocalProviderMode: (provider) => state.modes[provider],
    getLocalProviderOAuth: (provider) => state.localOAuth[provider],
    googleOAuthClientIdKeys: ['DYSTOPAI_GOOGLE_OAUTH_CLIENT_ID'],
    googleOAuthClientSecretKeys: ['DYSTOPAI_GOOGLE_OAUTH_CLIENT_SECRET'],
    googleProjectIdKeys: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT'],
    importModule: options.importModule,
    localOAuthFromMainAuthProfile: () => null,
    now: () => options.now ?? 1_782_829_500_000,
    openClawBin: 'openclaw',
    openClawStateRoot,
    platform: options.platform,
    persistProviderOAuth: async (provider, oauth) => {
      state.localOAuth[provider] = oauth
      state.persisted.push({ provider, oauth })
    },
    processEnv: options.processEnv || {},
    refreshGoogleOAuthCredential: async (oauth) => ({
      ...oauth,
      accessToken: 'google-refreshed-access',
      expiresAt: (options.now ?? 1_782_829_500_000) + 3_600_000,
    }),
    refreshOpenAICodexOAuthCredential: async (oauth) => ({
      ...oauth,
      accessToken: 'codex-refreshed-access',
      expiresAt: (options.now ?? 1_782_829_500_000) + 3_600_000,
    }),
    spawnSync: options.spawnSync,
    workspaceRoot,
  })

  return {
    cleanup: () => rm(root, { recursive: true, force: true }),
    openClawStateRoot,
    service,
    state,
    workspaceRoot,
  }
}

test('resolves Google OAuth client setup from env and client_secret files', async () => {
  const envHarness = await createHarness({
    processEnv: {
      DYSTOPAI_GOOGLE_OAUTH_CLIENT_ID: 'env-client-id',
      DYSTOPAI_GOOGLE_OAUTH_CLIENT_SECRET: 'env-client-secret',
    },
  })
  try {
    assert.deepEqual(envHarness.service.resolveGoogleOAuthClientConfig(), {
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
    })
    const status = envHarness.service.googleOAuthClientConfigStatus()
    assert.equal(status.available, true)
    assert.doesNotMatch(JSON.stringify(status), /env-client-secret/)
  } finally {
    await envHarness.cleanup()
  }

  const fileHarness = await createHarness()
  try {
    await writeFile(
      path.join(fileHarness.workspaceRoot, 'client_secret.json'),
      JSON.stringify({ installed: { client_id: 'file-client-id', client_secret: 'file-client-secret' } }),
      'utf-8',
    )

    assert.deepEqual(fileHarness.service.resolveGoogleOAuthClientConfig(), {
      clientId: 'file-client-id',
      clientSecret: 'file-client-secret',
    })
  } finally {
    await fileHarness.cleanup()
  }
})

test('reports fast Google Vertex readiness from local OAuth without probing gcloud', async () => {
  const harness = await createHarness({
    localOAuth: {
      google: {
        accessToken: 'google-local-access',
        email: 'operator@example.test',
        expiresAt: 1_782_829_900_000,
        projectId: 'project-local',
      },
    },
    processEnv: {
      GOOGLE_CLOUD_PROJECT: 'project-env',
    },
  })
  try {
    const status = harness.service.googleVertexGcloudStatus({ probeGcloud: false })
    assert.equal(status.configured, true)
    assert.equal(status.authenticated, true)
    assert.equal(status.projectId, 'project-env')
    assert.equal(status.account, 'operator@example.test')
    assert.equal(status.source, 'fast')
    assert.deepEqual(status.missing, [])

    assert.deepEqual(harness.service.getGoogleVertexProcessEnv({ GOOGLE_CLOUD_PROJECT: 'project-env' }), {
      GCLOUD_PROJECT: 'project-env',
      GOOGLE_CLOUD_LOCATION: 'global',
      GOOGLE_VERTEX_ACCESS_TOKEN: 'google-local-access',
      GCLOUD_ACCESS_TOKEN: 'google-local-access',
    })
  } finally {
    await harness.cleanup()
  }
})

test('probes gcloud for Google Vertex project, account, and access token readiness while preferring ADC', async () => {
  const calls: string[][] = []
  const spawnSync: NonNullable<ProviderSetupServiceOptions['spawnSync']> = (_command, args) => {
    calls.push([...args])
    const key = args.join(' ')
    if (key === 'config get-value project --quiet') return { status: 0, stdout: 'project-probed\n', stderr: '' }
    if (key === '--version') return { status: 0, stdout: 'Google Cloud SDK 999.0.0\n', stderr: '' }
    if (key === 'auth list --filter=status:ACTIVE --format=value(account) --quiet') return { status: 0, stdout: 'operator@example.test\n', stderr: '' }
    if (key === 'auth application-default print-access-token --quiet') return { status: 0, stdout: 'ya29.adc-token\n', stderr: '' }
    if (key === 'auth print-access-token --quiet') return { status: 0, stdout: 'ya29.gcloud-token\n', stderr: '' }
    return { status: 1, stdout: '', stderr: 'unexpected gcloud command' }
  }
  const harness = await createHarness({ platform: 'linux', spawnSync })
  try {
    const status = harness.service.googleVertexGcloudStatus({ probeGcloud: true })

    assert.equal(status.installed, true)
    assert.equal(status.authenticated, true)
    assert.equal(status.configured, true)
    assert.equal(status.projectId, 'project-probed')
    assert.equal(status.account, 'operator@example.test')
    assert.equal(status.credentialSource, 'application-default')
    assert.equal(status.source, 'probe')
    assert.deepEqual(status.missing, [])
    assert.ok(calls.some((args) => args.join(' ') === 'auth application-default print-access-token --quiet'))
    assert.ok(!calls.some((args) => args.join(' ') === 'auth print-access-token --quiet'))
  } finally {
    await harness.cleanup()
  }
})

test('falls back to regular gcloud login when ADC is unavailable', async () => {
  const spawnSync: NonNullable<ProviderSetupServiceOptions['spawnSync']> = (_command, args) => {
    const key = args.join(' ')
    if (key === 'config get-value project --quiet') return { status: 0, stdout: 'project-probed\n', stderr: '' }
    if (key === '--version') return { status: 0, stdout: 'Google Cloud SDK 999.0.0\n', stderr: '' }
    if (key === 'auth application-default print-access-token --quiet') return { status: 1, stdout: '', stderr: 'ADC unavailable' }
    if (key === 'auth print-access-token --quiet') return { status: 0, stdout: 'ya29.gcloud-token\n', stderr: '' }
    return { status: 1, stdout: '', stderr: 'unexpected gcloud command' }
  }
  const harness = await createHarness({ platform: 'linux', spawnSync })
  try {
    const auth = await harness.service.resolveGoogleVertexRequestAuth({})
    assert.deepEqual(auth, {
      type: 'oauth',
      accessToken: 'ya29.gcloud-token',
      projectId: 'project-probed',
      location: 'global',
      source: 'gcloud',
    })
  } finally {
    await harness.cleanup()
  }
})

test('uses Google ADC setup scripts and discovers their Cloud SDK path across desktop platforms', async () => {
  const macSdk = '/Users/operator/google-cloud-sdk/bin/gcloud'
  const macCommands: string[] = []
  const macHarness = await createHarness({
    platform: 'darwin',
    processEnv: { HOME: '/Users/operator' },
    existsSync: (filePath) => filePath === macSdk,
    spawnSync: (command, args) => {
      macCommands.push(command)
      if (command === 'gcloud') return { status: 1, stdout: '', stderr: 'ENOENT' }
      const key = args.join(' ')
      if (key === 'config get-value project --quiet') return { status: 0, stdout: 'project-mac\n', stderr: '' }
      if (key === '--version') return { status: 0, stdout: 'Google Cloud SDK 999.0.0\n', stderr: '' }
      if (key === 'auth list --filter=status:ACTIVE --format=value(account) --quiet') return { status: 0, stdout: 'operator@example.test\n', stderr: '' }
      if (key === 'auth application-default print-access-token --quiet') return { status: 0, stdout: 'ya29.adc-token\n', stderr: '' }
      return { status: 1, stdout: '', stderr: 'unexpected gcloud command' }
    },
  })
  try {
    const status = macHarness.service.googleVertexGcloudStatus({ probeGcloud: true })
    assert.equal(status.installed, true)
    assert.equal(status.projectId, 'project-mac')
    assert.deepEqual(status.setupScript, {
      label: 'macOS Terminal',
      command: 'bash <(curl -sSL https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh)',
    })
    assert.ok(macCommands.includes(macSdk))
  } finally {
    await macHarness.cleanup()
  }

  const windowsHarness = await createHarness({ platform: 'win32' })
  try {
    assert.deepEqual(windowsHarness.service.googleVertexSetupScript(), {
      label: 'Windows PowerShell',
      command: 'powershell -c "iex (irm https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.ps1)"',
    })
  } finally {
    await windowsHarness.cleanup()
  }
})

test('uses authorized-user ADC directly without waiting for the gcloud token command', async () => {
  const processEnv: NodeJS.ProcessEnv = {}
  const requests: Array<{ url: string; body: string }> = []
  const harness = await createHarness({
    processEnv,
    fetch: async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body || '') })
      return new Response(JSON.stringify({ access_token: 'ya29.refreshed-adc-token' }), { status: 200 })
    },
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'gcloud must not be called for direct ADC refresh' }),
  })
  try {
    const adcPath = path.join(harness.workspaceRoot, 'application_default_credentials.json')
    await writeFile(adcPath, JSON.stringify({
      type: 'authorized_user',
      client_id: 'adc-client-id',
      client_secret: 'adc-client-secret',
      refresh_token: 'adc-refresh-token',
      quota_project_id: 'project-adc',
    }), 'utf-8')
    processEnv.GOOGLE_APPLICATION_CREDENTIALS = adcPath

    const auth = await harness.service.resolveGoogleVertexRequestAuth({})
    assert.deepEqual(auth, {
      type: 'oauth',
      accessToken: 'ya29.refreshed-adc-token',
      projectId: 'project-adc',
      location: 'global',
      source: 'application-default',
    })
    assert.deepEqual(requests, [{
      url: 'https://oauth2.googleapis.com/token',
      body: 'client_id=adc-client-id&client_secret=adc-client-secret&refresh_token=adc-refresh-token&grant_type=refresh_token',
    }])
  } finally {
    await harness.cleanup()
  }
})

test('resolves provider request auth through env keys and refreshed OAuth credentials', async () => {
  const harness = await createHarness({
    localOAuth: {
      google: { refreshToken: 'google-refresh-secret', expiresAt: 1 },
      openai: { refreshToken: 'codex-refresh-secret', expiresAt: 1 },
    },
    modes: { google: 'oauth', openai: 'oauth' },
  })
  try {
    const vertexAuth = await harness.service.resolveProviderRequestAuth(
      'google-vertex',
      { GOOGLE_VERTEX_ACCESS_TOKEN: 'vertex-env-token', GOOGLE_CLOUD_PROJECT: 'project-env' },
      GOOGLE_VERTEX_ACCESS_TOKEN_KEYS,
    )
    assert.deepEqual(vertexAuth, {
      type: 'oauth',
      accessToken: 'vertex-env-token',
      projectId: 'project-env',
      location: 'global',
      source: 'env-token',
    })

    const googleAuth = await harness.service.resolveProviderRequestAuth('google', {}, [])
    assert.deepEqual(googleAuth, {
      type: 'oauth',
      accessToken: 'google-refreshed-access',
      source: 'local-oauth',
    })

    const codexAuth = await harness.service.resolveProviderRequestAuth('openai', {}, [])
    assert.deepEqual(codexAuth, {
      type: 'oauth',
      accessToken: 'codex-refreshed-access',
      source: 'local-oauth',
    })
    assert.deepEqual(harness.state.persisted.map((entry) => entry.provider), ['google', 'openai'])
    assert.equal(harness.state.ensureCalls, 3)
  } finally {
    await harness.cleanup()
  }
})

test('loads OpenAI Codex OAuth runtime helpers from explicit and minified exports', async () => {
  const moduleUrls: string[] = []
  const harness = await createHarness({
    importModule: async (moduleUrl) => {
      moduleUrls.push(moduleUrl)
      return {
        t: async () => ({ access: 'unused-access', refresh: 'unused-refresh', expires: 1 }),
        r: async (refreshToken: string) => ({
          access: `access-for-${refreshToken}`,
          refresh: `refresh-for-${refreshToken}`,
          expires: 1_782_829_900_000,
          accountId: 'acct_refreshed',
        }),
        i: {
          createAuthorizationFlow: async (originator?: string) => ({
            verifier: 'verifier',
            redirectUri: 'http://127.0.0.1:1455/auth/callback',
            state: originator || 'state',
            url: `https://auth.openai.test/${originator || 'state'}`,
          }),
          exchangeAuthorizationCode: async (code: string, verifier: string, redirectUri?: string) => ({
            type: 'success',
            access: `access-${code}-${verifier}`,
            refresh: `refresh-${redirectUri || 'default'}`,
            expires: 1_782_829_900_000,
          }),
        },
      }
    },
  })
  try {
    const flow = await harness.service.createOpenAICodexAuthorizationFlow('dystopai')
    assert.equal(flow.state, 'dystopai')
    assert.equal(flow.verifier, 'verifier')

    const exchanged = await harness.service.exchangeOpenAICodexAuthorizationCode('manual-code', 'verifier', 'http://callback.test')
    assert.deepEqual(exchanged, {
      type: 'success',
      access: 'access-manual-code-verifier',
      refresh: 'refresh-http://callback.test',
      expires: 1_782_829_900_000,
    })

    const refreshed = await harness.service.refreshOpenAICodexToken('codex-refresh')
    assert.equal(refreshed.access, 'access-for-codex-refresh')
    assert.equal(refreshed.accountId, 'acct_refreshed')
    assert.ok(moduleUrls.every((moduleUrl) => moduleUrl.endsWith('/openai-chatgpt-oauth-flow.runtime.js')))
  } finally {
    await harness.cleanup()
  }
})

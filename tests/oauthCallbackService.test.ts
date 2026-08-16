import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  createOAuthCallbackService,
  type OAuthCallbackServiceOptions,
  type OAuthProvider,
} from '../server/services/providers/oauthCallbackService'
import type { LocalOAuthCredential } from '../server/services/providers/providerAuthService'

type HarnessState = {
  openUrls: string[]
  persisted: Array<{ provider: OAuthProvider; oauth: LocalOAuthCredential }>
  shuttingDown: boolean
}

function makeJwt(accountId: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url')
  return `${header}.${payload}.signature`
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getCallback(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf-8'),
      }))
    })
    req.on('error', reject)
  })
}

function createHarness(overrides: Partial<OAuthCallbackServiceOptions> = {}) {
  const state: HarnessState = {
    openUrls: [],
    persisted: [],
    shuttingDown: false,
  }
  const service = createOAuthCallbackService({
    createOpenAICodexAuthorizationFlow: async () => ({
      verifier: 'codex-verifier',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      state: 'codex-state',
      url: 'https://auth.openai.test/oauth?state=codex-state',
    }),
    exchangeGoogleOAuthCodeForTokens: async (code, verifier, projectId) => {
      assert.equal(code, 'google-code-secret')
      assert.ok(verifier)
      return {
        accessToken: 'google-access-secret',
        refreshToken: 'google-refresh-secret',
        email: 'operator@example.test',
        expiresAt: 1782826384447,
        projectId,
      }
    },
    exchangeOpenAICodexAuthorizationCode: async (code, verifier, redirectUri) => {
      assert.equal(verifier, 'codex-verifier')
      assert.equal(redirectUri, 'http://127.0.0.1:1455/auth/callback')
      return {
        type: 'success',
        access: makeJwt(`acct_${code}`),
        refresh: 'codex-refresh-secret',
        expires: 1782826384447,
      }
    },
    googleCallbackPort: 0,
    googleOAuthRedirectUri: 'http://127.0.0.1:8085/oauth2callback',
    googleOAuthScopes: ['openid', 'email'],
    isShuttingDown: () => state.shuttingDown,
    openAiCodexCallbackPort: 0,
    openAiCodexOAuthRedirectUri: 'http://127.0.0.1:1455/auth/callback',
    openAiCodexOAuthScopes: ['openid', 'email', 'offline_access'],
    openExternalAuthUrl: async (url) => {
      state.openUrls.push(url)
      return { ok: true, detail: 'opened' }
    },
    persistProviderOAuth: async (provider, oauth) => {
      state.persisted.push({ provider, oauth })
    },
    redactSensitiveText: (value) =>
      value.replace(/google-code-secret|google-access-secret|google-refresh-secret|codex-refresh-secret|leaked-secret/g, '[redacted]'),
    refreshOpenAICodexToken: async () => ({
      access: makeJwt('acct_refreshed'),
      refresh: 'codex-refresh-secret',
      expires: 1782826384447,
    }),
    resolveGoogleOAuthClientConfig: () => ({ clientId: 'google-client-id', clientSecret: 'google-client-secret' }),
    resolveGoogleProjectId: (input) => input?.trim() || 'env-project',
    sessionTimeoutMs: 5000,
    ...overrides,
  })
  return { service, state }
}

test('completes Google OAuth through a loopback-only callback listener without exposing tokens in the session', async () => {
  const { service, state } = createHarness()
  try {
    const { session, launched } = await service.startGoogleOAuthSession('project-alpha')
    assert.equal(launched.ok, true)
    assert.equal(state.openUrls.length, 1)
    assert.match(state.openUrls[0], /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)

    const snapshot = service.callbackServerSnapshot()
    assert.equal(snapshot.google.address, '127.0.0.1')
    assert.ok(snapshot.google.port)

    const response = await getCallback(
      snapshot.google.port!,
      `/oauth2callback?state=${encodeURIComponent(session.state || '')}&code=google-code-secret`,
    )
    assert.equal(response.statusCode, 200)
    assert.equal(session.status, 'complete')
    assert.deepEqual(session.result, {
      email: 'operator@example.test',
      projectId: 'project-alpha',
      expiresAt: 1782826384447,
    })
    assert.equal(state.persisted[0].provider, 'google')
    assert.equal(state.persisted[0].oauth.accessToken, 'google-access-secret')
    assert.doesNotMatch(JSON.stringify(session), /google-access-secret|google-refresh-secret/)
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('opens a minimal Google account OAuth flow and verifies the subscriber before storing provider credentials', async () => {
  const { service, state } = createHarness({
    authenticateGoogleAccount: async (accessToken) => {
      assert.equal(accessToken, 'google-access-secret')
      return {
        account: {
          accountId: 'acct-subscriber',
          email: 'operator@example.test',
          hasPassword: true,
          googleLinked: true,
        },
      }
    },
    googleAccountOAuthScopes: ['openid', 'email', 'profile'],
  })
  try {
    const { session, launched } = await service.startGoogleAccountOAuthSession()
    assert.equal(launched.ok, true)
    assert.deepEqual(new URL(state.openUrls[0]).searchParams.get('scope')?.split(' '), ['openid', 'email', 'profile'])

    const snapshot = service.callbackServerSnapshot()
    const response = await getCallback(
      snapshot.google.port!,
      `/oauth2callback?state=${encodeURIComponent(session.state || '')}&code=google-code-secret`,
    )
    assert.equal(response.statusCode, 200)
    assert.equal(session.status, 'complete')
    assert.equal(state.persisted.length, 0)
    assert.deepEqual(session.account, {
      accountId: 'acct-subscriber',
      email: 'operator@example.test',
      hasPassword: true,
      googleLinked: true,
    })
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('cancels a pending Google account OAuth session so a closed browser can be retried immediately', async () => {
  const { service } = createHarness()
  try {
    const { session } = await service.startGoogleAccountOAuthSession()

    assert.equal(service.cancelOAuthSession(session), true)
    assert.equal(session.status, 'error')
    assert.equal(session.error, 'OAuth sign-in was cancelled. Start it again when you are ready.')
    assert.equal(service.cancelOAuthSession(session), false)
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('completes OpenAI Codex manual OAuth input and stores only redacted session result fields', async () => {
  const { service, state } = createHarness()
  try {
    const { session } = await service.startOpenAICodexOAuthSession()
    const parsed = service.parseOpenAICodexAuthorizationInput(
      'http://127.0.0.1:1455/auth/callback?code=manual-code&state=codex-state',
    )

    await service.completeOpenAICodexOAuthSession(session, parsed.code, parsed.state)

    assert.equal(session.status, 'complete')
    assert.equal(session.manualInputRequired, false)
    assert.deepEqual(session.result, {
      accountId: 'acct_manual-code',
      expiresAt: 1782826384447,
    })
    assert.equal(state.persisted[0].provider, 'openai')
    assert.equal(state.persisted[0].oauth.accountId, 'acct_manual-code')
    assert.doesNotMatch(JSON.stringify(session), /codex-refresh-secret/)
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('completes OpenAI Codex OAuth through a loopback-only callback listener without exposing tokens', async () => {
  const { service, state } = createHarness()
  try {
    const { session, launched } = await service.startOpenAICodexOAuthSession()
    assert.equal(launched.ok, true)
    assert.equal(state.openUrls.length, 1)

    const snapshot = service.callbackServerSnapshot()
    assert.equal(snapshot.openAiCodex.address, '127.0.0.1')
    assert.ok(snapshot.openAiCodex.port)

    const response = await getCallback(
      snapshot.openAiCodex.port!,
      `/auth/callback?state=${encodeURIComponent(session.state || '')}&code=browser-code`,
    )
    assert.equal(response.statusCode, 200)
    assert.equal(session.status, 'complete')
    assert.equal(session.manualInputRequired, false)
    assert.deepEqual(session.result, {
      accountId: 'acct_browser-code',
      expiresAt: 1782826384447,
    })
    assert.equal(state.persisted[0].provider, 'openai')
    assert.equal(state.persisted[0].oauth.accountId, 'acct_browser-code')
    assert.doesNotMatch(JSON.stringify(session), /codex-refresh-secret/)
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('completes Anthropic OAuth through the bundled OpenClaw callback flow and keeps tokens out of the session', async () => {
  const { service, state } = createHarness({
    anthropicOAuthRedirectUri: 'http://localhost:53692/callback',
    loginAnthropicOAuth: async (callbacks) => {
      callbacks.onAuth({
        url: 'https://claude.ai/oauth/authorize?state=anthropic-state',
        instructions: 'Complete Anthropic sign-in, then paste the redirect URL here.',
      })
      const input = await callbacks.onManualCodeInput!()
      assert.equal(input, 'http://localhost:53692/callback?code=anthropic-code&state=anthropic-state')
      return {
        access: 'anthropic-access-secret',
        refresh: 'anthropic-refresh-secret',
        expires: 1782826384447,
      }
    },
    refreshAnthropicOAuthToken: async (refreshToken) => ({
      access: `anthropic-access-for-${refreshToken}`,
      refresh: `anthropic-refresh-for-${refreshToken}`,
      expires: 1782826384447,
    }),
  })
  try {
    const { session, launched } = await service.startAnthropicOAuthSession()
    assert.equal(launched.ok, true)
    assert.equal(state.openUrls[0], 'https://claude.ai/oauth/authorize?state=anthropic-state')
    assert.equal(session.provider, 'anthropic')
    assert.equal(session.manualInputRequired, true)

    await service.submitAnthropicOAuthManualInput(
      session,
      'http://localhost:53692/callback?code=anthropic-code&state=anthropic-state',
    )
    for (let attempt = 0; attempt < 20 && session.status === 'pending'; attempt += 1) await wait(5)

    assert.equal(session.status, 'complete')
    assert.equal(session.manualInputRequired, false)
    assert.deepEqual(session.result, { expiresAt: 1782826384447 })
    assert.equal(state.persisted[0].provider, 'anthropic')
    assert.equal(state.persisted[0].oauth.accessToken, 'anthropic-access-secret')
    assert.doesNotMatch(JSON.stringify(session), /anthropic-access-secret|anthropic-refresh-secret/)

    const refreshed = await service.refreshAnthropicOAuthCredential({ refreshToken: 'anthropic-refresh-secret' })
    assert.equal(refreshed.accessToken, 'anthropic-access-for-anthropic-refresh-secret')
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('marks pending OAuth sessions as timed out without closing over stale success state', async () => {
  const { service } = createHarness({ sessionTimeoutMs: 20 })
  try {
    const { session } = await service.startOpenAICodexOAuthSession()
    await wait(50)

    assert.equal(session.status, 'error')
    assert.match(session.error || '', /OAuth timed out after/)
    await assert.rejects(
      () => service.completeOpenAICodexOAuthSession(session, 'manual-code', session.state),
      /already error/,
    )
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('redacts callback exchange failures before storing or rendering the OAuth session error', async () => {
  const { service } = createHarness({
    exchangeGoogleOAuthCodeForTokens: async () => {
      throw new Error('provider rejected google-code-secret with leaked-secret')
    },
  })
  try {
    const { session } = await service.startGoogleOAuthSession('project-alpha')
    const port = service.callbackServerSnapshot().google.port
    assert.ok(port)

    const response = await getCallback(
      port,
      `/oauth2callback?state=${encodeURIComponent(session.state || '')}&code=google-code-secret`,
    )

    assert.equal(response.statusCode, 500)
    assert.equal(session.status, 'error')
    assert.match(session.error || '', /\[redacted\]/)
    assert.doesNotMatch(session.error || '', /google-code-secret|leaked-secret/)
    assert.doesNotMatch(response.body, /google-code-secret|leaked-secret/)
  } finally {
    await service.closeOAuthCallbackServersForShutdown('test cleanup')
  }
})

test('shutdown closes callback listeners and fails pending sessions', async () => {
  const { service } = createHarness()
  const { session } = await service.startGoogleOAuthSession('project-alpha')
  const result = await service.closeOAuthCallbackServersForShutdown('desktop quit')

  assert.equal(result.closed, 1)
  assert.equal(result.failedPendingSessions, 1)
  assert.equal(session.status, 'error')
  assert.equal(session.error, 'OAuth cancelled during desktop quit.')
  assert.equal(service.callbackServerSnapshot().google.listening, false)
})

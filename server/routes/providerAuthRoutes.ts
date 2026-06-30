import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type ProviderOAuthSession = {
  id: string
  provider: 'google' | 'openai-codex'
  state?: string
  verifier?: string
  challenge?: string
  projectId?: string
  redirectUri?: string
  authorizationUrl: string
  status: 'pending' | 'complete' | 'error'
  createdAt: string
  completedAt?: string
  error?: string
  manualInputRequired?: boolean
  manualInputSubmittedAt?: string
  manualPrompt?: string
  result?: {
    email?: string
    accountId?: string
    projectId?: string
    expiresAt?: number
  }
}

type OAuthLaunchResult = {
  ok: boolean
  detail?: string
}

type OAuthStartResult = {
  session: ProviderOAuthSession
  launched: OAuthLaunchResult
}

type AvailableModelsCache = {
  models: unknown
  source: string
  refreshedAt: number
}

type ProviderAuthRoutesOptions = {
  authEnvMap: Record<string, string[]>
  authProviderCatalog: Record<string, unknown>
  ensureProviderAuthReady?: () => Promise<unknown>
  fallbackAvailableModels: () => unknown
  getFastAvailableModelsCatalog: (options?: { refreshStale?: boolean }) => unknown
  googleOAuthRedirectUri: string
  localAuthPath: string
  oauthSessions: Pick<Map<string, ProviderOAuthSession>, 'get'>
  openAiCodexOAuthRedirectUri: string
  parseOpenAICodexAuthorizationInput: (input: string) => { code: string; state?: string }
  completeOpenAICodexOAuthSession: (
    session: ProviderOAuthSession,
    code: string,
    state?: string,
  ) => Promise<unknown>
  persistProviderAuth: (provider: string, apiKey: string) => Promise<unknown>
  providerAuthStatus: (provider: string, options?: { probeGcloud?: boolean }) => unknown
  refreshAvailableModelsCache: () => Promise<AvailableModelsCache>
  removeProviderAuth: (provider: string) => Promise<unknown>
  startGoogleOAuthSession: (projectId?: string) => Promise<OAuthStartResult>
  startOpenAICodexOAuthSession: () => Promise<OAuthStartResult>
}

async function ensureProviderAuthReady(options: ProviderAuthRoutesOptions) {
  if (options.ensureProviderAuthReady) await options.ensureProviderAuthReady()
}

export function registerProviderAuthRoutes(app: Express, options: ProviderAuthRoutesOptions) {
  app.get('/api/auth/providers', async (req, res) => {
    try {
      await ensureProviderAuthReady(options)
      const probeGcloud = req.query.refresh === '1' || req.query.probe === '1'
      const statusOptions = probeGcloud ? { probeGcloud: true } : {}
      const providers = Object.keys(options.authProviderCatalog).map((provider) =>
        options.providerAuthStatus(provider, statusOptions))
      return apiSuccess(res, { providers, persistencePath: options.localAuthPath })
    } catch (error) {
      return apiFailure(res, 500, 'auth_provider_failed', 'Failed to read provider status', String(error))
    }
  })

  app.post('/api/auth/providers/:provider', async (req, res) => {
    const { provider } = req.params
    if (!options.authEnvMap[provider]) {
      return apiFailure(res, 400, 'auth_provider_failed', 'Unsupported provider', { provider })
    }

    const schema = z.object({ apiKey: z.string().min(6) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await ensureProviderAuthReady(options)
      await options.persistProviderAuth(provider, parsed.data.apiKey.trim())
      return apiSuccess(res, { ok: true, provider, persisted: true, persistencePath: options.localAuthPath })
    } catch (error) {
      return apiFailure(res, 500, 'auth_provider_failed', 'Failed to persist provider credentials', { provider, detail: String(error) })
    }
  })

  app.delete('/api/auth/providers/:provider', async (req, res) => {
    const { provider } = req.params
    if (!options.authEnvMap[provider]) {
      return apiFailure(res, 400, 'auth_provider_failed', 'Unsupported provider', { provider })
    }

    try {
      await ensureProviderAuthReady(options)
      await options.removeProviderAuth(provider)
      return apiSuccess(res, { ok: true, provider, persisted: true, persistencePath: options.localAuthPath })
    } catch (error) {
      return apiFailure(res, 500, 'auth_provider_failed', 'Failed to remove provider credentials', { provider, detail: String(error) })
    }
  })

  app.post('/api/auth/providers/:provider/oauth/start', async (req, res) => {
    const { provider } = req.params
    if (provider !== 'google' && provider !== 'openai-codex') {
      return apiFailure(res, 400, 'oauth_operation_failed', 'OAuth is not supported for this provider in the direct model runtime.', { provider })
    }

    const schema = z.object({
      projectId: z.string().optional(),
    }).optional()
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await ensureProviderAuthReady(options)
      const { session, launched } = provider === 'google'
        ? await options.startGoogleOAuthSession(parsed.data?.projectId)
        : await options.startOpenAICodexOAuthSession()
      return apiSuccess(res, {
        ok: true,
        provider,
        sessionId: session.id,
        authorizationUrl: session.authorizationUrl,
        openedBrowser: launched.ok,
        browserDetail: launched.detail,
        redirectUri: session.redirectUri || (provider === 'google' ? options.googleOAuthRedirectUri : options.openAiCodexOAuthRedirectUri),
        projectId: session.projectId || null,
      })
    } catch (error) {
      return apiFailure(res, 500, 'oauth_operation_failed', `Failed to start ${provider} OAuth`, { provider, detail: String(error) })
    }
  })

  app.get('/api/auth/providers/:provider/oauth/session/:sessionId', async (req, res) => {
    const { provider, sessionId } = req.params
    if (provider !== 'google' && provider !== 'openai-codex') {
      return apiFailure(res, 400, 'oauth_operation_failed', 'OAuth is not supported for this provider.', { provider })
    }
    try {
      await ensureProviderAuthReady(options)
      const session = options.oauthSessions.get(sessionId)
      if (!session) return apiFailure(res, 404, 'oauth_operation_failed', 'OAuth session not found', { provider, sessionId })
      if (session.provider !== provider) return apiFailure(res, 404, 'oauth_operation_failed', 'OAuth session not found for this provider', { provider, sessionId })
      return apiSuccess(res, {
        ok: true,
        provider,
        sessionId,
        status: session.status,
        error: session.error,
        authorizationUrl: session.authorizationUrl,
        manualInputRequired: Boolean(session.manualInputRequired),
        manualInputSubmittedAt: session.manualInputSubmittedAt,
        manualPrompt: session.manualPrompt,
        result: session.result,
        providerStatus: options.providerAuthStatus(provider),
      })
    } catch (error) {
      return apiFailure(res, 500, 'oauth_operation_failed', 'Failed to read OAuth session', { provider, detail: String(error) })
    }
  })

  app.post('/api/auth/providers/:provider/oauth/session/:sessionId/manual', async (req, res) => {
    const { provider, sessionId } = req.params
    if (provider !== 'openai-codex') {
      return apiFailure(res, 400, 'oauth_operation_failed', 'Manual OAuth input is only supported for OpenAI Codex.', { provider })
    }

    const session = options.oauthSessions.get(sessionId)
    if (!session || session.provider !== provider) {
      return apiFailure(res, 404, 'oauth_operation_failed', 'OAuth session not found for this provider', { provider, sessionId })
    }
    if (session.status !== 'pending') {
      return apiFailure(res, 409, 'oauth_operation_failed', `OAuth session is already ${session.status}.`, { provider, sessionId })
    }

    const schema = z.object({
      input: z.string().trim().min(1).max(12000),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await ensureProviderAuthReady(options)
      const { code, state } = options.parseOpenAICodexAuthorizationInput(parsed.data.input)
      await options.completeOpenAICodexOAuthSession(session, code, state)
      return apiSuccess(res, {
        ok: true,
        provider,
        sessionId,
        status: session.status,
        result: session.result,
        providerStatus: options.providerAuthStatus(provider),
      })
    } catch (error) {
      session.status = 'error'
      session.error = String(error)
      session.completedAt = new Date().toISOString()
      return apiFailure(res, 400, 'oauth_operation_failed', 'Failed to complete OpenAI Codex OAuth', { provider, detail: String(error) })
    }
  })

  app.get('/api/models/available', async (req, res) => {
    try {
      await ensureProviderAuthReady(options)
      if (req.query.refresh === '1') {
        const cache = await options.refreshAvailableModelsCache()
        return apiSuccess(res, {
          models: cache.models,
          source: cache.source,
          refreshing: false,
          refreshedAt: cache.refreshedAt,
        })
      }

      const refreshStale = req.query.background === '0' || req.query.noRefresh === '1'
        ? false
        : true
      return apiSuccess(res, options.getFastAvailableModelsCatalog({ refreshStale }))
    } catch (error) {
      console.error('Failed to load models:', error)
      return apiFailure(res, 500, 'model_catalog_failed', 'Failed to load models', {
        detail: String(error),
        models: options.fallbackAvailableModels(),
      })
    }
  })
}

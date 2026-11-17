import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { ProviderOAuthSession } from '../services/providers/oauthCallbackService'
import type { ModelCenterService } from '../services/providers/modelCenterService'
import { CREDITS_ONLY_MODEL_ACCESS_MESSAGE } from '../services/license/creditsOnlyModelPolicy'

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
  anthropicOAuthRedirectUri: string
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
  submitAnthropicOAuthManualInput: (session: ProviderOAuthSession, input: string) => Promise<unknown>
  persistProviderAuth: (provider: string, apiKey: string) => Promise<unknown>
  updateProviderOAuthSettings: (provider: string, settings: { projectId?: string }) => Promise<unknown>
  providerAuthStatus: (provider: string, options?: { probeGcloud?: boolean }) => unknown
  refreshAvailableModelsCache: () => Promise<AvailableModelsCache>
  removeProviderAuth: (provider: string) => Promise<unknown>
  startGoogleOAuthSession: (projectId?: string) => Promise<OAuthStartResult>
  startAnthropicOAuthSession: () => Promise<OAuthStartResult>
  startOpenAICodexOAuthSession: () => Promise<OAuthStartResult>
  isCreditsOnlyEntitlement?: () => boolean
  providerAccessAllowed?: () => boolean
  creditsOnlyAvailableModels?: () => unknown
  modelCenter?: Pick<ModelCenterService, 'getCapabilitySnapshots' | 'probeModel' | 'refreshProviderCapabilities'>
}

async function ensureProviderAuthReady(options: ProviderAuthRoutesOptions) {
  if (options.ensureProviderAuthReady) await options.ensureProviderAuthReady()
}

function canonicalOAuthProvider(provider: string) {
  return provider === 'google-vertex' ? 'google' : provider
}

function isProviderOAuthSupported(provider: string) {
  return provider === 'google' || provider === 'google-vertex' || provider === 'openai' || provider === 'anthropic'
}

export function registerProviderAuthRoutes(app: Express, options: ProviderAuthRoutesOptions) {
  const providerAccessBlocked = () => options.isCreditsOnlyEntitlement?.() === true || options.providerAccessAllowed?.() === false
  const providerStatusHidden = () => options.isCreditsOnlyEntitlement?.() === true
  const rejectCreditsOnlyProviderAccess = (res: Parameters<typeof apiFailure>[0]) => apiFailure(
    res,
    403,
    'byok_not_allowed',
    CREDITS_ONLY_MODEL_ACCESS_MESSAGE,
  )

  app.get('/api/auth/providers', async (req, res) => {
    try {
      await ensureProviderAuthReady(options)
      // Provider status is read-only diagnostic state. It must remain visible
      // before a license is activated so the UI can explain exactly which
      // credential or OAuth connection is missing. Provider actions below
      // remain gated by providerAccessBlocked(). Credits-only entitlements
      // intentionally receive the restricted empty catalog.
      if (providerStatusHidden()) {
        return apiSuccess(res, { providers: [], persistencePath: options.localAuthPath })
      }
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
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
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
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
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

  app.patch('/api/auth/providers/:provider/oauth', async (req, res) => {
    const { provider } = req.params
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
    if (provider !== 'google' && provider !== 'google-vertex') {
      return apiFailure(res, 400, 'oauth_operation_failed', 'OAuth settings are only available for Google providers.', { provider })
    }

    const schema = z.object({
      projectId: z.string().trim().max(256).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await ensureProviderAuthReady(options)
      await options.updateProviderOAuthSettings(provider, { projectId: parsed.data.projectId || undefined })
      return apiSuccess(res, { ok: true, provider, projectId: parsed.data.projectId || null })
    } catch (error) {
      return apiFailure(res, 400, 'oauth_operation_failed', 'Failed to save Google OAuth settings', { provider, detail: String(error) })
    }
  })

  app.post('/api/auth/providers/:provider/oauth/start', async (req, res) => {
    const { provider } = req.params
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
    if (!isProviderOAuthSupported(provider)) {
      return apiFailure(res, 400, 'oauth_operation_failed', 'OAuth is not supported for this provider.', { provider })
    }

    const schema = z.object({
      projectId: z.string().optional(),
    }).optional()
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await ensureProviderAuthReady(options)
      const oauthProvider = canonicalOAuthProvider(provider)
      const { session, launched } = oauthProvider === 'google'
        ? await options.startGoogleOAuthSession(parsed.data?.projectId)
        : oauthProvider === 'openai'
          ? await options.startOpenAICodexOAuthSession()
          : await options.startAnthropicOAuthSession()
      return apiSuccess(res, {
        ok: true,
        provider,
        sessionId: session.id,
        authorizationUrl: session.authorizationUrl,
        openedBrowser: launched.ok,
        browserDetail: launched.detail,
        redirectUri: session.redirectUri || (
          oauthProvider === 'google'
            ? options.googleOAuthRedirectUri
            : oauthProvider === 'openai'
              ? options.openAiCodexOAuthRedirectUri
              : options.anthropicOAuthRedirectUri
        ),
        projectId: session.projectId || null,
      })
    } catch (error) {
      return apiFailure(res, 500, 'oauth_operation_failed', `Failed to start ${provider} OAuth`, { provider, detail: String(error) })
    }
  })

  app.get('/api/auth/providers/:provider/oauth/session/:sessionId', async (req, res) => {
    const { provider, sessionId } = req.params
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
    if (!isProviderOAuthSupported(provider)) {
      return apiFailure(res, 400, 'oauth_operation_failed', 'OAuth is not supported for this provider.', { provider })
    }
    try {
      await ensureProviderAuthReady(options)
      const session = options.oauthSessions.get(sessionId)
      if (!session) return apiFailure(res, 404, 'oauth_operation_failed', 'OAuth session not found', { provider, sessionId })
      if (session.provider !== canonicalOAuthProvider(provider)) return apiFailure(res, 404, 'oauth_operation_failed', 'OAuth session not found for this provider', { provider, sessionId })
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
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
    if (provider !== 'openai' && provider !== 'anthropic') {
      return apiFailure(res, 400, 'oauth_operation_failed', 'Manual OAuth input is only supported for OpenAI Codex or Anthropic.', { provider })
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
      if (provider === 'anthropic') {
        await options.submitAnthropicOAuthManualInput(session, parsed.data.input)
        return apiSuccess(res, {
          ok: true,
          provider,
          sessionId,
          status: session.status,
          result: session.result,
          providerStatus: options.providerAuthStatus(provider),
        })
      }
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
      if (providerAccessBlocked()) {
        return apiSuccess(res, {
          models: options.creditsOnlyAvailableModels?.() || [],
          source: 'credits-only',
          refreshing: false,
          stale: false,
        })
      }
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

  app.get('/api/models/capabilities', async (req, res) => {
    if (!options.modelCenter) return apiFailure(res, 503, 'model_catalog_failed', 'Model capability snapshots are unavailable')
    try {
      await ensureProviderAuthReady(options)
      if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
      const queryProvider = req.query.provider
      if (Array.isArray(queryProvider) || (queryProvider !== undefined && typeof queryProvider !== 'string')) {
        return apiFailure(res, 400, 'invalid_payload', 'Specify one provider ID')
      }
      const provider = typeof queryProvider === 'string' ? queryProvider.trim() : ''
      if (provider && !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(provider)) {
        return apiFailure(res, 400, 'invalid_payload', 'Invalid provider ID')
      }
      const refresh = req.query.refresh === '1'
      if (refresh && !provider) {
        return apiFailure(res, 400, 'invalid_payload', 'A provider ID is required for a capability refresh')
      }
      if (refresh) {
        const result = await options.modelCenter.refreshProviderCapabilities(provider)
        return apiSuccess(res, {
          refreshed: result.ok,
          reason: result.ok ? null : result.reason,
          snapshot: result.snapshot,
        })
      }
      return apiSuccess(res, { snapshots: await options.modelCenter.getCapabilitySnapshots(provider || undefined) })
    } catch (error) {
      return apiFailure(res, 500, 'model_catalog_failed', 'Failed to read model capability snapshots', String(error))
    }
  })

  app.post('/api/models/probe', async (req, res) => {
    if (!options.modelCenter) return apiFailure(res, 503, 'model_catalog_failed', 'Model probes are unavailable')
    if (providerAccessBlocked()) return rejectCreditsOnlyProviderAccess(res)
    const schema = z.object({
      modelId: z.string().trim().min(1).max(384),
      confirm: z.literal(true),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'A model ID and explicit probe confirmation are required', parsed.error.flatten())
    try {
      await ensureProviderAuthReady(options)
      const result = await options.modelCenter.probeModel(parsed.data.modelId)
      if (result.reason === 'invalid_model_id') return apiFailure(res, 400, 'invalid_payload', 'Invalid model ID')
      if (result.reason === 'model_not_snapshotted') {
        return apiFailure(res, 409, 'model_catalog_failed', 'Refresh this provider’s capability snapshot before probing the model', { reason: result.reason })
      }
      if (result.reason === 'provider_not_configured') {
        return apiFailure(res, 409, 'model_auth_required', 'Configure provider authentication before probing this model', { reason: result.reason })
      }
      if (result.reason === 'cooldown' || result.reason === 'probe_in_progress') {
        return apiFailure(res, 429, 'resource_conflict', 'A recent or active model probe prevents another probe', { reason: result.reason })
      }
      return apiSuccess(res, { passed: result.ok, reason: result.reason, probe: result.result })
    } catch (error) {
      return apiFailure(res, 502, 'model_catalog_failed', 'Model probe could not be completed', String(error))
    }
  })
}

import { apiRequest, type ApiResult } from './client'

export type AuthProviderOAuthStatus = {
  supported: boolean
  configured: boolean
  available: boolean
  missing?: string[]
  docs?: string
  redirectUri?: string
  projectId?: string
  accountId?: string
  email?: string
  expiresAt?: number
  refreshAvailable?: boolean
  clientIdEnvKeys?: string[]
  projectIdEnvKeys?: string[]
}

export type AuthProviderGcloudStatus = {
  supported: boolean
  installed: boolean
  authenticated: boolean
  configured: boolean
  projectId?: string
  location?: string
  account?: string
  missing?: string[]
  installUrl?: string
  commands?: string[]
}

export type AuthProviderStatus = {
  provider: string
  configured: boolean
  envKeys: string[]
  stored?: boolean
  label?: string
  oauth?: AuthProviderOAuthStatus
  gcloud?: AuthProviderGcloudStatus
}

export type ProviderAuthStatusesPayload = {
  providers?: AuthProviderStatus[]
}

export type OAuthSessionPayload = {
  status?: 'pending' | 'complete' | 'error'
  error?: string
  authorizationUrl?: string
  manualInputRequired?: boolean
  manualPrompt?: string
  result?: { email?: string; projectId?: string }
  providerStatus?: AuthProviderStatus
}

export type OAuthStartPayload = {
  ok?: boolean
  sessionId?: string
  authorizationUrl?: string
  openedBrowser?: boolean
}

export const OAUTH_PROVIDER_FALLBACKS: Record<string, AuthProviderStatus> = {
  'openai-codex': {
    provider: 'openai-codex',
    configured: false,
    envKeys: [],
    label: 'OpenAI Codex',
    oauth: {
      supported: true,
      configured: false,
      available: true,
      missing: [],
      redirectUri: 'http://localhost:1455/auth/callback',
    },
  },
}

export function isAuthProviderStatus(value: unknown): value is AuthProviderStatus {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AuthProviderStatus>
  return typeof entry.provider === 'string' && typeof entry.configured === 'boolean'
}

export function safeAuthProviders(value: unknown): AuthProviderStatus[] {
  return Array.isArray(value) ? value.filter(isAuthProviderStatus) : []
}

export function authStatusForProvider(providers: AuthProviderStatus[], provider: string): AuthProviderStatus | undefined {
  return providers.find((entry) => entry.provider === provider) || OAUTH_PROVIDER_FALLBACKS[provider]
}

export function effectiveAuthStatusForProvider(providers: AuthProviderStatus[], provider: string): AuthProviderStatus | undefined {
  const status = authStatusForProvider(providers, provider)
  if (provider !== 'openai-codex' || status?.configured) return status
  const openAiStatus = authStatusForProvider(providers, 'openai')
  if (!openAiStatus?.configured) return status
  return {
    ...(status || OAUTH_PROVIDER_FALLBACKS['openai-codex']),
    configured: true,
    stored: status?.stored || openAiStatus.stored,
  }
}

export function authLabelForProvider(provider: string, status?: AuthProviderStatus): string {
  return status?.label || (provider === 'openai-codex' ? 'OpenAI Codex' : provider)
}

export function authKindForProvider(status?: AuthProviderStatus): 'OAuth' | 'auth' {
  return status?.oauth?.supported ? 'OAuth' : 'auth'
}

export function fetchProviderAuthStatuses(options: {
  refresh?: boolean
  timeoutMs?: number
} = {}): Promise<ApiResult<ProviderAuthStatusesPayload>> {
  return apiRequest<ProviderAuthStatusesPayload>(options.refresh ? '/api/auth/providers?refresh=1' : '/api/auth/providers', {
    cache: options.refresh ? 'no-store' : undefined,
    timeoutMs: options.timeoutMs ?? (options.refresh ? 30_000 : 8_000),
  })
}

export function saveProviderApiKey(provider: string, apiKey: string): Promise<ApiResult<unknown>> {
  return apiRequest(`/api/auth/providers/${encodeURIComponent(provider)}`, {
    method: 'POST',
    timeoutMs: 20_000,
    body: { apiKey },
  })
}

export function startProviderOAuthSession(
  provider: string,
  options: { projectId?: string; timeoutMs?: number } = {},
): Promise<ApiResult<OAuthStartPayload>> {
  return apiRequest<OAuthStartPayload>(`/api/auth/providers/${encodeURIComponent(provider)}/oauth/start`, {
    method: 'POST',
    body: { projectId: options.projectId },
    timeoutMs: options.timeoutMs ?? 20_000,
  })
}

export function fetchProviderOAuthSession(
  provider: string,
  sessionId: string,
  options: { timeoutMs?: number } = {},
): Promise<ApiResult<OAuthSessionPayload>> {
  return apiRequest<OAuthSessionPayload>(
    `/api/auth/providers/${encodeURIComponent(provider)}/oauth/session/${encodeURIComponent(sessionId)}`,
    {
      cache: 'no-store',
      timeoutMs: options.timeoutMs ?? 10_000,
    },
  )
}

export function submitProviderOAuthManual(
  provider: string,
  sessionId: string,
  input: string,
): Promise<ApiResult<unknown>> {
  return apiRequest(
    `/api/auth/providers/${encodeURIComponent(provider)}/oauth/session/${encodeURIComponent(sessionId)}/manual`,
    {
      method: 'POST',
      body: { input },
      timeoutMs: 15_000,
    },
  )
}

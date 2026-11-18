import { apiRequest, type ApiResult } from './client'

export type ProviderModelCapability = {
  id: string
  provider: string
  name?: string
  contextWindow?: number
  contextTokens?: number
  input?: string[]
  output?: string[]
  reasoning?: boolean
  supportsTools?: boolean
  verifiedAt: string
}

export type ProviderModelCapabilitySnapshot = {
  provider: string
  verifiedAt: string
  catalogOutcome: 'ready' | 'auth-rejected' | 'unavailable' | 'unknown'
  models: ProviderModelCapability[]
}

export type ProviderModelOnboarding = {
  provider: string
  checkedAt: string
  status: 'invalid_provider' | 'authentication_required' | 'catalog_discovery_required' | 'catalog_auth_rejected' | 'catalog_stale' | 'ready_for_opt_in_probe'
  authentication: { configured: boolean }
  catalog: {
    discovered: boolean
    outcome: ProviderModelCapabilitySnapshot['catalogOutcome'] | 'not_discovered'
    verifiedAt: string | null
    stale: boolean
    modelCount: number
  }
  probeContract: {
    available: boolean
    executed: false
    requiresExplicitConfirmation: true
    mayBeBillable: true
    toolsDisabled: true
    timeoutMs: number
    maxOutputTokens: number
  }
  advertisedCapabilities: {
    inputModalities: string[]
    outputModalities: string[]
    reasoningModelCount: number
    toolCapableModelCount: number
    contextWindowModelCount: number
  }
}

export type ProviderModelProbe = {
  modelId: string
  provider: string
  status: 'passed' | 'failed' | 'blocked'
  reason: string
  checkedAt: string
  durationMs: number
  timeoutMs: number
  maxOutputTokens: number
}

export function fetchProviderModelOnboarding(
  provider: string,
  options: { refreshCatalog?: boolean } = {},
): Promise<ApiResult<{ onboarding: ProviderModelOnboarding; discovery?: { refreshed: boolean; reason: string | null } }>> {
  const refresh = options.refreshCatalog ? '&refresh=1' : ''
  return apiRequest<{ onboarding: ProviderModelOnboarding; discovery?: { refreshed: boolean; reason: string | null } }>(`/api/models/onboarding?provider=${encodeURIComponent(provider)}${refresh}`, {
    cache: 'no-store',
    timeoutMs: options.refreshCatalog ? 35_000 : 10_000,
  })
}

export function fetchProviderModelCapabilities(provider: string): Promise<ApiResult<{ snapshots: ProviderModelCapabilitySnapshot[] }>> {
  return apiRequest<{ snapshots: ProviderModelCapabilitySnapshot[] }>(`/api/models/capabilities?provider=${encodeURIComponent(provider)}`, {
    cache: 'no-store',
    timeoutMs: 10_000,
  })
}

export async function runBoundedProviderModelProbe(
  modelId: string,
  explicitlyConfirmed: boolean,
): Promise<ApiResult<{ passed: boolean; reason: string; probe: ProviderModelProbe | null }>> {
  if (explicitlyConfirmed !== true) {
    throw new Error('Explicit confirmation is required before running a model probe.')
  }
  return apiRequest<{ passed: boolean; reason: string; probe: ProviderModelProbe | null }>('/api/models/probe', {
    method: 'POST',
    timeoutMs: 20_000,
    body: { modelId, confirm: true },
  })
}

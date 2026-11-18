export type ProviderOAuthExpiryGuidance = {
  tone: 'emerald' | 'amber' | 'rose'
  label: string
  message: string
}

const HOUR_MS = 60 * 60 * 1000

export function providerOAuthExpiryGuidance(expiresAt?: number, refreshAvailable = false, now = Date.now()): ProviderOAuthExpiryGuidance {
  if (!Number.isFinite(expiresAt) || !expiresAt) {
    return {
      tone: 'amber',
      label: 'Expiry unknown',
      message: refreshAvailable
        ? 'OpenClaw has a refresh token, but no access-token expiry was reported. Reconnect if a provider call returns an authentication error.'
        : 'No access-token expiry or refresh token was reported. Check this connection before relying on it for a model call.',
    }
  }
  const remainingMs = expiresAt - now
  if (remainingMs <= 0) {
    return { tone: 'rose', label: 'Reconnect required', message: 'This OAuth access token has expired. Reconnect before the next model call.' }
  }
  if (remainingMs <= HOUR_MS) {
    return {
      tone: 'amber',
      label: refreshAvailable ? 'Expires soon · refresh available' : 'Expires soon · reconnect',
      message: refreshAvailable
        ? 'The access token expires within an hour. A refresh token is available; reconnect if OpenClaw reports an authentication error.'
        : 'The access token expires within an hour and no refresh token is available. Reconnect now to avoid a failed model call.',
    }
  }
  if (remainingMs <= 24 * HOUR_MS) {
    return {
      tone: 'amber',
      label: 'Expires within 24 hours',
      message: refreshAvailable
        ? 'The access token expires within 24 hours. OpenClaw has a refresh token; watch for provider authentication errors.'
        : 'The access token expires within 24 hours and no refresh token is available. Reconnect before the next model call.',
    }
  }
  return { tone: 'emerald', label: 'Ready', message: 'OAuth access is available.' }
}

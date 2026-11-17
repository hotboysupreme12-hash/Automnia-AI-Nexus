export type FailureRecoveryAction = 'restart-gateway' | 'open-settings'

export type FailureRecovery = {
  label: string
  detail: string
  action?: FailureRecoveryAction
}

const FAILURE_RECOVERY: Record<string, FailureRecovery> = {
  insufficient_credits: {
    label: 'Manage credits or routing',
    detail: 'Open Account to add Automnia credits or choose your connected provider.',
    action: 'open-settings',
  },
  credits_exhausted: {
    label: 'Manage credits or routing',
    detail: 'Open Account to add Automnia credits or choose your connected provider.',
    action: 'open-settings',
  },
  auth_missing: {
    label: 'Connect provider',
    detail: 'Connect or refresh the selected provider credentials, then start a new turn.',
  },
  auth_expired: {
    label: 'Refresh provider access',
    detail: 'Reconnect the selected provider and start a new turn after its status is ready.',
  },
  provider_forbidden: {
    label: 'Choose an allowed route',
    detail: 'The current plan blocks this provider. Choose an Automnia hosted model or update provider access.',
  },
  gateway_disconnect: {
    label: 'Restart gateway',
    detail: 'The Gateway connection dropped. Restart it, confirm it is ready, then start a new turn.',
    action: 'restart-gateway',
  },
  gateway_unavailable: {
    label: 'Restart gateway',
    detail: 'The Gateway is unavailable. Restart it, confirm it is ready, then start a new turn.',
    action: 'restart-gateway',
  },
  network_error: {
    label: 'Restart gateway',
    detail: 'The local backend connection dropped. Restart the Gateway, confirm it is ready, then start a new turn.',
    action: 'restart-gateway',
  },
  runtime_unavailable: {
    label: 'Check OpenClaw runtime',
    detail: 'OpenClaw is unavailable. Check its installation and Gateway status before starting another turn.',
  },
  plugin_loader_error: {
    label: 'Check provider plugin',
    detail: 'A required plugin did not load. Review its status and dependencies, then restart the Gateway.',
    action: 'restart-gateway',
  },
  rate_limit: {
    label: 'Wait for provider quota',
    detail: 'The provider is rate limiting requests. Wait briefly, then start a new turn.',
  },
  timeout: {
    label: 'Check run before retrying',
    detail: 'The turn timed out. Review its activity for completed tool actions, then shorten the request or allow more time.',
  },
  context_overflow: {
    label: 'Reduce context',
    detail: 'The request exceeded the model context limit. Shorten the request or choose a model with a larger context window.',
  },
  provider_unsupported: {
    label: 'Change model',
    detail: 'This model does not support the requested operation. Choose a supported model or provider, then start a new turn.',
  },
  sandbox_unavailable: {
    label: 'Check sandbox setup',
    detail: 'The required sandbox is unavailable. Repair its setup or choose an agent that does not require it.',
  },
  browser_preflight_failed: {
    label: 'Complete browser setup',
    detail: 'Browser access was not ready. Complete sign-in or permission setup, then start a new turn.',
  },
  validation: {
    label: 'Review request settings',
    detail: 'Check the selected agent, model, and request details before starting another turn.',
  },
  disk_low: {
    label: 'Free local storage',
    detail: 'The device is low on disk space. Free space before starting another turn.',
  },
  stale_lock: {
    label: 'Check for an active run',
    detail: 'A session lock may be stale. Confirm no run is active before using OpenClaw recovery tools.',
  },
  process_error: {
    label: 'Review runtime details',
    detail: 'The runtime process failed. Check the error details and completed activity before starting another turn.',
  },
  provider_error: {
    label: 'Review provider response',
    detail: 'Check the provider details and completed activity before retrying or switching providers.',
  },
  aborted: {
    label: 'Run stopped',
    detail: 'The turn was stopped. Review any partial output or completed actions before starting another turn.',
  },
  cancelled: {
    label: 'Run cancelled',
    detail: 'The turn was cancelled. Review any partial output or completed actions before continuing.',
  },
  interrupted: {
    label: 'Run interrupted',
    detail: 'The runtime stopped observing this turn. Check its activity before starting another turn.',
  },
}

export function failureRecoveryForKind(failureKind?: string): FailureRecovery | null {
  const kind = failureKind?.trim().toLowerCase()
  if (!kind) return null
  return FAILURE_RECOVERY[kind] || {
    label: 'Review the error details',
    detail: 'Check the response and recent activity. Confirm whether any actions completed before submitting the request again.',
  }
}

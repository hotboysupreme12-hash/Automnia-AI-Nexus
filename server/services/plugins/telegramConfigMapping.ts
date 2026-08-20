export type ConfigStringEntry = readonly [key: string, value: string]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensureRecord(parent: Record<string, unknown>, key: string) {
  const existing = parent[key]
  if (isRecord(existing)) return existing
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

const TELEGRAM_CHANNEL_CREDENTIAL_KEYS = new Set(['botToken', 'tokenFile'])

/**
 * The Telegram plugin manifest describes channel credentials, but the generic
 * plugin editor submits every value as plugins.entries.<id>.config.<key>.
 * OpenClaw resolves Telegram credentials from channels.telegram instead.
 * Keep this mapping in one pure function so the save path and its regression
 * tests share the same contract.
 */
export function applyTelegramPluginConfigValues(
  config: Record<string, unknown>,
  values: readonly ConfigStringEntry[],
) {
  const channelValues = values.filter(([key]) => TELEGRAM_CHANNEL_CREDENTIAL_KEYS.has(key))
  const pluginValues = values.filter(([key]) => !TELEGRAM_CHANNEL_CREDENTIAL_KEYS.has(key))

  if (!channelValues.length) return { channelValues, pluginValues }

  const channels = ensureRecord(config, 'channels')
  const telegram = ensureRecord(channels, 'telegram')
  for (const [key, value] of channelValues) telegram[key] = value

  // Entering a valid credential is an explicit request to activate this
  // channel. Preserve all other Telegram settings while removing the stale
  // plugin-entry credential in the caller.
  telegram.enabled = true

  return { channelValues, pluginValues }
}

export function hasTelegramChannelCredential(value: unknown) {
  if (!isRecord(value)) return false
  return ['botToken', 'tokenFile'].some((key) => {
    const candidate = value[key]
    return typeof candidate === 'string' && candidate.trim().length > 0
  })
}

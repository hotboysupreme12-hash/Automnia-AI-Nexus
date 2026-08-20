function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * OpenClaw's Telegram `open` DM policy requires allowFrom=["*"]. The control
 * center does not expose that broad allowlist as a separate setting, so an
 * invalid open policy would silently drop every direct message. Pairing is
 * the safe policy when approved senders are stored in OpenClaw's pairing
 * credential file.
 */
export function repairInvalidTelegramDmPolicy(config: Record<string, unknown>) {
  const channels = isRecord(config.channels) ? config.channels : null
  const telegram = channels && isRecord(channels.telegram) ? channels.telegram : null
  if (!telegram || telegram.dmPolicy !== 'open') return false

  const allowFrom = telegram.allowFrom
  const hasWildcard = Array.isArray(allowFrom) && allowFrom.some((value) => String(value).trim() === '*')
  if (hasWildcard) return false

  telegram.dmPolicy = 'pairing'
  return true
}

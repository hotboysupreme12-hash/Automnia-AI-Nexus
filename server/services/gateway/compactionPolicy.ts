/**
 * Compaction settings that keep enough context available for a recovery turn.
 *
 * OpenClaw subtracts the reserve from the model context window before deciding
 * whether a prompt fits. A large reserve can therefore make a long session
 * impossible to compact, even when the model itself has room for it.
 */
export const AUTOMNIA_COMPACTION_RESERVE_TOKENS = 50_000
export const AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS = 50_000

export type AutomniaCompactionSettings = {
  reserveTokens?: unknown
  reserveTokensFloor?: unknown
  keepRecentTokens?: unknown
  [key: string]: unknown
}

function asFiniteNonNegativeInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

/**
 * Repair stale or unsafe reserve values in-place.
 *
 * Values below the active baseline are preserved so an intentional, more
 * aggressive user configuration is not silently expanded. Oversized values
 * are capped because they reduce the prompt budget and cause precheck
 * overflows on 200k-context models.
 */
export function enforceAutomniaCompactionPolicy(settings: AutomniaCompactionSettings) {
  let changed = false

  const set = (key: string, value: number) => {
    if (settings[key] === value) return
    settings[key] = value
    changed = true
  }

  const reserveFloor = asFiniteNonNegativeInteger(settings.reserveTokensFloor)
  if (
    reserveFloor === null
    || reserveFloor === 24_000
    || reserveFloor === 60_000
    || reserveFloor > AUTOMNIA_COMPACTION_RESERVE_TOKENS
  ) {
    set('reserveTokensFloor', AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  }

  const reserveTokens = asFiniteNonNegativeInteger(settings.reserveTokens)
  if (reserveTokens !== null && reserveTokens > AUTOMNIA_COMPACTION_RESERVE_TOKENS) {
    set('reserveTokens', AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  }

  const keepRecentTokens = asFiniteNonNegativeInteger(settings.keepRecentTokens)
  if (keepRecentTokens === null) {
    set('keepRecentTokens', AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS)
  } else if (keepRecentTokens > AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS) {
    set('keepRecentTokens', AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS)
  }

  return changed
}

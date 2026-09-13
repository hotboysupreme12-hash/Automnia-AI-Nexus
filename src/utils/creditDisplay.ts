export const AUTOMNIA_TOKENS_PER_CREDIT = 1_000
export const AUTOMNIA_BILLING_UNIT_VERSION = 2
export const AUTOMNIA_CREDIT_BALANCE_UNIT = 'credits' as const
export const AUTOMNIA_STARTER_TOKENS = 22_000_000
export const AUTOMNIA_PRO_TOKENS = 55_000_000

export function formatAutomniaCredits(value: number | null | undefined, suffix = 'credits') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Awaiting a confirmed balance'
  const formatted = value.toLocaleString('en-US', { maximumFractionDigits: 3 })
  return suffix ? `${formatted} ${suffix}` : formatted
}

export function formatAutomniaCreditsFromTokens(tokens: number | null | undefined, suffix = 'credits') {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) return 'Awaiting a confirmed balance'
  return formatAutomniaCredits(Math.floor(tokens) / AUTOMNIA_TOKENS_PER_CREDIT, suffix)
}

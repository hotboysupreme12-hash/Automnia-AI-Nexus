/** Preserve the starting balance while spending; start a new allowance on refill. */
export function usageBaseline(balance: number | null | undefined, previous: number | null | undefined, baseline: number | null | undefined): number | null {
  const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!valid(balance)) return valid(baseline) ? baseline : null
  if (valid(previous) && balance > previous) return balance
  return Math.max(balance, valid(baseline) ? baseline : valid(previous) ? previous : balance)
}

export function formatUsageRemaining(balance: number | null | undefined, baseline: number | null | undefined): string {
  if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) return 'Awaiting usage confirmation'
  if (balance === 0) return '0%'
  if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline <= 0) return 'Awaiting usage confirmation'
  const percent = Math.min(100, balance / baseline * 100)
  if (percent < 0.01) return '<0.01%'
  // Do not round a partially used allowance back up to 100%.
  const rounded = Math.round(percent * 100) / 100
  return `${(percent < 100 ? Math.min(99.99, rounded) : rounded).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

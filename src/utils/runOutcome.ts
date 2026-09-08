export function runOutcomeLabel(entry: { streaming?: boolean; ok: boolean; failureKind?: string }): string {
  if (entry.streaming) return 'Working'
  if (entry.ok) return 'Complete'
  const kind = (entry.failureKind || '').toLowerCase()
  if (/abort|cancel/.test(kind)) return 'Cancelled'
  if (/timeout|timed_out/.test(kind)) return 'Timed out'
  if (/auth|forbidden|blocked|denied|credit|quota|rate_limit/.test(kind)) return 'Blocked'
  return 'Failed'
}

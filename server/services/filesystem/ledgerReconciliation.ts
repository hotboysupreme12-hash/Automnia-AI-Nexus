type LedgerRecord = Record<string, unknown>

function recordTime(value: LedgerRecord) {
  for (const key of ['updatedAt', 'generatedAt', 'endedAt', 'timestamp', 'at', 'startedAt']) {
    const parsed = typeof value[key] === 'string' ? Date.parse(value[key]) : NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** Combine durable stores so a recovered SQLite connection cannot hide its fallback history. */
export function reconcileLedgerRecords<T>(sqlite: T[], fallback: T[], limit: number, keyField = 'id'): T[] {
  const byKey = new Map<unknown, T>()
  for (const row of [...sqlite, ...fallback]) {
    if (!row || typeof row !== 'object') continue
    const value = row as LedgerRecord
    const key = value[keyField] || value.id || JSON.stringify(value)
    const previous = byKey.get(key)
    if (!previous || recordTime(value) >= recordTime(previous as LedgerRecord)) byKey.set(key, row)
  }
  return [...byKey.values()]
    .sort((a, b) => recordTime(a as LedgerRecord) - recordTime(b as LedgerRecord))
    .slice(-Math.max(1, Math.round(limit)))
}

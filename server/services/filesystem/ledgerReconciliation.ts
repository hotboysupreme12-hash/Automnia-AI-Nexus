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
  const byKey = new Map<unknown, { row: T; time: number }>()
  for (const row of [...sqlite, ...fallback]) {
    if (!row || typeof row !== 'object') continue
    const value = row as LedgerRecord
    const key = value[keyField] || value.id || JSON.stringify(value)
    const time = recordTime(value)
    const previous = byKey.get(key)
    if (!previous || time >= previous.time) byKey.set(key, { row, time })
  }
  return [...byKey.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(1, Math.round(limit)))
    .map((entry) => entry.row)
}

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_BASE_LOCKOUT_MS = 2_000
const DEFAULT_MAX_LOCKOUT_MS = 60_000
const DEFAULT_MAX_ENTRIES = 256

export type LoginAttemptDecision = {
  allowed: boolean
  retryAfterMs: number
  failures: number
}

export type LoginAttemptLimiter = {
  check: (key: string) => LoginAttemptDecision
  recordFailure: (key: string) => LoginAttemptDecision
  recordSuccess: (key: string) => void
  clear: () => void
  size: () => number
}

type LoginAttemptRecord = {
  blockedUntil: number
  failures: number
  lastSeenAt: number
  windowStartedAt: number
}

type LoginAttemptLimiterOptions = {
  baseLockoutMs?: number
  maxAttempts?: number
  maxEntries?: number
  maxLockoutMs?: number
  now?: () => number
  windowMs?: number
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value as number)))
}

function normalizedKey(key: string) {
  const trimmed = String(key || '').trim()
  return trimmed || 'local-operator'
}

export function createLoginAttemptLimiter(options: LoginAttemptLimiterOptions = {}): LoginAttemptLimiter {
  const now = options.now || Date.now
  const windowMs = boundedInteger(options.windowMs, DEFAULT_WINDOW_MS, 1_000, 60 * 60 * 1000)
  const maxAttempts = boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 100)
  const baseLockoutMs = boundedInteger(options.baseLockoutMs, DEFAULT_BASE_LOCKOUT_MS, 250, 60 * 1000)
  const maxLockoutMs = boundedInteger(options.maxLockoutMs, DEFAULT_MAX_LOCKOUT_MS, baseLockoutMs, 24 * 60 * 60 * 1000)
  const maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 8, 4096)
  const attempts = new Map<string, LoginAttemptRecord>()

  const prune = () => {
    const current = now()
    for (const [key, record] of attempts) {
      const expiredWindow = current - record.windowStartedAt > windowMs
      const inactive = current - record.lastSeenAt > Math.max(windowMs, maxLockoutMs)
      if (inactive || (expiredWindow && record.blockedUntil <= current)) attempts.delete(key)
    }
    while (attempts.size > maxEntries) {
      const oldest = [...attempts.entries()].sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)[0]
      if (!oldest) break
      attempts.delete(oldest[0])
    }
  }

  const currentRecord = (rawKey: string) => {
    const key = normalizedKey(rawKey)
    const current = now()
    let record = attempts.get(key)
    if (record && current - record.windowStartedAt > windowMs && record.blockedUntil <= current) {
      attempts.delete(key)
      record = undefined
    }
    return { key, current, record }
  }

  const decisionFor = (record: LoginAttemptRecord | undefined, current: number): LoginAttemptDecision => ({
    allowed: !record || record.blockedUntil <= current,
    retryAfterMs: record ? Math.max(0, record.blockedUntil - current) : 0,
    failures: record?.failures || 0,
  })

  return {
    check(rawKey) {
      prune()
      const { current, record } = currentRecord(rawKey)
      if (record) record.lastSeenAt = current
      return decisionFor(record, current)
    },

    recordFailure(rawKey) {
      prune()
      const { key, current, record: existing } = currentRecord(rawKey)
      const record = existing || {
        blockedUntil: 0,
        failures: 0,
        lastSeenAt: current,
        windowStartedAt: current,
      }
      record.failures += 1
      record.lastSeenAt = current
      if (record.failures >= maxAttempts) {
        const exponent = Math.min(20, record.failures - maxAttempts)
        const lockoutMs = Math.min(maxLockoutMs, baseLockoutMs * (2 ** exponent))
        record.blockedUntil = Math.max(record.blockedUntil, current + lockoutMs)
      }
      attempts.delete(key)
      attempts.set(key, record)
      prune()
      return decisionFor(record, current)
    },

    recordSuccess(rawKey) {
      attempts.delete(normalizedKey(rawKey))
    },

    clear() {
      attempts.clear()
    },

    size() {
      prune()
      return attempts.size
    },
  }
}

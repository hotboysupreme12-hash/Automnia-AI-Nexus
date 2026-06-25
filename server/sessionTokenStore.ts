import { randomBytes, timingSafeEqual } from 'node:crypto'

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const DEFAULT_MAX_SESSIONS = 64
const MIN_SESSION_TTL_MS = 60 * 1000
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MIN_MAX_SESSIONS = 1
const MAX_MAX_SESSIONS = 512

type SessionRecord = {
  createdAt: number
  expiresAt: number
}

export type IssuedSessionToken = {
  token: string
  expiresAt: string
}

export type SessionTokenStore = {
  issue: () => IssuedSessionToken
  has: (token: string) => boolean
  revoke: (token: string) => boolean
  clear: () => void
  size: () => number
}

type SessionTokenStoreOptions = {
  maxSessions?: number
  now?: () => number
  ttlMs?: number
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value as number)))
}

export function secureTokenEqual(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
}

export function createSessionTokenStore(options: SessionTokenStoreOptions = {}): SessionTokenStore {
  const now = options.now || Date.now
  const ttlMs = boundedInteger(options.ttlMs, DEFAULT_SESSION_TTL_MS, MIN_SESSION_TTL_MS, MAX_SESSION_TTL_MS)
  const maxSessions = boundedInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, MIN_MAX_SESSIONS, MAX_MAX_SESSIONS)
  const sessions = new Map<string, SessionRecord>()

  const prune = () => {
    const current = now()
    for (const [token, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(token)
    }
  }

  const makeRoom = () => {
    prune()
    while (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value as string | undefined
      if (!oldest) break
      sessions.delete(oldest)
    }
  }

  return {
    issue() {
      makeRoom()
      const createdAt = now()
      const expiresAt = createdAt + ttlMs
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { createdAt, expiresAt })
      return { token, expiresAt: new Date(expiresAt).toISOString() }
    },
    has(token) {
      if (!token) return false
      const session = sessions.get(token)
      if (!session) return false
      if (session.expiresAt <= now()) {
        sessions.delete(token)
        return false
      }
      return true
    },
    revoke(token) {
      return token ? sessions.delete(token) : false
    },
    clear() {
      sessions.clear()
    },
    size() {
      prune()
      return sessions.size
    },
  }
}

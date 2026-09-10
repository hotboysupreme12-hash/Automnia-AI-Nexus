import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

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

type PersistedSession = SessionRecord & {
  hash: string
}

type PersistedSessionState = {
  version: 1
  sessions: PersistedSession[]
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
  persistPath?: string
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

function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSessionTokenStore(options: SessionTokenStoreOptions = {}): SessionTokenStore {
  const now = options.now || Date.now
  const ttlMs = boundedInteger(options.ttlMs, DEFAULT_SESSION_TTL_MS, MIN_SESSION_TTL_MS, MAX_SESSION_TTL_MS)
  const maxSessions = boundedInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, MIN_MAX_SESSIONS, MAX_MAX_SESSIONS)
  const persistPath = options.persistPath?.trim() ? path.resolve(options.persistPath) : undefined
  const sessions = new Map<string, SessionRecord>()

  const persist = () => {
    if (!persistPath) return
    const state: PersistedSessionState = {
      version: 1,
      sessions: Array.from(sessions, ([hash, session]) => ({ hash, ...session })),
    }
    const temporaryPath = `${persistPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    try {
      mkdirSync(path.dirname(persistPath), { recursive: true })
      const serialized = JSON.stringify(state)
      writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      chmodSync(temporaryPath, 0o600)
      try {
        renameSync(temporaryPath, persistPath)
      } catch {
        // Windows cannot always replace an existing file with renameSync.
        writeFileSync(persistPath, serialized, { encoding: 'utf8', mode: 0o600 })
        unlinkSync(temporaryPath)
      }
      chmodSync(persistPath, 0o600)
    } catch {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // Best-effort persistence must never take the Control Center down.
      }
    }
  }

  const load = () => {
    if (!persistPath) return
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8')) as Partial<PersistedSessionState>
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return
      const validSessions = parsed.sessions
        .filter((session): session is PersistedSession => (
          Boolean(session)
          && typeof session === 'object'
          && typeof session.hash === 'string'
          && /^[a-f0-9]{64}$/.test(session.hash)
          && Number.isFinite(session.createdAt)
          && Number.isFinite(session.expiresAt)
          && session.expiresAt > session.createdAt
        ))
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-maxSessions)
      for (const session of validSessions) {
        sessions.set(session.hash, {
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })
      }
    } catch {
      // A missing or malformed cache behaves like an empty session store.
    }
  }

  const prune = () => {
    let changed = false
    const current = now()
    for (const [hash, session] of sessions) {
      if (session.expiresAt <= current) {
        sessions.delete(hash)
        changed = true
      }
    }
    return changed
  }

  const makeRoom = () => {
    let changed = prune()
    while (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value as string | undefined
      if (!oldest) break
      sessions.delete(oldest)
      changed = true
    }
    if (changed) persist()
  }

  load()
  if (prune()) persist()

  return {
    issue() {
      makeRoom()
      const createdAt = now()
      const expiresAt = createdAt + ttlMs
      const token = randomBytes(32).toString('base64url')
      sessions.set(sessionTokenHash(token), { createdAt, expiresAt })
      persist()
      return { token, expiresAt: new Date(expiresAt).toISOString() }
    },
    has(token) {
      if (!token) return false
      const hash = sessionTokenHash(token)
      const session = sessions.get(hash)
      if (!session) return false
      if (session.expiresAt <= now()) {
        sessions.delete(hash)
        persist()
        return false
      }
      return true
    },
    revoke(token) {
      if (!token) return false
      const revoked = sessions.delete(sessionTokenHash(token))
      if (revoked) persist()
      return revoked
    },
    clear() {
      if (sessions.size === 0) return
      sessions.clear()
      persist()
    },
    size() {
      if (prune()) persist()
      return sessions.size
    },
  }
}

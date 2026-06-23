import { createRequire } from 'node:module'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

type SqliteStatement = {
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  get?: (...params: unknown[]) => Record<string, unknown> | undefined
  run: (...params: unknown[]) => unknown
}

type SqliteDatabase = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close?: () => void
}

type SqliteModule = {
  DatabaseSync?: new (filePath: string) => SqliteDatabase
}

type LedgerPaths = {
  directory: string
  sqlite: string
  runtimeRunsJsonl: string
  gatewayEventsJsonl: string
  diagnosticRunsJsonl: string
}

type LedgerKind = 'runtime_run' | 'gateway_event' | 'diagnostic_run'

type LedgerAppendOptions = {
  mirrorJsonl?: boolean
  sqlite?: boolean
}

type LedgerReadOptions = {
  sqlite?: boolean
}

const optionalRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
const LEDGER_TAIL_MAX_BYTES = 512 * 1024

let paths: LedgerPaths | null = null
let database: SqliteDatabase | null = null
let sqliteUnavailableReason = ''
let legacyImportWarning = ''

export function configureRuntimeLedger(input: Omit<LedgerPaths, 'sqlite'> & { sqlite?: string }) {
  const nextPaths = {
    ...input,
    sqlite: input.sqlite || path.join(input.directory, 'control-center.sqlite'),
  }
  if (database && paths?.sqlite !== nextPaths.sqlite) closeRuntimeLedger()
  paths = nextPaths
  sqliteUnavailableReason = ''
  legacyImportWarning = ''
}

function configuredPaths() {
  if (!paths) throw new Error('Runtime ledger paths were not configured.')
  return paths
}

async function appendJsonlLedger(filePath: string, value: Record<string, unknown>) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf-8', mode: 0o600 })
  await fs.chmod(filePath, 0o600).catch(() => undefined)
}

async function readJsonlLedgerTail<T>(filePath: string, limit: number): Promise<T[]> {
  try {
    const stat = await fs.stat(filePath)
    const start = Math.max(0, stat.size - LEDGER_TAIL_MAX_BYTES)
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(stat.size - start)
      await handle.read(buffer, 0, buffer.length, start)
      return buffer
        .toString('utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line) as T)
    } finally {
      await handle.close()
    }
  } catch {
    return []
  }
}

function openDatabase() {
  if (database) return database
  if (sqliteUnavailableReason) return null

  const currentPaths = configuredPaths()
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) {
      sqliteUnavailableReason = 'node:sqlite is not available in this runtime'
      return null
    }

    mkdirSync(path.dirname(currentPaths.sqlite), { recursive: true })
    database = new sqlite.DatabaseSync(currentPaths.sqlite)
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS runtime_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        ended_at TEXT,
        status TEXT,
        agent_id TEXT,
        session_id TEXT,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_runs_recent
        ON runtime_runs(COALESCE(ended_at, started_at), created_at_ms);

      CREATE TABLE IF NOT EXISTS gateway_events (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT,
        timestamp TEXT,
        stream TEXT,
        channel TEXT,
        direction TEXT,
        message TEXT,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_events_source_key
        ON gateway_events(source_key)
        WHERE source_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_gateway_events_recent
        ON gateway_events(timestamp, created_at_ms);

      CREATE TABLE IF NOT EXISTS diagnostic_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        ended_at TEXT,
        ok INTEGER,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_diagnostic_runs_recent
        ON diagnostic_runs(COALESCE(ended_at, started_at), created_at_ms);

      CREATE TABLE IF NOT EXISTS ledger_imports (
        ledger TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL,
        source_size INTEGER NOT NULL,
        source_mtime_ms INTEGER NOT NULL
      );
    `)
    try {
      database.exec('ALTER TABLE gateway_events ADD COLUMN source_key TEXT;')
    } catch {
      // Existing databases already have the legacy import key column.
    }
    importLegacyJsonlLedgers(database, currentPaths)
    return database
  } catch (error) {
    sqliteUnavailableReason = error instanceof Error && error.message ? error.message : String(error)
    try {
      database?.close?.()
    } catch {
      // Ignore close failures on a failed open path.
    }
    database = null
    return null
  }
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function booleanField(value: Record<string, unknown>, key: string) {
  const field = value[key]
  return typeof field === 'boolean' ? field : null
}

function parsedDateMs(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = stringField(value, key)
    if (!raw) continue
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function sourceKeyForJsonlLine(ledger: string, line: string) {
  return `jsonl:${ledger}:${createHash('sha256').update(line).digest('hex')}`
}

function insertSqliteLedgerInto(
  db: SqliteDatabase,
  kind: LedgerKind,
  value: Record<string, unknown>,
  options: { createdAtMs?: number; sourceKey?: string } = {},
) {
  const payload = JSON.stringify(value)
  const createdAtMs = options.createdAtMs ?? Date.now()
  if (kind === 'runtime_run') {
    db.prepare(`
      INSERT OR REPLACE INTO runtime_runs
        (id, started_at, ended_at, status, agent_id, session_id, created_at_ms, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stringField(value, 'id') || randomUUID(),
      stringField(value, 'startedAt'),
      stringField(value, 'endedAt'),
      stringField(value, 'status'),
      stringField(value, 'agentId'),
      stringField(value, 'sessionId'),
      createdAtMs,
      payload,
    )
    return true
  }

  if (kind === 'gateway_event') {
    db.prepare(`
      INSERT OR IGNORE INTO gateway_events
        (source_key, timestamp, stream, channel, direction, message, created_at_ms, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      options.sourceKey || null,
      stringField(value, 'timestamp'),
      stringField(value, 'stream'),
      stringField(value, 'channel'),
      stringField(value, 'direction'),
      stringField(value, 'message'),
      createdAtMs,
      payload,
    )
    return true
  }

  db.prepare(`
    INSERT OR REPLACE INTO diagnostic_runs
      (id, started_at, ended_at, ok, created_at_ms, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    stringField(value, 'id') || randomUUID(),
    stringField(value, 'startedAt'),
    stringField(value, 'endedAt'),
    booleanField(value, 'ok') === null ? null : booleanField(value, 'ok') ? 1 : 0,
    createdAtMs,
    payload,
  )
  return true
}

function insertSqliteLedger(kind: LedgerKind, value: Record<string, unknown>) {
  const db = openDatabase()
  if (!db) return false
  return insertSqliteLedgerInto(db, kind, value)
}

function legacyImportIsCurrent(db: SqliteDatabase, ledger: string, sourceSize: number, sourceMtimeMs: number) {
  const row = db.prepare(`
    SELECT source_size, source_mtime_ms
    FROM ledger_imports
    WHERE ledger = ?
  `).get?.(ledger)
  return Boolean(row && Number(row.source_size) === sourceSize && Number(row.source_mtime_ms) === sourceMtimeMs)
}

function markLegacyImportCurrent(db: SqliteDatabase, ledger: string, sourceSize: number, sourceMtimeMs: number) {
  db.prepare(`
    INSERT OR REPLACE INTO ledger_imports
      (ledger, imported_at, source_size, source_mtime_ms)
    VALUES (?, ?, ?, ?)
  `).run(ledger, new Date().toISOString(), sourceSize, sourceMtimeMs)
}

function gatewayPayloadExists(db: SqliteDatabase, payload: string) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM gateway_events
      WHERE payload_json = ?
      LIMIT 1
    `).get?.(payload),
  )
}

function importLegacyJsonlLedger(db: SqliteDatabase, ledger: string, filePath: string, kind: LedgerKind) {
  if (!existsSync(filePath)) return
  const stat = statSync(filePath)
  const sourceMtimeMs = Math.round(stat.mtimeMs)
  if (legacyImportIsCurrent(db, ledger, stat.size, sourceMtimeMs)) return

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/)
  db.exec('BEGIN IMMEDIATE;')
  try {
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        const canonicalPayload = JSON.stringify(parsed)
        if (kind === 'gateway_event' && gatewayPayloadExists(db, canonicalPayload)) return
        const createdAtMs =
          parsedDateMs(parsed, 'endedAt', 'startedAt', 'timestamp') ?? stat.mtimeMs + index
        insertSqliteLedgerInto(db, kind, parsed, {
          createdAtMs,
          sourceKey: kind === 'gateway_event' ? sourceKeyForJsonlLine(ledger, canonicalPayload) : undefined,
        })
      } catch {
        // Skip malformed legacy JSONL rows without blocking SQLite startup.
      }
    })
    markLegacyImportCurrent(db, ledger, stat.size, sourceMtimeMs)
    db.exec('COMMIT;')
  } catch (error) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      // Ignore rollback failures; the import is best-effort.
    }
    throw error
  }
}

function importLegacyJsonlLedgers(db: SqliteDatabase, currentPaths: LedgerPaths) {
  try {
    importLegacyJsonlLedger(db, 'runtime-runs', currentPaths.runtimeRunsJsonl, 'runtime_run')
    importLegacyJsonlLedger(db, 'gateway-events', currentPaths.gatewayEventsJsonl, 'gateway_event')
    importLegacyJsonlLedger(db, 'diagnostic-runs', currentPaths.diagnosticRunsJsonl, 'diagnostic_run')
    legacyImportWarning = ''
  } catch (error) {
    legacyImportWarning = error instanceof Error && error.message ? error.message : String(error)
  }
}

function parsePayloadRows<T>(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => {
      try {
        return JSON.parse(String(row.payload_json || '')) as T
      } catch {
        return null
      }
    })
    .filter((value): value is T => Boolean(value))
}

async function appendLedger(kind: LedgerKind, value: Record<string, unknown>, jsonlPath: string, options: LedgerAppendOptions = {}) {
  await fs.mkdir(configuredPaths().directory, { recursive: true })
  const wroteSqlite = options.sqlite === false ? false : insertSqliteLedger(kind, value)
  if (!wroteSqlite || options.mirrorJsonl !== false) {
    await appendJsonlLedger(jsonlPath, value)
  }
}

export async function appendRuntimeRunLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('runtime_run', value, configuredPaths().runtimeRunsJsonl, options)
}

export async function appendGatewayEventLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('gateway_event', value, configuredPaths().gatewayEventsJsonl, options)
}

export async function appendDiagnosticRunLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('diagnostic_run', value, configuredPaths().diagnosticRunsJsonl, options)
}

export async function readRuntimeRunLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    const rows = db.prepare(`
      SELECT payload_json
      FROM runtime_runs
      ORDER BY COALESCE(ended_at, started_at) DESC, created_at_ms DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    if (records.length) return records
  }

  return readJsonlLedgerTail<T>(currentPaths.runtimeRunsJsonl, limit)
}

export async function readGatewayEventLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    const rows = db.prepare(`
      SELECT payload_json
      FROM gateway_events
      ORDER BY timestamp DESC, created_at_ms DESC, rowid DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(1000, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    if (records.length) return records
  }

  return readJsonlLedgerTail<T>(currentPaths.gatewayEventsJsonl, limit)
}

export async function readDiagnosticRunLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    const rows = db.prepare(`
      SELECT payload_json
      FROM diagnostic_runs
      ORDER BY COALESCE(ended_at, started_at) DESC, created_at_ms DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    if (records.length) return records
  }

  return readJsonlLedgerTail<T>(currentPaths.diagnosticRunsJsonl, limit)
}

export function runtimeLedgerStatus(options: LedgerReadOptions = {}) {
  const currentPaths = configuredPaths()
  const skipSqlite = options.sqlite === false
  return {
    sqlitePath: currentPaths.sqlite,
    sqliteAvailable: skipSqlite ? false : Boolean(openDatabase()),
    fallback: skipSqlite ? 'skipped for non-blocking status snapshot' : sqliteUnavailableReason || null,
    legacyImportWarning: legacyImportWarning || null,
  }
}

export function closeRuntimeLedger() {
  try {
    database?.close?.()
  } catch {
    // Ignore close errors during app shutdown.
  } finally {
    database = null
  }
}

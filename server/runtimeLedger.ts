import { createRequire } from 'node:module'
import path from 'node:path'
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { reconcileLedgerRecords } from './services/filesystem/ledgerReconciliation'

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
  missionRecordsJsonl: string
  missionEventsJsonl: string
  missionReportsJsonl: string
}

type LedgerKind = 'runtime_run' | 'gateway_event' | 'diagnostic_run' | 'mission_record' | 'mission_event' | 'mission_report'

type LedgerAppendOptions = {
  mirrorJsonl?: boolean
  sqlite?: boolean
}

type LedgerReadOptions = {
  sqlite?: boolean
  missionId?: string
}

type ControlCenterStateWriteOptions = {
  sourcePath?: string
  sqlite?: boolean
}

type AgencyTemplateCatalogLike = {
  schemaVersion?: number
  source?: unknown
  divisions?: unknown
  templates?: unknown
}

type JsonlTailDiagnostic = {
  ledger: string
  filePath: string
  startOffset: number
  malformedRows: number
  discardedPartialLine: boolean
  message: string
}

const optionalRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
const LEDGER_TAIL_MAX_BYTES = 512 * 1024

let paths: LedgerPaths | null = null
let database: SqliteDatabase | null = null
let sqliteUnavailableReason = ''
let sqliteWriteWarning = ''
let legacyImportWarning = ''
let jsonlTailDiagnostic: JsonlTailDiagnostic | null = null
let legacyImportTimer: NodeJS.Timeout | null = null
let legacyImportScheduled = false
const preparedStatements = new WeakMap<SqliteDatabase, Map<string, SqliteStatement>>()
const appendQueues = new Map<string, Promise<void>>()

function preparedStatement(db: SqliteDatabase, sql: string) {
  let cache = preparedStatements.get(db)
  if (!cache) { cache = new Map(); preparedStatements.set(db, cache) }
  let statement = cache.get(sql)
  if (!statement) { statement = db.prepare(sql); cache.set(sql, statement) }
  return statement
}

export function configureRuntimeLedger(input: Omit<LedgerPaths, 'sqlite'> & { sqlite?: string }) {
  const nextPaths = {
    ...input,
    sqlite: input.sqlite || path.join(input.directory, 'control-center.sqlite'),
  }
  if (database && paths?.sqlite !== nextPaths.sqlite) closeRuntimeLedger()
  paths = nextPaths
  sqliteUnavailableReason = ''
  sqliteWriteWarning = ''
  legacyImportWarning = ''
  jsonlTailDiagnostic = null
  if (legacyImportTimer) clearTimeout(legacyImportTimer)
  legacyImportTimer = null
  legacyImportScheduled = false
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

function normalizedTailLimit(limit: number) {
  return Math.max(1, Math.min(1000, Math.round(Number.isFinite(limit) ? limit : 1)))
}

function recordJsonlTailDiagnostic(diagnostic: JsonlTailDiagnostic | null) {
  jsonlTailDiagnostic = diagnostic
  if (diagnostic?.malformedRows) {
    console.warn(`[automnia] ${diagnostic.message}`)
  }
}

async function readJsonlLedgerTail<T>(ledger: string, filePath: string, limit: number): Promise<T[]> {
  const normalizedLimit = normalizedTailLimit(limit)
  try {
    const stat = await fs.stat(filePath)
    const start = Math.max(0, stat.size - LEDGER_TAIL_MAX_BYTES)
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(stat.size - start)
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, start + bytesRead)
        if (!read.bytesRead) break
        bytesRead += read.bytesRead
      }
      let text = buffer.subarray(0, bytesRead).toString('utf-8')
      let discardedPartialLine = false
      const previousByte = Buffer.alloc(1)
      if (start > 0) await handle.read(previousByte, 0, 1, start - 1)
      if (start > 0 && previousByte[0] !== 10) {
        const firstNewlineIndex = text.search(/\r?\n/)
        if (firstNewlineIndex === -1) {
          recordJsonlTailDiagnostic({
            ledger,
            filePath,
            startOffset: start,
            malformedRows: 0,
            discardedPartialLine: true,
            message: `Discarded partial JSONL tail for ${ledger} at offset ${start}; no complete rows were present.`,
          })
          return []
        }
        const newlineLength = text[firstNewlineIndex] === '\r' && text[firstNewlineIndex + 1] === '\n' ? 2 : 1
        text = text.slice(firstNewlineIndex + newlineLength)
        discardedPartialLine = true
      }

      let malformedRows = 0
      const records = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce<T[]>((acc, line) => {
          try {
            acc.push(JSON.parse(line) as T)
          } catch {
            malformedRows += 1
          }
          return acc
        }, [])

      recordJsonlTailDiagnostic(
        discardedPartialLine || malformedRows
          ? {
              ledger,
              filePath,
              startOffset: start,
              malformedRows,
              discardedPartialLine,
              message: `Skipped ${malformedRows} malformed JSONL row(s) while reading ${ledger} from offset ${start}.`,
            }
          : null,
      )
      return records.slice(-normalizedLimit)
    } finally {
      await handle.close()
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError?.code !== 'ENOENT') {
      recordJsonlTailDiagnostic({
        ledger,
        filePath,
        startOffset: 0,
        malformedRows: 0,
        discardedPartialLine: false,
        message: `Failed to read JSONL ledger ${ledger}: ${nodeError?.message || String(error)}`,
      })
    }
    return []
  }
}

async function readMissionJsonlLedgerTail<T>(ledger: string, filePath: string, limit: number, missionId?: string): Promise<T[]> {
  if (!missionId) return readJsonlLedgerTail<T>(ledger, filePath, limit)
  const normalizedLimit = Math.max(1, Math.min(2000, Math.round(Number.isFinite(limit) ? limit : 1)))
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  let malformedRows = 0
  let offset = 0
  try {
    handle = await fs.open(filePath, 'r')
    offset = (await handle.stat()).size
    let partialLine = Buffer.alloc(0)
    const newest: T[] = []
    const accept = (line: Buffer) => {
      const text = line.toString('utf-8').trim()
      if (!text) return
      try {
        const record = JSON.parse(text) as Record<string, unknown> | null
        if (record && record.missionId === missionId) newest.push(record as T)
      } catch {
        malformedRows += 1
      }
    }
    // Search backwards in bounded chunks. A busy unrelated mission must not
    // displace this mission's history from either the row or byte tail limit.
    while (offset > 0 && newest.length < normalizedLimit) {
      const start = Math.max(0, offset - LEDGER_TAIL_MAX_BYTES)
      const chunk = Buffer.alloc(offset - start)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start)
      const data = Buffer.concat([chunk.subarray(0, bytesRead), partialLine])
      let end = data.length
      while (end > 0 && newest.length < normalizedLimit) {
        const newline = data.lastIndexOf(0x0a, end - 1)
        if (newline < 0) break
        accept(data.subarray(newline + 1, end))
        end = newline
      }
      partialLine = data.subarray(0, end)
      offset = start
      if (offset === 0 && newest.length < normalizedLimit) accept(partialLine)
    }
    recordJsonlTailDiagnostic(malformedRows ? {
      ledger, filePath, startOffset: offset, malformedRows, discardedPartialLine: false,
      message: `Skipped ${malformedRows} malformed JSONL row(s) while reading ${ledger} for mission ${missionId}.`,
    } : null)
    return newest.reverse()
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') recordJsonlTailDiagnostic({
      ledger, filePath, startOffset: offset, malformedRows, discardedPartialLine: false,
      message: `Failed to read JSONL ledger ${ledger}: ${nodeError.message || String(error)}`,
    })
    return []
  } finally {
    await handle?.close()
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
    try {
      chmodSync(path.dirname(currentPaths.sqlite), 0o700)
    } catch {
      // Best effort on platforms/filesystems that do not honor POSIX modes.
    }
    database = new sqlite.DatabaseSync(currentPaths.sqlite)
    try {
      chmodSync(currentPaths.sqlite, 0o600)
    } catch {
      // Best effort on platforms/filesystems that do not honor POSIX modes.
    }
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

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

      CREATE TABLE IF NOT EXISTS mission_records (
        mission_id TEXT PRIMARY KEY,
        status TEXT,
        lifecycle_state TEXT,
        updated_at TEXT,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mission_records_recent
        ON mission_records(updated_at, created_at_ms);

      CREATE TABLE IF NOT EXISTS mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        timestamp TEXT,
        actor TEXT,
        previous_state TEXT,
        next_state TEXT,
        event_type TEXT,
        idempotency_key TEXT,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_events_idempotency
        ON mission_events(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_mission_events_recent
        ON mission_events(mission_id, timestamp, created_at_ms);

      CREATE TABLE IF NOT EXISTS mission_reports (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        generated_at TEXT,
        created_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mission_reports_recent
        ON mission_reports(generated_at, created_at_ms);

      CREATE TABLE IF NOT EXISTS ledger_imports (
        ledger TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL,
        source_size INTEGER NOT NULL,
        source_mtime_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS control_center_state (
        namespace TEXT NOT NULL,
        state_key TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        source_path TEXT,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (namespace, state_key)
      );
      CREATE INDEX IF NOT EXISTS idx_control_center_state_recent
        ON control_center_state(namespace, updated_at_ms);

      CREATE TABLE IF NOT EXISTS agency_agent_template_catalogs (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        divisions_json TEXT NOT NULL,
        template_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agency_agent_templates (
        id TEXT PRIMARY KEY,
        slug TEXT,
        name TEXT,
        description TEXT,
        division TEXT,
        division_label TEXT,
        color TEXT,
        relative_path TEXT,
        source_url TEXT,
        behavior_profile TEXT,
        level INTEGER,
        tools_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        documents_json TEXT NOT NULL,
        source_markdown TEXT,
        source_commit TEXT,
        sort_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_agent_templates_division
        ON agency_agent_templates(division, name);
      CREATE INDEX IF NOT EXISTS idx_agency_agent_templates_search
        ON agency_agent_templates(name, description, division_label);
    `)
    // Older installations predate source_key. Inspect the schema before
    // creating its index; creating the index first prevents those databases
    // from opening and never reaches the migration.
    database.exec('BEGIN IMMEDIATE;')
    try {
      const columns = database.prepare('PRAGMA table_info(gateway_events)').all()
      if (!columns.some((column) => column.name === 'source_key')) {
        database.exec('ALTER TABLE gateway_events ADD COLUMN source_key TEXT;')
      }
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_events_source_key
          ON gateway_events(source_key)
          WHERE source_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_mission_reports_mission_recent
          ON mission_reports(mission_id, generated_at, created_at_ms);
        COMMIT;
      `)
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }
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
    preparedStatement(db, `
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
    preparedStatement(db, `
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

  if (kind === 'mission_record') {
    preparedStatement(db, `
      INSERT OR REPLACE INTO mission_records
        (mission_id, status, lifecycle_state, updated_at, created_at_ms, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      stringField(value, 'missionId') || stringField(value, 'id') || randomUUID(),
      stringField(value, 'status'),
      stringField(value, 'lifecycleState'),
      stringField(value, 'updatedAt'),
      createdAtMs,
      payload,
    )
    return true
  }

  if (kind === 'mission_event') {
    preparedStatement(db, `
      INSERT OR IGNORE INTO mission_events
        (id, mission_id, timestamp, actor, previous_state, next_state, event_type, idempotency_key, created_at_ms, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stringField(value, 'id') || randomUUID(),
      stringField(value, 'missionId'),
      stringField(value, 'timestamp') || stringField(value, 'at'),
      stringField(value, 'actor'),
      stringField(value, 'previousState'),
      stringField(value, 'nextState'),
      stringField(value, 'type'),
      stringField(value, 'idempotencyKey'),
      createdAtMs,
      payload,
    )
    return true
  }

  if (kind === 'mission_report') {
    preparedStatement(db, `
      INSERT OR REPLACE INTO mission_reports
        (id, mission_id, generated_at, created_at_ms, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      stringField(value, 'id') || randomUUID(),
      stringField(value, 'missionId'),
      stringField(value, 'generatedAt'),
      createdAtMs,
      payload,
    )
    return true
  }

  preparedStatement(db, `
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
  try {
    return insertSqliteLedgerInto(db, kind, value, {
      sourceKey: kind === 'gateway_event' ? sourceKeyForJsonlLine('gateway-events', JSON.stringify(value)) : undefined,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    sqliteWriteWarning = `SQLite ${kind} write failed; using JSONL fallback: ${reason}`
    return false
  }
}

function legacyImportIsCurrent(db: SqliteDatabase, ledger: string, sourceSize: number, sourceMtimeMs: number) {
  const row = preparedStatement(db, `
    SELECT source_size, source_mtime_ms
    FROM ledger_imports
    WHERE ledger = ?
  `).get?.(ledger)
  return Boolean(row && Number(row.source_size) === sourceSize && Number(row.source_mtime_ms) === sourceMtimeMs)
}

function markLegacyImportCurrent(db: SqliteDatabase, ledger: string, sourceSize: number, sourceMtimeMs: number) {
  preparedStatement(db, `
    INSERT OR REPLACE INTO ledger_imports
      (ledger, imported_at, source_size, source_mtime_ms)
    VALUES (?, ?, ?, ?)
  `).run(ledger, new Date().toISOString(), sourceSize, sourceMtimeMs)
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
    importLegacyJsonlLedger(db, 'mission-records', currentPaths.missionRecordsJsonl, 'mission_record')
    importLegacyJsonlLedger(db, 'mission-events', currentPaths.missionEventsJsonl, 'mission_event')
    importLegacyJsonlLedger(db, 'mission-reports', currentPaths.missionReportsJsonl, 'mission_report')
    legacyImportWarning = ''
  } catch (error) {
    legacyImportWarning = error instanceof Error && error.message ? error.message : String(error)
  }
}

/**
 * Import historical JSONL data only after the HTTP server is accepting
 * connections. Older releases did this work in the first state read, which
 * could make the desktop app look offline for minutes on a large ledger.
 */
export function scheduleLegacyRuntimeLedgerImport(delayMs = 10_000) {
  if (legacyImportScheduled) return
  legacyImportScheduled = true
  const normalizedDelayMs = Math.max(0, Math.min(60_000, Math.round(delayMs) || 0))
  legacyImportTimer = setTimeout(() => {
    legacyImportTimer = null
    try {
      const db = openDatabase()
      if (db) importLegacyJsonlLedgers(db, configuredPaths())
    } catch (error) {
      legacyImportWarning = error instanceof Error && error.message ? error.message : String(error)
      console.warn(`[automnia] legacy ledger migration deferred after failure: ${legacyImportWarning}`)
    }
  }, normalizedDelayMs)
  legacyImportTimer.unref?.()
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

function normalizedStateCoordinate(value: string, label: string) {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(normalized)) {
    throw new Error(`Invalid control center state ${label}: ${value}`)
  }
  return normalized
}

export function readControlCenterState<T>(
  namespace: string,
  stateKey: string,
  options: LedgerReadOptions = {},
): T | null {
  const db = options.sqlite === false ? null : openDatabase()
  if (!db) return null
  try {
    const row = preparedStatement(db, `
      SELECT payload_json
      FROM control_center_state
      WHERE namespace = ? AND state_key = ?
    `).get?.(
      normalizedStateCoordinate(namespace, 'namespace'),
      normalizedStateCoordinate(stateKey, 'key'),
    )
    const payload = row && typeof row.payload_json === 'string' ? row.payload_json : ''
    if (!payload) return null
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}

export function writeControlCenterState(
  namespace: string,
  stateKey: string,
  value: unknown,
  options: ControlCenterStateWriteOptions = {},
) {
  const db = options.sqlite === false ? null : openDatabase()
  if (!db) return false
  let payload = ''
  try {
    payload = JSON.stringify(value)
  } catch {
    return false
  }
  if (!payload) return false
  try {
    const now = new Date()
    preparedStatement(db, `
      INSERT INTO control_center_state
        (namespace, state_key, updated_at, updated_at_ms, source_path, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, state_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        updated_at_ms = excluded.updated_at_ms,
        source_path = excluded.source_path,
        payload_json = excluded.payload_json
    `).run(
      normalizedStateCoordinate(namespace, 'namespace'),
      normalizedStateCoordinate(stateKey, 'key'),
      now.toISOString(),
      now.getTime(),
      options.sourcePath || null,
      payload,
    )
    return true
  } catch {
    return false
  }
}

export function deleteControlCenterState(
  namespace: string,
  stateKey: string,
  options: LedgerReadOptions = {},
) {
  const db = options.sqlite === false ? null : openDatabase()
  if (!db) return false
  try {
    preparedStatement(db, `
      DELETE FROM control_center_state
      WHERE namespace = ? AND state_key = ?
    `).run(
      normalizedStateCoordinate(namespace, 'namespace'),
      normalizedStateCoordinate(stateKey, 'key'),
    )
    return true
  } catch {
    return false
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function jsonValue(value: unknown) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return 'null'
  }
}

export function writeAgencyAgentTemplateCatalog(
  catalog: AgencyTemplateCatalogLike,
  options: LedgerReadOptions = {},
) {
  const db = options.sqlite === false ? null : openDatabase()
  if (!db || catalog.schemaVersion !== 1) return false
  const templates = arrayValue(catalog.templates)
  const source = recordValue(catalog.source)
  const sourceCommit = typeof source.commit === 'string' ? source.commit : null
  const now = new Date()

  try {
    db.exec('BEGIN IMMEDIATE;')
    preparedStatement(db, `
      INSERT INTO agency_agent_template_catalogs
        (id, schema_version, source_json, divisions_json, template_count, updated_at, updated_at_ms)
      VALUES ('current', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        source_json = excluded.source_json,
        divisions_json = excluded.divisions_json,
        template_count = excluded.template_count,
        updated_at = excluded.updated_at,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      1,
      jsonValue(catalog.source || {}),
      jsonValue(catalog.divisions || {}),
      templates.length,
      now.toISOString(),
      now.getTime(),
    )
    preparedStatement(db, 'DELETE FROM agency_agent_templates').run()

    const insert = preparedStatement(db, `
      INSERT INTO agency_agent_templates
        (
          id, slug, name, description, division, division_label, color, relative_path, source_url,
          behavior_profile, level, tools_json, capabilities_json, documents_json, source_markdown,
          source_commit, sort_index, updated_at, updated_at_ms, payload_json
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    templates.forEach((templateValue, index) => {
      const template = recordValue(templateValue)
      const defaults = recordValue(template.defaults)
      insert.run(
        stringField(template, 'id') || randomUUID(),
        stringField(template, 'slug'),
        stringField(template, 'name'),
        stringField(template, 'description'),
        stringField(template, 'division'),
        stringField(template, 'divisionLabel'),
        stringField(template, 'color'),
        stringField(template, 'relativePath'),
        stringField(template, 'sourceUrl'),
        stringField(defaults, 'behaviorProfile'),
        Number.isFinite(Number(defaults.level)) ? Math.round(Number(defaults.level)) : null,
        jsonValue(defaults.tools || []),
        jsonValue(defaults.capabilities || {}),
        jsonValue(template.documents || []),
        stringField(template, 'sourceMarkdown'),
        sourceCommit,
        index,
        now.toISOString(),
        now.getTime(),
        jsonValue(template),
      )
    })

    db.exec('COMMIT;')
    return true
  } catch {
    try {
      db.exec('ROLLBACK;')
    } catch {
      // Ignore rollback failures on failed catalog writes.
    }
    return false
  }
}

export function readAgencyAgentTemplateCatalog<T>(options: LedgerReadOptions = {}): T | null {
  const db = options.sqlite === false ? null : openDatabase()
  if (!db) return null
  try {
    const meta = preparedStatement(db, `
      SELECT schema_version, source_json, divisions_json
      FROM agency_agent_template_catalogs
      WHERE id = 'current'
    `).get?.()
    if (!meta || Number(meta.schema_version) !== 1) return null
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM agency_agent_templates
      ORDER BY sort_index ASC, division ASC, name ASC
    `).all()
    const templates = parsePayloadRows<unknown>(rows)
    return {
      schemaVersion: 1,
      source: JSON.parse(String(meta.source_json || '{}')),
      divisions: JSON.parse(String(meta.divisions_json || '{}')),
      templates,
    } as T
  } catch {
    return null
  }
}

async function appendLedger(kind: LedgerKind, value: Record<string, unknown>, jsonlPath: string, options: LedgerAppendOptions = {}) {
  const snapshot = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  const queued = (appendQueues.get(jsonlPath) || Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(jsonlPath), { recursive: true })
    const wroteSqlite = options.sqlite === false ? false : insertSqliteLedger(kind, snapshot)
    if (!wroteSqlite || options.mirrorJsonl !== false) await appendJsonlLedger(jsonlPath, snapshot)
  })
  appendQueues.set(jsonlPath, queued)
  try { await queued } finally { if (appendQueues.get(jsonlPath) === queued) appendQueues.delete(jsonlPath) }
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

export async function appendMissionRecordLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('mission_record', value, configuredPaths().missionRecordsJsonl, options)
}

export async function appendMissionEventLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('mission_event', value, configuredPaths().missionEventsJsonl, options)
}

export async function appendMissionReportLedger(value: Record<string, unknown>, options?: LedgerAppendOptions) {
  await appendLedger('mission_report', value, configuredPaths().missionReportsJsonl, options)
}

export async function readRuntimeRunLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM runtime_runs
      ORDER BY COALESCE(ended_at, started_at) DESC, created_at_ms DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readJsonlLedgerTail<T>('runtime-runs', currentPaths.runtimeRunsJsonl, limit)
    return reconcileLedgerRecords(records, fallback, limit, 'id')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readJsonlLedgerTail<T>('runtime-runs', currentPaths.runtimeRunsJsonl, limit)
}

export async function readGatewayEventLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM gateway_events
      ORDER BY timestamp DESC, created_at_ms DESC, rowid DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(1000, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readJsonlLedgerTail<T>('gateway-events', currentPaths.gatewayEventsJsonl, limit)
    return reconcileLedgerRecords(records, fallback, limit, 'id')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readJsonlLedgerTail<T>('gateway-events', currentPaths.gatewayEventsJsonl, limit)
}

export async function readDiagnosticRunLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM diagnostic_runs
      ORDER BY COALESCE(ended_at, started_at) DESC, created_at_ms DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.round(limit))))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readJsonlLedgerTail<T>('diagnostic-runs', currentPaths.diagnosticRunsJsonl, limit)
    return reconcileLedgerRecords(records, fallback, limit, 'id')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readJsonlLedgerTail<T>('diagnostic-runs', currentPaths.diagnosticRunsJsonl, limit)
}

export async function readMissionRecordLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM mission_records
      ${options.missionId ? 'WHERE mission_id = ?' : ''}
      ORDER BY updated_at DESC, created_at_ms DESC
      LIMIT ?
    `).all(...(options.missionId ? [options.missionId] : []), normalizedTailLimit(limit))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readMissionJsonlLedgerTail<T>('mission-records', currentPaths.missionRecordsJsonl, limit, options.missionId)
    return reconcileLedgerRecords(records, fallback, limit, 'missionId')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readMissionJsonlLedgerTail<T>('mission-records', currentPaths.missionRecordsJsonl, limit, options.missionId)
}

export async function readMissionEventLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM mission_events
      ${options.missionId ? 'WHERE mission_id = ?' : ''}
      ORDER BY timestamp DESC, created_at_ms DESC
      LIMIT ?
    `).all(...(options.missionId ? [options.missionId] : []), Math.max(1, Math.min(2000, Math.round(Number.isFinite(limit) ? limit : 1))))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readMissionJsonlLedgerTail<T>('mission-events', currentPaths.missionEventsJsonl, limit, options.missionId)
    return reconcileLedgerRecords(records, fallback, limit, 'id')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readMissionJsonlLedgerTail<T>('mission-events', currentPaths.missionEventsJsonl, limit, options.missionId)
}

/** Complete evidence for a single report, independent of the bounded live feed. */
export async function readAllMissionEvents<T>(missionId: string): Promise<T[]> {
  const currentPaths = configuredPaths()
  await appendQueues.get(currentPaths.missionEventsJsonl)
  const records: T[] = []
  const db = openDatabase()
  if (db) {
    const maximum = Number(preparedStatement(db, 'SELECT MAX(rowid) AS last FROM mission_events WHERE mission_id = ?').get?.(missionId)?.last || 0)
    let cursor = 0
    while (cursor < maximum) {
      const rows = preparedStatement(db, 'SELECT rowid AS cursor, payload_json FROM mission_events WHERE mission_id = ? AND rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 500').all(missionId, cursor, maximum)
      if (!rows.length) break
      for (const row of rows) records.push(JSON.parse(String(row.payload_json)) as T)
      cursor = Number(rows.at(-1)?.cursor)
      // Never hold a transaction or monopolize the event loop across batches.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  const fallback: T[] = []
  const input = createReadStream(currentPaths.missionEventsJsonl, { encoding: 'utf8', highWaterMark: 64 * 1024 })
  let pending = ''
  const accept = (line: string) => {
    if (!line.trim()) return
    const value = JSON.parse(line) as Record<string, unknown>
    if (value && value.missionId === missionId) fallback.push(value as T)
  }
  try {
    for await (const chunk of input) {
      pending += chunk
      let end = pending.indexOf('\n')
      while (end >= 0) { accept(pending.slice(0, end)); pending = pending.slice(end + 1); end = pending.indexOf('\n') }
      if (pending.length > 2 * 1024 * 1024) throw new Error('Mission evidence contains an oversized record; report generation paused.')
    }
    accept(pending)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  } finally { input.destroy() }
  return reconcileLedgerRecords(records, fallback, Number.MAX_SAFE_INTEGER)
}

export async function readMissionReportLedgerTail<T>(limit: number, options: LedgerReadOptions = {}): Promise<T[]> {
  const currentPaths = configuredPaths()
  const db = options.sqlite === false ? null : openDatabase()
  if (db) {
    try {
    const rows = preparedStatement(db, `
      SELECT payload_json
      FROM mission_reports
      ${options.missionId ? 'WHERE mission_id = ?' : ''}
      ORDER BY generated_at DESC, created_at_ms DESC
      LIMIT ?
    `).all(...(options.missionId ? [options.missionId] : []), normalizedTailLimit(limit))
    const records = parsePayloadRows<T>(rows).reverse()
    const fallback = await readMissionJsonlLedgerTail<T>('mission-reports', currentPaths.missionReportsJsonl, limit, options.missionId)
    return reconcileLedgerRecords(records, fallback, limit, 'id')
    } catch (error) {
      sqliteWriteWarning = `SQLite read failed; using JSONL fallback: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return readMissionJsonlLedgerTail<T>('mission-reports', currentPaths.missionReportsJsonl, limit, options.missionId)
}

export function runtimeLedgerStatus(options: LedgerReadOptions = {}) {
  const currentPaths = configuredPaths()
  const skipSqlite = options.sqlite === false
  return {
    sqlitePath: currentPaths.sqlite,
    sqliteAvailable: skipSqlite ? false : Boolean(openDatabase()),
    fallback: skipSqlite ? 'skipped for non-blocking status snapshot' : sqliteUnavailableReason || null,
    sqliteWriteWarning: sqliteWriteWarning || null,
    legacyImportWarning: legacyImportWarning || null,
    jsonlTailDiagnostic,
  }
}

export function closeRuntimeLedger() {
  try {
    if (database) preparedStatements.delete(database)
    database?.close?.()
  } catch {
    // Ignore close errors during app shutdown.
  } finally {
    database = null
  }
}

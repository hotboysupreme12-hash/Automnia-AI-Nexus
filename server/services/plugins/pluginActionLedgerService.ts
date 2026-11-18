import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type PluginActionKind = 'install' | 'update' | 'update-all' | 'uninstall' | 'repair' | 'enable' | 'disable' | 'configure' | 'gateway-restart' | 'setup-terminal'
export type PluginActionOutcome = 'started' | 'succeeded' | 'failed' | 'uncertain'

export type PluginActionLedgerEntry = {
  id: string
  actionId: string
  timestamp: string
  pluginId: string
  action: PluginActionKind
  outcome: PluginActionOutcome
  failureClass?: string
  idempotencyKey?: string
  attempt?: number
  retryable?: boolean
  terminal?: boolean
  summary?: string
}

export const PLUGIN_ACTION_LEDGER_LIMITS = {
  maxReadBytes: 2 * 1024 * 1024,
  maxEntryBytes: 8 * 1024,
  maxReadEntries: 500,
  maxRepairScanEntries: 120_000,
  maxFileBytes: 16 * 1024 * 1024,
} as const

const appendQueues = new Map<string, Promise<void>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEntry(value: unknown): PluginActionLedgerEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length > 80 || typeof value.actionId !== 'string' || value.actionId.length > 80) return null
  if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))) return null
  if (typeof value.pluginId !== 'string' || (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value.pluginId) && value.pluginId !== '*')) return null
  if (typeof value.action !== 'string' || typeof value.outcome !== 'string') return null
  if (!['install', 'update', 'update-all', 'uninstall', 'repair', 'enable', 'disable', 'configure', 'gateway-restart', 'setup-terminal'].includes(value.action)) return null
  if (!['started', 'succeeded', 'failed', 'uncertain'].includes(value.outcome)) return null
  if (value.attempt !== undefined && (!Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1 || Number(value.attempt) > 3)) return null
  if (value.retryable !== undefined && typeof value.retryable !== 'boolean') return null
  if (value.terminal !== undefined && typeof value.terminal !== 'boolean') return null
  return {
    id: value.id,
    actionId: value.actionId,
    timestamp: value.timestamp,
    pluginId: value.pluginId,
    action: value.action as PluginActionKind,
    outcome: value.outcome as PluginActionOutcome,
    ...(value.failureClass === 'loader_error' ? { failureClass: value.failureClass } : {}),
    ...(typeof value.idempotencyKey === 'string' && /^[a-f0-9]{64}$/u.test(value.idempotencyKey) ? { idempotencyKey: value.idempotencyKey } : {}),
    ...(typeof value.attempt === 'number' ? { attempt: value.attempt } : {}),
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
    ...(typeof value.terminal === 'boolean' ? { terminal: value.terminal } : {}),
    ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 240) } : {}),
  }
}

export function createPluginActionLedgerService(filePath: string, now: () => Date = () => new Date()) {
  const resolvedPath = path.resolve(filePath)

  async function readEntries(maxBytes: number, limit: number): Promise<PluginActionLedgerEntry[]> {
    const maxEntries = Math.max(1, Math.min(PLUGIN_ACTION_LEDGER_LIMITS.maxRepairScanEntries, Math.round(limit) || 1))
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      const linkStat = await fs.lstat(resolvedPath)
      if (!linkStat.isFile() || linkStat.size <= 0) return []
      handle = await fs.open(resolvedPath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.dev !== linkStat.dev || stat.ino !== linkStat.ino) return []
      const bytesToRead = Math.min(stat.size, maxBytes)
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead))
      let text = buffer.subarray(0, bytesRead).toString('utf8')
      if (stat.size > bytesToRead) {
        const firstNewline = text.indexOf('\n')
        text = firstNewline < 0 ? '' : text.slice(firstNewline + 1)
      }
      return text.split(/\r?\n/u)
        .filter(Boolean)
        .slice(-maxEntries)
        .map((line) => {
          try { return normalizeEntry(JSON.parse(line) as unknown) } catch { return null }
        })
        .filter((entry): entry is PluginActionLedgerEntry => Boolean(entry))
    } catch {
      return []
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async function readTail(limit = 100): Promise<PluginActionLedgerEntry[]> {
    const maxEntries = Math.max(1, Math.min(PLUGIN_ACTION_LEDGER_LIMITS.maxReadEntries, Math.round(limit) || 1))
    return readEntries(PLUGIN_ACTION_LEDGER_LIMITS.maxReadBytes, maxEntries)
  }

  async function append(entry: Omit<PluginActionLedgerEntry, 'id' | 'timestamp'>): Promise<PluginActionLedgerEntry> {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(entry.pluginId) && entry.pluginId !== '*') {
      throw new Error('Plugin action ledger requires a safe plugin id.')
    }
    if (entry.failureClass !== undefined && entry.failureClass !== 'loader_error') {
      throw new Error('Plugin action ledger received an unsupported failure class.')
    }
    if (entry.idempotencyKey !== undefined && !/^[a-f0-9]{64}$/u.test(entry.idempotencyKey)) {
      throw new Error('Plugin action ledger received an invalid idempotency key.')
    }
    if (entry.summary !== undefined && entry.summary.length > 240) throw new Error('Plugin action ledger summary exceeds its size limit.')
    const record: PluginActionLedgerEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: now().toISOString(),
    }
    const line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line, 'utf8') > PLUGIN_ACTION_LEDGER_LIMITS.maxEntryBytes) {
      throw new Error('Plugin action ledger entry exceeds its size limit.')
    }
    const queued = (appendQueues.get(resolvedPath) || Promise.resolve()).catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
      const current = await fs.lstat(resolvedPath).catch(() => null)
      if (current && (!current.isFile() || current.size + Buffer.byteLength(line, 'utf8') > PLUGIN_ACTION_LEDGER_LIMITS.maxFileBytes)) {
        throw new Error('Plugin action ledger is unavailable or full.')
      }
      await fs.appendFile(resolvedPath, line, { encoding: 'utf8', flag: 'a' })
    })
    appendQueues.set(resolvedPath, queued)
    try { await queued } finally { if (appendQueues.get(resolvedPath) === queued) appendQueues.delete(resolvedPath) }
    return record
  }

  async function findLatestRepair(idempotencyKey: string) {
    const entries = await readEntries(PLUGIN_ACTION_LEDGER_LIMITS.maxFileBytes, PLUGIN_ACTION_LEDGER_LIMITS.maxRepairScanEntries)
    return entries.slice().reverse().find((entry) => entry.action === 'repair' && entry.idempotencyKey === idempotencyKey) || null
  }

  async function readRepairHistory(idempotencyKey: string): Promise<{ entries: PluginActionLedgerEntry[]; complete: boolean }> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      const linkStat = await fs.lstat(resolvedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!linkStat) return { entries: [], complete: true }
      if (!linkStat.isFile() || linkStat.size > PLUGIN_ACTION_LEDGER_LIMITS.maxFileBytes) return { entries: [], complete: false }
      handle = await fs.open(resolvedPath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.dev !== linkStat.dev || stat.ino !== linkStat.ino || stat.size > PLUGIN_ACTION_LEDGER_LIMITS.maxFileBytes) {
        return { entries: [], complete: false }
      }
      const buffer = Buffer.alloc(stat.size)
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0)
      if (bytesRead !== stat.size) return { entries: [], complete: false }
      const text = buffer.toString('utf8')
      if (text && !text.endsWith('\n')) return { entries: [], complete: false }
      const lines = text.split(/\r?\n/u).filter(Boolean)
      if (lines.length > PLUGIN_ACTION_LEDGER_LIMITS.maxRepairScanEntries) return { entries: [], complete: false }
      const entries: PluginActionLedgerEntry[] = []
      for (const line of lines) {
        let parsed: unknown
        try { parsed = JSON.parse(line) as unknown } catch { return { entries: [], complete: false } }
        const entry = normalizeEntry(parsed)
        if (!entry) return { entries: [], complete: false }
        if (entry.action === 'repair' && entry.idempotencyKey === idempotencyKey) entries.push(entry)
      }
      return { entries, complete: true }
    } catch {
      return { entries: [], complete: false }
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  return { append, findLatestRepair, readRepairHistory, readTail, path: resolvedPath }
}

export type PluginActionLedgerService = ReturnType<typeof createPluginActionLedgerService>

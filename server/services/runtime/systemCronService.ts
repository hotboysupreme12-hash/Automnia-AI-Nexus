import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { RuntimeCronJobSummary } from '../../shiftContracts'

type SystemCronEntry = {
  schedule: string
  command: string
  comment: string
}

export type SystemCronServiceOptions = {
  platform?: NodeJS.Platform
  now?: () => number
  readCrontab?: () => string
  redactSensitiveText?: (value: string) => string
}

function isCronField(value: string): boolean {
  return /^[\w*/?,\-]+$/u.test(value)
}

function cleanComment(value: string): string {
  return value
    .replace(/^#+\s*/u, '')
    .replace(/^\d+[.)]\s*/u, '')
    .replace(/\s+-\s+run\b.*$/iu, '')
    .trim()
}

function fallbackJobName(command: string): string {
  const executable = command.trim().split(/\s+/u)[0]?.replace(/^['"]|['"]$/gu, '') || ''
  return path.basename(executable) || 'System cron job'
}

function parseCrontabEntry(line: string, comment: string): SystemCronEntry | null {
  const fields = line.trim().split(/\s+/u)
  if (fields.length < 2) return null

  if (/^@(?:reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)$/iu.test(fields[0])) {
    const command = fields.slice(1).join(' ').trim()
    return command ? { schedule: fields[0], command, comment } : null
  }

  if (fields.length < 6 || !fields.slice(0, 5).every(isCronField)) return null
  const command = fields.slice(5).join(' ').trim()
  if (!command) return null
  return { schedule: fields.slice(0, 5).join(' '), command, comment }
}

export function parseSystemCrontab(value: string): SystemCronEntry[] {
  const entries: SystemCronEntry[] = []
  let pendingComment = ''

  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      pendingComment = cleanComment(line)
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(line)) {
      pendingComment = ''
      continue
    }

    const entry = parseCrontabEntry(line, pendingComment)
    pendingComment = ''
    if (entry) entries.push(entry)
  }

  return entries
}

function cadenceForSchedule(schedule: string): string {
  const normalized = schedule.trim().toLowerCase()
  if (normalized === '@hourly' || normalized === '0 * * * *') return '1h'
  if (normalized === '@daily' || normalized === '@midnight' || normalized === '0 0 * * *') return '1d'
  if (normalized === '@weekly' || normalized === '0 0 * * 0') return '1w'

  const minuteInterval = normalized.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/u)
  if (minuteInterval) return `${minuteInterval[1]}m`
  const hourInterval = normalized.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/u)
  if (hourInterval) return `${hourInterval[1]}h`
  return schedule
}

function systemCronId(entry: SystemCronEntry, index: number): string {
  const digest = createHash('sha1')
    .update(`${index}\n${entry.schedule}\n${entry.command}`)
    .digest('hex')
    .slice(0, 16)
  return `system-cron-${digest}`
}

export function createSystemCronService(options: SystemCronServiceOptions = {}) {
  const platform = options.platform || process.platform
  const now = options.now || Date.now
  const redactSensitiveText = options.redactSensitiveText || ((value: string) => value)
  const readCrontab = options.readCrontab || (() => {
    if (platform === 'win32') return ''
    const result = spawnSync('crontab', ['-l'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    return result.status === 0 && typeof result.stdout === 'string' ? result.stdout : ''
  })

  function listJobs(): RuntimeCronJobSummary[] {
    if (platform === 'win32') return []
    const startedAt = new Date(now()).toISOString()
    return parseSystemCrontab(readCrontab()).map((entry, index) => {
      const comment = cleanComment(entry.comment)
      const name = comment || fallbackJobName(entry.command)
      const message = redactSensitiveText(entry.command)
      return {
        id: systemCronId(entry, index),
        cronId: systemCronId(entry, index),
        source: 'system-cron',
        status: 'active',
        name,
        agent: 'system',
        every: cadenceForSchedule(entry.schedule),
        durationMinutes: 0,
        message,
        startedAt,
        endsAt: null,
        nextRunAt: null,
        scheduleKind: 'cron',
        scheduleLabel: entry.schedule,
        payloadKind: 'command',
        lastError: null,
      }
    })
  }

  return { listJobs }
}

export type ShiftScheduleKind = 'every' | 'cron' | 'at'

export type ShiftScheduleValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; error: string }

export type ShiftScheduleDisplayInput = {
  every: string
  scheduleKind?: string
  scheduleLabel?: string
  source?: 'control-center' | 'openclaw' | 'system-cron'
  systemOwned?: boolean
}

export type TeamAgentSchedulePreview = {
  agentId: string
  isLead: boolean
  scheduleKind: ShiftScheduleKind
  schedule: string
  staggered: boolean
}

const CRON_MACRO_SCHEDULES = new Set([
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@midnight',
  '@hourly',
])

const CRON_MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

const CRON_DOW_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

type CronFieldKind = 'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow'

const CRON_FIELD_BOUNDS: Record<CronFieldKind, { min: number; max: number }> = {
  second: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 7 },
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return isLeap ? 29 : 28
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function parseCronAtom(atom: string, kind: CronFieldKind): number | null {
  const upper = atom.toUpperCase()
  if (kind === 'month' && Object.prototype.hasOwnProperty.call(CRON_MONTH_ALIASES, upper)) {
    return CRON_MONTH_ALIASES[upper]
  }
  if (kind === 'dow' && Object.prototype.hasOwnProperty.call(CRON_DOW_ALIASES, upper)) {
    return CRON_DOW_ALIASES[upper]
  }
  if (!/^\d{1,2}$/.test(atom)) return null
  const numeric = Number.parseInt(atom, 10)
  const { min, max } = CRON_FIELD_BOUNDS[kind]
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null
  return numeric
}

function isValidCronFieldSegment(segment: string, kind: CronFieldKind): boolean {
  if (!segment || segment.startsWith('-') || segment.endsWith('-') || segment.startsWith('/') || segment.endsWith('/')) {
    return false
  }
  const slashParts = segment.split('/')
  if (slashParts.length > 2) return false
  const [base, stepRaw] = slashParts
  const { min, max } = CRON_FIELD_BOUNDS[kind]
  const maxStep = max - min + 1

  if (stepRaw !== undefined) {
    if (!/^\d{1,2}$/.test(stepRaw)) return false
    const step = Number.parseInt(stepRaw, 10)
    if (!Number.isFinite(step) || step < 1 || step > maxStep) return false
  }

  if (base === '*') return true
  if (base === '?') return (kind === 'dom' || kind === 'dow') && stepRaw === undefined

  const upperBase = base.toUpperCase()
  if (kind === 'dom' && stepRaw === undefined) {
    if (upperBase === 'L' || upperBase === 'LW') return true
    const lastOffsetMatch = upperBase.match(/^L-(\d{1,2})$/)
    if (lastOffsetMatch) {
      const offset = Number.parseInt(lastOffsetMatch[1], 10)
      return offset >= 1 && offset <= 30
    }
    const weekdayMatch = upperBase.match(/^(\d{1,2})W$/)
    if (weekdayMatch) {
      const dom = Number.parseInt(weekdayMatch[1], 10)
      return dom >= 1 && dom <= 31
    }
  }

  if (kind === 'dow' && stepRaw === undefined) {
    if (upperBase === 'L') return true
    if (upperBase.endsWith('L')) {
      return parseCronAtom(upperBase.slice(0, -1), 'dow') !== null
    }
    const nthMatch = upperBase.match(/^([A-Z0-9]+)#([1-5])$/)
    if (nthMatch) {
      return parseCronAtom(nthMatch[1], 'dow') !== null
    }
  }

  const rangeParts = base.split('-')
  if (rangeParts.length === 1) return parseCronAtom(rangeParts[0], kind) !== null
  if (rangeParts.length === 2) {
    const start = parseCronAtom(rangeParts[0], kind)
    const end = parseCronAtom(rangeParts[1], kind)
    if (start === null || end === null) return false
    return kind === 'dow' ? true : start <= end
  }
  return false
}

export function validateClientShiftSchedule(
  kind: ShiftScheduleKind,
  rawValue: string,
): ShiftScheduleValidationResult {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return { valid: false, error: 'Enter a schedule value before starting.' }
  }
  if (trimmed.length > 240 || trimmed.startsWith('-') || hasControlChars(trimmed)) {
    return { valid: false, error: 'Schedule cannot start with "-" or contain control characters.' }
  }

  if (kind === 'every') {
    const lower = trimmed.toLowerCase()
    const match = lower.match(/^(\d{1,6})([smhdw])$/)
    const amount = match ? Number.parseInt(match[1], 10) : 0
    if (!match || !Number.isFinite(amount) || amount <= 0) {
      return { valid: false, error: 'Use an interval like 15m, 2h, 1d, or 1w.' }
    }
    return { valid: true, normalized: `${amount}${match[2]}` }
  }

  if (kind === 'cron') {
    const lower = trimmed.toLowerCase()
    if (CRON_MACRO_SCHEDULES.has(lower)) return { valid: true, normalized: lower }
    const fields = trimmed.split(/\s+/)
    const kinds: CronFieldKind[] | null =
      fields.length === 5
        ? ['minute', 'hour', 'dom', 'month', 'dow']
        : fields.length === 6
          ? ['second', 'minute', 'hour', 'dom', 'month', 'dow']
          : null
    if (!kinds) {
      return { valid: false, error: 'Use a 5- or 6-field cron expression (e.g. 0,20,40 * * * *).' }
    }
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index]
      if (!field || field.startsWith(',') || field.endsWith(',')) {
        return { valid: false, error: `Invalid cron ${kinds[index]} field "${field}".` }
      }
      if (!field.split(',').every((seg) => isValidCronFieldSegment(seg, kinds[index]))) {
        return { valid: false, error: `Invalid cron ${kinds[index]} field "${field}".` }
      }
    }
    return { valid: true, normalized: fields.join(' ') }
  }

  const relativeMatch = trimmed.match(/^\+?(\d{1,9})([smhdw])$/iu)
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { valid: false, error: 'Relative offset must be positive (e.g. +15m or +2h).' }
    }
    return { valid: true, normalized: `+${amount}${relativeMatch[2].toLowerCase()}` }
  }

  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))?)?$/u,
  )
  if (!isoMatch) {
    return { valid: false, error: 'Use a relative offset like +15m or ISO-8601 timestamp like 2026-11-27T04:00:00Z.' }
  }
  const year = Number.parseInt(isoMatch[1], 10)
  const month = Number.parseInt(isoMatch[2], 10)
  const day = Number.parseInt(isoMatch[3], 10)
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysInGregorianMonth(year, month)) {
    return { valid: false, error: 'Calendar date in ISO-8601 schedule is out of range.' }
  }
  if (isoMatch[4] !== undefined) {
    const hour = Number.parseInt(isoMatch[4], 10)
    const minute = Number.parseInt(isoMatch[5], 10)
    const second = isoMatch[6] !== undefined ? Number.parseInt(isoMatch[6], 10) : 0
    if (hour > 23 || minute > 59 || second > 59) {
      return { valid: false, error: 'Time component in ISO-8601 schedule is out of range.' }
    }
    if (isoMatch[9] !== undefined) {
      const tzHour = Number.parseInt(isoMatch[9], 10)
      const tzMinute = Number.parseInt(isoMatch[10], 10)
      if (tzHour > 23 || tzMinute > 59) {
        return { valid: false, error: 'Timezone offset in ISO-8601 schedule is out of range.' }
      }
    }
  }
  const normalizedIso = trimmed.replace(/\s+/, 'T')
  if (!Number.isFinite(Date.parse(normalizedIso))) {
    return { valid: false, error: 'Could not parse ISO-8601 timestamp.' }
  }
  return { valid: true, normalized: normalizedIso }
}

export function buildClientStaggeredCronExpression(
  interval: string,
  agentIndex: number,
  agentCount: number,
  staggerMinutes?: number,
): string | null {
  if (!Number.isFinite(agentIndex) || !Number.isFinite(agentCount) || agentIndex < 0 || agentCount < 1) {
    return null
  }
  if (
    staggerMinutes !== undefined &&
    (!Number.isFinite(staggerMinutes) || staggerMinutes < 1 || staggerMinutes > 59)
  ) {
    return null
  }
  const match = interval.trim().toLowerCase().match(/^(\d+)([smhdw])$/)
  if (!match) return null
  const amount = Number.parseInt(match[1], 10)
  const unit = match[2]
  if (!Number.isFinite(amount) || amount <= 0) return null

  const safeCount = Math.max(1, Math.trunc(agentCount))
  const safeIndex = Math.max(0, Math.trunc(agentIndex))

  if (unit === 'm') {
    if (amount < 60) {
      if (60 % amount !== 0) return null
      const roundedStep = Math.round(amount / safeCount)
      const defaultStep =
        roundedStep >= 1 && roundedStep * (safeCount - 1) < amount
          ? roundedStep
          : Math.max(1, Math.floor(amount / safeCount))
      const stepOffset = staggerMinutes !== undefined ? Math.max(1, Math.trunc(staggerMinutes)) : defaultStep
      const baseMinute = (safeIndex * stepOffset) % amount
      const minutes: number[] = []
      for (let minute = baseMinute; minute < 60; minute += amount) {
        minutes.push(minute)
      }
      return `${minutes.join(',')} * * * *`
    }
    if (amount % 60 === 0) {
      const hours = amount / 60
      if (hours >= 1 && hours <= 23) {
        const stepOffset =
          staggerMinutes !== undefined
            ? Math.max(1, Math.trunc(staggerMinutes))
            : Math.max(1, Math.floor(60 / safeCount))
        const minute = (safeIndex * stepOffset) % 60
        return `${minute} ${hours === 1 ? '*' : `*/${hours}`} * * *`
      }
    }
    return null
  }

  if (unit === 'h') {
    if (amount < 1 || amount > 23) return null
    const stepOffset =
      staggerMinutes !== undefined
        ? Math.max(1, Math.trunc(staggerMinutes))
        : Math.max(1, Math.floor(60 / safeCount))
    const minute = (safeIndex * stepOffset) % 60
    return `${minute} ${amount === 1 ? '*' : `*/${amount}`} * * *`
  }

  return null
}

export function computeTeamStaggerPreview(params: {
  agentIds: string[]
  leadAgent: string
  leadEvery: string
  workerEvery: string
  stagger: boolean
  staggerMinutes?: number
}): TeamAgentSchedulePreview[] {
  const uniqueAgents = Array.from(new Set(params.agentIds.map((id) => id.trim()).filter(Boolean)))
  return uniqueAgents.map((agentId, agentIndex) => {
    const isLead = agentId === params.leadAgent
    const baseInterval = isLead ? params.leadEvery : params.workerEvery
    if (params.stagger && uniqueAgents.length > 1) {
      const staggeredCron = buildClientStaggeredCronExpression(
        baseInterval,
        agentIndex,
        uniqueAgents.length,
        params.staggerMinutes,
      )
      if (staggeredCron) {
        return {
          agentId,
          isLead,
          scheduleKind: 'cron',
          schedule: staggeredCron,
          staggered: true,
        }
      }
    }
    return {
      agentId,
      isLead,
      scheduleKind: 'every',
      schedule: baseInterval,
      staggered: false,
    }
  })
}

export function formatShiftScheduleSummary(shift: ShiftScheduleDisplayInput): string {
  const value = (shift.scheduleLabel || shift.every || '').trim() || 'unknown'
  if (shift.scheduleKind === 'cron') return `Cron: ${value}`
  if (shift.scheduleKind === 'at') return `At: ${value}`
  return `Every: ${value}`
}

export function canStopShiftInControlCenter(shift: Pick<ShiftScheduleDisplayInput, 'source'>): boolean {
  return shift.source !== 'system-cron'
}

export function canRunShiftNow(shift: Pick<ShiftScheduleDisplayInput, 'source' | 'systemOwned'>): boolean {
  return shift.source !== 'system-cron' && !shift.systemOwned
}

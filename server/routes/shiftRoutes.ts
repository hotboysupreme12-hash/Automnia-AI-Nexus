import { createHash, randomUUID } from 'node:crypto'
import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { computeShiftDurationMinutes } from '../shiftContracts'
import { CREDITS_ONLY_MODEL_ACCESS_MESSAGE } from '../services/license/creditsOnlyModelPolicy'
import type {
  HeartbeatRuntimeDefaults,
  RuntimeCronJobSummary,
  Shift,
  StartShiftPayload,
} from '../shiftContracts'

type OpenClawCommandResult = {
  stdout: string
  stderr: string
  code: number
}

type HeartbeatRuntimePerAgentStore = Record<string, Partial<HeartbeatRuntimeDefaults>>

type ShiftRoutesOptions = {
  activeShifts: Map<string, Shift>
  clearShiftRuntimeState: (shift: Shift) => void
  createShiftFromPayload: (input: StartShiftPayload) => Promise<Shift>
  invalidateRuntimeStatusCache: () => void
  isValidAgentId: (agentId: string) => boolean
  listActiveCronJobViews: () => { active: RuntimeCronJobSummary[]; error?: string }
  mergeHeartbeatRuntimeDefaults: (
    base: HeartbeatRuntimeDefaults,
    patch?: Partial<HeartbeatRuntimeDefaults>,
  ) => HeartbeatRuntimeDefaults
  modelSelectionBlocked?: (modelId: string) => string | null
  readHeartbeatRuntimeDefaults: () => Promise<HeartbeatRuntimeDefaults>
  readHeartbeatRuntimePerAgent: () => Promise<HeartbeatRuntimePerAgentStore>
  runOpenClaw: (args: string[], timeoutMs?: number) => Promise<OpenClawCommandResult>
  stopSystemOwnedCronJob?: (cronId: string) => Promise<void>
  startManagedTeamSyncOrchestrator: (input: {
    batchId: string
    runId: string
    targetFile: string
    leadAgent: string
    shifts: Shift[]
    durationMinutes: number
    leadEvery: string
    workerEvery: string
  }) => Promise<void>
  sweepExpiredMissionCronJobs: (reason: string) => Promise<unknown>
  writeHeartbeatRuntimeDefaults: (defaults: HeartbeatRuntimeDefaults) => Promise<void>
  writeHeartbeatRuntimePerAgent: (store: HeartbeatRuntimePerAgentStore) => Promise<void>
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

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isSafeCliOptionValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-') || hasControlChars(trimmed)) return false
  return true
}

function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return isLeap ? 29 : 28
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

export function normalizeAtScheduleValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 240 || trimmed.startsWith('-') || hasControlChars(trimmed)) return null

  const relativeMatch = trimmed.match(/^\+?(\d{1,9})([smhdw])$/iu)
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return `+${amount}${relativeMatch[2].toLowerCase()}`
  }

  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))?)?$/u,
  )
  if (!isoMatch) return null

  const year = Number.parseInt(isoMatch[1], 10)
  const month = Number.parseInt(isoMatch[2], 10)
  const day = Number.parseInt(isoMatch[3], 10)
  if (year < 1970 || month < 1 || month > 12) return null
  if (day < 1 || day > daysInGregorianMonth(year, month)) return null

  if (isoMatch[4] !== undefined) {
    const hour = Number.parseInt(isoMatch[4], 10)
    const minute = Number.parseInt(isoMatch[5], 10)
    const second = isoMatch[6] !== undefined ? Number.parseInt(isoMatch[6], 10) : 0
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
    if (isoMatch[9] !== undefined) {
      const tzHour = Number.parseInt(isoMatch[9], 10)
      const tzMinute = Number.parseInt(isoMatch[10], 10)
      if (tzHour < 0 || tzHour > 23 || tzMinute < 0 || tzMinute > 59) return null
    }
  }

  const normalizedIso = trimmed.replace(/\s+/, 'T')
  if (!Number.isFinite(Date.parse(normalizedIso))) return null
  return normalizedIso
}

export function isValidAtScheduleValue(value: string): boolean {
  return normalizeAtScheduleValue(value) !== null
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
      const prefix = upperBase.slice(0, -1)
      return parseCronAtom(prefix, 'dow') !== null
    }
    const nthMatch = upperBase.match(/^([A-Z0-9]+)#([1-5])$/)
    if (nthMatch) {
      return parseCronAtom(nthMatch[1], 'dow') !== null
    }
  }

  const rangeParts = base.split('-')
  if (rangeParts.length === 1) {
    return parseCronAtom(rangeParts[0], kind) !== null
  }
  if (rangeParts.length === 2) {
    const start = parseCronAtom(rangeParts[0], kind)
    const end = parseCronAtom(rangeParts[1], kind)
    if (start === null || end === null) return false
    if (kind === 'dow') return true
    return start <= end
  }
  return false
}

function isValidCronField(field: string, kind: CronFieldKind): boolean {
  if (!field || field.startsWith(',') || field.endsWith(',')) return false
  const segments = field.split(',')
  return segments.every((segment) => isValidCronFieldSegment(segment, kind))
}

export function normalizeCronScheduleExpression(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 240 || trimmed.startsWith('-') || hasControlChars(trimmed)) return null
  const lower = trimmed.toLowerCase()
  if (CRON_MACRO_SCHEDULES.has(lower)) return lower
  const fields = trimmed.split(/\s+/)
  const kinds: CronFieldKind[] | null =
    fields.length === 5
      ? ['minute', 'hour', 'dom', 'month', 'dow']
      : fields.length === 6
        ? ['second', 'minute', 'hour', 'dom', 'month', 'dow']
        : null
  if (!kinds) return null
  for (let index = 0; index < fields.length; index += 1) {
    if (!isValidCronField(fields[index], kinds[index])) return null
  }
  return fields.join(' ')
}

export function isValidCronScheduleExpression(value: string): boolean {
  return normalizeCronScheduleExpression(value) !== null
}

export function buildStaggeredCronExpression(
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
    if (amount < 1) return null
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

function isValidCronJobId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,180}$/.test(value)
}

export function normalizeEveryScheduleValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32 || trimmed.startsWith('-') || hasControlChars(trimmed)) return null
  const match = trimmed.match(/^(\d{1,6})([smhdw])$/iu)
  if (!match) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return `${amount}${match[2].toLowerCase()}`
}

export function isValidEveryScheduleValue(value: string): boolean {
  return normalizeEveryScheduleValue(value) !== null
}

function normalizeCronEveryEditInput(value: string): string | null {
  const clean = value.trim().toLowerCase().replace(/^every\s+/, '').replace(/\s+/g, ' ')
  const compact = clean.replace(/\s+/g, '')
  const direct = normalizeEveryScheduleValue(compact)
  if (direct) return direct
  const match = clean.match(/^(\d{1,6})\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/)
  if (!match) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]
  const normalizedUnit = unit.startsWith('s') ? 's' : unit.startsWith('m') ? 'm' : unit.startsWith('h') ? 'h' : unit.startsWith('d') ? 'd' : 'w'
  return `${amount}${normalizedUnit}`
}

export function registerShiftRoutes(app: Express, options: ShiftRoutesOptions) {
  const {
    activeShifts,
    clearShiftRuntimeState,
    createShiftFromPayload,
    invalidateRuntimeStatusCache,
    isValidAgentId,
    listActiveCronJobViews,
    mergeHeartbeatRuntimeDefaults,
    modelSelectionBlocked,
    readHeartbeatRuntimeDefaults,
    readHeartbeatRuntimePerAgent,
    runOpenClaw,
    stopSystemOwnedCronJob,
    startManagedTeamSyncOrchestrator,
    sweepExpiredMissionCronJobs,
    writeHeartbeatRuntimeDefaults,
    writeHeartbeatRuntimePerAgent,
  } = options

  const updateActiveShiftFromCronEdit = (
    shift: Shift | undefined,
    patch: { name?: string; scheduleKind?: 'every' | 'cron' | 'at'; schedule?: string; message?: string },
  ) => {
    if (!shift) return
    const next: Shift = {
      ...shift,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.schedule ? { every: patch.schedule } : {}),
      ...(patch.scheduleKind ? { scheduleKind: patch.scheduleKind } : {}),
      ...(patch.schedule ? { scheduleLabel: patch.schedule } : {}),
      ...(patch.message ? { message: patch.message } : {}),
    }
    activeShifts.set(shift.id, next)
  }

  const normalizeScheduleByKind = (
    kind: 'every' | 'cron' | 'at',
    rawValue: string,
  ): string | null => {
    const trimmed = rawValue.trim()
    if (!trimmed) return null
    if (kind === 'every') return normalizeEveryScheduleValue(trimmed)
    if (kind === 'cron') return normalizeCronScheduleExpression(trimmed)
    return normalizeAtScheduleValue(trimmed)
  }

  app.post('/api/shifts/start', async (req, res) => {
    const schema = z.object({
      idempotencyKey: z.string().min(8).max(200).optional(),
      name: z.string().min(1).max(80),
      agent: z.string().min(1).optional(),
      every: z.string().min(1).max(32).optional(),
      scheduleKind: z.enum(['every', 'cron', 'at']).optional(),
      schedule: z.string().min(1).max(240).optional(),
      durationMinutes: z.number().int().min(1).max(10080).optional(),
      durationValue: z.number().int().min(1).max(10080).optional(),
      durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks']).optional(),
      message: z.string().min(5),
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
    }).superRefine((payload, context) => {
      if (!isSafeCliOptionValue(payload.name)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Shift name must be non-empty and cannot start with "-" or contain control characters' })
      }
      if (payload.model !== undefined && (!isSafeCliOptionValue(payload.model) || payload.model.trim().length < 3)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'Model id cannot start with "-" or contain control characters' })
      }
      if (payload.every !== undefined && !isValidEveryScheduleValue(payload.every)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['every'], message: 'Use a positive interval like 15m, 2h, 1d, or 1w' })
      }
      const kind = payload.scheduleKind || 'every'
      const schedule = payload.schedule?.trim() || payload.every?.trim()
      if (!schedule) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'A schedule value is required' })
        return
      }
      if (kind === 'every' && !isValidEveryScheduleValue(schedule)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use an interval like 15m, 2h, 1d, or 1w' })
      }
      if (kind === 'cron' && !isValidCronScheduleExpression(schedule)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use a valid 5- or 6-field cron expression (for example: 0,20,40 * * * *)' })
      }
      if (kind === 'at' && !isValidAtScheduleValue(schedule)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use a relative offset like +15m or an ISO-8601 timestamp like 2026-06-22T12:00:00Z' })
      }
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const normalizedAgent = parsed.data.agent?.trim()
    if (normalizedAgent && !isValidAgentId(normalizedAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')
    }
    const normalizedModel = parsed.data.model?.trim()
    if (normalizedModel && modelSelectionBlocked?.(normalizedModel)) {
      return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE)
    }

    const resolvedKind = parsed.data.scheduleKind || 'every'
    const rawSchedule = parsed.data.schedule?.trim() || parsed.data.every?.trim() || ''
    const normalizedSchedule = normalizeScheduleByKind(resolvedKind, rawSchedule)
    if (!normalizedSchedule) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid schedule value')
    }

    try {
      const shift = await createShiftFromPayload({
        ...parsed.data,
        name: parsed.data.name.trim(),
        ...(normalizedAgent ? { agent: normalizedAgent } : {}),
        ...(normalizedModel ? { model: normalizedModel } : {}),
        ...(resolvedKind === 'every'
          ? { every: normalizedSchedule, scheduleKind: 'every', schedule: normalizedSchedule }
          : { scheduleKind: resolvedKind, schedule: normalizedSchedule }),
      })
      return apiSuccess(res, { shift })
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) return apiFailure(res, 409, 'resource_conflict', error instanceof Error ? error.message : 'Job creation is unconfirmed. Check Runtime Monitor.')
      if ((error as { statusCode?: number }).statusCode === 403) {
        return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE)
      }
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to create shift', String(error))
    }
  })

  app.post('/api/shifts/start-batch', async (req, res) => {
    const agentOverrideSchema = z.object({
      name: z.string().min(1).max(80).optional(),
      every: z.string().min(1).max(32).optional(),
      scheduleKind: z.enum(['every', 'cron', 'at']).optional(),
      schedule: z.string().min(1).max(240).optional(),
      message: z.string().min(5).optional(),
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
    }).superRefine((override, context) => {
      if (override.name !== undefined && !isSafeCliOptionValue(override.name)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Shift name cannot start with "-" or contain control characters' })
      }
      if (override.model !== undefined && (!isSafeCliOptionValue(override.model) || override.model.trim().length < 3)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'Model id cannot start with "-" or contain control characters' })
      }
      if (override.every !== undefined && !isValidEveryScheduleValue(override.every)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['every'], message: 'Use a positive interval like 15m, 2h, 1d, or 1w' })
      }
      const overrideSchedule = override.schedule?.trim() || override.every?.trim()
      if (override.scheduleKind && !overrideSchedule) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'A schedule value is required when scheduleKind is set' })
      }
    })

    const resolveOverrideKind = (
      override: { scheduleKind?: 'every' | 'cron' | 'at'; schedule?: string; every?: string },
      batchScheduleKind?: 'every' | 'cron' | 'at',
    ): 'every' | 'cron' | 'at' | undefined => {
      if (override.scheduleKind) return override.scheduleKind
      if (override.every?.trim() && !override.schedule?.trim()) return 'every'
      if (override.schedule?.trim()) return batchScheduleKind || 'cron'
      return undefined
    }

    const schema = z.object({
      idempotencyKey: z.string().min(8).max(200).optional(),
      namePrefix: z.string().min(1).max(80).optional(),
      agentIds: z.array(z.string().min(1)).min(1).max(20),
      leadAgent: z.string().min(1).optional(),
      every: z.string().min(1).max(32).optional(),
      scheduleKind: z.enum(['every', 'cron', 'at']).optional(),
      schedule: z.string().min(1).max(240).optional(),
      leadEvery: z.string().min(1).max(32).optional(),
      workerEvery: z.string().min(1).max(32).optional(),
      stagger: z.boolean().optional(),
      staggerMinutes: z.number().int().min(1).max(59).optional(),
      agentOverrides: z.record(z.string().min(1), agentOverrideSchema).optional(),
      durationMinutes: z.number().int().min(1).max(10080).optional(),
      durationValue: z.number().int().min(1).max(10080).optional(),
      durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks']).optional(),
      message: z.string().min(5).optional(),
      leadMessage: z.string().min(5).optional(),
      workerMessage: z.string().min(5).optional(),
      model: z.string().min(3).max(160).optional(),
      leadModel: z.string().min(3).max(160).optional(),
      workerModel: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      leadSession: z.enum(['main', 'isolated']).optional(),
      workerSession: z.enum(['main', 'isolated']).optional(),
      managedTeamSync: z.boolean().optional(),
      runId: z.string().min(3).max(160).optional(),
      targetFile: z.string().min(1).max(260).optional(),
      announce: z.boolean().optional(),
    }).superRefine((batch, context) => {
      if (batch.namePrefix !== undefined && !isSafeCliOptionValue(batch.namePrefix)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['namePrefix'], message: 'Shift namePrefix cannot start with "-" or contain control characters' })
      }
      if (batch.runId !== undefined && (!isSafeCliOptionValue(batch.runId) || batch.runId.trim().length < 3)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['runId'], message: 'runId cannot start with "-" or contain control characters' })
      }
      if (batch.targetFile !== undefined && (!isSafeCliOptionValue(batch.targetFile) || batch.targetFile.includes('..'))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetFile'], message: 'targetFile cannot contain "..", control characters, or start with "-"' })
      }
      for (const everyField of ['every', 'leadEvery', 'workerEvery'] as const) {
        const val = batch[everyField]
        if (val !== undefined && !isValidEveryScheduleValue(val)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [everyField], message: 'Use a positive interval like 15m, 2h, 1d, or 1w' })
        }
      }
      for (const field of ['model', 'leadModel', 'workerModel'] as const) {
        const val = batch[field]
        if (val !== undefined && (!isSafeCliOptionValue(val) || val.trim().length < 3)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Model id cannot start with "-" or contain control characters' })
        }
      }

      const seenTrimmedOverrideKeys = new Set<string>()
      const trimmedOverrides = new Map<string, NonNullable<typeof batch.agentOverrides>[string]>()
      for (const [rawKey, override] of Object.entries(batch.agentOverrides || {})) {
        const trimmedKey = rawKey.trim()
        if (!trimmedKey) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentOverrides', rawKey], message: 'Override agent id must be non-empty' })
          continue
        }
        if (seenTrimmedOverrideKeys.has(trimmedKey)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentOverrides', rawKey], message: `Duplicate agent override for "${trimmedKey}"` })
          continue
        }
        seenTrimmedOverrideKeys.add(trimmedKey)
        trimmedOverrides.set(trimmedKey, override)

        const overrideSchedule = override.schedule?.trim() || override.every?.trim()
        const overrideKind = resolveOverrideKind(override, batch.scheduleKind)
        if (overrideKind === 'every' && overrideSchedule && !isValidEveryScheduleValue(overrideSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentOverrides', rawKey, 'schedule'], message: 'Use an interval like 15m, 2h, 1d, or 1w' })
        }
        if (overrideKind === 'cron' && overrideSchedule && !isValidCronScheduleExpression(overrideSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentOverrides', rawKey, 'schedule'], message: 'Use a valid 5- or 6-field cron expression' })
        }
        if (overrideKind === 'at' && overrideSchedule && !isValidAtScheduleValue(overrideSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentOverrides', rawKey, 'schedule'], message: 'Use a relative offset like +15m or an ISO-8601 timestamp' })
        }
      }

      const baseKind = batch.scheduleKind || 'every'
      const baseSchedule = batch.schedule?.trim() || batch.every?.trim()
      const uniqueIds = Array.from(new Set(batch.agentIds.map((id) => id.trim()).filter(Boolean)))
      const everyAgentHasExplicitSchedule =
        uniqueIds.length > 0 &&
        uniqueIds.every((id) => {
          const override = trimmedOverrides.get(id)
          return Boolean(override?.schedule?.trim() || override?.every?.trim())
        })
      if (!baseSchedule && !everyAgentHasExplicitSchedule) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['every'],
          message: 'Supply every, schedule, or per-agent schedule overrides for every agent',
        })
        return
      }
      if (baseSchedule) {
        if (baseKind === 'every' && !isValidEveryScheduleValue(baseSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use an interval like 15m, 2h, 1d, or 1w' })
        }
        if (baseKind === 'cron' && !isValidCronScheduleExpression(baseSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use a valid 5- or 6-field cron expression' })
        }
        if (baseKind === 'at' && !isValidAtScheduleValue(baseSchedule)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: 'Use a relative offset like +15m or an ISO-8601 timestamp' })
        }
      }
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    const normalizedOverrides = new Map<string, NonNullable<typeof payload.agentOverrides>[string]>()
    for (const [rawKey, override] of Object.entries(payload.agentOverrides || {})) {
      normalizedOverrides.set(rawKey.trim(), override)
    }

    const overrideModels = Array.from(normalizedOverrides.values()).map((override) => override.model?.trim())
    const blockedModel = [
      payload.model?.trim(),
      payload.leadModel?.trim(),
      payload.workerModel?.trim(),
      ...overrideModels,
    ].find((modelId) => modelId && modelSelectionBlocked?.(modelId))
    if (blockedModel) return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE, { modelId: blockedModel })
    const uniqueAgents = Array.from(new Set(payload.agentIds.map((agentId) => agentId.trim()).filter(Boolean)))
    if (!uniqueAgents.length) return apiFailure(res, 400, 'invalid_payload', 'No valid agent ids supplied')
    const invalidAgent = uniqueAgents.find((agentId) => !isValidAgentId(agentId))
    if (invalidAgent) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id', { agentId: invalidAgent })

    const unknownOverrideAgent = Array.from(normalizedOverrides.keys()).find((agentId) => !uniqueAgents.includes(agentId))
    if (unknownOverrideAgent) {
      return apiFailure(res, 400, 'invalid_payload', 'Agent override target must be included in agentIds', {
        agentId: unknownOverrideAgent,
      })
    }

    const requestedLeadAgent = payload.leadAgent?.trim()
    if (requestedLeadAgent && !isValidAgentId(requestedLeadAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid lead agent id')
    }
    if (requestedLeadAgent && !uniqueAgents.includes(requestedLeadAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Lead agent must be included in agentIds')
    }

    const leadAgent = requestedLeadAgent || uniqueAgents[0]
    const defaultsMessage = payload.message || 'Read TEAM_SYNC.md, execute one concrete assigned task, and update status.'
    const namePrefix = payload.namePrefix?.trim() || 'Heartbeat'
    const baseScheduleKind = payload.scheduleKind || 'every'
    const rawBaseScheduleValue = payload.schedule?.trim() || payload.every?.trim() || '20m'
    const baseScheduleValue = normalizeScheduleByKind(baseScheduleKind, rawBaseScheduleValue) || rawBaseScheduleValue
    const fallbackEveryValue =
      (baseScheduleKind === 'every' ? normalizeEveryScheduleValue(baseScheduleValue) : null) ||
      (payload.every ? normalizeEveryScheduleValue(payload.every) : null) ||
      '20m'
    const leadEvery = (payload.leadEvery ? normalizeEveryScheduleValue(payload.leadEvery) : null) || fallbackEveryValue
    const workerEvery = (payload.workerEvery ? normalizeEveryScheduleValue(payload.workerEvery) : null) || fallbackEveryValue
    const leadSession = payload.leadSession || payload.session || 'main'
    const workerSession = payload.workerSession || 'isolated'
    const leadModel = payload.leadModel?.trim() || payload.model?.trim()
    const workerModel = payload.workerModel?.trim() || payload.model?.trim()
    const staggerRequested = payload.stagger === true || (payload.stagger !== false && payload.staggerMinutes !== undefined)

    const shifts: Shift[] = []
    const errors: Array<{ agentId: string; error: string }> = []
    let entitlementBlocked = false
    const unstartedAgentIds: string[] = []

    for (const [agentIndex, agentId] of uniqueAgents.entries()) {
      const isLead = agentId === leadAgent
      const agentOverride = normalizedOverrides.get(agentId)
      const roleMessage = agentOverride?.message || (isLead ? payload.leadMessage || defaultsMessage : payload.workerMessage || defaultsMessage)
      const shiftName = (agentOverride?.name?.trim() || `${namePrefix}-${agentId}`).slice(0, 80)

      let resolvedScheduleKind: 'every' | 'cron' | 'at' = baseScheduleKind
      let resolvedSchedule = isLead ? leadEvery : workerEvery
      if (baseScheduleKind !== 'every') {
        resolvedSchedule = baseScheduleValue
      }

      if (agentOverride?.schedule?.trim() || agentOverride?.every?.trim()) {
        const rawOverride = (agentOverride.schedule || agentOverride.every || '').trim()
        resolvedScheduleKind = resolveOverrideKind(agentOverride, payload.scheduleKind) || 'every'
        resolvedSchedule = normalizeScheduleByKind(resolvedScheduleKind, rawOverride) || rawOverride
      } else if (staggerRequested && resolvedScheduleKind === 'every' && uniqueAgents.length > 1) {
        const staggeredCron = buildStaggeredCronExpression(
          resolvedSchedule,
          agentIndex,
          uniqueAgents.length,
          payload.staggerMinutes,
        )
        if (staggeredCron) {
          resolvedScheduleKind = 'cron'
          resolvedSchedule = staggeredCron
        }
      }

      try {
        const shift = await createShiftFromPayload({
          ...(payload.idempotencyKey ? { idempotencyKey: `${payload.idempotencyKey}:${agentId}` } : {}),
          name: shiftName,
          agent: agentId,
          ...(resolvedScheduleKind === 'every'
            ? { every: resolvedSchedule, scheduleKind: 'every', schedule: resolvedSchedule }
            : { scheduleKind: resolvedScheduleKind, schedule: resolvedSchedule }),
          durationMinutes: payload.durationMinutes,
          durationValue: payload.durationValue,
          durationUnit: payload.durationUnit,
          message: roleMessage,
          model: agentOverride?.model?.trim() || (isLead ? leadModel : workerModel),
          thinking: agentOverride?.thinking || payload.thinking,
          timeoutSeconds: agentOverride?.timeoutSeconds ?? payload.timeoutSeconds,
          wake: agentOverride?.wake || payload.wake,
          session: agentOverride?.session || (isLead ? leadSession : workerSession),
          announce: agentOverride?.announce ?? payload.announce,
        })
        shifts.push(shift)
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 403) {
          entitlementBlocked = true
          // Preserve the already-created IDs, and stop creating jobs once
          // entitlement changes. The client can retry only these unstarted agents.
          for (const unstarted of uniqueAgents.slice(uniqueAgents.indexOf(agentId))) {
            errors.push({ agentId: unstarted, error: CREDITS_ONLY_MODEL_ACCESS_MESSAGE })
            unstartedAgentIds.push(unstarted)
          }
          break
        }
        errors.push({ agentId, error: String(error) })
      }
    }

    const batchId = payload.idempotencyKey ? createHash('sha256').update(payload.idempotencyKey).digest('hex').slice(0, 32) : randomUUID()
    const managedEnabled = payload.managedTeamSync === true
    let managedStarted = false
    let orchestrationDetail = ''
    const effectiveRunId = (payload.runId || '').trim() || `batch-${batchId}`
    const targetFile = (payload.targetFile || 'collab-site-7m.html').trim()
    if (managedEnabled && shifts.length && !errors.length) {
      try {
      await startManagedTeamSyncOrchestrator({
        batchId,
        runId: effectiveRunId,
        targetFile,
        leadAgent,
        shifts,
        durationMinutes: computeShiftDurationMinutes(payload),
        leadEvery,
        workerEvery,
      })
      managedStarted = true
      } catch {
        orchestrationDetail = 'Team coordination failed to start. Created scheduled jobs remain active; review or stop the listed jobs in Runtime Monitor before retrying coordination.'
      }
    } else if (managedEnabled && errors.length) {
      orchestrationDetail = 'Team coordination did not start because some scheduled jobs could not be created. Created jobs remain active; review or stop the listed jobs in Runtime Monitor.'
    }

    const batchPayload = {
      batchId,
      managedTeamSync: managedStarted,
      outcome: errors.length || orchestrationDetail ? 'partial' : 'complete',
      orchestration: {
        requested: managedEnabled,
        status: managedStarted ? 'running' : managedEnabled ? 'not_started' : 'not_requested',
        jobPolicy: 'preserve-created-jobs',
        affectedShiftIds: shifts.map((shift) => shift.id),
        detail: orchestrationDetail || null,
      },
      unstartedAgentIds,
      unconfirmedAgentIds: errors.map((entry) => entry.agentId).filter((agentId) => !unstartedAgentIds.includes(agentId)),
      runId: effectiveRunId,
      leadAgent,
      startedCount: shifts.length,
      failedCount: errors.length,
      shifts,
      errors,
    }
    if (!shifts.length) {
      if (entitlementBlocked) return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE, batchPayload)
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to start team workflow', batchPayload)
    }
    return apiSuccess(res, batchPayload)
  })

  const isReadOnlySystemCron = (cronId: string, listedJob?: RuntimeCronJobSummary) =>
    listedJob?.source === 'system-cron' || cronId.startsWith('system-cron-')

  app.post('/api/shifts/stop', async (req, res) => {
    const schema = z.object({ shiftId: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const shift = activeShifts.get(parsed.data.shiftId)
    const cronId = shift?.cronId || parsed.data.shiftId.replace(/^cron:/, '').trim()
    if (!isValidCronJobId(cronId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid cron job id')
    }

    const listedJob = listActiveCronJobViews().active.find(
      (job) => job.cronId === cronId || job.id === parsed.data.shiftId,
    )
    if (isReadOnlySystemCron(cronId, listedJob)) {
      return apiFailure(res, 400, 'invalid_payload', 'OS system crontab entries are read-only in Control Center')
    }

    try {
      const result = listedJob?.systemOwned
        ? null
        : await runOpenClaw(['cron', 'disable', cronId], 45000)
      if (listedJob?.systemOwned) {
        if (!stopSystemOwnedCronJob) throw new Error('System-owned monitor jobs cannot be stopped by this runtime.')
        await stopSystemOwnedCronJob(cronId)
      }
      if (result && result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'Failed to disable cron job')
      }
      if (shift) {
        clearShiftRuntimeState(shift)
      } else {
        const matchingShift = Array.from(activeShifts.values()).find((entry) => entry.cronId === cronId)
        if (matchingShift) clearShiftRuntimeState(matchingShift)
      }
      invalidateRuntimeStatusCache()
      return apiSuccess(res, { shiftId: parsed.data.shiftId, cronId })
    } catch (error) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to stop shift', String(error))
    }
  })

  app.post('/api/shifts/run', async (req, res) => {
    const schema = z.object({ shiftId: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const shift = activeShifts.get(parsed.data.shiftId)
    const cronId = shift?.cronId || parsed.data.shiftId.replace(/^cron:/, '').trim()
    if (!isValidCronJobId(cronId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid cron job id')
    }

    const listedJob = listActiveCronJobViews().active.find(
      (job) => job.cronId === cronId || job.id === parsed.data.shiftId,
    )
    if (isReadOnlySystemCron(cronId, listedJob)) {
      return apiFailure(res, 400, 'invalid_payload', 'OS system crontab entries are read-only in Control Center')
    }
    if (listedJob?.systemOwned) {
      return apiFailure(res, 400, 'invalid_payload', 'System-owned monitor jobs cannot be manually triggered here')
    }

    try {
      const result = await runOpenClaw(
        ['cron', 'run', cronId, '--wait', '--expect-final', '--wait-timeout', '120s', '--timeout', '120000'],
        120_000,
      )
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'Failed to run cron job')
      }
      invalidateRuntimeStatusCache()
      return apiSuccess(res, { shiftId: parsed.data.shiftId, cronId, status: 'completed' })
    } catch (error) {
      return apiFailure(res, 502, 'shift_operation_failed', 'Failed to run cron job', String(error))
    }
  })

  app.post('/api/shifts/update', async (req, res) => {
    const schema = z.object({
      shiftId: z.string().min(1),
      name: z.string().min(1).max(80).optional(),
      scheduleKind: z.enum(['every', 'cron', 'at']).optional(),
      schedule: z.string().min(1).max(240).optional(),
      message: z.string().min(1).max(50000).optional(),
      messageMode: z.enum(['message', 'system-event']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    const shift = activeShifts.get(payload.shiftId)
    const cronId = shift?.cronId || payload.shiftId.replace(/^cron:/, '').trim()
    if (!isValidCronJobId(cronId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid cron job id')
    }

    const listedJob = listActiveCronJobViews().active.find(
      (job) => job.cronId === cronId || job.id === payload.shiftId,
    )
    if (isReadOnlySystemCron(cronId, listedJob)) {
      return apiFailure(res, 400, 'invalid_payload', 'OS system crontab entries are read-only in Control Center')
    }

    const args = ['cron', 'edit', cronId]
    const updatePatch: { name?: string; scheduleKind?: 'every' | 'cron' | 'at'; schedule?: string; message?: string } = {}

    if (payload.name !== undefined) {
      const name = payload.name.trim()
      if (!isSafeCliOptionValue(name)) {
        return apiFailure(res, 400, 'invalid_payload', 'Shift name must be non-empty and cannot start with "-" or contain control characters')
      }
      args.push('--name', name)
      updatePatch.name = name
    }

    if (payload.schedule || payload.scheduleKind) {
      if (!payload.schedule || !payload.scheduleKind) {
        return apiFailure(res, 400, 'invalid_payload', 'Schedule kind and value are both required to edit timing')
      }
      const rawSchedule = payload.schedule.trim()
      if (payload.scheduleKind === 'every') {
        const every = normalizeCronEveryEditInput(rawSchedule)
        if (!every) return apiFailure(res, 400, 'invalid_payload', 'Use a simple interval like 10m, 1h, 2d, or 1w.')
        args.push('--every', every)
        updatePatch.schedule = every
      } else if (payload.scheduleKind === 'cron') {
        const normalizedCron = normalizeCronScheduleExpression(rawSchedule)
        if (!normalizedCron) {
          return apiFailure(res, 400, 'invalid_payload', 'Use a valid 5- or 6-field cron expression.')
        }
        args.push('--cron', normalizedCron)
        updatePatch.schedule = normalizedCron
      } else {
        const normalizedAt = normalizeAtScheduleValue(rawSchedule)
        if (!normalizedAt) {
          return apiFailure(res, 400, 'invalid_payload', 'Use a relative offset like +15m or an ISO-8601 timestamp like 2026-06-22T12:00:00Z.')
        }
        args.push('--at', normalizedAt)
        updatePatch.schedule = normalizedAt
      }
      updatePatch.scheduleKind = payload.scheduleKind
    }

    if (payload.message !== undefined) {
      const message = payload.message.trim()
      if (!message) {
        return apiFailure(res, 400, 'invalid_payload', 'Instruction message must be non-empty')
      }
      args.push(payload.messageMode === 'system-event' ? '--system-event' : '--message', message)
      updatePatch.message = message
    }

    if (args.length <= 3) {
      return apiFailure(res, 400, 'invalid_payload', 'No cron job changes supplied')
    }

    try {
      const result = await runOpenClaw(args, 60000)
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || 'Failed to update cron job')
      }
      updateActiveShiftFromCronEdit(shift, updatePatch)
      invalidateRuntimeStatusCache()
      const updated = listActiveCronJobViews().active.find((job) => job.cronId === cronId || job.id === payload.shiftId)
      return apiSuccess(res, { shiftId: payload.shiftId, cronId, shift: updated || null })
    } catch (error) {
      return apiFailure(res, 502, 'shift_command_failed', 'Failed to update cron job', String(error))
    }
  })

  app.get('/api/shifts', async (_req, res) => {
    try {
      await sweepExpiredMissionCronJobs('shifts endpoint mission cron expiry sweep').catch(() => undefined)
      const cronJobs = listActiveCronJobViews()
      return apiSuccess(res, {
        shifts: cronJobs.active,
        ...(cronJobs.error ? { error: cronJobs.error } : {}),
      })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to list shifts', String(error))
    }
  })

  app.get('/api/shifts/defaults', async (_req, res) => {
    try {
      const defaults = await readHeartbeatRuntimeDefaults()
      return apiSuccess(res, { defaults })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to read shift defaults', String(error))
    }
  })

  app.post('/api/shifts/defaults', async (req, res) => {
    const schema = z.object({
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
      leadAgent: z.string().min(1).max(80).optional(),
    }).superRefine((defaultsPatch, context) => {
      if (defaultsPatch.model !== undefined && (!isSafeCliOptionValue(defaultsPatch.model) || defaultsPatch.model.trim().length < 3)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'Model id cannot start with "-" or contain control characters' })
      }
      if (defaultsPatch.leadAgent !== undefined && !isSafeCliOptionValue(defaultsPatch.leadAgent)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['leadAgent'], message: 'Lead agent cannot start with "-" or contain control characters' })
      }
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const normalizedPatch = {
      ...parsed.data,
      ...(parsed.data.model !== undefined ? { model: parsed.data.model.trim() } : {}),
      ...(parsed.data.leadAgent !== undefined ? { leadAgent: parsed.data.leadAgent.trim() } : {}),
    }
    if (normalizedPatch.model && modelSelectionBlocked?.(normalizedPatch.model)) {
      return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE)
    }

    try {
      const current = await readHeartbeatRuntimeDefaults()
      const next = mergeHeartbeatRuntimeDefaults(current, normalizedPatch)
      await writeHeartbeatRuntimeDefaults(next)

      return apiSuccess(res, { defaults: next })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to update shift defaults', String(error))
    }
  })

  app.get('/api/shifts/defaults/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')
    try {
      const globalDefaults = await readHeartbeatRuntimeDefaults()
      const perAgentStore = await readHeartbeatRuntimePerAgent()
      const agentDefaults = perAgentStore[agentId] || {}
      const resolved = mergeHeartbeatRuntimeDefaults(globalDefaults, agentDefaults)
      return apiSuccess(res, { agentId, globalDefaults, agentDefaults, resolved })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to read per-agent shift defaults', String(error))
    }
  })

  app.post('/api/shifts/defaults/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')

    const schema = z.object({
      model: z.string().min(3).max(160).optional(),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      timeoutSeconds: z.number().int().min(30).max(7200).optional(),
      wake: z.enum(['now', 'next-heartbeat']).optional(),
      session: z.enum(['main', 'isolated']).optional(),
      announce: z.boolean().optional(),
      leadAgent: z.string().min(1).max(80).optional(),
      clear: z.boolean().optional(),
    }).superRefine((defaultsPatch, context) => {
      if (defaultsPatch.model !== undefined && (!isSafeCliOptionValue(defaultsPatch.model) || defaultsPatch.model.trim().length < 3)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'Model id cannot start with "-" or contain control characters' })
      }
      if (defaultsPatch.leadAgent !== undefined && !isSafeCliOptionValue(defaultsPatch.leadAgent)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['leadAgent'], message: 'Lead agent cannot start with "-" or contain control characters' })
      }
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const normalizedModel = parsed.data.model?.trim()
    if (normalizedModel && modelSelectionBlocked?.(normalizedModel)) {
      return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE)
    }

    try {
      const perAgent = await readHeartbeatRuntimePerAgent()
      if (parsed.data.clear) {
        delete perAgent[agentId]
      } else {
        const previous = perAgent[agentId] || {}
        const nextPatch: Partial<HeartbeatRuntimeDefaults> = {
          ...previous,
          ...parsed.data,
        }
        delete (nextPatch as Partial<HeartbeatRuntimeDefaults> & { clear?: boolean }).clear
        if (nextPatch.model) nextPatch.model = nextPatch.model.trim()
        if (nextPatch.leadAgent) nextPatch.leadAgent = nextPatch.leadAgent.trim()
        perAgent[agentId] = nextPatch
      }

      await writeHeartbeatRuntimePerAgent(perAgent)
      const globalDefaults = await readHeartbeatRuntimeDefaults()
      const agentDefaults = perAgent[agentId] || {}
      const resolved = mergeHeartbeatRuntimeDefaults(globalDefaults, agentDefaults)
      return apiSuccess(res, { agentId, agentDefaults, resolved })
    } catch (error) {
      return apiFailure(res, 500, 'shift_operation_failed', 'Failed to update per-agent shift defaults', String(error))
    }
  })
}

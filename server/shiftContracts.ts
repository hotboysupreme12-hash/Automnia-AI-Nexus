/** Shared contracts for cron-backed Control Center shifts. */

export type Shift = {
  id: string
  name: string
  agent: string
  every: string
  durationMinutes: number
  message: string
  model?: string
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  timeoutSeconds?: number
  wake?: 'now' | 'next-heartbeat'
  session?: 'main' | 'isolated'
  announce?: boolean
  cronId: string
  startedAt: string
  endsAt: string | null
}

export type RuntimeCronJobSummary = Omit<Shift, 'endsAt'> & {
  source: 'control-center' | 'openclaw'
  status: string
  scheduleKind?: string
  scheduleLabel?: string
  payloadKind?: string
  nextRunAt?: string | null
  endsAt?: string | null
  lastError?: string | null
}

export type HeartbeatRuntimeDefaults = {
  model: string
  thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  timeoutSeconds: number
  wake: 'now' | 'next-heartbeat'
  session: 'main' | 'isolated'
  announce: boolean
  leadAgent: string
}

export type StartShiftPayload = {
  name: string
  agent?: string
  every: string
  durationMinutes?: number
  durationValue?: number
  durationUnit?: 'minutes' | 'hours' | 'days' | 'weeks'
  message: string
  model?: string
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  timeoutSeconds?: number
  wake?: 'now' | 'next-heartbeat'
  session?: 'main' | 'isolated'
  announce?: boolean
}

export function computeShiftDurationMinutes(input: Pick<StartShiftPayload, 'durationMinutes' | 'durationValue' | 'durationUnit'>): number {
  const computed = (() => {
    if (Number.isFinite(input.durationMinutes)) return input.durationMinutes as number
    if (Number.isFinite(input.durationValue)) {
      const value = input.durationValue as number
      const unit = input.durationUnit || 'minutes'
      const multiplier = unit === 'minutes' ? 1 : unit === 'hours' ? 60 : unit === 'days' ? 60 * 24 : 60 * 24 * 7
      return value * multiplier
    }
    return 180
  })()
  return Math.max(1, Math.min(10080, Math.round(computed)))
}

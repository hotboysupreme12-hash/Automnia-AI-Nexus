import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiErrorMessage, apiRequest, type ApiRequestOptions } from '../../api/client'
import { isShiftStartResponse, isShiftListResponse, isShiftBatchResponse } from '../../api/responseValidation'
import { useNexusStore } from '../../store/nexusStore'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import { stopScheduledTaskBatch } from './schedulerBatch'
import { createSerialSaveQueue } from './serialSaveQueue'
import { useRememberedState } from '../../hooks/useRememberedState'
import { scheduleRequestKey, settleScheduleRequest } from './scheduleRequestKey'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type WakeMode = 'now' | 'next-heartbeat'
type SessionMode = 'main' | 'isolated'
type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks'
type ShiftDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks'

type HeartbeatDefaults = {
  model: string
  thinking: ThinkingLevel
  timeoutSeconds: number
  wake: WakeMode
  session: SessionMode
  announce: boolean
  leadAgent: string
}

type ShiftSummary = {
  id: string
  name: string
  agent: string
  every: string
  durationMinutes: number
  message: string
  model?: string
  thinking?: ThinkingLevel
  timeoutSeconds?: number
  wake?: WakeMode
  session?: SessionMode
  announce?: boolean
  startedAt: string
  endsAt?: string | null
  nextRunAt?: string | null
  source?: 'control-center' | 'openclaw'
  status?: string
  scheduleKind?: string
  scheduleLabel?: string
}

type ShiftDefaultsResponse = {
  defaults?: HeartbeatDefaults
  resolved?: HeartbeatDefaults
  agentDefaults?: Partial<HeartbeatDefaults>
}

type ShiftStartResponse = {
  shift?: ShiftSummary
}

type ShiftBatchStartResponse = {
  batchId: string
  managedTeamSync: boolean
  outcome?: 'partial' | 'complete'
  unstartedAgentIds?: string[]
  unconfirmedAgentIds?: string[]
  orchestration?: { status: string; detail: string | null; affectedShiftIds: string[] }
  runId: string
  leadAgent: string
  startedCount: number
  failedCount: number
  shifts: ShiftSummary[]
  errors: Array<{ agentId: string; error: string }>
}

async function schedulerApiData<T>(path: string, options: ApiRequestOptions | undefined, fallbackMessage: string): Promise<T> {
  const validate = path === '/api/shifts/start' ? isShiftStartResponse : path === '/api/shifts/start-batch' ? isShiftBatchResponse : path === '/api/shifts' ? isShiftListResponse : undefined
  const result = await apiRequest<T>(path, { cache: 'no-store', validate, ...(options || {}) })
  if (!result.ok) throw new Error(apiErrorMessage(result.error) || fallbackMessage)
  return result.data
}

function schedulerErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error)
}

const cadenceUnits: Array<{ label: string; value: DurationUnit; suffix: string }> = [
  { label: 'Seconds', value: 'seconds', suffix: 's' },
  { label: 'Minutes', value: 'minutes', suffix: 'm' },
  { label: 'Hours', value: 'hours', suffix: 'h' },
  { label: 'Days', value: 'days', suffix: 'd' },
  { label: 'Weeks', value: 'weeks', suffix: 'w' },
]

const runDurationUnits: Array<{ label: string; value: ShiftDurationUnit }> = [
  { label: 'Minutes', value: 'minutes' },
  { label: 'Hours', value: 'hours' },
  { label: 'Days', value: 'days' },
  { label: 'Weeks', value: 'weeks' },
]

const defaultInstruction =
  'Read TEAM_SYNC.md. Execute your owned cron task slice, then update TEAM_SYNC.md with status, evidence, and blockers.'

const cadenceSuffixByUnit: Record<DurationUnit, string> = {
  seconds: 's',
  minutes: 'm',
  hours: 'h',
  days: 'd',
  weeks: 'w',
}

function formatShiftTime(ts: string | null | undefined) {
  if (!ts) return 'not scheduled'
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

function shiftTimingLabel(shift: ShiftSummary) {
  return shift.source === 'control-center' && shift.endsAt ? 'Ends' : 'Next'
}

function shiftTimingValue(shift: ShiftSummary) {
  return shift.source === 'control-center' ? shift.endsAt || shift.nextRunAt : shift.nextRunAt || shift.endsAt
}

function isControlCenterShift(shift: ShiftSummary) {
  return shift.source === 'control-center'
}

export function HeartbeatSchedulerPanel() {
  const agents = useNexusStore((state) => state.agents)
  const activePartyIds = useNexusStore((state) => state.activePartyIds)

  const partyAgents = useMemo(
    () => {
      const byId = new Map(agents.map((agent) => [agent.id, agent]))
      return activePartyIds.map((id) => byId.get(id)).filter((agent): agent is (typeof agents)[number] => Boolean(agent))
    },
    [agents, activePartyIds],
  )

  const [scope, setScope] = useState<'global' | 'agent'>('global')
  const [agentId, setAgentId] = useState('')

  const [defaults, setDefaults] = useState<HeartbeatDefaults>({
    model: 'openai/gpt-5.6-terra',
    thinking: 'minimal',
    timeoutSeconds: 120,
    wake: 'next-heartbeat',
    session: 'isolated',
    announce: false,
    leadAgent: 'auto-highest-level',
  })
  const defaultsDirtyRef = useRef(false)
  const defaultsRevisionRef = useRef(0)
  const defaultsLoadRequestRef = useRef(0)
  const defaultsSaveQueueRef = useRef(createSerialSaveQueue())
  const defaultsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [cadenceValue, setCadenceValue] = useState(30)
  const [cadenceUnit, setCadenceUnit] = useState<DurationUnit>('minutes')
  const [durationValue, setDurationValue] = useState(3)
  const [durationUnit, setDurationUnit] = useState<ShiftDurationUnit>('hours')
  const [instruction, setInstruction] = useState(defaultInstruction)
  const [shiftName, setShiftName] = useState('Cron')
  const [planFile, setPlanFile] = useState('TEAM_SYNC.md')
  const [workerAgentIds, setWorkerAgentIds] = useState<string[]>([])
  const [leadCadenceValue, setLeadCadenceValue] = useState(5)
  const [leadCadenceUnit, setLeadCadenceUnit] = useState<DurationUnit>('minutes')
  const [workerCadenceValue, setWorkerCadenceValue] = useState(1)
  const [workerCadenceUnit, setWorkerCadenceUnit] = useState<DurationUnit>('minutes')
  const [shifts, setShifts] = useState<ShiftSummary[]>([])
  const [status, setStatus] = useState('')
  const [stopConfirmShifts, setStopConfirmShifts] = useState<ShiftSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [failedStopShifts, setFailedStopShifts] = useState<ShiftSummary[]>([])
  const [teamRetry, setTeamRetry] = useRememberedState<Array<{ agentId: string; payload: Record<string, unknown> }>>('schedule-team-retry', [])
  const [loadedDefaultsScope, setLoadedDefaultsScope] = useState('')

  const resolveScopeAgent = useCallback(() => {
    if (scope !== 'agent') return undefined
    return agentId || partyAgents[0]?.id
  }, [agentId, partyAgents, scope])
  const defaultsScope = scope === 'agent' ? agentId || partyAgents[0]?.id || 'global' : 'global'
  const defaultsReady = loadedDefaultsScope === defaultsScope
  const stopConfirmPreview = useMemo(
    () => stopConfirmShifts.slice(0, 3).map((shift) => `${shift.name} (${shift.agent})`).join(', '),
    [stopConfirmShifts],
  )
  const statusIsError = /\b(failed|error|could not|invalid)\b/i.test(status)

  const patchDefaults = useCallback((patch: Partial<HeartbeatDefaults>) => {
    defaultsDirtyRef.current = true
    defaultsRevisionRef.current += 1
    setDefaults((prev) => ({ ...prev, ...patch }))
  }, [])

  const refreshShifts = useCallback(async () => {
    const payload = await schedulerApiData<{ shifts?: ShiftSummary[] }>('/api/shifts', { timeoutMs: 20_000 }, 'Failed to load cron shifts.')
    setShifts(payload.shifts || [])
  }, [])

  const loadDefaults = useCallback(async () => {
    const scopedAgent = resolveScopeAgent()
    const url = scopedAgent ? `/api/shifts/defaults/${scopedAgent}` : '/api/shifts/defaults'
    const requestId = ++defaultsLoadRequestRef.current
    const revision = ++defaultsRevisionRef.current
    try {
      const payload = await schedulerApiData<ShiftDefaultsResponse>(url, { timeoutMs: 20_000 }, 'Failed to load cron defaults.')
      if (requestId !== defaultsLoadRequestRef.current || revision !== defaultsRevisionRef.current) return
      const source = scopedAgent ? payload.resolved : payload.defaults
      if (!source) throw new Error('The scheduler returned no defaults for this scope.')

      setDefaults((prev) => ({
        ...prev,
        model: source.model || prev.model,
        thinking: source.thinking || prev.thinking,
        timeoutSeconds: source.timeoutSeconds || prev.timeoutSeconds,
        wake: source.wake || prev.wake,
        session: source.session || prev.session,
        announce: source.announce ?? prev.announce,
        leadAgent: source.leadAgent || prev.leadAgent,
      }))
      defaultsDirtyRef.current = false
      setLoadedDefaultsScope(scopedAgent || 'global')
    } catch (error) {
      if (requestId === defaultsLoadRequestRef.current) setStatus(`Load failed: ${schedulerErrorMessage(error)}`)
    }
  }, [resolveScopeAgent])

  useEffect(() => {
    if (!agentId && partyAgents[0]?.id) setAgentId(partyAgents[0].id)
  }, [agentId, partyAgents])

  useEffect(() => {
    if (!partyAgents.length) return
    const nextLead = partyAgents[0].id

    const validWorkers = workerAgentIds.filter((id) => id !== nextLead && partyAgents.some((agent) => agent.id === id))
    if (validWorkers.length !== workerAgentIds.length) {
      setWorkerAgentIds(validWorkers)
      return
    }

    if (!workerAgentIds.length && partyAgents.length > 1) {
      setWorkerAgentIds(partyAgents.filter((agent) => agent.id !== nextLead).map((agent) => agent.id))
    }
  }, [partyAgents, workerAgentIds])

  useEffect(() => {
    void loadDefaults()
    void refreshShifts().catch((error) => setStatus(`Load failed: ${schedulerErrorMessage(error)}`))
    return () => { defaultsLoadRequestRef.current += 1 }
  }, [loadDefaults, refreshShifts])

  const saveDefaults = useCallback(async (options?: { silent?: boolean }) => {
    if (!defaultsReady) return
    const revision = defaultsRevisionRef.current
    if (!options?.silent) setBusy(true)
    if (!options?.silent) setStatus('Saving cron defaults...')
    try {
      const scopedAgent = resolveScopeAgent()
      const url = scopedAgent ? `/api/shifts/defaults/${scopedAgent}` : '/api/shifts/defaults'
      const payload = scopedAgent
        ? {
            model: defaults.model,
            thinking: defaults.thinking,
            timeoutSeconds: defaults.timeoutSeconds,
            wake: defaults.wake,
            session: defaults.session,
            announce: defaults.announce,
          }
        : defaults

      await defaultsSaveQueueRef.current(() => schedulerApiData<ShiftDefaultsResponse>(url, {
        method: 'POST',
        body: payload,
        timeoutMs: 20_000,
      }, 'Failed to save defaults.'))
      if (revision === defaultsRevisionRef.current) {
        defaultsDirtyRef.current = false
        setStatus(`Saved ${scopedAgent ? `${scopedAgent} cron` : 'global cron'} defaults.`)
      }
    } catch (error) {
      if (revision === defaultsRevisionRef.current) setStatus(`${options?.silent ? 'Autosave' : 'Save'} failed: ${schedulerErrorMessage(error)}`)
    } finally {
      if (!options?.silent) setBusy(false)
    }
  }, [defaults, defaultsReady, resolveScopeAgent])

  useEffect(() => {
    if (!defaultsDirtyRef.current || !defaultsReady) return
    if (defaultsSaveTimerRef.current) clearTimeout(defaultsSaveTimerRef.current)
    defaultsSaveTimerRef.current = setTimeout(() => {
      void saveDefaults({ silent: true })
    }, 600)
    return () => {
      if (defaultsSaveTimerRef.current) clearTimeout(defaultsSaveTimerRef.current)
    }
  }, [defaults, defaultsReady, saveDefaults])

  const startShift = async () => {
    setBusy(true)
    setStatus('Starting cron shift...')
    try {
      const scopedAgent = resolveScopeAgent()
      const cadence = `${Math.max(1, cadenceValue)}${cadenceUnits.find((u) => u.value === cadenceUnit)?.suffix || 'm'}`
      const payload = {
        name: shiftName.trim() || 'Cron',
        ...(scopedAgent ? { agent: scopedAgent } : {}),
        every: cadence,
        durationValue: Math.max(1, durationValue),
        durationUnit,
        message: instruction.trim() || defaultInstruction,
        model: defaults.model,
        thinking: defaults.thinking,
        timeoutSeconds: defaults.timeoutSeconds,
        wake: defaults.wake,
        session: defaults.session,
        announce: defaults.announce,
      }

      const requestKey = await scheduleRequestKey('single', payload)
      const out = await schedulerApiData<ShiftStartResponse>('/api/shifts/start', {
        method: 'POST',
        body: { ...payload, idempotencyKey: requestKey },
        timeoutMs: 95_000,
      }, 'Failed to start shift.')
      settleScheduleRequest(requestKey)
      setStatus(`Started cron shift ${out.shift?.name || ''} (${out.shift?.agent || 'auto'}).`)
      await refreshShifts()
    } catch (error) {
      setStatus(`Start failed: ${schedulerErrorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const startTeamWorkflow = async () => {
    setBusy(true)
    setStatus('Starting team cron workflow...')
    try {
    const effectiveLead = partyAgents[0]?.id
      if (!effectiveLead) throw new Error('No lead agent selected')

      const allAgents = [effectiveLead, ...workerAgentIds.filter((id) => id !== effectiveLead)]
      if (!allAgents.length) throw new Error('No agents selected for team workflow')

      const cadence = `${Math.max(1, cadenceValue)}${cadenceUnits.find((u) => u.value === cadenceUnit)?.suffix || 'm'}`
      const leadEvery = `${Math.max(1, leadCadenceValue)}${cadenceSuffixByUnit[leadCadenceUnit]}`
      const workerEvery = `${Math.max(1, workerCadenceValue)}${cadenceSuffixByUnit[workerCadenceUnit]}`
      const planPath = planFile.trim() || 'TEAM_SYNC.md'
      const leadMessage = [
        `Act as workflow lead. Update ${planPath} with a concrete, prioritized execution plan and owner assignments.`,
        'Then execute one lead-owned task immediately and update status/blockers in the same file.',
      ].join(' ')
      const workerMessage = [
        `Read ${planPath}. Pick your assigned slice (or claim one if unassigned), execute one concrete task step, then update status and blockers in ${planPath}.`,
        'Do not return HEARTBEAT_OK unless blocked after attempting execution.',
      ].join(' ')

      const payload = {
        namePrefix: shiftName.trim() || 'Cron',
        agentIds: allAgents,
        leadAgent: effectiveLead,
        every: cadence,
        leadEvery,
        workerEvery,
        durationValue: Math.max(1, durationValue),
        durationUnit,
        message: instruction.trim() || defaultInstruction,
        leadMessage,
        workerMessage,
        model: defaults.model,
        thinking: defaults.thinking,
        timeoutSeconds: defaults.timeoutSeconds,
        wake: defaults.wake,
        session: defaults.session,
        announce: defaults.announce,
      }

      const requestKey = await scheduleRequestKey('team', payload)
      const out = await schedulerApiData<ShiftBatchStartResponse>('/api/shifts/start-batch', {
        method: 'POST',
        body: { ...payload, idempotencyKey: requestKey },
        timeoutMs: 120_000,
      }, 'Failed to start team workflow.')
      if (out.outcome !== 'partial') settleScheduleRequest(requestKey)
      setTeamRetry((out.unstartedAgentIds || []).map((agentId) => ({
        agentId,
        payload: {
          idempotencyKey: `${requestKey}:${agentId}`,
          name: `${payload.namePrefix}-${agentId}`.slice(0, 80), agent: agentId,
          every: agentId === effectiveLead ? leadEvery : workerEvery,
          durationValue: payload.durationValue, durationUnit: payload.durationUnit,
          message: agentId === effectiveLead ? leadMessage : workerMessage,
          model: payload.model, thinking: payload.thinking, timeoutSeconds: payload.timeoutSeconds,
          wake: payload.wake, session: agentId === effectiveLead ? payload.session : 'isolated', announce: payload.announce,
        },
      })))
      setStatus([
        `Started ${out.startedCount || 0} scheduled job(s); ${out.failedCount || 0} failed.`,
        out.unstartedAgentIds?.length ? `Unstarted agents: ${out.unstartedAgentIds.join(', ')}. Retry only these agents to avoid duplicate jobs.` : '',
        out.orchestration?.detail || '',
        out.unconfirmedAgentIds?.length ? `Creation is unconfirmed for ${out.unconfirmedAgentIds.join(', ')}. Check Runtime Monitor before retrying these agents.` : '',
        out.outcome === 'partial' && out.shifts.length ? `Created jobs: ${out.shifts.map((shift) => shift.id).join(', ')}.` : '',
      ].filter(Boolean).join(' '))
      await refreshShifts()
    } catch (error) {
      setStatus(`Team start failed: ${schedulerErrorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const retryUnstartedTeamJobs = async () => {
    if (busy || !teamRetry.length) return
    setBusy(true)
    const remaining: typeof teamRetry = []
    const unconfirmed: string[] = []
    let started = 0
    try {
      for (const task of teamRetry) {
        const result = await apiRequest<ShiftStartResponse>('/api/shifts/start', { method: 'POST', body: task.payload, timeoutMs: 95_000, validate: isShiftStartResponse })
        if (result.ok) started += 1
        else if ([400, 401, 403, 422].includes(result.status)) remaining.push(task)
        else unconfirmed.push(task.agentId)
      }
      setTeamRetry(remaining)
      setStatus([
        `Started ${started} previously unstarted job(s); ${remaining.length} remain unstarted.`,
        unconfirmed.length ? `Creation is unconfirmed for ${unconfirmed.join(', ')}. These agents were removed from retry. Check Runtime Monitor before creating another job.` : '',
      ].filter(Boolean).join(' '))
      try { await refreshShifts() } catch { setStatus((current) => `${current} Job list refresh failed; refresh Runtime Monitor to check the latest jobs.`) }
    } finally { setBusy(false) }
  }

  const stopShift = async (shiftId: string) => {
    setStopConfirmShifts([])
    setBusy(true)
    setStatus('Stopping cron shift...')
    try {
      await schedulerApiData<{ shiftId: string; cronId: string }>('/api/shifts/stop', {
        method: 'POST',
        body: { shiftId },
        timeoutMs: 45_000,
      }, 'Failed to stop shift.')
      setStatus(`Stopped shift ${shiftId}.`)
      await refreshShifts()
    } catch (error) {
      setStatus(`Stop failed: ${schedulerErrorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const stopShiftBatch = async (targetShifts: ShiftSummary[], scopedAgent: string | undefined) => {
    setBusy(true)
    setFailedStopShifts([])
    setStatus('Stopping cron shift(s)...')
    try {
      const result = await stopScheduledTaskBatch(targetShifts, (shift) =>
        schedulerApiData<{ shiftId: string; cronId: string }>('/api/shifts/stop', {
          method: 'POST',
          body: { shiftId: shift.id },
          timeoutMs: 45_000,
        }, `Failed stopping shift ${shift.id}`))
      setFailedStopShifts(result.failed.map(({ task }) => task))
      setStatus(result.failed.length
        ? `Stopped ${result.stopped.length} of ${targetShifts.length} scheduled tasks. Failed: ${result.failed.map(({ task, message }) => `${task.name}: ${message}`).join('; ')}`
        : `Stopped ${result.stopped.length} scheduled task${result.stopped.length === 1 ? '' : 's'}${scopedAgent ? ` for ${scopedAgent}` : ''}.`)
      await refreshShifts()
    } catch (error) {
      setStatus(`Stop failed: ${schedulerErrorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const stopHeartbeatScope = async () => {
    if (busy) return
    const scopedAgent = resolveScopeAgent()
    const controlCenterShifts = shifts.filter(isControlCenterShift)
    const targetShifts = scopedAgent
      ? controlCenterShifts.filter((shift) => shift.agent === scopedAgent)
      : controlCenterShifts

    if (!targetShifts.length) {
      setStopConfirmShifts([])
      setStatus(scopedAgent ? `No Automnia cron shifts for ${scopedAgent}.` : 'No Automnia cron shifts to stop.')
      return
    }

    if (!scopedAgent && targetShifts.length > 1) {
      setStopConfirmShifts(targetShifts)
      setStatus(`Review before stopping ${targetShifts.length} active cron shift(s).`)
      return
    }

    setStopConfirmShifts([])
    await stopShiftBatch(targetShifts, scopedAgent)
  }

  const confirmStopAllShifts = async () => {
    const targetShifts = stopConfirmShifts
    if (!targetShifts.length || busy) return
    setStopConfirmShifts([])
    await stopShiftBatch(targetShifts, undefined)
  }

  const keepShiftsRunning = () => {
    setStopConfirmShifts([])
    setStatus('Stop cancelled. Cron shifts remain active.')
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/75 p-6 shadow-frame">
      <div className="mb-3">
        <h2 className="font-heading text-2xl text-slate-100">Cron Scheduler</h2>
        <p className="text-xs text-cyan-100/90">Configure cron cadence, run window, model, and scheduled instructions per agent or globally.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-300">
          Scope
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as 'global' | 'agent')}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          >
            <option value="global">Global defaults</option>
            <option value="agent">Per-agent defaults</option>
          </select>
        </label>

        {scope === 'agent' && (
          <label className="text-xs text-slate-300">
            Agent
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            >
              {partyAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.id})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs text-slate-300">
          Model
          <input
            disabled={!defaultsReady}
            value={defaults.model}
            onChange={(event) => patchDefaults({ model: event.target.value })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          />
        </label>

        <label className="text-xs text-slate-300">
          Thinking
          <select
            disabled={!defaultsReady}
            value={defaults.thinking}
            onChange={(event) => patchDefaults({ thinking: event.target.value as ThinkingLevel })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          >
            {(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ThinkingLevel[]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          Timeout (seconds)
          <input
            type="number"
            min={30}
            max={7200}
            disabled={!defaultsReady}
            value={defaults.timeoutSeconds}
            onChange={(event) => patchDefaults({ timeoutSeconds: Math.max(30, Number(event.target.value) || 30) })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          />
        </label>

        <label className="text-xs text-slate-300">
          Cron wake policy
          <select
            disabled={!defaultsReady}
            value={defaults.wake}
            onChange={(event) => patchDefaults({ wake: event.target.value as WakeMode })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          >
            <option value="next-heartbeat">next-heartbeat</option>
            <option value="now">now</option>
          </select>
        </label>

        <label className="text-xs text-slate-300">
          Session
          <select
            disabled={!defaultsReady}
            value={defaults.session}
            onChange={(event) => patchDefaults({ session: event.target.value as SessionMode })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          >
            <option value="isolated">isolated</option>
            <option value="main">main</option>
          </select>
        </label>

        {scope === 'global' && (
          <label className="text-xs text-slate-300">
            Lead Agent Policy
            <input
              disabled={!defaultsReady}
              value={defaults.leadAgent}
              onChange={(event) => patchDefaults({ leadAgent: event.target.value })}
              placeholder="auto-highest-level or hn-coordinator"
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          id="announce-heartbeat"
          type="checkbox"
          checked={defaults.announce}
          disabled={!defaultsReady}
          onChange={(event) => patchDefaults({ announce: event.target.checked })}
        />
        <label htmlFor="announce-heartbeat" className="text-xs text-slate-300">
          Announce cron summaries to chat
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-100/80">Schedule</p>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-300">
            Shift name
            <input
              value={shiftName}
              onChange={(event) => setShiftName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Run every
            <input
              type="number"
              min={1}
              value={cadenceValue}
              onChange={(event) => setCadenceValue(Math.max(1, Number(event.target.value) || 1))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Cadence unit
            <select
              value={cadenceUnit}
              onChange={(event) => setCadenceUnit(event.target.value as DurationUnit)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            >
              {cadenceUnits.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-300">
            Run for
            <input
              type="number"
              min={1}
              value={durationValue}
              onChange={(event) => setDurationValue(Math.max(1, Number(event.target.value) || 1))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>
        </div>

        <label className="mt-3 block text-xs text-slate-300">
          Run duration unit
          <select
            value={durationUnit}
            onChange={(event) => setDurationUnit(event.target.value as ShiftDurationUnit)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          >
            {runDurationUnits.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-xs text-slate-300">
          Cron instruction
          <textarea
            rows={4}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-100/80">Team Workflow</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-slate-300">
            Lead agent
            <select
              value={partyAgents[0]?.id || ''}
              disabled
              onChange={() => undefined}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            >
              {partyAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.id})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-300">
            Shared plan file
            <input
              value={planFile}
              onChange={(event) => setPlanFile(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-300">
            Lead runs every
            <input
              type="number"
              min={1}
              value={leadCadenceValue}
              onChange={(event) => setLeadCadenceValue(Math.max(1, Number(event.target.value) || 1))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Lead unit
            <select
              value={leadCadenceUnit}
              onChange={(event) => setLeadCadenceUnit(event.target.value as DurationUnit)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            >
              {cadenceUnits.map((unit) => (
                <option key={`lead-${unit.value}`} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-300">
            Workers run every
            <input
              type="number"
              min={1}
              value={workerCadenceValue}
              onChange={(event) => setWorkerCadenceValue(Math.max(1, Number(event.target.value) || 1))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Worker unit
            <select
              value={workerCadenceUnit}
              onChange={(event) => setWorkerCadenceUnit(event.target.value as DurationUnit)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            >
              {cadenceUnits.map((unit) => (
                <option key={`worker-${unit.value}`} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 text-xs text-slate-300">
          <p className="mb-1">Worker agents</p>
          <div className="grid gap-1 md:grid-cols-2">
            {partyAgents
              .filter((agent) => agent.id !== (partyAgents[0]?.id || ''))
              .map((agent) => {
                const checked = workerAgentIds.includes(agent.id)
                return (
                  <label key={agent.id} className="flex items-center gap-2 rounded border border-white/10 bg-slate-900/40 px-2 py-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const isChecked = event.target.checked
                        setWorkerAgentIds((prev) => {
                          if (isChecked) return Array.from(new Set([...prev, agent.id]))
                          return prev.filter((id) => id !== agent.id)
                        })
                      }}
                    />
                    <span>
                      {agent.name} ({agent.id})
                    </span>
                  </label>
                )
              })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveDefaults()}
          className="rounded-md border border-cyan-300/40 bg-cyan-900/30 px-3 py-2 text-xs uppercase tracking-[0.16em] text-cyan-100"
        >
          Save Defaults
        </button>
        <button
          type="button"
          disabled={busy || !instruction.trim()}
          onClick={() => void startShift()}
          className="rounded-md border border-emerald-300/40 bg-emerald-900/30 px-3 py-2 text-xs uppercase tracking-[0.16em] text-emerald-100"
        >
          Start Cron
        </button>
        <button
          type="button"
          disabled={busy || !partyAgents.length || teamRetry.length > 0}
          onClick={() => void startTeamWorkflow()}
          className="rounded-md border border-violet-300/40 bg-violet-900/30 px-3 py-2 text-xs uppercase tracking-[0.16em] text-violet-100"
        >
          Start Team Workflow
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void stopHeartbeatScope()}
          className="rounded-md border border-rose-300/40 bg-rose-900/30 px-3 py-2 text-xs uppercase tracking-[0.16em] text-rose-100"
        >
          Stop Cron
        </button>
      </div>

      {teamRetry.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-amber-300/20 p-3 text-sm text-amber-100">
        <span>Unstarted jobs: {teamRetry.map((task) => task.agentId).join(', ')}</span>
        <button type="button" disabled={busy} onClick={() => void retryUnstartedTeamJobs()} className="rounded border border-amber-200/30 px-3 py-2">Retry only unstarted jobs</button>
        <button type="button" disabled={busy} onClick={() => setTeamRetry([])} className="rounded px-3 py-2 underline">Keep partial workflow</button>
      </div>}

      {stopConfirmShifts.length > 0 && (
        <ActionStatusBanner
          className="mt-3 text-xs"
          detailClassName="text-[11px] text-amber-100/65"
          message={`Stop all ${stopConfirmShifts.length} active cron shift(s)?`}
          detail={stopConfirmPreview ? (
            <>
              {stopConfirmPreview}
              {stopConfirmShifts.length > 3 ? ` +${stopConfirmShifts.length - 3} more` : ''}
            </>
          ) : undefined}
          detailTitle={stopConfirmShifts.map((shift) => `${shift.name} (${shift.agent})`).join(', ')}
          confirmLabel="Stop shifts"
          confirmAriaLabel={`Stop ${stopConfirmShifts.length} active cron shift${stopConfirmShifts.length === 1 ? '' : 's'}`}
          cancelAriaLabel="Keep cron shifts active"
          busy={busy}
          onConfirm={() => void confirmStopAllShifts()}
          onCancel={keepShiftsRunning}
        />
      )}

      {status ? (
        <p className={`mt-3 text-xs ${statusIsError ? 'text-rose-200' : 'text-slate-300'}`} role={statusIsError ? 'alert' : 'status'} aria-live={statusIsError ? 'assertive' : 'polite'}>
          {status}
        </p>
      ) : null}
      {failedStopShifts.length > 0 && <button type="button" disabled={busy} onClick={() => void stopShiftBatch(failedStopShifts, undefined)} className="mt-2 rounded border border-rose-300/40 px-3 py-2 text-sm text-rose-100">Retry {failedStopShifts.length} failed stop{failedStopShifts.length === 1 ? '' : 's'}</button>}

      <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-100/80">Active Cron Jobs</p>
        <div className="space-y-2">
          {shifts.length ? (
            shifts.map((shift) => (
              <div key={shift.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-2 text-xs text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-100">{shift.name}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void stopShift(shift.id)}
                    className="rounded border border-rose-300/40 bg-rose-900/25 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-rose-100"
                  >
                    Stop
                  </button>
                </div>
                <p>Agent: {shift.agent}</p>
                <p>
                  Every: {shift.every} | {shiftTimingLabel(shift)}: {formatShiftTime(shiftTimingValue(shift))} | Model: {shift.model || 'default'}
                </p>
                <p>Source: {shift.source || 'openclaw'} | Status: {shift.status || 'active'}</p>
                <p className="truncate">Instruction: {shift.message}</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400">No active cron shifts.</p>
          )}
        </div>
      </div>
    </section>
  )
}

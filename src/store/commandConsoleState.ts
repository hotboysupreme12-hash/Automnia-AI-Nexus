import type { AgentActivityEvent, AgentResponse, AgentTurnAttachment } from '../types/nexus'
import { readConsolePreferences } from '../components/settings/workspaceSettings'
import { forgetRememberedState } from '../hooks/useRememberedState'

export const COMMAND_CONSOLE_DRAFT_PREFIX = 'automnia:command-draft:'
export const MAX_COMMAND_CONSOLE_RESPONSES = 80
export const COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY = 'automnia:command-console-queue-receipts:v1'

export type CommandConsoleQueueReceiptStatus = 'queued' | 'started' | 'cancelled' | 'interrupted' | 'expired' | 'failed'

/** Safe receipt metadata only. Never add prompts, options, attachments, or executable work here. */
export type CommandConsoleQueueReceipt = {
  id: string
  agentId: string
  queuedAt: string
  status: CommandConsoleQueueReceiptStatus
  reason?: string
  completedAt?: string
}

export type CommandConsoleDraft = {
  storageKey: string
  value: string
}

export type CommandConsoleDraftStorage = {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type CommandConsoleQueueReceiptStorage = Pick<CommandConsoleDraftStorage, 'getItem' | 'setItem' | 'removeItem'>

export interface NexusCommandConsoleResponseState {
  agentResponses: AgentResponse[]
  busyAgentIds: string[]
}

export type CommandConsoleQueuedFollowup<TOptions> = {
  id: string
  agentId: string
  prompt: string
  visiblePrompt: string
  options: TOptions & { attachments?: AgentTurnAttachment[] }
  queuedAt: string
  createdAt: number
}

export type QueuedCommandConsoleResponseInput = {
  queuedId: string
  agentId: string
  agentName: string
  visiblePrompt: string
  missionId?: string
  queuedAt: string
  queuePosition: number
  sourceLabel: string
}

export const STALE_COMMAND_CONSOLE_QUEUE_AGE_MS = 15 * 60 * 1000

export function commandConsoleQueueAgeMs(queuedAt: string | undefined, nowMs = Date.now()): number | null {
  if (!queuedAt || !Number.isFinite(nowMs)) return null
  const queuedAtMs = Date.parse(queuedAt)
  if (!Number.isFinite(queuedAtMs)) return null
  return Math.max(0, nowMs - queuedAtMs)
}

export function isCommandConsoleQueueStale(queuedAt: string | undefined, nowMs = Date.now()): boolean {
  const ageMs = commandConsoleQueueAgeMs(queuedAt, nowMs)
  return ageMs !== null && ageMs >= STALE_COMMAND_CONSOLE_QUEUE_AGE_MS
}

export function commandConsoleQueueCancellation(waitedMs: number): { stale: boolean; message: string } {
  const boundedWaitMs = Number.isFinite(waitedMs) ? Math.max(0, waitedMs) : 0
  const stale = boundedWaitMs >= STALE_COMMAND_CONSOLE_QUEUE_AGE_MS
  return {
    stale,
    message: stale
      ? `Stale queued Command Console follow-up cancelled by operator after waiting ${Math.floor(boundedWaitMs / 60_000)} minutes.`
      : 'Queued Command Console follow-up was cancelled before it started.',
  }
}

export function commandConsoleQueueCancellationForFollowup(queuedAt: string | undefined, createdAt: number, agentId: string, nowMs = Date.now()) {
  const waitedMs = commandConsoleQueueAgeMs(queuedAt, nowMs) ?? Math.max(0, nowMs - createdAt)
  const cancellation = commandConsoleQueueCancellation(waitedMs)
  return {
    ...cancellation,
    feedMessage: cancellation.stale
      ? `Stale queued Command Console follow-up cancelled by operator for ${agentId} after waiting ${Math.floor(waitedMs / 60_000)} minutes.`
      : `Queued Command Console follow-up cancelled for ${agentId}.`,
  }
}

export function commandConsoleQueueCancellationPatch(cancellation: ReturnType<typeof commandConsoleQueueCancellationForFollowup>, completedAt: string) {
  return {
    response: cancellation.message,
    ok: false as const,
    streaming: false,
    failureKind: 'aborted' as const,
    completedAt,
    queuePosition: undefined,
    queueDepth: undefined,
    progressLabel: 'Cancelled',
    progressLines: [cancellation.message],
    progressUpdatedAt: completedAt,
  }
}

function browserDraftStorage(): CommandConsoleDraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function normalizeCommandConsoleQueueReceipt(value: unknown): CommandConsoleQueueReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const statuses: CommandConsoleQueueReceiptStatus[] = ['queued', 'started', 'cancelled', 'interrupted', 'expired', 'failed']
  if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 256) return null
  if (typeof candidate.agentId !== 'string' || !candidate.agentId.trim() || candidate.agentId.length > 256) return null
  if (typeof candidate.queuedAt !== 'string' || candidate.queuedAt.length > 64 || !Number.isFinite(Date.parse(candidate.queuedAt))) return null
  if (!statuses.includes(candidate.status as CommandConsoleQueueReceiptStatus)) return null
  const reason = typeof candidate.reason === 'string' ? candidate.reason.slice(0, 500) : undefined
  const completedAt = typeof candidate.completedAt === 'string'
    && candidate.completedAt.length <= 64
    && Number.isFinite(Date.parse(candidate.completedAt))
    ? candidate.completedAt
    : undefined
  return {
    id: candidate.id.trim(),
    agentId: candidate.agentId.trim(),
    queuedAt: candidate.queuedAt,
    status: candidate.status as CommandConsoleQueueReceiptStatus,
    ...(reason ? { reason } : {}),
    ...(completedAt ? { completedAt } : {}),
  }
}

export function readCommandConsoleQueueReceipts(
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): CommandConsoleQueueReceipt[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(-MAX_COMMAND_CONSOLE_RESPONSES)
      .map(normalizeCommandConsoleQueueReceipt)
      .filter((receipt): receipt is CommandConsoleQueueReceipt => receipt !== null)
  } catch {
    return []
  }
}

export function writeCommandConsoleQueueReceipt(
  receiptInput: CommandConsoleQueueReceipt,
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): void {
  const receipt = normalizeCommandConsoleQueueReceipt(receiptInput)
  if (!storage || !receipt) return
  try {
    const receipts = readCommandConsoleQueueReceipts(storage).filter((entry) => entry.id !== receipt.id)
    receipts.push(receipt)
    storage.setItem(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY, JSON.stringify(receipts.slice(-MAX_COMMAND_CONSOLE_RESPONSES)))
  } catch {
    // Receipt persistence is best-effort; a storage failure must not block a turn.
  }
}

export function removeCommandConsoleQueueReceipt(
  receiptId: string,
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): void {
  if (!storage || !receiptId.trim()) return
  try {
    const receipts = readCommandConsoleQueueReceipts(storage).filter((entry) => entry.id !== receiptId)
    if (receipts.length) storage.setItem(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY, JSON.stringify(receipts))
    else storage.removeItem(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY)
  } catch {
    // Receipt cleanup is best-effort; runtime execution must not depend on browser storage.
  }
}

export function expireCommandConsoleFollowup<TOptions>(
  queued: Pick<CommandConsoleQueuedFollowup<TOptions>, 'id' | 'queuedAt'>,
  agentId: string,
  updateResponse: (id: string, patch: Partial<AgentResponse>) => void,
  completedAt = new Date().toISOString(),
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): void {
  const reason = 'Queued Command Console turn expired after waiting 6h for the lane to become free.'
  writeCommandConsoleQueueReceipt({ id: queued.id, agentId, queuedAt: queued.queuedAt, status: 'expired', reason, completedAt }, storage)
  updateResponse(queued.id, {
    response: reason,
    ok: false,
    streaming: false,
    failureKind: 'timeout',
    completedAt,
    queuePosition: undefined,
    queueDepth: undefined,
    progressLabel: 'Queue expired',
    progressLines: ['Queued turn expired before it could start.'],
    progressUpdatedAt: completedAt,
  })
}

export function interruptQueuedCommandConsoleFollowups<TOptions>(
  queues: Iterable<[string, CommandConsoleQueuedFollowup<TOptions>[]]>,
  updateResponse: (id: string, patch: Partial<AgentResponse>) => void,
  completedAt = new Date().toISOString(),
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): void {
  const reason = 'Queued Command Console turn was interrupted when the session was reset. It was not replayed; resend it if needed.'
  for (const [agentId, queue] of queues) {
    for (const queued of queue) {
      writeCommandConsoleQueueReceipt({ id: queued.id, agentId, queuedAt: queued.queuedAt, status: 'interrupted', reason, completedAt }, storage)
      updateResponse(queued.id, {
        response: reason,
        ok: false,
        streaming: false,
        failureKind: 'interrupted',
        completedAt,
        queuePosition: undefined,
        queueDepth: undefined,
        progressLabel: 'Interrupted',
        progressMode: 'block',
        progressLines: [reason],
        progressUpdatedAt: completedAt,
      })
    }
  }
}

function estimateCommandConsoleTokenCount(text: string): number {
  return Math.max(1, Math.ceil((text || '').length / 4))
}

export function makeCommandConsoleDraftStorageKey(routeKey: string): string {
  return `${COMMAND_CONSOLE_DRAFT_PREFIX}${routeKey}`
}

export function readCommandConsoleDraft(storageKey: string, storage: CommandConsoleDraftStorage | null = browserDraftStorage()): string {
  if (!storage || !readConsolePreferences().rememberDrafts) return ''
  try {
    return storage.getItem(storageKey) || ''
  } catch {
    return ''
  }
}

export function writeCommandConsoleDraft(storageKey: string, value: string, storage: CommandConsoleDraftStorage | null = browserDraftStorage()): void {
  if (!storage) return
  try {
    if (!readConsolePreferences().rememberDrafts) {
      storage.removeItem(storageKey)
      return
    }
    if (value.trim()) storage.setItem(storageKey, value)
    else storage.removeItem(storageKey)
  } catch {
    // Draft persistence is best-effort; chat sending must not depend on browser storage.
  }
}

export function clearAllCommandConsoleDrafts(storage: CommandConsoleDraftStorage | null = browserDraftStorage()): number {
  const attachments = forgetRememberedState('console-attachment-drafts') as Record<string, { preview: string }[]> | undefined
  for (const entry of Object.values(attachments || {}).flat()) if (entry.preview) URL.revokeObjectURL(entry.preview)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('automnia:console-drafts-cleared'))
  if (!storage) return 0
  let removed = 0
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (!key?.startsWith(COMMAND_CONSOLE_DRAFT_PREFIX)) continue
      storage.removeItem(key)
      removed += 1
    }
  } catch {
    // Draft cleanup is best-effort.
  }
  return removed
}

export function removeCommandConsoleDraft(storageKey: string, storage: CommandConsoleDraftStorage | null = browserDraftStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(storageKey)
  } catch {
    // ignore localStorage failures
  }
}

export function removeCommandConsoleDraftsForAgent(agentId: string, storage: CommandConsoleDraftStorage | null = browserDraftStorage()): number {
  const normalized = agentId.trim().toLowerCase()
  if (!storage || !normalized) return 0
  let removed = 0
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(COMMAND_CONSOLE_DRAFT_PREFIX) && key.toLowerCase().includes(normalized)) {
        storage.removeItem(key)
        removed += 1
      }
    }
  } catch {
    // Draft cleanup is best-effort; retirement state is already persisted by the API.
  }
  return removed
}

export function makeCommandConsoleResponseState(
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
  nowMs = Date.now(),
): NexusCommandConsoleResponseState {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const now = new Date(safeNowMs).toISOString()
  const receipts = readCommandConsoleQueueReceipts(storage)
  let updatedReceipts = false
  const agentResponses: AgentResponse[] = []

  for (const receipt of receipts) {
    if (receipt.status === 'queued' || receipt.status === 'started') {
      const wasStarted = receipt.status === 'started'
      receipt.status = 'interrupted'
      receipt.reason = wasStarted
        ? 'This queued turn had started when the browser session ended. Its live response was not restored or replayed.'
        : 'This queued turn was interrupted when the browser session ended. It was not replayed; resend it if needed.'
      receipt.completedAt = now
      updatedReceipts = true
    }
    const reason = receipt.reason || 'Queued turn ended before it could start.'
    const failureKind = receipt.status === 'expired' ? 'timeout' : receipt.status === 'cancelled' ? 'aborted' : receipt.status === 'failed' ? 'failed' : 'interrupted'
    const progressLabel = receipt.status === 'cancelled'
      ? 'Cancelled'
      : receipt.status === 'expired'
        ? 'Queue expired'
        : receipt.status === 'failed'
          ? 'Queue stopped'
          : 'Interrupted'
    agentResponses.push({
      id: receipt.id,
      agentId: receipt.agentId,
      prompt: 'Queued Command Console turn',
      response: reason,
      ok: false,
      timestamp: receipt.queuedAt,
      durationMs: Math.max(0, Date.parse(receipt.completedAt || now) - Date.parse(receipt.queuedAt)),
      streaming: false,
      failureKind,
      transport: 'command-console-queue',
      queuedAt: receipt.queuedAt,
      completedAt: receipt.completedAt || now,
      progressLabel,
      progressMode: 'block',
      progressLines: [reason],
      progressUpdatedAt: receipt.completedAt || now,
    })
  }

  if (updatedReceipts && storage) {
    try {
      storage.setItem(COMMAND_CONSOLE_QUEUE_RECEIPTS_KEY, JSON.stringify(receipts.slice(-MAX_COMMAND_CONSOLE_RESPONSES)))
    } catch {
      // The local projection still remains safe and non-runnable when storage is unavailable.
    }
  }
  return {
    agentResponses: agentResponses.slice(-MAX_COMMAND_CONSOLE_RESPONSES).reverse(),
    busyAgentIds: [],
  }
}

export function preserveCommandConsoleResponseState(current: NexusCommandConsoleResponseState): NexusCommandConsoleResponseState {
  return {
    agentResponses: current.agentResponses,
    busyAgentIds: current.busyAgentIds,
  }
}

/** Update one response while retaining an agent's busy indicator for its other live lanes. */
export function upsertCommandConsoleResponse(
  current: NexusCommandConsoleResponseState,
  next: AgentResponse,
): NexusCommandConsoleResponseState {
  const alreadyTracked = current.agentResponses.some((entry) => entry.id === next.id)
  const agentResponses = alreadyTracked
    ? current.agentResponses.map((entry) => (entry.id === next.id ? next : entry))
    : [next, ...current.agentResponses].slice(0, MAX_COMMAND_CONSOLE_RESPONSES)
  // Waiting rows are displayed as streaming, but have not started a run.
  const agentStillStreaming = agentResponses.some((entry) => entry.agentId === next.agentId && entry.streaming && entry.transport !== 'command-console-queue')
  return {
    agentResponses,
    busyAgentIds: agentStillStreaming
      ? [...new Set([...current.busyAgentIds, next.agentId])]
      : current.busyAgentIds.filter((agentId) => agentId !== next.agentId),
  }
}

export function commandConsoleSessionKey(agentId: string): string {
  return `agent:${agentId}:control-center:console`
}

export function queueProgressLines(position: number, depth: number): string[] {
  if (position <= 1) {
    return [
      `Queue position 1 of ${depth}.`,
      'This turn is next; it will start when the active lane is free.',
    ]
  }
  return [
    `Queue position ${position} of ${depth}.`,
    `${position - 1} queued turn${position === 2 ? '' : 's'} ahead.`,
  ]
}

export function refreshQueuedCommandConsolePositions(
  responses: AgentResponse[],
  agentId: string,
  queue: readonly { id: string }[],
  nowMs = Date.now(),
  updatedAt = new Date(nowMs).toISOString(),
): AgentResponse[] {
  if (!queue.length) return responses
  const depth = queue.length
  const positionById = new Map(queue.map((entry, index) => [entry.id, index + 1]))
  return responses.map((entry) => {
    if (entry.agentId !== agentId || entry.transport !== 'command-console-queue' || !entry.streaming) return entry
    const position = positionById.get(entry.id)
    if (!position) return entry
    const queuedAtMs = new Date(entry.queuedAt || entry.timestamp).getTime()
    const durationMs = Number.isFinite(queuedAtMs) ? Math.max(0, nowMs - queuedAtMs) : entry.durationMs
    return {
      ...entry,
      durationMs,
      queuePosition: position,
      queueDepth: depth,
      progressLabel: position === 1 ? 'Queued next' : `Queued ${position}/${depth}`,
      progressLines: queueProgressLines(position, depth),
      progressUpdatedAt: updatedAt,
    }
  })
}

export function failQueuedCommandConsoleFollowups<TOptions>(
  queuedEntries: readonly Pick<CommandConsoleQueuedFollowup<TOptions>, 'id' | 'queuedAt'>[],
  agentId: string,
  message: string,
  failureKind: string,
  updateResponse: (id: string, patch: Partial<AgentResponse>) => void,
  completedAt = new Date().toISOString(),
  storage: CommandConsoleQueueReceiptStorage | null = browserDraftStorage(),
): void {
  for (const queued of queuedEntries) {
    writeCommandConsoleQueueReceipt({ id: queued.id, agentId, queuedAt: queued.queuedAt, status: 'failed', reason: message, completedAt }, storage)
    updateResponse(queued.id, {
      response: message,
      ok: false,
      streaming: false,
      failureKind,
      completedAt,
      queuePosition: undefined,
      queueDepth: undefined,
      progressLabel: 'Queue stopped',
      progressLines: [message],
      progressUpdatedAt: completedAt,
    })
  }
}

export function patchQueuedCommandConsoleResponse(
  responses: AgentResponse[],
  queuedId: string,
  patch: Partial<AgentResponse>,
): AgentResponse[] {
  return responses.map((entry) => entry.id === queuedId ? applyQueuedCommandConsoleResponsePatch(entry, patch) : entry)
}

export function clearCommandConsoleQueueTimer(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  agentId: string,
): void {
  const timer = timers.get(agentId)
  if (timer) clearTimeout(timer)
  timers.delete(agentId)
}

export function createQueuedCommandConsoleResponse(input: QueuedCommandConsoleResponseInput): AgentResponse {
  const response = `Queued behind ${input.agentName}'s active Command Console turn. This follow-up will start automatically when the lane is free.`
  const activity: AgentActivityEvent = {
    id: crypto.randomUUID(),
    type: 'run.queued',
    label: 'Queued behind active Command Console turn.',
    rawSource: `control-center.command-console.${input.sourceLabel}.queue`,
    timestamp: input.queuedAt,
    severity: 'info',
    surface: 'activity',
    collapsed: false,
    dedupeKey: `run.queued:${input.queuedId}`,
  }

  return {
    id: input.queuedId,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    agentId: input.agentId,
    prompt: input.visiblePrompt,
    response,
    ok: true,
    timestamp: input.queuedAt,
    durationMs: 0,
    streaming: true,
    transport: 'command-console-queue',
    queuedAt: input.queuedAt,
    startedAt: input.queuedAt,
    queuePosition: input.queuePosition,
    queueDepth: input.queuePosition,
    progressLabel: input.queuePosition === 1 ? 'Queued next' : `Queued ${input.queuePosition}/${input.queuePosition}`,
    progressMode: 'progress',
    progressLines: queueProgressLines(input.queuePosition, input.queuePosition),
    progressUpdatedAt: input.queuedAt,
    tokenCountEstimate: estimateCommandConsoleTokenCount(response),
    activity: [activity],
  }
}

export function applyQueuedCommandConsoleResponsePatch(
  entry: AgentResponse,
  patch: Partial<AgentResponse>,
  nowMs = Date.now(),
): AgentResponse {
  const queuedAtMs = new Date(entry.queuedAt || entry.timestamp).getTime()
  const durationMs = Number.isFinite(queuedAtMs) ? Math.max(0, nowMs - queuedAtMs) : entry.durationMs
  return { ...entry, durationMs, ...patch }
}

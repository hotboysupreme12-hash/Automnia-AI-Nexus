import type { AgentActivityEvent, AgentResponse, AgentTurnAttachment } from '../types/nexus'
import { readConsolePreferences } from '../components/settings/workspaceSettings'

export const COMMAND_CONSOLE_DRAFT_PREFIX = 'automnia:command-draft:'
export const MAX_COMMAND_CONSOLE_RESPONSES = 80

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

function browserDraftStorage(): CommandConsoleDraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
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

export function makeCommandConsoleResponseState(): NexusCommandConsoleResponseState {
  return {
    agentResponses: [],
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
  const agentStillStreaming = agentResponses.some((entry) => entry.agentId === next.agentId && entry.streaming)
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

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import { CoordinationBus } from '../engine/CoordinationBus'
import { RuntimeComposer } from '../engine/RuntimeComposer'
import { MDSValidator } from '../engine/MDSValidator'
import { DEFAULT_MISSION_DRAFT, SKILL_TREE, makeDormantState, makeSeedAgents } from '../data/seeds'
import { apiErrorMessage, apiRequest } from '../api/client'
import {
  clearAgentTurnSessions,
  preflightAgentRuntime as requestAgentRuntimePreflight,
  prewarmAgentTurn,
  sendBufferedAgentTurn,
  type AgentTurnPayload as AT,
} from '../api/agentTurns'
import {
  fetchPartyOverview,
  partyAvatarUrl,
  recruitPartyAgent,
  retirePartyAgent,
  saveAgentConfig,
  saveAgentResource,
  type PartyOverviewAgent,
  type RecruitAgentRequest,
} from '../api/party'
import { apiUrl } from '../utils/apiUrl'
import { redactDiagnosticText, safeDiagnosticPayload } from '../utils/diagnosticRedaction'
import { createSseFrameParser } from '../utils/sseStream'
import type {
  AgentMessage,
  AgentMessageKind,
  AgentActivityEvent,
  AgentActivitySeverity,
  AgentActivitySurface,
  AgentActivityType,
  AgentResponse,
  AgentRarity,
  AgentRuntimePolicy,
  AgentSkillEntry,
  CapabilityKey,
  AgentMDS,
  AgentOperationState,
  AgentTurnAttachment,
  CollaborationMode,
  CoreAttributes,
  DelegationRequest,
  DurationMode,
  DurationUnit,
  FastModeDefault,
  HeartbeatConfig,
  MissionDraft,
  MissionEvent,
  MissionReport,
  MissionRun,
  OpenClawAgent,
  SoulConfig,
  ThinkingLevel,
  WorkspaceClaim,
} from '../types/nexus'

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MAX_PARTY_SIZE = 6
const PARTY_PREWARM_LIMIT = 0
const MAX_RESPONSES = 80
const MAX_FEED_EVENTS = 120
const MAX_REPORTS = 30
const MAX_HISTORY = 40
const MAX_ACTIVITY_EVENTS = 80
const PROGRESS_DRAFT_MAX_LINES = 4
const PROGRESS_DRAFT_MAX_LINE_CHARS = 120
const NEXUS_STORAGE_KEY = 'nexus-v10'
const DEFAULT_TEMPLATE_AGENT_ID = 'hn-commander'
const DEFAULT_ACTIVE_PARTY_IDS = [
  'hn-commander',
  'hn-coordinator',
  'hn-builder',
  'hn-reviewer',
  'hn-architect',
  'hn-fullstack',
]
const LEGACY_DEFAULT_PARTY_IDS = [
  'hn-netanyahu',
  'hn-commander',
  'hn-coordinator',
  'hn-builder',
  'hn-reviewer',
]
const FAST_THINKING: ThinkingLevel = 'off'
const FAST_MODE_DEFAULT: FastModeDefault = 'auto'
const MISSION_THINKING: ThinkingLevel = 'minimal'
const FAST_TIMEOUT_SECONDS = 90
const MISSION_DEFAULT_TIMEOUT_SECONDS = 12 * 60
const WORKING_STATUS_INTERVAL_MS = 60 * 1000
const seenClawTalkConsoleEventIds = new Set<string>()
const TEAMMATE_MEMORY_REPLY_LIMIT = 10
const TEAMMATE_MEMORY_LINE_MAX = 180
const HEARTBEAT_CONFIG_SAVE_DEBOUNCE_MS = 350
const RUNTIME_POLICY_SAVE_DEBOUNCE_MS = 450
const STORAGE_WRITE_DEBOUNCE_MS = 120
const STORAGE_QUOTA_WARNING_COOLDOWN_MS = 60 * 1000
const MAX_PERSISTED_PORTRAIT_LENGTH = 2048
const RETIRE_AGENT_TIMEOUT_MS = 45 * 1000
const heartbeatConfigSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const heartbeatConfigSaveSeq = new Map<string, number>()
const runtimePolicySaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const runtimePolicySaveSeq = new Map<string, number>()
const agentConfigPatchSaveSeq = new Map<string, number>()
const pendingStorageWrites = new Map<string, string>()
const storageQuotaLastWarnedAt = new Map<string, number>()
let pendingStorageWriteTimer: ReturnType<typeof setTimeout> | null = null
let storageFlushListenerInstalled = false

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function withComputedRuntime(agent: OpenClawAgent): OpenClawAgent {
  const preview = RuntimeComposer.compose(agent)
  return { ...agent, runtime: { ...preview, ...agent.runtime } }
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014
    : error instanceof Error && error.name === 'QuotaExceededError'
}

function warnStorageQuotaSkipped(name: string, value: string): void {
  const now = Date.now()
  const lastWarnedAt = storageQuotaLastWarnedAt.get(name) || 0
  if (now - lastWarnedAt < STORAGE_QUOTA_WARNING_COOLDOWN_MS) return
  storageQuotaLastWarnedAt.set(name, now)

  const approxKb = Math.max(1, Math.round(value.length / 1024))
  console.warn(`DystopAI local persistence skipped because browser storage quota is full (${name}, ~${approxKb} KB).`)
}

function writeLocalStorageItem(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error

    // Replacing a huge existing value can fail because browsers may reserve
    // space for the new value before freeing the old one. Remove first, then
    // write the compact payload generated by partialize().
    if (localStorage.getItem(name) !== null) {
      localStorage.removeItem(name)
      try {
        localStorage.setItem(name, value)
        return
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) throw retryError
      }
    }

    warnStorageQuotaSkipped(name, value)
  }
}

function flushPendingStorageWrites(): void {
  if (pendingStorageWriteTimer) {
    clearTimeout(pendingStorageWriteTimer)
    pendingStorageWriteTimer = null
  }

  const writes = Array.from(pendingStorageWrites.entries())
  pendingStorageWrites.clear()
  for (const [name, value] of writes) writeLocalStorageItem(name, value)
}

function scheduleStorageWrite(name: string, value: string): void {
  pendingStorageWrites.set(name, value)
  if (pendingStorageWriteTimer) clearTimeout(pendingStorageWriteTimer)
  pendingStorageWriteTimer = setTimeout(flushPendingStorageWrites, STORAGE_WRITE_DEBOUNCE_MS)
}

function ensureStorageFlushListener(): void {
  if (storageFlushListenerInstalled || typeof window === 'undefined') return
  storageFlushListenerInstalled = true
  window.addEventListener('beforeunload', flushPendingStorageWrites)
}

function makeQuotaSafeLocalStorage(): StateStorage {
  ensureStorageFlushListener()
  return {
    getItem: (name) => pendingStorageWrites.get(name) ?? localStorage.getItem(name),
    removeItem: (name) => {
      pendingStorageWrites.delete(name)
      localStorage.removeItem(name)
    },
    setItem: scheduleStorageWrite,
  }
}

function updateAgentInList(agents: OpenClawAgent[], agentId: string, updater: (a: OpenClawAgent) => OpenClawAgent): OpenClawAgent[] {
  return agents.map((a) => (a.id === agentId ? withComputedRuntime(updater(a)) : a))
}

type AgentConfigSaveScope = 'heartbeat' | 'runtime' | 'profile' | 'policy' | 'mds' | 'skills'
type AgentConfigSavePhase = 'saving' | 'saved' | 'failed'

type AgentConfigSaveEntry = {
  phase: AgentConfigSavePhase
  message: string
  revision: number
  updatedAt: string
  requestId?: string
}

type AgentConfigSaveStatus = Partial<Record<AgentConfigSaveScope, AgentConfigSaveEntry>>

type AgentConfigSaveReporter = (agentId: string, scope: AgentConfigSaveScope, entry: AgentConfigSaveEntry) => void

function updateAgentConfigSaveStatus(
  current: Record<string, AgentConfigSaveStatus>,
  agentId: string,
  scope: AgentConfigSaveScope,
  entry: AgentConfigSaveEntry,
): Record<string, AgentConfigSaveStatus> {
  return {
    ...current,
    [agentId]: {
      ...(current[agentId] || {}),
      [scope]: entry,
    },
  }
}

function configSaveEntry(phase: AgentConfigSavePhase, message: string, revision: number, requestId?: string): AgentConfigSaveEntry {
  return { phase, message, revision, requestId, updatedAt: new Date().toISOString() }
}

function agentConfigPatchKey(agentId: string, scope: AgentConfigSaveScope): string {
  return `${agentId}:${scope}`
}

function persistAgentConfigPatch(
  agentId: string,
  scope: AgentConfigSaveScope,
  body: Record<string, unknown>,
  messages: { saving: string; saved: string; failed: string },
  report: AgentConfigSaveReporter,
) {
  const key = agentConfigPatchKey(agentId, scope)
  const nextSeq = (agentConfigPatchSaveSeq.get(key) || 0) + 1
  agentConfigPatchSaveSeq.set(key, nextSeq)
  report(agentId, scope, configSaveEntry('saving', messages.saving, nextSeq))

  void saveAgentConfig(agentId, body).then((result) => {
    if (agentConfigPatchSaveSeq.get(key) !== nextSeq) return
    report(
      agentId,
      scope,
      result.ok
        ? configSaveEntry('saved', messages.saved, nextSeq, result.requestId)
        : configSaveEntry('failed', `${messages.failed}: ${apiErrorMessage(result.error)}`, nextSeq, result.requestId),
    )
  })
}

function persistHeartbeatConfig(agentId: string, heartbeat: HeartbeatConfig, report: AgentConfigSaveReporter) {
  const nextSeq = (heartbeatConfigSaveSeq.get(agentId) || 0) + 1
  heartbeatConfigSaveSeq.set(agentId, nextSeq)
  report(agentId, 'heartbeat', configSaveEntry('saving', 'Saving heartbeat settings...', nextSeq))

  const existingTimer = heartbeatConfigSaveTimers.get(agentId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    heartbeatConfigSaveTimers.delete(agentId)
    const seq = heartbeatConfigSaveSeq.get(agentId)
    if (seq !== nextSeq) return
    void saveAgentConfig(agentId, {
      heartbeat: {
        tickIntervalMs: heartbeat.tickIntervalMs,
        maxExecutionTimeMs: heartbeat.maxExecutionTimeMs,
        idleTimeoutMs: heartbeat.idleTimeoutMs,
        continuous: heartbeat.continuous,
        recoveryMode: heartbeat.recoveryMode,
      },
    }).then((result) => {
      if (heartbeatConfigSaveSeq.get(agentId) !== nextSeq) return
      report(
        agentId,
        'heartbeat',
        result.ok
          ? configSaveEntry('saved', 'Heartbeat settings saved.', nextSeq, result.requestId)
          : configSaveEntry('failed', `Heartbeat save failed: ${apiErrorMessage(result.error)}`, nextSeq, result.requestId),
      )
    })
  }, HEARTBEAT_CONFIG_SAVE_DEBOUNCE_MS)

  heartbeatConfigSaveTimers.set(agentId, timer)
}

function persistRuntimePolicy(agentId: string, runtimePolicy: AgentRuntimePolicy | undefined, report: AgentConfigSaveReporter) {
  const nextSeq = (runtimePolicySaveSeq.get(agentId) || 0) + 1
  runtimePolicySaveSeq.set(agentId, nextSeq)
  report(agentId, 'runtime', configSaveEntry('saving', 'Saving runtime policy...', nextSeq))

  const existingTimer = runtimePolicySaveTimers.get(agentId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    runtimePolicySaveTimers.delete(agentId)
    const seq = runtimePolicySaveSeq.get(agentId)
    if (seq !== nextSeq) return
    void saveAgentConfig(agentId, {
      runtime: {
        thinkingDefault: runtimePolicy?.thinkingDefault,
        timeoutSeconds: runtimePolicy?.timeoutSeconds,
        parallelPreferred: runtimePolicy?.parallelPreferred,
        fastModeDefault: runtimePolicy?.fastModeDefault,
      },
    }).then((result) => {
      if (runtimePolicySaveSeq.get(agentId) !== nextSeq) return
      report(
        agentId,
        'runtime',
        result.ok
          ? configSaveEntry('saved', 'Runtime policy saved.', nextSeq, result.requestId)
          : configSaveEntry('failed', `Runtime policy save failed: ${apiErrorMessage(result.error)}`, nextSeq, result.requestId),
      )
    })
  }, RUNTIME_POLICY_SAVE_DEBOUNCE_MS)

  runtimePolicySaveTimers.set(agentId, timer)
}

function normalizeOperatorPrompt(prompt: string): string {
  const trimmed = prompt.trim()
  return trimmed.replace(/^(prompt:\s*)+/i, '').trim() || trimmed
}

function isContinuationPrompt(prompt: string): boolean {
  return /\b(continue|keep building|refine|already started|update\s+teamsync|team\s*sync|carry on|pick up|resume)\b/i.test(prompt)
}

function isLoopingMission(mission: Pick<MissionDraft, 'durationMode'>): boolean {
  return mission.durationMode === 'timed' || mission.durationMode === 'continuous' || mission.durationMode === 'indefinite'
}

function missionWorkTimeoutSeconds(agent: OpenClawAgent | undefined): number {
  const timeout = Number(agent?.runtimePolicy?.timeoutSeconds ?? MISSION_DEFAULT_TIMEOUT_SECONDS)
  return Math.max(30, Math.min(7200, Math.round(Number.isFinite(timeout) ? timeout : MISSION_DEFAULT_TIMEOUT_SECONDS)))
}

function shouldUseCommanderCycle(mission: MissionRun): boolean {
  return isLoopingMission(mission) && mission.collaborationMode !== 'sequential' && mission.selectedAgents.length > 1
}

function compactLine(value: string, max = 140): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function redactActivityText(value: string, max = 500): string {
  return redactDiagnosticText(value, max)
}

function safeActivityPayload(raw: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  return safeDiagnosticPayload(raw)
}

function activityTypeForOperationalText(rawText: string, eventName = 'progress'): AgentActivityType {
  const text = rawText.toLowerCase()
  if (eventName === 'error') return 'run.failed'
  if (eventName === 'final') return 'run.finished'
  if (/\b(waiting|pending approval|approval required|blocked by approval)\b/.test(text)) return 'approval.pending'
  if (/\b(compact|compaction|context.*overflow|context.*prun)\b/.test(text)) return 'run.compacting_context'
  if (/\b(retry|retrying|fallback|recover)\b/.test(text)) return 'run.retrying'
  if (/\b(browser).*(fail|error|unreachable|disconnect|timeout|conflict)\b/.test(text)) return 'browser.error'
  if (/\b(browser|chrome|tab|page)\b.*\b(navigate|visit|load|open)\b|\b(navigate|visit|load|open)\b.*\b(browser|chrome|tab|page|url)\b/.test(text)) return 'browser.navigating'
  if (/\b(browser|snapshot|page)\b.*\b(read|inspect|extract|snapshot)\b|\b(read|inspect|extract|snapshot)\b.*\b(page|browser)\b/.test(text)) return 'browser.reading'
  if (/\b(click|press button|select)\b/.test(text)) return 'browser.clicking'
  if (/\b(type|fill|input)\b/.test(text)) return 'browser.typing'
  if (/\b(download)\b/.test(text)) return 'browser.downloading'
  if (/\b(browser|chrome|relay|cdp)\b/.test(text)) return 'browser.opening'
  if (/\b(tool).*\b(fail|error|blocked|refusal|denied)\b/.test(text)) return 'tool.error'
  if (/\b(tool).*\b(done|complete|finished)\b/.test(text)) return 'tool.finished'
  if (/\b(tool|mcp|plugin)\b/.test(text)) return 'tool.progress'
  if (/\b(command|shell|exec|child process|openclaw process)\b.*\b(fail|error|exit code [1-9])\b/.test(text)) return 'command.failed'
  if (/\b(command|shell|exec|child process|openclaw process)\b/.test(text)) return 'command.started'
  if (/\b(reading|searching|inspecting|scanning)\b.*\b(file|project|workspace|repo)\b|\b(file|project|workspace|repo)\b.*\b(reading|searching|inspecting|scanning)\b/.test(text)) return 'file.reading'
  if (/\b(writing|patching|editing|applying patch)\b/.test(text)) return text.includes('patch') ? 'file.patching' : 'file.writing'
  if (/\b(final|finalizing|preparing final|returned a final)\b/.test(text)) return 'agent.finalizing'
  if (/\b(started|handoff|accepted|selected)\b/.test(text)) return 'run.started'
  if (/\b(waiting)\b/.test(text)) return 'agent.waiting'
  return 'agent.working'
}

function severityForActivity(type: string, payload?: Record<string, unknown>): AgentActivitySeverity {
  if (type.endsWith('.error') || type.endsWith('.failed') || payload?.ok === false) return 'error'
  if (type.endsWith('.warning') || type.endsWith('.blocked') || type === 'approval.pending') return 'warning'
  if (type.endsWith('.finished') || type.endsWith('.final') || type === 'gateway.health.ok') return 'success'
  return 'info'
}

function surfaceForActivity(type: string): AgentActivitySurface {
  if (type.startsWith('message.')) return 'activity'
  if (type.startsWith('tool.') || type.startsWith('browser.') || type.startsWith('command.') || type.startsWith('approval.')) return 'both'
  return 'activity'
}

function uniqueAgentIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const rawId of ids) {
    const id = rawId?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next
}

function agentContextLabel(agent: OpenClawAgent | undefined, id: string): string {
  if (!agent) return id
  const role = agent.role?.trim()
  return `${agent.name} (${agent.id})${role ? `, ${role}` : ''}`
}

function resolveTeammateContextAgentIds(input: {
  currentAgentId: string
  agents: OpenClawAgent[]
  contextAgentIds?: string[]
  activeMission: MissionRun | null
  confirmedPartyIds: string[]
  activePartyIds: string[]
  selectedAgentIds: string[]
}): string[] {
  const knownIds = new Set(input.agents.map((agent) => agent.id))
  const usable = (ids: Array<string | null | undefined>) => uniqueAgentIds(ids).filter((id) => knownIds.has(id))
  const explicit = usable(input.contextAgentIds || [])
  if (explicit.length > 1 || explicit.includes(input.currentAgentId)) return explicit
  const missionIds = input.activeMission?.status === 'running' ? usable(input.activeMission.selectedAgents) : []
  if (missionIds.length > 1 || missionIds.includes(input.currentAgentId)) return missionIds
  const partyIds = usable(input.confirmedPartyIds.length ? input.confirmedPartyIds : input.activePartyIds)
  if (partyIds.length > 1 || partyIds.includes(input.currentAgentId)) return partyIds
  const selectedIds = usable(input.selectedAgentIds)
  if (selectedIds.length > 1 || selectedIds.includes(input.currentAgentId)) return selectedIds
  return usable([input.currentAgentId])
}

function buildRecentTeammateMemoryBlock(input: {
  currentAgentId: string
  agents: OpenClawAgent[]
  agentResponses: AgentResponse[]
  contextAgentIds?: string[]
  activeMission: MissionRun | null
  confirmedPartyIds: string[]
  activePartyIds: string[]
  selectedAgentIds: string[]
}): string {
  const contextIds = resolveTeammateContextAgentIds(input)
  const teammates = contextIds.filter((id) => id !== input.currentAgentId)
  if (!teammates.length) return ''

  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]))
  const teammateSet = new Set(teammates)
  const roster = contextIds
    .map((id) => `${agentContextLabel(agentById.get(id), id)}${id === input.currentAgentId ? ' [you]' : ''}`)
    .join('; ')
  const replies = input.agentResponses
    .filter((entry) => teammateSet.has(entry.agentId) && !entry.streaming && entry.response.trim())
    .slice(0, TEAMMATE_MEMORY_REPLY_LIMIT)
    .reverse()

  return [
    `Teammate memory (subtle awareness only; bounded to last ${TEAMMATE_MEMORY_REPLY_LIMIT} teammate replies):`,
    `Team in this chat: ${roster}`,
    replies.length
      ? [
          'Recent teammate replies, oldest to newest:',
          ...replies.map((entry) => {
            const when = new Date(entry.timestamp).toLocaleTimeString()
            const status = entry.ok ? 'ok' : 'blocked'
            return `- ${agentContextLabel(agentById.get(entry.agentId), entry.agentId)} at ${when} [${status}]: ${compactLine(entry.response, TEAMMATE_MEMORY_LINE_MAX)}`
          }),
        ].join('\n')
      : 'Recent teammate replies: none yet.',
    'Use this to avoid repeating teammates and to acknowledge relevant prior points; do not recap it unless it matters.',
  ].join('\n')
}

function inferDelegationTurnOutcome(ok: boolean, response: string): 'completed' | 'in_progress' | 'rejected' {
  if (!ok) return 'rejected'
  const text = response.toLowerCase()
  if (
    (/\b(preflight blocked|blocked|blocker|cannot|can't|unable|failed|timed out|timeout|runtime error|request failed)\b/.test(text) ||
      /(^|\n)\s*error[:\s]/.test(text)) ||
    /\bneed(?:s|ed)?\s+(?:clarification|access|permission|credentials|input|decision|commander|teammate|human)\b/.test(text) ||
    /\bwaiting\s+(?:on|for)\b/.test(text)
  ) {
    return 'rejected'
  }
  const partial =
    /\b(in progress|partial|partially|continuing|still working|not done|not complete|remaining|follow-?up needed|more work needed)\b/.test(text)
  const concreteEvidence =
    /\b(done|completed|finished|implemented|updated|created|fixed|verified|validated|passed|changed|wrote|added|removed|audited|reviewed|documented|evidence|files? touched|tests? run|cycle_verdict|final_verdict)\b/.test(text)
  return partial && !concreteEvidence ? 'in_progress' : 'completed'
}

function requestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return `${error.name}: ${error.message}`
  return String(error)
}

function normalizeSkillEntry(skill: AgentSkillEntry): AgentSkillEntry | null {
  const id = skill.id.trim()
  if (!id) return null
  return {
    id,
    name: compactLine(skill.name || id, 96),
    description: compactLine(skill.description || `Reusable skill ${id}.`, 240),
    source: skill.source,
    ...(skill.path ? { path: skill.path } : {}),
    ...(skill.learnedAt ? { learnedAt: skill.learnedAt } : {}),
    ...(typeof skill.xpValue === 'number' ? { xpValue: skill.xpValue } : {}),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BUILTIN_RETIRED_AGENT_IDS = new Set([
  'recruit-check-mps3678p',
  'no-such-agent',
  'hn-builder',
  'hn-franklin',
  'hn-trump',
])
const RETIRED_AGENT_IDS = new Set(BUILTIN_RETIRED_AGENT_IDS)

function normalizeRetiredAgentId(agentId: string | undefined): string {
  return agentId?.trim().toLowerCase() || ''
}

function rememberRetiredAgentIds(ids: unknown): string[] {
  const input = Array.isArray(ids) ? ids : []
  for (const rawId of input) {
    if (typeof rawId !== 'string') continue
    const id = normalizeRetiredAgentId(rawId)
    if (/^[a-z0-9-]+$/.test(id)) RETIRED_AGENT_IDS.add(id)
  }
  return retiredAgentIdsForStore()
}

function rememberRetiredAgentId(agentId: string): string[] {
  const id = normalizeRetiredAgentId(agentId)
  if (/^[a-z0-9-]+$/.test(id)) RETIRED_AGENT_IDS.add(id)
  return retiredAgentIdsForStore()
}

function retiredAgentIdsForStore(): string[] {
  return [...RETIRED_AGENT_IDS]
    .filter((id) => !BUILTIN_RETIRED_AGENT_IDS.has(id))
    .sort((a, b) => a.localeCompare(b))
}

function isRetiredAgentId(agentId: string | undefined): boolean {
  const id = normalizeRetiredAgentId(agentId)
  return Boolean(id && RETIRED_AGENT_IDS.has(id))
}

/* ---- memoized seed agents (called frequently, avoid recompute) ---- */
let _seedCache: OpenClawAgent[] | null = null
function getSeedAgents(): OpenClawAgent[] {
  if (!_seedCache) _seedCache = makeSeedAgents()
  return _seedCache
}

function resolveDefaultTemplateAgentId(agents: OpenClawAgent[]): string | null {
  const selectableAgents = agents.filter((agent) => !isRetiredAgentId(agent.id))
  if (selectableAgents.some((agent) => agent.id === DEFAULT_TEMPLATE_AGENT_ID)) return DEFAULT_TEMPLATE_AGENT_ID
  return selectableAgents.find((agent) => agent.id !== 'hn-netanyahu')?.id ?? selectableAgents[0]?.id ?? null
}

function getDefaultTemplateAgent(): OpenClawAgent {
  const agents = getSeedAgents()
  const defaultId = resolveDefaultTemplateAgentId(agents)
  return agents.find((agent) => agent.id === defaultId) ?? agents[0]!
}

function makeDefaultParty(agents: OpenClawAgent[]): string[] {
  const validIds = new Set(agents.map((agent) => agent.id).filter((id) => !isRetiredAgentId(id)))
  const preferred = DEFAULT_ACTIVE_PARTY_IDS.filter((id) => validIds.has(id))
  const preferredIds = new Set(preferred)
  const fillers = agents
    .map((agent) => agent.id)
    .filter((id) => validIds.has(id) && !preferredIds.has(id) && id !== 'hn-netanyahu')
  const fallback = agents
    .map((agent) => agent.id)
    .filter((id) => validIds.has(id) && !preferredIds.has(id) && !fillers.includes(id))
  return [...preferred, ...fillers, ...fallback].slice(0, MAX_PARTY_SIZE)
}

function sameOrderedIds(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((id, index) => id === right[index])
}

function sanitizePartyIds(ids: unknown, agents: OpenClawAgent[]): string[] {
  if (!Array.isArray(ids)) return makeDefaultParty(agents)
  const validIds = new Set(agents.map((agent) => agent.id).filter((id) => !isRetiredAgentId(id)))
  const next: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !validIds.has(id) || next.includes(id)) continue
    next.push(id)
    if (next.length >= MAX_PARTY_SIZE) break
  }
  return next
}

function normalizeInitialSelection(agents: OpenClawAgent[], selectedAgentId?: unknown, selectedAgentIds?: unknown): Pick<NexusState, 'selectedAgentId' | 'selectedAgentIds'> {
  const validIds = new Set(agents.map((agent) => agent.id).filter((id) => !isRetiredAgentId(id)))
  const ids = Array.isArray(selectedAgentIds)
    ? selectedAgentIds.filter((id, index): id is string => typeof id === 'string' && validIds.has(id) && selectedAgentIds.indexOf(id) === index)
    : []
  const id: string | null = typeof selectedAgentId === 'string' && validIds.has(selectedAgentId)
    ? selectedAgentId
    : ids[0] ?? null

  if (id && !ids.includes(id)) {
    return { selectedAgentId: id, selectedAgentIds: [id, ...ids] }
  }

  return { selectedAgentId: id, selectedAgentIds: ids }
}

const DEFAULT_AGENT_PORTRAIT_SUFFIXES: Record<string, string[]> = {
  'hn-netanyahu': ['agents/benjamin-netanyahu.jpg', 'agents/generated/benjamin-netanyahu.jpg'],
  'hn-commander': ['agents/donald-trump.jpg', 'agents/generated/donald-trump.jpg'],
  'hn-coordinator': ['agents/sarah-cooper.jpg', 'agents/generated/sarah-cooper.jpg'],
  'hn-builder': ['agents/james-roberts.jpg', 'agents/generated/james-roberts.jpg'],
  'hn-reviewer': ['agents/brandon-riley.jpg', 'agents/generated/brandon-riley.jpg'],
  'hn-crypto-lead': ['agents/marcus-chen.jpg', 'agents/generated/marcus-chen.jpg'],
  'hn-crypto-technical': ['agents/diana-reyes.jpg', 'agents/generated/diana-reyes.jpg'],
  'hn-crypto-onchain': ['agents/viktor-volkov.jpg', 'agents/generated/viktor-volkov.jpg'],
  'hn-crypto-quant': ['agents/aisha-patel.jpg', 'agents/generated/aisha-patel.jpg'],
  'hn-crypto-sentiment': ['agents/zoe-kim.jpg', 'agents/generated/zoe-kim.jpg'],
  'hn-buffett': ['agents/warren-buffett.jpg', 'agents/generated/warren-buffett.jpg'],
  'hn-architect': ['agents/elena-vasquez.svg', 'agents/generated/elena-vasquez.jpg'],
  'hn-devops': ['agents/marcus-thorne.svg', 'agents/generated/marcus-thorne.jpg'],
  'hn-fullstack': ['agents/priya-sharma.svg', 'agents/generated/priya-sharma.jpg'],
  'hn-security': ['agents/thomas-blackwood.svg', 'agents/generated/thomas-blackwood.jpg'],
  'hn-testing': ['agents/yuki-tanaka.svg', 'agents/generated/yuki-tanaka.jpg'],
  'hn-ux': ['agents/olivia-chen.svg', 'agents/generated/olivia-chen.jpg'],
}

function isDefaultAgentPortrait(agentId: string, portrait: string | undefined): boolean {
  if (!portrait?.trim()) return false
  const normalized = portrait.trim().replace(/\\/g, '/').replace(/^https?:\/\/[^/]+/i, '')
  return Boolean(DEFAULT_AGENT_PORTRAIT_SUFFIXES[agentId]?.some((suffix) => normalized.endsWith(suffix)))
}

function isUsablePortrait(value: string | undefined): value is string {
  if (!value?.trim()) return false
  if (value.startsWith('data:')) return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(value)
  return true
}

function portraitFromOverview(entry: PartyOverviewAgent, existing: OpenClawAgent | undefined, seed: OpenClawAgent | undefined): string {
  const candidate = entry.avatar?.trim()
  if (candidate) {
    const isBrowserAssetPath = candidate.startsWith('/agents/') || candidate.startsWith(`${import.meta.env.BASE_URL}agents/`)
    // Accept browser assets, URLs, and data URIs. Relative filesystem paths (like .openclaw/avatars/...)
    // cannot be displayed in the browser — treat them as absent and fall through to seed.
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      if (isUsablePortrait(candidate)) return candidate
    } else if (isBrowserAssetPath) {
      if (isUsablePortrait(candidate)) return candidate
    } else if (candidate.startsWith('data:') && isUsablePortrait(candidate)) {
      return candidate
    } else {
      return partyAvatarUrl(entry.id)
    }
  }
  if (existing && isUsablePortrait(existing.portrait) && !isDefaultAgentPortrait(existing.id, existing.portrait)) return existing.portrait
  if (isUsablePortrait(seed?.portrait)) return seed.portrait
  if (existing && isUsablePortrait(existing.portrait)) return existing.portrait
  return ''
}

function laneDirectiveFor(agent: OpenClawAgent, index: number): string {
  const roleText = `${agent.id} ${agent.name} ${agent.role} ${agent.className} ${agent.behaviorProfile}`.toLowerCase()
  if (roleText.includes('review') || roleText.includes('audit') || roleText.includes('risk') || roleText.includes('sentinel')) {
    return 'Own verification, risk checks, edge cases, and the shortest useful test plan.'
  }
  if (roleText.includes('build') || roleText.includes('engineer') || roleText.includes('executor') || roleText.includes('implementation')) {
    return 'Own implementation details, concrete file or command steps, and practical completion work.'
  }
  if (roleText.includes('coord') || roleText.includes('scope') || roleText.includes('strateg') || roleText.includes('architect') || index === 0) {
    return 'Own mission framing, priority order, dependencies, success conditions, and teammate alignment.'
  }
  if (roleText.includes('research') || roleText.includes('analyst')) {
    return 'Own facts, constraints, unknowns, and decision support.'
  }
  return 'Own the slice that best matches your role. Avoid duplicating teammates unless the task requires consensus.'
}

function isCommanderAgent(_agent: OpenClawAgent, index = 0): boolean {
  // Only slot 1 (index 0) is the commander. Role titles like "Scope Commander"
  // or "Strategist" on non-slot-1 agents must not override party ordering.
  return index === 0
}

function inferFilesFromText(text: string): string[] {
  const matches = text.match(/(?:[\w.-]+\/)+[\w .@()[\]-]+\.[a-z0-9]+|[\w .@()[\]-]+\.(?:tsx?|jsx?|css|json|md|html|py|txt|log)/gi) || []
  return Array.from(new Set(matches.map((match) => match.trim().replace(/[),.;:]+$/, '')))).slice(0, 8)
}

function skillTokens(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9]{4,}/g) || []).slice(0, 80))
}

function buildRelevantSkillHints(agent: OpenClawAgent | undefined, prompt: string): string {
  const enabledSkillIds = new Set(agent?.unlockedSkills || [])
  const knownSkills = (agent?.mds.skillLibrary?.knownSkills || []).filter((skill) => enabledSkillIds.has(skill.id))
  if (!agent || !knownSkills.length) return ''
  const promptTokens = skillTokens(prompt)
  const preferred = new Set(agent.mds.skillLibrary?.preferredSkills || [])
  const scored = knownSkills
    .map((skill) => {
      const haystack = skillTokens(`${skill.id} ${skill.name} ${skill.description} ${skill.path || ''}`)
      let score = preferred.has(skill.id) ? 0.75 : 0
      for (const token of promptTokens) if (haystack.has(token)) score += 1
      return { skill, score }
    })
    .filter((entry) => entry.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const selected = scored.length
    ? scored.map(({ skill }) => skill)
    : knownSkills
        .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || a.name.localeCompare(b.name))
        .slice(0, 8)

  if (!selected.length) return ''
  const skillLines = selected.map((skill) => {
    const exactPath = skill.path?.trim()
    return `- ${skill.id}: ${exactPath || 'path not indexed; use the Skills panel to resync before reading'}`
  })
  return [
    'Enabled skill files, if relevant. Read the exact SKILL.md path shown; do not rewrite it as ~/skills.',
    'Control Center shared skills live under the .openclaw skills root when listed there.',
    ...skillLines,
  ].join('\n')
}

function missionLaneTask(agent: OpenClawAgent, mission: MissionDraft, index: number, laneAgents: OpenClawAgent[]): string {
  const base = compactLine(mission.description || mission.title, 120)
  const directive = laneDirectiveFor(agent, index)
  if (isCommanderAgent(agent, index)) {
    return laneAgents.length > 1
      ? `Commander: assign ${laneAgents.length - 1} non-overlapping lanes, track blockers, synthesize final status. Goal: ${base}`
      : `Solo lane: execute the mission, track blockers, and synthesize final status. Goal: ${base}`
  }
  if (agent.behaviorProfile === 'auditor') {
    return `Verify risks, regressions, missing tests, and evidence. Goal: ${base}`
  }
  if (agent.behaviorProfile === 'researcher' || mission.missionType === 'research') {
    return `Research constraints, facts, unknowns, and decisions. Goal: ${base}`
  }
  if (agent.behaviorProfile === 'executor' || mission.missionType === 'codeGeneration') {
    return `Implement concrete edits/commands for claimed files and verify. Goal: ${base}`
  }
  return `${directive} Goal: ${base}`
}

function agentCanSpecialize(agent: OpenClawAgent, mission: MissionDraft): boolean {
  return Boolean(agent.mds.capabilities[mission.missionType])
}

function selectMissionAgentsForDraft(agents: OpenClawAgent[], partyIds: string[], mission: MissionDraft): OpenClawAgent[] {
  const partyAgents = partyIds
    .filter((id) => !isRetiredAgentId(id))
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is OpenClawAgent => Boolean(agent))
  if (mission.collaborationMode !== 'specialist') return partyAgents
  return partyAgents.filter((agent) => agentCanSpecialize(agent, mission))
}

function buildCommanderDelegationBrief(commander: OpenClawAgent, mission: MissionDraft, laneAgents: OpenClawAgent[]): string {
  const workerLines = laneAgents
    .filter((agent) => agent.id !== commander.id)
    .map((agent, index) => `A${index + 2} ${agent.id}: ${compactLine(missionLaneTask(agent, mission, index + 1, laneAgents), 150)}`)
  return [
    `Commander ${commander.id}: assign lanes first; keep implementation/review/research separate; use TEAM_SYNC; call blockers; final review includes residual risk.`,
    workerLines.length ? workerLines.join('\n') : '- No teammate lanes available; own the full loop.',
  ].join('\n')
}

function directedAssignmentForAgent(agent: OpenClawAgent, index: number, prompt: string): string | null {
  const labels = [
    String(index + 1),
    `#${index + 1}`,
    `slot\\s*${index + 1}`,
    `agent\\s*${index + 1}`,
    `@${escapeRegExp(agent.id)}`,
    escapeRegExp(agent.id),
    escapeRegExp(agent.id.replace(/^hn-/, '')),
    escapeRegExp(agent.name),
  ]
  const pattern = new RegExp(`^\\s*(?:${labels.join('|')})\\s*[:\\-]\\s+(.+)$`, 'i')
  const matches = prompt
    .split(/\r?\n/)
    .map((line) => line.match(pattern)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
  return matches.length ? matches.join('\n') : null
}

function buildParallelLanePrompt(agent: OpenClawAgent, prompt: string, laneAgents: OpenClawAgent[], index: number): string {
  const directed = directedAssignmentForAgent(agent, index, prompt)
  const assignment = directed || prompt
  const commanderBrief = isCommanderAgent(agent, index) && laneAgents.length > 1
    ? `${buildCommanderDelegationBrief(agent, { title: 'Direct Command', description: assignment, complexity: 50, riskTolerance: 30, durationMode: 'instant', durationValue: 1, durationUnit: 'hours', collaborationMode: 'parallel', missionType: 'planning' }, laneAgents)}\n`
    : ''
  return [
    `Lane ${index+1}/${laneAgents.length}: ${agent.name} (${agent.id})${index === 0 ? ' [commander]' : ''}. ${laneDirectiveFor(agent, index)}`,
    `Team: ${laneAgents.map((a)=>`${a.name} (${a.id})`).join(', ')}`,
    commanderBrief,
    assignment,
    '',
    'Continue/resume means inspect TEAM_SYNC briefly, keep your lane, append evidence. Do not use browser/canvas/gateway unless explicitly asked. Reply with files, result/blocker, next step.',
  ].join('\n')
}

function shouldUseAdHocCoordinationForPrompt(prompt: string, laneAgents: OpenClawAgent[]): boolean {
  const text = normalizeOperatorPrompt(prompt)
  if (!text || laneAgents.length <= 1) return false
  if (laneAgents.some((agent, index) => Boolean(directedAssignmentForAgent(agent, index, text)))) return true
  return /\b(mission|coordinate|orchestrate|parallel\s+lanes?|lanes?|split\s+(?:this|the\s+work|it)|delegate|delegation|assign\s+lanes?|commander|team\s*sync|TEAM_SYNC|claim\s+files?|work\s+together)\b/i.test(text)
}

/* ------------------------------------------------------------------ */
/*  Store interface                                                   */
/* ------------------------------------------------------------------ */

export type AppTab = 'agents' | 'missions' | 'monitor' | 'plugins' | 'settings'

export type RecruitAgentInput = {
  agentId: string
  name: string
  workspace?: string
  avatar?: string
  className: string
  role: string
  behaviorProfile: OpenClawAgent['behaviorProfile']
  level?: number
  primaryModel?: string
  capabilities: Partial<Record<CapabilityKey, boolean>>
  addToParty?: boolean
  resourceFiles?: Array<{ file: string; content: string }>
}

export type RecruitAgentResult = {
  agentId: string
  warnings: string[]
}

type ClawTalkConsoleEvent = {
  id?: string
  source?: string
  event?: string
  clawTalkRunId?: string
  runId?: string
  agentId?: string
  sessionKey?: string
  prompt?: string
  text?: string
  reply?: string
  message?: string
  error?: string
  detail?: string
  timestamp?: string
  ok?: boolean
  replace?: boolean
  label?: string
  transport?: string
  buffered?: boolean
  liveTokens?: boolean
  failureKind?: string
  modelId?: string
  model?: string
  provider?: string
  consoleBridgeFinal?: boolean
}

interface NexusState {
  /* --- persisted -------------------------------------------------- */
  agents: OpenClawAgent[]
  retiredAgentIds: string[]
  activePartyIds: string[]
  confirmedPartyIds: string[]
  missionDraft: MissionDraft
  missionHistory: MissionRun[]
  missionReports: MissionReport[]

  /* --- volatile --------------------------------------------------- */
  tab: AppTab
  selectedAgentId: string | null
  selectedAgentIds: string[]
  isEditorOpen: boolean
  editingAgentId: string | null
  activeMission: MissionRun | null
  missionFeed: MissionEvent[]
  agentResponses: AgentResponse[]
  busyAgentIds: string[]
  operationStates: Record<string, AgentOperationState>
  sessionWarmAgentIds: string[]
  agentConfigSaveStatus: Record<string, AgentConfigSaveStatus>

  /* --- coordination state (volatile) ------------------------------ */
  coordinationMessages: AgentMessage[]
  coordinationDelegations: DelegationRequest[]
  coordinationWorkspace: WorkspaceClaim[]

  /* --- actions ---------------------------------------------------- */
  setTab: (tab: AppTab) => void
  syncPartyOverview: () => Promise<void>
  recruitAgent: (input: RecruitAgentInput) => Promise<RecruitAgentResult>
  retireAgent: (agentId: string) => Promise<void>
  selectAgent: (agentId: string, options?: { toggle?: boolean }) => void
  clearSelectedAgents: () => void
  togglePartyMember: (agentId: string) => void
  reorderPartyMembers: (fromIndex: number, toIndex: number) => void
  confirmParty: () => void
  openEditor: (agentId: string) => void
  closeEditor: () => void

  updateMissionDraft: (patch: Partial<MissionDraft>) => void
  syncMissionProjection: () => Promise<void>
  deployMission: () => void
  steerMission: () => void
  stopMission: () => void
  sendPromptToAgent: (agentId: string, prompt: string, attachments?: AgentTurnAttachment[]) => Promise<void>
  sendPromptToSelectedAgents: (prompt: string, attachments?: AgentTurnAttachment[]) => Promise<void>
  sendPromptToActiveParty: (prompt: string, attachments?: AgentTurnAttachment[]) => Promise<void>
  stopActiveAgentRuns: (agentIds?: string[]) => number
  cancelQueuedCommandConsoleFollowup: (responseId: string) => boolean
  ingestClawTalkConsoleEvent: (event: ClawTalkConsoleEvent) => void
  clearAgentResponses: () => void
  clearAll: () => void

  updateCoreAttributes: (agentId: string, patch: Partial<CoreAttributes>) => void
  updateSoul: (agentId: string, patch: Partial<SoulConfig>) => void
  updateHeartbeat: (agentId: string, patch: Partial<HeartbeatConfig>, options?: { persist?: boolean }) => void
  updateMDS: (agentId: string, patch: Partial<AgentMDS>) => void
  updateAgentMeta: (agentId: string, patch: Partial<Pick<OpenClawAgent, 'name' | 'className' | 'role' | 'behaviorProfile' | 'level' | 'portrait' | 'portraitFocusY' | 'workspace'>>) => void
  updateAgentModel: (agentId: string, model: OpenClawAgent['model']) => void
  updateAgentRuntimePolicy: (agentId: string, patch: AgentRuntimePolicy, options?: { persist?: boolean }) => void
  toggleSkillUnlock: (agentId: string, skillId: string, enabled: boolean) => void
  setAgentEnabledSkills: (agentId: string, installedSkills: AgentSkillEntry[], enabledSkillIds: string[]) => void
  recordSkillLearned: (agentId: string, skill: AgentSkillEntry) => void

  /* --- coordination actions --------------------------------------- */
  sendAgentMessage: (fromAgentId: string, toAgentId: string | null, kind: AgentMessageKind, intent: string, context: string, expectedResponse: string) => AgentMessage | null
  acknowledgeAgentMessage: (messageId: string) => void
  completeAgentMessage: (messageId: string) => void
  delegateToAgent: (fromAgentId: string, toAgentId: string, task: string, context: string, deadlineMinutes?: number) => DelegationRequest | null
  acceptDelegation: (delegationId: string) => void
  rejectDelegation: (delegationId: string, reason: string) => void
  completeDelegation: (delegationId: string, resultSummary: string) => void
  claimWorkspace: (agentId: string, files: string[], task: string) => void
  releaseWorkspace: (agentId: string) => void

  resetMission: () => void
  resetSimulation: () => void
}

/* ------------------------------------------------------------------ */
/*  Helpers (continued)                                               */
/* ------------------------------------------------------------------ */

function clampPercent(v: number | undefined, fb = 60) {
  if (!Number.isFinite(v)) return fb
  return Math.min(99, Math.max(1, Math.round(v as number)))
}

function clampLevel(v: number | undefined, fb = 18) {
  if (!Number.isFinite(v)) return fb
  return Math.min(99, Math.max(1, Math.round(v as number)))
}

const DEFAULT_RECRUIT_CAPABILITIES: Record<CapabilityKey, boolean> = {
  codeGeneration: true,
  planning: true,
  research: false,
  orchestration: false,
  memoryManagement: true,
}

const CAPABILITY_TOOLS: Record<CapabilityKey, string[]> = {
  codeGeneration: ['filesystem', 'shell'],
  planning: ['planner'],
  research: ['web_search', 'web_fetch'],
  orchestration: ['message', 'planner'],
  memoryManagement: ['memory'],
}

const BEHAVIOR_RECRUIT_STATS: Record<OpenClawAgent['behaviorProfile'], NonNullable<PartyOverviewAgent['stats']>> = {
  executor: { execution: 86, reliability: 78, speed: 84, analysis: 72, communication: 66 },
  architect: { execution: 76, reliability: 86, speed: 66, analysis: 88, communication: 82 },
  auditor: { execution: 68, reliability: 92, speed: 62, analysis: 86, communication: 74 },
  researcher: { execution: 70, reliability: 82, speed: 68, analysis: 91, communication: 78 },
  hybrid: { execution: 80, reliability: 82, speed: 76, analysis: 82, communication: 82 },
}

const BEHAVIOR_SOUL_DEFAULTS: Record<OpenClawAgent['behaviorProfile'], Partial<SoulConfig>> = {
  executor: { personality: 'aggressive', autonomyLevel: 82, riskTolerance: 56, reflectionDepth: 58, goalOrientation: 88, persistence: 84, alignmentMode: 'balanced' },
  architect: { personality: 'analytical', autonomyLevel: 78, riskTolerance: 34, reflectionDepth: 88, goalOrientation: 86, persistence: 78, alignmentMode: 'strict' },
  auditor: { personality: 'conservative', autonomyLevel: 70, riskTolerance: 22, reflectionDepth: 92, goalOrientation: 80, persistence: 86, alignmentMode: 'strict' },
  researcher: { personality: 'analytical', autonomyLevel: 76, riskTolerance: 38, reflectionDepth: 90, goalOrientation: 78, persistence: 76, alignmentMode: 'exploratory' },
  hybrid: { personality: 'creative', autonomyLevel: 80, riskTolerance: 48, reflectionDepth: 76, goalOrientation: 82, persistence: 80, alignmentMode: 'balanced' },
}

function recruitCapabilities(input: Partial<Record<CapabilityKey, boolean>>): Record<CapabilityKey, boolean> {
  return { ...DEFAULT_RECRUIT_CAPABILITIES, ...input }
}

function recruitTools(capabilities: Record<CapabilityKey, boolean>) {
  const tools = new Set(['filesystem', 'message'])
  for (const [key, enabled] of Object.entries(capabilities) as Array<[CapabilityKey, boolean]>) {
    if (enabled) CAPABILITY_TOOLS[key].forEach((tool) => tools.add(tool))
  }
  return [...tools]
}

function recruitStats(behaviorProfile: OpenClawAgent['behaviorProfile'], capabilities: Record<CapabilityKey, boolean>) {
  const stats = { ...BEHAVIOR_RECRUIT_STATS[behaviorProfile] }
  const boost = (key: keyof typeof stats, amount: number) => {
    stats[key] = clampPercent((stats[key] || 50) + amount, stats[key] || 50)
  }
  if (capabilities.codeGeneration) boost('execution', 6)
  if (capabilities.planning) boost('analysis', 4)
  if (capabilities.research) boost('analysis', 5)
  if (capabilities.orchestration) boost('communication', 8)
  if (capabilities.memoryManagement) boost('reliability', 4)
  return stats
}

function recruitRarity(level: number): AgentRarity {
  if (level >= 45) return 'legendary'
  if (level >= 30) return 'epic'
  if (level >= 20) return 'rare'
  return 'common'
}

function recruitSkillIds(capabilities: Record<CapabilityKey, boolean>) {
  return SKILL_TREE
    .filter((skill) => capabilities[skill.capability])
    .map((skill) => skill.id)
}

function makeRecruitAgentDraft(input: RecruitAgentInput): OpenClawAgent {
  const template = getDefaultTemplateAgent()
  const capabilities = recruitCapabilities(input.capabilities)
  const tools = recruitTools(capabilities)
  const stats = recruitStats(input.behaviorProfile, capabilities)
  const level = clampLevel(input.level, 18)

  return withComputedRuntime({
    ...template,
    id: input.agentId.trim(),
    name: input.name.trim(),
    workspace: input.workspace?.trim() || '',
    sandbox: { mode: 'off', scope: 'agent', workspaceAccess: 'rw' },
    model: input.primaryModel?.trim() ? { primary: input.primaryModel.trim(), fallbacks: [] } : template.model,
    runtimePolicy: { thinkingDefault: FAST_THINKING, timeoutSeconds: FAST_TIMEOUT_SECONDS, parallelPreferred: true, fastModeDefault: FAST_MODE_DEFAULT },
    toolsPolicy: { profile: 'full', allow: tools, deny: [] },
    rarity: recruitRarity(level),
    className: input.className.trim() || 'Operator',
    role: input.role.trim() || 'Agent',
    behaviorProfile: input.behaviorProfile,
    level,
    portrait: input.avatar?.trim() || '',
    portraitFocusY: undefined,
    attributes: {
      intelligence: clampPercent(stats.analysis, 78),
      speed: clampPercent(stats.speed, 74),
      precision: clampPercent(stats.reliability, 82),
      creativity: clampPercent(Math.round(((stats.analysis || 70) + (stats.communication || 70)) / 2), 76),
      stability: clampPercent(stats.reliability, 82),
      compute: clampPercent(stats.execution, 80),
      parallelism: clampPercent(stats.communication, 72),
    },
    soul: { ...template.soul, ...BEHAVIOR_SOUL_DEFAULTS[input.behaviorProfile] },
    heartbeat: {
      tickIntervalMs: 4200,
      maxExecutionTimeMs: null,
      continuous: false,
      idleTimeoutMs: 45000,
      recoveryMode: true,
    },
    mds: {
      ...template.mds,
      capabilities,
      maxContextTokens: 32000,
      toolAccess: tools,
      delegationAllowed: true,
      subAgentSpawnLimit: capabilities.orchestration ? 4 : 2,
    },
    runtime: {
      ...template.runtime,
      temperature: input.behaviorProfile === 'auditor' ? 0.24 : input.behaviorProfile === 'researcher' ? 0.36 : 0.42,
      retryAttempts: 3,
      concurrencyLimit: capabilities.orchestration ? 4 : 2,
    },
    performance: {
      xp: level * 950,
      completedMissions: 0,
      failedMissions: 0,
      efficiencyAverage: clampPercent(Math.round(((stats.execution || 70) + (stats.reliability || 70)) / 2), 78),
      heartbeatStability: clampPercent((stats.reliability || 78) + 4, 82),
      runtimeEfficiency: clampPercent(Math.round(((stats.execution || 70) + (stats.speed || 70)) / 2), 78),
      errors: 0,
    },
    unlockedSkills: recruitSkillIds(capabilities),
  })
}

function recruitProfileStats(agent: OpenClawAgent): NonNullable<PartyOverviewAgent['stats']> {
  return {
    execution: agent.attributes.compute,
    reliability: agent.attributes.precision,
    speed: agent.attributes.speed,
    analysis: agent.attributes.intelligence,
    communication: agent.attributes.parallelism,
  }
}

function deriveBehaviorProfile(role: string, className: string): OpenClawAgent['behaviorProfile'] {
  const t = `${role} ${className}`.toLowerCase()
  if (t.includes('review') || t.includes('audit') || t.includes('risk') || t.includes('sentinel')) return 'auditor'
  if (t.includes('coord') || t.includes('scope') || t.includes('strateg') || t.includes('architect')) return 'architect'
  if (t.includes('research') || t.includes('analyst') || t.includes('sage')) return 'researcher'
  if (t.includes('build') || t.includes('engineer') || t.includes('implementation') || t.includes('executor')) return 'executor'
  return 'hybrid'
}

function deriveRarity(a: PartyOverviewAgent): AgentRarity {
  if ((a.id || '').toLowerCase().includes('franklin') || (a.name || '').toLowerCase().includes('franklin')) return 'legendary'
  const lv = Math.max(1, Math.round(a.level || 1))
  if (lv >= 45) return 'legendary'
  if (lv >= 30) return 'epic'
  if (lv >= 20) return 'rare'
  return 'common'
}

function runtimePolicyFromOverview(entry: PartyOverviewAgent, existing: OpenClawAgent | undefined): AgentRuntimePolicy {
  const incoming = entry.runtime || {}
  const current = existing?.runtimePolicy || {}
  return {
    thinkingDefault: incoming.thinkingDefault ?? current.thinkingDefault ?? FAST_THINKING,
    timeoutSeconds: incoming.timeoutSeconds ?? current.timeoutSeconds ?? FAST_TIMEOUT_SECONDS,
    parallelPreferred: incoming.parallelPreferred ?? current.parallelPreferred ?? true,
    fastModeDefault: incoming.fastModeDefault ?? current.fastModeDefault ?? FAST_MODE_DEFAULT,
  }
}

function mapOverviewAgentToLocal(entry: PartyOverviewAgent, existing: OpenClawAgent | undefined): OpenClawAgent {
  const fp = `${import.meta.env.BASE_URL}agents/benjamin-franklin.jpg`
  const seedFallback = getSeedAgents().find((a) => a.id === entry.id)
  const portrait = entry.id === 'hn-franklin'
    ? fp
    : portraitFromOverview(entry, existing, seedFallback)
  const cn = (entry.className || existing?.className || 'Operator').trim() || 'Operator'
  const role = (entry.role || existing?.role || 'Agent').trim() || 'Agent'
  const analysis = clampPercent(entry.stats?.analysis, existing?.attributes.intelligence ?? 68)
  const speed = clampPercent(entry.stats?.speed, existing?.attributes.speed ?? 62)
  const precision = clampPercent(entry.stats?.reliability, existing?.attributes.precision ?? 72)
  const creativity = existing?.attributes.creativity ?? Math.max(30, Math.min(95, Math.round((analysis + speed) / 2)))
  const stability = clampPercent(entry.stats?.reliability, existing?.attributes.stability ?? 70)
  const compute = clampPercent(entry.stats?.execution, existing?.attributes.compute ?? 74)
  const parallelism = existing?.attributes.parallelism ?? clampPercent(entry.stats?.communication, 58)

  // Preserve seed-level data when backend doesn't have proper profile
  const rawLevel = Math.max(1, Math.round(entry.level || 1))
  const backendHasProfile = rawLevel >= 5 // level < 5 means backend has no real profile
  const effective = existing ?? seedFallback
  const seed = effective || getDefaultTemplateAgent()
  const lv = backendHasProfile ? rawLevel : (effective?.level ?? rawLevel)
  const backendSkillIds = Array.isArray(entry.skills)
    ? Array.from(new Set(entry.skills.map((skillId) => skillId.trim()).filter(Boolean)))
    : undefined
  const backendMds = entry.mds || {}
  const mds: AgentMDS = {
    ...seed.mds,
    ...(existing?.mds || {}),
    ...backendMds,
    capabilities: {
      ...seed.mds.capabilities,
      ...(existing?.mds.capabilities || {}),
      ...(backendMds.capabilities || {}),
    },
    toolAccess: backendMds.toolAccess || existing?.mds.toolAccess || seed.mds.toolAccess,
  }
  return withComputedRuntime({
    ...seed,
    id: entry.id,
    name: (entry.name || existing?.name || entry.id).trim(),
    workspace: entry.workspace || existing?.workspace || seed.workspace || '',
    model: entry.model || existing?.model || seed.model,
    heartbeat: { ...seed.heartbeat, ...(existing?.heartbeat || {}), ...(entry.heartbeat || {}) },
    runtimePolicy: runtimePolicyFromOverview(entry, existing),
    sandbox: entry.sandbox || existing?.sandbox,
    toolsPolicy: { ...(existing?.toolsPolicy || {}), ...(entry.toolsPolicy || {}), allow: entry.toolsPolicy?.allow || existing?.toolsPolicy?.allow || [], deny: entry.toolsPolicy?.deny || existing?.toolsPolicy?.deny || [] },
    rarity: backendHasProfile ? deriveRarity(entry) : (effective?.rarity ?? deriveRarity({ ...entry, level: effective?.level ?? entry.level })),
    className: backendHasProfile ? cn : (effective?.className ?? cn),
    role: backendHasProfile ? role : (effective?.role ?? role),
    behaviorProfile: backendHasProfile ? (entry.behaviorProfile || deriveBehaviorProfile(role, cn)) : (existing?.behaviorProfile ?? effective?.behaviorProfile ?? deriveBehaviorProfile(role, cn)),
    level: backendHasProfile ? lv : (effective?.level ?? lv),
    portrait,
    portraitFocusY: existing?.portraitFocusY,
    mds,
    attributes: { intelligence: analysis, speed, precision, creativity, stability, compute, parallelism },
    performance: { ...(existing?.performance || getDefaultTemplateAgent().performance), xp: existing?.performance?.xp || lv * 1000 },
    unlockedSkills: backendSkillIds ?? existing?.unlockedSkills ?? [],
  })
}

function xpForNextLevel(lv: number) { return Math.round(900 * 1.085 ** (Math.max(1, lv) - 1)) }
function levelFromXp(xp: number) {
  let r = Math.max(0, Math.round(xp)), lv = 1
  while (r >= xpForNextLevel(lv) && lv < 99) { r -= xpForNextLevel(lv); lv++ }
  return lv
}
function applyLevelGrowth(a: OpenClawAgent, xp: number): OpenClawAgent {
  const oldLv = Math.max(1, Math.round(a.level || 1)), newLv = levelFromXp(xp), gain = Math.max(0, newLv - oldLv)
  if (!gain) return { ...a, performance: { ...a.performance, xp } }
  const g = (v: number, amt: number) => Math.min(99, Math.max(1, Math.round(v + amt)))
  return { ...a, level: newLv, attributes: { intelligence: g(a.attributes.intelligence, gain), speed: g(a.attributes.speed, gain), precision: g(a.attributes.precision, gain), creativity: g(a.attributes.creativity, gain), stability: g(a.attributes.stability, gain), compute: g(a.attributes.compute, gain), parallelism: g(a.attributes.parallelism, gain) }, performance: { ...a.performance, xp } }
}

function sanitizeAgentForStore(agent: OpenClawAgent): OpenClawAgent {
  const pct = (value: number, fallback: number) => clampPercent(value, fallback)
  const seedPortrait = getSeedAgents().find((s) => s.id === agent.id)?.portrait || ''
  return withComputedRuntime({
    ...agent,
    portrait: isUsablePortrait(agent.portrait)
      ? agent.portrait
      : isUsablePortrait(seedPortrait)
        ? seedPortrait
        : '',
    performance: {
      ...agent.performance,
      xp: Math.max(0, Math.round(agent.performance.xp || 0)),
      completedMissions: Math.max(0, Math.round(agent.performance.completedMissions || 0)),
      failedMissions: Math.max(0, Math.round(agent.performance.failedMissions || 0)),
      efficiencyAverage: pct(agent.performance.efficiencyAverage, 70),
      heartbeatStability: pct(agent.performance.heartbeatStability, 70),
      runtimeEfficiency: pct(agent.performance.runtimeEfficiency, 70),
      errors: Math.min(99, Math.max(0, Math.round(agent.performance.errors || 0))),
    },
  })
}

function isPersistablePortrait(value: string | undefined): value is string {
  if (!isUsablePortrait(value)) return false
  const portrait = value.trim()
  if (/^(data|blob):/i.test(portrait)) return false
  return portrait.length <= MAX_PERSISTED_PORTRAIT_LENGTH
}

function sanitizeAgentForPersistentStore(agent: OpenClawAgent): OpenClawAgent {
  const sanitized = sanitizeAgentForStore(agent)
  const seedPortrait = getSeedAgents().find((s) => s.id === agent.id)?.portrait || ''
  return {
    ...sanitized,
    portrait: isPersistablePortrait(sanitized.portrait)
      ? sanitized.portrait
      : isPersistablePortrait(seedPortrait)
        ? seedPortrait
        : '',
  }
}

/* ------------------------------------------------------------------ */
/*  Initial state factory                                             */
/* ------------------------------------------------------------------ */

let coordinationBus: CoordinationBus | null = null
const continuousTimers = new Map<string, ReturnType<typeof setInterval>>()
const agentWorkingTimers = new Map<string, ReturnType<typeof setInterval>>()
const lastAgentTurnStartedAt = new Map<string, number>()
const activeAgentTurnControllers = new Map<string, Set<AbortController>>()
const operatorCancelledAgentTurns = new Set<string>()
let cycleToCommanderFn: (() => void) | null = null
let dispatchNextWorkerCycleFn: (() => void) | null = null
let refreshLoopDelegationsFn: ((commanderId: string, commanderOutput: string) => void) | null = null
const pendingWorkerCycle = new Set<string>()
let commanderCycleRetryTimer: ReturnType<typeof setTimeout> | null = null
let missionBackendPollTimer: ReturnType<typeof setInterval> | null = null

function clearAllContinuousTimers() {
  for (const timer of continuousTimers.values()) clearInterval(timer)
  continuousTimers.clear()
}

function clearMissionBackendPollTimer() {
  if (missionBackendPollTimer) clearInterval(missionBackendPollTimer)
  missionBackendPollTimer = null
}

function trackActiveAgentTurnController(agentId: string, controller: AbortController): () => void {
  const normalized = agentId.trim()
  if (!normalized) return () => {}
  let controllers = activeAgentTurnControllers.get(normalized)
  if (!controllers) {
    controllers = new Set()
    activeAgentTurnControllers.set(normalized, controllers)
  }
  controllers.add(controller)
  const cleanup = () => {
    const active = activeAgentTurnControllers.get(normalized)
    active?.delete(controller)
    if (active && active.size === 0) activeAgentTurnControllers.delete(normalized)
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  return () => {
    controller.signal.removeEventListener('abort', cleanup)
    cleanup()
  }
}

function abortActiveAgentTurns(agentIds: string[]): number {
  let stopped = 0
  for (const agentId of [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))]) {
    const controllers = activeAgentTurnControllers.get(agentId)
    if (!controllers?.size) continue
    operatorCancelledAgentTurns.add(agentId)
    for (const controller of [...controllers]) {
      if (controller.signal.aborted) continue
      controller.abort()
      stopped += 1
    }
  }
  return stopped
}

function makeInitialState() {
  const agents = getSeedAgents().filter((agent) => !isRetiredAgentId(agent.id)).map(withComputedRuntime)
  const party = makeDefaultParty(agents)
  const selection = normalizeInitialSelection(agents)
  const ops: Record<string, AgentOperationState> = {}
  for (const a of agents) ops[a.id] = makeDormantState(a.id, a.heartbeat.tickIntervalMs)
  return {
    agents,
    retiredAgentIds: retiredAgentIdsForStore(),
    activePartyIds: party,
    confirmedPartyIds: party,
    tab: 'agents' as AppTab,
    selectedAgentId: selection.selectedAgentId,
    selectedAgentIds: selection.selectedAgentIds,
    isEditorOpen: false,
    editingAgentId: null,
    missionDraft: { ...DEFAULT_MISSION_DRAFT },
    activeMission: null,
    missionHistory: [] as MissionRun[],
    missionFeed: [] as MissionEvent[],
    missionReports: [] as MissionReport[],
    agentResponses: [] as AgentResponse[],
    busyAgentIds: [] as string[],
    operationStates: ops,
    sessionWarmAgentIds: [] as string[],
    agentConfigSaveStatus: {} as Record<string, AgentConfigSaveStatus>,
    coordinationMessages: [] as AgentMessage[],
    coordinationDelegations: [] as DelegationRequest[],
    coordinationWorkspace: [] as WorkspaceClaim[],
  }
}

const baseState = makeInitialState()

/* ------------------------------------------------------------------ */
/*  Store                                                             */
/* ------------------------------------------------------------------ */

export const useNexusStore = create<NexusState>()(
  persist(
    (set, get) => {
      /* ---- inner types ---- */
      type ApiRead<T> = { payload?: T; text: string }
      type NestedRuntimePayload = {
        payloads?: Array<{ text?: string }>
        result?: { payloads?: Array<{ text?: string }> }
        payload?: { text?: string }
        text?: string
        message?: string
        content?: string
        summary?: string
        status?: string
      }
      type PromptRunOptions = {
        displayPrompt?: string
        includeRecentContext?: boolean
        freshSession?: boolean
        heartbeatTurn?: boolean
        thinking?: ThinkingLevel
        fastMode?: FastModeDefault
        timeoutSeconds?: number
        attachments?: AgentTurnAttachment[]
        sessionKey?: string
        forceOpenClawRuntime?: boolean
        trackMissionCycle?: boolean
        contextAgentIds?: string[]
      }
      type QueuedCommandConsoleFollowup = {
        id: string
        agentId: string
        prompt: string
        visiblePrompt: string
        options: PromptRunOptions
        queuedAt: string
        createdAt: number
      }
      const reportAgentConfigSave: AgentConfigSaveReporter = (agentId, scope, entry) => {
        set((s) => ({
          agentConfigSaveStatus: updateAgentConfigSaveStatus(s.agentConfigSaveStatus, agentId, scope, entry),
        }))
      }
      const persistConfigPatch = (
        agentId: string,
        scope: AgentConfigSaveScope,
        body: Record<string, unknown>,
        messages: { saving: string; saved: string; failed: string },
      ) => persistAgentConfigPatch(agentId, scope, body, messages, reportAgentConfigSave)
      const queuedCommandConsoleFollowups = new Map<string, QueuedCommandConsoleFollowup[]>()
      const queuedCommandConsoleTimers = new Map<string, ReturnType<typeof setInterval>>()

      /* ---- text helpers ---- */
      const ansiPattern = new RegExp(`[${String.fromCharCode(27)}@]\\x5b[0-9;]*m|${String.fromCharCode(27)}\\x5b[0-9;]*m`, 'g')
      const strip = (t: string) => t.replace(ansiPattern, '').replace(/\r/g, '').trim()
      const hasDockerFail = (t: string) => {
        const v = t.toLowerCase()
        return (
          v.includes('spawn docker enoent') ||
          (v.includes('docker') && v.includes('enoent')) ||
          v.includes('sandbox image not found') ||
          (v.includes('openclaw-sandbox') && (v.includes('not found') || v.includes('no such image'))) ||
          (v.includes('no such image') && v.includes('sandbox'))
        )
      }
      const hasGwClosed = (t: string) => { const v = t.toLowerCase(); return v.includes('gateway closed') || v.includes('no close frame') }

      const summarizeFail = (raw: string) => {
        const t = strip(raw); if (!t) return null
        if (hasDockerFail(t)) return ['Runtime sandbox failed: Docker image/runtime is not ready.', 'Auto-retry switched this agent to sandbox mode off.', 'Agent Settings -> Execution Policy -> Sandbox Mode: off'].join('\n')
        if (hasGwClosed(t)) return ['Gateway connection dropped.', 'Restart OpenClaw gateway and retry.', 'Tip: openclaw gateway --allow-unconfigured'].join('\n')
        return null
      }

      const readApi = async <T>(r: Response): Promise<ApiRead<T>> => {
        const text = await r.text().catch(() => '')
        if (!text.trim()) return { text }
        try { return { text, payload: JSON.parse(text) as T } } catch { return { text } }
      }
      const fallback = (r: Response, text = ''): AT => {
        const lower = text.toLowerCase()
        if (lower.includes('econnrefused') || lower.includes('connect refused') || lower.includes('socket hang up')) {
          return {
            ok: false,
            code: r.status,
            reply: [
              'Control Center API is offline.',
              'Restart the backend with npm run dev:server, or run npm run dev to start both client and server.',
            ].join('\n'),
            stderr: text || `HTTP ${r.status}`,
          }
        }
        return {
          ok: false,
          code: r.status,
          reply: text.trim() ? `HTTP ${r.status}: ${compactLine(text, 260)}` : `HTTP ${r.status}`,
          stderr: text || `Invalid JSON response (HTTP ${r.status})`,
        }
      }

      const extractOutput = (p: AT) => {
        const textFromUnknown = (value: unknown): string => {
          if (typeof value === 'string') return value.trim()
          if (!value) return ''
          if (value instanceof Error) return value.message.trim()
          if (typeof value !== 'object') return String(value).trim()
          const record = value as Record<string, unknown>
          const parts = [
            record.message,
            record.error,
            record.code,
            record.detail,
          ]
            .map((entry) => typeof entry === 'string' ? entry.trim() : entry && typeof entry === 'object' && !Array.isArray(entry) ? JSON.stringify(safeDiagnosticPayload(entry as Record<string, unknown>)) : entry ? String(entry).trim() : '')
            .filter(Boolean)
          return parts.length ? parts.join(': ') : JSON.stringify(safeDiagnosticPayload(record))
        }
        const replyText = textFromUnknown(p.reply)
        if (replyText) return strip(replyText)
        const errorText = textFromUnknown(p.error)
        if (errorText) {
          const detailText = textFromUnknown(p.detail)
          return strip(`${errorText}${detailText ? `\n${detailText}` : ''}`)
        }
        const raw = strip(p.stdout || p.stderr || ''); if (!raw) return 'No response.'
        const s = summarizeFail(raw); if (s) return s
        const parseNested = (v: unknown): string => {
          if (!v || typeof v !== 'object') return ''
          const o = v as NestedRuntimePayload
          const pt = [...(o.payloads || []), ...(o.result?.payloads || [])].map((i) => (i.text || '').trim()).filter(Boolean).join('\n\n')
          if (pt) return pt
          return o.payload?.text?.trim() || o.text?.trim() || o.message?.trim() || o.content?.trim() || o.summary || o.status || ''
        }
        try { const e = parseNested(JSON.parse(raw)); if (e) return e } catch { /* raw CLI output */ }
        const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).filter((l: string) => !/^"?sessionKey"?\s*:/i.test(l)).filter((l: string) => !/^\[?diagnostic]?/i.test(l)).filter((l: string) => !/^gateway target:/i.test(l)).filter((l: string) => !/^source:/i.test(l)).filter((l: string) => !/^config:/i.test(l)).filter((l: string) => !/^bind:/i.test(l)).filter((l: string) => !/^[{}[\],]+$/.test(l))
        if (!lines.length) return 'No response.'
        const extracted: string[] = []
        for (const l of lines) { try { const e = parseNested(JSON.parse(l.replace(/,$/, ''))); if (e) extracted.push(e) } catch { if (!/^"?[a-zA-Z0-9_]+"?\s*:/.test(l.replace(/,$/, ''))) extracted.push(l.replace(/,$/, '').replace(/^"|"$/g, '').trim()) } }
        return strip(extracted.join('\n')) || 'No response.'
      }
      const modelIdFromParts = (provider?: string, model?: string) => {
        const providerText = provider?.trim()
        const modelText = model?.trim()
        if (!modelText) return ''
        if (modelText.includes('/')) return modelText
        return providerText ? `${providerText}/${modelText}` : modelText
      }
      const modelIdFromTurnPayload = (payload?: AT | null) => {
        if (!payload) return ''
        return (
          payload.modelId?.trim() ||
          modelIdFromParts(payload.provider, payload.model) ||
          payload.streaming?.modelId?.trim() ||
          modelIdFromParts(payload.streaming?.provider, payload.streaming?.model)
        )
      }
      const transportFromTurnPayload = (payload?: AT | null) => {
        const streamingTransport = payload?.streaming?.transport?.trim()
        if (streamingTransport) return streamingTransport
        const runtimeTransport = payload?.runtimeTransport?.trim()
        if (runtimeTransport) return `${runtimeTransport}-agent`
        return ''
      }
      const bufferedFromTurnPayload = (payload?: AT | null) => payload?.streaming?.buffered === true || payload?.streaming?.liveTokens === false
      const isRuntimeNoticeTransport = (transport?: string) => {
        const clean = transport?.trim().toLowerCase()
        return clean === 'buffered-openclaw' ||
          clean === 'gateway-chat-agent' ||
          clean === 'gateway-agent' ||
          clean === 'local-agent' ||
          clean === 'gateway-chat' ||
          clean === 'gateway' ||
          clean === 'local'
      }
      const estimateTokenCount = (text: string) => Math.max(1, Math.ceil((text || '').length / 4))
      const inferFailureKind = (text: string, timedOut = false) => {
        const value = text.toLowerCase()
        if (timedOut || /\b(timeout|timed out|deadline exceeded|aborterror)\b/.test(value)) return 'timeout'
        if (/\b(aborted|cancelled|canceled)\b/.test(value)) return 'aborted'
        if (/\b(rate limit|too many requests|quota|429)\b/.test(value)) return 'rate_limit'
        if (/\b(oauth|token expired|refresh token|invalid_grant)\b/.test(value)) return 'auth_expired'
        if (/\b(missing auth|no usable|unauthorized|forbidden|api key|credential)\b/.test(value)) return 'auth_missing'
        if (/\b(gateway closed|no close frame|gateway|socket hang up|econnrefused|connection refused)\b/.test(value)) return 'gateway_disconnect'
        if (/\b(plugin|loader|missing dependencies)\b/.test(value)) return 'plugin_loader_error'
        if (/\b(stale lock|jsonl\.lock|file lock)\b/.test(value)) return 'stale_lock'
        if (/\b(no space left|disk full|enospc|low disk)\b/.test(value)) return 'disk_low'
        if (/\b(unsupported provider|provider unsupported|not configured for .*streaming|unsupported model|model unsupported|unknown model|model not found|model .*not (?:available|supported)|does not exist)\b/.test(value)) return 'provider_unsupported'
        if (hasDockerFail(value)) return 'sandbox_unavailable'
        if (/\b(failed to fetch|network|etimedout|econnreset|enotfound)\b/.test(value)) return 'network_error'
        return value.trim() ? 'unknown' : undefined
      }
      const isDirectToolAccessDenial = (text: string) => {
        const value = text.toLowerCase().replace(/[\u2019`]/g, "'")
        if (!value.trim()) return false
        const deniedCapability =
          /\b(?:cannot|can't|cant|can not|do not|don't|dont|unable to|not able to|no access to|lack access to|don't have access to|do not have access to|no ability to)\b[\s\S]{0,180}\b(?:use|access|interact with|run|open|execute|inspect)\b/.test(value)
        const toolSurface =
          /\b(?:tools?|filesystem|file system|terminal|shell|browser|app-control|app control|runtime|workspace|local files?)\b/.test(value)
        return deniedCapability && toolSurface
      }
      const commandConsoleSessionKey = (aid: string) => `agent:${aid}:control-center:console`

      const recordResponse = (
        aid: string,
        prompt: string,
        response: string,
        ok: boolean,
        dur = 0,
        modelId = '',
        meta: Partial<Pick<AgentResponse, 'failureKind' | 'transport' | 'buffered' | 'queuedAt' | 'startedAt' | 'firstTokenAt' | 'completedAt' | 'tokenCountEstimate'>> = {},
      ) => {
        const ts = new Date().toISOString()
        const seconds = Math.round(dur / 1000)
        const summary = compactLine(response || (ok ? 'completed' : 'blocked'), 160)
        const failureKind = meta.failureKind || (!ok ? inferFailureKind(response) : undefined)
        const missionId = get().activeMission?.id
        const fe: MissionEvent = {
          id: crypto.randomUUID(),
          missionId: missionId ?? 'direct-query',
          timestamp: ts,
          type: 'agent',
          agentId: aid,
          message: ok ? `${aid} completed (${seconds}s): ${summary}` : `${aid} blocked (${seconds}s${failureKind ? `, ${failureKind}` : ''}): ${summary}`,
          ...(failureKind ? { failureKind } : {}),
        }
        set((s) => {
          const prev = s.operationStates[aid] ?? makeDormantState(aid, 3000)
          const responseModelId = modelId.trim() || s.agents.find((entry) => entry.id === aid)?.model?.primary?.trim() || undefined
          return {
            agentResponses: [{
              id: crypto.randomUUID(),
              ...(missionId ? { missionId } : {}),
              agentId: aid,
              prompt,
              response,
              ok,
              timestamp: ts,
              durationMs: dur,
              modelId: responseModelId,
              ...(failureKind ? { failureKind } : {}),
              ...(meta.transport ? { transport: meta.transport } : {}),
              ...(meta.buffered !== undefined ? { buffered: meta.buffered } : {}),
              queuedAt: meta.queuedAt || ts,
              startedAt: meta.startedAt || meta.queuedAt || ts,
              completedAt: meta.completedAt || ts,
              ...(meta.firstTokenAt ? { firstTokenAt: meta.firstTokenAt } : {}),
              tokenCountEstimate: meta.tokenCountEstimate || estimateTokenCount(response),
            }, ...s.agentResponses].slice(0, MAX_RESPONSES),
            missionFeed: [fe, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
            operationStates: { ...s.operationStates, [aid]: { ...prev, heartbeatStatus: ok ? 'active' as const : prev.heartbeatStatus, currentPhase: ok ? 'Responded' : 'Error', logStream: [`${ok ? 'OK' : 'ERR'} ${new Date(ts).toLocaleTimeString()} ${response.slice(0, 180)}`, ...prev.logStream].slice(0, 28), uptimeMs: prev.uptimeMs + 1000 } },
          }
        })
      }

      const addMissionFeedEvent = (missionId: string, message: string, type: MissionEvent['type'] = 'mission', agentId?: string) => {
        set((s) => ({
          missionFeed: [{
            id: crypto.randomUUID(),
            missionId,
            timestamp: new Date().toISOString(),
            type,
            agentId,
            message,
          }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
        }))
      }
      type BackendMissionStatus = 'active' | 'completed' | 'cancelled'
      type BackendMission = {
        id: string
        idempotencyKey?: string
        title: string
        brief: string
        mode: 'instant' | 'hours' | 'days' | 'weeks' | 'continuous' | 'indefinite'
        amount: number | null
        missionType?: string
        collaborationMode?: string
        complexity?: number
        riskTolerance?: number
        cadenceSeconds?: number
        startAt: string
        endAt: string | null
        status: BackendMissionStatus
        party: string[]
        createdAt: string
        completedAt: string | null
        progress?: number | null
        scheduler?: MissionRun['scheduler']
        lifecycleState?: string
      }
      type BackendMissionEvent = {
        id: string
        missionId: string
        at: string
        type: 'mission_started' | 'agent_assigned' | 'agent_update' | 'mission_completed' | 'mission_cancelled'
        message: string
        agentId?: string
      }
      type BackendMissionsPayload = {
        generatedAt?: string
        missions?: BackendMission[]
        feed?: BackendMissionEvent[]
        events?: unknown[]
        reports?: MissionReport[]
        projection?: {
          source?: string
          missionCount?: number
          activeMissionCount?: number
          durableRecordCount?: number
          memoryRecordCount?: number
        }
      }
      const backendMissionStatusToRunStatus = (mission: BackendMission): MissionRun['status'] => {
        if (mission.lifecycleState === 'failed') return 'failed'
        if (mission.status === 'active') return 'running'
        if (mission.status === 'completed') return 'completed'
        return 'cancelled'
      }
      const backendMissionToRun = (mission: BackendMission, fallback: MissionDraft): MissionRun => {
        const durationMode: DurationMode =
          mission.mode === 'instant'
            ? 'instant'
            : mission.mode === 'continuous'
              ? 'continuous'
              : mission.mode === 'indefinite'
                ? 'indefinite'
                : 'timed'
        const durationUnit: DurationUnit = mission.mode === 'days' ? 'days' : mission.mode === 'weeks' ? 'weeks' : 'hours'
        return {
          id: mission.id,
          title: mission.title,
          description: mission.brief,
          complexity: mission.complexity ?? fallback.complexity,
          riskTolerance: mission.riskTolerance ?? fallback.riskTolerance,
          durationMode,
          durationValue: mission.amount || fallback.durationValue || 1,
          durationUnit,
          collaborationMode: (mission.collaborationMode as CollaborationMode) || fallback.collaborationMode,
          missionType: (mission.missionType as CapabilityKey) || fallback.missionType,
          requiredEvidence: fallback.requiredEvidence,
          selectedAgents: mission.party,
          startedAt: mission.startAt,
          endedAt: mission.completedAt,
          status: backendMissionStatusToRunStatus(mission),
          heartbeatLifecycle: 'cron scheduler controlled',
          schedulerLifecycle: `OpenClaw cron ${mission.scheduler?.policy || 'leader-first'}${mission.scheduler ? `, round ${mission.scheduler.round}` : ''}`,
          scheduler: mission.scheduler,
        }
      }
      const backendEventToMissionEvent = (event: BackendMissionEvent): MissionEvent => {
        const type: MissionEvent['type'] =
          event.type === 'agent_assigned' || event.type === 'agent_update'
            ? 'agent'
            : event.type === 'mission_cancelled' || event.type === 'mission_completed' || event.type === 'mission_started'
              ? 'mission'
              : 'runtime'
        return {
          id: event.id,
          missionId: event.missionId,
          timestamp: event.at,
          type,
          agentId: event.agentId,
          message: event.message,
        }
      }
      const syncBackendMissions = async () => {
        const result = await apiRequest<BackendMissionsPayload>('/api/missions/projection')
        if (!result.ok) throw new Error(apiErrorMessage(result.error))
        const payload = result.data || {}
        const backendMissions = payload.missions || []
        const backendReports = (payload.reports || []).slice(0, MAX_REPORTS)
        const active = backendMissions.find((mission) => mission.status === 'active')
        const fallback = get().missionDraft
        const activeRun = active ? backendMissionToRun(active, fallback) : null
        const missionFeed = (payload.feed || []).map(backendEventToMissionEvent).slice(0, MAX_FEED_EVENTS)
        const historyRuns = backendMissions
          .filter((mission) => mission.status !== 'active')
          .map((mission) => backendMissionToRun(mission, fallback))
          .slice(0, MAX_HISTORY)
        set((s) => {
          const backendReportIds = new Set(backendReports.map((report) => report.missionId))
          const backendMissionIds = new Set(backendMissions.map((mission) => mission.id))
          const retainedReports = s.missionReports.filter((report) => !backendReportIds.has(report.missionId) && !backendMissionIds.has(report.missionId))
          return {
            activeMission: activeRun,
            missionHistory: historyRuns.length ? historyRuns : s.missionHistory,
            missionFeed,
            missionReports: backendReports.length || backendMissionIds.size
              ? [...backendReports, ...retainedReports].slice(0, MAX_REPORTS)
              : s.missionReports,
          }
        })
        if (!activeRun) clearMissionBackendPollTimer()
      }
      const startMissionBackendPolling = () => {
        clearMissionBackendPollTimer()
        missionBackendPollTimer = setInterval(() => {
          void syncBackendMissions().catch(() => undefined)
        }, 4000)
      }
      const syncMissionProjection = async () => {
        await syncBackendMissions()
        if (get().activeMission?.status === 'running') startMissionBackendPolling()
      }
      void startMissionBackendPolling
      const maybeStopMissionAfterVerifiedEvidence = (aid: string, response: string) => {
        const mission = get().activeMission
        if (!mission || mission.status !== 'running') return
        const finalPass = /\bFINAL_VERDICT:\s*PASS\b/i.test(response)
        const cyclePass = /\bCYCLE_VERDICT:\s*PASS\b/i.test(response)
        if (!finalPass && !(isLoopingMission(mission) && cyclePass)) return
        // Only the commander (slot-1 agent) can issue the final verdict.
        // Worker agents completing their lanes must not auto-close the mission.
        const commanderId = mission.selectedAgents[0]
        if (aid !== commanderId) {
          addMissionFeedEvent(
            mission.id,
            `Ignored verdict from ${aid} (not commander ${commanderId}). Only the slot-1 commander can verify mission or cycle completion.`,
            'coordination',
            aid,
          )
          return
        }
        if (isLoopingMission(mission)) {
          pendingWorkerCycle.clear()
          refreshLoopDelegationsFn?.(aid, response)
          coordinationBus?.sendMessage(
            mission.id,
            aid,
            null,
            'broadcast',
            'Cycle verified; continuous mission remains active.',
            compactLine(response, 600),
            'Use the commander review as the baseline for the next lane turn.',
          )
          addMissionFeedEvent(
            mission.id,
            `Commander ${aid} verified this cycle; dispatching next work cycle to all workers.`,
            'mission',
            aid,
          )
          if (dispatchNextWorkerCycleFn) {
            setTimeout(() => dispatchNextWorkerCycleFn?.(), 500)
          }
          return
        }
        clearAllContinuousTimers()
        addMissionFeedEvent(mission.id, `Commander ${aid} verified completion evidence; backend mission lifecycle remains authoritative.`, 'mission', aid)
      }

      const preflightAgentRuntime = async (aid: string): Promise<{ ok: boolean; message?: string }> => {
        try {
          const result = await requestAgentRuntimePreflight(aid)
          if (!result.ok) {
            if (result.status === 404) return { ok: true }
            return { ok: false, message: apiErrorMessage(result.error) || `Runtime preflight failed for ${aid}` }
          }
          return { ok: true, message: result.data.message }
        } catch {
          return { ok: true }
        }
      }

      const setAgentBusy = (aid: string, busy: boolean) => set((s) => ({
        busyAgentIds: busy
          ? [...new Set([...s.busyAgentIds, aid])]
          : s.busyAgentIds.filter((id) => id !== aid),
      }))

      const stopWorkingStatus = (aid: string) => {
        const timer = agentWorkingTimers.get(aid)
        if (timer) clearInterval(timer)
        agentWorkingTimers.delete(aid)
      }

      const startWorkingStatus = (aid: string, prompt: string) => {
        stopWorkingStatus(aid)
        const timer = setInterval(() => {
          const mission = get().activeMission
          const now = new Date().toISOString()
          set((s) => {
            if (!s.busyAgentIds.includes(aid)) return s
            const prev = s.operationStates[aid] ?? makeDormantState(aid, 3000)
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - (lastAgentTurnStartedAt.get(aid) || Date.now())) / 1000))
            const line = `WORKING ${new Date(now).toLocaleTimeString()} ${Math.round(elapsedSeconds / 60)}m elapsed: ${compactLine(prompt, 120)}`
            return {
              operationStates: {
                ...s.operationStates,
                [aid]: {
                  ...prev,
                  heartbeatActive: true,
                  heartbeatStatus: 'active',
                  currentPhase: 'Working',
                  logStream: [line, ...prev.logStream].slice(0, 28),
                  uptimeMs: prev.uptimeMs + WORKING_STATUS_INTERVAL_MS,
                },
              },
              missionFeed: mission
                ? [{
                    id: crypto.randomUUID(),
                    missionId: mission.id,
                    timestamp: now,
                    type: 'runtime' as const,
                    agentId: aid,
                    message: `${aid} still working (${Math.round(elapsedSeconds / 60)}m elapsed); heartbeat skipped to avoid token burn.`,
                  }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS)
                : s.missionFeed,
            }
          })
        }, WORKING_STATUS_INTERVAL_MS)
        agentWorkingTimers.set(aid, timer)
      }

      const isLongWorkPrompt = (promptText: string) =>
        /\b(build|full build|spec-locked|implement|implementation|refine|continue|resume|team\s*sync|teamsync|source of truth|acceptance ledger|final_verdict)\b/i.test(promptText)

      const resolveRunPolicy = (aid: string, options: PromptRunOptions, promptText = '') => {
        const policy = get().agents.find((agent) => agent.id === aid)?.runtimePolicy
        const thinking = options.thinking ?? policy?.thinkingDefault ?? FAST_THINKING
        const fastMode = options.fastMode ?? policy?.fastModeDefault ?? FAST_MODE_DEFAULT
        const configuredTimeout = options.timeoutSeconds
          ?? (isLongWorkPrompt(promptText) ? Math.max(policy?.timeoutSeconds ?? 0, MISSION_DEFAULT_TIMEOUT_SECONDS) : policy?.timeoutSeconds)
          ?? FAST_TIMEOUT_SECONDS
        return {
          thinking,
          fastMode,
          timeoutSeconds: configuredTimeout,
        }
      }

      const resolveMissionTimeoutSeconds = (
        agent: OpenClawAgent | undefined,
        options?: { heartbeat?: boolean; continuation?: boolean },
      ) => {
        void options
        return missionWorkTimeoutSeconds(agent)
      }

      const promptWithAttachmentNames = (prompt: string, attachments?: AgentTurnAttachment[]) => {
        if (!attachments?.length) return prompt
        const names = attachments.map((attachment) => attachment.name).join(', ')
        return `${prompt}\n\nAttachments: ${names}`
      }

      const teamContextForPrompt = (aid: string) => {
        const s = get()
        const mission = s.activeMission
        if (!mission || mission.status !== 'running' || !coordinationBus) return ''
        const missionAgents = mission.selectedAgents
          .map((id) => s.agents.find((agent) => agent.id === id))
          .filter((agent): agent is OpenClawAgent => Boolean(agent))
        if (!missionAgents.length) return ''
        const block = coordinationBus.buildTeamContext(mission.id, aid, missionAgents)
        return coordinationBus.formatTeamContextInjection(block)
      }

      const claimPromptWorkspace = (aid: string, prompt: string, fallbackTask: string) => {
        const mission = get().activeMission
        if (!mission || mission.status !== 'running' || !coordinationBus) return
        const files = inferFilesFromText(prompt)
        const existing = coordinationBus.getWorkspaceClaimForAgent(mission.id, aid)
        if (!files.length && existing) return
        coordinationBus.claimWorkspace(mission.id, aid, files.length ? files : [`lane:${aid}`], compactLine(fallbackTask, 120), 20)
      }

      const beginCoordinationTurn = (aid: string) => {
        const mission = get().activeMission
        if (!mission || mission.status !== 'running' || !coordinationBus) return { delegationIds: [] as string[], messageIds: [] as string[] }
        const delegations = coordinationBus.getActiveDelegationsFor(mission.id, aid)
        for (const delegation of delegations) {
          if (delegation.status === 'pending') coordinationBus.acceptDelegation(mission.id, delegation.id)
          coordinationBus.progressDelegation(mission.id, delegation.id)
        }
        const messages = coordinationBus.getPendingMessagesFor(mission.id, aid)
        for (const message of messages) coordinationBus.acknowledgeMessageForAgent(mission.id, message.id, aid)
        return {
          delegationIds: delegations.map((delegation) => delegation.id),
          messageIds: messages.map((message) => message.id),
        }
      }

      const finishCoordinationTurn = (aid: string, tracked: { delegationIds: string[]; messageIds: string[] }, ok: boolean, response: string) => {
        const mission = get().activeMission
        if (!mission || !coordinationBus) return
        const summary = compactLine(response || (ok ? 'completed assigned lane' : 'blocked'), 180)
        const outcome = inferDelegationTurnOutcome(ok, response)
        for (const delegationId of tracked.delegationIds) {
          if (outcome === 'completed') coordinationBus.completeDelegation(mission.id, delegationId, summary)
          else if (outcome === 'in_progress') coordinationBus.progressDelegation(mission.id, delegationId)
          else coordinationBus.rejectDelegation(mission.id, delegationId, summary)
        }
        for (const messageId of tracked.messageIds) {
          if (outcome !== 'rejected') coordinationBus.completeMessageForAgent(mission.id, messageId, aid)
        }
        if (tracked.delegationIds.length || tracked.messageIds.length) {
          coordinationBus.sendMessage(
            mission.id,
            aid,
            null,
            outcome === 'rejected' ? 'alert' : 'report',
            outcome === 'completed' ? 'Lane turn completed.' : outcome === 'in_progress' ? 'Lane turn still in progress.' : 'Lane turn blocked.',
            summary,
            'Commander should update plan or synthesize status.',
          )
        }
      }

      const seedMissionCoordination = (mission: MissionRun, missionAgents: OpenClawAgent[], draft: MissionDraft) => {
        if (!coordinationBus || !missionAgents.length) return
        const commander = missionAgents[0]
        const seedWorkerDelegations = draft.collaborationMode !== 'hierarchical'
        for (const [index, agent] of missionAgents.entries()) {
          const task = missionLaneTask(agent, draft, index, missionAgents)
          coordinationBus.claimWorkspace(mission.id, agent.id, [`lane:${index + 1}`], task, 30)
          if (seedWorkerDelegations && agent.id !== commander.id) {
            coordinationBus.createDelegation(
              mission.id,
              commander.id,
              agent.id,
              task,
              `Mission: ${draft.title}\nSuccess criteria: ${compactLine(draft.description, 220)}\nReport file claims, verification, blockers, and reusable skills learned.`,
              draft.durationMode === 'instant' ? 10 : 30,
            )
          }
        }
        coordinationBus.sendMessage(
          mission.id,
          commander.id,
          null,
          'broadcast',
          'Commander has seeded lane ownership and delegation protocol.',
          buildCommanderDelegationBrief(commander, draft, missionAgents),
          'Acknowledge your lane, claim files, and report blockers.',
        )
      }

      const startAdHocCoordination = (prompt: string, laneAgents: OpenClawAgent[]): MissionRun | null => {
        if (!coordinationBus || !laneAgents.length) return null
        const existing = get().activeMission
        if (existing?.status === 'running') return existing
        const draft: MissionDraft = {
          ...DEFAULT_MISSION_DRAFT,
          title: 'Ad Hoc Command',
          description: prompt,
          durationMode: 'instant',
          collaborationMode: 'parallel',
          missionType: inferFilesFromText(prompt).length ? 'codeGeneration' : 'planning',
        }
        const mission: MissionRun = {
          ...draft,
          id: `adhoc-${crypto.randomUUID()}`,
          selectedAgents: laneAgents.map((agent) => agent.id),
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: 'running',
          heartbeatLifecycle: 'ad hoc command context',
        }
        seedMissionCoordination(mission, laneAgents, draft)
        set((s) => ({
          activeMission: mission,
          missionFeed: [{
            id: crypto.randomUUID(),
            missionId: mission.id,
            timestamp: new Date().toISOString(),
            type: 'mission' as const,
            message: `Ad hoc coordination started for ${laneAgents.length} lanes`,
          }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
        }))
        return mission
      }

      const finishAdHocCoordination = (missionId: string | null, message = 'Ad hoc coordination completed') => {
        if (!missionId?.startsWith('adhoc-')) return
        const mission = get().activeMission
        if (mission?.id !== missionId) return
        coordinationBus?.destroySession(missionId)
        const completedMission: MissionRun = { ...mission, status: 'completed', endedAt: new Date().toISOString() }
        set((s) => ({
          activeMission: completedMission,
          missionHistory: [completedMission, ...s.missionHistory].slice(0, MAX_HISTORY),
          missionFeed: [{
            id: crypto.randomUUID(),
            missionId,
            timestamp: new Date().toISOString(),
            type: 'mission' as const,
            message,
          }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
        }))
      }

      /* ---- agent prompt runner ---- */
      const runAgentPrompt = async (aid: string, prompt: string, options: PromptRunOptions = {}) => {
        const trimmed = prompt.trim(); if (!trimmed) return
        if (get().busyAgentIds.includes(aid)) return
        setAgentBusy(aid, true)
        const start = Date.now()
        const queuedAt = new Date(start).toISOString()
        lastAgentTurnStartedAt.set(aid, start)
        const normalized = normalizeOperatorPrompt(trimmed)
        const visiblePrompt = promptWithAttachmentNames(options.displayPrompt || normalized, options.attachments)
        startWorkingStatus(aid, visiblePrompt)
        const runPolicy = resolveRunPolicy(aid, options, `${visiblePrompt}\n${normalized}`)
        const agent = get().agents.find((entry) => entry.id === aid)
        const recentContextBlock = (() => {
          if (options.includeRecentContext === false) return ''
          const s = get()
          return buildRecentTeammateMemoryBlock({
            currentAgentId: aid,
            agents: s.agents,
            agentResponses: s.agentResponses,
            contextAgentIds: options.contextAgentIds,
            activeMission: s.activeMission,
            confirmedPartyIds: s.confirmedPartyIds,
            activePartyIds: s.activePartyIds,
            selectedAgentIds: s.selectedAgentIds,
          })
        })()
        const teamContextBlock = teamContextForPrompt(aid)
        const skillHintBlock = buildRelevantSkillHints(agent, normalized)
        claimPromptWorkspace(aid, normalized, options.displayPrompt || normalized)
        const trackedCoordination = beginCoordinationTurn(aid)
        const composedBase = [teamContextBlock, skillHintBlock, recentContextBlock, normalized].filter(Boolean).join('\n\n')
        const composed = options.freshSession ? `/new ${composedBase.replace(/^\s*\/new\b\s*/i, '')}` : composedBase
        const gatewayChatMessage = options.freshSession ? `/new ${normalized.replace(/^\s*\/new\b\s*/i, '')}` : normalized

        const liveResponseId = crypto.randomUUID()
        let liveResponseCreated = false
        let liveResponseModelId = agent?.model?.primary?.trim() || ''
        let liveTransport = 'control-center-sse'
        let liveBuffered = false
        let liveStartedAt = ''
        let liveFirstTokenAt = ''
        let liveResponseText = ''
        let liveProgressLabel = 'Working'
        let liveProgressMode: AgentResponse['progressMode'] = 'progress'
        let liveProgressUpdatedAt = ''
        let liveProgressLines: string[] = []
        let liveActivityEvents: AgentActivityEvent[] = []
        const liveActivityDedupe = new Map<string, number>()
        const addLiveActivity = (
          type: AgentActivityType | string,
          label: string,
          rawSource: string,
          options: {
            severity?: AgentActivitySeverity
            surface?: AgentActivitySurface
            collapsed?: boolean
            payload?: Record<string, unknown>
            runId?: string
            sessionId?: string
            sessionKey?: string
            parentId?: string
            dedupeKey?: string
            refresh?: boolean
          } = {},
        ) => {
          const safeLabel = redactActivityText(label, 180)
          if (!safeLabel) return
          const safePayload = safeActivityPayload(options.payload)
          const dedupeKey = options.dedupeKey || `${type}:${safeLabel}:${safePayload?.runId || options.runId || ''}:${safePayload?.sessionId || options.sessionId || ''}:${safePayload?.sessionKey || options.sessionKey || ''}`
          const nowMs = Date.now()
          const previousAt = liveActivityDedupe.get(dedupeKey) || 0
          if (nowMs - previousAt < 1500) return
          liveActivityDedupe.set(dedupeKey, nowMs)
          const event: AgentActivityEvent = {
            id: crypto.randomUUID(),
            type,
            label: safeLabel,
            rawSource,
            runId: options.runId || (typeof safePayload?.runId === 'string' ? safePayload.runId : undefined),
            sessionId: options.sessionId || (typeof safePayload?.sessionId === 'string' ? safePayload.sessionId : undefined),
            sessionKey: options.sessionKey || (typeof safePayload?.sessionKey === 'string' ? safePayload.sessionKey : undefined),
            timestamp: new Date(nowMs).toISOString(),
            severity: options.severity || severityForActivity(type, safePayload),
            surface: options.surface || surfaceForActivity(type),
            collapsed: options.collapsed ?? (type.includes('output') || type === 'message.partial'),
            ...(safePayload ? { payload: safePayload } : {}),
            dedupeKey,
            ...(options.parentId ? { parentId: options.parentId } : {}),
          }
          liveActivityEvents = [
            ...liveActivityEvents.filter((entry) => entry.dedupeKey !== dedupeKey),
            event,
          ].slice(-MAX_ACTIVITY_EVENTS)
          if (options.refresh && (liveResponseCreated || liveActivityEvents.length)) {
            upsertLiveResponse('', true, Date.now() - start, true)
          }
        }
        const upsertLiveResponse = (response: string, ok = true, dur = Date.now() - start, streaming = true, modelId = liveResponseModelId, failureKind?: string) => {
          liveResponseCreated = true
          if (response) liveResponseText = response
          const visibleResponse = response || liveResponseText
          const ts = new Date().toISOString()
          set((s) => {
            const existing = s.agentResponses.find((entry) => entry.id === liveResponseId)
            const missionId = existing?.missionId || s.activeMission?.id
            const responseModelId = modelId.trim() || existing?.modelId || s.agents.find((entry) => entry.id === aid)?.model?.primary?.trim() || undefined
            const runtimeNoticeActive = streaming && (
              existing?.runtimeNoticeActive ||
              liveBuffered ||
              isRuntimeNoticeTransport(liveTransport)
            )
            const next: AgentResponse = {
              id: liveResponseId,
              ...(missionId ? { missionId } : {}),
              agentId: aid,
              prompt: visiblePrompt,
              response: visibleResponse,
              ok,
              timestamp: existing?.timestamp || ts,
              durationMs: dur,
              modelId: responseModelId,
              streaming,
              ...(failureKind ? { failureKind } : existing?.failureKind ? { failureKind: existing.failureKind } : {}),
              transport: liveTransport,
              buffered: liveBuffered,
              ...(runtimeNoticeActive ? { runtimeNoticeActive } : {}),
              queuedAt,
              startedAt: liveStartedAt || existing?.startedAt || queuedAt,
              ...(liveFirstTokenAt ? { firstTokenAt: liveFirstTokenAt } : existing?.firstTokenAt ? { firstTokenAt: existing.firstTokenAt } : {}),
              ...(streaming ? {} : { completedAt: ts }),
              tokenCountEstimate: estimateTokenCount(visibleResponse),
              progressLabel: liveProgressLabel,
              progressMode: liveProgressMode,
              ...(liveProgressLines.length ? { progressLines: [...liveProgressLines] } : existing?.progressLines ? { progressLines: existing.progressLines } : {}),
              ...(liveProgressUpdatedAt ? { progressUpdatedAt: liveProgressUpdatedAt } : existing?.progressUpdatedAt ? { progressUpdatedAt: existing.progressUpdatedAt } : {}),
              ...(liveActivityEvents.length ? { activity: [...liveActivityEvents] } : existing?.activity?.length ? { activity: existing.activity } : {}),
            }
            return {
              agentResponses: existing
                ? s.agentResponses.map((entry) => (entry.id === liveResponseId ? next : entry))
                : [next, ...s.agentResponses].slice(0, MAX_RESPONSES),
            }
          })
        }
        const normalizeProgressLine = (value: string) => {
          return redactActivityText(strip(value).replace(/\s+/g, ' '), PROGRESS_DRAFT_MAX_LINE_CHARS)
        }
        const addLiveProgressLine = (
          rawLine: string,
          options: {
            label?: string
            mode?: AgentResponse['progressMode']
            refresh?: boolean
            activityType?: AgentActivityType | string
            rawSource?: string
            severity?: AgentActivitySeverity
            payload?: Record<string, unknown>
          } = {},
        ) => {
          const line = normalizeProgressLine(rawLine)
          if (!line) return
          liveProgressLabel = options.label || liveProgressLabel || 'Working'
          liveProgressMode = options.mode || liveProgressMode || 'progress'
          liveProgressUpdatedAt = new Date().toISOString()
          liveProgressLines = [
            ...liveProgressLines.filter((entry) => entry !== line),
            line,
          ].slice(-PROGRESS_DRAFT_MAX_LINES)
          addLiveActivity(
            options.activityType || activityTypeForOperationalText(line),
            line,
            options.rawSource || 'control-center.sse.progress',
            {
              severity: options.severity,
              payload: options.payload,
              refresh: false,
              dedupeKey: `${options.activityType || activityTypeForOperationalText(line)}:${line}`,
            },
          )
          if (liveResponseCreated || options.refresh) {
            upsertLiveResponse('', true, Date.now() - start, true)
          }
        }
        addLiveProgressLine('Agent accepted task.', {
          label: 'Starting',
          activityType: 'run.accepted',
          rawSource: 'control-center.client',
          refresh: true,
        })
        addLiveProgressLine('Building context.', {
          label: 'Starting',
          activityType: 'run.context_building',
          rawSource: 'control-center.client',
          refresh: true,
        })
        const finalizeLiveResponse = (response: string, ok: boolean, dur = Date.now() - start, failureKindOverride?: string) => {
          const ts = new Date().toISOString()
          const seconds = Math.round(dur / 1000)
          const summary = compactLine(response || (ok ? 'completed' : 'blocked'), 160)
          const failureKind = failureKindOverride || (!ok ? inferFailureKind(response) : undefined)
          const fe: MissionEvent = {
            id: crypto.randomUUID(),
            missionId: get().activeMission?.id ?? 'direct-query',
            timestamp: ts,
            type: 'agent',
            agentId: aid,
            message: ok ? `${aid} completed (${seconds}s): ${summary}` : `${aid} blocked (${seconds}s${failureKind ? `, ${failureKind}` : ''}): ${summary}`,
            ...(failureKind ? { failureKind } : {}),
          }
          set((s) => {
            const prev = s.operationStates[aid] ?? makeDormantState(aid, 3000)
            const existing = s.agentResponses.find((entry) => entry.id === liveResponseId)
            const missionId = existing?.missionId || s.activeMission?.id
            const responseModelId = liveResponseModelId || existing?.modelId || s.agents.find((entry) => entry.id === aid)?.model?.primary?.trim() || undefined
            const finalFailureKind = existing?.failureKind || failureKind
            const next: AgentResponse = {
              id: liveResponseId,
              ...(missionId ? { missionId } : {}),
              agentId: aid,
              prompt: visiblePrompt,
              response,
              ok,
              timestamp: existing?.timestamp || ts,
              durationMs: dur,
              modelId: responseModelId,
              streaming: false,
              ...(finalFailureKind ? { failureKind: finalFailureKind } : {}),
              transport: liveTransport,
              buffered: liveBuffered,
              queuedAt,
              startedAt: liveStartedAt || existing?.startedAt || queuedAt,
              ...(liveFirstTokenAt || existing?.firstTokenAt ? { firstTokenAt: liveFirstTokenAt || existing?.firstTokenAt } : {}),
              completedAt: ts,
              tokenCountEstimate: estimateTokenCount(response),
              progressLabel: liveProgressLabel,
              progressMode: liveProgressMode,
              ...(liveProgressLines.length ? { progressLines: [...liveProgressLines] } : existing?.progressLines ? { progressLines: existing.progressLines } : {}),
              ...(liveProgressUpdatedAt ? { progressUpdatedAt: liveProgressUpdatedAt } : existing?.progressUpdatedAt ? { progressUpdatedAt: existing.progressUpdatedAt } : {}),
              ...(liveActivityEvents.length ? { activity: [...liveActivityEvents] } : existing?.activity?.length ? { activity: existing.activity } : {}),
            }
            return {
              agentResponses: existing
                ? s.agentResponses.map((entry) => (entry.id === liveResponseId ? next : entry))
                : [next, ...s.agentResponses].slice(0, MAX_RESPONSES),
              missionFeed: [fe, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
              operationStates: {
                ...s.operationStates,
                [aid]: {
                  ...prev,
                  heartbeatStatus: ok ? 'active' as const : prev.heartbeatStatus,
                  currentPhase: ok ? 'Responded' : 'Error',
                  logStream: [`${ok ? 'OK' : 'ERR'} ${new Date(ts).toLocaleTimeString()} ${response.slice(0, 180)}`, ...prev.logStream].slice(0, 28),
                  uptimeMs: prev.uptimeMs + 1000,
                },
              },
            }
          })
        }
        const parseControlStream = async (res: Response): Promise<{ payload: AT; responseOk: boolean; streamed: boolean }> => {
          if (!res.body) {
            const read = await readApi<AT>(res)
            return { payload: read.payload || fallback(res, read.text), responseOk: res.ok, streamed: false }
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          const sseParser = createSseFrameParser()
          let accumulated = ''
          let finalPayload: AT | null = null
          let liveStarted = false
          const ensureLiveStarted = (placeholder = '') => {
            if (liveStarted) return
            liveStarted = true
            liveStartedAt = liveStartedAt || new Date().toISOString()
            upsertLiveResponse(placeholder, true, Date.now() - start, true)
          }
          const progressTextFromFrame = (data: Record<string, unknown>, fallback = '') => {
            const text = typeof data.text === 'string'
              ? data.text
              : typeof data.message === 'string'
              ? data.message
              : fallback
            return text.trim()
          }
          const captureStreamMeta = (data: Record<string, unknown>) => {
            const modelId = typeof data.modelId === 'string' ? data.modelId.trim() : ''
            const provider = typeof data.provider === 'string' ? data.provider.trim() : ''
            const model = typeof data.model === 'string' ? data.model.trim() : ''
            const resolved = modelId || modelIdFromParts(provider, model)
            if (resolved) liveResponseModelId = resolved
            if (typeof data.transport === 'string' && data.transport.trim()) liveTransport = data.transport.trim()
            if (data.buffered === true) liveBuffered = true
            if (data.liveTokens === false) liveBuffered = true
            if (typeof data.label === 'string' && data.label.trim()) liveProgressLabel = data.label.trim()
            if (data.mode === 'partial' || data.mode === 'block' || data.mode === 'progress') liveProgressMode = data.mode
          }
          const streamPayload = (data: Record<string, unknown>) => safeActivityPayload(data) || undefined
          const consumeFrame = (event: string, rawData: string) => {
            let data: Record<string, unknown> = {}
            try {
              data = JSON.parse(rawData) as Record<string, unknown>
            } catch (error) {
              if (event === 'final' && accumulated) {
                finalPayload = {
                  ok: true,
                  reply: accumulated,
                  code: 0,
                  streaming: { transport: 'control-center-sse', liveTokens: true },
                  warning: `Final stream metadata was malformed after live text arrived: ${String(error)}`,
                } as AT
              }
              return
            }
            if (event === 'start') {
              captureStreamMeta(data)
              ensureLiveStarted('')
              addLiveActivity('run.started', 'Agent started working.', 'control-center.sse.start', {
                payload: streamPayload(data),
                refresh: true,
              })
              if (liveTransport === 'buffered-openclaw') {
                addLiveProgressLine('Tool work started.', {
                  label: liveProgressLabel,
                  activityType: 'run.started',
                  rawSource: 'control-center.sse.start',
                  payload: streamPayload(data),
                  refresh: true,
                })
              }
              return
            }
            if (event === 'status') {
              captureStreamMeta(data)
              ensureLiveStarted('')
              const message = progressTextFromFrame(data)
              if (message) {
                const activityType = activityTypeForOperationalText(message, 'status')
                addLiveProgressLine(message, {
                  label: liveProgressLabel,
                  activityType,
                  rawSource: 'control-center.sse.status',
                  payload: streamPayload(data),
                  refresh: true,
                })
              }
              return
            }
            if (event === 'progress') {
              captureStreamMeta(data)
              ensureLiveStarted('')
              const text = progressTextFromFrame(data)
              if (text) {
                const activityType = activityTypeForOperationalText(text, 'progress')
                addLiveProgressLine(text, {
                  label: liveProgressLabel,
                  activityType,
                  rawSource: 'control-center.sse.progress',
                  payload: streamPayload(data),
                  refresh: true,
                })
              }
              return
            }
            if (event === 'delta') {
              const text = typeof data.text === 'string' ? data.text : ''
              if (!text) return
              ensureLiveStarted('')
              if (!liveFirstTokenAt) {
                liveFirstTokenAt = new Date().toISOString()
              addLiveActivity('message.partial', 'Assistant output started.', 'control-center.sse.delta', {
                  payload: streamPayload(data),
                  collapsed: true,
                  refresh: false,
                })
              }
              captureStreamMeta(data)
              accumulated = data.replace === true ? text : `${accumulated}${text}`
              upsertLiveResponse(accumulated, true, Date.now() - start, true)
              return
            }
            if (event === 'error') {
              captureStreamMeta(data)
              const message = typeof data.message === 'string'
                ? redactActivityText(data.message, 2000)
                : 'Streaming request failed.'
              ensureLiveStarted(message)
              addLiveProgressLine(redactActivityText(message, 160) || 'Runtime reported a blocker.', {
                label: 'Blocked',
                activityType: activityTypeForOperationalText(message, 'error'),
                rawSource: 'control-center.sse.error',
                severity: 'error',
                payload: streamPayload(data),
                refresh: true,
              })
              const failureKind = typeof data.failureKind === 'string' ? data.failureKind : inferFailureKind(message)
              upsertLiveResponse(message, false, Date.now() - start, false, liveResponseModelId, failureKind)
              return
            }
            if (event === 'final') {
              finalPayload = data as AT
              captureStreamMeta(data)
              liveResponseModelId = modelIdFromTurnPayload(finalPayload) || liveResponseModelId
              liveTransport = transportFromTurnPayload(finalPayload) || liveTransport
              liveBuffered = bufferedFromTurnPayload(finalPayload) || liveBuffered
              addLiveActivity(finalPayload?.ok === false ? 'run.failed' : 'run.finished', finalPayload?.ok === false ? 'Agent run failed.' : 'Agent finished.', 'control-center.sse.final', {
                severity: finalPayload?.ok === false ? 'error' : 'success',
                payload: streamPayload(data),
                refresh: true,
              })
              if (finalPayload?.ok !== false) {
                addLiveActivity('message.final', 'Final response received.', 'control-center.sse.final', {
                  severity: 'success',
                  payload: streamPayload(data),
                  collapsed: true,
                  refresh: false,
                })
              }
            }
          }
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            for (const frame of sseParser.push(decoder.decode(value, { stream: true }))) consumeFrame(frame.event, frame.data)
          }
          for (const frame of sseParser.push(decoder.decode())) consumeFrame(frame.event, frame.data)
          for (const frame of sseParser.flush()) consumeFrame(frame.event, frame.data)
          const payload: AT = finalPayload || { ok: false, reply: accumulated || 'Streaming response ended without a final payload.', code: 1 }
          const finalText = accumulated || extractOutput(payload)
          liveResponseModelId = modelIdFromTurnPayload(payload) || liveResponseModelId
          liveTransport = transportFromTurnPayload(payload) || liveTransport
          liveBuffered = bufferedFromTurnPayload(payload) || liveBuffered
          const failureKind = typeof payload.failureKind === 'string' ? payload.failureKind : (!payload.ok ? inferFailureKind(finalText) : undefined)
          if (liveStarted) upsertLiveResponse(finalText, !!payload.ok, Date.now() - start, false, liveResponseModelId, failureKind)
          return { payload: { ...payload, reply: finalText }, responseOk: res.ok, streamed: liveStarted }
        }
        const postJson = async (msg: string, forceOpenClawRuntime = false): Promise<{ payload: AT; responseOk: boolean; streamed: boolean }> => {
          const controller = new AbortController()
          const releaseController = trackActiveAgentTurnController(aid, controller)
          const requestTimeoutMs = 6 * 60 * 60 * 1000
          const intentMessage = options.displayPrompt || normalized
          const sessionKey = options.sessionKey?.trim()
          try {
            const result = await sendBufferedAgentTurn(
              {
                agent: aid,
                message: msg,
                intentMessage,
                thinking: runPolicy.thinking,
                fastMode: runPolicy.fastMode,
                timeoutSeconds: runPolicy.timeoutSeconds,
                promptProfile: 'fast',
                attachments: options.attachments || [],
                ...(sessionKey ? { sessionKey } : {}),
                ...(forceOpenClawRuntime ? { forceOpenClawRuntime: true } : {}),
              },
              { signal: controller.signal, timeoutMs: requestTimeoutMs },
            )
            if (result.ok) return { payload: result.data, responseOk: true, streamed: liveResponseCreated }
            const message = apiErrorMessage(result.error)
            return {
              payload: {
                ok: false,
                reply: message,
                stderr: message,
                code: result.status || 1,
                failureKind: result.error.code,
              },
              responseOk: false,
              streamed: liveResponseCreated,
            }
          } finally {
            releaseController()
          }
        }
        const post = async (msg: string, forceOpenClawRuntime = false): Promise<{ payload: AT; responseOk: boolean; streamed: boolean }> => {
          const intentMessage = options.displayPrompt || normalized
          const sessionKey = options.sessionKey?.trim()
          const controller = new AbortController()
          const releaseController = trackActiveAgentTurnController(aid, controller)
          const requestTimeoutMs = 6 * 60 * 60 * 1000
          const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs)
          try {
            const res = await fetch(apiUrl('/api/openclaw/agent-turn/stream'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                agent: aid,
                message: msg,
                intentMessage,
                thinking: runPolicy.thinking,
                fastMode: runPolicy.fastMode,
                timeoutSeconds: runPolicy.timeoutSeconds,
                promptProfile: 'fast',
                attachments: options.attachments || [],
                ...(sessionKey ? { sessionKey } : {}),
                ...(forceOpenClawRuntime ? { forceOpenClawRuntime: true } : {}),
              }),
            })
            const contentType = res.headers.get('content-type') || ''
            if (res.body && contentType.includes('text/event-stream')) return await parseControlStream(res)
            const read = await readApi<AT>(res)
            return { payload: read.payload || fallback(res, read.text), responseOk: res.ok, streamed: false }
          } catch (streamError) {
            if (controller.signal.aborted) throw streamError
            try {
              return await postJson(msg, forceOpenClawRuntime)
            } catch (fallbackError) {
              throw new Error([
                'Control Center API request failed for both streaming and buffered agent-turn routes.',
                `Streaming route: ${requestErrorMessage(streamError)}`,
                `Buffered route: ${requestErrorMessage(fallbackError)}`,
              ].join('\n'))
            }
          } finally {
            releaseController()
            window.clearTimeout(timer)
          }
        }

        try {
          const preferOpenClawRuntime = options.forceOpenClawRuntime === true
          if (preferOpenClawRuntime) {
            addLiveProgressLine('Opening OpenClaw session.', {
              label: 'Routing',
              activityType: 'run.routing',
              rawSource: 'control-center.client.gateway_runtime',
              refresh: true,
            })
          } else {
          let preflight = await preflightAgentRuntime(aid)
          if (!preflight.ok && /docker|sandbox/i.test(preflight.message || '')) {
            await saveAgentConfig(aid, { sandbox: { mode: 'off', scope: 'agent', workspaceAccess: 'rw' } }, { timeoutMs: 20_000 })
            preflight = await preflightAgentRuntime(aid)
          }
          if (!preflight.ok) {
            const diagnostic = preflight.message
              ? `${preflight.message}`
              : 'Workspace, sandbox, or agent runtime is not ready.'
            const output = [
              `Preflight blocked — agent cannot execute this turn.`,
              `Reason: ${diagnostic}`,
              `Agent: ${aid}`,
              `Check settings: Agent Editor → Execution Policy → Sandbox, Workspace, Runtime.`,
              `Tip: Disable sandbox for agents without Docker; verify workspace path exists on disk.`,
            ].join('\n')
            recordResponse(aid, visiblePrompt, output, false, Date.now() - start, agent?.model?.primary, {
              failureKind: inferFailureKind(output),
              transport: 'preflight',
              queuedAt,
              startedAt: queuedAt,
              completedAt: new Date().toISOString(),
            })
            finishCoordinationTurn(aid, trackedCoordination, false, output)
            return { ok: false, output }
          }
          if (preflight.message && get().activeMission) {
            addMissionFeedEvent(get().activeMission?.id || 'direct-query', preflight.message, 'mission', aid)
          }
          }
          const outboundMessage = preferOpenClawRuntime ? gatewayChatMessage : composed
          let turn = await post(outboundMessage, preferOpenClawRuntime)
          let payload = turn.payload
          const errTxt = `${payload.stderr || ''} ${payload.stdout || ''}`.toLowerCase()
          if (!payload.ok && errTxt.includes("too many arguments for 'agent'")) {
            turn = await post(`"${outboundMessage.replace(/"/g, '\\"')}"`, preferOpenClawRuntime)
            payload = turn.payload
          }
          const dockerTxt = `${payload.stderr || ''}\n${payload.stdout || ''}`
          if (!payload.ok && hasDockerFail(dockerTxt)) {
            await saveAgentConfig(aid, { sandbox: { mode: 'off', scope: 'agent', workspaceAccess: 'rw' } }, { timeoutMs: 20_000 })
            turn = await post(outboundMessage, preferOpenClawRuntime)
            payload = turn.payload
          }
          if (payload.ok !== false && isDirectToolAccessDenial(extractOutput(payload))) {
            liveResponseText = ''
            liveFirstTokenAt = ''
            liveTransport = 'buffered-openclaw'
            liveBuffered = true
            addLiveProgressLine('Provider lane lacked tools; retrying through OpenClaw runtime.', {
              label: 'Routing',
              activityType: 'run.routing',
              rawSource: 'control-center.client.runtime_retry',
              refresh: true,
            })
            turn = await post(gatewayChatMessage, true)
            payload = turn.payload
          }
          const ok = !!payload.ok && turn.responseOk
          const evidenceLines = Array.isArray(payload.teamSyncEvidence) ? payload.teamSyncEvidence.filter(Boolean).slice(-5) : []
          const outputBase = extractOutput(payload)
          const output = !ok && evidenceLines.length
            ? [
                outputBase,
                '',
                'TEAM_SYNC evidence captured before block:',
                ...evidenceLines.map((line) => `- ${compactLine(line, 220)}`),
              ].join('\n')
            : outputBase
          if (turn.streamed) {
            liveResponseModelId = modelIdFromTurnPayload(payload) || liveResponseModelId
            liveTransport = transportFromTurnPayload(payload) || liveTransport
            liveBuffered = bufferedFromTurnPayload(payload) || liveBuffered
            finalizeLiveResponse(output, ok, Date.now() - start, payload.failureKind)
          } else {
            const failureKind = typeof payload.failureKind === 'string' ? payload.failureKind : (!ok ? inferFailureKind(output) : undefined)
            recordResponse(aid, visiblePrompt, output, ok, Date.now() - start, modelIdFromTurnPayload(payload) || agent?.model?.primary, {
              failureKind,
              transport: transportFromTurnPayload(payload) || 'buffered-http',
              buffered: bufferedFromTurnPayload(payload),
              queuedAt,
              startedAt: queuedAt,
              firstTokenAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              tokenCountEstimate: estimateTokenCount(output),
            })
          }
          if (ok && Array.isArray(payload.learnedSkills)) {
            for (const skill of payload.learnedSkills) {
              if (skill?.id && skill.name && skill.description) get().recordSkillLearned(aid, skill)
            }
          }
          finishCoordinationTurn(aid, trackedCoordination, ok, output)
          if (ok) {
            maybeStopMissionAfterVerifiedEvidence(aid, output)
            const mission = get().activeMission
            const commanderId = mission?.selectedAgents[0]
            const cyclePass = /\bCYCLE_VERDICT:\s*PASS\b/i.test(output)
            if (
              mission &&
              mission.status === 'running' &&
              shouldUseCommanderCycle(mission) &&
              options.trackMissionCycle === true &&
              options.freshSession === false &&
              aid === commanderId &&
              !cyclePass
            ) {
              refreshLoopDelegationsFn?.(aid, output)
              addMissionFeedEvent(
                mission.id,
                `Commander ${aid} completed loop review; dispatching worker lanes.`,
                'coordination',
                aid,
              )
              setTimeout(() => dispatchNextWorkerCycleFn?.(), 500)
            }
          }
          return { ok, output, payload, streamed: turn.streamed }
        } catch (e) {
          const message = String(e)
          const cancelledByOperator = operatorCancelledAgentTurns.has(aid)
          const timedOut = !cancelledByOperator && /aborterror|operation was aborted|signal is aborted/i.test(message)
          const offline = /failed to fetch|fetch failed|network\s*error|networkerror|load failed|econnrefused|econnreset|etimedout|socket hang up|err_connection/i.test(message)
          const output = cancelledByOperator
            ? 'Agent turn was cancelled from Command Console. OpenClaw was asked to abort the active run.'
            : timedOut
            ? 'Agent turn request timed out after 6h waiting for backend response.'
            : offline
            ? [
                'Control Center API request failed before the provider returned a response.',
                'Restart the backend with npm run dev:server, or run npm run dev to start both client and server.',
                `Detail: ${message}`,
              ].join('\n')
            : message
          if (liveResponseCreated) {
            finalizeLiveResponse(output, false, Date.now() - start, cancelledByOperator ? 'aborted' : inferFailureKind(output, timedOut))
          } else {
            recordResponse(
              aid,
              visiblePrompt,
              output,
              false,
              Date.now() - start,
              agent?.model?.primary,
              {
                failureKind: cancelledByOperator ? 'aborted' : inferFailureKind(output, timedOut),
                transport: offline ? 'control-center-api' : 'unknown',
                queuedAt,
                startedAt: queuedAt,
                completedAt: new Date().toISOString(),
              },
            )
          }
          finishCoordinationTurn(aid, trackedCoordination, false, output)
          return { ok: false, output, cancelled: cancelledByOperator }
        }
        finally {
          operatorCancelledAgentTurns.delete(aid)
          stopWorkingStatus(aid)
          setAgentBusy(aid, false)

          // Cycle-back trigger: when a non-commander worker finishes
          // a heartbeat turn in a continuous/indefinite mission, track
          // that this worker has completed. Once ALL workers are done,
          // fire the commander turn immediately to delegate new work
          // and restart the cycle.
          const mission = get().activeMission
          if (
            mission &&
            mission.status === 'running' &&
            options.trackMissionCycle === true &&
            shouldUseCommanderCycle(mission) &&
            aid !== mission.selectedAgents[0]
          ) {
            pendingWorkerCycle.add(aid)
            addMissionFeedEvent(
              mission.id,
              `${aid} finished lane turn (${pendingWorkerCycle.size}/${mission.selectedAgents.length - 1} workers cycled)`,
              'coordination',
              aid,
            )

            const workersDone = pendingWorkerCycle.size >= mission.selectedAgents.length - 1
            if (workersDone) {
              pendingWorkerCycle.clear()
              addMissionFeedEvent(
                mission.id,
                `All workers cycled — triggering commander to delegate new work.`,
                'coordination',
              )
              if (cycleToCommanderFn) {
                // Fire commander turn on next microtask to let current turn finish
                const missionId = mission.id
                setTimeout(() => {
                  if (get().activeMission?.id === missionId) cycleToCommanderFn?.()
                }, 100)
              }
            }
          }
        }
      }

      const clearQueuedCommandConsoleTimer = (agentId: string) => {
        const timer = queuedCommandConsoleTimers.get(agentId)
        if (timer) clearInterval(timer)
        queuedCommandConsoleTimers.delete(agentId)
      }

      const updateQueuedCommandConsoleResponse = (
        queuedId: string,
        patch: Partial<AgentResponse>,
      ) => {
        set((s) => ({
          agentResponses: s.agentResponses.map((entry) => {
            if (entry.id !== queuedId) return entry
            const queuedAtMs = new Date(entry.queuedAt || entry.timestamp).getTime()
            const durationMs = Number.isFinite(queuedAtMs) ? Math.max(0, Date.now() - queuedAtMs) : entry.durationMs
            return { ...entry, durationMs, ...patch }
          }),
        }))
      }

      const queueProgressLines = (position: number, depth: number): string[] => {
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

      const refreshQueuedCommandConsolePositions = (agentId: string) => {
        const queue = queuedCommandConsoleFollowups.get(agentId) || []
        if (!queue.length) return
        const depth = queue.length
        const updatedAt = new Date().toISOString()
        set((s) => ({
          agentResponses: s.agentResponses.map((entry) => {
            if (entry.agentId !== agentId || entry.transport !== 'command-console-queue' || !entry.streaming) return entry
            const index = queue.findIndex((queued) => queued.id === entry.id)
            if (index < 0) return entry
            const position = index + 1
            const queuedAtMs = new Date(entry.queuedAt || entry.timestamp).getTime()
            const durationMs = Number.isFinite(queuedAtMs) ? Math.max(0, Date.now() - queuedAtMs) : entry.durationMs
            return {
              ...entry,
              durationMs,
              queuePosition: position,
              queueDepth: depth,
              progressLabel: position === 1 ? 'Queued next' : `Queued ${position}/${depth}`,
              progressLines: queueProgressLines(position, depth),
              progressUpdatedAt: updatedAt,
            }
          }),
        }))
      }

      const failQueuedCommandConsoleFollowups = (agentId: string, message: string, failureKind: string) => {
        const queue = queuedCommandConsoleFollowups.get(agentId) || []
        queuedCommandConsoleFollowups.delete(agentId)
        clearQueuedCommandConsoleTimer(agentId)
        const completedAt = new Date().toISOString()
        for (const queued of queue) {
          updateQueuedCommandConsoleResponse(queued.id, {
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

      const drainQueuedCommandConsoleFollowups = (agentId: string) => {
        if (queuedCommandConsoleTimers.has(agentId)) return
        const timer = setInterval(() => {
          const queue = queuedCommandConsoleFollowups.get(agentId)
          if (!queue?.length) {
            queuedCommandConsoleFollowups.delete(agentId)
            clearQueuedCommandConsoleTimer(agentId)
            return
          }

          const current = get()
          if (isRetiredAgentId(agentId) || !current.agents.some((agent) => agent.id === agentId)) {
            failQueuedCommandConsoleFollowups(agentId, 'Queued Command Console turn was cancelled because the agent is no longer available.', 'aborted')
            return
          }
          if (Date.now() - queue[0].createdAt > 6 * 60 * 60 * 1000) {
            const queued = queue.shift()
            if (queued) {
              updateQueuedCommandConsoleResponse(queued.id, {
                response: 'Queued Command Console turn expired after waiting 6h for the lane to become free.',
                ok: false,
                streaming: false,
                failureKind: 'timeout',
                completedAt: new Date().toISOString(),
                queuePosition: undefined,
                queueDepth: undefined,
                progressLabel: 'Queue expired',
                progressLines: ['Queued turn expired before it could start.'],
                progressUpdatedAt: new Date().toISOString(),
              })
            }
            if (!queue.length) queuedCommandConsoleFollowups.delete(agentId)
            else refreshQueuedCommandConsolePositions(agentId)
            return
          }
          if (current.busyAgentIds.includes(agentId)) return

          const queued = queue.shift()
          if (!queued) {
            queuedCommandConsoleFollowups.delete(agentId)
            clearQueuedCommandConsoleTimer(agentId)
            return
          }
          if (!queue.length) queuedCommandConsoleFollowups.delete(agentId)
          else refreshQueuedCommandConsolePositions(agentId)
          clearQueuedCommandConsoleTimer(agentId)
          const releasedAt = new Date().toISOString()
          updateQueuedCommandConsoleResponse(queued.id, {
            response: 'Queued turn released; live response started in this lane.',
            ok: true,
            streaming: false,
            completedAt: releasedAt,
            queuePosition: undefined,
            queueDepth: undefined,
            progressLabel: 'Released',
            progressLines: ['Lane became free; queued turn started.'],
            progressUpdatedAt: releasedAt,
          })
          void runAgentPrompt(agentId, queued.prompt, queued.options)
            .finally(() => {
              if ((queuedCommandConsoleFollowups.get(agentId)?.length || 0) > 0) {
                drainQueuedCommandConsoleFollowups(agentId)
              }
            })
        }, 1000)
        queuedCommandConsoleTimers.set(agentId, timer)
      }

      const queueCommandConsoleFollowups = (
        agentsToQueue: OpenClawAgent[],
        normalizedPrompt: string,
        attachments: AgentTurnAttachment[] | undefined,
        optionsForAgent: (agent: OpenClawAgent, index: number) => PromptRunOptions,
        sourceLabel: string,
        promptForAgent?: (agent: OpenClawAgent, index: number) => string,
      ) => {
        if (!agentsToQueue.length) return
        const queuedAt = new Date().toISOString()
        for (const [index, agent] of agentsToQueue.entries()) {
          const options = optionsForAgent(agent, index)
          const runPrompt = promptForAgent?.(agent, index) || normalizedPrompt
          const visiblePrompt = promptWithAttachmentNames(options.displayPrompt || normalizedPrompt, attachments)
          const response = `Queued behind ${agent.name}'s active Command Console turn. This follow-up will start automatically when the lane is free.`
          const queued: QueuedCommandConsoleFollowup = {
            id: crypto.randomUUID(),
            agentId: agent.id,
            prompt: runPrompt,
            visiblePrompt,
            options: { ...options, attachments },
            queuedAt,
            createdAt: Date.now(),
          }
          const activity: AgentActivityEvent = {
            id: crypto.randomUUID(),
            type: 'run.queued',
            label: 'Queued behind active Command Console turn.',
            rawSource: `control-center.command-console.${sourceLabel}.queue`,
            timestamp: queuedAt,
            severity: 'info',
            surface: 'activity',
            collapsed: false,
            dedupeKey: `run.queued:${queued.id}`,
          }
          const queue = queuedCommandConsoleFollowups.get(agent.id) || []
          const queuePosition = queue.length + 1
          const missionId = get().activeMission?.id
          const entry: AgentResponse = {
            id: queued.id,
            ...(missionId ? { missionId } : {}),
            agentId: agent.id,
            prompt: visiblePrompt,
            response,
            ok: true,
            timestamp: queuedAt,
            durationMs: 0,
            streaming: true,
            transport: 'command-console-queue',
            queuedAt,
            startedAt: queuedAt,
            queuePosition,
            queueDepth: queuePosition,
            progressLabel: queuePosition === 1 ? 'Queued next' : `Queued ${queuePosition}/${queuePosition}`,
            progressMode: 'progress',
            progressLines: queueProgressLines(queuePosition, queuePosition),
            progressUpdatedAt: queuedAt,
            tokenCountEstimate: estimateTokenCount(response),
            activity: [activity],
          }
          queue.push(queued)
          queuedCommandConsoleFollowups.set(agent.id, queue)
          set((s) => ({ agentResponses: [entry, ...s.agentResponses].slice(0, MAX_RESPONSES) }))
          refreshQueuedCommandConsolePositions(agent.id)
          drainQueuedCommandConsoleFollowups(agent.id)
        }
        addMissionFeedEvent(
          get().activeMission?.id || 'direct-query',
          `Queued ${agentsToQueue.length} Command Console follow-up${agentsToQueue.length === 1 ? '' : 's'} behind active lane${agentsToQueue.length === 1 ? '' : 's'}.`,
          'coordination',
        )
      }

      const clearQueuedCommandConsoleFollowups = () => {
        for (const agentId of queuedCommandConsoleTimers.keys()) clearQueuedCommandConsoleTimer(agentId)
        queuedCommandConsoleFollowups.clear()
      }

      const cancelQueuedCommandConsoleFollowupById = (responseId: string) => {
        const normalized = responseId.trim()
        if (!normalized) return false
        for (const [agentId, queue] of queuedCommandConsoleFollowups.entries()) {
          const queued = queue.find((entry) => entry.id === normalized)
          if (!queued) continue

          const remaining = queue.filter((entry) => entry.id !== normalized)
          if (remaining.length) queuedCommandConsoleFollowups.set(agentId, remaining)
          else {
            queuedCommandConsoleFollowups.delete(agentId)
            clearQueuedCommandConsoleTimer(agentId)
          }

          const completedAt = new Date().toISOString()
          updateQueuedCommandConsoleResponse(normalized, {
            response: 'Queued Command Console follow-up was cancelled before it started.',
            ok: false,
            streaming: false,
            failureKind: 'aborted',
            completedAt,
            queuePosition: undefined,
            queueDepth: undefined,
            progressLabel: 'Cancelled',
            progressLines: ['Queued turn cancelled by operator.'],
            progressUpdatedAt: completedAt,
          })
          if (remaining.length) refreshQueuedCommandConsolePositions(agentId)
          addMissionFeedEvent(
            get().activeMission?.id || 'direct-query',
            `Queued Command Console follow-up cancelled for ${agentId}.`,
            'coordination',
            agentId,
          )
          return true
        }
        return false
      }

      const resetCommandConsoleRuntimeState = () => {
        const busyAgents = [...get().busyAgentIds]
        if (busyAgents.length) abortActiveAgentTurns(busyAgents)
        for (const agentId of busyAgents) stopWorkingStatus(agentId)
        activeAgentTurnControllers.clear()
        operatorCancelledAgentTurns.clear()
      }

      /* ---- coordination bus wiring ---- */
      coordinationBus = new CoordinationBus({
        onMessage: (msg) => set((s) => {
          const existing = s.coordinationMessages.find((entry) => entry.id === msg.id)
          const coordinationMessages = existing
            ? s.coordinationMessages.map((entry) => (entry.id === msg.id ? msg : entry))
            : [msg, ...s.coordinationMessages].slice(0, 200)
          const shouldFeed = !existing || existing.status !== msg.status
          return {
            coordinationMessages,
            missionFeed: shouldFeed
              ? [{
                  id: crypto.randomUUID(),
                  missionId: msg.missionId,
                  timestamp: new Date().toISOString(),
                  type: 'coordination' as const,
                  agentId: msg.fromAgentId,
                  message: `${msg.fromAgentId} → ${msg.toAgentId ?? 'ALL'}: ${msg.intent.slice(0, 100)}`,
                  coordinationKind: msg.kind,
                }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS)
              : s.missionFeed,
          }
        }),
        onDelegationUpdate: (d) => set((s) => {
          const next = s.coordinationDelegations.map((x) => x.id === d.id ? d : x)
          if (!next.some((x) => x.id === d.id)) next.unshift(d)
          return { coordinationDelegations: next.slice(0, 100) }
        }),
        onWorkspaceClaim: (c) => set((s) => ({
          coordinationWorkspace: [c, ...s.coordinationWorkspace.filter((x) => x.agentId !== c.agentId)].slice(0, 50),
        })),
      })

      /* ---- coordination helpers ---- */
      const requireMission = () => {
        const mission = get().activeMission
        if (!mission) return null
        return mission
      }

      return {
        ...baseState,

        setTab: (tab) => set({ tab }),

        syncPartyOverview: async () => {
          try {
            const result = await fetchPartyOverview()
            if (!result.ok || !Array.isArray(result.data.party)) return
            const party = result.data.party
            set((s) => {
              const byId = new Map(s.agents.map((a) => [a.id, a]))
              const incoming = party.filter((e) => e?.id && !isRetiredAgentId(e.id)).map((e) => mapOverviewAgentToLocal(e, byId.get(e.id)))
              if (!incoming.length) return s
              const incomingIds = new Set(incoming.map((a) => a.id))
              const nextAgents = [...incoming, ...s.agents.filter((a) => !incomingIds.has(a.id) && !isRetiredAgentId(a.id))]
              const ops = { ...s.operationStates }; for (const a of incoming) { if (!ops[a.id]) ops[a.id] = makeDormantState(a.id, a.heartbeat.tickIntervalMs) }
              const nextSel = s.selectedAgentIds.filter((id) => nextAgents.some((a) => a.id === id))
              const nextId = s.selectedAgentId && nextAgents.some((a) => a.id === s.selectedAgentId) ? s.selectedAgentId : (nextSel[0] || null)
              return { agents: nextAgents, selectedAgentIds: nextId && !nextSel.includes(nextId) ? [nextId, ...nextSel] : nextSel, selectedAgentId: nextId, activePartyIds: s.activePartyIds.filter((id) => nextAgents.some((a) => a.id === id)), confirmedPartyIds: s.confirmedPartyIds.filter((id) => nextAgents.some((a) => a.id === id)), operationStates: ops }
            })

            // Pre-warm only a tiny slice of the active party; warming every agent made startup feel slow.
            const warmSet = new Set(get().sessionWarmAgentIds)
            const activeSet = new Set(get().confirmedPartyIds.length ? get().confirmedPartyIds : get().activePartyIds)
            const fresh = party
              .filter((e) => e?.id && activeSet.has(e.id) && !warmSet.has(e.id))
              .slice(0, PARTY_PREWARM_LIMIT)
            if (fresh.length) {
              set((s) => ({ sessionWarmAgentIds: [...new Set([...s.sessionWarmAgentIds, ...fresh.map((f) => f.id)])] }))
              void Promise.allSettled(fresh.map((e) => prewarmAgentTurn(e.id)))
            }
          } catch { /* seed fallback */ }
        },

        recruitAgent: async (input) => {
          const draft = makeRecruitAgentDraft(input)
          const agentId = draft.id
          const warnings: string[] = []
          const current = get()
          if (!/^[a-z0-9-]{3,60}$/.test(agentId)) {
            throw new Error('Agent ID must be 3-60 characters using lowercase letters, numbers, and hyphens.')
          }
          if (current.agents.some((agent) => agent.id === agentId)) {
            throw new Error(`Agent ID already exists: ${agentId}`)
          }

          const profileStats = recruitProfileStats(draft)
          const enabledCapabilityKeys = Object.entries(draft.mds.capabilities)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
          const recruitProfile = {
            className: draft.className,
            role: draft.role,
            behaviorProfile: draft.behaviorProfile,
            level: draft.level,
            motto: `${draft.className} tuned for ${draft.behaviorProfile} work.`,
            bio: `${draft.name} was recruited from the Control Center with ${enabledCapabilityKeys.join(', ')} capability coverage.`,
            skills: draft.unlockedSkills,
            abilities: enabledCapabilityKeys,
            tools: draft.mds.toolAccess,
            stats: profileStats,
          }
          const recruitRequest: RecruitAgentRequest = {
            agentId,
            name: draft.name,
            workspace: draft.workspace || undefined,
            emoji: '@',
            theme: draft.behaviorProfile,
            avatar: draft.portrait || undefined,
            profile: recruitProfile,
            model: draft.model?.primary ? draft.model : undefined,
            runtime: draft.runtimePolicy,
            attributes: draft.attributes,
            mds: draft.mds,
            heartbeat: draft.heartbeat,
            soul: draft.soul,
            sandbox: draft.sandbox,
            tools: draft.toolsPolicy,
          }
          const recruitResult = await recruitPartyAgent(recruitRequest)
          if (!recruitResult.ok) {
            throw new Error(apiErrorMessage(recruitResult.error))
          }
          if (!recruitResult.data.agentId) {
            throw new Error('Recruit completed without an agent id.')
          }

          const partyWillOverflow = Boolean(input.addToParty && !current.activePartyIds.includes(agentId) && current.activePartyIds.length >= MAX_PARTY_SIZE)
          if (partyWillOverflow) warnings.push('Active party is full; the agent was created but not slotted.')

          set((s) => {
            const withoutAgent = s.agents.filter((agent) => agent.id !== agentId)
            const shouldAddToParty = Boolean(input.addToParty && !s.activePartyIds.includes(agentId) && s.activePartyIds.length < MAX_PARTY_SIZE)
            const activePartyIds = shouldAddToParty ? [...s.activePartyIds, agentId] : s.activePartyIds
            const confirmedWasSynced = s.confirmedPartyIds.length === s.activePartyIds.length && s.activePartyIds.every((id, index) => s.confirmedPartyIds[index] === id)
            const confirmedPartyIds = shouldAddToParty && confirmedWasSynced ? activePartyIds : s.confirmedPartyIds.filter((id) => id !== agentId)
            return {
              agents: [draft, ...withoutAgent],
              activePartyIds,
              confirmedPartyIds,
              selectedAgentId: agentId,
              selectedAgentIds: [agentId],
              tab: 'agents',
              operationStates: {
                ...s.operationStates,
                [agentId]: makeDormantState(agentId, draft.heartbeat.tickIntervalMs),
              },
            }
          })

          const configResult = await saveAgentConfig(agentId, {
            model: draft.model?.primary ? draft.model : undefined,
            runtime: draft.runtimePolicy,
            profile: recruitProfile,
            attributes: draft.attributes,
            mds: draft.mds,
            heartbeat: draft.heartbeat,
            soul: draft.soul,
            sandbox: draft.sandbox,
            tools: draft.toolsPolicy,
          }, { timeoutMs: 30_000 })
          if (!configResult.ok) {
            warnings.push(`Agent was created, but post-create config did not fully save: ${apiErrorMessage(configResult.error)}`)
          }

          const resourceFiles = (input.resourceFiles || [])
            .map((entry) => ({ file: entry.file.trim(), content: entry.content }))
            .filter((entry) => /^[^\\/]+\.md$/i.test(entry.file))
          if (resourceFiles.length) {
            const saved = await Promise.allSettled(resourceFiles.map(async (entry) => {
              const result = await saveAgentResource(agentId, entry.file, entry.content.endsWith('\n') ? entry.content : `${entry.content}\n`)
              if (!result.ok) {
                throw new Error(`${entry.file}: ${apiErrorMessage(result.error)}`)
              }
            }))
            const failed = saved
              .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
              .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
            if (failed.length) warnings.push(`Some markdown bootstrap files did not save: ${failed.join(' ')}`)
          }

          await get().syncPartyOverview().catch((error) => {
            warnings.push(`Roster refresh failed after recruit: ${String(error)}`)
          })
          set((s) => ({
            selectedAgentId: agentId,
            selectedAgentIds: [agentId],
            tab: 'agents',
            activePartyIds: input.addToParty && !s.activePartyIds.includes(agentId) && s.activePartyIds.length < MAX_PARTY_SIZE
              ? [...s.activePartyIds, agentId]
              : s.activePartyIds,
          }))
          return { agentId, warnings }
        },

        retireAgent: async (agentId) => {
          const normalized = agentId.trim().toLowerCase()
          if (!normalized) throw new Error('Agent ID is required.')
          if (normalized === 'main') throw new Error('The main agent cannot be retired.')

          const retireResult = await retirePartyAgent(normalized, RETIRE_AGENT_TIMEOUT_MS)
          if (!retireResult.ok) {
            if (retireResult.error.code === 'timeout') {
              throw new Error('Retire request timed out. Refresh the party list; if the agent disappeared, retirement finished in the background.')
            }
            throw new Error(apiErrorMessage(retireResult.error))
          }
          const retiredAgentIds = rememberRetiredAgentId(normalized)

          const heartbeatTimer = heartbeatConfigSaveTimers.get(normalized)
          if (heartbeatTimer) clearTimeout(heartbeatTimer)
          heartbeatConfigSaveTimers.delete(normalized)
          heartbeatConfigSaveSeq.delete(normalized)

          const runtimeTimer = runtimePolicySaveTimers.get(normalized)
          if (runtimeTimer) clearTimeout(runtimeTimer)
          runtimePolicySaveTimers.delete(normalized)
          runtimePolicySaveSeq.delete(normalized)
          for (const key of Array.from(agentConfigPatchSaveSeq.keys())) {
            if (key.startsWith(`${normalized}:`)) agentConfigPatchSaveSeq.delete(key)
          }

          if (typeof window !== 'undefined') {
            try {
              for (let i = localStorage.length - 1; i >= 0; i -= 1) {
                const key = localStorage.key(i)
                if (key?.startsWith('dystopai:command-draft:') && key.includes(normalized)) {
                  localStorage.removeItem(key)
                }
              }
            } catch {
              // Draft cleanup is best-effort; retirement state is already persisted by the API.
            }
          }

          const activeMissionUsesAgent = get().activeMission?.selectedAgents.includes(normalized)
          if (activeMissionUsesAgent) {
            clearAllContinuousTimers()
            clearMissionBackendPollTimer()
          }

          set((s) => {
            const agents = s.agents.filter((agent) => agent.id !== normalized)
            const retiredMissionIds = new Set(
              s.missionHistory
                .filter((mission) => mission.selectedAgents.includes(normalized))
                .map((mission) => mission.id),
            )
            if (s.activeMission?.selectedAgents.includes(normalized)) retiredMissionIds.add(s.activeMission.id)
            const operationStates = { ...s.operationStates }
            delete operationStates[normalized]
            const agentConfigSaveStatus = { ...s.agentConfigSaveStatus }
            delete agentConfigSaveStatus[normalized]
            const selected = normalizeInitialSelection(
              agents,
              s.selectedAgentId === normalized ? undefined : s.selectedAgentId,
              s.selectedAgentIds.filter((id) => id !== normalized),
            )
            return {
              agents,
              retiredAgentIds,
              activePartyIds: s.activePartyIds.filter((id) => id !== normalized),
              confirmedPartyIds: s.confirmedPartyIds.filter((id) => id !== normalized),
              ...selected,
              isEditorOpen: s.editingAgentId === normalized ? false : s.isEditorOpen,
              editingAgentId: s.editingAgentId === normalized ? null : s.editingAgentId,
              activeMission: s.activeMission?.selectedAgents.includes(normalized) ? null : s.activeMission,
              missionHistory: s.missionHistory.filter((mission) => !mission.selectedAgents.includes(normalized)),
              missionReports: s.missionReports.filter((report) => !retiredMissionIds.has(report.missionId)),
              missionFeed: s.missionFeed.filter((event) => event.agentId !== normalized && !retiredMissionIds.has(event.missionId)),
              agentResponses: s.agentResponses.filter((entry) => entry.agentId !== normalized),
              busyAgentIds: s.busyAgentIds.filter((id) => id !== normalized),
              operationStates,
              sessionWarmAgentIds: s.sessionWarmAgentIds.filter((id) => id !== normalized),
              agentConfigSaveStatus,
              coordinationMessages: s.coordinationMessages
                .filter((message) => message.fromAgentId !== normalized && message.toAgentId !== normalized)
                .map((message) => ({
                  ...message,
                  acknowledgedBy: message.acknowledgedBy?.filter((id) => id !== normalized),
                  completedBy: message.completedBy?.filter((id) => id !== normalized),
                })),
              coordinationDelegations: s.coordinationDelegations.filter((delegation) => delegation.fromAgentId !== normalized && delegation.toAgentId !== normalized),
              coordinationWorkspace: s.coordinationWorkspace.filter((claim) => claim.agentId !== normalized),
            }
          })
        },

        selectAgent: (aid, opts) => set((s) => {
          if (isRetiredAgentId(aid) || !s.agents.some((agent) => agent.id === aid)) return s
          if (!opts?.toggle) return { selectedAgentId: aid, selectedAgentIds: [aid] }
          const already = s.selectedAgentIds.includes(aid)
          const next = (already ? s.selectedAgentIds.filter((id) => id !== aid) : [...s.selectedAgentIds, aid])
            .filter((id) => !isRetiredAgentId(id) && s.agents.some((agent) => agent.id === id))
          return { selectedAgentId: next.length ? (next.includes(aid) ? aid : next[next.length - 1]) : null, selectedAgentIds: next }
        }),
        clearSelectedAgents: () => set({ selectedAgentId: null, selectedAgentIds: [] }),
        togglePartyMember: (aid) => set((s) => {
          if (isRetiredAgentId(aid) || !s.agents.some((agent) => agent.id === aid)) return s
          const active = sanitizePartyIds(s.activePartyIds, s.agents)
          if (active.includes(aid)) return { activePartyIds: active.filter((id) => id !== aid), confirmedPartyIds: s.confirmedPartyIds.filter((id) => id !== aid && !isRetiredAgentId(id)) }
          if (active.length >= MAX_PARTY_SIZE) return { activePartyIds: active }
          return { activePartyIds: [...active, aid] }
        }),
        reorderPartyMembers: (f, t) => set((s) => { const active = sanitizePartyIds(s.activePartyIds, s.agents); if (f === t || f < 0 || t < 0 || f >= active.length || t >= active.length) return { activePartyIds: active }; const n = [...active]; const [m] = n.splice(f, 1); n.splice(t, 0, m); return { activePartyIds: n } }),
        confirmParty: () => set((s) => ({ confirmedPartyIds: sanitizePartyIds(s.activePartyIds, s.agents) })),
        openEditor: (aid) => set({ isEditorOpen: true, editingAgentId: aid }),
        closeEditor: () => set({ isEditorOpen: false, editingAgentId: null }),
        updateMissionDraft: (p) => set((s) => ({ missionDraft: { ...s.missionDraft, ...p } })),
        syncMissionProjection,

        steerMission: () => {
          const current = get().activeMission
          if (!current || current.status !== 'running') return
          const draft = get().missionDraft
          const commanderId = current.selectedAgents[0] || 'operator'
          const steeredMission: MissionRun = {
            ...current,
            title: draft.title,
            description: draft.description,
            missionType: draft.missionType,
            collaborationMode: draft.collaborationMode,
            complexity: draft.complexity,
            riskTolerance: draft.riskTolerance,
            durationMode: draft.durationMode,
            durationValue: draft.durationValue,
            durationUnit: draft.durationUnit,
            heartbeatLifecycle: current.heartbeatLifecycle,
          }
          coordinationBus?.sendMessage(
            current.id,
            commanderId,
            null,
            'broadcast',
            'MISSION STEER: operator updated the active mission brief.',
            [
              `Updated title: ${draft.title}`,
              `Updated objective: ${draft.description}`,
              `Mode: ${draft.collaborationMode} | Type: ${draft.missionType} | Complexity: ${draft.complexity}% | Risk: ${draft.riskTolerance}%`,
              'Continue current work if already in flight. On your next turn, acknowledge this steer, adjust your lane plan, and report what changed.',
            ].filter(Boolean).join('\n'),
            'Acknowledge the steer on your next turn, update lane ownership/delegations if needed, and continue without cancelling active work.',
          )
          set((s) => ({
            activeMission: steeredMission,
            missionFeed: [{
              id: crypto.randomUUID(),
              missionId: current.id,
              timestamp: new Date().toISOString(),
              type: 'mission' as const,
              agentId: commanderId,
              message: `Mission steered: ${compactLine(draft.description || draft.title, 160)}`,
            }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
          }))
        },

        deployMission: () => {
          {
            const s = get()
            const party = s.confirmedPartyIds.length ? s.confirmedPartyIds : s.activePartyIds
            if (!party.length) return
            const candidateAgents = selectMissionAgentsForDraft(s.agents, party, s.missionDraft)
            if (!candidateAgents.length) {
              set((st) => ({
                missionFeed: [{
                  id: crypto.randomUUID(),
                  missionId: 'mission-draft',
                  timestamp: new Date().toISOString(),
                  type: 'mission' as const,
                  message: `No eligible agents for ${s.missionDraft.collaborationMode} ${s.missionDraft.missionType} mission`,
                }, ...st.missionFeed].slice(0, MAX_FEED_EVENTS),
              }))
              return
            }
            const readiness = MDSValidator.readinessReport(candidateAgents, s.missionDraft)
            if (!readiness.ok) {
              set((st) => ({
                missionFeed: [{
                  id: crypto.randomUUID(),
                  missionId: 'mission-draft',
                  timestamp: new Date().toISOString(),
                  type: 'mission' as const,
                  message: `Mission blocked by readiness gates: ${readiness.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' | ')}`,
                }, ...st.missionFeed].slice(0, MAX_FEED_EVENTS),
              }))
              return
            }

            clearAllContinuousTimers()
            clearMissionBackendPollTimer()
            if (commanderCycleRetryTimer) clearTimeout(commanderCycleRetryTimer || undefined)
            commanderCycleRetryTimer = null
            pendingWorkerCycle.clear()
            cycleToCommanderFn = null
            dispatchNextWorkerCycleFn = null
            refreshLoopDelegationsFn = null

            const draft = s.missionDraft
            const backendMode =
              draft.durationMode === 'instant'
                ? 'instant'
                : draft.durationMode === 'continuous'
                  ? 'continuous'
                  : draft.durationMode === 'indefinite'
                    ? 'indefinite'
                    : draft.durationUnit
            const cadenceSeconds = Math.max(
              15,
              Math.min(...candidateAgents.map((agent) => Math.max(15, Math.round((agent.heartbeat.tickIntervalMs || 300000) / 1000)))),
            )
            const readinessWarnings = readiness.issues.filter((issue) => issue.severity === 'warning')
            const requestId = crypto.randomUUID()
            set((st) => ({
              missionFeed: [{
                id: crypto.randomUUID(),
                missionId: requestId,
                timestamp: new Date().toISOString(),
                type: 'mission' as const,
                message: `Cron scheduler request sent for ${candidateAgents.length} agent(s).`,
              }, ...st.missionFeed].slice(0, MAX_FEED_EVENTS),
            }))

            void (async () => {
              try {
                const result = await apiRequest<{ ok?: boolean; deduped?: boolean; idempotencyKey?: string | null; mission?: BackendMission; error?: string; detail?: unknown }>('/api/missions/start', {
                  method: 'POST',
                  body: {
                    idempotencyKey: requestId,
                    title: draft.title,
                    brief: draft.description,
                    party: candidateAgents.map((agent) => agent.id),
                    mode: backendMode,
                    amount: backendMode === 'hours' || backendMode === 'days' || backendMode === 'weeks' ? draft.durationValue : null,
                    missionType: draft.missionType,
                    collaborationMode: draft.collaborationMode,
                    complexity: draft.complexity,
                    riskTolerance: draft.riskTolerance,
                    cadenceSeconds,
                  },
                })
                if (!result.ok) throw new Error(apiErrorMessage(result.error))
                const out = result.data
                if (!out.mission) throw new Error(out.error || (typeof out.detail === 'string' ? out.detail : 'Failed to start cron mission'))
                const run = backendMissionToRun(out.mission, draft)
                const launchEvents: MissionEvent[] = [{
                  id: crypto.randomUUID(),
                  missionId: run.id,
                  timestamp: new Date().toISOString(),
                  type: 'mission',
                  message: out.deduped
                    ? `Cron mission launch deduplicated: ${run.schedulerLifecycle || 'leader-first scheduler'}`
                    : `Cron mission deployed: ${run.schedulerLifecycle || 'leader-first scheduler'}`,
                }]
                if (readinessWarnings.length) {
                  launchEvents.push({
                    id: crypto.randomUUID(),
                    missionId: run.id,
                    timestamp: new Date().toISOString(),
                    type: 'mission',
                    message: `Readiness warnings: ${readinessWarnings.map((issue) => issue.message).join(' | ')}`,
                  })
                }
                set((st) => ({
                  activeMission: run,
                  missionFeed: [...launchEvents, ...st.missionFeed.filter((event) => event.missionId !== requestId)].slice(0, MAX_FEED_EVENTS),
                }))
                startMissionBackendPolling()
                void syncBackendMissions().catch(() => undefined)
              } catch (error) {
                set((st) => ({
                  activeMission: null,
                  missionFeed: [{
                    id: crypto.randomUUID(),
                    missionId: requestId,
                    timestamp: new Date().toISOString(),
                    type: 'mission' as const,
                    message: `Cron mission start failed: ${String(error)}`,
                  }, ...st.missionFeed].slice(0, MAX_FEED_EVENTS),
                }))
              }
            })()
            return
          }
        },
        stopMission: () => {
          const current = get().activeMission
          clearAllContinuousTimers()
          clearMissionBackendPollTimer()
          if (commanderCycleRetryTimer) clearTimeout(commanderCycleRetryTimer || undefined)
          commanderCycleRetryTimer = null
          pendingWorkerCycle.clear()
          cycleToCommanderFn = null
          dispatchNextWorkerCycleFn = null
          refreshLoopDelegationsFn = null
          if (!current) return
          void (async () => {
            try {
              const result = await apiRequest('/api/missions/stop', {
                method: 'POST',
                body: { missionId: current.id },
                timeoutMs: 120_000,
              })
              if (!result.ok) throw new Error(apiErrorMessage(result.error))
              await syncBackendMissions().catch(() => undefined)
            } catch (error) {
              addMissionFeedEvent(current.id, `Cron mission stop failed: ${String(error)}`, 'mission')
            }
          })()
          set((s) => ({
            activeMission: { ...current, status: 'cancelled', endedAt: new Date().toISOString() },
            missionFeed: [{
              id: crypto.randomUUID(),
              missionId: current.id,
              timestamp: new Date().toISOString(),
              type: 'mission' as const,
              message: 'Cron mission stop requested.',
            }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
          }))
        },

        sendPromptToAgent: async (aid, prompt, attachments) => {
          const normalized = normalizeOperatorPrompt(prompt)
          if (!normalized || isRetiredAgentId(aid)) return
          const state = get()
          const agent = state.agents.find((entry) => entry.id === aid)
          if (!agent) return
          const continuation = isContinuationPrompt(normalized)
          const explicitFreshSession = /^\s*\/new\b/i.test(normalized)
          const partyIds = (state.confirmedPartyIds.length ? state.confirmedPartyIds : state.activePartyIds)
            .filter((id) => !isRetiredAgentId(id) && state.agents.some((entry) => entry.id === id))
          const contextAgentIds = partyIds.includes(aid) ? partyIds : [aid]
          const options: PromptRunOptions = {
            displayPrompt: normalized,
            includeRecentContext: true,
            freshSession: explicitFreshSession,
            thinking: continuation ? MISSION_THINKING : undefined,
            timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
            attachments,
            sessionKey: commandConsoleSessionKey(aid),
            forceOpenClawRuntime: true,
            contextAgentIds,
          }
          if (state.busyAgentIds.includes(aid)) {
            queueCommandConsoleFollowups([agent], normalized, attachments, () => options, 'single')
            return
          }
          await runAgentPrompt(aid, normalized, options)
        },
        sendPromptToSelectedAgents: async (prompt, attachments) => {
          const s = get(); const ids = s.selectedAgentIds.filter((id) => !isRetiredAgentId(id) && s.agents.some((a) => a.id === id)); if (!ids.length) return
          const normalized = normalizeOperatorPrompt(prompt); if (!normalized) return
          const allLaneAgents = ids
            .map((id) => s.agents.find((a) => a.id === id))
            .filter((agent): agent is OpenClawAgent => Boolean(agent))
          const laneAgents = allLaneAgents.filter((agent) => !s.busyAgentIds.includes(agent.id))
          const queuedLaneAgents = allLaneAgents.filter((agent) => s.busyAgentIds.includes(agent.id))
          const continuation = isContinuationPrompt(normalized)
          const explicitFreshSession = /^\s*\/new\b/i.test(normalized)
          const allContextAgentIds = allLaneAgents.map((agent) => agent.id)
          const selectedQueueOptions = (agent: OpenClawAgent): PromptRunOptions => ({
            displayPrompt: normalized,
            includeRecentContext: true,
            freshSession: explicitFreshSession,
            thinking: continuation ? MISSION_THINKING : undefined,
            timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
            attachments,
            sessionKey: commandConsoleSessionKey(agent.id),
            forceOpenClawRuntime: true,
            contextAgentIds: allContextAgentIds,
          })
          if (!laneAgents.length) {
            queueCommandConsoleFollowups(queuedLaneAgents, normalized, attachments, selectedQueueOptions, 'selected')
            return
          }
          const useCoordination = shouldUseAdHocCoordinationForPrompt(normalized, laneAgents)
          const adHoc = useCoordination ? startAdHocCoordination(normalized, laneAgents) : null
          const contextAgentIds = allContextAgentIds
          if (useCoordination) {
            await Promise.allSettled(laneAgents.map((agent, index) =>
              runAgentPrompt(agent.id, buildParallelLanePrompt(agent, normalized, laneAgents, index), {
                displayPrompt: normalized,
                includeRecentContext: true,
                freshSession: explicitFreshSession,
                thinking: continuation ? MISSION_THINKING : undefined,
                timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
                attachments,
                sessionKey: commandConsoleSessionKey(agent.id),
                forceOpenClawRuntime: true,
                contextAgentIds,
              }),
            ))
          } else {
            for (const agent of laneAgents) {
              const result = await runAgentPrompt(agent.id, normalized, {
                displayPrompt: normalized,
                includeRecentContext: true,
                freshSession: explicitFreshSession,
                thinking: continuation ? MISSION_THINKING : undefined,
                timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
                attachments,
                sessionKey: commandConsoleSessionKey(agent.id),
                forceOpenClawRuntime: true,
                contextAgentIds,
              })
              if (result?.cancelled) break
            }
          }
          if (useCoordination) finishAdHocCoordination(adHoc?.id || null, `Ad hoc coordination completed for ${laneAgents.length} selected lanes`)
          if (queuedLaneAgents.length) {
            queueCommandConsoleFollowups(
              queuedLaneAgents,
              normalized,
              attachments,
              selectedQueueOptions,
              'selected',
              (agent) => {
                if (!useCoordination) return normalized
                const allIndex = Math.max(0, allLaneAgents.findIndex((entry) => entry.id === agent.id))
                return buildParallelLanePrompt(agent, normalized, allLaneAgents, allIndex)
              },
            )
          }
        },
        sendPromptToActiveParty: async (prompt, attachments) => {
          const s = get(); const party = (s.confirmedPartyIds.length ? s.confirmedPartyIds : s.activePartyIds).filter((id) => !isRetiredAgentId(id)); if (!party.length) return
          const normalized = normalizeOperatorPrompt(prompt); if (!normalized) return
          const allLaneAgents = party
            .map((id) => s.agents.find((a) => a.id === id))
            .filter((agent): agent is OpenClawAgent => Boolean(agent))
          const laneAgents = allLaneAgents.filter((agent) => !s.busyAgentIds.includes(agent.id))
          const queuedLaneAgents = allLaneAgents.filter((agent) => s.busyAgentIds.includes(agent.id))
          const continuation = isContinuationPrompt(normalized)
          const explicitFreshSession = /^\s*\/new\b/i.test(normalized)
          const allContextAgentIds = allLaneAgents.map((agent) => agent.id)
          const partyQueueOptions = (agent: OpenClawAgent): PromptRunOptions => ({
            displayPrompt: normalized,
            includeRecentContext: true,
            freshSession: explicitFreshSession,
            thinking: continuation ? MISSION_THINKING : undefined,
            timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
            attachments,
            sessionKey: commandConsoleSessionKey(agent.id),
            forceOpenClawRuntime: true,
            contextAgentIds: allContextAgentIds,
          })
          if (!laneAgents.length) {
            queueCommandConsoleFollowups(queuedLaneAgents, normalized, attachments, partyQueueOptions, 'party')
            return
          }
          const useCoordination = shouldUseAdHocCoordinationForPrompt(normalized, laneAgents)
          const adHoc = useCoordination ? startAdHocCoordination(normalized, laneAgents) : null
          const contextAgentIds = allContextAgentIds
          if (useCoordination) {
            await Promise.allSettled(laneAgents.map((agent, index) =>
              runAgentPrompt(agent.id, buildParallelLanePrompt(agent, normalized, laneAgents, index), {
                displayPrompt: normalized,
                includeRecentContext: true,
                freshSession: explicitFreshSession,
                thinking: continuation ? MISSION_THINKING : undefined,
                timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
                attachments,
                sessionKey: commandConsoleSessionKey(agent.id),
                forceOpenClawRuntime: true,
                contextAgentIds,
              }),
            ))
          } else {
            for (const agent of laneAgents) {
              const result = await runAgentPrompt(agent.id, normalized, {
                displayPrompt: normalized,
                includeRecentContext: true,
                freshSession: explicitFreshSession,
                thinking: continuation ? MISSION_THINKING : undefined,
                timeoutSeconds: continuation ? resolveMissionTimeoutSeconds(agent, { continuation: true }) : undefined,
                attachments,
                sessionKey: commandConsoleSessionKey(agent.id),
                forceOpenClawRuntime: true,
                contextAgentIds,
              })
              if (result?.cancelled) break
            }
          }
          if (useCoordination) finishAdHocCoordination(adHoc?.id || null, `Ad hoc coordination completed for ${laneAgents.length} party lanes`)
          if (queuedLaneAgents.length) {
            queueCommandConsoleFollowups(
              queuedLaneAgents,
              normalized,
              attachments,
              partyQueueOptions,
              'party',
              (agent) => {
                if (!useCoordination) return normalized
                const allIndex = Math.max(0, allLaneAgents.findIndex((entry) => entry.id === agent.id))
                return buildParallelLanePrompt(agent, normalized, allLaneAgents, allIndex)
              },
            )
          }
        },
        stopActiveAgentRuns: (agentIds) => {
          const targets = (agentIds?.length ? agentIds : get().busyAgentIds)
            .map((id) => id.trim())
            .filter((id) => id && get().busyAgentIds.includes(id))
          const stopped = abortActiveAgentTurns(targets)
          if (stopped > 0) {
            const uniqueTargets = [...new Set(targets)]
            const ts = new Date().toISOString()
            const event: MissionEvent = {
              id: crypto.randomUUID(),
              missionId: get().activeMission?.id ?? 'direct-query',
              timestamp: ts,
              type: 'mission',
              message: `Command Console stop requested for ${uniqueTargets.length} running lane${uniqueTargets.length === 1 ? '' : 's'}.`,
            }
            set((s) => ({
              missionFeed: [event, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
            }))
          }
          return stopped
        },
        cancelQueuedCommandConsoleFollowup: (responseId) => cancelQueuedCommandConsoleFollowupById(responseId),
        ingestClawTalkConsoleEvent: (frame) => {
          if (frame.source !== 'clawtalk') return
          const eventName = frame.event?.trim() || ''
          if (!eventName || eventName === 'heartbeat') return
          if (frame.id) {
            if (seenClawTalkConsoleEventIds.has(frame.id)) return
            seenClawTalkConsoleEventIds.add(frame.id)
            if (seenClawTalkConsoleEventIds.size > 500) {
              const [oldest] = seenClawTalkConsoleEventIds
              if (oldest) seenClawTalkConsoleEventIds.delete(oldest)
            }
          }

          const runId = frame.clawTalkRunId?.trim() || frame.runId?.trim() || frame.sessionKey?.trim() || frame.id?.trim()
          const agentId = frame.agentId?.trim() || 'main'
          if (!runId) return
          const responseId = `clawtalk:${runId}`
          const now = new Date().toISOString()
          const ts = frame.timestamp && !Number.isNaN(new Date(frame.timestamp).getTime()) ? frame.timestamp : now
          const text = [frame.text, frame.reply, frame.message, frame.error, frame.detail]
            .find((value) => typeof value === 'string' && value.trim())?.trim() || ''
          const prompt = frame.prompt?.trim() || 'ClawTalk message'
          const progressText = eventName === 'delta' || eventName === 'final' ? '' : text
          const modelId = frame.modelId?.trim() || (frame.provider && frame.model ? `${frame.provider}/${frame.model}` : frame.model?.trim() || '')

          set((s) => {
            const existing = s.agentResponses.find((entry) => entry.id === responseId)
            const isTerminal = eventName === 'final' || eventName === 'error'
            if (existing?.streaming === false && !isTerminal) return s
            const startedAt = existing?.startedAt || ts
            const startedMs = new Date(startedAt).getTime()
            const elapsedMs = Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : existing?.durationMs || 0
            const progressLines = existing?.progressLines ? [...existing.progressLines] : []
            if (progressText) {
              const cleanProgress = redactActivityText(progressText, PROGRESS_DRAFT_MAX_LINE_CHARS)
              if (cleanProgress) {
                progressLines.push(cleanProgress)
                while (progressLines.length > PROGRESS_DRAFT_MAX_LINES) progressLines.shift()
              }
            }

            const ok = eventName === 'error' ? false : isTerminal ? frame.ok !== false : existing?.ok ?? true
            const response = eventName === 'delta'
              ? frame.replace
                ? text
                : `${existing?.response || ''}${text}`
              : isTerminal && text
                ? text
                : existing?.response || ''
            if (existing?.streaming === false && eventName === 'final' && (!text || response === existing.response)) return s
            const failureKind = frame.failureKind || (!ok && isTerminal ? inferFailureKind(response || text) : isTerminal && ok ? undefined : existing?.failureKind)
            const responseModelId = modelId || existing?.modelId || s.agents.find((entry) => entry.id === agentId)?.model?.primary?.trim() || undefined
            const transport = frame.transport?.trim() || existing?.transport || 'clawtalk-control-center'
            const completedAt = isTerminal ? ts : existing?.completedAt
            const firstTokenAt = eventName === 'delta' && text && !existing?.firstTokenAt ? ts : existing?.firstTokenAt
            const missionId = existing?.missionId || s.activeMission?.id
            const next: AgentResponse = {
              id: responseId,
              ...(missionId ? { missionId } : {}),
              agentId,
              prompt,
              response,
              ok,
              timestamp: existing?.timestamp || ts,
              durationMs: isTerminal && startedMs ? Math.max(0, new Date(ts).getTime() - startedMs) : elapsedMs,
              modelId: responseModelId,
              streaming: !isTerminal,
              ...(failureKind ? { failureKind } : {}),
              transport,
              buffered: frame.buffered === true || frame.liveTokens === false || existing?.buffered,
              runtimeNoticeActive: !isTerminal && (existing?.runtimeNoticeActive || isRuntimeNoticeTransport(transport)),
              queuedAt: existing?.queuedAt || ts,
              startedAt,
              ...(firstTokenAt ? { firstTokenAt } : {}),
              ...(completedAt ? { completedAt } : {}),
              tokenCountEstimate: estimateTokenCount(response),
              progressLabel: frame.label?.trim() || existing?.progressLabel || (eventName === 'start' ? 'ClawTalk' : progressText ? 'Working' : undefined),
              progressMode: existing?.progressMode || 'progress',
              ...(progressLines.length ? { progressLines } : existing?.progressLines ? { progressLines: existing.progressLines } : {}),
              ...(progressText ? { progressUpdatedAt: ts } : existing?.progressUpdatedAt ? { progressUpdatedAt: existing.progressUpdatedAt } : {}),
              ...(existing?.activity?.length ? { activity: existing.activity } : {}),
            }

            const missionEvent = isTerminal
              ? {
                  id: crypto.randomUUID(),
                  missionId: s.activeMission?.id ?? 'direct-query',
                  timestamp: ts,
                  type: 'agent' as const,
                  agentId,
                  message: ok
                    ? `${agentId} replied via ClawTalk: ${compactLine(response || 'completed', 160)}`
                    : `${agentId} ClawTalk reply blocked${failureKind ? ` (${failureKind})` : ''}: ${compactLine(response || text || 'failed', 160)}`,
                  ...(failureKind ? { failureKind } : {}),
                }
              : null
            const prev = s.operationStates[agentId] ?? makeDormantState(agentId, 3000)
            return {
              agentResponses: existing
                ? s.agentResponses.map((entry) => (entry.id === responseId ? next : entry))
                : [next, ...s.agentResponses].slice(0, MAX_RESPONSES),
              ...(missionEvent ? { missionFeed: [missionEvent, ...s.missionFeed].slice(0, MAX_FEED_EVENTS) } : {}),
              operationStates: {
                ...s.operationStates,
                [agentId]: {
                  ...prev,
                  heartbeatStatus: ok ? 'active' as const : prev.heartbeatStatus,
                  currentPhase: isTerminal ? ok ? 'Responded' : 'Error' : 'ClawTalk',
                  logStream: [
                    `${isTerminal ? ok ? 'OK' : 'ERR' : 'RUN'} ${new Date(ts).toLocaleTimeString()} ${(response || progressText || 'ClawTalk activity').slice(0, 180)}`,
                    ...prev.logStream,
                  ].slice(0, 28),
                  uptimeMs: prev.uptimeMs + 1000,
                },
              },
            }
          })
        },
        clearAgentResponses: () => {
          clearQueuedCommandConsoleFollowups()
          resetCommandConsoleRuntimeState()
          void clearAgentTurnSessions().then((result) => {
            if (!result.ok) console.warn('Failed to clear Command Console sessions:', apiErrorMessage(result.error))
          })
          set({ agentResponses: [], busyAgentIds: [] })
        },
        clearAll: () => {
          clearQueuedCommandConsoleFollowups()
          resetCommandConsoleRuntimeState()
          void clearAgentTurnSessions().then((result) => {
            if (!result.ok) console.warn('Failed to clear Command Console sessions:', apiErrorMessage(result.error))
          })
          set({ activePartyIds: [], confirmedPartyIds: [], selectedAgentId: null, selectedAgentIds: [], agentResponses: [], busyAgentIds: [] })
        },

        updateCoreAttributes: (aid, p) => {
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, attributes: { ...a.attributes, ...p } })) }))
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistConfigPatch(aid, 'profile', { attributes: agent.attributes }, {
              saving: 'Saving core attributes...',
              saved: 'Core attributes saved.',
              failed: 'Core attributes save failed',
            })
          }
        },
        updateSoul: (aid, p) => {
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, soul: { ...a.soul, ...p } })) }))
          // Persist soul to backend disk so settings survive refresh
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistConfigPatch(aid, 'profile', {
              soul: {
                personality: agent.soul.personality,
                autonomyLevel: agent.soul.autonomyLevel,
                riskTolerance: agent.soul.riskTolerance,
                reflectionDepth: agent.soul.reflectionDepth,
                goalOrientation: agent.soul.goalOrientation,
                persistence: agent.soul.persistence,
                alignmentMode: agent.soul.alignmentMode,
              },
            }, {
              saving: 'Saving soul profile...',
              saved: 'Soul profile saved.',
              failed: 'Soul profile save failed',
            })
          }
        },
        updateHeartbeat: (aid, p, options) => {
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, heartbeat: { ...a.heartbeat, ...p } })) }))
          if (options?.persist === false) return
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistHeartbeatConfig(aid, agent.heartbeat, (agentId, scope, entry) => {
              set((s) => ({
                agentConfigSaveStatus: updateAgentConfigSaveStatus(s.agentConfigSaveStatus, agentId, scope, entry),
              }))
            })
          }
        },
        updateMDS: (aid, p) => {
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, mds: { ...a.mds, ...p, capabilities: { ...a.mds.capabilities, ...(p.capabilities || {}) }, toolAccess: p.toolAccess || a.mds.toolAccess } })) }))
          // Persist MDS capabilities to backend disk
          const mdsPatch: Partial<Pick<AgentMDS, 'capabilities' | 'maxContextTokens' | 'toolAccess' | 'delegationAllowed' | 'subAgentSpawnLimit'>> = {
            ...(p.capabilities ? { capabilities: p.capabilities } : {}),
            ...(p.maxContextTokens !== undefined ? { maxContextTokens: p.maxContextTokens } : {}),
            ...(p.toolAccess ? { toolAccess: p.toolAccess } : {}),
            ...(p.delegationAllowed !== undefined ? { delegationAllowed: p.delegationAllowed } : {}),
            ...(p.subAgentSpawnLimit !== undefined ? { subAgentSpawnLimit: p.subAgentSpawnLimit } : {}),
          }
          if (Object.keys(mdsPatch).length) {
            persistConfigPatch(aid, 'mds', { mds: mdsPatch }, {
              saving: 'Saving MDS policy...',
              saved: 'MDS policy saved.',
              failed: 'MDS policy save failed',
            })
          }
        },
        updateAgentMeta: (aid, p) => set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, ...p })) })),
        updateAgentModel: (aid, model) => set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, model: { ...(a.model || {}), ...(model || {}) } })) })),
        updateAgentRuntimePolicy: (aid, p, options) => {
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({ ...a, runtimePolicy: { ...(a.runtimePolicy || {}), ...p } })) }))
          if (options?.persist === false) return
          // Persist runtime policy to backend disk so thinking/timeout survive refresh
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistRuntimePolicy(aid, agent.runtimePolicy, (agentId, scope, entry) => {
              set((s) => ({
                agentConfigSaveStatus: updateAgentConfigSaveStatus(s.agentConfigSaveStatus, agentId, scope, entry),
              }))
            })
          }
        },
        toggleSkillUnlock: (aid, sid, on) => {
          const sk = SKILL_TREE.find((e) => e.id === sid); if (!sk) return
          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => {
            const unlockedSkills = on ? [...new Set([...a.unlockedSkills, sid])] : a.unlockedSkills.filter((id) => id !== sid)
            const capabilityEnabled = unlockedSkills.some((id) => SKILL_TREE.find((entry) => entry.id === id)?.capability === sk.capability)
            return { ...a, unlockedSkills, mds: { ...a.mds, capabilities: { ...a.mds.capabilities, [sk.capability]: on || capabilityEnabled } } }
          }) }))
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistConfigPatch(aid, 'skills', {
              profile: { skills: agent.unlockedSkills },
              mds: { capabilities: agent.mds.capabilities },
            }, {
              saving: 'Saving skill unlocks...',
              saved: 'Skill unlocks saved.',
              failed: 'Skill unlock save failed',
            })
          }
        },
        setAgentEnabledSkills: (aid, installedSkills, enabledSkillIds) => {
          const installedById = new Map<string, AgentSkillEntry>()
          for (const skill of installedSkills) {
            const clean = normalizeSkillEntry(skill)
            if (clean) installedById.set(clean.id, clean)
          }
          const enabled = Array.from(new Set(enabledSkillIds.map((id) => id.trim()).filter((id) => installedById.has(id))))
          const knownSkills = enabled
            .map((id) => installedById.get(id))
            .filter((skill): skill is AgentSkillEntry => Boolean(skill))
          const lastSyncedAt = new Date().toISOString()
          const skillLibrary = {
            knownSkills,
            preferredSkills: enabled,
            lastSyncedAt,
          }

          set((s) => ({ agents: updateAgentInList(s.agents, aid, (a) => ({
            ...a,
            unlockedSkills: enabled,
            mds: {
              ...a.mds,
              skillLibrary,
            },
          })) }))

          persistConfigPatch(aid, 'skills', {
            profile: { skills: enabled },
            mds: { skillLibrary },
          }, {
            saving: 'Saving enabled skills...',
            saved: 'Enabled skills saved.',
            failed: 'Enabled skills save failed',
          })
        },
        recordSkillLearned: (aid, skill) => {
          set((s) => {
          const agent = s.agents.find((a) => a.id === aid)
          const alreadyKnown = Boolean(
            agent?.unlockedSkills.includes(skill.id) ||
            agent?.mds.skillLibrary?.knownSkills.some((entry) => entry.id === skill.id),
          )
          const xpGain = alreadyKnown ? 0 : Math.max(0, Math.round(skill.xpValue || 250))
          const oldLevel = agent?.level ?? 1
          const prevOp = s.operationStates[aid] ?? makeDormantState(aid, agent?.heartbeat.tickIntervalMs ?? 3000)
          const learnedAt = new Date().toISOString()
          const nextAgents = updateAgentInList(s.agents, aid, (a) => {
            const leveled = applyLevelGrowth(a, a.performance.xp + xpGain)
            const knownSkills = a.mds.skillLibrary?.knownSkills || []
            const mergedSkills = [...knownSkills.filter((entry) => entry.id !== skill.id), skill]
            return {
              ...leveled,
              unlockedSkills: [...new Set([...leveled.unlockedSkills, skill.id])],
              mds: {
                ...leveled.mds,
                skillLibrary: {
                  knownSkills: mergedSkills,
                  preferredSkills: [...new Set([...(leveled.mds.skillLibrary?.preferredSkills || []), skill.id])],
                  lastSyncedAt: learnedAt,
                },
              },
            }
          })
          const nextAgent = nextAgents.find((a) => a.id === aid)
          const leveledUp = nextAgent ? nextAgent.level > oldLevel : false
          const eventMessage = leveledUp
            ? `${nextAgent?.name || aid} learned ${skill.name} and leveled up to Lv.${nextAgent?.level}`
            : alreadyKnown
              ? `${nextAgent?.name || aid} synced ${skill.name}`
            : `${nextAgent?.name || aid} learned ${skill.name} (+${xpGain} XP)`
          return {
            agents: nextAgents,
            missionFeed: alreadyKnown ? s.missionFeed : [{
              id: crypto.randomUUID(),
              missionId: s.activeMission?.id ?? 'skill-library',
              timestamp: learnedAt,
              type: 'agent' as const,
              agentId: aid,
              message: eventMessage,
            }, ...s.missionFeed].slice(0, MAX_FEED_EVENTS),
            operationStates: {
              ...s.operationStates,
              [aid]: {
                ...prevOp,
                heartbeatStatus: 'active',
                currentPhase: alreadyKnown ? 'Skill Sync' : leveledUp ? 'Level Up' : 'Skill Unlock',
                logStream: [`${alreadyKnown ? 'SKILL SYNC' : 'SKILL UNLOCKED'} ${skill.name}${xpGain ? ` +${xpGain} XP` : ''}`, ...prevOp.logStream].slice(0, 28),
                uptimeMs: prevOp.uptimeMs + 1000,
              },
            },
          }
          })
          const agent = get().agents.find((a) => a.id === aid)
          if (agent) {
            persistConfigPatch(aid, 'skills', {
              profile: { skills: agent.unlockedSkills },
              mds: { skillLibrary: agent.mds.skillLibrary },
            }, {
              saving: 'Saving learned skill...',
              saved: 'Learned skill saved.',
              failed: 'Learned skill save failed',
            })
          }
        },

        /* --- coordination actions ----------------------------------- */
        sendAgentMessage: (fromAgentId, toAgentId, kind, intent, context, expectedResponse) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return null
          return coordinationBus.sendMessage(mission.id, fromAgentId, toAgentId, kind, intent, context, expectedResponse)
        },
        acknowledgeAgentMessage: (messageId) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.acknowledgeMessage(mission.id, messageId)
        },
        completeAgentMessage: (messageId) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.completeMessage(mission.id, messageId)
        },
        delegateToAgent: (fromAgentId, toAgentId, task, context, deadlineMinutes) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return null
          return coordinationBus.createDelegation(mission.id, fromAgentId, toAgentId, task, context, deadlineMinutes)
        },
        acceptDelegation: (delegationId) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.acceptDelegation(mission.id, delegationId)
        },
        rejectDelegation: (delegationId, reason) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.rejectDelegation(mission.id, delegationId, reason)
        },
        completeDelegation: (delegationId, resultSummary) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.completeDelegation(mission.id, delegationId, resultSummary)
        },
        claimWorkspace: (agentId, files, task) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.claimWorkspace(mission.id, agentId, files, task)
        },
        releaseWorkspace: (agentId) => {
          const mission = requireMission()
          if (!mission || !coordinationBus) return
          coordinationBus.releaseWorkspace(mission.id, agentId)
        },

        resetMission: () => {
          clearAllContinuousTimers()
          clearQueuedCommandConsoleFollowups()
          if (commanderCycleRetryTimer) clearTimeout(commanderCycleRetryTimer || undefined)
          commanderCycleRetryTimer = null
          pendingWorkerCycle.clear()
          cycleToCommanderFn = null
          dispatchNextWorkerCycleFn = null
          refreshLoopDelegationsFn = null
          set({ missionDraft: { ...DEFAULT_MISSION_DRAFT }, activeMission: null })
        },
        resetSimulation: () => {
          clearAllContinuousTimers()
          clearQueuedCommandConsoleFollowups()
          if (commanderCycleRetryTimer) clearTimeout(commanderCycleRetryTimer || undefined)
          commanderCycleRetryTimer = null
          pendingWorkerCycle.clear()
          cycleToCommanderFn = null
          dispatchNextWorkerCycleFn = null
          refreshLoopDelegationsFn = null
          set((s) => {
            const ops: Record<string, AgentOperationState> = {}; for (const a of s.agents) ops[a.id] = makeDormantState(a.id, a.heartbeat.tickIntervalMs)
            const selected = normalizeInitialSelection(s.agents, s.selectedAgentId, s.selectedAgentIds)
            return { activeMission: null, missionHistory: [], missionFeed: [], missionReports: [], agentResponses: [], busyAgentIds: [], operationStates: ops, coordinationMessages: [], coordinationDelegations: [], coordinationWorkspace: [], ...selected }
          })
        },
      }
    },
    {
      name: NEXUS_STORAGE_KEY,
      storage: createJSONStorage(makeQuotaSafeLocalStorage),
      merge: (persisted, current) => {
        const data = persisted as Partial<NexusState> & { _version?: number }
        rememberRetiredAgentIds(data.retiredAgentIds)
        const seedAgents = getSeedAgents()
        // Discard persisted data without version stamp or from older versions
        if (!data._version || data._version < 3) {
          return current
        }
        // Merge persisted agents with seeds: keep custom portraits, but refresh known seed defaults.
        const seedIds = new Set(seedAgents.map((seed) => seed.id))
        const persistedAgents = (data.agents || []).filter((agent) => !isRetiredAgentId(agent.id))
        const merged = { ...current, ...data, agents: [
          ...seedAgents.map((seed) => {
            const existing = persistedAgents.find((a: OpenClawAgent) => a.id === seed.id)
            if (!existing) return seed
            const keepSeedPortrait = isDefaultAgentPortrait(seed.id, existing.portrait)
            return sanitizeAgentForStore({ ...seed, ...existing, portrait: keepSeedPortrait ? seed.portrait : existing.portrait })
          }),
          ...persistedAgents.filter((agent: OpenClawAgent) => !seedIds.has(agent.id)).map(sanitizeAgentForStore),
        ]}
        const agents = merged.agents.map(sanitizeAgentForStore).filter((agent) => !isRetiredAgentId(agent.id))
        const activePartyIds = sameOrderedIds(merged.activePartyIds, LEGACY_DEFAULT_PARTY_IDS)
          ? makeDefaultParty(agents)
          : sanitizePartyIds(merged.activePartyIds, agents)
        const confirmedPartyIds = sameOrderedIds(merged.confirmedPartyIds, LEGACY_DEFAULT_PARTY_IDS)
          ? makeDefaultParty(agents)
          : sanitizePartyIds(merged.confirmedPartyIds, agents)
        const selection = normalizeInitialSelection(agents)
        return {
          ...merged,
          agents,
          retiredAgentIds: retiredAgentIdsForStore(),
          activePartyIds,
          confirmedPartyIds,
          ...selection,
          missionHistory: (merged.missionHistory || []).slice(0, MAX_HISTORY),
          missionReports: (merged.missionReports || []).slice(0, MAX_REPORTS),
          agentResponses: current.agentResponses,
          missionFeed: current.missionFeed,
          busyAgentIds: current.busyAgentIds,
          operationStates: current.operationStates,
          sessionWarmAgentIds: [],
          agentConfigSaveStatus: {},
        }
      },
      // Persist operator configuration and completed mission summaries; keep active runtime state volatile.
      partialize: (s) => ({
        _version: 5,
        retiredAgentIds: s.retiredAgentIds,
        agents: s.agents.filter((agent) => !isRetiredAgentId(agent.id)).map(sanitizeAgentForPersistentStore),
        activePartyIds: s.activePartyIds.filter((id) => !isRetiredAgentId(id)),
        confirmedPartyIds: s.confirmedPartyIds.filter((id) => !isRetiredAgentId(id)),
        missionDraft: s.missionDraft,
        missionHistory: s.missionHistory.slice(0, MAX_HISTORY),
        missionReports: s.missionReports.slice(0, MAX_REPORTS),
      }),
    },
  ),
)

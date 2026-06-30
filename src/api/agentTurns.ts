import type { AgentSkillEntry, AgentTurnAttachment, FastModeDefault, ThinkingLevel } from '../types/nexus'
import { apiRequest, type ApiRequestOptions, type ApiResult } from './client'

export type AgentRuntimePreflightPayload = {
  agent?: string
  message?: string
  checks?: Array<{ ok?: boolean; message?: string; severity?: string }>
  sandbox?: {
    mode?: string
    autoDisabled?: boolean
  }
}

export type AgentTurnSessionClearPayload = {
  cleared?: number
  scope?: 'agent' | 'all'
  sessionLockCleanup?: {
    scanned?: number
    removed?: number
    errors?: number
  }
}

export type AgentTurnPayload = {
  ok: boolean
  reply?: unknown
  stdout?: string
  stderr?: string
  code?: number
  error?: unknown
  detail?: unknown
  model?: string
  modelId?: string
  provider?: string
  failureKind?: string
  runtimeTransport?: 'gateway-chat' | 'gateway' | 'local'
  gatewayFallbackDetail?: string
  streaming?: {
    model?: string
    modelId?: string
    provider?: string
    transport?: string
    liveTokens?: boolean
    buffered?: boolean
  }
  learnedSkills?: AgentSkillEntry[]
  incompleteRun?: boolean
  runtimeBlockerPath?: string | null
  teamSyncEvidence?: string[]
}

export type AgentTurnRequest = {
  agent: string
  message: string
  intentMessage?: string
  thinking: ThinkingLevel
  fastMode: FastModeDefault
  timeoutSeconds: number
  promptProfile: 'fast'
  attachments?: AgentTurnAttachment[]
  sessionKey?: string
  forceOpenClawRuntime?: true
}

export function preflightAgentRuntime(agentId: string): Promise<ApiResult<AgentRuntimePreflightPayload>> {
  return apiRequest<AgentRuntimePreflightPayload>('/api/openclaw/agent-preflight', {
    method: 'POST',
    timeoutMs: 30_000,
    body: { agent: agentId },
  })
}

export function sendBufferedAgentTurn(
  body: AgentTurnRequest,
  options: Pick<ApiRequestOptions, 'signal' | 'timeoutMs'>,
): Promise<ApiResult<AgentTurnPayload>> {
  return apiRequest<AgentTurnPayload>('/api/openclaw/agent-turn', {
    method: 'POST',
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    body,
  })
}

export function prewarmAgentTurn(agentId: string): Promise<ApiResult<AgentTurnPayload>> {
  return apiRequest<AgentTurnPayload>('/api/openclaw/agent-turn', {
    method: 'POST',
    timeoutMs: 60_000,
    body: {
      agent: agentId,
      message: 'Confirm readiness in one word: ready.',
      thinking: 'off',
      promptProfile: 'fast',
    },
  })
}

export function clearAgentTurnSessions(): Promise<ApiResult<AgentTurnSessionClearPayload>> {
  return apiRequest<AgentTurnSessionClearPayload>('/api/openclaw/agent-turn/sessions/clear', {
    method: 'POST',
    timeoutMs: 20_000,
    body: {},
  })
}

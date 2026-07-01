import type { AgentSkillEntry, AgentTurnAttachment, FastModeDefault, ThinkingLevel } from '../types/nexus'
import { apiUrl } from '../utils/apiUrl'
import { createSseFrameParser, type SseFrame } from '../utils/sseStream'
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

export type AgentTurnStreamResult = {
  payload: AgentTurnPayload
  responseOk: boolean
  streamed: boolean
}

export type AgentTurnStreamOptions = {
  signal: AbortSignal
  onFrame: (frame: SseFrame) => void
  onStreamComplete: (response: Response) => AgentTurnStreamResult
  fallbackPayload: (response: Response, text: string) => AgentTurnPayload
}

async function readAgentTurnResponsePayload<T>(response: Response): Promise<{ payload?: T; text: string }> {
  const text = await response.text().catch(() => '')
  if (!text.trim()) return { text }
  try {
    return { text, payload: JSON.parse(text) as T }
  } catch {
    return { text }
  }
}

async function readAgentTurnSseFrames(response: Response, onFrame: AgentTurnStreamOptions['onFrame']): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sseParser = createSseFrameParser()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const frame of sseParser.push(decoder.decode(value, { stream: true }))) onFrame(frame)
  }
  for (const frame of sseParser.push(decoder.decode())) onFrame(frame)
  for (const frame of sseParser.flush()) onFrame(frame)
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

export async function sendStreamingAgentTurn(
  body: AgentTurnRequest,
  options: AgentTurnStreamOptions,
): Promise<AgentTurnStreamResult> {
  const response = await fetch(apiUrl('/api/openclaw/agent-turn/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') || ''
  if (response.body && contentType.includes('text/event-stream')) {
    await readAgentTurnSseFrames(response, options.onFrame)
    return options.onStreamComplete(response)
  }
  const read = await readAgentTurnResponsePayload<AgentTurnPayload>(response)
  return {
    payload: read.payload || options.fallbackPayload(response, read.text),
    responseOk: response.ok,
    streamed: false,
  }
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

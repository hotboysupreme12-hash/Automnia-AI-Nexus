import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import { restartGatewayRuntime, useRuntimeSummaryStatus } from '../../hooks/useRuntimeStatus'
import type { GatewayStabilityStatus } from '../../hooks/useRuntimeStatus'
import {
  makeCommandConsoleDraftStorageKey,
  readCommandConsoleDraft,
  removeCommandConsoleDraft,
  writeCommandConsoleDraft,
  type CommandConsoleDraft,
} from '../../store/commandConsoleState'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentResponse, AgentTurnAttachment, OpenClawAgent } from '../../types/nexus'
import { apiUrl } from '../../utils/apiUrl'
import { redactDiagnosticText } from '../../utils/diagnosticRedaction'
import { agentPortraitSrc } from '../../utils/portrait'
import { createSseFrameParser } from '../../utils/sseStream'
import {
  decodeAudioToMono16Khz,
  friendlyMicrophoneError,
  preferredRecordingMimeType,
  voiceRecordingFileName,
} from '../../speech/audioCapture'
import {
  prepareLocalSpeechModel,
  transcribeAudioLocally,
  type LocalSpeechProgress,
} from '../../speech/localSpeechClient'
import {
  SPEECH_SETTINGS_CHANGED_EVENT,
  readSpeechSettings,
  type SpeechSettings,
  type SpeechTranscriptionMode,
} from '../../speech/speechSettings'
import { monitorVoiceActivity } from '../../speech/voiceActivity'
import { Badge, Button, IconButton, StatusChip } from '../ui'
import type { BadgeTone } from '../ui'

const RARITY_RING: Record<string, string> = {
  legendary: 'ring-[#f2cc62]/55',
  epic: 'ring-[#b895d6]/45',
  rare: 'ring-[#78e7f5]/40',
  common: 'ring-white/12',
}

const MESSAGE_RENDER_LIMIT = 60
const LANE_DIAGNOSTIC_WARN_MS = 10 * 60 * 1000
const LANE_DIAGNOSTIC_STALLED_MS = 30 * 60 * 1000
const LANE_DIAGNOSTIC_TICK_MS = 30 * 1000
const VOICE_WAVEFORM_PROFILE = [0.46, 0.7, 0.94, 1, 0.86, 0.64, 0.42]
const COMMAND_CONSOLE_ACCEPTED_FILE_TYPES = [
  'image/*',
  'audio/*',
  '.pdf', '.doc', '.docx', '.rtf', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.ipynb', '.java', '.go', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.rb', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.toml', '.ini', '.env',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus',
].join(',')

type PendingAttachmentKind = 'image' | 'audio' | 'document' | 'spreadsheet' | 'presentation' | 'code' | 'data' | 'file'

type PendingAttachment = {
  file: File
  preview: string
  kind: PendingAttachmentKind
}

type CommandConsoleUploadPayload = {
  attachment?: AgentTurnAttachment
}

type AgentMessageMeta = {
  name: string
  role: string
  rarity: string
  portrait: string
  modelId: string
}

type ConsoleStreamState = 'connecting' | 'live' | 'reconnecting' | 'offline'

type ConsoleStreamHealth = {
  state: ConsoleStreamState
  detail: string
  retries: number
}

type VoiceInputPhase = 'idle' | 'requesting' | 'recording' | 'processing'

type OnlineSpeechTranscriptionPayload = {
  text: string
  model: string
  provider: 'openai'
}

function timeAgo(ts: string) {
  const now = Date.now()
  const then = new Date(ts).getTime()
  const sec = Math.floor((now - then) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function messageClock(ts: string) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function messageTimestampTitle(ts: string) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function compactModelLabel(modelId?: string) {
  const cleaned = modelId?.trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('automnia-cloud/')) return 'Automnia Cloud AI'
  const parts = cleaned.split('/').filter(Boolean)
  return parts.at(-1) || cleaned
}

function billingRouteLabel(entry: AgentResponse): { label: string; title: string; tone: BadgeTone } | null {
  const modelId = entry.modelId?.trim().toLowerCase() || ''
  const transport = entry.transport?.trim().toLowerCase() || ''
  const hostedCredits = modelId.startsWith('automnia-cloud/') || transport === 'automnia-cloud-relay'
  if (hostedCredits) {
    const balance = typeof entry.remainingCredits === 'number' && Number.isFinite(entry.remainingCredits)
      ? `${entry.remainingCredits.toLocaleString('en-US')} credits remaining`
      : 'Balance will refresh after the Automnia Cloud response is confirmed.'
    return { label: 'Automnia credits', title: `Cloud Subscription route. ${balance}`, tone: 'success' }
  }
  if (modelId || transport.includes('gateway') || transport.includes('openclaw')) {
    return { label: 'Your provider', title: 'BYOK or /runtime route. The configured provider account bills this request, not Automnia hosted credits.', tone: 'info' }
  }
  return null
}

function paintVoiceWaveform(element: HTMLSpanElement | null, level: number) {
  if (!element) return
  const normalized = Math.max(0, Math.min(1, level))
  for (const [index, bar] of Array.from(element.children).entries()) {
    const profile = VOICE_WAVEFORM_PROFILE[index] || 0.7
    const shapedLevel = Math.max(0.12, Math.min(1, normalized * profile + (index % 2 ? 0.08 : 0.03)))
    const target = bar as HTMLElement
    target.style.height = `${Math.round(3 + shapedLevel * 15)}px`
    target.style.opacity = `${0.48 + shapedLevel * 0.52}`
  }
}

function agentBusyMessage(agent: Pick<OpenClawAgent, 'name'>) {
  return `${agent.name} is working. Send a follow-up and it will start when the current turn finishes.`
}

function formatMs(value?: number) {
  if (!value || value < 0) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function formatShortElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 3_600_000)}h`
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] || ''
}

function pendingAttachmentKind(file: File): PendingAttachmentKind {
  const mime = file.type.toLowerCase()
  const ext = fileExtension(file.name)
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (['pdf', 'doc', 'docx', 'rtf'].includes(ext)) return 'document'
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return 'spreadsheet'
  if (['ppt', 'pptx'].includes(ext)) return 'presentation'
  if (['json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env'].includes(ext)) return 'data'
  if (['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'ipynb', 'java', 'go', 'rs', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'ps1', 'sql'].includes(ext)) return 'code'
  if (['txt', 'md', 'markdown', 'log'].includes(ext) || mime.startsWith('text/')) return 'document'
  return 'file'
}

function attachmentKindLabel(kind: PendingAttachmentKind, file: File) {
  const ext = fileExtension(file.name)
  if (ext) return ext.toUpperCase()
  return kind.toUpperCase()
}

function timestampDeltaMs(start?: string, end?: string) {
  if (!start || !end) return 0
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.max(0, endMs - startMs)
}

function timestampMs(value?: string) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function latestRunActivityMs(entry: AgentResponse) {
  const activityMs = (entry.activity || []).reduce((latest, event) => Math.max(latest, timestampMs(event.timestamp)), 0)
  return Math.max(
    activityMs,
    timestampMs(entry.progressUpdatedAt),
    timestampMs(entry.firstTokenAt),
    timestampMs(entry.startedAt),
    timestampMs(entry.timestamp),
  )
}

function transportLabel(value?: string, buffered?: boolean) {
  const clean = value?.trim()
  if (!clean) return buffered ? 'buffered' : ''
  if (clean.toLowerCase() === 'command-console-queue') return 'Queued'
  return clean
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\b(Api|Http|Https|Json|Sse|Ws)\b/g, (match) => match.toUpperCase())
}

function metricLabel(label: string, value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${label} ${Math.max(0, Math.round(value))}`
    : ''
}

function gatewayStabilityWorkloadLabel(stability?: GatewayStabilityStatus | null) {
  if (!stability?.available) return ''
  const parts = [
    metricLabel('active', stability.summary.active),
    metricLabel('waiting', stability.summary.waiting),
    metricLabel('queued', stability.summary.queued),
  ].filter(Boolean)
  if (parts.length) return parts.join(' / ')
  return metricLabel('max queue', stability.summary.maxQueueDepth)
}

function gatewayStabilityState(stability?: GatewayStabilityStatus | null) {
  if (!stability) return 'pending'
  if (!stability.available) return stability.error ? 'offline' : 'pending'
  if (stability.summary.warningCount > 0 || (stability.summary.waiting ?? 0) > 0 || (stability.summary.queued ?? 0) > 0) return 'warning'
  return 'healthy'
}

function gatewayStabilityHeaderLabel(stability?: GatewayStabilityStatus | null) {
  if (!stability) return 'Diag pending'
  if (!stability.available) return stability.error ? 'Diag offline' : 'Diag pending'
  const waiting = Math.max(0, Math.round((stability.summary.waiting ?? 0) + (stability.summary.queued ?? 0)))
  if (waiting > 0) return `Diag wait ${waiting}`
  if (stability.summary.warningCount > 0) return `Diag warn ${stability.summary.warningCount}`
  return 'Diag ok'
}

function responseStatusTone(status: 'streaming' | 'complete' | 'blocked'): BadgeTone {
  if (status === 'complete') return 'success'
  if (status === 'blocked') return 'error'
  return 'info'
}

function gatewayStabilityTitle(stability?: GatewayStabilityStatus | null) {
  if (!stability) return 'Gateway diagnostics have not loaded yet.'
  if (!stability.available) {
    return stability.error
      ? `Gateway diagnostics unavailable: ${redactDiagnosticText(stability.error, 120)}`
      : 'Gateway diagnostics waiting for the backend gateway-client connection.'
  }
  const workload = gatewayStabilityWorkloadLabel(stability)
  const latest = stability.summary.latestEventType
    ? `Last event: ${redactDiagnosticText(stability.summary.latestEventType, 80)}${stability.summary.latestEventAt ? ` at ${messageClock(stability.summary.latestEventAt)}` : ''}.`
    : ''
  const warnings = stability.summary.recentWarnings.length
    ? `Warnings: ${stability.summary.recentWarnings.map((warning) => redactDiagnosticText(warning, 96)).join('; ')}.`
    : ''
  return [
    `Gateway diagnostics from ${stability.source}.`,
    workload ? `Workload: ${workload}.` : '',
    `Events: ${stability.count}${stability.dropped ? `, dropped ${stability.dropped}` : ''}.`,
    latest,
    warnings,
  ].filter(Boolean).join(' ')
}

function isRuntimeNoticeTransport(value?: string) {
  const clean = value?.trim().toLowerCase()
  return clean === 'buffered-openclaw' ||
    clean === 'gateway-chat-agent' ||
    clean === 'gateway-agent' ||
    clean === 'local-agent' ||
    clean === 'gateway-chat' ||
    clean === 'gateway' ||
    clean === 'local'
}

function latestRunStatus(entry?: AgentResponse) {
  if (!entry?.streaming) return ''
  const latestActivity = [...(entry.activity || [])].reverse().find((event) => {
    const label = event.label.trim()
    return label && event.type !== 'message.final' && event.type !== 'run.finished' && !/final response received/i.test(label)
  })
  const latestProgress = [...(entry.progressLines || [])].reverse().find((line) => line.trim())
  return latestActivity?.label.trim() || latestProgress?.trim() || entry.progressLabel?.trim() || 'Agent started working.'
}

type ResponseCta = {
  label: string
  detail?: string
  action?: 'restart-gateway' | 'cancel-queued'
}

function responseCta(entry: AgentResponse): ResponseCta | null {
  if (entry.streaming && entry.transport === 'command-console-queue') {
    const queueDetail = entry.queuePosition && entry.queueDepth
      ? `Position ${entry.queuePosition} of ${entry.queueDepth}.`
      : 'Waiting for the active lane to finish.'
    return {
      label: 'Queued',
      detail: `${queueDetail} Starts automatically when the lane is free.`,
      action: 'cancel-queued',
    }
  }
  if (entry.streaming && (entry.runtimeNoticeActive || isRuntimeNoticeTransport(entry.transport))) return null
  if (entry.streaming) return null

  switch (entry.failureKind) {
    case 'auth_missing':
    case 'auth_expired':
      return { label: 'Connect provider', detail: 'Refresh credentials, then retry this turn.' }
    case 'gateway_disconnect':
    case 'gateway_unavailable':
      return { label: 'Reset gateway', detail: 'Gateway is unavailable. Reset it, then retry.', action: 'restart-gateway' }
    case 'network_error':
      return { label: 'Reset gateway', detail: 'Local backend connection dropped. Reset it, then retry.', action: 'restart-gateway' }
    case 'sandbox_unavailable':
      return { label: 'Fix sandbox', detail: 'Disable sandbox or install the required Docker image.' }
    case 'provider_unsupported':
      return { label: 'Change model', detail: 'Pick a supported model or provider fallback, then retry.' }
    case 'timeout':
      return { label: 'Raise timeout', detail: 'Close stale sessions or allow more time before retrying.' }
    case 'rate_limit':
      return { label: 'Retry later', detail: 'Provider quota is limiting this turn.' }
    default:
      return entry.ok ? null : { label: 'Check logs', detail: 'Review Monitor gateway logs before retrying.' }
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AI'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function portraitSrcForAgent(agent: Pick<OpenClawAgent, 'id' | 'portrait'>) {
  return agentPortraitSrc(agent.id, agent.portrait)
}

function portraitFailureKey(agentId: string, src: string) {
  return `${agentId}::${src}`
}

const ResponseMessage = memo(function ResponseMessage({
  entry,
  meta,
  avatarFailed,
  onPortraitFailed,
  onRestartGateway,
  onCancelQueuedTurn,
  actionBusy,
}: {
  entry: AgentResponse
  meta?: AgentMessageMeta
  avatarFailed: boolean
  onPortraitFailed: (agentId: string, src: string) => void
  onRestartGateway: (entryId: string) => void
  onCancelQueuedTurn: (entryId: string) => void
  actionBusy: boolean
}) {
  const avatar = meta?.portrait || ''
  const name = meta?.name || entry.agentId
  const role = meta?.role || ''
  const rarity = meta?.rarity || 'common'
  const avatarRing = RARITY_RING[rarity] ?? RARITY_RING.common
  const replyText = entry.response
  const hasContent = replyText.trim().length > 0
  const modelId = entry.modelId || meta?.modelId || ''
  const modelLabel = compactModelLabel(modelId)
  const billingRoute = billingRouteLabel(entry)
  const firstTokenMs = timestampDeltaMs(entry.queuedAt || entry.startedAt || entry.timestamp, entry.firstTokenAt)
  const firstTokenLabel = formatMs(firstTokenMs)
  const transport = transportLabel(entry.transport, entry.buffered)
  const queuePositionLabel = entry.transport === 'command-console-queue' && entry.queuePosition && entry.queueDepth
    ? `${entry.queuePosition}/${entry.queueDepth}`
    : ''
  const status = entry.streaming ? 'streaming' : entry.ok ? 'complete' : 'blocked'
  const runtimeNoticeActive = Boolean(entry.streaming && (entry.runtimeNoticeActive || isRuntimeNoticeTransport(entry.transport)))
  const statusText = runtimeNoticeActive ? 'runtime' : status
  const durationLabel = entry.durationMs > 0 ? `${(entry.durationMs / 1000).toFixed(1)}s` : ''
  const cta = responseCta(entry)
  const runtimeTitle = [
    durationLabel ? `Total runtime: ${durationLabel}` : '',
    firstTokenLabel ? `First output: ${firstTokenLabel}` : '',
    entry.tokenCountEstimate && entry.tokenCountEstimate > 0 ? `Approximate output: ${entry.tokenCountEstimate} tokens` : '',
    transport ? `Transport: ${transport}` : '',
  ].filter(Boolean).join(' / ')
  const clockTitle = `${messageTimestampTitle(entry.timestamp)} / ${timeAgo(entry.timestamp)}`
  const bodyText = hasContent ? replyText : entry.streaming ? '' : entry.ok ? 'No output' : 'Request failed'
  const showInlineThinking = entry.streaming && !hasContent && runtimeNoticeActive
  const progressText = entry.streaming && !hasContent && !showInlineThinking ? latestRunStatus(entry) : ''
  const displayText = bodyText || progressText
  const bodyState = showInlineThinking ? 'thinking' : hasContent ? 'response' : progressText ? 'progress' : entry.ok ? 'empty' : 'blocked'

  return (
    <div
      key={entry.id}
      data-agent-rarity={rarity}
      data-message-state={status}
      data-message-transport={entry.transport || ''}
      className="dy-command-message group/message relative overflow-hidden border border-white/[0.055] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.018))] p-4 transition-all duration-200 hover:bg-white/[0.045] hover:border-white/[0.09] border-l-[3px]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/16 via-white/4 to-transparent" />
      <div className="dy-command-message-header mb-3">
        <div className={`dy-command-message-avatar relative h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1 shadow-lg ring-offset-1 ring-offset-slate-950 ${avatarRing}`}>
          {avatar && !avatarFailed ? (
            <img
              src={avatar}
              alt=""
              className="h-full w-full object-cover"
              onError={() => onPortraitFailed(entry.agentId, avatar)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-sm font-bold text-slate-500">
              {initials(name)}
            </div>
          )}
        </div>
        <div className="dy-command-message-identity">
          <div className="dy-command-message-title-row">
            <span className="dy-command-agent-name" title={name}>{name}</span>
            <Badge className="dy-command-message-status" data-state={status} tone={responseStatusTone(status)} size="micro">
              {statusText}
            </Badge>
          </div>
          {role && (
            <p className="dy-command-agent-role" title={role}>{role}</p>
          )}
        </div>
        <div className="dy-command-message-runtime">
          <time
            dateTime={entry.timestamp}
            title={clockTitle}
            className="dy-command-message-clock"
          >
            {messageClock(entry.timestamp)}
          </time>
          {modelLabel && (
            <span
              title={`Model: ${modelId}`}
              className="dy-command-message-model"
            >
              {modelLabel}
            </span>
          )}
        </div>
        <div className="dy-command-message-meta">
          {durationLabel && (
            <Badge
              className={`dy-command-message-chip ${entry.ok ? 'is-success' : 'is-error'}`}
              title={runtimeTitle || 'Runtime'}
              tone={entry.ok ? 'success' : 'error'}
              size="micro"
            >
              {durationLabel}
            </Badge>
          )}
          {firstTokenLabel && (
            <Badge className="dy-command-message-chip is-info" title="Time to first visible output" tone="info" size="micro">
              first {firstTokenLabel}
            </Badge>
          )}
          {transport && (
            <Badge className="dy-command-message-chip is-transport" title={runtimeTitle || `Transport: ${transport}`} tone="info" size="micro">
              {transport}
            </Badge>
          )}
          {billingRoute && (
            <Badge className="dy-command-message-chip is-billing" title={billingRoute.title} tone={billingRoute.tone} size="micro">
              {billingRoute.label}
            </Badge>
          )}
          {queuePositionLabel && (
            <Badge
              className="dy-command-message-chip is-queue"
              title={`Queue position ${entry.queuePosition} of ${entry.queueDepth}`}
              tone="warning"
              size="micro"
            >
              queue {queuePositionLabel}
            </Badge>
          )}
          {entry.failureKind && !entry.ok && (
            <Badge className="dy-command-message-chip is-warning" title={`Failure kind: ${entry.failureKind}`} tone="warning" size="micro">
              {entry.failureKind.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
      </div>

      {displayText || showInlineThinking ? (
        <div className="dy-command-message-body-wrap relative">
          <p
            className="dy-command-message-body whitespace-pre-wrap break-words border border-white/[0.04] bg-slate-950/30 px-3 py-2.5 text-[12px] leading-relaxed text-slate-300/95"
            data-body-state={bodyState}
            aria-live={entry.streaming ? 'polite' : undefined}
          >
            {showInlineThinking ? (
              <span className="dy-command-thinking-label">
                Thinking
                <span className="dy-command-thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            ) : (
              <>
                {displayText}
                {entry.streaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-cyan-300/70 align-[-2px]" />}
              </>
            )}
          </p>
        </div>
      ) : !entry.streaming && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 italic">
          <span className="h-1 w-1 rounded-full bg-slate-600" />
          {entry.ok ? 'No output' : 'Request failed'}
        </div>
      )}

      {cta && (
        <div className="dy-command-response-cta">
          <div className="min-w-0">
            <p>{cta.label}</p>
            {cta.detail && <span>{cta.detail}</span>}
          </div>
          {cta.action === 'restart-gateway' && (
            <Button
              disabled={actionBusy}
              onClick={() => onRestartGateway(entry.id)}
              title="Reset the OpenClaw gateway"
              size="compact"
              variant="secondary"
              loading={actionBusy}
            >
              {actionBusy ? 'Resetting' : 'Reset'}
            </Button>
          )}
          {cta.action === 'cancel-queued' && (
            <Button
              disabled={actionBusy}
              onClick={() => onCancelQueuedTurn(entry.id)}
              title="Cancel this queued Command Console turn"
              size="compact"
              variant="danger"
              loading={actionBusy}
            >
              {actionBusy ? 'Canceling' : 'Cancel'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
})

export function AgentResponseConsole() {
  const agents = useNexusStore((s) => s.agents)
  const selectedAgentIds = useNexusStore((s) => s.selectedAgentIds)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const confirmedPartyIds = useNexusStore((s) => s.confirmedPartyIds)
  const responses = useNexusStore((s) => s.agentResponses)
  const busyAgentIds = useNexusStore((s) => s.busyAgentIds)
  const sendPromptToAgent = useNexusStore((s) => s.sendPromptToAgent)
  const sendPromptToSelectedAgents = useNexusStore((s) => s.sendPromptToSelectedAgents)
  const sendPromptToActiveParty = useNexusStore((s) => s.sendPromptToActiveParty)
  const stopActiveAgentRuns = useNexusStore((s) => s.stopActiveAgentRuns)
  const cancelQueuedCommandConsoleFollowup = useNexusStore((s) => s.cancelQueuedCommandConsoleFollowup)
  const ingestClawTalkConsoleEvent = useNexusStore((s) => s.ingestClawTalkConsoleEvent)
  const selectAgent = useNexusStore((s) => s.selectAgent)
  const clearAgentResponses = useNexusStore((s) => s.clearAgentResponses)
  const missionRunning = useNexusStore((s) => s.activeMission?.status === 'running')

  const [uploadedAttachment, setUploadedAttachment] = useState<PendingAttachment | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [messageActionId, setMessageActionId] = useState('')
  const [messageActionError, setMessageActionError] = useState('')
  const [speechSettings, setSpeechSettings] = useState<SpeechSettings>(() => readSpeechSettings())
  const speechMode = speechSettings.mode
  const [voicePhase, setVoicePhase] = useState<VoiceInputPhase>('idle')
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [chatRemovedPartyIds, setChatRemovedPartyIds] = useState<string[]>([])
  const [laneDiagnosticNow, setLaneDiagnosticNow] = useState(() => Date.now())
  const [clawTalkStreamHealth, setClawTalkStreamHealth] = useState<ConsoleStreamHealth>(() => ({
    state: 'connecting',
    detail: 'Connecting to ClawTalk console stream.',
    retries: 0,
  }))
  const [failedPortraitKeys, setFailedPortraitKeys] = useState<Set<string>>(() => new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const promptRef = useRef('')
  const lastSendAttemptRef = useRef('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const recordingTickRef = useRef<number | null>(null)
  const recordingLimitRef = useRef<number | null>(null)
  const voiceActivityCleanupRef = useRef<(() => void) | null>(null)
  const voiceWaveformRef = useRef<HTMLSpanElement | null>(null)
  const recordingDiscardReasonRef = useRef('')
  const voiceStatusClearRef = useRef<number | null>(null)
  const voiceMountedRef = useRef(true)
  const hasActiveConsoleWork = busyAgentIds.length > 0 || responses.some((entry) => entry.streaming)
  const { status: runtimeSummaryStatus } = useRuntimeSummaryStatus(hasActiveConsoleWork ? 5000 : 12000)
  const gatewayStability = runtimeSummaryStatus?.gateway.stability ?? null
  const gatewayStabilityChipState = gatewayStabilityState(gatewayStability)
  const gatewayStabilityChipLabel = gatewayStabilityHeaderLabel(gatewayStability)
  const gatewayStabilityTitleText = useMemo(() => gatewayStabilityTitle(gatewayStability), [gatewayStability])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentMetaById = useMemo(() => new Map(agents.map((agent) => [agent.id, {
    name: agent.name,
    role: agent.role,
    rarity: agent.rarity ?? 'common',
    portrait: portraitSrcForAgent(agent),
    modelId: agent.model?.primary ?? '',
  } satisfies AgentMessageMeta])), [agents])

  const selectedTargets = useMemo(
    () => selectedAgentIds.map((id) => agentById.get(id)).filter((a): a is OpenClawAgent => Boolean(a)),
    [agentById, selectedAgentIds],
  )
  const basePartyTargetIds = confirmedPartyIds.length ? confirmedPartyIds : activePartyIds
  const partyTargetIds = useMemo(
    () => basePartyTargetIds.filter((id) => !chatRemovedPartyIds.includes(id)),
    [basePartyTargetIds, chatRemovedPartyIds],
  )

  useEffect(() => {
    setChatRemovedPartyIds((current) => {
      const activeRemovals = current.filter((id) => basePartyTargetIds.includes(id))
      return activeRemovals.length === current.length ? current : activeRemovals
    })
  }, [basePartyTargetIds])

  const draftRouteKey = useMemo(() => {
    if (selectedAgentIds.length === 1) return `direct:${selectedAgentIds[0]}`
    if (selectedAgentIds.length > 1) return `selected:${[...selectedAgentIds].sort().join(',')}`
    return `party:${[...partyTargetIds].sort().join(',')}`
  }, [partyTargetIds, selectedAgentIds])
  const draftStorageKey = makeCommandConsoleDraftStorageKey(draftRouteKey)
  const [promptDraft, setPromptDraft] = useState<CommandConsoleDraft>(() => ({
    storageKey: draftStorageKey,
    value: readCommandConsoleDraft(draftStorageKey),
  }))
  const storedPromptDraft = useMemo(() => readCommandConsoleDraft(draftStorageKey), [draftStorageKey])
  const prompt = promptDraft.storageKey === draftStorageKey ? promptDraft.value : storedPromptDraft
  const setPrompt = useCallback((value: string) => {
    promptRef.current = value
    setPromptDraft({ storageKey: draftStorageKey, value })
    writeCommandConsoleDraft(draftStorageKey, value)
  }, [draftStorageKey])
  promptRef.current = prompt

  const busyAgents = useMemo(
    () => busyAgentIds.map((id) => agentById.get(id)).filter((a): a is OpenClawAgent => Boolean(a)),
    [agentById, busyAgentIds],
  )
  const queuedResponsesByAgent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of responses) {
      if (!entry.streaming || entry.transport !== 'command-console-queue') continue
      counts.set(entry.agentId, (counts.get(entry.agentId) || 0) + 1)
    }
    return counts
  }, [responses])
  const queuedResponseCount = useMemo(
    () => Array.from(queuedResponsesByAgent.values()).reduce((total, count) => total + count, 0),
    [queuedResponsesByAgent],
  )
  const activeResponseByAgent = useMemo(() => {
    const active = new Map<string, AgentResponse>()
    for (const entry of responses) {
      if (!entry.streaming || entry.transport === 'command-console-queue') continue
      if (!active.has(entry.agentId)) active.set(entry.agentId, entry)
    }
    return active
  }, [responses])
  const laneDiagnosticsByAgent = useMemo(() => {
    const diagnostics = new Map<string, {
      severity: 'quiet' | 'stalled'
      quietLabel: string
      title: string
    }>()
    for (const agent of busyAgents) {
      const queuedCount = queuedResponsesByAgent.get(agent.id) || 0
      if (!queuedCount) continue
      const activeResponse = activeResponseByAgent.get(agent.id)
      if (!activeResponse) continue
      const lastActivityMs = latestRunActivityMs(activeResponse)
      if (!lastActivityMs) continue
      const quietMs = Math.max(0, laneDiagnosticNow - lastActivityMs)
      if (quietMs < LANE_DIAGNOSTIC_WARN_MS) continue
      const severity = quietMs >= LANE_DIAGNOSTIC_STALLED_MS ? 'stalled' : 'quiet'
      const quietLabel = formatShortElapsed(quietMs)
      diagnostics.set(agent.id, {
        severity,
        quietLabel,
        title: `${agent.name} has been ${severity === 'stalled' ? 'stalled' : 'quiet'} for ${quietLabel} with ${queuedCount} queued follow-up${queuedCount === 1 ? '' : 's'} waiting. ${gatewayStabilityTitleText}`,
      })
    }
    return diagnostics
  }, [activeResponseByAgent, busyAgents, gatewayStabilityTitleText, laneDiagnosticNow, queuedResponsesByAgent])
  const laneDiagnostics = useMemo(() => Array.from(laneDiagnosticsByAgent.values()), [laneDiagnosticsByAgent])
  const busyRunLabel = `${busyAgents.length} Command Console ${busyAgents.length === 1 ? 'run' : 'runs'} running${laneDiagnostics.length ? `; ${laneDiagnostics.length} quiet lane${laneDiagnostics.length === 1 ? '' : 's'}` : ''}`
  const displayedResponses = useMemo(() => responses.slice(0, MESSAGE_RENDER_LIMIT).reverse(), [responses])
  const visibleDisplayedResponses = displayedResponses
  const targetCount = selectedTargets.length || partyTargetIds.length
  const targetMode = selectedTargets.length
    ? selectedTargets.length === 1 ? 'Agent lane' : 'Selected lanes'
    : 'Party broadcast'
  const armedTargets = selectedTargets.length
    ? selectedTargets
    : partyTargetIds.map((id) => agentById.get(id)).filter((a): a is OpenClawAgent => Boolean(a))
  const thinkingCount = armedTargets.filter((agent) => agent.runtimePolicy?.thinkingDefault && agent.runtimePolicy.thinkingDefault !== 'off').length
  const runnableArmedTargets = useMemo(
    () => armedTargets.filter((agent) => !busyAgentIds.includes(agent.id)),
    [armedTargets, busyAgentIds],
  )
  const allTargetsBusy = targetCount > 0 && armedTargets.length > 0 && runnableArmedTargets.length === 0
  const hardBlockedSendReason = useMemo(() => {
    if (targetCount === 0) return 'Select at least one agent before sending.'
    if (!armedTargets.length) return 'No available agents are currently armed for this message.'
    return ''
  }, [armedTargets.length, targetCount])
  const queuedSendReason = useMemo(() => {
    if (hardBlockedSendReason || !allTargetsBusy) return ''
    if (armedTargets.length === 1) return agentBusyMessage(armedTargets[0])
    return 'Every addressed agent is already running. Send now to queue this turn until lanes are free.'
  }, [allTargetsBusy, armedTargets, hardBlockedSendReason])
  const voiceBusy = voicePhase !== 'idle'
  const canSend = Boolean(prompt.trim() || uploadedAttachment) && !isUploading && !voiceBusy && !hardBlockedSendReason
  const composerPlaceholder = hardBlockedSendReason || queuedSendReason || 'Message the agents...'
  const streamLabel: Record<ConsoleStreamState, string> = {
    connecting: 'Connecting',
    live: 'Live stream',
    reconnecting: 'Reconnecting',
    offline: 'Stream offline',
  }
  const streamTitle = [
    clawTalkStreamHealth.detail,
    clawTalkStreamHealth.retries > 0 ? `Reconnect attempts: ${clawTalkStreamHealth.retries}` : '',
  ].filter(Boolean).join(' ')
  const emptyTargetLabel = selectedTargets.length > 0
    ? `${selectedTargets.length} agent${selectedTargets.length === 1 ? '' : 's'} selected`
    : targetCount > 0
      ? `${targetCount} party agent${targetCount === 1 ? '' : 's'}`
      : 'No agents selected'
  const emptyStreamLabel = clawTalkStreamHealth.state === 'live'
    ? 'Live link idle'
    : streamLabel[clawTalkStreamHealth.state]
  const markPortraitFailed = useCallback((agentId: string, src: string) => {
    if (!src) return
    const key = portraitFailureKey(agentId, src)
    setFailedPortraitKeys((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
  }, [])

  useEffect(() => {
    if (!busyAgentIds.length && queuedResponseCount === 0) return
    const timer = window.setInterval(() => setLaneDiagnosticNow(Date.now()), LANE_DIAGNOSTIC_TICK_MS)
    return () => window.clearInterval(timer)
  }, [busyAgentIds.length, queuedResponseCount])

  useEffect(() => {
    let disposed = false
    let lastStreamEventAt = 0
    let retryTimer: number | null = null
    let resolveRetry: (() => void) | null = null
    const controller = new AbortController()

    const finishRetryWait = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
      const resolve = resolveRetry
      resolveRetry = null
      resolve?.()
    }

    const waitForRetry = (delayMs: number) => new Promise<void>((resolve) => {
      resolveRetry = resolve
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        resolveRetry = null
        resolve()
      }, delayMs)
    })

    const handleFrame = (data: string) => {
      lastStreamEventAt = Date.now()
      setClawTalkStreamHealth((current) => (
        current.state === 'live'
          ? current
          : {
              state: 'live',
              detail: 'Receiving ClawTalk console events.',
              retries: 0,
            }
      ))
      try {
        ingestClawTalkConsoleEvent(JSON.parse(data))
      } catch {
        // The console stream is best-effort; malformed frames should not break chat.
      }
    }

    const connect = async () => {
      let retries = 0
      while (!disposed) {
        const streamController = new AbortController()
        const abortStream = () => streamController.abort(controller.signal.reason)
        controller.signal.addEventListener('abort', abortStream, { once: true })
        try {
          const response = await fetch(apiUrl('/api/openclaw/clawtalk-console/stream'), {
            cache: 'no-store',
            headers: { Accept: 'text/event-stream' },
            signal: streamController.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          if (!response.body) throw new Error('Stream response did not include a readable body.')

          retries = 0
          setClawTalkStreamHealth({
            state: 'live',
            detail: 'ClawTalk console stream connected.',
            retries,
          })

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          const parser = createSseFrameParser()
          const processFrames = (chunk: string) => {
            for (const frame of parser.push(chunk)) handleFrame(frame.data)
          }

          try {
            while (!disposed) {
              const { done, value } = await reader.read()
              if (done) break
              processFrames(decoder.decode(value, { stream: true }))
            }
            processFrames(decoder.decode())
            for (const frame of parser.flush()) handleFrame(frame.data)
          } finally {
            await reader.cancel().catch(() => undefined)
          }

          if (!disposed) throw new Error('ClawTalk console stream ended.')
        } catch (error) {
          if (disposed || controller.signal.aborted || streamController.signal.aborted) return
          retries += 1
          const lastSeen = lastStreamEventAt ? formatShortElapsed(Date.now() - lastStreamEventAt) : ''
          const detail = error instanceof Error ? redactDiagnosticText(error.message, 120) : redactDiagnosticText(String(error), 120)
          setClawTalkStreamHealth({
            state: retries >= 5 ? 'offline' : 'reconnecting',
            detail: lastSeen
              ? `ClawTalk console stream interrupted (${detail}); last event ${lastSeen} ago. Reconnecting automatically.`
              : `ClawTalk console stream interrupted before the first event (${detail}). Reconnecting automatically.`,
            retries,
          })
          await waitForRetry(Math.min(30_000, 1000 * retries))
        } finally {
          controller.signal.removeEventListener('abort', abortStream)
          streamController.abort()
        }
      }
    }

    void connect()

    return () => {
      disposed = true
      controller.abort()
      finishRetryWait()
    }
  }, [ingestClawTalkConsoleEvent])

  const restartGatewayFromMessage = useCallback((entryId: string) => {
    setMessageActionId(entryId)
    setMessageActionError('')
    void restartGatewayRuntime()
      .catch((error) => setMessageActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMessageActionId(''))
  }, [])

  const cancelQueuedTurnFromMessage = useCallback((entryId: string) => {
    setMessageActionId(entryId)
    setMessageActionError('')
    const cancelled = cancelQueuedCommandConsoleFollowup(entryId)
    if (!cancelled) {
      setMessageActionError('Queued turn already started or is no longer cancellable.')
    }
    window.setTimeout(() => setMessageActionId((current) => current === entryId ? '' : current), 250)
  }, [cancelQueuedCommandConsoleFollowup])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (!stickToBottomRef.current) return

    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })

    return () => window.cancelAnimationFrame(frame)
  }, [visibleDisplayedResponses])

  const handleMessageScroll = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    stickToBottomRef.current = distanceFromBottom < 120
  }, [])

  const resizeComposerTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const maxHeight = Math.max(180, Math.min(280, Math.floor(window.innerHeight * 0.34)))
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeComposerTextarea()
  }, [prompt, resizeComposerTextarea])

  useEffect(() => {
    window.addEventListener('resize', resizeComposerTextarea)
    return () => window.removeEventListener('resize', resizeComposerTextarea)
  }, [resizeComposerTextarea])

  useEffect(() => {
    const syncSpeechSettings = () => setSpeechSettings(readSpeechSettings())
    window.addEventListener(SPEECH_SETTINGS_CHANGED_EVENT, syncSpeechSettings)
    window.addEventListener('storage', syncSpeechSettings)
    return () => {
      window.removeEventListener(SPEECH_SETTINGS_CHANGED_EVENT, syncSpeechSettings)
      window.removeEventListener('storage', syncSpeechSettings)
    }
  }, [])

  const clearVoiceTimers = useCallback(() => {
    if (recordingTickRef.current !== null) window.clearInterval(recordingTickRef.current)
    if (recordingLimitRef.current !== null) window.clearTimeout(recordingLimitRef.current)
    voiceActivityCleanupRef.current?.()
    recordingTickRef.current = null
    recordingLimitRef.current = null
    voiceActivityCleanupRef.current = null
    paintVoiceWaveform(voiceWaveformRef.current, 0)
  }, [])

  const stopMicrophoneTracks = useCallback(() => {
    for (const track of mediaStreamRef.current?.getTracks() || []) track.stop()
    mediaStreamRef.current = null
  }, [])

  useEffect(() => {
    voiceMountedRef.current = true
    return () => {
      voiceMountedRef.current = false
      clearVoiceTimers()
      if (voiceStatusClearRef.current !== null) window.clearTimeout(voiceStatusClearRef.current)
      const recorder = mediaRecorderRef.current
      if (recorder?.state === 'recording') recorder.stop()
      stopMicrophoneTracks()
    }
  }, [clearVoiceTimers, stopMicrophoneTracks])

  const localSpeechProgress = useCallback((progress: LocalSpeechProgress) => {
    if (!voiceMountedRef.current) return
    const backendLabel = progress.backend === 'webgpu' ? 'GPU' : 'CPU'
    if (progress.phase === 'loading') {
      const percentage = progress.progress === undefined ? '' : ` ${Math.round(progress.progress)}%`
      setVoiceStatus(`Preparing local speech${percentage} · ${backendLabel}`)
      return
    }
    if (progress.phase === 'transcribing') {
      setVoiceStatus(`Transcribing on device · ${backendLabel}`)
      return
    }
    setVoiceStatus(mediaRecorderRef.current?.state === 'recording'
      ? `Listening · local ${backendLabel} ready`
      : `Local ${backendLabel} ready`)
  }, [])

  const appendVoiceTranscript = useCallback((transcript: string) => {
    const cleanTranscript = transcript.trim()
    if (!cleanTranscript) throw new Error('No speech was recognized. Try again a little closer to the microphone.')
    const current = promptRef.current
    const separator = current && !/\s$/.test(current) ? ' ' : ''
    setPrompt(`${current}${separator}${cleanTranscript}`)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [setPrompt])

  const settleVoiceStatus = useCallback((status: string) => {
    setVoiceStatus(status)
    if (voiceStatusClearRef.current !== null) window.clearTimeout(voiceStatusClearRef.current)
    voiceStatusClearRef.current = window.setTimeout(() => {
      if (voiceMountedRef.current && mediaRecorderRef.current?.state !== 'recording') setVoiceStatus('')
      voiceStatusClearRef.current = null
    }, 4_000)
  }, [])

  useEffect(() => {
    if (speechMode !== 'local') return
    let disposed = false
    const timer = window.setTimeout(() => {
      void prepareLocalSpeechModel((progress) => {
        if (!disposed) localSpeechProgress(progress)
      }).catch(() => {
        if (!disposed && mediaRecorderRef.current?.state !== 'recording') {
          setVoiceStatus('Local speech will prepare when you tap the mic')
        }
      })
    }, 450)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [localSpeechProgress, speechMode])

  const transcribeVoiceBlob = useCallback(async (blob: Blob, mode: SpeechTranscriptionMode) => {
    if (!voiceMountedRef.current) return
    setVoicePhase('processing')
    setVoiceError('')
    try {
      if (mode === 'local') {
        setVoiceStatus('Preparing audio for on-device transcription')
        const audio = await decodeAudioToMono16Khz(blob)
        const result = await transcribeAudioLocally(audio, localSpeechProgress)
        if (!voiceMountedRef.current) return
        appendVoiceTranscript(result.text)
        settleVoiceStatus(`Transcript added · local ${result.backend === 'webgpu' ? 'GPU' : 'CPU'}`)
      } else {
        setVoiceStatus('Transcribing securely with OpenAI')
        const result = await apiRequest<OnlineSpeechTranscriptionPayload>(
          `/api/speech/transcribe?filename=${encodeURIComponent(voiceRecordingFileName(blob.type))}`,
          {
            method: 'POST',
            timeoutMs: 90_000,
            headers: { 'Content-Type': blob.type || 'audio/webm' },
            body: blob,
          },
        )
        if (!result.ok) throw new Error(apiErrorMessage(result.error))
        if (!voiceMountedRef.current) return
        appendVoiceTranscript(result.data.text)
        settleVoiceStatus('Transcript added · online accuracy')
      }
    } catch (error) {
      if (!voiceMountedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      const localSetupHint = mode === 'local' && /fetch|network|load|download/i.test(message)
        ? ' Local speech needs internet once to download its model; after that it stays cached and runs offline.'
        : ''
      setVoiceError(`${message}${localSetupHint}`)
      setVoiceStatus('')
    } finally {
      if (voiceMountedRef.current) setVoicePhase('idle')
    }
  }, [appendVoiceTranscript, localSpeechProgress, settleVoiceStatus])

  const stopVoiceRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    clearVoiceTimers()
    setVoiceStatus('Finishing voice input')
    recorder.stop()
  }, [clearVoiceTimers])

  const startVoiceRecording = useCallback(async () => {
    if (voicePhase !== 'idle') return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice input is not supported by this browser or desktop runtime.')
      return
    }

    if (voiceStatusClearRef.current !== null) window.clearTimeout(voiceStatusClearRef.current)
    voiceStatusClearRef.current = null
    setVoiceError('')
    setVoiceStatus('Requesting microphone access')
    setVoicePhase('requesting')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: speechSettings.echoCancellation,
          noiseSuppression: speechSettings.noiseSuppression,
          autoGainControl: speechSettings.autoGainControl,
        },
        video: false,
      })
      if (!voiceMountedRef.current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      mediaStreamRef.current = stream
      recordingChunksRef.current = []
      recordingDiscardReasonRef.current = ''
      const mimeType = preferredRecordingMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined)
      mediaRecorderRef.current = recorder
      const recordingMode = speechMode
      const recordingSettings = speechSettings

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      })
      recorder.addEventListener('error', (event) => {
        if (!voiceMountedRef.current) return
        setVoiceError(friendlyMicrophoneError((event as ErrorEvent).error))
        setVoicePhase('idle')
        clearVoiceTimers()
        stopMicrophoneTracks()
      })
      recorder.addEventListener('stop', () => {
        clearVoiceTimers()
        stopMicrophoneTracks()
        mediaRecorderRef.current = null
        const durationMs = Math.max(0, Date.now() - recordingStartedAtRef.current)
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        recordingChunksRef.current = []
        const discardReason = recordingDiscardReasonRef.current
        recordingDiscardReasonRef.current = ''
        if (!voiceMountedRef.current) return
        if (discardReason) {
          setVoiceError(discardReason)
          setVoiceStatus('')
          setVoicePhase('idle')
          return
        }
        if (durationMs < 350 || !blob.size) {
          setVoiceError('The voice recording was too short. Hold the thought for a moment, then press stop.')
          setVoiceStatus('')
          setVoicePhase('idle')
          return
        }
        void transcribeVoiceBlob(blob, recordingMode)
      }, { once: true })

      recorder.start(250)
      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)
      setVoicePhase('recording')
      setVoiceStatus(recordingMode === 'local' ? 'Listening · audio stays on device' : 'Listening · Online mode')
      recordingTickRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
      }, 1_000)
      recordingLimitRef.current = window.setTimeout(() => stopVoiceRecording(), recordingSettings.maxRecordingSeconds * 1_000)

      try {
        voiceActivityCleanupRef.current = monitorVoiceActivity(stream, {
          onLevel: (level) => paintVoiceWaveform(voiceWaveformRef.current, level),
          onSpeechStart: () => {
            if (!voiceMountedRef.current || recorder.state !== 'recording') return
            setVoiceStatus(recordingMode === 'local'
              ? 'Voice detected · pause to transcribe locally'
              : 'Voice detected · pause to transcribe online')
          },
          onSilence: () => {
            if (!voiceMountedRef.current || recorder.state !== 'recording') return
            setVoiceStatus('Pause detected · transcribing')
            stopVoiceRecording()
          },
          onNoSpeech: () => {
            if (!voiceMountedRef.current || recorder.state !== 'recording') return
            recordingDiscardReasonRef.current = 'No speech was detected. Check the selected microphone and try again.'
            stopVoiceRecording()
          },
        }, {
          autoStop: recordingSettings.autoStop,
          pauseDurationMs: recordingSettings.pauseDurationMs,
        })
      } catch {
        setVoiceStatus(`${recordingMode === 'local' ? 'Listening locally' : 'Listening online'} · tap stop when finished`)
      }

      if (recordingMode === 'local') {
        void prepareLocalSpeechModel(localSpeechProgress).catch((error) => {
          if (!voiceMountedRef.current || mediaRecorderRef.current?.state !== 'recording') return
          const message = error instanceof Error ? error.message : String(error)
          setVoiceStatus(`Listening · local model setup will retry (${redactDiagnosticText(message, 80)})`)
        })
      }
    } catch (error) {
      stopMicrophoneTracks()
      if (!voiceMountedRef.current) return
      setVoiceError(friendlyMicrophoneError(error))
      setVoiceStatus('')
      setVoicePhase('idle')
    }
  }, [clearVoiceTimers, localSpeechProgress, speechMode, speechSettings, stopMicrophoneTracks, stopVoiceRecording, transcribeVoiceBlob, voicePhase])

  const buildMessage = (draftPrompt: string, attachments: AgentTurnAttachment[]): string => {
    const base = draftPrompt.trim() || 'Analyze the attached file.'
    if (!attachments.length) return base
    const list = attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`).join('\n')
    return `${base}\n\nAttached file(s):\n${list}`
  }

  const clearInput = () => {
    removeCommandConsoleDraft(draftStorageKey)
    promptRef.current = ''
    setPromptDraft({ storageKey: draftStorageKey, value: '' })
    setUploadedAttachment(null)
    setUploadError('')
  }

  const compressImageForUpload = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_200_000) return file
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
  }

  const uploadAttachment = async (file: File): Promise<AgentTurnAttachment> => {
    const uploadFile = await compressImageForUpload(file)
    const result = await apiRequest<CommandConsoleUploadPayload>(`/api/files/upload?name=${encodeURIComponent(uploadFile.name)}&mimeType=${encodeURIComponent(uploadFile.type || 'application/octet-stream')}`, {
      method: 'POST',
      timeoutMs: 90_000,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Type': uploadFile.type || 'application/octet-stream',
      },
      body: uploadFile,
    })
    if (!result.ok) throw new Error(apiErrorMessage(result.error))
    if (!result.data.attachment) throw new Error('Upload finished without an attachment record.')
    return result.data.attachment
  }

  const handleSend = async () => {
    const draftPrompt = prompt
    if (!draftPrompt.trim() && !uploadedAttachment) return
    if (isUploading) return
    setUploadError('')
    setMessageActionError('')
    if (voiceBusy) {
      setMessageActionError('Finish voice input before sending this message.')
      return
    }
    if (hardBlockedSendReason) {
      setMessageActionError(hardBlockedSendReason)
      return
    }
    if (queuedSendReason) setMessageActionError('Queued turn will start automatically when the addressed lane is free.')

    const attachmentFingerprint = uploadedAttachment
      ? `${uploadedAttachment.file.name}:${uploadedAttachment.file.size}:${uploadedAttachment.file.lastModified}`
      : ''
    const sendFingerprint = `${draftRouteKey}\u0000${draftPrompt}\u0000${attachmentFingerprint}`
    if (lastSendAttemptRef.current === sendFingerprint) return
    lastSendAttemptRef.current = sendFingerprint
    window.setTimeout(() => {
      if (lastSendAttemptRef.current === sendFingerprint) lastSendAttemptRef.current = ''
    }, 1_500)

    setIsUploading(true)
    let attachments: AgentTurnAttachment[] = []
    try {
      attachments = uploadedAttachment ? [await uploadAttachment(uploadedAttachment.file)] : []
    } catch (error) {
      setUploadError(String(error))
      setIsUploading(false)
      if (lastSendAttemptRef.current === sendFingerprint) lastSendAttemptRef.current = ''
      return
    }
    const msg = buildMessage(draftPrompt, attachments)
    setIsUploading(false)
    stickToBottomRef.current = true
    if (selectedTargets.length === 1) {
      clearInput()
      await sendPromptToAgent(selectedTargets[0].id, msg, attachments)
    } else if (selectedTargets.length > 1) {
      clearInput()
      await sendPromptToSelectedAgents(msg, attachments)
    } else {
      if (!partyTargetIds.length) return
      const trimmed = draftPrompt.trim().toLowerCase()

      const multi = draftPrompt.match(/(?:^|\n)\s*(?:\d+|#\d+|slot\s*\d+|agent\s*\d+|@[a-z0-9_-]+)\s*[:-]\s+/gim)
      if (multi && multi.length > 1) {
        clearInput()
        await sendPromptToActiveParty(msg, attachments)
        return
      }

      const slotMatch = trimmed.match(/(?:^|\b)(?:slot\s*|agent\s*|#)\s*(\d+)/i)
        || trimmed.match(/^\s*(\d+)\s*[:-]/)
      if (slotMatch) {
        const idx = Number(slotMatch[1]) - 1
        if (idx >= 0 && idx < partyTargetIds.length) {
          clearInput()
          await sendPromptToAgent(partyTargetIds[idx], msg, attachments)
          return
        }
      }

      const party = partyTargetIds.map((id) => agentById.get(id)).filter(Boolean) as OpenClawAgent[]
      for (const agent of party) {
        const names = [agent.name.toLowerCase(), agent.id.toLowerCase(), agent.id.replace(/^hn-/, '').toLowerCase()]
        if (names.some((n) => trimmed.includes(n))) {
          clearInput()
          await sendPromptToAgent(agent.id, msg, attachments)
          return
        }
      }

      clearInput()
      await sendPromptToActiveParty(msg, attachments)
    }
  }

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    if (!file.type.startsWith('image/')) {
      setUploadedAttachment({ file, preview: '', kind: pendingAttachmentKind(file) })
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setUploadedAttachment({ file, preview: reader.result as string, kind: 'image' })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const removeAttachment = () => { setUploadedAttachment(null); setUploadError('') }

  const handleStopRunning = useCallback(() => {
    setMessageActionError('')
    const stopped = stopActiveAgentRuns(busyAgents.map((agent) => agent.id))
    if (stopped === 0) {
      setMessageActionError('No cancellable Command Console runs are active.')
    }
  }, [busyAgents, stopActiveAgentRuns])

  const hidePartyTargetFromChat = (agentId: string) => {
    setChatRemovedPartyIds((current) => {
      const activeRemovals = current.filter((id) => basePartyTargetIds.includes(id))
      return activeRemovals.includes(agentId) ? activeRemovals : [...activeRemovals, agentId]
    })
  }

  const removeAgentFromChat = (agentId: string) => {
    if (selectedTargets.length) {
      if (basePartyTargetIds.includes(agentId)) hidePartyTargetFromChat(agentId)
      selectAgent(agentId, { toggle: true })
      return
    }
    hidePartyTargetFromChat(agentId)
  }

  const handleTargetKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>, agentId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    removeAgentFromChat(agentId)
  }

  return (
    <section
      data-dui-panel="command-console"
      data-chat-panel="true"
      className="dy-command-console flex min-h-0 flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="dy-command-console__header relative shrink-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />
        <div className="dy-command-console__header-inner">
          <div className="dy-command-console__title-row min-w-0">
            <span className="dy-command-console__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 8 4 4-4 4" />
                <path d="M12 16h6" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="dy-command-console__title">
                Command Console
              </h2>
              <p className="dy-command-console__subtitle">
                {targetMode} / {targetCount} lane{targetCount === 1 ? '' : 's'} / {thinkingCount ? `${thinkingCount} thinking` : 'fast runtime'}
              </p>
            </div>
          </div>
          <div className="dy-command-console__meta">
            <span className="dy-command-console__stat" title="Console messages">
              <strong>{responses.length}</strong>
              <span>Msgs</span>
            </span>
            {queuedResponseCount > 0 && (
              <span className="dy-command-console__stat" title="Queued Command Console follow-ups">
                <strong>{queuedResponseCount}</strong>
                <span>Queued</span>
              </span>
            )}
            <StatusChip
              label="Stream"
              value={streamLabel[clawTalkStreamHealth.state]}
              state={clawTalkStreamHealth.state}
              tone={clawTalkStreamHealth.state === 'live' ? 'success' : clawTalkStreamHealth.state === 'offline' ? 'error' : 'warning'}
              className="dy-command-console__pill dy-command-console__stream-pill"
              data-stream-state={clawTalkStreamHealth.state}
              title={streamTitle}
              role="status"
              live
              showDot
              aria-label={`ClawTalk console stream ${streamLabel[clawTalkStreamHealth.state].toLowerCase()}. ${clawTalkStreamHealth.detail}`}
            />
            <StatusChip
              label="Gateway"
              value={gatewayStabilityChipLabel}
              state={gatewayStabilityChipState}
              tone={gatewayStabilityChipState === 'healthy' ? 'success' : gatewayStabilityChipState === 'offline' ? 'error' : gatewayStabilityChipState === 'warning' ? 'warning' : 'neutral'}
              className="dy-command-console__pill dy-command-console__stability-pill"
              data-stability-state={gatewayStabilityChipState}
              title={gatewayStabilityTitleText}
              role="status"
              live
              showDot
              aria-label={`Gateway diagnostics ${gatewayStabilityChipLabel}. ${gatewayStabilityTitleText}`}
            />
            {responses.length > 0 && (
              <IconButton
                onClick={clearAgentResponses}
                className="dy-command-console__clear"
                title="Clear messages and reset AI sessions"
                aria-label="Clear messages and reset AI sessions"
                variant="quiet"
                size="compact"
                icon={(
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="m6 6 1 14h10l1-14" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* Target bar */}
      {(selectedTargets.length > 0 || partyTargetIds.length > 0 || busyAgents.length > 0) && (
        <div className={`dy-command-target-bar shrink-0 ${selectedTargets.length ? 'is-selected-mode' : 'is-party-mode'}`}>
          <div className="dy-command-targets">
            <span className="dy-command-target-label">
              {selectedTargets.length ? 'TO' : 'PARTY'}
            </span>
            {armedTargets.map((agent) => {
              const inParty = activePartyIds.includes(agent.id)
              const rarity = agent.rarity ?? 'common'
              const ringColor = rarity === 'legendary'
                ? 'ring-amber-400/60'
                : rarity === 'epic'
                  ? 'ring-[#9475ae]/50'
                  : rarity === 'rare'
                    ? 'ring-[#7097aa]/45'
                    : 'ring-white/15'
              const portraitSrc = portraitSrcForAgent(agent)
              const portraitFailed = portraitSrc ? failedPortraitKeys.has(portraitFailureKey(agent.id, portraitSrc)) : false
              const queuedForAgent = queuedResponsesByAgent.get(agent.id) || 0
              const laneDiagnostic = laneDiagnosticsByAgent.get(agent.id)
              return (
                <span
                  key={agent.id}
                  draggable={!missionRunning}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/agent-id', agent.id)
                    e.dataTransfer.effectAllowed = 'copyMove'
                  }}
                  onClick={() => removeAgentFromChat(agent.id)}
                  onKeyDown={(event) => handleTargetKeyDown(event, agent.id)}
                  role="button"
                  tabIndex={0}
                  title={`${laneDiagnostic ? `${laneDiagnostic.title} ` : ''}${queuedForAgent ? `${queuedForAgent} queued Command Console follow-up${queuedForAgent === 1 ? '' : 's'}. ` : ''}Remove ${agent.name} from chat`}
                  data-lane-diagnostic={laneDiagnostic?.severity || undefined}
                  data-agent-rarity={rarity}
                  data-target-mode={selectedTargets.length ? 'selected' : inParty ? 'party' : 'armed'}
                  className={`dy-command-target-chip group/chip inline-flex items-center gap-1.5 ${
                    selectedTargets.length
                      ? 'is-selected border-cyan-400/20 bg-cyan-400/[0.04] text-white/95 hover:border-cyan-300/40 hover:bg-cyan-300/[0.09]'
                      : inParty
                      ? 'is-party border-slate-400/20 bg-white/[0.04] text-slate-200/90 hover:border-slate-300/35 hover:bg-white/[0.07]'
                      : 'is-armed border-cyan-400/20 bg-cyan-400/[0.04] text-cyan-200/90 hover:border-cyan-400/40 hover:bg-cyan-400/[0.10]'
                  }`}
                >
                  <div className={`dy-command-target-avatar h-5 w-5 shrink-0 overflow-hidden ring-1 ${ringColor}`}>
                    {portraitSrc && !portraitFailed ? (
                      <img
                        src={portraitSrc}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => markPortraitFailed(agent.id, portraitSrc)}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-slate-800 text-[11px] font-bold text-slate-300">
                        {initials(agent.name)}
                      </span>
                    )}
                  </div>
                  <span className="truncate max-w-[100px]">{agent.name}</span>
                  {queuedForAgent > 0 && (
                    <span
                      className="dy-command-target-queue"
                      aria-label={`${queuedForAgent} queued Command Console follow-up${queuedForAgent === 1 ? '' : 's'} for ${agent.name}`}
                      title={`${queuedForAgent} queued Command Console follow-up${queuedForAgent === 1 ? '' : 's'} for ${agent.name}`}
                    >
                      {queuedForAgent}
                    </span>
                  )}
                  {laneDiagnostic && (
                    <span
                      className="dy-command-target-stale"
                      data-severity={laneDiagnostic.severity}
                      aria-label={laneDiagnostic.title}
                      title={laneDiagnostic.title}
                    >
                      {laneDiagnostic.severity === 'stalled' ? 'stalled' : 'quiet'} {laneDiagnostic.quietLabel}
                    </span>
                  )}
                  <button
                    type="button"
                    className="dy-command-target-remove group-hover/chip:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeAgentFromChat(agent.id)
                    }}
                    title={`Remove ${agent.name} from chat`}
                    aria-label={`Remove ${agent.name} from chat`}
                  >
                      ×
                  </button>
                </span>
              )
            })}
            {busyAgents.length > 0 && (
              <span className="dy-command-busy ml-auto inline-flex items-center gap-1.5">
                <span
                  className="dy-command-busy-status inline-flex items-center gap-1.5"
                  role="status"
                  aria-live="polite"
                  aria-label={busyRunLabel}
                >
                  <span className="dy-command-busy-dot h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
                  <span className="dy-command-busy-count" aria-hidden="true">{busyAgents.length}</span>
                  <span className="dy-command-busy-label" aria-hidden="true">running</span>
                </span>
                {laneDiagnostics.length > 0 && (
                  <span
                    className="dy-command-busy-warning"
                    data-severity={laneDiagnostics.some((diagnostic) => diagnostic.severity === 'stalled') ? 'stalled' : 'quiet'}
                    role="status"
                    aria-live="polite"
                    aria-label={`${laneDiagnostics.length} Command Console lane${laneDiagnostics.length === 1 ? '' : 's'} quiet while queued follow-ups are waiting.`}
                    title={laneDiagnostics.map((diagnostic) => diagnostic.title).join(' ')}
                  >
                    {laneDiagnostics.length} quiet
                  </span>
                )}
                <Button
                  className="dy-command-stop-run"
                  onClick={handleStopRunning}
                  aria-label={`Stop ${busyAgents.length} running Command Console ${busyAgents.length === 1 ? 'run' : 'runs'}`}
                  title="Stop running turns"
                  variant="danger"
                  size="compact"
                >
                  Stop
                </Button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={listRef}
        onScroll={handleMessageScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Command console responses"
        className="dy-command-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden space-y-3"
        data-empty={visibleDisplayedResponses.length === 0 ? 'true' : 'false'}
      >
        {visibleDisplayedResponses.length === 0 && (
          <div className="dy-command-idle-hint" aria-label="Command console is standing by">
            <p className="dy-command-idle-hint__title">Standing by</p>
            <p className="dy-command-idle-hint__target">{emptyTargetLabel}</p>
            <p className="dy-command-idle-hint__stream">{emptyStreamLabel}</p>
          </div>
        )}
        {visibleDisplayedResponses.map((entry) => {
          const meta = agentMetaById.get(entry.agentId)
          const avatar = meta?.portrait || ''
          const avatarFailed = avatar ? failedPortraitKeys.has(portraitFailureKey(entry.agentId, avatar)) : false
          return (
            <ResponseMessage
              key={entry.id}
              entry={entry}
              meta={meta}
              avatarFailed={avatarFailed}
              onPortraitFailed={markPortraitFailed}
              onRestartGateway={restartGatewayFromMessage}
              onCancelQueuedTurn={cancelQueuedTurnFromMessage}
              actionBusy={messageActionId === entry.id}
            />
          )
        })}
      </div>

      {uploadError && (
        <div className="dy-command-upload-error shrink-0">
          {uploadError}
        </div>
      )}
      {messageActionError && (
        <div className="dy-command-upload-error shrink-0">
          {messageActionError}
        </div>
      )}
      {voiceError && (
        <div className="dy-command-voice-error shrink-0" role="alert">
          {voiceError}
        </div>
      )}
      {/* Input area */}
      <div className="dy-command-composer shrink-0">
        <div
          className="dy-command-composer__row"
          data-has-draft={prompt.trim() ? 'true' : 'false'}
          data-has-attachment={uploadedAttachment ? 'true' : 'false'}
        >
          {uploadedAttachment && (
            <div className="dy-command-upload-preview shrink-0">
              <div className="relative inline-flex max-w-full items-center gap-3">
                {uploadedAttachment.preview ? (
                  <img
                    src={uploadedAttachment.preview}
                    alt="Attachment preview"
                    className="h-16 max-w-[200px] rounded-xl border border-white/[0.08] object-cover shadow-lg"
                  />
                ) : (
                  <div
                    className="dy-command-attachment-card flex h-16 min-w-0 max-w-[260px] items-center gap-3 rounded-xl border border-white/[0.06] bg-slate-950/60 px-3 text-slate-300"
                    data-kind={uploadedAttachment.kind}
                  >
                    <span className="dy-command-attachment-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
                        <path d="M14 2v5h5" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-slate-200">{uploadedAttachment.file.name}</span>
                      <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        {attachmentKindLabel(uploadedAttachment.kind, uploadedAttachment.file)}
                      </span>
                    </span>
                  </div>
                )}
                <IconButton
                  onClick={removeAttachment}
                  aria-label={`Remove attached file ${uploadedAttachment.file.name}`}
                  className="dy-command-upload-remove absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center"
                  title="Remove attachment"
                  variant="danger"
                  size="compact"
                  icon={(
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                  )}
                />
              </div>
              <span className="dy-command-upload-size">
                {formatFileSize(uploadedAttachment.file.size)}
              </span>
            </div>
          )}

          {/* Text input */}
          <div className="dy-command-composer__field relative flex-1">
            <textarea
              ref={textareaRef}
              value={prompt}
              aria-label="Command console message"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={composerPlaceholder}
              rows={1}
              data-run-status={hardBlockedSendReason ? 'blocked' : queuedSendReason ? 'queued' : busyAgents.length ? 'active' : 'idle'}
              className="dy-command-textarea w-full resize-none outline-none"
            />
          </div>

          <div className="dy-command-composer__toolbar">
            <div className="dy-command-composer__tools">
              <IconButton
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                className="dy-command-icon-button flex h-10 w-10 shrink-0 items-center justify-center"
                title="Attach file"
                variant="quiet"
                icon={(
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                )}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={COMMAND_CONSOLE_ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={handleAttachmentUpload}
              />
              {voiceStatus && (
                <span
                  className="dy-command-voice-status"
                  data-phase={voicePhase}
                  role="status"
                  aria-live="polite"
                >
                  {voicePhase === 'recording' ? (
                    <>
                      <span className="dy-command-voice-status__label">Listening</span>
                      <span ref={voiceWaveformRef} className="dy-command-voice-waveform" aria-hidden="true">
                        <i /><i /><i /><i /><i /><i /><i />
                      </span>
                      <time aria-label={`${recordingSeconds} seconds recorded`}>
                        {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`}
                      </time>
                    </>
                  ) : (
                    <span>{voiceStatus}</span>
                  )}
                </span>
              )}
            </div>

            <div className="dy-command-composer__actions">
              <IconButton
                aria-label={voicePhase === 'recording' ? 'Stop recording and transcribe' : 'Start voice dictation'}
                disabled={voicePhase === 'requesting' || voicePhase === 'processing' || isUploading}
                onClick={() => voicePhase === 'recording' ? stopVoiceRecording() : void startVoiceRecording()}
                className="dy-command-voice flex h-10 w-10 shrink-0 items-center justify-center"
                data-phase={voicePhase}
                data-mode={speechMode}
                title={voicePhase === 'recording'
                  ? 'Stop and transcribe now · otherwise pause and it will stop automatically'
                  : voicePhase === 'processing'
                    ? 'Transcribing voice input'
                    : speechMode === 'local'
                      ? 'Speak to your agents · local transcription (change mode in Settings)'
                      : 'Speak to your agents · cloud transcription (change mode in Settings)'}
                variant="quiet"
                icon={voicePhase === 'requesting' || voicePhase === 'processing' ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" strokeDasharray="28 28" strokeLinecap="round" />
                  </svg>
                ) : voicePhase === 'recording' ? (
                  <svg className="dy-command-voice-stop" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
                  </svg>
                )}
              />

              {/* Send button */}
              <IconButton
                aria-label="Send message"
                disabled={!canSend}
                onClick={() => void handleSend()}
                className="dy-command-send flex h-10 w-10 shrink-0 items-center justify-center"
                title={voiceBusy ? 'Finish voice input before sending' : isUploading ? 'Uploading attachment' : hardBlockedSendReason || queuedSendReason || 'Send (Enter)'}
                icon={isUploading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

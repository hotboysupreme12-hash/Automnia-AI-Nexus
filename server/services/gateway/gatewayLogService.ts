import { createHash } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

export type GatewayChannelDirection = 'inbound' | 'outbound' | 'system'

export type GatewayLogEntry = {
  id: number
  timestamp: string
  stream: 'stdout' | 'stderr' | 'lifecycle' | 'gateway' | 'channel'
  message: string
  level?: string
  source?: string
  channel?: string
  direction?: GatewayChannelDirection
}

export type GatewayChannelActivity = {
  id: number
  timestamp: string
  channel: string
  direction: GatewayChannelDirection
  message: string
  level?: string
  source?: string
  agentId?: string
}

export type GatewayActivitySummary = {
  active: boolean
  lastEventAt: string | null
  sourcePath: string | null
  inboundCount: number
  outboundCount: number
  systemCount: number
  events: GatewayChannelActivity[]
}

export type GatewayLogClient = {
  request: (method: string, params?: unknown, options?: { timeoutMs?: number | null; signal?: AbortSignal }) => Promise<unknown>
}

type GatewayLogFilesystem = Pick<typeof nodeFs, 'stat' | 'readdir' | 'open'>

type GatewayLogTailSnapshot = {
  statKey: string
  signature: string
  entries: GatewayLogEntry[]
}

export type GatewayLogServiceOptions = {
  openClawGatewayLogPath: string
  openClawStateRoot: string
  nativeOpenClawStateRoot: string
  controlCenterStartedAtMs: number
  readOpenclawConfig: () => Promise<unknown>
  getGatewayClient: () => GatewayLogClient | null
  appendGatewayLogEntry: (entry: GatewayLogEntry) => Promise<void> | void
  getGatewayLastStartedAt: () => string | null
  getRuntimeMonitorClearedAtMs: () => number
  applyDiagnosticRedactions: (value: string) => string
  redactSensitiveText: (value: string) => string
  stripAnsi: (value: string) => string
  filesystem?: GatewayLogFilesystem
  now?: () => number
  logLimit?: number
  externalLogCacheMs?: number
  logTailMaxBytes?: number
  logFingerprintBytes?: number
  logPathDiscoveryCacheMs?: number
  includeSharedOpenClawTempLogs?: boolean
  sharedOpenClawTempLogDirs?: () => string[]
  rpcLogFailureNoticeMs?: number
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function objectStringField(value: Record<string, unknown>, key: string) {
  const raw = value[key]
  return typeof raw === 'string' ? raw : ''
}

function nestedMetaStringField(value: Record<string, unknown>, key: string) {
  const meta = value._meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ''
  const raw = (meta as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : ''
}

export function createGatewayLogService(options: GatewayLogServiceOptions) {
  const fs = options.filesystem ?? nodeFs
  const nowMs = options.now ?? (() => Date.now())
  const logLimit = options.logLimit ?? 180
  const externalLogCacheMs = options.externalLogCacheMs ?? Math.max(
    500,
    Math.min(10_000, Number(process.env.CONTROL_CENTER_GATEWAY_LOG_CACHE_MS || 2_000)),
  )
  const logTailMaxBytes = options.logTailMaxBytes ?? 600_000
  const logFingerprintBytes = options.logFingerprintBytes ?? 2048
  const logPathDiscoveryCacheMs = options.logPathDiscoveryCacheMs ?? Math.max(
    2_000,
    Math.min(60_000, Number(process.env.CONTROL_CENTER_GATEWAY_LOG_PATH_CACHE_MS || 30_000)),
  )
  const includeSharedOpenClawTempLogs = options.includeSharedOpenClawTempLogs
    ?? process.env.CONTROL_CENTER_INCLUDE_SHARED_OPENCLAW_TEMP_LOGS !== '0'
  const rpcLogFailureNoticeMs = options.rpcLogFailureNoticeMs ?? 60_000

  let gatewayLogSeq = 0
  const gatewayLogs: GatewayLogEntry[] = []
  let externalGatewayLogCache: { expiresAt: number; entries: GatewayLogEntry[] } | null = null
  let externalChannelActivityCache: { expiresAt: number; entries: GatewayLogEntry[] } | null = null
  let gatewayLogPathDiscoveryCache: { expiresAt: number; paths: string[] } | null = null
  let gatewayRpcLogFailureNotifiedAt = 0
  const gatewayLogTailSnapshots = new Map<string, GatewayLogTailSnapshot>()

  function redact(value: string) {
    return options.redactSensitiveText(value)
  }

  function stripAnsi(value: string) {
    return options.stripAnsi(value)
  }

  function compactGatewayLogMessage(value: string, max = 640) {
    const warningSign = String.fromCodePoint(0x26a0)
    const variationSelector = String.fromCodePoint(0xfe0f)
    const hammerAndWrench = String.fromCodePoint(0x1f6e0)
    const emDash = String.fromCodePoint(0x2014)
    const ellipsis = String.fromCodePoint(0x2026)
    const normalized = stripAnsi(value || '')
      .replace(/\r/g, '')
      .replaceAll(`${warningSign}${variationSelector}`, '')
      .replaceAll(warningSign, '')
      .replaceAll(`${hammerAndWrench}${variationSelector}`, '')
      .replaceAll(hammerAndWrench, '')
      .replaceAll(emDash, '-')
      .replaceAll(ellipsis, '...')
    const masked = options.applyDiagnosticRedactions(normalized)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return masked.length > max ? `${masked.slice(0, max - 1).trim()}...` : masked
  }

  function gatewayProviderLabel(value: string) {
    const match = value.match(/\b(openai|google|anthropic|deepseek|gemini|vertex)\s+embeddings\s+failed\b/i)
    if (!match) return 'Provider'
    const raw = match[1].toLowerCase()
    if (raw === 'openai') return 'OpenAI'
    if (raw === 'gemini') return 'Gemini'
    if (raw === 'vertex') return 'Vertex'
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }

  function summarizeEmbeddingProviderFailure(value: string) {
    const code = value.match(/\bembeddings\s+failed:\s*(\d{3})\b/i)?.[1] || 'error'
    const errorCode = value.match(/"code"\s*:\s*"([^"]+)"/i)?.[1]
    const errorType = value.match(/"type"\s*:\s*"([^"]+)"/i)?.[1]
    const suffix = errorCode && errorCode !== 'null'
      ? errorCode
      : errorType && errorType !== 'null'
        ? errorType
        : ''
    return `${gatewayProviderLabel(value)} embeddings returned ${code}${suffix ? ` ${suffix}` : ''}`
  }

  function isGatewaySessionLivenessDiagnostic(value: string) {
    const text = value.replace(/\s+/g, ' ').trim()
    return /^(?:long-running|stalled|stuck) session:\s+sessionId=/iu.test(text)
      || (/\bsession\.(?:long_running|stalled|stuck)\b/iu.test(text) && /\bqueueDepth=\d+\b/iu.test(text))
      || (/\bclassification=(?:long_running|stalled_agent_run|blocked_tool_call|stale_session_state)\b/iu.test(text) && /\bsession(?:Id|Key)=/u.test(text))
  }

  function isGatewayFailoverDecisionNoise(value: string) {
    const text = stripAnsi(value || '').replace(/\s+/g, ' ').trim()
    return /^(?:warn\s+)?(?:model fallback decision|embedded run failover decision)$/iu.test(text)
  }

  function isGatewayInternalDiagnosticMessage(value: string) {
    const text = stripAnsi(value || '').replace(/\s+/g, ' ').trim()
    return isGatewaySessionLivenessDiagnostic(text)
      || isGatewayFailoverDecisionNoise(text)
      || /^tool policy removed \d+ tool\(s\) via tools\.profile\b/iu.test(text)
      || /^incomplete turn detected:\s+runId=/iu.test(text)
      || /^\[clawtalk\]\s+CoreBridge:\s+Control Center stream unavailable,\s+falling back to embedded agent:/iu.test(text)
      || /^CoreBridge:\s+Control Center stream unavailable,\s+falling back to embedded agent:/iu.test(text)
      || /^\S{0,8}\s*res\s*\S{0,8}\s*(?:chat\.(?:history|message\.get)|logs\.tail)\b/iu.test(text)
      || /Gateway RPC completed:\s*logs\.tail\b/iu.test(text)
  }

  function displayDurationMs(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return ''
    const seconds = Math.round(ms / 1000)
    if (seconds < 90) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
  }

  function gatewayLogTokenValue(text: string, key: string) {
    const match = text.match(new RegExp(`\\b${key}=("[^"]*"|\\S+)`, 'iu'))
    if (!match) return ''
    return match[1].replace(/^"|"$/g, '').trim()
  }

  function summarizeCronProcessedError(value: string): { message: string; level: 'error' } | null {
    const text = stripAnsi(value || '').replace(/\s+/g, ' ').trim()
    if (!/^message processed:\s+channel=cron\b/iu.test(text) || !/\boutcome=error\b/iu.test(text)) return null
    const sessionKey = gatewayLogTokenValue(text, 'sessionKey')
    const agent = sessionKey.match(/^agent:([^:\s]+):cron:/iu)?.[1] || gatewayLogTokenValue(text, 'agent') || 'scheduled agent'
    const durationToken = gatewayLogTokenValue(text, 'duration')
    const duration = Number(durationToken.match(/\d+(?:\.\d+)?/u)?.[0] || NaN)
    const durationText = displayDurationMs(duration)
    const errorText = gatewayLogTokenValue(text, 'error')
    const commandType = /powershell|\.ps1\b/iu.test(errorText)
      ? 'PowerShell script'
      : /python\b|python\s+-/iu.test(errorText)
        ? 'Python helper'
        : 'scheduled command'
    return {
      message: `Cron run failed for ${agent}${durationText ? ` after ${durationText}` : ''}: ${commandType} exited with an error.`,
      level: 'error',
    }
  }

  function summarizeGatewayAuthRefreshFailure(value: string): { message: string; level: 'warning' | 'error' } | null {
    const text = stripAnsi(value || '').replace(/\s+/g, ' ').trim()
    if (/\bOAuth token refresh failed for openai\b.*\bOpenAI Codex token refresh failed\s*\(401\)/iu.test(text)
      || /\binvalid_refresh_token\b.*\b(?:OpenAI|Codex)\b/iu.test(text)) {
      return {
        message: 'OpenAI / Codex sign-in was rejected or revoked. Reconnect OpenAI / Codex before retrying memory sync or model calls.',
        level: 'error',
      }
    }
    if (!/\bauth refresh request timed out after 10s\b/iu.test(text)) return null
    const provider = gatewayLogTokenValue(text, 'provider') || gatewayLogTokenValue(text, 'modelProvider')
    const model = gatewayLogTokenValue(text, 'model') || gatewayLogTokenValue(text, 'modelId')
    const detail = [provider, model].filter(Boolean).join(' / ')
    const finalFailure = /errorCode=UNAVAILABLE|FailoverError|\blane task error\b/iu.test(text)
    return {
      message: `Model auth refresh timed out after 10s${detail ? ` (${detail})` : ''}. Reconnect the selected provider, then retry.`,
      level: finalFailure ? 'error' : 'warning',
    }
  }

  function cleanGatewayLogFragmentValue(value: string) {
    const trimmed = stripAnsi(value || '').trim().replace(/,$/u, '').trim()
    if (!trimmed) return ''
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed === 'string') return compactGatewayLogMessage(parsed)
      if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    } catch {
      // Log fragments are often JSON fields without their surrounding object.
    }
    return compactGatewayLogMessage(trimmed.replace(/^"|"$/gu, '').replace(/\\"/g, '"'))
  }

  function summarizeGatewayLogFragment(value: string): { message: string; level?: string } | null {
    const text = stripAnsi(value || '').trim()
    if (!text) return { message: '' }
    if (/^[{}[\],]+$/u.test(text)) return { message: '' }
    if (/^"?(?:issues|details|errors)"?\s*:\s*[[{]?\s*,?$/iu.test(text)) return { message: '' }
    if (/^"?(?:valid|ok)"?\s*:\s*(?:true|false|null)\s*,?$/iu.test(text)) return { message: '' }

    // Pino/console bridge records may be pretty-printed or torn at a tail
    // boundary. Those continuation lines contain runtime metadata rather than
    // a user-facing event, and used to fill the console with an unreadable
    // JSON blob such as runtimeVersion, hostname, and source-file details.
    if (/^"?(?:runtimeVersion|hostname|name|date|time|logLevelId|logLevelName|_meta|fileName|fileNameWithLine|fileColumn|fileLine|filePath|filePathWithLine|method)"?\s*:/iu.test(text)) {
      return { message: '' }
    }

    const field = text.match(/^"?(message|path|error|detail|reason)"?\s*:\s*(.+?)\s*,?$/iu)
    if (!field) return null

    const key = field[1].toLowerCase()
    const cleaned = cleanGatewayLogFragmentValue(field[2])
    if (!cleaned) return { message: '' }

    if (key === 'message') {
      const unsupportedKeys = Array.from(cleaned.matchAll(/"([^"]+)"/gu))
        .map((match) => match[1])
        .filter(Boolean)
      if (/invalid config\b/iu.test(cleaned) && unsupportedKeys.length) {
        return {
          message: `Invalid config: remove unsupported keys ${unsupportedKeys.join(', ')}.`,
          level: 'warning',
        }
      }
      return {
        message: cleaned.replace(/^invalid config:\s*/iu, 'Invalid config: '),
        level: /\b(?:invalid|failed|error|rejected)\b/iu.test(cleaned) ? 'warning' : undefined,
      }
    }

    if (key === 'path') {
      const label = /\.json\b/iu.test(cleaned)
        ? 'Config file'
        : /plugins\.entries\./iu.test(cleaned)
          ? 'Config path'
          : 'Path'
      return { message: `${label}: ${cleaned}` }
    }

    return {
      message: `${key[0].toUpperCase()}${key.slice(1)}: ${cleaned}`,
      level: key === 'error' ? 'error' : /\b(?:invalid|failed|error|rejected)\b/iu.test(cleaned) ? 'warning' : undefined,
    }
  }

  function normalizeGatewayLogDisplayMessage(value: string): { message: string; level?: string } {
    // Gateway child-process output is frequently Pino JSON. Extract its
    // message before applying the human-facing formatter so one model request
    // does not become an unreadable screen-width JSON record in the console.
    const compact = compactGatewayLogMessage(gatewayLogPayloadMessage(value))
    const withoutTimestamp = compact
      .replace(/^\[[^\]]+\]\s+\[(?:stdout|stderr|lifecycle|gateway|channel)\]\s+/iu, '')
      .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\[memory\]\s+/iu, 'memory ')
      .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\[[^\]]+\]\s+/iu, '')
      .replace(/^\[memory\]\s+/iu, 'memory ')
      .trim()

    const modelFetch = /\[model-fetch\]\s+response\s+provider=([^\s]+).*?\bmodel=([^\s]+).*?\bstatus=(\d{3}).*?\belapsedMs=(\d+)/iu.exec(withoutTimestamp)
    if (modelFetch) {
      const provider = modelFetch[1].replace(/[-_]+/gu, ' ')
      const model = modelFetch[2]
      const elapsedMs = Number(modelFetch[4])
      const duration = Number.isFinite(elapsedMs) ? displayDurationMs(elapsedMs) : ''
      const streamed = /\bcontentType=text\/event-stream\b/iu.test(withoutTimestamp)
      return {
        message: `Model response: ${provider} / ${model} completed${duration ? ` in ${duration}` : ''} (HTTP ${modelFetch[3]}${streamed ? '; streaming' : ''}).`,
        level: Number(modelFetch[3]) >= 400 ? 'warning' : undefined,
      }
    }

    const telegramRoute = /(?:\[telegram\]\s*)?agent route selected:\s*agent=([a-z0-9][a-z0-9-]{1,80})\s+mode=([^\s]+)\s+scope=([^\s]+)\s+model=([^\s]+)/iu.exec(withoutTimestamp)
    if (telegramRoute) {
      const modeLabels: Record<string, string> = {
        sticky: 'sticky selection',
        'one-shot-fresh': 'one-shot mention',
        'auto-fresh': 'one-shot name match',
        reset: 'default selection restored',
      }
      return {
        message: `Telegram routed to agent=${telegramRoute[1]} (${modeLabels[telegramRoute[2]] || telegramRoute[2]}; ${telegramRoute[3]} scope; model ${telegramRoute[4]}).`,
      }
    }

    if (/\bmessage_tool_only\b/iu.test(withoutTimestamp)) {
      return {
        message: 'Reply was withheld by this channel policy because the agent did not use its required delivery tool. The reply was not sent.',
        level: 'warning',
      }
    }

    if (/Requested agent harness ["']codex["'] is not registered/iu.test(withoutTimestamp)) {
      return {
        message: 'Codex runtime was enabled after the Gateway started, so its harness is unavailable in this process. Automnia will restart the Gateway before the next Codex turn.',
        level: 'error',
      }
    }

    if (/Left Codex binding sidecar in place because migration or archiving failed/iu.test(withoutTimestamp)) {
      return {
        message: 'A legacy Codex session sidecar is malformed. Automnia will preserve it in the recovery folder before the next Gateway startup so migration can continue.',
        level: 'warning',
      }
    }

    if (/\[clawtalk\]\s+\[MissionObserver\]\s+Failed to fetch missions:.*(?:Network error|fetch failed)/iu.test(withoutTimestamp)) {
      return {
        message: 'ClawTalk could not refresh mission data because its network request failed. It will retry when the ClawTalk service is reachable.',
        level: 'warning',
      }
    }

    const unknownTools = /tools\.allow\s+allowlist contains unknown entries\s*\(([^)]+)\)/iu.exec(withoutTimestamp)
    if (unknownTools) {
      return {
        message: `An agent tool allowlist references optional tools that are not enabled: ${unknownTools[1]}. Enable the matching plugin or remove those entries.`,
        level: 'warning',
      }
    }

    const rpcSuccess = /^(?:⇄|â‡„)\s*res\s*(?:✓|âœ“)?\s*([^\s]+)\s+(\d+)ms\b/iu.exec(withoutTimestamp)
    if (rpcSuccess) {
      if (rpcSuccess[1] === 'logs.tail') return { message: '' }
      return { message: `Gateway RPC completed: ${rpcSuccess[1]} (${rpcSuccess[2]}ms).` }
    }

    const authRefreshFailure = summarizeGatewayAuthRefreshFailure(withoutTimestamp)
    if (authRefreshFailure) return authRefreshFailure

    const fragmentSummary = summarizeGatewayLogFragment(withoutTimestamp)
    if (fragmentSummary) return fragmentSummary

    const validationHeader = withoutTimestamp.match(/^(OpenClaw config validation failed(?:[^:]*)):\s*\{?$/iu)
    if (validationHeader) {
      return { message: `${validationHeader[1]}.`, level: 'warning' }
    }

    const cronError = summarizeCronProcessedError(withoutTimestamp)
    if (cronError) return cronError

    if (isGatewaySessionLivenessDiagnostic(withoutTimestamp)) {
      return { message: withoutTimestamp || compact, level: 'warning' }
    }

    if (/\bmemory\s+embeddings retryable error;\s*retrying in \d+ms\b/i.test(withoutTimestamp)
      || /\bembeddings retryable error;\s*retrying in \d+ms\b/i.test(withoutTimestamp)) {
      return { message: 'OpenClaw memory embeddings retrying after provider error.', level: 'warning' }
    }

    const indexFailure = withoutTimestamp.match(/\bMemory index failed \(([^)]+)\):\s*(?:Error:\s*)?(.+)$/i)
    if (indexFailure && /\bembeddings\s+failed:\s*\d{3}\b/i.test(indexFailure[2])) {
      return {
        message: `OpenClaw memory index failed (${indexFailure[1]}): ${summarizeEmbeddingProviderFailure(indexFailure[2])}.`,
        level: 'warning',
      }
    }

    const syncFailure = withoutTimestamp.match(/\bmemory sync failed \(watch\):\s*(?:Error:\s*)?(.+)$/i)
    if (syncFailure && /\bembeddings\s+failed:\s*\d{3}\b/i.test(syncFailure[1])) {
      return {
        message: `OpenClaw memory sync watch failed: ${summarizeEmbeddingProviderFailure(syncFailure[1])}.`,
        level: 'warning',
      }
    }

    if (/\bembeddings\s+failed:\s*\d{3}\b/i.test(withoutTimestamp)) {
      return { message: `OpenClaw memory embedding provider issue: ${summarizeEmbeddingProviderFailure(withoutTimestamp)}.`, level: 'warning' }
    }

    return { message: withoutTimestamp || compact }
  }

  function gatewayLogPayloadMessage(value: string) {
    const trimmed = stripAnsi(value || '').trim()
    if (!trimmed) return ''
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return trimmed
      const record = parsed as Record<string, unknown>
      return (
        objectStringField(record, 'message')
        || objectStringField(record, '1')
        || objectStringField(record, 'msg')
        || objectStringField(record, '0')
        || trimmed
      ).replace(/^\{"subsystem":"[^"]+"\}\s*/u, '')
    } catch {
      return trimmed
    }
  }

  function isNodeDeprecationWarningLine(value: string) {
    const text = stripAnsi(value || '').replace(/\s+/g, ' ').trim()
    return /^\(node:\d+\)\s+\[DEP\d+\]\s+DeprecationWarning:/iu.test(text)
      || /^\(Use\s+`?(?:electron|node)(?:\.exe)?\s+--trace-deprecation\b.*warning was created\.?\)$/iu.test(text)
  }

  function isGatewayToolFailureLine(value: string) {
    return /^\[tools\]\s+[\w/-]+\s+failed:/iu.test(gatewayLogPayloadMessage(value).replace(/\s+/g, ' ').trim())
  }

  function isGatewayLogRecordStart(value: string) {
    const text = stripAnsi(value || '').trim()
    return /^\{/u.test(text)
      || /^\[[^\]]+\]\s+\[(?:stdout|stderr|lifecycle|gateway|channel)\]\s+/iu.test(text)
      || /^\d{4}-\d{2}-\d{2}T\S+\s+\[[^\]]+\]\s+/iu.test(text)
      || /^\[(?:plugins?|clawtalk|gateway(?:-err)?|agent\/embedded|agents\/[^\]]+|openclaw(?:\/[^\]]+)?|runtime(?:\/[^\]]+)?|tools)\]\s+/iu.test(text)
  }

  function isGatewayMonitorNoise(value: string) {
    const message = normalizeGatewayLogDisplayMessage(gatewayLogPayloadMessage(value)).message.replace(/\s+/g, ' ').trim()
    if (!message) return true
    if (isNodeDeprecationWarningLine(message)) return true
    if (isGatewayInternalDiagnosticMessage(message)) return true
    if (/^\[clawtalk\]\s+\[MissionObserver\]\s+(?:No running missions found\.?|Started\b.*|Stopped\.?)$/iu.test(message)) return true
    if (isGatewayToolFailureLine(message)) return true
    if (/^\[tools\]\b/iu.test(message) && /\braw_params=|\bCurrent file contents:/iu.test(message)) return true
    return false
  }

  function visibleGatewayLogSegments(message: string) {
    const lines = stripAnsi(message)
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const visibleLines = lines.length ? lines : [message.trim()].filter(Boolean)
    const segments: Array<{ line: string; display: { message: string; level?: string } }> = []
    let suppressToolFailureContinuation = false
    for (const line of visibleLines) {
      if (suppressToolFailureContinuation) {
        if (!isGatewayLogRecordStart(line)) continue
        suppressToolFailureContinuation = false
      }
      if (isGatewayMonitorNoise(line)) {
        if (isGatewayToolFailureLine(line)) suppressToolFailureContinuation = true
        continue
      }
      const display = normalizeGatewayLogDisplayMessage(line)
      segments.push({ line, display })
    }
    return segments
  }

  function formatGatewayProcessOutput(prefix: string, message: string) {
    const segments = visibleGatewayLogSegments(message)
    if (!segments.length) return ''
    return `${segments.map((segment) => `${prefix} ${segment.display.message}`).join('\n')}\n`
  }

  function normalizeGatewayChannelName(value: string) {
    const cleaned = value.trim().toLowerCase().replace(/^channels?\//u, '')
    if (!/^[a-z0-9][a-z0-9_-]{1,80}$/u.test(cleaned)) return ''
    return cleaned
  }

  function gatewayChannelFromSubsystem(value: string) {
    const cleaned = value.trim().toLowerCase()
    if (!cleaned) return ''
    const channelSubsystem = cleaned.match(/^channels?\/([a-z0-9_-]+)/u)
    if (channelSubsystem) return normalizeGatewayChannelName(channelSubsystem[1])
    const directSubsystem = cleaned.match(/^(telegram|clawtalk|sms|imessage|whatsapp|signal|discord|slack|matrix|mattermost|msteams|googlechat|feishu|line|irc|twitch|wechat|zalo|zalouser|qqbot|nextcloud-talk|synology-chat|nostr|tlon|yuanbao)(?:\/|$)/u)
    return directSubsystem ? normalizeGatewayChannelName(directSubsystem[1]) : ''
  }

  function gatewayChannelFromMessage(message: string) {
    const text = stripAnsi(message || '').replace(/\s+/g, ' ').trim()
    const bracket = text.match(/\[(clawtalk|telegram|sms|imessage|whatsapp|signal|discord|slack|matrix|mattermost|msteams|googlechat|feishu|line|irc|twitch|wechat|zalo|zalouser|qqbot|nextcloud-talk|synology-chat|nostr|tlon|yuanbao)\]/iu)
    if (bracket) return normalizeGatewayChannelName(bracket[1])
    const processed = text.match(/^message processed:\s+channel=([a-z0-9_-]+)/iu)
    if (processed) return normalizeGatewayChannelName(processed[1])
    const spoken = text.match(/\b(telegram|clawtalk|sms|imessage|whatsapp|signal|discord|slack|matrix|mattermost|teams|google chat|feishu|line|irc|twitch|wechat|zalo|qqbot|nextcloud talk|synology chat|nostr|tlon|yuanbao)\b/iu)
    if (!spoken) return ''
    const normalized = spoken[1].toLowerCase().replace(/\s+/gu, '-')
    return normalized === 'teams' ? 'msteams' : normalizeGatewayChannelName(normalized)
  }

  function gatewayChannelFromLogObject(value: Record<string, unknown>, message: string, subsystem: string) {
    for (const key of ['channel', 'channelId', 'provider', 'platform', 'surface', 'pluginId']) {
      const field = objectStringField(value, key)
      const normalized = field ? normalizeGatewayChannelName(field) : ''
      if (normalized) return normalized
    }
    const metaChannel = nestedMetaStringField(value, 'channel') || nestedMetaStringField(value, 'subsystem')
    return gatewayChannelFromSubsystem(subsystem) || gatewayChannelFromSubsystem(metaChannel) || gatewayChannelFromMessage(message)
  }

  function subsystemFromLogObject(value: Record<string, unknown>) {
    const direct = objectStringField(value, 'subsystem')
    if (direct) return direct
    const prefixed = objectStringField(value, '0')
    if (!prefixed) return ''
    try {
      const parsed = JSON.parse(prefixed) as { subsystem?: unknown }
      return typeof parsed?.subsystem === 'string' ? parsed.subsystem : ''
    } catch {
      return ''
    }
  }

  function gatewayActivityAgentId(message: string) {
    const direct = message.match(/^([a-z0-9][a-z0-9-]{1,80})\s+\/\s+[^/]+?\s+(?:heartbeat|mission|unit)\b/i)
    if (direct?.[1]) return direct[1]
    const explicit = message.match(/\bagent(?:Id)?\s*[=:]\s*([a-z0-9][a-z0-9-]{1,80})\b/iu)
    if (explicit?.[1]) return explicit[1]
    const session = message.match(/\bsessionKey\s*[=:]\s*agent:([a-z0-9][a-z0-9-]{1,80})(?::|\b)/iu)
    return session?.[1] || undefined
  }

  function isGatewayPollingIngressLifecycle(message: string) {
    const text = stripAnsi(message || '').replace(/\s+/g, ' ').trim()
    return /\b(?:isolated\s+)?polling ingress (?:started|stopped)\b/iu.test(text)
  }

  function gatewayActivityDirection(message: string): GatewayChannelDirection {
    const text = stripAnsi(message || '').replace(/\s+/g, ' ').trim()
    if (isGatewayPollingIngressLifecycle(text)) return 'system'
    if (/\b(?:SMS|message|call|update)\s+received\b|\breceived\s+from\b|\binbound\b|\bincoming\b|\bwebhook\b|\bgetUpdates\b|\bCoreBridge:\s+running agent turn\b/i.test(text)) return 'inbound'
    if (/\bSMS\s+(?:reply|sent)\b|\breply (?:sent|delivered|failed)\b|\bSending SMS\b|\bInitiating call\b|\boutbound\b|\bsent to\b|\bsend ok\b|\boutbound send ok\b|\bsendMessage\b|\bmessage sent\b|\bcall initiated\b/i.test(text)) return 'outbound'
    if (/^message processed:\s+channel=(?!cron\b|agent\b|chat\b)[a-z0-9_-]+\b/i.test(text)) return 'inbound'
    return 'system'
  }

  function gatewayActivityDirectionFromRecord(record: Record<string, unknown>, message: string): GatewayChannelDirection {
    const direct = objectStringField(record, 'direction') || objectStringField(record, 'dir')
    const normalized = direct.toLowerCase()
    if (normalized === 'inbound' || normalized === 'incoming' || normalized === 'receive' || normalized === 'received') return 'inbound'
    if (normalized === 'outbound' || normalized === 'outgoing' || normalized === 'send' || normalized === 'sent') return 'outbound'
    if (normalized === 'system' || normalized === 'status' || normalized === 'lifecycle') return 'system'
    const event = [
      objectStringField(record, 'event'),
      objectStringField(record, 'type'),
      objectStringField(record, 'operation'),
      objectStringField(record, 'messageType'),
      objectStringField(record, 'kind'),
    ].filter(Boolean).join(' ')
    return gatewayActivityDirection(`${event} ${message}`)
  }

  function objectActivityTextField(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const raw = record[key]
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
      if ((typeof raw === 'number' || typeof raw === 'boolean') && String(raw).trim()) return String(raw)
    }
    return ''
  }

  function gatewayLogEntryId(source: string, line: string) {
    const digest = createHash('sha1').update(`${source}\n${line}`).digest('hex').slice(0, 7)
    return -Number.parseInt(digest, 16)
  }

  function parseGatewayFileLogLine(line: string, source: string, index: number): GatewayLogEntry | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    if (isGatewayMonitorNoise(trimmed)) return null

    const bracket = trimmed.match(/^\[([^\]]+)]\s+\[(stdout|stderr|lifecycle)]\s+(.*)$/i)
    if (bracket) {
      if (isGatewayMonitorNoise(bracket[3])) return null
      const timestamp = !Number.isNaN(new Date(bracket[1]).getTime()) ? new Date(bracket[1]).toISOString() : new Date(nowMs()).toISOString()
      const display = normalizeGatewayLogDisplayMessage(bracket[3])
      const channel = gatewayChannelFromMessage(display.message)
      return {
        id: gatewayLogEntryId(source, `${index}:${trimmed}`),
        timestamp,
        stream: channel ? 'channel' : bracket[2].toLowerCase() as GatewayLogEntry['stream'],
        message: display.message,
        ...(display.level ? { level: display.level } : {}),
        ...(channel ? { channel, direction: gatewayActivityDirection(display.message) } : {}),
        source,
      }
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const record = parsed as Record<string, unknown>
      const rawMessage = (
        objectStringField(record, 'message')
        || objectStringField(record, '1')
        || objectStringField(record, 'msg')
        || trimmed
      ).replace(/^\{"subsystem":"[^"]+"\}\s*/u, '')
      if (isGatewayMonitorNoise(rawMessage)) return null
      const display = normalizeGatewayLogDisplayMessage(rawMessage)
      const message = display.message
      const time = objectStringField(record, 'time') || nestedMetaStringField(record, 'date')
      const timestamp = time && !Number.isNaN(new Date(time).getTime()) ? new Date(time).toISOString() : new Date(nowMs()).toISOString()
      const level = display.level || (objectStringField(record, 'level') || nestedMetaStringField(record, 'logLevelName')).toLowerCase() || undefined
      const subsystem = subsystemFromLogObject(record)
      const channel = gatewayChannelFromLogObject(record, message, subsystem)
      const direction = gatewayActivityDirectionFromRecord(record, message)
      return {
        id: gatewayLogEntryId(source, `${index}:${trimmed}`),
        timestamp,
        stream: channel || /channel/i.test(subsystem) ? 'channel' : 'gateway',
        level,
        channel,
        direction,
        source,
        message,
      }
    } catch {
      if (isGatewayMonitorNoise(trimmed)) return null
      const display = normalizeGatewayLogDisplayMessage(trimmed)
      const channel = gatewayChannelFromMessage(display.message)
      return {
        id: gatewayLogEntryId(source, `${index}:${trimmed}`),
        timestamp: new Date(nowMs()).toISOString(),
        stream: channel ? 'channel' : 'gateway',
        source,
        message: display.message,
        ...(channel ? { channel, direction: gatewayActivityDirection(display.message) } : {}),
        ...(display.level ? { level: display.level } : {}),
      }
    }
  }

  function localDateKey(date = new Date(nowMs())) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function configuredGatewayLogCandidatesFromConfig(config: unknown): string[] {
    if (!isLooseRecord(config)) return []
    const logging = isLooseRecord(config.logging) ? config.logging : null
    return typeof logging?.file === 'string' && logging.file.trim() ? [path.resolve(logging.file.trim())] : []
  }

  function defaultSharedOpenClawTempLogDirs() {
    const dirs = new Set<string>([path.join(tmpdir(), 'openclaw')])
    if (process.env.TEMP) dirs.add(path.join(process.env.TEMP, 'openclaw'))
    if (process.env.TMP) dirs.add(path.join(process.env.TMP, 'openclaw'))
    if (process.env.LOCALAPPDATA) dirs.add(path.join(process.env.LOCALAPPDATA, 'Temp', 'openclaw'))
    return Array.from(dirs)
  }

  async function discoverGatewayFileLogPaths(limit = 5) {
    const now = nowMs()
    if (gatewayLogPathDiscoveryCache && gatewayLogPathDiscoveryCache.expiresAt > now) {
      return gatewayLogPathDiscoveryCache.paths.slice()
    }

    const candidates = new Set<string>([options.openClawGatewayLogPath])
    const config = await options.readOpenclawConfig().catch(() => null)
    for (const candidate of configuredGatewayLogCandidatesFromConfig(config)) candidates.add(candidate)

    if (includeSharedOpenClawTempLogs) {
      const todayFileName = `openclaw-${localDateKey()}.log`
      for (const dir of options.sharedOpenClawTempLogDirs?.() ?? defaultSharedOpenClawTempLogDirs()) {
        candidates.add(path.join(dir, todayFileName))
        const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        const logFiles = await Promise.all(files
          .filter((entry) => entry.isFile() && /^openclaw-\d{4}-\d{2}-\d{2}\.log$/i.test(entry.name))
          .map(async (entry) => {
            const filePath = path.join(dir, entry.name)
            const stat = await fs.stat(filePath).catch(() => null)
            return stat ? { filePath, mtimeMs: stat.mtimeMs } : null
          }))
        for (const file of logFiles
          .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, limit)) {
          candidates.add(file.filePath)
        }
      }
    }

    const output: string[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const normalized = process.platform === 'win32' ? candidate.toLowerCase() : candidate
      if (seen.has(normalized)) continue
      seen.add(normalized)
      const stat = await fs.stat(candidate).catch(() => null)
      if (stat?.isFile()) output.push(candidate)
    }
    gatewayLogPathDiscoveryCache = {
      expiresAt: now + logPathDiscoveryCacheMs,
      paths: output,
    }
    return output
  }

  function gatewayLogFileStatKey(stat: { size: number; mtimeMs: number; birthtimeMs: number }) {
    return `${stat.size}:${Math.round(stat.mtimeMs)}:${Math.round(stat.birthtimeMs)}`
  }

  async function gatewayLogFileSignature(filePath: string, stat: { size: number; mtimeMs: number; birthtimeMs: number }) {
    const length = Math.min(logFingerprintBytes, stat.size)
    const statKey = gatewayLogFileStatKey(stat)
    if (length <= 0) return `${statKey}:empty`
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, 0)
      const digest = createHash('sha1').update(buffer).digest('hex').slice(0, 14)
      return `${statKey}:${digest}`
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async function readTailText(filePath: string, maxBytes = logTailMaxBytes) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile() || stat.size <= 0) return ''
    const length = Math.min(maxBytes, stat.size)
    const start = Math.max(0, stat.size - length)
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, start)
      const text = buffer.toString('utf-8')
      if (start <= 0) return text

      // A byte-tail can begin in the middle of a JSON/Pino record. Never pass
      // that torn prefix to the formatter: it otherwise becomes a misleading
      // wall of `runtimeVersion`, `hostname`, and source-file metadata.
      const precedingByte = Buffer.alloc(1)
      await handle.read(precedingByte, 0, 1, start - 1)
      const beginsAfterLineBreak = precedingByte[0] === 0x0a || precedingByte[0] === 0x0d
      if (beginsAfterLineBreak) return text
      const firstLineBreak = text.indexOf('\n')
      return firstLineBreak >= 0 ? text.slice(firstLineBreak + 1) : ''
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async function readTailTextWithSignature(filePath: string, maxBytes = logTailMaxBytes) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile() || stat.size <= 0) return null
    const statKey = gatewayLogFileStatKey(stat)
    const cached = gatewayLogTailSnapshots.get(filePath)
    if (cached?.statKey === statKey) {
      return { raw: '', statKey, signature: cached.signature, cacheHit: true }
    }
    const signature = await gatewayLogFileSignature(filePath, stat)
    if (cached?.signature === signature) {
      if (cached.statKey !== statKey) {
        gatewayLogTailSnapshots.set(filePath, { ...cached, statKey, signature })
      }
      return { raw: '', statKey, signature, cacheHit: true }
    }
    const raw = await readTailText(filePath, maxBytes)
    return { raw, statKey, signature, cacheHit: false }
  }

  async function readGatewayFileLogEntries(limit = 120): Promise<GatewayLogEntry[]> {
    const paths = await discoverGatewayFileLogPaths()
    const activePaths = new Set(paths)
    const entries: GatewayLogEntry[] = []
    for (const filePath of paths) {
      const snapshot = await readTailTextWithSignature(filePath).catch(() => null)
      const cached = gatewayLogTailSnapshots.get(filePath)
      if (cached && snapshot?.cacheHit && cached.signature === snapshot.signature) {
        entries.push(...cached.entries)
        continue
      }
      if (!snapshot?.raw.trim()) {
        gatewayLogTailSnapshots.delete(filePath)
        continue
      }

      const parsedEntries: GatewayLogEntry[] = []
      const lines = snapshot.raw.replace(/\r/g, '').split('\n').filter((line) => line.trim())
      lines.slice(-Math.max(limit * 4, limit)).forEach((line, index) => {
        const entry = parseGatewayFileLogLine(line, filePath, index)
        if (entry) parsedEntries.push(entry)
      })
      gatewayLogTailSnapshots.set(filePath, {
        statKey: snapshot.statKey,
        signature: snapshot.signature,
        entries: parsedEntries,
      })
      entries.push(...parsedEntries)
    }
    for (const cachedPath of gatewayLogTailSnapshots.keys()) {
      if (!activePaths.has(cachedPath)) gatewayLogTailSnapshots.delete(cachedPath)
    }

    const byKey = new Map<string, GatewayLogEntry>()
    for (const entry of entries) {
      const key = `${entry.timestamp}|${entry.stream}|${entry.message}`
      if (!byKey.has(key)) byKey.set(key, entry)
    }
    return Array.from(byKey.values())
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit)
  }

  async function readGatewayRpcLogEntries(limit = 120): Promise<GatewayLogEntry[] | null> {
    const client = options.getGatewayClient()
    if (!client) return null

    try {
      const payload = await client.request('logs.tail', {
        limit: Math.max(limit * 4, limit),
        maxBytes: Math.min(logTailMaxBytes, 250_000),
      }, { timeoutMs: 2_500 })
      if (!isLooseRecord(payload) || !Array.isArray(payload.lines)) return null
      const source = typeof payload.file === 'string' && payload.file.trim()
        ? payload.file.trim()
        : 'gateway:logs.tail'
      return payload.lines
        .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        .slice(-Math.max(limit * 4, limit))
        .map((line, index) => parseGatewayFileLogLine(line, source, index))
        .filter((entry): entry is GatewayLogEntry => Boolean(entry))
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, limit)
    } catch (error) {
      const now = nowMs()
      if (now - gatewayRpcLogFailureNotifiedAt > rpcLogFailureNoticeMs) {
        gatewayRpcLogFailureNotifiedAt = now
        pushGatewayLog('gateway', `logs.tail unavailable; using local file tail fallback: ${redact(String(error))}`, 'warning')
      }
      return null
    }
  }

  function clawTalkWsLogCandidates() {
    const candidates = new Set<string>([
      path.join(options.openClawStateRoot, 'plugins', 'clawtalk', 'ws.log'),
      path.join(options.nativeOpenClawStateRoot, 'plugins', 'clawtalk', 'ws.log'),
    ])
    const configured = process.env.CLAWTALK_WS_LOG_PATH || process.env.OPENCLAW_CLAWTALK_WS_LOG_PATH || ''
    if (configured.trim()) candidates.add(path.resolve(configured.trim()))
    return Array.from(candidates)
  }

  function channelActivityLabel(channel: string, event: string, direction: GatewayChannelDirection) {
    const text = `${channel} ${event}`.replace(/[._-]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (/\bsms\b/u.test(text) && direction === 'inbound') return 'SMS received'
    if (/\bsms\b/u.test(text) && direction === 'outbound') return 'SMS sent'
    if (/\bcall\b/u.test(text) && direction === 'inbound') return 'Call received'
    if (/\bcall\b/u.test(text) && direction === 'outbound') return 'Call placed'
    if (/\btelegram\b/u.test(text) && direction === 'inbound') return 'Telegram message received'
    if (/\btelegram\b/u.test(text) && direction === 'outbound') return 'Telegram message sent'
    return direction === 'inbound' ? 'Message received' : 'Message sent'
  }

  function parseClawTalkWsLogLine(line: string, source: string, index: number): GatewayLogEntry | null {
    const trimmed = stripAnsi(line || '').trim()
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(<<<|>>>|---)\s*(.*)$/u)
    if (!match) return null

    const marker = match[2]
    if (marker === '---') return null

    const rawPayload = match[3].trim()
    let record: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(rawPayload) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>
    } catch {
      record = null
    }

    const event = record
      ? objectActivityTextField(record, ['event', 'type', 'kind', 'operation', 'messageType'])
      : rawPayload
    const probe = `${event} ${rawPayload}`
    let direction = gatewayActivityDirection(probe)
    if (direction === 'system') {
      if (marker === '>>>' && /\b(?:send|sent|reply|outbound|message|sms|call)\b/iu.test(probe)) direction = 'outbound'
      if (marker === '<<<' && /\b(?:received|incoming|inbound|message|sms|call|webhook)\b/iu.test(probe)) direction = 'inbound'
    }
    if (direction === 'system') return null

    const eventLower = event.toLowerCase()
    if (/\b(?:auth|hello|ping|pong|connected|heartbeat|ready|registered)\b/iu.test(eventLower)
      && !/\b(?:sms|message|call|received|sent|reply|incoming|outbound)\b/iu.test(eventLower)) {
      return null
    }

    const body = record
      ? objectActivityTextField(record, ['body', 'text', 'message', 'content', 'transcript', 'reply'])
      : ''
    const mediaCount = record && Array.isArray(record.media_urls) ? record.media_urls.length : 0
    const label = channelActivityLabel('clawtalk', event, direction)
    const detail = body
      ? compactGatewayLogMessage(body, 360)
      : mediaCount
        ? `${mediaCount} media attachment${mediaCount === 1 ? '' : 's'}`
        : ''
    const timestamp = !Number.isNaN(Date.parse(match[1])) ? new Date(match[1]).toISOString() : new Date(nowMs()).toISOString()

    return {
      id: gatewayLogEntryId(source, `${index}:${trimmed}`),
      timestamp,
      stream: 'channel',
      channel: 'clawtalk',
      direction,
      source,
      message: detail ? `${label}: ${detail}` : label,
    }
  }

  async function readClawTalkChannelActivityEntries(limit = 80): Promise<GatewayLogEntry[]> {
    const entries: GatewayLogEntry[] = []
    for (const filePath of clawTalkWsLogCandidates()) {
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat?.isFile() || stat.size <= 0) continue
      const raw = await readTailText(filePath, Math.min(logTailMaxBytes, 360_000)).catch(() => '')
      const lines = raw.replace(/\r/g, '').split('\n').filter((line) => line.trim())
      lines.slice(-Math.max(limit * 3, limit)).forEach((line, index) => {
        const entry = parseClawTalkWsLogLine(line, filePath, index)
        if (entry) entries.push(entry)
      })
    }
    return entries
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit)
  }

  function gatewayActivityLooksLikeChannelMessage(message: string) {
    const text = stripAnsi(message || '').replace(/\s+/g, ' ').trim()
    if (isGatewayPollingIngressLifecycle(text)) return false
    return /^message processed:\s+channel=(?!cron\b|agent\b|chat\b)[a-z0-9_-]+\b/iu.test(text)
      || /\b(?:SMS|MMS|message|call|update)\s+received\b|\breceived\s+from\b|\binbound\b|\bincoming\b|\bwebhook\b|\bgetUpdates\b|\bCoreBridge:\s+running agent turn\b/iu.test(text)
      || /\bSMS\s+(?:reply|sent)\b|\breply (?:sent|delivered|failed)\b|\bSending SMS\b|\bInitiating call\b|\boutbound\b|\bsent to\b|\bsend ok\b|\boutbound send ok\b|\bsendMessage\b|\bmessage sent\b|\bcall initiated\b/iu.test(text)
      || /\b(?:telegram|clawtalk|sms|imessage|whatsapp|signal|discord|slack|matrix|mattermost|msteams|googlechat|line|wechat)\b.*\b(?:received|sent|reply|incoming|outbound|inbound|send|delivered)\b/iu.test(text)
      || /\b(?:received|sent|reply|incoming|outbound|inbound|send|delivered)\b.*\b(?:telegram|clawtalk|sms|message|call|discord|slack|whatsapp)\b/iu.test(text)
  }

  function isGatewayChannelActivity(entry: GatewayLogEntry) {
    const direction = entry.direction || gatewayActivityDirection(entry.message)
    if (direction !== 'inbound' && direction !== 'outbound') return false
    return Boolean(entry.channel || gatewayChannelFromMessage(entry.message) || entry.stream === 'channel')
      && gatewayActivityLooksLikeChannelMessage(entry.message)
  }

  function summarizeGatewayActivity(entries: GatewayLogEntry[], activeWindowMs = 10 * 60 * 1000): GatewayActivitySummary {
    const events = entries
      .filter(isGatewayChannelActivity)
      .map((entry): GatewayChannelActivity => ({
        id: entry.id,
        timestamp: entry.timestamp,
        channel: entry.channel || entry.message.match(/\[([a-z0-9_-]+)]/i)?.[1]?.toLowerCase() || 'gateway',
        direction: entry.direction || gatewayActivityDirection(entry.message),
        message: entry.message,
        level: entry.level,
        source: entry.source,
        agentId: gatewayActivityAgentId(entry.message),
      }))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 60)

    const lastEventAt = events[0]?.timestamp || null
    const lastMs = lastEventAt ? Date.parse(lastEventAt) : NaN
    return {
      active: Number.isFinite(lastMs) ? nowMs() - lastMs <= activeWindowMs : false,
      lastEventAt,
      sourcePath: events[0]?.source || entries[0]?.source || null,
      inboundCount: events.filter((event) => event.direction === 'inbound').length,
      outboundCount: events.filter((event) => event.direction === 'outbound').length,
      systemCount: events.filter((event) => event.direction === 'system').length,
      events,
    }
  }

  function normalizedGatewayLogMessageForDedupe(message: string) {
    return stripAnsi(message || '')
      .trim()
      .replace(/^\[[^\]]+\]\s+\[(?:stdout|stderr|lifecycle|gateway|channel)\]\s+/iu, '')
      .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\[memory\]\s+/iu, 'memory ')
      .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\[[^\]]+\]\s+/iu, '')
      .replace(/\bretrying in \d+ms\b/giu, 'retrying')
      .replace(/\bOpenClaw memory index failed \([^)]+\):/iu, 'OpenClaw memory index failed:')
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  function gatewayMemoryLogBucketMs(normalizedMessage: string) {
    if (/openclaw memory embeddings retrying after provider error/u.test(normalizedMessage)) return 60_000
    if (/openclaw memory index failed: .*embeddings returned 500/u.test(normalizedMessage)) return 60_000
    if (/openclaw memory sync watch failed: .*embeddings returned 500/u.test(normalizedMessage)) return 60_000
    return 0
  }

  function dedupeGatewayLogEntries(entries: GatewayLogEntry[], limit = 80) {
    const deduped = new Map<string, GatewayLogEntry>()
    for (const entry of [...entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))) {
      const timestampMs = Date.parse(entry.timestamp)
      const normalized = normalizedGatewayLogMessageForDedupe(entry.message)
      const noisyMemoryBucketMs = gatewayMemoryLogBucketMs(normalized)
      const bucketMs = noisyMemoryBucketMs || 5000
      const bucket = Number.isFinite(timestampMs) ? Math.floor(timestampMs / bucketMs) : 0
      const key = `${bucketMs}:${bucket}|${normalized}`
      if (!deduped.has(key)) deduped.set(key, entry)
    }
    return Array.from(deduped.values()).slice(0, limit)
  }

  function runtimeLoadedPluginIdsFromGatewayLogs(entries: GatewayLogEntry[]) {
    const ids = new Set<string>()
    const pluginIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/
    for (const entry of entries) {
      const match = entry.message.match(/\bhttp server listening\s+\(\d+\s+plugins?:\s*([^;)]+)/i)
      if (!match) continue
      for (const id of match[1].split(',')) {
        const normalized = id.trim().toLowerCase()
        if (pluginIdPattern.test(normalized)) ids.add(normalized)
      }
      if (ids.size) break
    }
    return ids
  }

  function normalizeGatewayLedgerEntry(value: unknown, index: number): GatewayLogEntry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const timestamp = typeof record.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp))
      ? new Date(record.timestamp).toISOString()
      : ''
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    const stream = typeof record.stream === 'string' ? record.stream.trim().toLowerCase() : ''
    if (!timestamp || !message) return null
    if (stream !== 'stdout' && stream !== 'stderr' && stream !== 'lifecycle' && stream !== 'gateway' && stream !== 'channel') {
      return null
    }
    const id = typeof record.id === 'number' && Number.isFinite(record.id)
      ? record.id
      : gatewayLogEntryId('ledger', `${index}:${timestamp}:${stream}:${message}`)
    const level = typeof record.level === 'string' && record.level.trim() ? record.level.trim() : undefined
    const source = typeof record.source === 'string' && record.source.trim() ? record.source.trim() : undefined
    const channel = typeof record.channel === 'string' && record.channel.trim() ? record.channel.trim() : undefined
    const direction = record.direction === 'inbound' || record.direction === 'outbound' || record.direction === 'system'
      ? record.direction
      : undefined
    return {
      id,
      timestamp,
      stream,
      message: redact(message),
      ...(level ? { level } : {}),
      ...(source ? { source } : {}),
      ...(channel ? { channel } : {}),
      ...(direction ? { direction } : {}),
    }
  }

  function gatewayLogEntriesSinceCurrentStart(entries: GatewayLogEntry[]) {
    const startedAt = options.getGatewayLastStartedAt()
    const startedAtMs = startedAt ? Date.parse(startedAt) : NaN
    const startCutoffMs = Number.isFinite(startedAtMs) ? startedAtMs - 5000 : options.controlCenterStartedAtMs - 5000
    const cutoffMs = Math.max(startCutoffMs, options.getRuntimeMonitorClearedAtMs())
    return entries.filter((entry) => {
      const entryMs = Date.parse(entry.timestamp)
      return Number.isFinite(entryMs) && entryMs >= cutoffMs
    })
  }

  function pushGatewayLog(stream: GatewayLogEntry['stream'], message: string, level?: string) {
    for (const { display } of visibleGatewayLogSegments(message)) {
      const channel = gatewayChannelFromMessage(display.message)
      const direction = channel ? gatewayActivityDirection(display.message) : undefined
      const entry = {
        id: ++gatewayLogSeq,
        timestamp: new Date(nowMs()).toISOString(),
        stream: channel ? 'channel' as const : stream,
        message: display.message.length > 600 ? `${display.message.slice(0, 599).trim()}...` : display.message,
        ...(level || display.level ? { level: level || display.level } : {}),
        ...(channel ? { channel, direction } : {}),
      } satisfies GatewayLogEntry
      gatewayLogs.unshift(entry)
      void Promise.resolve(options.appendGatewayLogEntry({
        ...entry,
        message: redact(entry.message),
      })).catch(() => undefined)
    }
    if (gatewayLogs.length > logLimit) gatewayLogs.length = logLimit
  }

  async function readExternalGatewayLogEntries(limit = 80): Promise<GatewayLogEntry[]> {
    const now = nowMs()
    if (externalGatewayLogCache && externalGatewayLogCache.expiresAt > now) {
      return externalGatewayLogCache.entries.slice(0, limit)
    }
    const rpcEntries = await readGatewayRpcLogEntries(limit)
    const entries = rpcEntries?.length ? rpcEntries : await readGatewayFileLogEntries(limit)
    externalGatewayLogCache = {
      expiresAt: now + externalLogCacheMs,
      entries,
    }
    return entries
  }

  async function readExternalChannelActivityEntries(limit = 80): Promise<GatewayLogEntry[]> {
    const now = nowMs()
    if (externalChannelActivityCache && externalChannelActivityCache.expiresAt > now) {
      return externalChannelActivityCache.entries.slice(0, limit)
    }
    const entries = await readClawTalkChannelActivityEntries(limit)
    externalChannelActivityCache = {
      expiresAt: now + externalLogCacheMs,
      entries,
    }
    return entries
  }

  function clearRuntimeMonitorHistory() {
    const cleared = {
      gatewayLogs: gatewayLogs.length,
      gatewayLogTailSnapshots: gatewayLogTailSnapshots.size,
    }
    gatewayLogs.length = 0
    gatewayLogTailSnapshots.clear()
    externalGatewayLogCache = null
    externalChannelActivityCache = null
    gatewayLogPathDiscoveryCache = null
    return cleared
  }

  function getGatewayLogs() {
    return gatewayLogs
  }

  return {
    clearRuntimeMonitorHistory,
    compactGatewayLogMessage,
    dedupeGatewayLogEntries,
    discoverGatewayFileLogPaths,
    formatGatewayProcessOutput,
    gatewayActivityDirection,
    gatewayChannelFromMessage,
    gatewayLogEntriesSinceCurrentStart,
    getGatewayLogs,
    normalizeGatewayLedgerEntry,
    parseClawTalkWsLogLine,
    parseGatewayFileLogLine,
    pushGatewayLog,
    readExternalChannelActivityEntries,
    readExternalGatewayLogEntries,
    readGatewayFileLogEntries,
    readGatewayRpcLogEntries,
    runtimeLoadedPluginIdsFromGatewayLogs,
    isGatewayInternalDiagnosticMessage,
    summarizeCronProcessedError,
    summarizeGatewayActivity,
  }
}

export type GatewayLogService = ReturnType<typeof createGatewayLogService>

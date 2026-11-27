import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

export type OpenClawResult = {
  stdout: string
  stderr: string
  code: number
  elapsedMs?: number
}

export type PluginControlsPayload = {
  plugins: unknown[]
  configPath: string
  cache: unknown
  cliError?: string
}

export type OpenClawCommandRoutesOptions = {
  applyTelegramSettings?: (
    settings: Record<string, unknown>,
    changedKeys: string[],
  ) => Promise<{ ok: boolean; detail: string; elapsedMs: number; restartPending?: boolean }>
  activeShifts: () => unknown[]
  getPartyMembers: () => Promise<unknown>
  invalidateRuntimeStatusCache: () => void
  listMissionViews: () => unknown[]
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  missionFeed: () => unknown[]
  openclawConfigPath: string
  parseOpenClawCommandInput: (input: string) => string[]
  pluginCommandResult: (args: string[], result: OpenClawResult) => unknown
  pluginCommandString: (args: string[]) => string
  pushGatewayLog: (stream: 'lifecycle' | 'stdout' | 'stderr', message: string) => void
  redactSensitiveText: (value: string) => string
  runOpenClaw: (args: string[], timeoutMs?: number) => Promise<OpenClawResult>
}

const SUMMARY_STATUS_TIMEOUT_MS = 90_000
const SUMMARY_SUBCOMMAND_TIMEOUT_MS = 30_000
const GATEWAY_LOG_STREAM_SLICE_CHARS = 12_000
const SUMMARY_REDACTION_MAX_DEPTH = 10

const OpenClawCommandSchema = z.object({
  command: z.string().trim().min(1).max(4000),
  timeoutSeconds: z.number().int().min(5).max(7200).optional().default(600),
  refreshPlugins: z.boolean().optional().default(true),
})

const TelegramSettingsApplySchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  changedKeys: z.array(z.string().min(1).max(64)).min(1).max(40),
})

export function stripAnsiCodes(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x1b && value[index + 1] === '[') {
      let cursor = index + 2
      while (cursor < value.length && ((value[cursor] >= '0' && value[cursor] <= '9') || value[cursor] === ';')) {
        cursor += 1
      }
      if (
        cursor < value.length &&
        ((value[cursor] >= 'A' && value[cursor] <= 'Z') || (value[cursor] >= 'a' && value[cursor] >= 'z'))
      ) {
        index = cursor
        continue
      }
    }
    result += value[index]
  }
  return result
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function isSensitiveConfigKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('apikey') ||
    normalized.includes('authkey') ||
    normalized.includes('privatekey') ||
    normalized.includes('signingkey') ||
    normalized.includes('encryptionkey') ||
    normalized.includes('accesskey') ||
    normalized.includes('masterkey') ||
    normalized === 'authorization' ||
    normalized.includes('cookie') ||
    normalized.includes('credential') ||
    normalized.includes('verifier')
  )
}

const SENSITIVE_CLI_FLAG_NAME_PATTERN = /^--?(?:[a-z0-9-]*-)?(?:token|secret|password|passphrase|api-?key|auth-?key|private-?key|access-?key|master-?key)$/i
const SENSITIVE_CLI_INLINE_FLAG_PATTERN = /^(--?(?:[a-z0-9-]*-)?(?:token|secret|password|passphrase|api-?key|auth-?key|private-?key|access-?key|master-?key)=)([\s\S]*)$/i

export function redactSensitiveCommandArgs(args: readonly string[], redactText: (value: string) => string): string[] {
  const sanitized = args.map((arg) => redactText(arg))
  for (let index = 0; index < sanitized.length; index += 1) {
    const current = args[index] || ''
    const inlineMatch = current.match(SENSITIVE_CLI_INLINE_FLAG_PATTERN)
    if (inlineMatch) {
      sanitized[index] = `${inlineMatch[1]}[redacted]`
      continue
    }
    if (SENSITIVE_CLI_FLAG_NAME_PATTERN.test(current) && index + 1 < sanitized.length) {
      sanitized[index + 1] = '[redacted]'
      index += 1
      continue
    }
    if (
      current.toLowerCase() === 'config' &&
      (args[index + 1] || '').toLowerCase() === 'set' &&
      index + 3 < sanitized.length
    ) {
      const keyPath = args[index + 2] || ''
      if (keyPath.split('.').some((segment) => isSensitiveConfigKey(segment))) {
        sanitized[index + 3] = '[redacted]'
      }
    }
  }
  return sanitized
}

export function sanitizeSummaryConfigValue(
  value: unknown,
  redactText: (raw: string) => string,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value ? redactText(value) : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return redactText(String(value))

  if (seen.has(value)) return '[circular]'
  if (depth >= SUMMARY_REDACTION_MAX_DEPTH) return '[depth-exceeded]'

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeSummaryConfigValue(item, redactText, depth + 1, seen))
    }
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveConfigKey(key)) {
        clean[key] = entry === undefined || entry === null || entry === '' ? entry : '[redacted]'
        continue
      }
      clean[key] = sanitizeSummaryConfigValue(entry, redactText, depth + 1, seen)
    }
    return clean
  } finally {
    seen.delete(value)
  }
}

export function parseGatewaySummaryStdout(stdout: string): unknown {
  const cleaned = stripAnsiCodes(stdout || '').replace(/^\uFEFF/, '').trim()
  if (!cleaned) return null
  try {
    return JSON.parse(cleaned)
  } catch {
    // Fall back to extracting a trailing JSON object/array when OpenClaw emits diagnostic lines ahead of stdout JSON.
  }

  for (let index = 0; index < cleaned.length; index += 1) {
    const ch = cleaned[index]
    if (ch !== '{' && ch !== '[') continue
    if (index > 0 && cleaned[index - 1] !== '\n' && cleaned[index - 1] !== '\r') continue
    const candidate = cleaned.slice(index).trim()
    try {
      return JSON.parse(candidate)
    } catch {
      // Keep scanning subsequent lines.
    }
  }
  return null
}

function sanitizeCommandResultEnvelope(
  rawCommandResult: unknown,
  redactedCommandLine: string,
  redactText: (value: string) => string,
): unknown {
  if (!rawCommandResult || typeof rawCommandResult !== 'object' || Array.isArray(rawCommandResult)) {
    return rawCommandResult
  }
  const copy: Record<string, unknown> = { ...(rawCommandResult as Record<string, unknown>) }
  if (typeof copy.command === 'string') {
    copy.command = redactedCommandLine
  }
  for (const field of ['stdout', 'stderr', 'output'] as const) {
    if (typeof copy[field] === 'string') {
      copy[field] = redactText(copy[field] as string)
    }
  }
  return copy
}

export function registerOpenClawCommandRoutes(app: Express, options: OpenClawCommandRoutesOptions) {
  app.get('/api/openclaw/summary', async (_req, res) => {
    try {
      const [status, gateway, cron, party] = await Promise.all([
        options.runOpenClaw(['status'], SUMMARY_STATUS_TIMEOUT_MS),
        options.runOpenClaw(['config', 'get', 'gateway'], SUMMARY_SUBCOMMAND_TIMEOUT_MS),
        options.runOpenClaw(['cron', 'list'], SUMMARY_SUBCOMMAND_TIMEOUT_MS),
        options.getPartyMembers(),
      ])
      const rawGateway = gateway.code === 0 ? parseGatewaySummaryStdout(gateway.stdout) : null
      const parsedGateway = rawGateway !== null
        ? sanitizeSummaryConfigValue(rawGateway, options.redactSensitiveText)
        : null

      return apiSuccess(res, {
        status: options.redactSensitiveText(status.stdout || ''),
        gateway: parsedGateway,
        cron: options.redactSensitiveText(cron.stdout || ''),
        party,
        activeShifts: options.activeShifts(),
        missions: options.listMissionViews(),
        missionFeed: options.missionFeed(),
      })
    } catch (error) {
      return apiFailure(
        res,
        500,
        'openclaw_summary_failed',
        'Failed to fetch summary',
        options.redactSensitiveText(String(error)),
      )
    }
  })

  app.post('/api/openclaw/telegram/settings/apply', async (req, res) => {
    if (!options.applyTelegramSettings) {
      return apiFailure(res, 501, 'openclaw_command_failed', 'Telegram settings apply is unavailable')
    }
    const parsed = TelegramSettingsApplySchema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid Telegram settings', parsed.error.flatten())

    try {
      const result = await options.applyTelegramSettings(parsed.data.settings, parsed.data.changedKeys)
      const detail = options.redactSensitiveText(result.detail).slice(0, GATEWAY_LOG_STREAM_SLICE_CHARS)
      return apiSuccess(res, {
        ok: result.ok,
        restartPending: result.restartPending === true,
        command: {
          command: 'openclaw gateway call config.patch',
          code: result.ok ? 0 : 1,
          stdout: result.ok ? detail : '',
          stderr: result.ok ? '' : detail,
          output: detail,
          elapsedMs: result.elapsedMs,
        },
      })
    } catch (error) {
      return apiFailure(
        res,
        500,
        'openclaw_command_failed',
        'Telegram settings could not be applied',
        options.redactSensitiveText(String(error)),
      )
    }
  })

  app.post('/api/openclaw/command', async (req, res) => {
    const parsed = OpenClawCommandSchema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    if (hasControlCharacters(parsed.data.command)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid OpenClaw command', 'OpenClaw command contains unsupported control characters.')
    }

    let args: string[]
    try {
      args = options.parseOpenClawCommandInput(parsed.data.command)
    } catch (error) {
      return apiFailure(
        res,
        400,
        'invalid_payload',
        'Invalid OpenClaw command',
        options.redactSensitiveText(String(error)),
      )
    }
    if (!Array.isArray(args) || args.length === 0 || args.some((arg) => hasControlCharacters(arg))) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid OpenClaw command', 'OpenClaw command is empty or contains control characters.')
    }

    const timeoutMs = parsed.data.timeoutSeconds * 1000
    const redactedArgs = redactSensitiveCommandArgs(args, options.redactSensitiveText)
    const redactedCommandLine = options.redactSensitiveText(options.pluginCommandString(redactedArgs))
    options.pushGatewayLog('lifecycle', `$ ${redactedCommandLine}`)
    try {
      const result = await options.runOpenClaw(args, timeoutMs)
      options.invalidateRuntimeStatusCache()
      const redactedStdout = options.redactSensitiveText(result.stdout || '').slice(0, GATEWAY_LOG_STREAM_SLICE_CHARS)
      const redactedStderr = options.redactSensitiveText(result.stderr || '').slice(0, GATEWAY_LOG_STREAM_SLICE_CHARS)
      if (redactedStdout.trim()) options.pushGatewayLog('stdout', redactedStdout)
      if (redactedStderr.trim()) options.pushGatewayLog('stderr', redactedStderr)
      options.pushGatewayLog(
        result.code === 0 ? 'lifecycle' : 'stderr',
        `openclaw command exited ${result.code}${typeof result.elapsedMs === 'number' ? ` after ${result.elapsedMs}ms` : ''}`,
      )
      const controls = parsed.data.refreshPlugins
        ? await options.listPluginControls({ forceRefresh: true }).catch((error) => ({
            plugins: [],
            configPath: options.openclawConfigPath,
            cache: { source: 'openclaw' as const, refreshedAt: Date.now(), refreshing: false },
            cliError: options.redactSensitiveText(String(error)),
          }))
        : null
      const commandPayload = sanitizeCommandResultEnvelope(
        options.pluginCommandResult(redactedArgs, result),
        redactedCommandLine,
        options.redactSensitiveText,
      )
      return apiSuccess(res, {
        ok: result.code === 0,
        command: commandPayload,
        ...(controls ? {
          plugins: controls.plugins,
          configPath: controls.configPath,
          cache: controls.cache,
          ...(controls.cliError ? { cliError: options.redactSensitiveText(controls.cliError) } : {}),
        } : {}),
      })
    } catch (error) {
      const detail = options.redactSensitiveText(String(error))
      options.pushGatewayLog('stderr', `openclaw command failed: ${detail}`)
      return apiFailure(res, 500, 'openclaw_command_failed', 'OpenClaw command failed', detail)
    }
  })
}

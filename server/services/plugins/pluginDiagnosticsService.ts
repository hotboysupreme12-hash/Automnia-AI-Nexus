import {
  type PluginControlEntry,
  type PluginControlsPayload,
} from './pluginInventoryService'
import {
  pluginCommandResult,
  type PluginCommandResult,
  type PluginGatewayRestartRequest,
  type PluginInstallResult,
  type PluginOpenClawResult,
} from './pluginInstallService'
import type { PluginRuntimeInspectResult } from './pluginRuntimeService'

type ClawTalkDoctorStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type ClawTalkDoctorSummary = {
  ok: boolean
  botConnected: boolean
  websocketServer: boolean
  checks: Record<string, ClawTalkDoctorStatus>
  command: PluginCommandResult
}

export type ClawTalkSetupSummary = {
  installed: boolean
  configured: boolean
  enabled: boolean
  ready: boolean
  botConnected: boolean
  websocketServer: boolean
  actions: string[]
}

export type PluginClawTalkSetupResult = {
  installResult: PluginInstallResult | null
  inspect: PluginRuntimeInspectResult
  doctor: ClawTalkDoctorSummary
  setup: ClawTalkSetupSummary
  restart: PluginGatewayRestartRequest
  controls: PluginControlsPayload
}

export type PluginClawTalkSetupParams = {
  apiKey: string
  server?: string
  install: boolean
  restart: boolean
}

export type PluginDiagnosticsServiceOptions = {
  clawTalkPluginId: string
  defaultServer?: string
  delayMs?: (ms: number) => Promise<void>
  nowMs?: () => number
  isRealInstalledPluginEntry: (plugin?: PluginControlEntry) => boolean
  installOpenClawPlugin: (params: {
    spec: string
    pluginId?: string
    pin: boolean
    enable: boolean
    force: boolean
    restart: boolean
  }) => Promise<PluginInstallResult>
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  saveClawTalkSetupConfig: (apiKey: string, server: string) => Promise<void>
  refreshOpenClawPluginRegistry: (reason: string) => Promise<PluginOpenClawResult>
  repairClawTalkPluginManifestContracts: () => Promise<string[]>
  inspectOpenClawPluginRuntime: (pluginId: string) => Promise<PluginRuntimeInspectResult>
  pluginRuntimeInspectReady: (inspect: PluginRuntimeInspectResult) => boolean
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<PluginOpenClawResult>
  tryRestartGatewayService: (options: {
    force?: boolean
    allowExternalTakeover?: boolean
    reason?: string
  }) => Promise<{ restarted: boolean; scheduled?: boolean; detail: string }>
  redactSensitiveText: (value: string) => string
}

export type PluginDiagnosticsService = {
  setupClawTalkPlugin: (params: PluginClawTalkSetupParams) => Promise<PluginClawTalkSetupResult>
}

const CLAWTALK_DOCTOR_CHECK_RE =
  /\b(api_key|phone_linked|phone_verified|voice_ai|bot_connected|pin|dedicated_number|paranoid_mode|2fa|voice_preference|server_health|telnyx_api|websocket_server)\b/i

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_BEL = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${ANSI_BEL}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`, 'g')

function stripAnsi(text: string): string {
  return text
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
}

function normalizeClawTalkApiKeyInput(value: string) {
  const apiKey = value.trim()
  if (!/^cc_(?:live|test)_[A-Za-z0-9_-]{20,160}$/.test(apiKey)) {
    throw new Error('Paste a valid ClawTalk API key.')
  }
  return apiKey
}

function normalizeClawTalkServerInput(value: unknown, fallback: string) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new Error('ClawTalk server must be an http or https URL.')
  }
}

function clawTalkDoctorStatusFromLine(line: string): ClawTalkDoctorStatus {
  if (/[\u00D7\u2717]/.test(line) || /\b(?:fail|failed|error)\b/i.test(line)) return 'fail'
  if (/[\u26A0\u2757]/.test(line) || /\b(?:warn|warning)\b/i.test(line)) return 'warn'
  if (/[\u2705\u2714]/.test(line) || /\b(?:pass|passed|ok)\b/i.test(line)) return 'pass'
  return 'unknown'
}
function parseClawTalkDoctorSummary(
  args: string[],
  result: PluginOpenClawResult,
  redactSensitiveText: (value: string) => string,
): ClawTalkDoctorSummary {
  const checks: Record<string, ClawTalkDoctorStatus> = {}
  const text = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
  for (const rawLine of text.split(/\r?\n/)) {
    const match = CLAWTALK_DOCTOR_CHECK_RE.exec(rawLine)
    if (!match) continue
    checks[match[1].toLowerCase()] = clawTalkDoctorStatusFromLine(rawLine)
  }
  const botConnected = checks.bot_connected === 'pass'
  const websocketServer = checks.websocket_server === 'pass'
  const command = pluginCommandResult(args, result, redactSensitiveText)
  command.stdout = ''
  command.stderr = ''
  command.output = `bot_connected=${botConnected ? 'pass' : checks.bot_connected || 'unknown'}; websocket_server=${
    websocketServer ? 'pass' : checks.websocket_server || 'unknown'
  }`
  return {
    ok: result.code === 0 && botConnected && websocketServer,
    botConnected,
    websocketServer,
    checks,
    command,
  }
}

export function createPluginDiagnosticsService(options: PluginDiagnosticsServiceOptions): PluginDiagnosticsService {
  const delay = options.delayMs || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const nowMs = options.nowMs || (() => Date.now())
  const defaultServer = options.defaultServer || 'https://api.clawtalk.io'

  async function runClawTalkDoctorOnce() {
    const args = ['clawtalk', 'doctor']
    const result = await options.runOpenClaw(args, 75_000)
    return parseClawTalkDoctorSummary(args, result, options.redactSensitiveText)
  }

  async function waitForClawTalkDoctor(timeoutMs: number) {
    const deadline = nowMs() + Math.max(0, timeoutMs)
    let last: ClawTalkDoctorSummary | null = null
    let lastError: unknown
    do {
      try {
        last = await runClawTalkDoctorOnce()
        if (last.ok) return last
      } catch (error) {
        lastError = error
      }
      if (nowMs() < deadline) await delay(2500)
    } while (nowMs() < deadline)
    if (last) return last
    throw lastError || new Error('ClawTalk doctor did not return a result.')
  }

  async function waitForClawTalkRuntimeInspect(timeoutMs: number) {
    const deadline = nowMs() + Math.max(0, timeoutMs)
    let last: Awaited<ReturnType<typeof options.inspectOpenClawPluginRuntime>> | null = null
    let lastError: unknown
    do {
      try {
        last = await options.inspectOpenClawPluginRuntime(options.clawTalkPluginId)
        if (options.pluginRuntimeInspectReady(last)) return last
      } catch (error) {
        lastError = error
      }
      if (nowMs() < deadline) await delay(2500)
    } while (nowMs() < deadline)
    if (last) return last
    throw lastError || new Error('ClawTalk runtime inspect did not return a result.')
  }

  async function setupClawTalkPlugin(params: PluginClawTalkSetupParams): Promise<PluginClawTalkSetupResult> {
    const apiKey = normalizeClawTalkApiKeyInput(params.apiKey)
    const server = normalizeClawTalkServerInput(params.server, defaultServer)
    const actions: string[] = []

    let controls = await options.listPluginControls({ forceRefresh: true })
    const existing = controls.plugins.find((plugin) => plugin.id === options.clawTalkPluginId)
    let installResult: PluginInstallResult | null = null

    if (!options.isRealInstalledPluginEntry(existing)) {
      if (!params.install) {
        throw new Error('ClawTalk is not installed. Install it or enable automatic install for setup.')
      }
      installResult = await options.installOpenClawPlugin({
        spec: options.clawTalkPluginId,
        pluginId: options.clawTalkPluginId,
        pin: true,
        enable: true,
        force: false,
        restart: false,
      })
      controls = installResult.controls
      actions.push('installed ClawTalk plugin')
    }

    await options.saveClawTalkSetupConfig(apiKey, server)
    actions.push('saved ClawTalk API key and enabled auto-connect')
    const repairedManifests = await options.repairClawTalkPluginManifestContracts()
    if (repairedManifests.length) {
      await options.refreshOpenClawPluginRegistry('clawtalk-setup-repair')
      actions.push('repaired ClawTalk plugin manifest contracts')
    }

    const restart = params.restart
      ? {
          ...(await options.tryRestartGatewayService({ force: true, reason: 'ClawTalk setup requested gateway restart' })),
          scheduled: false,
        }
      : { restarted: false, scheduled: false, detail: 'gateway restart skipped' }
    if (params.restart) actions.push(restart.restarted ? 'restarted OpenClaw gateway' : 'checked OpenClaw gateway')
    await delay(params.restart ? 4000 : 750)

    const inspect = await waitForClawTalkRuntimeInspect(30_000)
    const doctor = await waitForClawTalkDoctor(45_000)
    const runtimeReady = options.pluginRuntimeInspectReady(inspect)
    if (!runtimeReady || !doctor.ok) {
      const missing = [
        runtimeReady ? '' : 'runtime load',
        doctor.botConnected ? '' : 'bot connection',
        doctor.websocketServer ? '' : 'websocket server',
      ].filter(Boolean)
      throw new Error(`ClawTalk setup saved, but verification did not pass: ${missing.join(', ') || 'unknown check'}.`)
    }

    actions.push('verified ClawTalk bot and WebSocket connection')
    controls = await options.listPluginControls({ forceRefresh: true })
    return {
      installResult,
      inspect,
      doctor,
      setup: {
        installed: Boolean(installResult),
        configured: true,
        enabled: true,
        ready: true,
        botConnected: doctor.botConnected,
        websocketServer: doctor.websocketServer,
        actions,
      },
      restart,
      controls,
    }
  }

  return { setupClawTalkPlugin }
}



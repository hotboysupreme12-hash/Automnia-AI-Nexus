import { existsSync, readFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  PLUGIN_ID_PATTERN,
  pluginIdFromPackageName,
  type PluginControlEntry,
  type PluginControlsPayload,
  type PluginRuntimeState,
} from './pluginInventoryService'

export type PluginOpenClawResult = {
  stdout: string
  stderr: string
  code: number
  elapsedMs?: number
}

export type PluginCommandResult = {
  command: string
  code: number
  stdout: string
  stderr: string
  output: string
  elapsedMs?: number
}

export type PluginGatewayRestartRequest = {
  restarted: boolean
  scheduled: boolean
  detail: string
}

export type PluginInstallRepairSummary = {
  applied: boolean
  reason: string
  actions: string[]
  retryArgs?: string[]
}

export type PluginPostInstallRepairSummary = {
  applied: boolean
  reason: string
  actions: string[]
  warnings?: string[]
  bundledSource?: string
  commands?: PluginCommandResult[]
}

export type PluginInstallParams = {
  spec: string
  pluginId?: string
  pin: boolean
  enable: boolean
  force: boolean
  restart: boolean
}

export type PluginUninstallOptions = {
  keepFiles: boolean
  force: boolean
  restart: boolean
}

export type PluginInstallResult = {
  install: {
    code: number
    stdout: string
    stderr: string
  }
  activation?: {
    code: number
    stdout: string
    stderr: string
  }
  repair?: PluginInstallRepairSummary
  postInstallRepair?: PluginPostInstallRepairSummary
  plugin: PluginControlEntry | null | undefined
  restart: PluginGatewayRestartRequest
  controls: PluginControlsPayload
}

export type PluginMutationResult = {
  command: PluginCommandResult
  plugin?: PluginControlEntry | null
  restart: PluginGatewayRestartRequest
  controls: PluginControlsPayload
}

type ParsedPluginInstallInput = {
  spec: string
  fromCommand: boolean
  installArgs: string[]
}

type PluginOpenClawConfig = Record<string, unknown>

export type PluginInstallServiceOptions = {
  clawTalkPluginId: string
  configPath: string
  installRepairDir: string
  openclawBin: string
  pluginExtensionsDir: string
  stateRoot: string
  delayMs?: (ms: number) => Promise<void>
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  openClawConfigNeedsCodexPlugin: (config: PluginOpenClawConfig) => boolean
  pauseGatewayForPluginInstallRepair: (actions: string[]) => Promise<void>
  persistTrustedPluginAllowlist: (...extraIds: Array<unknown>) => Promise<void>
  readOpenclawConfig: () => Promise<PluginOpenClawConfig>
  readPluginRuntimeState: () => Promise<PluginRuntimeState>
  redactSensitiveText: (value: string) => string
  refreshOpenClawPluginRegistry: (reason: string) => Promise<PluginOpenClawResult>
  refreshPluginListCache: () => Promise<unknown>
  renamePath?: (source: string, destination: string) => Promise<void>
  repairClawTalkPluginManifestContracts: () => Promise<string[]>
  repairCodexPluginPostInstallState: (options: {
    runCliEnable: boolean
    verifyRoutes: boolean
    bundledSource?: string
  }) => Promise<PluginPostInstallRepairSummary>
  resolveBundledCodexPluginRoot: () => string
  resumeGatewayAfterPluginInstallRepair: (actions: string[]) => void
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<PluginOpenClawResult>
  schedulePluginGatewayRestart: () => PluginGatewayRestartRequest
  setOpenClawPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  warn?: (message: string, error: unknown) => void
  writePluginRuntimeState: (state: PluginRuntimeState) => Promise<void>
}

export type PluginInstallService = {
  installOpenClawPlugin: (params: PluginInstallParams) => Promise<PluginInstallResult>
  updateOpenClawPlugin: (pluginId: string, restartRequested: boolean) => Promise<PluginMutationResult>
  updateAllOpenClawPlugins: (restartRequested: boolean) => Promise<PluginMutationResult>
  uninstallOpenClawPlugin: (pluginId: string, options: PluginUninstallOptions) => Promise<PluginMutationResult>
}

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_BEL = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${ANSI_BEL}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`, 'g')

function stripAnsi(text: string): string {
  return text
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPathInsideOrSame(baseDir: string, targetPath: string) {
  const base = path.resolve(baseDir)
  const target = path.resolve(targetPath)
  const relative = path.relative(base, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function pluginCommandString(args: string[]) {
  return `openclaw ${args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`
}

export function pluginCommandResult(
  args: string[],
  result: PluginOpenClawResult,
  redactSensitiveText: (value: string) => string,
): PluginCommandResult {
  const stdout = redactSensitiveText(result.stdout || '').slice(0, 12_000)
  const stderr = redactSensitiveText(result.stderr || '').slice(0, 12_000)
  const output = redactSensitiveText(stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim()).slice(0, 12_000)
  return {
    command: pluginCommandString(args),
    code: result.code,
    stdout,
    stderr,
    output,
    ...(typeof result.elapsedMs === 'number' ? { elapsedMs: result.elapsedMs } : {}),
  }
}

function packageNameFromInstallSpec(spec: string) {
  const trimmed = spec.trim()
  const prefix = trimmed.match(/^([a-z][a-z0-9-]*):/i)?.[1]?.toLowerCase()
  if (prefix && !['clawhub', 'npm'].includes(prefix)) return ''
  const value = trimmed.replace(/^(?:clawhub|npm):/i, '')
  if (!value || /^(?:[./~]|[A-Za-z]:[\\/])/.test(value)) return ''
  const atIndex = value.lastIndexOf('@')
  if (atIndex > 0 && !(value.startsWith('@') && value.indexOf('/', 1) > atIndex)) {
    return value.slice(0, atIndex).trim()
  }
  return value
}

function versionFromInstallSpec(spec: string) {
  const value = spec.trim().replace(/^(?:clawhub|npm):/i, '')
  const atIndex = value.lastIndexOf('@')
  if (atIndex <= 0 || atIndex >= value.length - 1) return ''
  if (value.startsWith('@') && value.indexOf('/', 1) > atIndex) return ''
  return value.slice(atIndex + 1).trim()
}

function pluginInstallSourceFromSpec(spec: string) {
  const prefix = spec.trim().match(/^([a-z][a-z0-9-]*):/i)?.[1]?.toLowerCase()
  if (prefix) return prefix
  if (/^(?:\.|~|\/|[A-Za-z]:[\\/])/.test(spec.trim())) return 'path'
  return 'auto'
}

function pluginIdFromInstallSpec(value: string) {
  const trimmed = value.trim()
  const withoutPrefix = trimmed.replace(/^(?:clawhub|npm|file|path):/i, '')
  const packageLike = withoutPrefix.includes('\\') || withoutPrefix.includes('/')
    ? path.basename(withoutPrefix)
    : withoutPrefix
  return pluginIdFromPackageName(packageLike)
}

export function splitPluginCommandLine(input: string) {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaping = false
  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (escaping) current += '\\'
  if (quote) throw new Error('Install command has an unterminated quote.')
  if (current) tokens.push(current)
  return tokens
}

function isOpenClawCommandToken(token: string) {
  const normalized = path.basename(token).toLowerCase().replace(/\.(?:cmd|bat|exe|mjs|js)$/i, '')
  return normalized === 'openclaw'
}

function validatePluginInstallCommandArgs(args: string[]) {
  const installArgs: string[] = []
  const booleanFlags = new Set(['--pin', '--force', '--dangerously-force-unsafe-install', '--link', '--local', '-l'])
  const valueFlags = new Set(['--marketplace', '-m'])
  let spec = ''
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) continue
    if (token.startsWith('-')) {
      const flagName = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (valueFlags.has(flagName)) {
        installArgs.push(token)
        if (!token.includes('=')) {
          const value = args[index + 1]
          if (!value || value.startsWith('-')) throw new Error(`Install command flag ${token} needs a value.`)
          installArgs.push(value)
          index += 1
        }
        continue
      }
      if (booleanFlags.has(token)) {
        installArgs.push(token)
        continue
      }
      throw new Error(`Unsupported plugin install flag: ${token}`)
    }
    if (!spec) {
      spec = token
      continue
    }
    throw new Error(`Unexpected extra plugin install argument: ${token}`)
  }
  return { spec, installArgs }
}

function validatePluginInstallSpec(spec: string) {
  const trimmed = spec.trim()
  if (!trimmed) throw new Error('Install spec is required.')
  if (trimmed.length > 320) throw new Error('Install spec is too long.')
  if (Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  })) throw new Error('Install spec contains unsupported control characters.')
  return trimmed
}

export function parsePluginInstallInput(input: string): ParsedPluginInstallInput {
  const trimmed = validatePluginInstallSpec(input)
  if (!/\bplugins\s+install\b/i.test(trimmed)) {
    return { spec: trimmed, fromCommand: false, installArgs: [] }
  }

  const tokens = splitPluginCommandLine(trimmed)
  if (
    tokens.length >= 4 &&
    isOpenClawCommandToken(tokens[0]) &&
    tokens[1]?.toLowerCase() === 'plugins' &&
    tokens[2]?.toLowerCase() === 'install'
  ) {
    const parsed = validatePluginInstallCommandArgs(tokens.slice(3))
    return {
      spec: validatePluginInstallSpec(parsed.spec),
      fromCommand: true,
      installArgs: parsed.installArgs,
    }
  }

  throw new Error('Paste an OpenClaw plugin install command like: openclaw plugins install clawhub:@scope/package')
}

function pluginInstallSpecIsLocalPath(spec: string) {
  const trimmed = spec.trim()
  if (!trimmed) return false
  if (/^(?:\.|~|\/|[A-Za-z]:[\\/])/.test(trimmed)) return true
  if (/\.(?:tgz|tar\.gz|tar|zip|mjs|cjs|js|ts)$/i.test(trimmed)) return true
  return existsSync(path.resolve(trimmed))
}

function isCodexPluginInstallRequest(params: { spec: string; pluginId?: string }, parsed: ParsedPluginInstallInput) {
  const pluginId = params.pluginId?.trim().toLowerCase()
  if (pluginId === 'codex') return true
  const spec = parsed.spec.trim().toLowerCase()
  if (spec === 'codex' || spec === '@openclaw/codex') return true
  if (/^(?:npm|clawhub):@openclaw\/codex(?:@|$)/i.test(parsed.spec.trim())) return true
  return pluginIdFromInstallSpec(parsed.spec) === 'codex'
}

function packageVersionFromPluginRoot(root: string) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version.trim() : ''
  } catch {
    return ''
  }
}

function pluginInstallOutputText(result: PluginOpenClawResult) {
  return stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim()
}

function parsePluginInstallRenameFailure(
  result: PluginOpenClawResult,
  pluginExtensionsDir: string,
): { sourcePath: string; targetPath: string; pluginId: string } | null {
  const text = pluginInstallOutputText(result)
  if (!/(?:failed to copy plugin|EPERM|EBUSY|EACCES|operation not permitted|resource busy|access denied)/i.test(text)) return null
  const match =
    /\brename\s+['"]([^'"]*\.openclaw-install-stage-[^'"]*)['"]\s*->\s*['"]([^'"]+)['"]/i.exec(text) ||
    /\brename\s+([^\r\n]+?\.openclaw-install-stage-\S+)\s*->\s*([^\r\n]+)/i.exec(text)
  if (!match) return null

  const sourcePath = path.resolve(match[1].trim())
  const targetPath = path.resolve(match[2].trim())
  const extensionsDir = path.resolve(pluginExtensionsDir)
  if (!isPathInsideOrSame(extensionsDir, sourcePath) || !isPathInsideOrSame(extensionsDir, targetPath)) return null
  if (path.dirname(sourcePath).toLowerCase() !== extensionsDir.toLowerCase()) return null
  if (path.dirname(targetPath).toLowerCase() !== extensionsDir.toLowerCase()) return null
  if (!path.basename(sourcePath).startsWith('.openclaw-install-stage-')) return null
  const pluginId = path.basename(targetPath).trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(pluginId)) return null
  return { sourcePath, targetPath, pluginId }
}

function pluginInstallRepairStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function quarantinePluginInstallPath(
  targetPath: string,
  label: string,
  installRepairDir: string,
  renamePath: (source: string, destination: string) => Promise<void>,
  actions: string[],
) {
  if (!existsSync(targetPath)) return false
  await fs.mkdir(installRepairDir, { recursive: true })
  const destination = path.join(
    installRepairDir,
    `${label}-${path.basename(targetPath)}-${pluginInstallRepairStamp()}`,
  )
  await renamePath(targetPath, destination)
  actions.push(`moved ${targetPath} to ${destination}`)
  return true
}

async function quarantineStalePluginInstallStages(
  pluginExtensionsDir: string,
  installRepairDir: string,
  renamePath: (source: string, destination: string) => Promise<void>,
  actions: string[],
) {
  const entries = await fs.readdir(pluginExtensionsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('.openclaw-install-stage-')) continue
    await quarantinePluginInstallPath(path.join(pluginExtensionsDir, entry.name), 'stale-stage', installRepairDir, renamePath, actions)
  }
}

function throwPluginCommandError(
  args: string[],
  result: PluginOpenClawResult,
  redactSensitiveText: (value: string) => string,
): never {
  const detail = redactSensitiveText(stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim() || `${pluginCommandString(args)} exited ${result.code}`)
  const error = new Error(detail)
  ;(error as Error & { code?: number }).code = result.code
  throw error
}

export function createPluginInstallService(options: PluginInstallServiceOptions): PluginInstallService {
  const delay = options.delayMs || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const skippedRestart = (): PluginGatewayRestartRequest => ({ restarted: false, scheduled: false, detail: 'gateway restart skipped' })
  const renamePath = options.renamePath || ((source: string, destination: string) => fs.rename(source, destination))
  const warn = (message: string, error: unknown) => {
    if (options.warn) {
      options.warn(message, error)
    } else {
      console.warn(message, error)
    }
  }
  const commandResult = (args: string[], result: PluginOpenClawResult) => pluginCommandResult(args, result, options.redactSensitiveText)

  async function recordPluginInstallRuntimeState(params: {
    pluginId: string
    spec: string
    enabled: boolean
    packageName?: string
    version?: string
  }) {
    const id = params.pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const now = new Date().toISOString()
    const state = await options.readPluginRuntimeState()
    state.managed = isLooseRecord(state.managed) ? state.managed as PluginRuntimeState['managed'] : {}
    state.installs = isLooseRecord(state.installs) ? state.installs as PluginRuntimeState['installs'] : {}
    const previous = isLooseRecord(state.installs?.[id]) ? state.installs?.[id] : null
    const packageName = params.packageName?.trim() || packageNameFromInstallSpec(params.spec)
    const version = params.version?.trim() || versionFromInstallSpec(params.spec)
    state.managed![id] = { enabled: params.enabled, updatedAt: now }
    state.installs![id] = {
      ...(previous || {}),
      pluginId: id,
      spec: params.spec,
      source: pluginInstallSourceFromSpec(params.spec),
      ...(packageName ? { packageName } : {}),
      ...(version ? { version } : {}),
      enabled: params.enabled,
      installedAt: typeof previous?.installedAt === 'string' && previous.installedAt ? previous.installedAt : now,
      updatedAt: now,
      stateRoot: options.stateRoot,
      configPath: options.configPath,
      openclawBin: options.openclawBin,
      installedBy: 'control-center',
    }
    await options.writePluginRuntimeState(state)
  }

  async function touchPluginManagedRuntimeState(pluginId: string, enabled?: boolean) {
    const id = pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const state = await options.readPluginRuntimeState()
    const now = new Date().toISOString()
    state.managed = isLooseRecord(state.managed) ? state.managed as PluginRuntimeState['managed'] : {}
    const previousManaged = state.managed![id]
    const nextEnabled = typeof enabled === 'boolean' ? enabled : previousManaged?.enabled !== false
    state.managed![id] = { enabled: nextEnabled, updatedAt: now }
    if (isLooseRecord(state.installs?.[id])) {
      state.installs![id].enabled = nextEnabled
      state.installs![id].updatedAt = now
    }
    await options.writePluginRuntimeState(state)
  }

  async function forgetPluginRuntimeState(pluginId: string) {
    const id = pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const state = await options.readPluginRuntimeState()
    if (isLooseRecord(state.managed)) delete state.managed[id]
    if (isLooseRecord(state.installs)) delete state.installs[id]
    if (isLooseRecord(state.secrets)) delete state.secrets[id]
    await options.writePluginRuntimeState(state)
  }

  async function repairPluginInstallRenameFailure(
    result: PluginOpenClawResult,
    retryArgs: string[],
  ): Promise<PluginInstallRepairSummary & { pausedGateway: boolean }> {
    const failure = parsePluginInstallRenameFailure(result, options.pluginExtensionsDir)
    if (!failure) {
      return { applied: false, reason: '', actions: [], retryArgs, pausedGateway: false }
    }

    const actions: string[] = []
    await fs.mkdir(options.pluginExtensionsDir, { recursive: true })
    await options.pauseGatewayForPluginInstallRepair(actions)
    let pausedGateway = true
    try {
      await quarantinePluginInstallPath(failure.targetPath, `previous-${failure.pluginId}`, options.installRepairDir, renamePath, actions)
      await quarantinePluginInstallPath(failure.sourcePath, `failed-stage-${failure.pluginId}`, options.installRepairDir, renamePath, actions)
      await quarantineStalePluginInstallStages(options.pluginExtensionsDir, options.installRepairDir, renamePath, actions)
    } catch (error) {
      options.resumeGatewayAfterPluginInstallRepair(actions)
      pausedGateway = false
      actions.push(`repair cleanup failed: ${String(error)}`)
      throw error
    }

    return {
      applied: true,
      reason: `Windows blocked the OpenClaw installer stage rename for ${failure.pluginId}; cleaned stale install folders and retrying with --force.`,
      actions,
      retryArgs,
      pausedGateway,
    }
  }

  async function refreshPluginControlsAfterMutation() {
    await options.refreshPluginListCache().catch((error) => {
      warn('[plugins] refresh after plugin command failed:', error)
    })
    return options.listPluginControls()
  }

  async function installOpenClawPlugin(params: PluginInstallParams): Promise<PluginInstallResult> {
    const requestedInput = parsePluginInstallInput(params.spec)
    const bundledCodexSource = isCodexPluginInstallRequest(params, requestedInput)
      ? options.resolveBundledCodexPluginRoot()
      : ''
    const input = bundledCodexSource
      ? {
          ...requestedInput,
          spec: bundledCodexSource,
          installArgs: requestedInput.installArgs.filter((arg) => arg !== '--pin'),
        }
      : requestedInput
    const spec = input.spec
    const installUsesLocalPath = pluginInstallSpecIsLocalPath(spec)
    const before = await options.listPluginControls().catch(() => null)
    const beforeIds = new Set((before?.plugins || []).map((plugin) => plugin.id))
    const buildInstallArgs = (forceRetry = false) => {
      const args = ['plugins', 'install', spec, ...input.installArgs]
      if (!input.fromCommand && params.pin && !installUsesLocalPath) args.push('--pin')
      const hasForce = args.includes('--force')
      if ((!input.fromCommand && params.force) || (forceRetry && !hasForce)) args.push('--force')
      return args
    }
    let args = buildInstallArgs(false)
    let install = await options.runOpenClaw(args, 240_000)
    let repair: PluginInstallRepairSummary | undefined
    if (install.code !== 0) {
      const retryArgs = buildInstallArgs(true)
      let repairAttempt: (PluginInstallRepairSummary & { pausedGateway?: boolean }) | undefined
      try {
        repairAttempt = await repairPluginInstallRenameFailure(install, retryArgs)
        if (repairAttempt.applied) {
          repair = {
            applied: true,
            reason: repairAttempt.reason,
            actions: [...repairAttempt.actions],
            retryArgs: repairAttempt.retryArgs,
          }
          await delay(450)
          args = retryArgs
          install = await options.runOpenClaw(args, 240_000)
        }
      } finally {
        if (repairAttempt?.pausedGateway) {
          options.resumeGatewayAfterPluginInstallRepair(repairAttempt.actions)
          if (repair) repair.actions = [...repairAttempt.actions]
        }
      }
    }
    if (install.code !== 0) {
      const detail = options.redactSensitiveText(stripAnsi(`${install.stdout}\n${install.stderr}`).trim() || `openclaw plugins install exited ${install.code}`)
      const repairDetail = repair?.applied
        ? `\n\nAuto-repair attempted:\n${repair.actions.map((action) => `- ${action}`).join('\n')}`
        : ''
      const error = new Error(`${detail}${repairDetail}`)
      ;(error as Error & { code?: number }).code = install.code
      throw error
    }

    await options.refreshPluginListCache().catch((error) => {
      warn('[plugins] refresh after install failed:', error)
    })
    let controls = await options.listPluginControls()
    const explicitId = params.pluginId?.trim().toLowerCase() || ''
    const inferredId = PLUGIN_ID_PATTERN.test(explicitId)
      ? explicitId
      : pluginIdFromInstallSpec(bundledCodexSource ? requestedInput.spec : spec)
    const installedPlugin =
      controls.plugins.find((plugin) => plugin.id === inferredId) ||
      controls.plugins.find((plugin) => !beforeIds.has(plugin.id)) ||
      null

    let restart: PluginGatewayRestartRequest = skippedRestart()
    const activationId = installedPlugin?.id || (PLUGIN_ID_PATTERN.test(inferredId) ? inferredId : '')
    let activation: PluginOpenClawResult | null = null
    if (params.enable && activationId) {
      activation = await options.runOpenClaw(['plugins', 'enable', activationId], 120_000)
      if (activation.code !== 0) {
        const detail = options.redactSensitiveText(stripAnsi(`${activation.stdout}\n${activation.stderr}`).trim() || `openclaw plugins enable exited ${activation.code}`)
        const error = new Error(`Plugin installed, but activation failed for ${activationId}: ${detail}`)
        ;(error as Error & { code?: number }).code = activation.code
        throw error
      }
      await options.setOpenClawPluginEnabled(activationId, true)
      restart = params.restart ? options.schedulePluginGatewayRestart() : restart
      controls = await options.listPluginControls()
    }
    let postInstallRepair: PluginPostInstallRepairSummary | undefined
    if (activationId === 'codex') {
      const config = await options.readOpenclawConfig()
      const routesNeedCodex = options.openClawConfigNeedsCodexPlugin(config)
      if (params.enable) {
        postInstallRepair = await options.repairCodexPluginPostInstallState({
          runCliEnable: !params.enable,
          verifyRoutes: routesNeedCodex,
          ...(bundledCodexSource ? { bundledSource: bundledCodexSource } : {}),
        })
        controls = await options.listPluginControls({ forceRefresh: true })
      }
    }
    if (activationId === options.clawTalkPluginId) {
      const repairedManifests = await options.repairClawTalkPluginManifestContracts()
      if (repairedManifests.length) {
        await options.refreshOpenClawPluginRegistry('clawtalk-post-install-repair')
        controls = await options.listPluginControls({ forceRefresh: true })
      }
    }
    if (activationId) {
      const activatedPlugin = controls.plugins.find((plugin) => plugin.id === activationId) || installedPlugin
      const enabledAfterInstall = params.enable ? true : activatedPlugin?.enabled === true
      await recordPluginInstallRuntimeState({
        pluginId: activationId,
        spec: bundledCodexSource ? requestedInput.spec : spec,
        enabled: enabledAfterInstall,
        packageName: bundledCodexSource ? '@openclaw/codex' : packageNameFromInstallSpec(spec),
        version: bundledCodexSource ? packageVersionFromPluginRoot(bundledCodexSource) : versionFromInstallSpec(spec),
      })
      if (enabledAfterInstall) {
        await options.persistTrustedPluginAllowlist(activationId)
      }
      controls = await options.listPluginControls()
    }

    return {
      install: {
        code: install.code,
        stdout: options.redactSensitiveText(install.stdout).slice(0, 12_000),
        stderr: options.redactSensitiveText(install.stderr).slice(0, 12_000),
      },
      ...(repair?.applied ? { repair } : {}),
      ...(postInstallRepair?.applied ? { postInstallRepair } : {}),
      ...(activation ? {
        activation: {
          code: activation.code,
          stdout: options.redactSensitiveText(activation.stdout).slice(0, 12_000),
          stderr: options.redactSensitiveText(activation.stderr).slice(0, 12_000),
        },
      } : {}),
      plugin: activationId
        ? controls.plugins.find((plugin) => plugin.id === activationId) || installedPlugin
        : installedPlugin,
      restart,
      controls,
    }
  }

  async function updateOpenClawPlugin(pluginId: string, restartRequested: boolean): Promise<PluginMutationResult> {
    const id = pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const args = ['plugins', 'update', id]
    const command = await options.runOpenClaw(args, 240_000)
    if (command.code !== 0) throwPluginCommandError(args, command, options.redactSensitiveText)

    const controls = await refreshPluginControlsAfterMutation()
    const plugin = controls.plugins.find((entry) => entry.id === id) || null
    await touchPluginManagedRuntimeState(id, plugin?.enabled)
    const restart = restartRequested ? options.schedulePluginGatewayRestart() : skippedRestart()
    const refreshedControls = await options.listPluginControls()
    return {
      command: commandResult(args, command),
      plugin: refreshedControls.plugins.find((entry) => entry.id === id) || plugin,
      restart,
      controls: refreshedControls,
    }
  }

  async function updateAllOpenClawPlugins(restartRequested: boolean): Promise<PluginMutationResult> {
    const args = ['plugins', 'update', '--all']
    const command = await options.runOpenClaw(args, 300_000)
    if (command.code !== 0) throwPluginCommandError(args, command, options.redactSensitiveText)

    const controls = await refreshPluginControlsAfterMutation()
    await Promise.all(controls.plugins.map((plugin) => touchPluginManagedRuntimeState(plugin.id, plugin.enabled).catch(() => undefined)))
    const restart = restartRequested ? options.schedulePluginGatewayRestart() : skippedRestart()
    return {
      command: commandResult(args, command),
      restart,
      controls,
    }
  }

  async function uninstallOpenClawPlugin(pluginId: string, uninstallOptions: PluginUninstallOptions): Promise<PluginMutationResult> {
    const id = pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const args = ['plugins', 'uninstall', id]
    if (uninstallOptions.keepFiles) args.push('--keep-files')
    if (uninstallOptions.force) args.push('--force')
    const command = await options.runOpenClaw(args, 240_000)
    if (command.code !== 0) throwPluginCommandError(args, command, options.redactSensitiveText)

    await forgetPluginRuntimeState(id)
    const controls = await refreshPluginControlsAfterMutation()
    const restart = uninstallOptions.restart ? options.schedulePluginGatewayRestart() : skippedRestart()
    return {
      command: commandResult(args, command),
      restart,
      controls,
    }
  }

  return {
    installOpenClawPlugin,
    updateOpenClawPlugin,
    updateAllOpenClawPlugins,
    uninstallOpenClawPlugin,
  }
}

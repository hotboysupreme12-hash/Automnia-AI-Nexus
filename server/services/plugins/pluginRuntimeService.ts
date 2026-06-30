import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  PLUGIN_ID_PATTERN,
  type PluginControlsPayload,
} from './pluginInventoryService'
import {
  pluginCommandResult,
  type PluginCommandResult,
  type PluginOpenClawResult,
} from './pluginInstallService'

export type PluginRuntimeSurfaceSummary = {
  label: string
  values: string[]
}

export type PluginRuntimeInspectResult = {
  pluginId: string
  command: PluginCommandResult
  raw: unknown
  status: string
  runtimeLoaded: boolean | null
  surfaces: PluginRuntimeSurfaceSummary[]
}

export type PluginSetupTerminalCommand = 'plugins' | 'model' | 'full' | 'doctor' | 'registry'
export type PluginSetupTerminalStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type PluginSetupTerminalEvent = 'data' | 'status'
export type PluginSetupTerminalClient = (event: PluginSetupTerminalEvent, payload: unknown) => void

export type PluginSetupTerminalSnapshot = {
  id: string
  command: PluginSetupTerminalCommand
  commandLine: string
  title: string
  pluginId?: string
  createdAt: string
  updatedAt: string
  status: PluginSetupTerminalStatus
  exitCode?: number
  pid?: number
}

export type PluginSetupTerminalOperationResult =
  | { ok: true; session: PluginSetupTerminalSnapshot }
  | { ok: false; reason: 'not_found' | 'not_running'; message: string }

export type PluginSetupTerminalAttachment = {
  session: PluginSetupTerminalSnapshot
  output: string
  detach: () => void
}

type PtyDisposable = { dispose: () => void }

export type PluginRuntimePtyProcess = {
  pid: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (callback: (data: string) => void) => PtyDisposable
  onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => PtyDisposable
}

export type PluginRuntimePtyModule = {
  spawn: (
    command: string,
    args: string[],
    options: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: Record<string, string>
      useConpty?: boolean
    },
  ) => PluginRuntimePtyProcess
}

type PluginSetupTerminalSession = PluginSetupTerminalSnapshot & {
  output: string
  process: PluginRuntimePtyProcess
  dataDisposable?: PtyDisposable
  exitDisposable?: PtyDisposable
  clients: Set<PluginSetupTerminalClient>
}

export type PluginRuntimeServiceOptions = {
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  openClawProcessEnv: (overrides?: Record<string, string | undefined>) => NodeJS.ProcessEnv
  openClawSpawnSpec: (args: string[]) => { command: string; args: readonly string[] }
  redactSensitiveText: (value: string) => string
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<PluginOpenClawResult>
  terminateProcessTree: (pid: number | undefined, reason?: string, force?: boolean) => Promise<{ ok: boolean; detail: string }>
  workspaceRoot: string
  loadPtyModule?: () => PluginRuntimePtyModule
  warn?: (message: string, error?: unknown) => void
}

export type PluginRuntimeService = {
  inspectOpenClawPluginRuntime: (pluginId: string) => Promise<PluginRuntimeInspectResult>
  pluginRuntimeInspectReady: (inspect: PluginRuntimeInspectResult) => boolean
  startPluginSetupTerminalSession: (params: {
    command: PluginSetupTerminalCommand
    pluginId?: string
    cols?: number
    rows?: number
  }) => PluginSetupTerminalSnapshot
  getPluginSetupTerminalSnapshot: (sessionId: string) => PluginSetupTerminalSnapshot | null
  attachPluginSetupTerminalClient: (sessionId: string, client: PluginSetupTerminalClient) => PluginSetupTerminalAttachment | null
  writePluginSetupTerminalInput: (sessionId: string, data: string) => PluginSetupTerminalOperationResult
  resizePluginSetupTerminalSession: (sessionId: string, cols: number, rows: number) => PluginSetupTerminalOperationResult
  stopPluginSetupTerminalSession: (sessionId: string, reason?: string) => PluginSetupTerminalOperationResult
  stopAllPluginSetupTerminalSessions: (reason?: string) => number
}

const optionalRequire = createRequire(import.meta.url)

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_BEL = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${ANSI_BEL}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`, 'g')

const PLUGIN_SETUP_TERMINAL_COMMANDS: Record<PluginSetupTerminalCommand, { label: string; args: string[] }> = {
  plugins: { label: 'Plugin fields', args: ['configure', '--section', 'plugins'] },
  model: { label: 'Model/auth', args: ['configure', '--section', 'model'] },
  full: { label: 'Full configure', args: ['configure'] },
  doctor: { label: 'Plugin doctor', args: ['plugins', 'doctor'] },
  registry: { label: 'Registry refresh', args: ['plugins', 'registry', '--refresh'] },
}

const PLUGIN_SETUP_TERMINAL_MAX_BUFFER_CHARS = 250_000
const PLUGIN_SETUP_TERMINAL_RETAIN_MS = 10 * 60 * 1000

function stripAnsi(text: string): string {
  return text
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueStrings(...values: unknown[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values.flat(Infinity)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    output.push(trimmed)
  }
  return output
}

function firstJsonSliceFromText(text: string) {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart)
  if (start < 0) return ''
  const opener = text[start]
  const closer = opener === '{' ? '}' : ']'
  const stack: string[] = [closer]
  let inString = false
  let escaping = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) return ''
      stack.pop()
      if (!stack.length && char === closer) return text.slice(start, index + 1)
    }
  }

  return ''
}

function parseOpenClawJsonOutput(stdout: string): unknown {
  const text = stripAnsi(stdout || '').trim()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    const slice = firstJsonSliceFromText(text)
    return slice ? JSON.parse(slice) as unknown : {}
  }
}

function pluginCommandString(args: string[]) {
  return `openclaw ${args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`
}

function throwPluginCommandError(args: string[], result: PluginOpenClawResult, redactSensitiveText: (value: string) => string): never {
  const detail = redactSensitiveText(stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim() || `${pluginCommandString(args)} exited ${result.code}`)
  const error = new Error(detail)
  ;(error as Error & { code?: number }).code = result.code
  throw error
}

function pluginInspectSurfaceValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const values = value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (!isLooseRecord(entry)) return ''
      return stringField(entry, ['id', 'name', 'method', 'path', 'route', 'command', 'service', 'type'])
    })
    .filter((entry) => entry.trim().length > 0)
  return uniqueStrings(...values).slice(0, 12)
}

function pluginInspectNestedRecord(raw: unknown, key: string): unknown {
  if (!isLooseRecord(raw)) return undefined
  if (raw[key] !== undefined) return raw[key]
  for (const nestedKey of ['runtime', 'plugin', 'inspect', 'registrations', 'surfaces']) {
    const nested = raw[nestedKey]
    if (isLooseRecord(nested) && nested[key] !== undefined) return nested[key]
  }
  return undefined
}

function summarizePluginRuntimeInspect(raw: unknown): {
  status: string
  runtimeLoaded: boolean | null
  surfaces: PluginRuntimeSurfaceSummary[]
} {
  const status = isLooseRecord(raw)
    ? stringField(raw, ['status', 'state', 'runtimeStatus']) ||
      (isLooseRecord(raw.runtime) ? stringField(raw.runtime, ['status', 'state', 'runtimeStatus']) : '')
    : ''
  const runtimeLoaded = isLooseRecord(raw)
    ? typeof raw.runtimeLoaded === 'boolean'
      ? raw.runtimeLoaded
      : isLooseRecord(raw.runtime) && typeof raw.runtime.loaded === 'boolean'
        ? raw.runtime.loaded
        : null
    : null
  const surfaceKeys: Array<[string, string[]]> = [
    ['Tools', ['tools', 'toolIds']],
    ['Hooks', ['hooks', 'hookIds']],
    ['Services', ['services', 'serviceIds']],
    ['Gateway', ['gatewayMethods', 'methods']],
    ['HTTP', ['httpRoutes', 'routes']],
    ['Commands', ['commands', 'cliCommands', 'commandAliases']],
    ['Providers', ['providers', 'providerIds']],
    ['Channels', ['channels', 'channelIds']],
  ]
  const surfaces = surfaceKeys
    .map(([label, keys]) => ({
      label,
      values: uniqueStrings(...keys.flatMap((key) => pluginInspectSurfaceValues(pluginInspectNestedRecord(raw, key)))).slice(0, 12),
    }))
    .filter((entry) => entry.values.length > 0)

  return {
    status: status || (runtimeLoaded === true ? 'loaded' : runtimeLoaded === false ? 'not loaded' : 'checked'),
    runtimeLoaded,
    surfaces,
  }
}

function compactTerminalOutput(current: string, chunk: string) {
  const next = `${current}${chunk}`
  if (next.length <= PLUGIN_SETUP_TERMINAL_MAX_BUFFER_CHARS) return next
  return next.slice(next.length - PLUGIN_SETUP_TERMINAL_MAX_BUFFER_CHARS)
}

function terminalCommandLine(args: string[]) {
  return ['openclaw', ...args].join(' ')
}

function pluginSetupTerminalSnapshot(session: PluginSetupTerminalSession): PluginSetupTerminalSnapshot {
  return {
    id: session.id,
    command: session.command,
    commandLine: session.commandLine,
    title: session.title,
    pluginId: session.pluginId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    exitCode: session.exitCode,
    pid: session.pid,
  }
}

function emitPluginSetupTerminal(session: PluginSetupTerminalSession, event: PluginSetupTerminalEvent, payload: unknown) {
  for (const client of session.clients) client(event, payload)
}

export function createPluginRuntimeService(options: PluginRuntimeServiceOptions): PluginRuntimeService {
  const pluginSetupTerminalSessions = new Map<string, PluginSetupTerminalSession>()
  let cachedPtyModule: PluginRuntimePtyModule | null = null
  let warnedPlainTerminalFallback = false

  function createPlainProcessTerminalModule(reason: unknown): PluginRuntimePtyModule {
    if (!warnedPlainTerminalFallback) {
      warnedPlainTerminalFallback = true
      options.warn?.('[plugins/setup-terminal] PTY runtime unavailable; using plain process fallback', reason)
    }
    return {
      spawn(command, args, spawnOptions) {
        const child = spawn(command, args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env,
          shell: false,
          stdio: 'pipe',
          ...(process.platform === 'win32' ? { windowsHide: true } : {}),
        })
        return {
          pid: child.pid ?? 0,
          write(data: string) {
            child.stdin?.write(data)
          },
          resize() {
            // Plain process fallback has no PTY viewport to resize.
          },
          kill() {
            child.kill()
          },
          onData(callback: (data: string) => void) {
            const onStdout = (chunk: Buffer) => callback(chunk.toString())
            const onStderr = (chunk: Buffer) => callback(chunk.toString())
            child.stdout?.on('data', onStdout)
            child.stderr?.on('data', onStderr)
            return {
              dispose: () => {
                child.stdout?.off('data', onStdout)
                child.stderr?.off('data', onStderr)
              },
            }
          },
          onExit(callback: (event: { exitCode: number; signal?: number }) => void) {
            const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
              callback({ exitCode: code ?? (signal ? 1 : 0), signal: signal ? 1 : undefined })
            }
            child.once('close', onClose)
            return {
              dispose: () => {
                child.off('close', onClose)
              },
            }
          },
        }
      },
    }
  }

  function loadPtyModule(): PluginRuntimePtyModule {
    if (options.loadPtyModule) return options.loadPtyModule()
    if (cachedPtyModule) return cachedPtyModule
    try {
      cachedPtyModule = optionalRequire('node-pty') as PluginRuntimePtyModule
      return cachedPtyModule
    } catch (error) {
      cachedPtyModule = createPlainProcessTerminalModule(error)
      return cachedPtyModule
    }
  }

  function terminalSpawnEnv(): Record<string, string> {
    const env = options.openClawProcessEnv({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
    })
    return Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  }

  async function inspectOpenClawPluginRuntime(pluginId: string): Promise<PluginRuntimeInspectResult> {
    const id = pluginId.trim().toLowerCase()
    if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')
    const args = ['plugins', 'inspect', id, '--runtime', '--json']
    const command = await options.runOpenClaw(args, 120_000)
    if (command.code !== 0) throwPluginCommandError(args, command, options.redactSensitiveText)
    const raw = parseOpenClawJsonOutput(command.stdout)
    const summary = summarizePluginRuntimeInspect(raw)
    return {
      pluginId: id,
      command: pluginCommandResult(args, command, options.redactSensitiveText),
      raw,
      ...summary,
    }
  }

  function pluginRuntimeInspectReady(inspect: PluginRuntimeInspectResult) {
    const status = inspect.status.trim().toLowerCase()
    return inspect.runtimeLoaded !== false && !/\b(?:failed|error|not loaded|missing)\b/.test(status)
  }

  function schedulePluginSetupTerminalCleanup(sessionId: string) {
    const timeout = setTimeout(() => {
      const session = pluginSetupTerminalSessions.get(sessionId)
      if (!session || session.status === 'running') return
      session.dataDisposable?.dispose()
      session.exitDisposable?.dispose()
      pluginSetupTerminalSessions.delete(sessionId)
    }, PLUGIN_SETUP_TERMINAL_RETAIN_MS)
    timeout.unref?.()
  }

  function startPluginSetupTerminalSession(params: {
    command: PluginSetupTerminalCommand
    pluginId?: string
    cols?: number
    rows?: number
  }): PluginSetupTerminalSnapshot {
    const commandInfo = PLUGIN_SETUP_TERMINAL_COMMANDS[params.command]
    const args = commandInfo.args
    const spec = options.openClawSpawnSpec(args)
    const pty = loadPtyModule()
    const now = new Date().toISOString()
    const processHandle = pty.spawn(spec.command, [...spec.args], {
      name: 'xterm-256color',
      cols: Math.max(40, Math.min(180, Math.floor(params.cols || 96))),
      rows: Math.max(10, Math.min(60, Math.floor(params.rows || 20))),
      cwd: options.workspaceRoot,
      env: terminalSpawnEnv(),
      useConpty: process.platform === 'win32',
    })
    const session: PluginSetupTerminalSession = {
      id: randomUUID(),
      command: params.command,
      commandLine: terminalCommandLine(args),
      title: params.pluginId ? `${commandInfo.label}: ${params.pluginId}` : commandInfo.label,
      pluginId: params.pluginId,
      createdAt: now,
      updatedAt: now,
      status: 'running',
      pid: processHandle.pid,
      output: '',
      process: processHandle,
      clients: new Set(),
    }
    session.dataDisposable = processHandle.onData((data) => {
      session.updatedAt = new Date().toISOString()
      session.output = compactTerminalOutput(session.output, data)
      emitPluginSetupTerminal(session, 'data', { data })
    })
    session.exitDisposable = processHandle.onExit((event) => {
      session.updatedAt = new Date().toISOString()
      session.exitCode = event.exitCode
      session.status = event.exitCode === 0 ? 'completed' : 'failed'
      emitPluginSetupTerminal(session, 'status', { session: pluginSetupTerminalSnapshot(session) })
      schedulePluginSetupTerminalCleanup(session.id)
    })
    pluginSetupTerminalSessions.set(session.id, session)
    return pluginSetupTerminalSnapshot(session)
  }

  function getPluginSetupTerminalSnapshot(sessionId: string) {
    const session = pluginSetupTerminalSessions.get(sessionId)
    return session ? pluginSetupTerminalSnapshot(session) : null
  }

  function attachPluginSetupTerminalClient(sessionId: string, client: PluginSetupTerminalClient): PluginSetupTerminalAttachment | null {
    const session = pluginSetupTerminalSessions.get(sessionId)
    if (!session) return null
    session.clients.add(client)
    return {
      session: pluginSetupTerminalSnapshot(session),
      output: session.output,
      detach: () => {
        session.clients.delete(client)
      },
    }
  }

  function writePluginSetupTerminalInput(sessionId: string, data: string): PluginSetupTerminalOperationResult {
    const session = pluginSetupTerminalSessions.get(sessionId)
    if (!session) return { ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }
    if (session.status !== 'running') return { ok: false, reason: 'not_running', message: 'Setup terminal is not running.' }
    session.process.write(data)
    session.updatedAt = new Date().toISOString()
    return { ok: true, session: pluginSetupTerminalSnapshot(session) }
  }

  function resizePluginSetupTerminalSession(sessionId: string, cols: number, rows: number): PluginSetupTerminalOperationResult {
    const session = pluginSetupTerminalSessions.get(sessionId)
    if (!session) return { ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }
    session.process.resize(cols, rows)
    session.updatedAt = new Date().toISOString()
    return { ok: true, session: pluginSetupTerminalSnapshot(session) }
  }

  function stopPluginSetupTerminalSession(sessionId: string, reason = 'plugin setup terminal stop'): PluginSetupTerminalOperationResult {
    const session = pluginSetupTerminalSessions.get(sessionId)
    if (!session) return { ok: false, reason: 'not_found', message: 'Setup terminal session not found.' }
    if (session.status === 'running') {
      session.status = 'stopped'
      session.updatedAt = new Date().toISOString()
      try {
        session.process.kill()
      } catch {
        // Process may already be gone.
      }
      void options.terminateProcessTree(session.pid, reason, true)
    }
    session.dataDisposable?.dispose()
    session.exitDisposable?.dispose()
    emitPluginSetupTerminal(session, 'status', { session: pluginSetupTerminalSnapshot(session) })
    schedulePluginSetupTerminalCleanup(session.id)
    return { ok: true, session: pluginSetupTerminalSnapshot(session) }
  }

  function stopAllPluginSetupTerminalSessions(reason = 'control center shutdown') {
    let stopped = 0
    for (const session of Array.from(pluginSetupTerminalSessions.values())) {
      if (session.status === 'running') stopped += 1
      stopPluginSetupTerminalSession(session.id, `${reason}: plugin setup terminal cleanup`)
      session.clients.clear()
      pluginSetupTerminalSessions.delete(session.id)
    }
    return stopped
  }

  return {
    inspectOpenClawPluginRuntime,
    pluginRuntimeInspectReady,
    startPluginSetupTerminalSession,
    getPluginSetupTerminalSnapshot,
    attachPluginSetupTerminalClient,
    writePluginSetupTerminalInput,
    resizePluginSetupTerminalSession,
    stopPluginSetupTerminalSession,
    stopAllPluginSetupTerminalSessions,
  }
}

import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type PluginControlEntryLike = {
  id: string
} & Record<string, unknown>

type PluginControlsPayload = {
  plugins: PluginControlEntryLike[]
  configPath: string
  cache: unknown
  cliError?: string
}

type GatewayRestartResult = {
  restarted: boolean
  detail: string
}

type GatewayRestartRequest = GatewayRestartResult & {
  scheduled: boolean
}

type PluginInstallResult = {
  install: unknown
  activation?: unknown
  repair?: unknown
  postInstallRepair?: unknown
  plugin: unknown
  restart: unknown
  controls: PluginControlsPayload
}

type PluginCommandResult = {
  command: unknown
  plugin?: unknown
  restart: unknown
  controls: PluginControlsPayload
}

type PluginToggleResult = PluginCommandResult & {
  registryRefresh: unknown
}

type ClawTalkSetupResult = {
  installResult?: PluginInstallResult | null
  setup: unknown
  doctor: { command: unknown }
  inspect: unknown
  restart: unknown
  controls: PluginControlsPayload
}

type PluginSetupTerminalCommand = 'plugins' | 'model' | 'full' | 'doctor' | 'registry'
type PluginSetupTerminalStatus = 'running' | 'completed' | 'failed' | 'stopped'
type PluginSetupTerminalEvent = 'data' | 'status'
type PluginSetupTerminalClient = (event: PluginSetupTerminalEvent, payload: unknown) => void

type PluginSetupTerminalSession = {
  id: string
  command: PluginSetupTerminalCommand
  commandLine: string
  title: string
  pluginId?: string
  createdAt: string
  output: string
  status: PluginSetupTerminalStatus
  exitCode?: number
  pid?: number
  updatedAt: string
  process: {
    pid: number
    write: (data: string) => void
    resize: (cols: number, rows: number) => void
    kill: () => void
    onData: (callback: (data: string) => void) => { dispose: () => void }
    onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  }
  clients: Set<PluginSetupTerminalClient>
}

type PluginSetupTerminalSnapshot = {
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

type PluginRoutesOptions = {
  clawTalkPluginId: string
  invalidateRuntimeStatusCache: () => void
  inspectOpenClawPluginRuntime: (pluginId: string) => Promise<unknown>
  installOpenClawPlugin: (params: {
    spec: string
    pluginId?: string
    pin: boolean
    enable: boolean
    force: boolean
    restart: boolean
  }) => Promise<PluginInstallResult>
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  pluginErrorDetail: (error: unknown) => string
  pluginErrorStatus: (error: unknown) => number
  pluginIdPattern: RegExp
  pluginRuntimeStatePath: string
  pluginSetupTerminalSessions: Map<string, PluginSetupTerminalSession>
  pluginSetupTerminalSnapshot: (session: PluginSetupTerminalSession) => PluginSetupTerminalSnapshot
  redactSensitiveText: (value: string) => string
  savePluginDirectConfig: (pluginId: string, values: Record<string, string>, providerAuth: Record<string, string>) => Promise<void>
  schedulePluginGatewayRestart: () => GatewayRestartRequest
  searchOpenClawPlugins: (query: string, limit: number) => Promise<unknown>
  setOpenClawPluginEnabledForControlCenter: (
    pluginId: string,
    enabled: boolean,
    options: { restart: boolean; immediateRestart: boolean },
  ) => Promise<PluginToggleResult>
  setupClawTalkPlugin: (params: {
    apiKey: string
    server?: string
    install: boolean
    restart: boolean
  }) => Promise<ClawTalkSetupResult>
  startPluginSetupTerminalSession: (params: {
    command: PluginSetupTerminalCommand
    pluginId?: string
    cols?: number
    rows?: number
  }) => PluginSetupTerminalSession
  stopPluginSetupTerminalSession: (session: PluginSetupTerminalSession) => void
  tryRestartGatewayService: (options: { force?: boolean; allowExternalTakeover?: boolean }) => Promise<GatewayRestartResult>
  uninstallOpenClawPlugin: (pluginId: string, options: { keepFiles: boolean; force: boolean; restart: boolean }) => Promise<PluginCommandResult>
  updateAllOpenClawPlugins: (restartRequested: boolean) => Promise<PluginCommandResult>
  updateOpenClawPlugin: (pluginId: string, restartRequested: boolean) => Promise<PluginCommandResult>
  writeSseEvent: (res: { write: (chunk: string) => unknown }, event: string, data: Record<string, unknown>) => void
}

function pluginResponseDetails(controls: PluginControlsPayload) {
  return {
    plugins: controls.plugins,
    configPath: controls.configPath,
    cache: controls.cache,
    ...(controls.cliError ? { cliError: controls.cliError } : {}),
  }
}

export function registerPluginRoutes(app: Express, options: PluginRoutesOptions) {
  app.get('/api/plugins', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true'
      return apiSuccess(res, await options.listPluginControls({ forceRefresh }))
    } catch (error) {
      return apiFailure(res, 500, 'plugin_operation_failed', 'Failed to list plugins', options.pluginErrorDetail(error))
    }
  })

  app.get('/api/plugins/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const limitRaw = Number(req.query.limit || 20)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.round(limitRaw))) : 20
    if (!query) return apiSuccess(res, { results: [] })

    try {
      return apiSuccess(res, await options.searchOpenClawPlugins(query, limit))
    } catch (error) {
      return apiFailure(res, 502, 'plugin_command_failed', 'Plugin search failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/install', async (req, res) => {
    const schema = z.object({
      spec: z.string().trim().min(1).max(320),
      pluginId: z.string().regex(options.pluginIdPattern).optional(),
      pin: z.boolean().optional().default(true),
      enable: z.boolean().optional().default(true),
      force: z.boolean().optional().default(false),
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.installOpenClawPlugin(parsed.data)
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        install: result.install,
        activation: result.activation,
        repair: result.repair,
        postInstallRepair: result.postInstallRepair,
        plugin: result.plugin,
        restart: result.restart,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin install failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/update-all', async (req, res) => {
    const schema = z.object({
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.updateAllOpenClawPlugins(parsed.data.restart)
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        command: result.command,
        restart: result.restart,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin update failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/gateway/restart', async (_req, res) => {
    try {
      const restart = {
        ...(await options.tryRestartGatewayService({ force: true })),
        scheduled: false,
      }
      options.invalidateRuntimeStatusCache()
      const controls = await options.listPluginControls()
      return apiSuccess(res, {
        restart,
        ...pluginResponseDetails(controls),
      })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_operation_failed', 'Gateway restart failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/clawtalk/setup', async (req, res) => {
    const schema = z.object({
      apiKey: z.string().trim().min(1).max(512),
      server: z.string().trim().max(320).optional(),
      install: z.boolean().optional().default(true),
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.setupClawTalkPlugin(parsed.data)
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        install: result.installResult?.install,
        activation: result.installResult?.activation,
        repair: result.installResult?.repair,
        postInstallRepair: result.installResult?.postInstallRepair,
        clawTalkSetup: result.setup,
        doctor: result.doctor.command,
        inspect: result.inspect,
        plugin: result.controls.plugins.find((entry) => entry.id === options.clawTalkPluginId) || null,
        restart: result.restart,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      const message = String(error)
      const status = /valid ClawTalk API key|server must be/i.test(message)
        ? 400
        : typeof (error as Error & { code?: unknown }).code === 'number'
          ? 502
          : 500
      return apiFailure(
        res,
        status,
        status === 400 ? 'invalid_payload' : 'plugin_command_failed',
        'ClawTalk setup failed',
        options.redactSensitiveText(message),
      )
    }
  })

  app.post('/api/plugins/:pluginId/update', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }
    const schema = z.object({
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.updateOpenClawPlugin(pluginId, parsed.data.restart)
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        command: result.command,
        plugin: result.plugin,
        restart: result.restart,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin update failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/:pluginId/uninstall', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }
    const schema = z.object({
      keepFiles: z.boolean().optional().default(false),
      force: z.boolean().optional().default(true),
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.uninstallOpenClawPlugin(pluginId, parsed.data)
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        command: result.command,
        plugin: null,
        restart: result.restart,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin uninstall failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/:pluginId/inspect', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }

    try {
      const inspect = await options.inspectOpenClawPluginRuntime(pluginId)
      const controls = await options.listPluginControls()
      return apiSuccess(res, {
        inspect,
        plugin: controls.plugins.find((entry) => entry.id === pluginId) || null,
        ...pluginResponseDetails(controls),
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin runtime inspect failed', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/:pluginId/config', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }

    const schema = z.object({
      values: z.record(z.string(), z.string().max(20_000)).optional().default({}),
      providerAuth: z.record(z.string(), z.string().max(20_000)).optional().default({}),
      restart: z.boolean().optional().default(true),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await options.savePluginDirectConfig(pluginId, parsed.data.values, parsed.data.providerAuth)
      options.invalidateRuntimeStatusCache()
      const restart = parsed.data.restart ? options.schedulePluginGatewayRestart() : { restarted: false, scheduled: false, detail: 'gateway restart skipped' }
      const controls = await options.listPluginControls()
      return apiSuccess(res, {
        plugin: controls.plugins.find((entry) => entry.id === pluginId) || null,
        restart,
        ...pluginResponseDetails(controls),
      })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_operation_failed', 'Failed to save plugin config', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/setup-terminal', async (req, res) => {
    const schema = z.object({
      command: z.enum(['plugins', 'model', 'full', 'doctor', 'registry']).optional().default('plugins'),
      pluginId: z.string().regex(options.pluginIdPattern).optional(),
      cols: z.number().int().min(40).max(180).optional(),
      rows: z.number().int().min(10).max(60).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const session = options.startPluginSetupTerminalSession(parsed.data)
      return apiSuccess(res, { session: options.pluginSetupTerminalSnapshot(session) })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to start setup terminal', options.pluginErrorDetail(error))
    }
  })

  app.get('/api/plugins/setup-terminal/:sessionId/stream', (req, res) => {
    const session = options.pluginSetupTerminalSessions.get(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    options.writeSseEvent(res, 'snapshot', {
      session: options.pluginSetupTerminalSnapshot(session),
      output: session.output,
    })

    const client: PluginSetupTerminalClient = (event, payload) => {
      options.writeSseEvent(res, event, payload && typeof payload === 'object' ? payload as Record<string, unknown> : { value: payload })
    }
    session.clients.add(client)

    const heartbeat = setInterval(() => options.writeSseEvent(res, 'heartbeat', { at: new Date().toISOString() }), 20_000)
    heartbeat.unref?.()
    req.on('close', () => {
      clearInterval(heartbeat)
      session.clients.delete(client)
    })
  })

  app.post('/api/plugins/setup-terminal/:sessionId/input', (req, res) => {
    const session = options.pluginSetupTerminalSessions.get(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')
    if (session.status !== 'running') return apiFailure(res, 409, 'plugin_terminal_failed', 'Setup terminal is not running.')

    const schema = z.object({ data: z.string().max(20_000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      session.process.write(parsed.data.data)
      session.updatedAt = new Date().toISOString()
      return apiSuccess(res, { session: options.pluginSetupTerminalSnapshot(session) })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to write terminal input', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/setup-terminal/:sessionId/resize', (req, res) => {
    const session = options.pluginSetupTerminalSessions.get(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')

    const schema = z.object({
      cols: z.number().int().min(40).max(180),
      rows: z.number().int().min(10).max(60),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      session.process.resize(parsed.data.cols, parsed.data.rows)
      session.updatedAt = new Date().toISOString()
      return apiSuccess(res, { session: options.pluginSetupTerminalSnapshot(session) })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to resize setup terminal', options.pluginErrorDetail(error))
    }
  })

  app.delete('/api/plugins/setup-terminal/:sessionId', (req, res) => {
    const session = options.pluginSetupTerminalSessions.get(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')
    options.stopPluginSetupTerminalSession(session)
    return apiSuccess(res, { session: options.pluginSetupTerminalSnapshot(session) })
  })

  app.post('/api/plugins/:pluginId', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }

    const schema = z.object({
      enabled: z.boolean(),
      restart: z.boolean().optional().default(false),
      immediateRestart: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = await options.setOpenClawPluginEnabledForControlCenter(pluginId, parsed.data.enabled, {
        restart: parsed.data.restart,
        immediateRestart: parsed.data.immediateRestart,
      })
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        command: result.command,
        plugin: result.controls.plugins.find((entry) => entry.id === pluginId) || null,
        restart: result.restart,
        registryRefresh: result.registryRefresh,
        ...pluginResponseDetails(result.controls),
        runtimeStatePath: options.pluginRuntimeStatePath,
      })
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Failed to update plugin', options.pluginErrorDetail(error))
    }
  })
}

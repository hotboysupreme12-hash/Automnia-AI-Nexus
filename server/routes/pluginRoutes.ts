import type { Express, Response } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { missingRequiredPluginConfigFields, pluginIdFromPackageName } from '../services/plugins/pluginInventoryService'
import { createPluginActionLedgerService, type PluginActionKind, type PluginActionLedgerEntry } from '../services/plugins/pluginActionLedgerService'
import type { PluginRuntimeService, PluginSetupTerminalClient } from '../services/plugins/pluginRuntimeService'

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
  activationBlocked?: unknown
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

export type PluginRepairPolicy = {
  maxAttempts: number
  cooldownMs: number
  now: () => Date
}

export const DEFAULT_PLUGIN_REPAIR_POLICY = {
  maxAttempts: 3,
  cooldownMs: 30_000,
} as const

type PluginRepairAttemptResult = {
  entry: PluginActionLedgerEntry
  command?: unknown
  error?: unknown
}

type PluginRoutesOptions = {
  clawTalkPluginId: string
  isCreditsOnlyEntitlement?: () => boolean
  invalidateRuntimeStatusCache: () => void
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
  pluginRuntime: PluginRuntimeService
  pluginRuntimeStatePath: string
  pluginRepairPolicy?: Partial<PluginRepairPolicy>
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
  tryRestartGatewayService: (options: { force?: boolean; allowExternalTakeover?: boolean; reason?: string }) => Promise<GatewayRestartResult>
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

function pluginRepairFailureDisposition(error: unknown): {
  outcome: 'failed' | 'uncertain'
  retryable: boolean
  summary: string
} {
  const failure = error && typeof error === 'object'
    ? error as { code?: unknown; timedOut?: unknown; failureKind?: unknown }
    : {}
  if (failure.timedOut === true || failure.failureKind === 'timeout') {
    return {
      outcome: 'uncertain',
      retryable: false,
      summary: 'Plugin reload outcome is uncertain after timeout; inspect plugin status before acting again.',
    }
  }

  const processStartErrors = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ENOEXEC', 'E2BIG', 'ENAMETOOLONG'])
  const code = typeof failure.code === 'string' ? failure.code.toUpperCase() : ''
  if (processStartErrors.has(code)) {
    return {
      outcome: 'failed',
      retryable: true,
      summary: 'Plugin reload process did not start; a manual retry may be safe after correcting the process launch issue.',
    }
  }

  return {
    outcome: 'uncertain',
    retryable: false,
    summary: 'Plugin reload may have been accepted; inspect plugin status before retrying.',
  }
}

function pluginRepairBudgetDetails(params: {
  attempt: number
  maxAttempts: number
  retryable: boolean
  terminal: boolean
  retryAfterAt?: string
}) {
  return {
    attempt: params.attempt,
    maxAttempts: params.maxAttempts,
    remainingAttempts: Math.max(0, params.maxAttempts - params.attempt),
    retryable: params.retryable,
    terminal: params.terminal,
    ...(params.retryAfterAt ? { retryAfterAt: params.retryAfterAt } : {}),
  }
}

export function registerPluginRoutes(app: Express, options: PluginRoutesOptions) {
  const repairPolicy = {
    maxAttempts: Math.max(1, Math.min(3, Math.round(options.pluginRepairPolicy?.maxAttempts ?? DEFAULT_PLUGIN_REPAIR_POLICY.maxAttempts))),
    cooldownMs: Math.max(0, Math.min(30 * 60_000, Math.round(options.pluginRepairPolicy?.cooldownMs ?? DEFAULT_PLUGIN_REPAIR_POLICY.cooldownMs))),
    now: options.pluginRepairPolicy?.now || (() => new Date()),
  }
  const actionLedger = createPluginActionLedgerService(
    path.join(path.dirname(options.pluginRuntimeStatePath), 'plugin-actions.jsonl'),
    repairPolicy.now,
  )
  const repairInFlight = new Map<string, Promise<PluginRepairAttemptResult>>()

  async function runAuditedPluginAction<T>(action: PluginActionKind, pluginId: string, run: () => Promise<T>) {
    const actionId = randomUUID()
    await actionLedger.append({ actionId, action, pluginId, outcome: 'started', summary: `${action} request accepted.` })
    let result: T
    try {
      result = await run()
    } catch (error) {
      await actionLedger.append({ actionId, action, pluginId, outcome: 'failed', summary: `${action} failed.` }).catch(() => undefined)
      throw error
    }
    await actionLedger.append({ actionId, action, pluginId, outcome: 'succeeded', summary: `${action} completed.` })
    return result
  }

  async function requirePluginControl(pluginId: string, res: Response): Promise<PluginControlsPayload | null> {
    try {
      const controls = await options.listPluginControls()
      const plugin = controls.plugins.find((entry) => entry.id === pluginId)
      if (!plugin) {
        apiFailure(res, 404, 'plugin_not_found', 'Plugin not found', { pluginId })
        return null
      }
      return controls
    } catch (error) {
      apiFailure(res, 500, 'plugin_operation_failed', 'Failed to verify plugin', options.pluginErrorDetail(error))
      return null
    }
  }

  app.get('/api/plugins', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true'
      const controls = await options.listPluginControls({ forceRefresh })
      const actionLedgerTail = await actionLedger.readTail(100)
      return apiSuccess(res, { ...controls, actionLedger: actionLedgerTail })
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
      const suggestedPluginId = parsed.data.pluginId || pluginIdFromPackageName(parsed.data.spec)
      const pluginId = options.pluginIdPattern.test(suggestedPluginId) ? suggestedPluginId : 'unspecified'
      const result = await runAuditedPluginAction('install', pluginId, () => options.installOpenClawPlugin(parsed.data))
      options.invalidateRuntimeStatusCache()
      return apiSuccess(res, {
        install: result.install,
        activation: result.activation,
        activationBlocked: result.activationBlocked,
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
      const result = await runAuditedPluginAction('update-all', '*', () => options.updateAllOpenClawPlugins(parsed.data.restart))
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
        ...(await options.tryRestartGatewayService({ force: true, reason: 'plugin workspace requested gateway restart' })),
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
      const result = parsed.data.install
        ? await runAuditedPluginAction('install', options.clawTalkPluginId, () => options.setupClawTalkPlugin(parsed.data))
        : await options.setupClawTalkPlugin(parsed.data)
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
      if (!await requirePluginControl(pluginId, res)) return
      const result = await runAuditedPluginAction('update', pluginId, () => options.updateOpenClawPlugin(pluginId, parsed.data.restart))
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

  app.post('/api/plugins/:pluginId/repair', async (req, res) => {
    const pluginId = (req.params.pluginId || '').trim().toLowerCase()
    if (!options.pluginIdPattern.test(pluginId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid plugin id.')
    }
    const schema = z.object({
      failureClass: z.literal('loader_error'),
      retry: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Unsupported plugin repair class.', parsed.error.flatten())

    try {
      const idempotencyKey = createHash('sha256').update(`plugin-repair\0${pluginId}\0${parsed.data.failureClass}`).digest('hex')
      const pendingBeforeRead = repairInFlight.get(idempotencyKey)
      if (pendingBeforeRead) {
        const previous = await pendingBeforeRead
        if (previous.error !== undefined) {
          return apiFailure(res, options.pluginErrorStatus(previous.error), 'plugin_command_failed', 'Plugin repair failed', {
            error: options.pluginErrorDetail(previous.error),
            repair: pluginRepairBudgetDetails({
              attempt: previous.entry.attempt || 1,
              maxAttempts: repairPolicy.maxAttempts,
              retryable: previous.entry.retryable === true,
              terminal: previous.entry.terminal !== false,
            }),
            deduped: true,
          })
        }
        return apiSuccess(res, { deduped: true, repair: previous.entry, command: previous.command })
      }

      const history = await actionLedger.readRepairHistory(idempotencyKey)
      if (!history.complete) {
        return apiFailure(res, 503, 'plugin_command_failed', 'Plugin repair history is incomplete; no retry was started.', {
          repair: { terminal: true, reason: 'history_incomplete', maxAttempts: repairPolicy.maxAttempts },
        })
      }

      const starts = history.entries.filter((entry) => entry.outcome === 'started')
      const attemptsUsed = starts.length
      const latestStart = starts.at(-1)
      const latestResult = latestStart
        ? history.entries.slice().reverse().find((entry) => entry.actionId === latestStart.actionId && entry.outcome !== 'started')
        : undefined

      const secondPendingCheck = repairInFlight.get(idempotencyKey)
      if (secondPendingCheck) {
        const previous = await secondPendingCheck
        if (previous.error !== undefined) {
          return apiFailure(res, options.pluginErrorStatus(previous.error), 'plugin_command_failed', 'Plugin repair failed', {
            error: options.pluginErrorDetail(previous.error),
            repair: pluginRepairBudgetDetails({
              attempt: previous.entry.attempt || 1,
              maxAttempts: repairPolicy.maxAttempts,
              retryable: previous.entry.retryable === true,
              terminal: previous.entry.terminal !== false,
            }),
            deduped: true,
          })
        }
        return apiSuccess(res, { deduped: true, repair: previous.entry, command: previous.command })
      }

      if (latestResult?.outcome === 'succeeded') {
        return apiSuccess(res, {
          deduped: true,
          repair: latestResult,
          command: { command: `openclaw plugins reload ${pluginId} --wait --json`, code: 0, output: latestResult.summary || 'Plugin reload already completed.' },
        })
      }

      if (latestStart && (!latestResult || latestResult.outcome === 'uncertain' || latestResult.retryable !== true)) {
        return apiFailure(res, 409, 'plugin_command_failed', 'The previous plugin reload may still have taken effect. Inspect plugin status before starting another action.', {
          repair: pluginRepairBudgetDetails({
            attempt: attemptsUsed,
            maxAttempts: repairPolicy.maxAttempts,
            retryable: false,
            terminal: true,
          }),
          actionId: latestStart.actionId,
          outcome: latestResult?.outcome || 'started',
        })
      }

      if (parsed.data.retry && !latestResult) {
        return apiFailure(res, 409, 'plugin_command_failed', 'There is no prior safe failed attempt to retry.', {
          repair: pluginRepairBudgetDetails({ attempt: 0, maxAttempts: repairPolicy.maxAttempts, retryable: false, terminal: true }),
        })
      }

      if (latestResult?.outcome === 'failed') {
        if (attemptsUsed >= repairPolicy.maxAttempts || latestResult.terminal === true) {
          return apiFailure(res, 409, 'plugin_command_failed', 'The plugin repair retry budget is exhausted.', {
            repair: pluginRepairBudgetDetails({ attempt: attemptsUsed, maxAttempts: repairPolicy.maxAttempts, retryable: false, terminal: true }),
          })
        }
        if (!parsed.data.retry) {
          return apiFailure(res, 409, 'plugin_command_failed', 'A retry must be explicitly requested after a safe process-start failure.', {
            repair: pluginRepairBudgetDetails({ attempt: attemptsUsed, maxAttempts: repairPolicy.maxAttempts, retryable: true, terminal: false }),
          })
        }
        const retryAt = Date.parse(latestResult.timestamp) + repairPolicy.cooldownMs
        if (repairPolicy.now().getTime() < retryAt) {
          return apiFailure(res, 429, 'plugin_command_failed', 'Plugin repair is cooling down before the next manual attempt.', {
            repair: pluginRepairBudgetDetails({
              attempt: attemptsUsed,
              maxAttempts: repairPolicy.maxAttempts,
              retryable: true,
              terminal: false,
              retryAfterAt: new Date(retryAt).toISOString(),
            }),
          })
        }
      }

      if (!latestStart && parsed.data.retry) {
        return apiFailure(res, 409, 'plugin_command_failed', 'There is no prior repair attempt to retry.', {
          repair: pluginRepairBudgetDetails({ attempt: 0, maxAttempts: repairPolicy.maxAttempts, retryable: false, terminal: true }),
        })
      }

      const controls = await requirePluginControl(pluginId, res)
      if (!controls) return
      const plugin = controls.plugins.find((entry) => entry.id === pluginId)
      if (!plugin?.enabled || !plugin.loaderErrorSummary) {
        return apiFailure(res, 409, 'plugin_command_failed', 'A repairable loader failure is not currently reported for this enabled plugin. Refresh plugin status and inspect it first.')
      }

      const pendingBeforeStart = repairInFlight.get(idempotencyKey)
      if (pendingBeforeStart) {
        const previous = await pendingBeforeStart
        if (previous.error !== undefined) {
          return apiFailure(res, options.pluginErrorStatus(previous.error), 'plugin_command_failed', 'Plugin repair failed', {
            error: options.pluginErrorDetail(previous.error),
            repair: pluginRepairBudgetDetails({
              attempt: previous.entry.attempt || 1,
              maxAttempts: repairPolicy.maxAttempts,
              retryable: previous.entry.retryable === true,
              terminal: previous.entry.terminal !== false,
            }),
            deduped: true,
          })
        }
        return apiSuccess(res, { deduped: true, repair: previous.entry, command: previous.command })
      }

      const attempt = attemptsUsed + 1
      const actionId = randomUUID()
      const actionPromise = (async () => {
        await actionLedger.append({
          actionId,
          action: 'repair',
          pluginId,
          outcome: 'started',
          failureClass: parsed.data.failureClass,
          idempotencyKey,
          attempt,
          retryable: false,
          terminal: false,
          summary: 'Targeted plugin reload attempt started for a reported loader failure.',
        })
        try {
          const command = await options.pluginRuntime.repairPluginLoaderFailure(pluginId)
          const entry = await actionLedger.append({
            actionId,
            action: 'repair',
            pluginId,
            outcome: 'succeeded',
            failureClass: parsed.data.failureClass,
            idempotencyKey,
            attempt,
            retryable: false,
            terminal: true,
            summary: 'Targeted plugin reload completed.',
          })
          options.invalidateRuntimeStatusCache()
          return { command, entry }
        } catch (error) {
          const disposition = pluginRepairFailureDisposition(error)
          const terminal = disposition.outcome === 'uncertain' || attempt >= repairPolicy.maxAttempts
          const entry = await actionLedger.append({
            actionId,
            action: 'repair',
            pluginId,
            outcome: disposition.outcome,
            failureClass: parsed.data.failureClass,
            idempotencyKey,
            attempt,
            retryable: disposition.retryable,
            terminal,
            summary: terminal && disposition.retryable
              ? 'Plugin repair retry budget is exhausted.'
              : disposition.summary,
          })
          return { error, entry }
        }
      })()
      repairInFlight.set(idempotencyKey, actionPromise)
      try {
        const result = await actionPromise
        if (result.error !== undefined) {
          const retryAt = result.entry.retryable && !result.entry.terminal
            ? Date.parse(result.entry.timestamp) + repairPolicy.cooldownMs
            : undefined
          return apiFailure(res, options.pluginErrorStatus(result.error), 'plugin_command_failed', 'Plugin repair failed', {
            error: options.pluginErrorDetail(result.error),
            repair: pluginRepairBudgetDetails({
              attempt,
              maxAttempts: repairPolicy.maxAttempts,
              retryable: result.entry.retryable === true && result.entry.terminal !== true,
              terminal: result.entry.terminal === true,
              ...(retryAt !== undefined ? { retryAfterAt: new Date(retryAt).toISOString() } : {}),
            }),
          })
        }
        const refreshed = await options.listPluginControls({ forceRefresh: true }).catch(() => controls)
        return apiSuccess(res, {
          deduped: false,
          repair: result.entry,
          command: result.command,
          plugin: refreshed.plugins.find((entry) => entry.id === pluginId) || null,
          ...pluginResponseDetails(refreshed),
          runtimeStatePath: options.pluginRuntimeStatePath,
        })
      } finally {
        if (repairInFlight.get(idempotencyKey) === actionPromise) repairInFlight.delete(idempotencyKey)
      }
    } catch (error) {
      return apiFailure(res, options.pluginErrorStatus(error), 'plugin_command_failed', 'Plugin repair failed', options.pluginErrorDetail(error))
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
      if (!await requirePluginControl(pluginId, res)) return
      const result = await runAuditedPluginAction('uninstall', pluginId, () => options.uninstallOpenClawPlugin(pluginId, parsed.data))
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
      if (!await requirePluginControl(pluginId, res)) return
      const inspect = await options.pluginRuntime.inspectOpenClawPluginRuntime(pluginId)
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
    if (options.isCreditsOnlyEntitlement?.() && Object.keys(parsed.data.providerAuth).length > 0) {
      return apiFailure(res, 403, 'byok_not_allowed', 'Starter Subscription and credit-refill access cannot configure or use external provider credentials.')
    }

    try {
      if (!await requirePluginControl(pluginId, res)) return
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
    if (options.isCreditsOnlyEntitlement?.() && (parsed.data.command === 'model' || parsed.data.command === 'full')) {
      return apiFailure(res, 403, 'byok_not_allowed', 'Starter Subscription and credit-refill access cannot configure or use external provider models.')
    }

    try {
      if (parsed.data.pluginId && !await requirePluginControl(parsed.data.pluginId, res)) return
      const session = options.pluginRuntime.startPluginSetupTerminalSession(parsed.data)
      return apiSuccess(res, { session })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to start setup terminal', options.pluginErrorDetail(error))
    }
  })

  app.get('/api/plugins/setup-terminal/:sessionId/stream', (req, res) => {
    const client: PluginSetupTerminalClient = (event, payload) => {
      options.writeSseEvent(res, event, payload && typeof payload === 'object' ? payload as Record<string, unknown> : { value: payload })
    }
    const attachment = options.pluginRuntime.attachPluginSetupTerminalClient(req.params.sessionId, client)
    if (!attachment) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    options.writeSseEvent(res, 'snapshot', {
      session: attachment.session,
      output: attachment.output,
    })

    const heartbeat = setInterval(() => options.writeSseEvent(res, 'heartbeat', { at: new Date().toISOString() }), 20_000)
    heartbeat.unref?.()
    req.on('close', () => {
      clearInterval(heartbeat)
      attachment.detach()
    })
  })

  app.post('/api/plugins/setup-terminal/:sessionId/input', (req, res) => {
    const session = options.pluginRuntime.getPluginSetupTerminalSnapshot(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')
    if (session.status !== 'running') return apiFailure(res, 409, 'plugin_terminal_failed', 'Setup terminal is not running.')

    const schema = z.object({ data: z.string().max(20_000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = options.pluginRuntime.writePluginSetupTerminalInput(req.params.sessionId, parsed.data.data)
      if (!result.ok) {
        return apiFailure(res, result.reason === 'not_found' ? 404 : 409, result.reason === 'not_found' ? 'plugin_not_found' : 'plugin_terminal_failed', result.message)
      }
      return apiSuccess(res, { session: result.session })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to write terminal input', options.pluginErrorDetail(error))
    }
  })

  app.post('/api/plugins/setup-terminal/:sessionId/resize', (req, res) => {
    const session = options.pluginRuntime.getPluginSetupTerminalSnapshot(req.params.sessionId)
    if (!session) return apiFailure(res, 404, 'plugin_not_found', 'Setup terminal session not found.')

    const schema = z.object({
      cols: z.number().int().min(40).max(180),
      rows: z.number().int().min(10).max(60),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const result = options.pluginRuntime.resizePluginSetupTerminalSession(req.params.sessionId, parsed.data.cols, parsed.data.rows)
      if (!result.ok) {
        return apiFailure(res, result.reason === 'not_found' ? 404 : 409, result.reason === 'not_found' ? 'plugin_not_found' : 'plugin_terminal_failed', result.message)
      }
      return apiSuccess(res, { session: result.session })
    } catch (error) {
      return apiFailure(res, 500, 'plugin_terminal_failed', 'Failed to resize setup terminal', options.pluginErrorDetail(error))
    }
  })

  app.delete('/api/plugins/setup-terminal/:sessionId', (req, res) => {
    const result = options.pluginRuntime.stopPluginSetupTerminalSession(req.params.sessionId)
    if (!result.ok) return apiFailure(res, 404, 'plugin_not_found', result.message)
    return apiSuccess(res, { session: result.session })
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
      const controls = await requirePluginControl(pluginId, res)
      if (!controls) return
      if (parsed.data.enabled) {
        const plugin = controls.plugins.find((entry) => entry.id === pluginId)
        const missingFields = missingRequiredPluginConfigFields(plugin)
        if (missingFields.length) {
          return apiFailure(
            res,
            409,
            'plugin_configuration_required',
            'Configure the required plugin fields before enabling this plugin.',
            { pluginId, fields: missingFields },
          )
        }
      }
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

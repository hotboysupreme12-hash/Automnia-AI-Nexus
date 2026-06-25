import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type OpenClawResult = {
  stdout: string
  stderr: string
  code: number
  elapsedMs?: number
}

type PluginControlsPayload = {
  plugins: unknown[]
  configPath: string
  cache: unknown
  cliError?: string
}

type OpenClawCommandRoutesOptions = {
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

const OpenClawCommandSchema = z.object({
  command: z.string().trim().min(1).max(4000),
  timeoutSeconds: z.number().int().min(5).max(7200).optional().default(600),
  refreshPlugins: z.boolean().optional().default(true),
})

export function registerOpenClawCommandRoutes(app: Express, options: OpenClawCommandRoutesOptions) {
  app.get('/api/openclaw/summary', async (_req, res) => {
    try {
      const [status, gateway, cron, party] = await Promise.all([
        options.runOpenClaw(['status'], 90000),
        options.runOpenClaw(['config', 'get', 'gateway']),
        options.runOpenClaw(['cron', 'list']),
        options.getPartyMembers(),
      ])
      const parsedGateway = gateway.code === 0 ? JSON.parse(gateway.stdout) : null

      return apiSuccess(res, {
        status: status.stdout,
        gateway: parsedGateway,
        cron: cron.stdout,
        party,
        activeShifts: options.activeShifts(),
        missions: options.listMissionViews(),
        missionFeed: options.missionFeed(),
      })
    } catch (error) {
      return apiFailure(res, 500, 'openclaw_summary_failed', 'Failed to fetch summary', String(error))
    }
  })

  app.post('/api/openclaw/command', async (req, res) => {
    const parsed = OpenClawCommandSchema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    let args: string[]
    try {
      args = options.parseOpenClawCommandInput(parsed.data.command)
    } catch (error) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid OpenClaw command', String(error))
    }

    const timeoutMs = parsed.data.timeoutSeconds * 1000
    options.pushGatewayLog('lifecycle', `$ ${options.pluginCommandString(args)}`)
    try {
      const result = await options.runOpenClaw(args, timeoutMs)
      options.invalidateRuntimeStatusCache()
      if (result.stdout.trim()) options.pushGatewayLog('stdout', result.stdout)
      if (result.stderr.trim()) options.pushGatewayLog('stderr', result.stderr)
      options.pushGatewayLog(
        result.code === 0 ? 'lifecycle' : 'stderr',
        `openclaw command exited ${result.code}${typeof result.elapsedMs === 'number' ? ` after ${result.elapsedMs}ms` : ''}`,
      )
      const controls = parsed.data.refreshPlugins
        ? await options.listPluginControls({ forceRefresh: true }).catch((error) => ({
            plugins: [],
            configPath: options.openclawConfigPath,
            cache: { source: 'openclaw' as const, refreshedAt: Date.now(), refreshing: false },
            cliError: String(error),
          }))
        : null
      return apiSuccess(res, {
        ok: result.code === 0,
        command: options.pluginCommandResult(args, result),
        ...(controls ? {
          plugins: controls.plugins,
          configPath: controls.configPath,
          cache: controls.cache,
          ...(controls.cliError ? { cliError: controls.cliError } : {}),
        } : {}),
      })
    } catch (error) {
      const detail = options.redactSensitiveText(String(error))
      options.pushGatewayLog('stderr', `openclaw command failed: ${detail}`)
      return apiFailure(res, 500, 'openclaw_command_failed', 'OpenClaw command failed', detail)
    }
  })
}

import type { Express } from 'express'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type DiagnosticsRoutesOptions = {
  cachedDoctorDiagnosticsSummary: () => unknown
  diskFreeSpaceCheck: () => Promise<unknown>
  gatewayChatEnabled: () => boolean
  gatewayChatPrewarmedAt: () => string | null
  gatewayChatPrewarming: () => boolean
  gatewayChatPrewarmOnStartup: boolean
  gatewayChatReady: () => boolean
  gatewayChatRuntimeSnapshot: () => Record<string, unknown>
  openClawAgentRunDefaultsReady: () => boolean
  openClawOptimizationScorecard: () => unknown
  readDoctorDiagnosticsSummary: (forceRefresh: boolean) => Promise<unknown>
  recommendedOpenClawVersion: string
  redactSensitiveText: (value: string) => string
  resolvedOpenClawRuntimeInfo: () => unknown
  runDoctorChecks: () => Promise<unknown>
  runDoctorRepair: () => Promise<unknown>
  runtimeLedgerStatus: (options?: { sqlite?: boolean }) => unknown
  runtimeVersionCheckPayload: () => unknown
  workspaceRoot: string
}

export function registerDiagnosticsRoutes(app: Express, options: DiagnosticsRoutesOptions) {
  app.get('/api/ready', (_req, res) => {
    return apiSuccess(res, { ok: true, ready: true })
  })

  app.get('/api/health', async (_req, res) => {
    const disk = await options.diskFreeSpaceCheck()
    return apiSuccess(res, {
      ok: true,
      workspace: options.workspaceRoot,
      openclaw: options.resolvedOpenClawRuntimeInfo(),
      recommendedOpenClawVersion: options.recommendedOpenClawVersion,
      disk,
      persistence: options.runtimeLedgerStatus({ sqlite: false }),
      diagnostics: {
        doctor: options.cachedDoctorDiagnosticsSummary(),
      },
      agentConfigSync: { updated: 0, mode: 'read-only' },
      gatewayChat: {
        enabled: options.gatewayChatEnabled(),
        ready: options.gatewayChatReady(),
        prewarming: options.gatewayChatPrewarming(),
        prewarmOnStartup: options.gatewayChatPrewarmOnStartup,
        prewarmedAt: options.gatewayChatPrewarmedAt(),
        defaultsReady: options.openClawAgentRunDefaultsReady(),
        ...options.gatewayChatRuntimeSnapshot(),
      },
    })
  })

  app.get('/api/runtime/version-check', (_req, res) => {
    return apiSuccess(res, options.runtimeVersionCheckPayload())
  })

  app.get('/api/openclaw/optimization-scorecard', (_req, res) => {
    try {
      return apiSuccess(res, options.openClawOptimizationScorecard())
    } catch (error) {
      return apiFailure(
        res,
        500,
        'optimization_scorecard_failed',
        'OpenClaw optimization scorecard failed',
        options.redactSensitiveText(String(error)),
      )
    }
  })

  app.post('/api/doctor/run', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runDoctorChecks())
    } catch (error) {
      return apiFailure(res, 500, 'doctor_operation_failed', 'Doctor run failed', options.redactSensitiveText(String(error)))
    }
  })

  app.post('/api/doctor/repair', async (_req, res) => {
    try {
      return apiSuccess(res, await options.runDoctorRepair())
    } catch (error) {
      return apiFailure(res, 500, 'doctor_operation_failed', 'Doctor repair failed', options.redactSensitiveText(String(error)))
    }
  })

  app.get('/api/doctor/recent', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true'
      return apiSuccess(res, { doctor: await options.readDoctorDiagnosticsSummary(forceRefresh) })
    } catch (error) {
      return apiFailure(res, 500, 'doctor_operation_failed', 'Doctor history failed', options.redactSensitiveText(String(error)))
    }
  })
}

import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

export type ExecAccess = { host: 'gateway'; security: 'allowlist' | 'full'; ask: 'on-miss' | 'always' | 'off' }
export function execAccessForMode(mode: 'ask' | 'full'): ExecAccess {
  return { host: 'gateway', security: mode === 'full' ? 'full' : 'allowlist', ask: mode === 'full' ? 'off' : 'on-miss' }
}

export function registerToolApprovalRoutes(app: Express, options: {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  configure: (agentId: string, access: ExecAccess) => Promise<void>
  validAgent: (agentId: string) => boolean | Promise<boolean>
}) {
  app.get('/api/tool-approvals', async (_req, res) => {
    const pending = await options.request('exec.approval.list', {})
    return apiSuccess(res, { pending: Array.isArray(pending) ? pending : [] })
  })
  app.post('/api/tool-approvals/:id/resolve', async (req, res) => {
    const parsed = z.object({ decision: z.enum(['allow-once', 'allow-always', 'deny']) }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Choose an approval decision.')
    await options.request('exec.approval.resolve', { id: req.params.id, decision: parsed.data.decision })
    return apiSuccess(res, { resolved: true })
  })
  app.post('/api/party/agent/:agentId/tool-access', async (req, res) => {
    const parsed = z.object({ mode: z.enum(['ask', 'full']) }).safeParse(req.body)
    const agentId = String(req.params.agentId)
    if (!parsed.success || !await options.validAgent(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Choose an agent and access mode.')
    const access = execAccessForMode(parsed.data.mode)
    // Keep the host approval policy and agent policy in agreement. The hash
    // prevents overwriting a concurrent approval/allowlist update.
    const snapshot = await options.request('exec.approvals.get', {}) as {
      hash: string; file: { version: number; agents?: Record<string, Record<string, unknown>> }
    }
    await options.request('exec.approvals.set', {
      baseHash: snapshot.hash,
      file: { ...snapshot.file, agents: { ...snapshot.file.agents, [agentId]: {
        ...snapshot.file.agents?.[agentId], security: access.security, ask: access.ask, askFallback: 'deny',
      } } },
    })
    await options.configure(agentId, access)
    return apiSuccess(res, { mode: parsed.data.mode })
  })
}

import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { isImplicitMainAgentId } from '../services/agents/dynamicToolPolicy'

export type ExecAccess = { host: 'gateway'; security: 'allowlist' | 'full'; ask: 'on-miss' | 'always' | 'off' }
export class ToolAccessPolicyConflictError extends Error {}

type GatewayRequestOptions = { timeoutMs?: number; signal?: AbortSignal }

const TOOL_CATALOG_REQUEST_TIMEOUT_MS = 10_000
const APPROVALS_REQUEST_TIMEOUT_MS = 10_000

export function execAccessForMode(mode: 'ask' | 'full'): ExecAccess {
  return { host: 'gateway', security: mode === 'full' ? 'full' : 'allowlist', ask: mode === 'full' ? 'off' : 'on-miss' }
}

export function registerToolApprovalRoutes(app: Express, options: {
  request: (method: string, params: Record<string, unknown>, requestOptions?: GatewayRequestOptions) => Promise<unknown>
  configure: (agentId: string, access: ExecAccess) => Promise<void>
  interruptAgent: (agentId: string) => Promise<unknown>
  resetAgentContext: (agentId: string) => unknown | Promise<unknown>
  validAgent: (agentId: string) => boolean | Promise<boolean>
  resolveToolCatalogAgentId?: (agentId: string) => string | Promise<string>
}) {
  app.get('/api/party/agent/:agentId/tool-catalog', async (req, res) => {
    const agentId = String(req.params.agentId)
    if (!await options.validAgent(agentId)) return apiFailure(res, 404, 'agent_not_found', 'Agent not found.')
    const controller = new AbortController()
    const abortOnClientDisconnect = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once('close', abortOnClientDisconnect)
    try {
      // `main` is OpenClaw's implicit default agent, not a configured entry.
      // Multi-agent Gateways require an explicit configured owner for catalogs.
      const catalogAgentId = options.resolveToolCatalogAgentId
        ? await options.resolveToolCatalogAgentId(agentId)
        : agentId
      const catalog = await options.request('tools.catalog', {
        agentId: catalogAgentId,
        includePlugins: true,
      }, { timeoutMs: TOOL_CATALOG_REQUEST_TIMEOUT_MS, signal: controller.signal })
      return apiSuccess(res, { catalog })
    } catch {
      if (controller.signal.aborted) return
      return apiFailure(res, 503, 'runtime_status_failed', 'Tool catalog unavailable. Retry when the gateway is ready.')
    } finally {
      res.off('close', abortOnClientDisconnect)
    }
  })
  app.get('/api/tool-approvals', async (_req, res) => {
    try {
      const pending = await options.request('exec.approval.list', {})
      const snapshot = await options.request('exec.approvals.get', {}) as { file?: { agents?: Record<string, { security?: string; ask?: string }> } }
      const agents = snapshot.file?.agents || {}
      const visible = []
      for (const item of (Array.isArray(pending) ? pending : [])) {
        const agentId = (item as { request?: { agentId?: unknown } })?.request?.agentId
        const policy = typeof agentId === 'string' ? agents[agentId] : undefined
        if (policy?.security === 'full' && policy.ask === 'off') {
          // An old turn can retain Ask policy after Full access is saved. Do
          // not hide a live waiter: cancel its stale authorization explicitly.
          // Never replay the command or bypass the runtime's policy snapshot.
          await options.request('exec.approval.resolve', { id: item.id, decision: 'deny' })
        } else visible.push(item)
      }
      return apiSuccess(res, { pending: visible })
    } catch {
      return apiFailure(res, 503, 'approval_service_unavailable', 'Tool approvals are unavailable while the Gateway is starting. Retry when it is ready.')
    }
  })
  app.post('/api/tool-approvals/:id/resolve', async (req, res) => {
    const parsed = z.object({ decision: z.enum(['allow-once', 'allow-always', 'deny']) }).safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Choose an approval decision.')
    try {
      await options.request('exec.approval.resolve', { id: req.params.id, decision: parsed.data.decision })
      return apiSuccess(res, { resolved: true })
    } catch {
      return apiFailure(res, 503, 'approval_service_unavailable', 'The approval could not be applied because the Gateway is unavailable. Retry when it is ready.')
    }
  })
  app.post('/api/party/agent/:agentId/tool-access', async (req, res) => {
    const parsed = z.object({ mode: z.enum(['ask', 'full']) }).safeParse(req.body)
    const agentId = String(req.params.agentId)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Choose a valid access mode.')
    if (!isImplicitMainAgentId(agentId) && !await options.validAgent(agentId)) return apiFailure(res, 404, 'agent_not_found', 'Agent not found. Refresh the agent list and try again.')
    const access = execAccessForMode(parsed.data.mode)
    // Stop turns built with the old policy BEFORE mutating the approval
    // snapshot. Otherwise an approved command fails revalidation and its
    // retry still carries stale execution/tool definitions.
    try {
      const interrupted = await options.interruptAgent(agentId)
      // Keep the host approval policy and agent policy in agreement. The hash
      // prevents overwriting a concurrent approval/allowlist update.
      const snapshot = await options.request('exec.approvals.get', {}, { timeoutMs: APPROVALS_REQUEST_TIMEOUT_MS }) as {
        hash: string; file: { version: number; agents?: Record<string, Record<string, unknown>> }
      }
      // Apply the tool policy first. If the config rejects a shared-policy
      // change, the exec approval snapshot stays restrictive.
      await options.configure(agentId, access)
      await options.request('exec.approvals.set', {
        baseHash: snapshot.hash,
        file: { ...snapshot.file, agents: { ...snapshot.file.agents, [agentId]: {
          ...snapshot.file.agents?.[agentId], security: access.security, ask: access.ask, askFallback: 'deny',
        } } },
      }, { timeoutMs: APPROVALS_REQUEST_TIMEOUT_MS })
      // Tool availability is part of the agent turn context. Invalidate the
      // cached session after changing access so the very next turn observes the
      // new command policy instead of inheriting the previous tool set.
      const contextReset = await options.resetAgentContext(agentId)
      return apiSuccess(res, { mode: parsed.data.mode, contextReset, interrupted })
    } catch (error) {
      if (error instanceof ToolAccessPolicyConflictError) {
        return apiFailure(res, 409, 'shared_tool_policy_conflict', error.message)
      }
      const detail = error instanceof Error ? error.message.trim() : ''
      const gatewayUnavailable = /gateway|connect|socket|timeout|econnrefused|not running/i.test(detail)
      return apiFailure(
        res,
        503,
        'tool_access_update_failed',
        gatewayUnavailable
          ? 'Tool permissions could not be saved because the Gateway is unavailable. Restart it in Runtime Monitor, wait for Runtime connected, then retry.'
          : `Tool permissions could not be saved: ${detail || 'the Gateway rejected the update.'}`,
      )
    }
  })
}

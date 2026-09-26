import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import { isImplicitMainAgentId, mainAgentToolPolicyForAccess } from '../server/services/agents/dynamicToolPolicy'
import { registerToolApprovalRoutes } from '../server/routes/toolApprovalRoutes'

test('Telegram main agent approval grants Full access and exposes the full tool catalog', async () => {
  const app = express()
  app.use(express.json())
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const pending = {
    id: 'telegram-exec-pending',
    expiresAtMs: Date.now() + 60_000,
    request: { agentId: 'main', sessionKey: 'agent:main:telegram:direct:test-chat', command: 'node -e "process.stdout.write(\'ok\')"' },
  }
  let approvalFile: { version: number; agents: Record<string, Record<string, unknown>> } = {
    version: 1,
    agents: { other: { security: 'allowlist', ask: 'on-miss', allowlist: [{ pattern: 'node' }] } },
  }
  let toolsPolicy: Record<string, unknown> = {
    profile: 'coding',
    exec: { host: 'gateway', security: 'allowlist', ask: 'on-miss', askFallback: 'deny' },
    alsoAllow: ['browser'],
    allow: ['read'],
    deny: ['exec'],
    byProvider: { google: { allow: ['read'] } },
    sandbox: { tools: { deny: ['exec'] } },
    toolSearch: { enabled: true, mode: 'tools' },
  }

  registerToolApprovalRoutes(app, {
    validAgent: (id) => isImplicitMainAgentId(id),
    resolveToolCatalogAgentId: (id) => isImplicitMainAgentId(id) ? 'finance-investment-researcher' : id,
    interruptAgent: async (agentId) => { calls.push({ method: 'interrupt', params: { agentId } }); return { interrupted: true } },
    configure: async (agentId, access) => {
      calls.push({ method: 'configure', params: { agentId, access } })
      toolsPolicy = mainAgentToolPolicyForAccess(toolsPolicy, access)
    },
    resetAgentContext: async (agentId) => { calls.push({ method: 'reset', params: { agentId } }); return { sessions: 1 } },
    request: async (method, params) => {
      calls.push({ method, params })
      if (method === 'exec.approval.list') return [pending]
      if (method === 'exec.approvals.get') return { hash: 'revision-1', file: approvalFile }
      if (method === 'exec.approvals.set') {
        approvalFile = params.file as typeof approvalFile
        return { ok: true }
      }
      if (method === 'tools.catalog') return { tools: ['read', 'exec', 'process', 'message', 'browser'] }
      return { ok: true }
    },
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  try {
    const initial = await fetch(base + '/api/tool-approvals').then((response) => response.json())
    assert.equal(initial.data.pending[0].request.sessionKey, 'agent:main:telegram:direct:test-chat')

    const grant = await post('/api/party/agent/main/tool-access', { mode: 'full' })
    assert.equal(grant.status, 200)

    assert.deepEqual(toolsPolicy, {
      profile: 'full',
      exec: { host: 'gateway', security: 'full', ask: 'off', askFallback: 'deny' },
      alsoAllow: ['browser'],
      toolSearch: { enabled: true, mode: 'tools' },
    })
    assert.deepEqual(approvalFile.agents.other, { security: 'allowlist', ask: 'on-miss', allowlist: [{ pattern: 'node' }] })
    assert.deepEqual(approvalFile.agents.main, { security: 'full', ask: 'off', askFallback: 'deny' })
    assert.deepEqual(calls.filter((call) => ['interrupt', 'configure', 'reset'].includes(call.method)).map((call) => call.method), [
      'interrupt', 'configure', 'reset',
    ])

    const catalogResponse = await fetch(base + '/api/party/agent/main/tool-catalog')
    assert.equal(catalogResponse.status, 200)
    const catalog = await catalogResponse.json()
    assert.deepEqual(catalog.data.catalog.tools, ['read', 'exec', 'process', 'message', 'browser'])
    assert.ok(calls.some((call) => call.method === 'tools.catalog'
      && call.params.agentId === 'finance-investment-researcher'
      && call.params.includePlugins === true))

    const stale = await fetch(base + '/api/tool-approvals').then((response) => response.json())
    assert.deepEqual(stale.data.pending, [])
    assert.ok(calls.some((call) => call.method === 'exec.approval.resolve'
      && call.params.id === pending.id && call.params.decision === 'deny'))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('approval API reports an unavailable Gateway instead of silently dropping the approval state', async () => {
  const app = express()
  app.use(express.json())
  registerToolApprovalRoutes(app, {
    validAgent: () => true,
    configure: async () => {},
    interruptAgent: async () => {},
    resetAgentContext: () => {},
    request: async () => { throw new Error('Gateway unavailable') },
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tool-approvals`)
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.error.code, 'approval_service_unavailable')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

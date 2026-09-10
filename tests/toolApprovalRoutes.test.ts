import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import { registerToolApprovalRoutes } from '../server/routes/toolApprovalRoutes'

test('approvals validate decisions, preserve other agents, and synchronize host and agent policy', async () => {
  const app = express()
  app.use(express.json())
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  registerToolApprovalRoutes(app, {
    validAgent: (id) => id === 'brandon',
    configure: async (agentId, access) => { calls.push({ method: 'configure', params: { agentId, access } }) },
    resetAgentContext: async (agentId) => { calls.push({ method: 'reset-agent-context', params: { agentId } }); return { sessions: 1, histories: 1 } },
    request: async (method, params) => {
      calls.push({ method, params })
      if (method === 'exec.approval.list') return [{ id: 'pending-1', request: { agentId: 'brandon', command: 'pwd' } }]
      if (method === 'exec.approvals.get') return { hash: 'revision-1', file: { version: 1, agents: { other: { security: 'deny' }, brandon: { allowlist: [{ pattern: '/usr/bin/pwd' }] } } } }
      return { ok: true }
    },
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(base + '/api/tool-approvals')).status, 200)
    assert.equal((await post('/api/tool-approvals/pending-1/resolve', { decision: 'arbitrary' })).status, 400)
    assert.equal(calls.some((c) => c.method === 'exec.approval.resolve'), false)
    for (const decision of ['allow-once', 'allow-always', 'deny']) {
      assert.equal((await post('/api/tool-approvals/pending-1/resolve', { decision })).status, 200)
      assert.deepEqual(calls.at(-1)?.params, { id: 'pending-1', decision })
    }
    const before = calls.length
    assert.equal((await post('/api/party/agent/missing/tool-access', { mode: 'full' })).status, 400)
    assert.equal(calls.length, before)
    for (const mode of ['ask', 'full']) {
      assert.equal((await post('/api/party/agent/brandon/tool-access', { mode })).status, 200)
      const update = calls.findLast((c) => c.method === 'exec.approvals.set')!
      assert.equal(update.params.baseHash, 'revision-1')
      const file = update.params.file as { agents: Record<string, Record<string, unknown>> }
      assert.deepEqual(file.agents.other, { security: 'deny' })
      assert.deepEqual(file.agents.brandon.allowlist, [{ pattern: '/usr/bin/pwd' }])
      assert.equal(file.agents.brandon.ask, mode === 'full' ? 'off' : 'on-miss')
      assert.deepEqual(calls.at(-2)?.params, { agentId: 'brandon', access: { host: 'gateway', security: mode === 'full' ? 'full' : 'allowlist', ask: mode === 'full' ? 'off' : 'on-miss' } })
      assert.deepEqual(calls.at(-1)?.params, { agentId: 'brandon' })
    }
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

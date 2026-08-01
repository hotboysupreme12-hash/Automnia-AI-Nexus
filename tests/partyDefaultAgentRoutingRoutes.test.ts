import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express, { type Express } from 'express'

import type { PartyManagementRoutesContext } from '../server/controlPlane'
import { registerPartyManagementRoutes } from '../server/routes/partyManagementRoutes'

async function withRouteServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('default agent route writes a global default and replaces only Telegram catch-all routing', async () => {
  const config = {
    agents: {
      list: [
        { id: 'sarah', default: true, model: { primary: 'google-vertex/gemini-3.5-flash' } },
        { id: 'elena', model: { primary: 'google-vertex/gemini-3.5-flash' } },
      ],
    },
    bindings: [
      { agentId: 'sarah', match: { channel: 'telegram', accountId: '*' } },
      { agentId: 'sarah', match: { channel: 'telegram', accountId: 'operations' } },
      { agentId: 'sarah', match: { channel: 'discord', accountId: '*' } },
    ],
  }
  const calls = {
    modelCleanup: [] as Array<{ agentId: string; primary?: string; clearManualOverrides?: boolean }>,
    sessionReset: [] as string[],
    writes: 0,
    restarts: 0,
  }
  const app = express()
  app.use(express.json())
  registerPartyManagementRoutes(app, {
    readOpenclawConfig: async () => config,
    writeOpenclawConfig: async () => { calls.writes += 1 },
    isRetiredAgentId: () => false,
    clearDisallowedAutoModelOverridesForAgent: async (agentId: string, model: { primary?: string }, options: { clearManualOverrides?: boolean }) => {
      calls.modelCleanup.push({ agentId, primary: model.primary, clearManualOverrides: options.clearManualOverrides })
      return { changed: true, cleared: [] }
    },
    clearAgentTurnSessions: (agentId: string) => {
      calls.sessionReset.push(agentId)
      return { sessions: 0, histories: 0 }
    },
    schedulePluginGatewayRestart: () => {
      calls.restarts += 1
      return { restarted: false, scheduled: true, detail: 'scheduled' }
    },
  } as unknown as PartyManagementRoutesContext)

  await withRouteServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/party/default-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'elena', channels: ['telegram'] }),
    })
    const payload = await response.json() as { ok: boolean; data: { agentId: string; channels: string[] } }
    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.data.agentId, 'elena')
    assert.deepEqual(payload.data.channels, ['telegram'])
  })

  assert.equal(calls.writes, 1)
  assert.deepEqual(calls.sessionReset, ['elena'])
  assert.equal(calls.restarts, 1)
  assert.deepEqual(calls.modelCleanup, [{ agentId: 'elena', primary: 'google-vertex/gemini-3.5-flash', clearManualOverrides: true }])
  assert.deepEqual(config.agents.list.map((agent) => [agent.id, Boolean(agent.default)]), [['sarah', false], ['elena', true]])
  assert.deepEqual(config.bindings, [
    { agentId: 'sarah', match: { channel: 'telegram', accountId: 'operations' } },
    { agentId: 'sarah', match: { channel: 'discord', accountId: '*' } },
    { agentId: 'elena', match: { channel: 'telegram', accountId: '*' } },
  ])
})

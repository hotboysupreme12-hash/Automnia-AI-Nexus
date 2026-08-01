import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'

import { installControlPlaneHttp } from '../server/controlPlaneHttp'

test('agent avatar images are readable without exposing protected party APIs', async () => {
  const app = express()
  installControlPlaneHttp(app, {
    authToken: 'private-control-token',
    port: 4050,
    frontendPort: 5173,
    sessionTokens: { has: () => false },
  })
  app.get('/api/party/avatar/:agentId', (_req, res) => res.type('image/png').send('avatar'))
  app.post('/api/party/avatar/:agentId', (_req, res) => res.json({ ok: true }))

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    const image = await fetch(`http://127.0.0.1:${port}/api/party/avatar/elena`)
    assert.equal(image.status, 200)
    assert.equal(await image.text(), 'avatar')

    const protectedMutation = await fetch(`http://127.0.0.1:${port}/api/party/avatar/elena`, { method: 'POST' })
    assert.equal(protectedMutation.status, 401)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

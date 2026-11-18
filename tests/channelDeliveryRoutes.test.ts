import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express, { type Express } from 'express'
import { registerChannelDeliveryRoutes } from '../server/routes/channelDeliveryRoutes'

async function withServer<T>(app: Express, run: (url: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try { return await run(`http://127.0.0.1:${port}`) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

test('channel status route redacts thrown local paths', async () => {
  const app = express()
  registerChannelDeliveryRoutes(app, {
    getChannelDeliveryStatus: async () => { throw new Error('C:\\Users\\person\\.openclaw\\credentials.json') },
  })
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/openclaw/channel-delivery/status`)
    const payload = await response.json() as { ok: boolean; error?: { message?: string; details?: unknown } }
    assert.equal(response.status, 500)
    assert.equal(payload.ok, false)
    assert.equal(payload.error?.message, 'Could not check channel status. Try again shortly.')
    assert.equal(JSON.stringify(payload).includes('credentials.json'), false)
  })
})

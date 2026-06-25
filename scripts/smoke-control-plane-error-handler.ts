import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import express from 'express'
import { installControlPlaneErrorHandler, installControlPlaneHttp } from '../server/controlPlaneHttp'
import { createSessionTokenStore } from '../server/sessionTokenStore'

type SmokeResponse = {
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}

function get(url: string, headers: Record<string, string> = {}): Promise<SmokeResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf-8'),
      }))
    })
    req.once('error', reject)
    req.end()
  })
}

const token = 'control-plane-error-handler-token'
const app = express()
installControlPlaneHttp(app, {
  authToken: token,
  frontendPort: 5173,
  port: 4050,
  sessionTokens: createSessionTokenStore(),
})
app.get('/api/explode', () => {
  throw new Error('sk-live-error-boundary-secret Authorization: Bearer top-secret')
})
app.get('/explode', () => {
  throw new Error('page-should-not-render secret')
})
installControlPlaneErrorHandler(app)

const server = createServer(app)
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const origin = `http://127.0.0.1:${address.port}`

try {
  const apiResponse = await get(`${origin}/api/explode`, { Authorization: `Bearer ${token}` })
  assert.equal(apiResponse.status, 500)
  assert.equal(apiResponse.headers['cache-control'], 'no-store')
  assert.ok(apiResponse.headers['x-request-id'])
  assert.doesNotMatch(apiResponse.text, /sk-live-error-boundary-secret|Authorization|top-secret/i)
  const apiBody = JSON.parse(apiResponse.text) as {
    ok: boolean
    error?: { code?: string; message?: string; status?: number }
    requestId?: string
  }
  assert.equal(apiBody.ok, false)
  assert.equal(apiBody.error?.code, 'internal_error')
  assert.equal(apiBody.error?.message, 'Internal server error')
  assert.equal(apiBody.error?.status, 500)
  assert.equal(apiBody.requestId, apiResponse.headers['x-request-id'])

  const pageResponse = await get(`${origin}/explode`)
  assert.equal(pageResponse.status, 500)
  assert.equal(pageResponse.headers['cache-control'], 'no-store')
  assert.equal(pageResponse.headers['x-content-type-options'], 'nosniff')
  assert.equal(pageResponse.headers['referrer-policy'], 'no-referrer')
  assert.equal(pageResponse.text, 'Internal server error')
  assert.doesNotMatch(pageResponse.text, /should-not-render|secret/i)
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

console.log('control plane error handler contract ok')

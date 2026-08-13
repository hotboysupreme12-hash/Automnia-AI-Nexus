import assert from 'node:assert/strict'
import test from 'node:test'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const localStorage = new MemoryStorage()
const sessionStorage = new MemoryStorage()
let bootstrapCalls = 0
let bootstrapResponse: string | Promise<string> = 'renewed-session'
const requests: Array<{ authorization: string | null; url: string }> = []

const nativeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  requests.push({ authorization: headers.get('Authorization'), url: String(input) })
  if (headers.get('Authorization') !== 'Bearer renewed-session') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'auth_required', message: 'Authentication required' } }), { status: 401 })
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    clearTimeout,
    fetch: nativeFetch,
    localStorage,
    location: new URL('http://127.0.0.1:4050/'),
    sessionStorage,
    setTimeout,
    automniaDesktop: {
      bootstrapControlCenterSession: async () => {
        bootstrapCalls += 1
        return bootstrapResponse
      },
    },
  },
})

const authTokens = await import('../src/api/authTokenStore')
const { fetchControlCenterWithAuth, installAuthenticatedFetch } = await import('../src/api/authenticatedFetch')

test('authenticated fetch renews one expired desktop session and retries rejected local API calls', async () => {
  authTokens.clearAuthToken()
  authTokens.writeAuthToken('stale-session')
  installAuthenticatedFetch()

  const [first, second] = await Promise.all([
    window.fetch('/api/runtime/status'),
    window.fetch('/api/auth/providers'),
  ])

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(bootstrapCalls, 1, 'concurrent 401s should reuse one Electron bootstrap request')
  assert.equal(authTokens.readAuthToken(), 'renewed-session')
  assert.equal(requests.filter((request) => request.authorization === 'Bearer stale-session').length, 2)
  assert.equal(requests.filter((request) => request.authorization === 'Bearer renewed-session').length, 2)

  authTokens.clearAuthToken()
})

test('streaming callers use the same desktop-session renewal as ordinary API calls', async () => {
  authTokens.writeAuthToken('stale-stream-session')

  const response = await fetchControlCenterWithAuth('http://127.0.0.1:4050/api/openclaw/agent-turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })

  assert.equal(response.status, 200)
  assert.equal(bootstrapCalls, 2)
  assert.equal(authTokens.readAuthToken(), 'renewed-session')
  assert.equal(requests.at(-2)?.authorization, 'Bearer stale-stream-session')
  assert.equal(requests.at(-1)?.authorization, 'Bearer renewed-session')

  authTokens.clearAuthToken()
})

test('explicit logout prevents background requests from silently renewing the session', async () => {
  authTokens.markAuthSignedOut()
  authTokens.writeAuthToken('stale-after-logout')
  const callsBefore = bootstrapCalls

  const response = await window.fetch('/api/runtime/status')

  assert.equal(response.status, 401)
  assert.equal(bootstrapCalls, callsBefore)
  assert.equal(authTokens.readAuthToken(), null)

  authTokens.clearAuthSignedOut()
  authTokens.clearAuthToken()
})

test('logout wins when desktop session recovery was already in flight', async () => {
  authTokens.clearAuthSignedOut()
  authTokens.writeAuthToken('stale-before-race')
  let releaseBootstrap: ((token: string) => void) | null = null
  bootstrapResponse = new Promise<string>((resolve) => { releaseBootstrap = resolve })
  const callsBefore = bootstrapCalls
  const request = window.fetch('/api/runtime/status')

  for (let attempt = 0; attempt < 10 && bootstrapCalls === callsBefore; attempt += 1) await Promise.resolve()
  assert.equal(bootstrapCalls, callsBefore + 1)

  authTokens.markAuthSignedOut()
  releaseBootstrap?.('late-renewed-session')
  const response = await request

  assert.equal(response.status, 401)
  assert.equal(authTokens.readAuthToken(), null)
  bootstrapResponse = 'renewed-session'
  authTokens.clearAuthSignedOut()
  authTokens.clearAuthToken()
})

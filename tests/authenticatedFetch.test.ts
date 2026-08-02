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
    dystopaiDesktop: {
      bootstrapControlCenterSession: async () => {
        bootstrapCalls += 1
        return 'renewed-session'
      },
    },
  },
})

const authTokens = await import('../src/api/authTokenStore')
const { installAuthenticatedFetch } = await import('../src/api/authenticatedFetch')

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

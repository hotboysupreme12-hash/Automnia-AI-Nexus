import test from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null { throw new Error('blocked') }
  override removeItem(): void { throw new Error('blocked') }
  override setItem(): void { throw new Error('blocked') }
}

const localStorage = new MemoryStorage()
const sessionStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage, sessionStorage },
})
const store = await import('../src/api/authTokenStore')

test('auth token storage migrates legacy persistence into session scope', () => {
  store.clearAuthToken()
  localStorage.setItem('control-center-token', 'legacy-session')
  assert.equal(store.readAuthToken(), 'legacy-session')
  assert.equal(localStorage.getItem('control-center-token'), null)
  assert.equal(sessionStorage.getItem('control-center-token'), 'legacy-session')

  store.writeAuthToken('  new-session  ')
  assert.equal(store.readAuthToken(), 'new-session')
  assert.equal(sessionStorage.getItem('control-center-token'), 'new-session')
  assert.equal(localStorage.getItem('control-center-token'), null)

  store.clearAuthToken()
  assert.equal(store.readAuthToken(), null)
  assert.equal(sessionStorage.getItem('control-center-token'), null)
})

test('auth token storage remains usable when browser storage is blocked or unavailable', () => {
  store.clearAuthToken()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: new ThrowingStorage(), sessionStorage: new ThrowingStorage() },
  })
  store.writeAuthToken('memory-only')
  assert.equal(store.readAuthToken(), 'memory-only')
  store.clearAuthToken()
  assert.equal(store.readAuthToken(), null)

  Reflect.deleteProperty(globalThis, 'window')
  store.writeAuthToken('server-memory')
  assert.equal(store.readAuthToken(), 'server-memory')
  store.writeAuthToken('   ')
  assert.equal(store.readAuthToken(), null)
})

test('explicit logout blocks token reads until the user signs in again', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() },
  })

  store.clearAuthSignedOut()
  store.writeAuthToken('active-session')
  assert.equal(store.readAuthToken(), 'active-session')

  store.markAuthSignedOut()
  assert.equal(store.isAuthExplicitlySignedOut(), true)
  assert.equal(store.readAuthToken(), null)

  store.clearAuthSignedOut()
  store.writeAuthToken('new-session')
  assert.equal(store.isAuthExplicitlySignedOut(), false)
  assert.equal(store.readAuthToken(), 'new-session')
  store.clearAuthToken()
})

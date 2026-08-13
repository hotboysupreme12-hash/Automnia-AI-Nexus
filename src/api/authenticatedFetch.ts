import { apiUrl } from '../utils/apiUrl'
import { isAuthExplicitlySignedOut, readAuthToken } from './authTokenStore'
import { recoverDesktopControlCenterSession } from './desktopSessionRecovery'

let installed = false
let nativeFetch: typeof window.fetch | null = null

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  if (input instanceof URL) return input.href
  return String(input)
}

function isControlCenterApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false
  try {
    const request = new URL(requestUrl(input), window.location.href)
    if (!request.pathname.startsWith('/api')) return false
    const apiBase = new URL(apiUrl('/api/__auth_probe__'), window.location.href)
    return request.origin === apiBase.origin || request.origin === window.location.origin
  } catch {
    return false
  }
}

function isSessionBootstrapRequest(input: RequestInfo | URL): boolean {
  try {
    const request = new URL(requestUrl(input), window.location.href)
    return request.pathname === '/api/auth/login' || request.pathname === '/api/auth/logout'
  } catch {
    return false
  }
}

function headersWithBearer(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (!headers.has('Authorization')) {
    const token = readAuthToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

async function fetchWithSessionRecovery(
  fetchImpl: typeof window.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isControlCenterApiRequest(input)) return fetchImpl(input, init)

  const retryInput = input instanceof Request ? input.clone() : input
  const firstResponse = await fetchImpl(input, {
    ...(init || {}),
    headers: headersWithBearer(input, init),
  })
  if (firstResponse.status !== 401 || isSessionBootstrapRequest(input)) return firstResponse
  if (isAuthExplicitlySignedOut()) return firstResponse

  const refreshedToken = await recoverDesktopControlCenterSession()
  if (!refreshedToken) return firstResponse

  const retryHeaders = headersWithBearer(retryInput, init)
  retryHeaders.set('Authorization', `Bearer ${refreshedToken}`)
  return fetchImpl(retryInput, {
    ...(init || {}),
    headers: retryHeaders,
  })
}

/**
 * Authenticated fetch for requests that need streaming bodies. It shares the
 * same desktop-session renewal as the global fetch bridge, including callers
 * that do not resolve the browser's global fetch binding through window.fetch.
 */
export async function fetchControlCenterWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!nativeFetch && typeof window !== 'undefined') installAuthenticatedFetch()
  const fetchImpl = nativeFetch || globalThis.fetch
  if (!fetchImpl) throw new Error('Fetch is not available in this runtime.')
  return fetchWithSessionRecovery(fetchImpl, input, init)
}

export function installAuthenticatedFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  nativeFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchWithSessionRecovery(nativeFetch!, input, init)
  }
}

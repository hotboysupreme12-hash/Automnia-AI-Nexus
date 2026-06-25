import { apiUrl } from '../utils/apiUrl'
import { readAuthToken } from './authTokenStore'

let installed = false


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

function headersWithBearer(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (!headers.has('Authorization')) {
    const token = readAuthToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

export function installAuthenticatedFetch(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isControlCenterApiRequest(input)) return nativeFetch(input, init)
    return nativeFetch(input, {
      ...(init || {}),
      headers: headersWithBearer(input, init),
    })
  }
}

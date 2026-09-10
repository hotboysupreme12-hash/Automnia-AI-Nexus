import type { ApiResult } from './client'

/** Only an explicit authentication rejection can invalidate a saved session. */
export function authStatusDecision(result: ApiResult<{ authenticated: boolean }>): 'authenticated' | 'rejected' | 'unavailable' {
  if (result.ok) {
    if (result.data?.authenticated === true) return 'authenticated'
    if (result.data?.authenticated === false) return 'rejected'
    return 'unavailable'
  }
  return result.status === 401 ? 'rejected' : 'unavailable'
}

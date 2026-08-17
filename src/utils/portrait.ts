import { apiUrl } from './apiUrl'

type ViteImportMeta = ImportMeta & {
  env?: {
    BASE_URL?: string
  }
}

const assetBaseUrl = ((import.meta as ViteImportMeta).env?.BASE_URL || '/').replace(/\/?$/, '/')
const windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/
const uncPathPattern = /^\\\\/

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function isDataImage(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
}

function isBrowserRuntimeUrl(value: string) {
  return isHttpUrl(value) || value.startsWith('blob:') || isDataImage(value)
}

function isAppApiPath(value: string) {
  return value.startsWith('/api/')
}

function isBundledPortraitAsset(value: string) {
  return value.startsWith('/agents/') || value.startsWith(`${assetBaseUrl}agents/`)
}

function isAbsoluteLocalPath(value: string) {
  if (value.startsWith('file:')) return true
  if (windowsAbsolutePathPattern.test(value) || uncPathPattern.test(value)) return true
  if (value.startsWith('/') && !isAppApiPath(value) && !isBundledPortraitAsset(value)) return true
  return false
}

export function localPortraitPathFromInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const pathname = decodeURIComponent(url.pathname)
      return /^\/[a-zA-Z]:\//.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      return ''
    }
  }
  return isAbsoluteLocalPath(trimmed) ? trimmed : ''
}

export function agentPortraitSrc(agentId: string | undefined, portrait: string | undefined): string {
  const value = portrait?.trim() || ''
  if (!value) return ''
  if (isBrowserRuntimeUrl(value)) return value
  if (isAppApiPath(value)) return apiUrl(value)
  if (isBundledPortraitAsset(value)) return value
  if (!agentId) return ''
  // The avatar endpoint is intentionally stable, but the underlying file can
  // change when a user selects a new image. Include the stored portrait value
  // as a cache-busting revision so mounted <img> elements request the update.
  return apiUrl(`/api/party/avatar/${encodeURIComponent(agentId)}?v=${encodeURIComponent(value)}`)
}

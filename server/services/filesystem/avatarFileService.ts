import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const AVATAR_UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024
export const AVATAR_IMAGE_TYPE_ERROR = 'Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image.'
export const AVATAR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.svg'])
export const AVATAR_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/svg+xml': '.svg',
}

export type ManagedAvatarFileNameOptions = {
  now?: () => number
  randomHex?: (bytes: number) => string
}

function normalizeAvatarContentType(contentType: string | undefined) {
  return (contentType || '').split(';', 1)[0].trim().toLowerCase()
}

export function isSupportedAvatarImagePath(filePath: string) {
  return AVATAR_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function avatarUploadFileName(rawName: string | undefined, contentType: string | undefined) {
  const cleanName = path.basename((rawName || 'avatar').trim() || 'avatar')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 180)
  const rawExtFromName = path.extname(cleanName)
  const extFromName = rawExtFromName.toLowerCase()
  if (extFromName && !AVATAR_IMAGE_EXTENSIONS.has(extFromName)) {
    throw new Error(AVATAR_IMAGE_TYPE_ERROR)
  }
  const ext = extFromName || AVATAR_IMAGE_MIME_EXTENSIONS[normalizeAvatarContentType(contentType)] || ''
  if (!ext) throw new Error(AVATAR_IMAGE_TYPE_ERROR)
  const stem = path.basename(cleanName, rawExtFromName || ext).trim() || 'avatar'
  return `${stem}${ext}`
}

export function managedAvatarFileName(agentId: string, sourcePath: string, options: ManagedAvatarFileNameOptions = {}) {
  const ext = path.extname(sourcePath).toLowerCase() || '.png'
  const stem = path.basename(sourcePath, path.extname(sourcePath))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'avatar'
  const now = options.now ?? Date.now
  const randomHex = options.randomHex ?? ((bytes: number) => randomBytes(bytes).toString('hex'))
  return `${agentId}-${stem}-${now().toString(36)}-${randomHex(4)}${ext}`
}

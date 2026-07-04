import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const AVATAR_UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024
export const AVATAR_IMAGE_TYPE_ERROR = 'Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image.'
export const AVATAR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.svg'])
const AVATAR_IMAGE_SIGNATURE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}
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

function canonicalAvatarSignatureMimeType(mimeType: string) {
  if (mimeType === 'image/jpg') return 'image/jpeg'
  if (mimeType === 'image/vnd.microsoft.icon') return 'image/x-icon'
  return mimeType
}

function avatarImageSignatureMimeFromBytes(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp'
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/x-icon'
  }
  const textPrefix = bytes.subarray(0, 4096).toString('utf-8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
  if (textPrefix.startsWith('<svg') || (textPrefix.startsWith('<?xml') && textPrefix.includes('<svg'))) {
    return 'image/svg+xml'
  }
  return null
}

function avatarUploadLimitLabel(limitBytes: number) {
  const mib = limitBytes / (1024 * 1024)
  if (Number.isInteger(mib) && mib >= 1) return `${mib} MB`
  return `${limitBytes} bytes`
}

export function avatarUploadLimitErrorMessage(limitBytes = AVATAR_UPLOAD_LIMIT_BYTES) {
  return `Choose an image smaller than ${avatarUploadLimitLabel(limitBytes)}.`
}

export function assertAvatarUploadSize(sizeBytes: number, limitBytes = AVATAR_UPLOAD_LIMIT_BYTES) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error('Choose an image file to upload.')
  }
  if (sizeBytes > limitBytes) throw new Error(avatarUploadLimitErrorMessage(limitBytes))
}

export function assertAvatarUploadBytes(bytes: unknown, limitBytes = AVATAR_UPLOAD_LIMIT_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Choose an image file to upload.')
  assertAvatarUploadSize(bytes.length, limitBytes)
}

export function assertAvatarImageUploadSignature(bytes: Buffer, sourceName: string, contentType?: string) {
  const expectedMimeType = AVATAR_IMAGE_SIGNATURE_EXTENSIONS[path.extname(sourceName).toLowerCase()] || null
  if (!expectedMimeType) throw new Error(AVATAR_IMAGE_TYPE_ERROR)

  const declaredMimeType = canonicalAvatarSignatureMimeType(normalizeAvatarContentType(contentType))
  if (declaredMimeType && declaredMimeType !== 'application/octet-stream' && declaredMimeType !== expectedMimeType) {
    throw new Error('Avatar file type does not match its extension.')
  }

  const detectedMimeType = avatarImageSignatureMimeFromBytes(bytes)
  if (detectedMimeType !== expectedMimeType) {
    throw new Error('Avatar file contents do not match the declared image type.')
  }
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

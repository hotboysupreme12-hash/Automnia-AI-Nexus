import { withUploadCapacity } from './uploadCapacity'
import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileHandle } from 'node:fs/promises'

async function readBounded(handle: FileHandle, limit: number) {
  const buffer = Buffer.alloc(limit + 1)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
    if (!bytesRead) break
    offset += bytesRead
  }
  if (offset > limit) throw new Error('Attachment exceeded its recorded size.')
  return buffer.subarray(0, offset)
}

export const COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024
export const COMMAND_CONSOLE_GATEWAY_IMAGE_LIMIT_BYTES = 6 * 1024 * 1024
export const COMMAND_CONSOLE_GATEWAY_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024
export const COMMAND_CONSOLE_UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COMMAND_CONSOLE_UPLOAD_MANIFEST_VERSION = 2
const DEFAULT_COMMAND_CONSOLE_UPLOAD_CLEANUP_DELETE_LIMIT = 200
const MAX_COMMAND_CONSOLE_UPLOAD_CLEANUP_SCAN_LIMIT = 10_000
const MAX_COMMAND_CONSOLE_UPLOAD_CLEANUP_DELETE_LIMIT = 500

const COMMAND_CONSOLE_UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif',
  '.pdf', '.doc', '.docx', '.docm', '.odt', '.rtf', '.ppt', '.pptx', '.pptm', '.odp', '.xls', '.xlsx', '.xlsm', '.ods', '.epub',
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.ipynb', '.java', '.go', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.rb', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.toml', '.ini', '.env',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus', '.aiff', '.aif', '.amr', '.caf',
  '.mp4', '.m4v', '.mov', '.webm', '.mpeg', '.mpg', '.mpegps', '.avi', '.mkv', '.3gp', '.wmv', '.flv',
])

const COMMAND_CONSOLE_IMAGE_ATTACHMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

const COMMAND_CONSOLE_SIGNATURE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
}

const COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-word.document.macroEnabled.12': '.docm',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12': '.pptm',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel.sheet.macroEnabled.12': '.xlsm',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/epub+zip': '.epub',
  'application/json': '.json',
  'application/x-ndjson': '.jsonl',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/markdown': '.md',
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/yaml': '.yaml',
  'application/x-yaml': '.yaml',
  'text/yaml': '.yaml',
  'text/plain': '.txt',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/opus': '.opus',
  'audio/aiff': '.aiff',
  'audio/x-aiff': '.aiff',
  'audio/amr': '.amr',
  'audio/x-caf': '.caf',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/x-m4v': '.m4v',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/mpeg': '.mpeg',
  'video/mpg': '.mpg',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'video/3gpp': '.3gp',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
  'video/mpegps': '.mpegps',
}

const COMMAND_CONSOLE_SIGNATURE_MIME_TYPES = new Set(Object.values(COMMAND_CONSOLE_SIGNATURE_EXTENSIONS))

export type CommandConsoleUploadAttachment = {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  kind: 'image' | 'file'
  delivery?: 'inline' | 'workspace'
}

export type CommandConsoleUploadServiceOptions = {
  uploadsDir: string
  approvedRootDir?: string
  storageLimitBytes?: number
  storageFileLimit?: number
  uploadLimitBytes?: number
  imageInlineLimitBytes?: number
  fileInlineLimitBytes?: number
  uploadTtlMs?: number
  cleanupScanLimit?: number
  cleanupDeleteLimit?: number
  ownerId?: () => string
  isPathUnder?: (baseDir: string, targetPath: string) => boolean
  now?: () => number
  randomId?: () => string
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function defaultIsPathUnder(baseDir: string, targetPath: string) {
  const base = path.resolve(baseDir)
  const target = path.resolve(targetPath)
  const relative = path.relative(base, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function uploadLimitLabel(bytes: number) {
  const mb = 1024 * 1024
  if (bytes >= mb && bytes % mb === 0) return `${bytes / mb} MB`
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KB`
  return `${bytes} bytes`
}

export function normalizeCommandConsoleMimeType(value: string | undefined) {
  return (value || '').split(';', 1)[0].trim().toLowerCase()
}

function contentTypeFromUploadName(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') return 'text/javascript; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.jsonl') return 'application/x-ndjson; charset=utf-8'
  if (ext === '.txt' || ext === '.log') return 'text/plain; charset=utf-8'
  if (ext === '.md' || ext === '.markdown') return 'text/markdown; charset=utf-8'
  if (ext === '.csv') return 'text/csv; charset=utf-8'
  if (ext === '.tsv') return 'text/tab-separated-values; charset=utf-8'
  if (ext === '.xml') return 'application/xml; charset=utf-8'
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml; charset=utf-8'
  if (ext === '.py' || ext === '.ipynb' || ext === '.java' || ext === '.go' || ext === '.rs' || ext === '.c' || ext === '.cc' || ext === '.cpp' || ext === '.h' || ext === '.hpp' || ext === '.cs' || ext === '.php' || ext === '.rb' || ext === '.sh' || ext === '.bash' || ext === '.zsh' || ext === '.ps1' || ext === '.sql' || ext === '.toml' || ext === '.ini' || ext === '.env') return 'text/plain; charset=utf-8'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.doc') return 'application/msword'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.docm') return 'application/vnd.ms-word.document.macroEnabled.12'
  if (ext === '.odt') return 'application/vnd.oasis.opendocument.text'
  if (ext === '.rtf') return 'application/rtf'
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint'
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (ext === '.pptm') return 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'
  if (ext === '.odp') return 'application/vnd.oasis.opendocument.presentation'
  if (ext === '.xls') return 'application/vnd.ms-excel'
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === '.xlsm') return 'application/vnd.ms-excel.sheet.macroEnabled.12'
  if (ext === '.ods') return 'application/vnd.oasis.opendocument.spreadsheet'
  if (ext === '.epub') return 'application/epub+zip'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.aac') return 'audio/aac'
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.opus') return 'audio/opus'
  if (ext === '.aiff' || ext === '.aif') return 'audio/aiff'
  if (ext === '.amr') return 'audio/amr'
  if (ext === '.caf') return 'audio/x-caf'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.heic') return 'image/heic'
  if (ext === '.heif') return 'image/heif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.m4v') return 'video/x-m4v'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mpeg' || ext === '.mpg') return 'video/mpeg'
  if (ext === '.mpegps') return 'video/mpegps'
  if (ext === '.avi') return 'video/x-msvideo'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.3gp') return 'video/3gpp'
  if (ext === '.wmv') return 'video/x-ms-wmv'
  if (ext === '.flv') return 'video/x-flv'
  return 'application/octet-stream'
}

function canonicalSignatureMimeType(mimeType: string) {
  if (mimeType === 'image/jpg') return 'image/jpeg'
  if (mimeType === 'audio/mp3') return 'audio/mpeg'
  if (mimeType === 'audio/x-wav') return 'audio/wav'
  if (mimeType === 'audio/opus') return 'audio/ogg'
  return mimeType
}

function commandConsoleSignatureMimeFromBytes(bytes: Buffer): string | null {
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
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf'
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC') {
    return 'audio/flac'
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg'
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav'
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'audio/mpeg'
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) {
    return 'audio/aac'
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg'
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii')
    if (brand === 'M4A ' || brand === 'isom' || brand === 'mp42' || brand === 'mp41') return 'audio/mp4'
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  }
  return null
}

function assertCommandConsoleUploadSignature(bytes: Buffer, safeName: string, resolvedMimeType: string) {
  const extSignatureMimeType = COMMAND_CONSOLE_SIGNATURE_EXTENSIONS[path.extname(safeName).toLowerCase()] || null
  const mimeSignatureMimeType = canonicalSignatureMimeType(resolvedMimeType)
  const requiresMimeSignature = COMMAND_CONSOLE_SIGNATURE_MIME_TYPES.has(mimeSignatureMimeType)
  const compatibleHeifTypes = new Set(['image/heic', 'image/heif'])
  const compatibleMimeTypes = (left: string, right: string) => left === right || (compatibleHeifTypes.has(left) && compatibleHeifTypes.has(right))
  if (requiresMimeSignature && extSignatureMimeType && !compatibleMimeTypes(extSignatureMimeType, mimeSignatureMimeType)) {
    throw new Error('Upload file type does not match its extension.')
  }
  if (requiresMimeSignature && !extSignatureMimeType) {
    throw new Error('Upload file type does not match its extension.')
  }
  const expectedMimeType = extSignatureMimeType || (requiresMimeSignature ? mimeSignatureMimeType : null)
  if (!expectedMimeType) return
  const detectedMimeType = commandConsoleSignatureMimeFromBytes(bytes)
  if (!detectedMimeType || !compatibleMimeTypes(detectedMimeType, expectedMimeType)) {
    throw new Error('Upload file contents do not match the declared file type.')
  }
}

export function commandConsoleUploadFileName(rawName: string | undefined, mimeType: string) {
  const cleanName = path.basename((rawName || 'attachment').trim() || 'attachment')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 180)
  const rawExtFromName = path.extname(cleanName)
  const extFromName = rawExtFromName.toLowerCase()
  if (extFromName && !COMMAND_CONSOLE_UPLOAD_EXTENSIONS.has(extFromName)) {
    throw new Error('Choose a supported image, audio, PDF, video, Office or OpenDocument file, e-book, spreadsheet, presentation, text, code, or data file.')
  }
  const ext = extFromName || COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS[mimeType] || ''
  if (!ext) {
    throw new Error('Choose a supported image, audio, PDF, video, Office or OpenDocument file, e-book, spreadsheet, presentation, text, code, or data file.')
  }
  const stem = path.basename(cleanName, rawExtFromName || ext)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'attachment'
  return `${stem}${ext}`
}

export function createCommandConsoleUploadService(options: CommandConsoleUploadServiceOptions) {
  const uploadsDir = options.uploadsDir
  const approvedRootDir = options.approvedRootDir ?? path.dirname(uploadsDir)
  const uploadLimitBytes = options.uploadLimitBytes ?? COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES
  const imageInlineLimitBytes = options.imageInlineLimitBytes ?? COMMAND_CONSOLE_GATEWAY_IMAGE_LIMIT_BYTES
  const fileInlineLimitBytes = options.fileInlineLimitBytes ?? COMMAND_CONSOLE_GATEWAY_ATTACHMENT_LIMIT_BYTES
  const configuredTtlMs = options.uploadTtlMs ?? COMMAND_CONSOLE_UPLOAD_TTL_MS
  const uploadTtlMs = Number.isFinite(configuredTtlMs)
    ? Math.min(30 * 24 * 60 * 60 * 1000, Math.max(60_000, Math.floor(configuredTtlMs)))
    : COMMAND_CONSOLE_UPLOAD_TTL_MS
  const configuredScanLimit = options.cleanupScanLimit ?? options.storageFileLimit ?? 2_000
  const cleanupScanLimit = Number.isFinite(configuredScanLimit)
    ? Math.min(MAX_COMMAND_CONSOLE_UPLOAD_CLEANUP_SCAN_LIMIT, Math.max(1, Math.floor(configuredScanLimit)))
    : 2_000
  const configuredDeleteLimit = options.cleanupDeleteLimit ?? DEFAULT_COMMAND_CONSOLE_UPLOAD_CLEANUP_DELETE_LIMIT
  const cleanupDeleteLimit = Number.isFinite(configuredDeleteLimit)
    ? Math.min(MAX_COMMAND_CONSOLE_UPLOAD_CLEANUP_DELETE_LIMIT, Math.max(1, Math.floor(configuredDeleteLimit)))
    : DEFAULT_COMMAND_CONSOLE_UPLOAD_CLEANUP_DELETE_LIMIT
  let cleanupScanCursor = 0
  const isPathUnder = options.isPathUnder ?? defaultIsPathUnder
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID

  function currentOwnerKey() {
    const ownerId = (options.ownerId?.() || 'local-control-plane').trim().slice(0, 512)
    if (!ownerId) throw new Error('Could not resolve the upload owner.')
    return createHash('sha256').update(ownerId).digest('hex')
  }

  async function assertUploadWriteRoot(resolvedUploadDir: string) {
    const resolvedApprovedRoot = path.resolve(approvedRootDir)
    const [realApprovedRoot, realUploadDir] = await Promise.all([
      fs.realpath(resolvedApprovedRoot),
      fs.realpath(resolvedUploadDir),
    ])
    if (!isPathUnder(realApprovedRoot, realUploadDir)) {
      throw new Error('Upload directory resolved outside the approved root.')
    }
    return realUploadDir
  }

  async function writeUploadFile(resolvedUploadPath: string, bytes: Buffer) {
    const resolvedUploadDir = path.resolve(uploadsDir)
    await fs.mkdir(resolvedUploadDir, { recursive: true })
    const realUploadDir = await assertUploadWriteRoot(resolvedUploadDir)
    try {
      await fs.writeFile(resolvedUploadPath, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Upload path already exists inside the upload directory.')
      }
      throw error
    }
    const realUploadPath = await fs.realpath(resolvedUploadPath)
    if (!isPathUnder(realUploadDir, realUploadPath)) {
      await fs.rm(resolvedUploadPath, { force: true })
      throw new Error('Upload file resolved outside the upload directory.')
    }
  }

  async function persistUpload(bytes: Buffer, sourceName: string | undefined, rawMimeType: string | undefined): Promise<CommandConsoleUploadAttachment> {
    const mimeType = normalizeCommandConsoleMimeType(rawMimeType) || 'application/octet-stream'
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Choose a file to upload.')
    if (bytes.length > uploadLimitBytes) throw new Error(`Choose a file smaller than ${uploadLimitLabel(uploadLimitBytes)}.`)
    const safeName = commandConsoleUploadFileName(sourceName, mimeType)
    const resolvedMimeType = mimeType === 'application/octet-stream'
      ? normalizeCommandConsoleMimeType(contentTypeFromUploadName(safeName))
      : mimeType
    assertCommandConsoleUploadSignature(bytes, safeName, resolvedMimeType)
    const kind = COMMAND_CONSOLE_IMAGE_ATTACHMENT_MIME_TYPES.has(resolvedMimeType) ? 'image' : 'file'
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const uploadId = randomId()
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uploadId)) throw new Error('Could not allocate an upload identifier.')
    const createdAt = now()
    const expiresAt = createdAt + uploadTtlMs
    const ownerId = currentOwnerKey()
    const uploadPath = path.join(uploadsDir, `${createdAt.toString(36)}-${digest}-${safeName}`)
    const resolvedUploadDir = path.resolve(uploadsDir)
    const resolvedUploadPath = path.resolve(uploadPath)
    if (!isPathUnder(resolvedUploadDir, resolvedUploadPath)) throw new Error('Upload path resolved outside the upload directory.')
    await fs.mkdir(resolvedUploadDir, { recursive: true })
    await assertUploadWriteRoot(resolvedUploadDir)
    await cleanupExpiredUploads()
    return withUploadCapacity(resolvedUploadDir, bytes.length, { bytes: options.storageLimitBytes ?? 2 * 1024 * 1024 * 1024, files: options.storageFileLimit ?? 2000 }, async () => {
    await assertUploadWriteRoot(resolvedUploadDir)
    await writeUploadFile(resolvedUploadPath, bytes)
    const attachment: CommandConsoleUploadAttachment = {
      id: uploadId,
      name: safeName,
      path: resolvedUploadPath,
      mimeType: resolvedMimeType || 'application/octet-stream',
      size: bytes.length,
      kind,
      delivery: bytes.length <= (kind === 'image' ? imageInlineLimitBytes : fileInlineLimitBytes) ? 'inline' : 'workspace',
    }
    try {
      await writeUploadFile(path.join(path.resolve(uploadsDir), `${uploadId}.upload.json`), Buffer.from(JSON.stringify({
        version: COMMAND_CONSOLE_UPLOAD_MANIFEST_VERSION,
        attachment,
        createdAt,
        expiresAt,
        ownerId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })))
    } catch (error) {
      await fs.unlink(resolvedUploadPath).catch(() => undefined)
      throw error
    }
    return attachment
    })
  }

  function normalizeAttachment(value: unknown): CommandConsoleUploadAttachment | null {
    if (!isLooseRecord(value)) return null
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const filePath = typeof value.path === 'string' ? value.path.trim() : ''
    const mimeType = normalizeCommandConsoleMimeType(typeof value.mimeType === 'string' ? value.mimeType : '')
    const size = typeof value.size === 'number' && Number.isFinite(value.size) ? Math.max(0, Math.floor(value.size)) : 0
    const kind = value.kind === 'image' ? 'image' : 'file'
    if (!id || !name || !filePath || !mimeType || size <= 0) return null
    const resolvedUploadDir = path.resolve(uploadsDir)
    const resolvedPath = path.resolve(filePath)
    if (!isPathUnder(resolvedUploadDir, resolvedPath)) return null
    return { id, name, path: resolvedPath, mimeType, size, kind }
  }

  async function resolveAttachmentReadPath(attachment: CommandConsoleUploadAttachment) {
    const resolvedUploadDir = path.resolve(uploadsDir)
    const resolvedPath = path.resolve(attachment.path)
    if (!isPathUnder(resolvedUploadDir, resolvedPath)) return null
    try {
      const [realUploadDir, realPath] = await Promise.all([
        fs.realpath(resolvedUploadDir),
        fs.realpath(resolvedPath),
      ])
      return isPathUnder(realUploadDir, realPath) ? realPath : null
    } catch {
      return null
    }
  }

  async function cleanupExpiredUploads() {
    const resolvedUploadDir = path.resolve(uploadsDir)
    let entries: import('node:fs').Dirent[]
    try {
      await fs.mkdir(resolvedUploadDir, { recursive: true })
      await assertUploadWriteRoot(resolvedUploadDir)
      entries = await fs.readdir(resolvedUploadDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { scanned: 0, removed: 0, failed: 0, truncated: false }
      }
      throw error
    }

    const manifests = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.upload.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
    const truncated = manifests.length > cleanupScanLimit
    const scanCount = Math.min(manifests.length, cleanupScanLimit)
    const scanStart = manifests.length ? cleanupScanCursor % manifests.length : 0
    const candidates = Array.from({ length: scanCount }, (_unused, index) => manifests[(scanStart + index) % manifests.length])
    cleanupScanCursor = manifests.length ? (scanStart + scanCount) % manifests.length : 0
    const expired: Array<{ id: string; attachment: CommandConsoleUploadAttachment; expiresAt: number }> = []
    let failed = 0

    for (const entry of candidates) {
      const id = entry.name.slice(0, -'.upload.json'.length)
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) continue
      try {
        const manifestPath = path.join(resolvedUploadDir, entry.name)
        const realManifest = await resolveAttachmentReadPath({ path: manifestPath } as CommandConsoleUploadAttachment)
        if (!realManifest) continue
        const handle = await fs.open(realManifest, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
        let raw: unknown
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size > 16_384) continue
          raw = JSON.parse((await readBounded(handle, 16_384)).toString('utf8'))
        } finally { await handle.close() }
        if (!isLooseRecord(raw) || raw.version !== COMMAND_CONSOLE_UPLOAD_MANIFEST_VERSION) continue
        const attachment = normalizeAttachment(raw.attachment)
        const createdAt = typeof raw.createdAt === 'number' && Number.isSafeInteger(raw.createdAt) ? raw.createdAt : 0
        const expiresAt = typeof raw.expiresAt === 'number' && Number.isSafeInteger(raw.expiresAt) ? raw.expiresAt : 0
        const sha256 = typeof raw.sha256 === 'string' ? raw.sha256 : ''
        const expectedUploadName = `${createdAt.toString(36)}-${sha256.slice(0, 16)}-${attachment?.name || ''}`
        if (
          !attachment || attachment.id !== id || !createdAt || !expiresAt ||
          path.basename(attachment.path) !== expectedUploadName ||
          !/^[a-f0-9]{64}$/.test(sha256) ||
          !/^[a-f0-9]{64}$/.test(String(raw.ownerId || ''))
        ) continue
        if (expiresAt <= now()) expired.push({ id, attachment, expiresAt })
      } catch {
        failed += 1
      }
    }

    expired.sort((left, right) => left.expiresAt - right.expiresAt)
    let removed = 0
    for (const candidate of expired.slice(0, cleanupDeleteLimit)) {
      try {
        const attachmentPath = path.resolve(candidate.attachment.path)
        if (path.dirname(attachmentPath) !== resolvedUploadDir) continue
        const payloadStat = await fs.lstat(attachmentPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        // Unlinking a symlink removes only the link itself; it never follows the target.
        if (payloadStat && (payloadStat.isFile() || payloadStat.isSymbolicLink())) await fs.unlink(attachmentPath)
        const manifestPath = path.join(resolvedUploadDir, `${candidate.id}.upload.json`)
        const manifestStat = await fs.lstat(manifestPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (manifestStat && (manifestStat.isFile() || manifestStat.isSymbolicLink())) await fs.unlink(manifestPath)
        removed += 1
      } catch {
        failed += 1
      }
    }
    return { scanned: candidates.length, removed, failed, truncated }
  }

  async function gatewayAttachmentsFromTurnAttachments(attachments: unknown[] | undefined) {
    await cleanupExpiredUploads()
    if ((attachments?.length || 0) > 8) throw new Error('Attach at most 8 files to one message.')
    const gatewayAttachments: Record<string, unknown>[] = []
    let inlineBytes = 0
    const seen = new Set<string>()
    for (const input of attachments || []) {
      const id = isLooseRecord(input) && typeof input.id === 'string' ? input.id : ''
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('An attachment is invalid. Remove it and upload the file again.')
      if (seen.has(id)) continue
      seen.add(id)
      let record: { attachment: CommandConsoleUploadAttachment; sha256: string }
      try {
        const manifestPath = path.join(path.resolve(uploadsDir), `${id}.upload.json`)
        const realManifest = await resolveAttachmentReadPath({ path: manifestPath } as CommandConsoleUploadAttachment)
        if (!realManifest) throw new Error('missing')
        const handle = await fs.open(realManifest, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size > 16_384) throw new Error('invalid')
          const raw = JSON.parse((await readBounded(handle, 16_384)).toString('utf8'))
          const attachment = normalizeAttachment(raw.attachment)
          if (
            !isLooseRecord(raw) ||
            raw.version !== COMMAND_CONSOLE_UPLOAD_MANIFEST_VERSION ||
            attachment?.id !== id ||
            raw.ownerId !== currentOwnerKey() ||
            typeof raw.expiresAt !== 'number' ||
            !Number.isSafeInteger(raw.expiresAt) ||
            raw.expiresAt <= now() ||
            !/^[a-f0-9]{64}$/.test(String(raw.sha256 || ''))
          ) throw new Error('invalid')
          record = { attachment, sha256: String(raw.sha256) }
        } finally { await handle.close() }
      } catch { throw new Error('An attachment record is unavailable. Remove it and upload the file again.') }
      const { attachment } = record
      const inlineLimit = attachment.kind === 'image' ? imageInlineLimitBytes : fileInlineLimitBytes
      const readPath = await resolveAttachmentReadPath(attachment)
      if (!readPath) throw new Error(`Attachment ${attachment.name} is unavailable. Upload it again.`)
      const handle = await fs.open(readPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      let bytes: Buffer
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size !== attachment.size) throw new Error(`Attachment ${attachment.name} changed on disk. Upload it again.`)
        if (stat.size > inlineLimit) continue
        if (inlineBytes + stat.size > 20 * 1024 * 1024) throw new Error('These attachments exceed the combined 20 MB inline limit. Send them in separate messages.')
        // A bounded read also limits memory if another process grows the file after stat.
        bytes = await readBounded(handle, stat.size)
        if (bytes.length !== stat.size) throw new Error(`Attachment ${attachment.name} changed on disk. Upload it again.`)
        if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error(`Attachment ${attachment.name} changed on disk. Upload it again.`)
      } finally { await handle.close() }
      inlineBytes += bytes.length
      gatewayAttachments.push({
        type: attachment.kind === 'image' ? 'image' : 'file',
        mimeType: attachment.mimeType,
        fileName: attachment.name,
        content: bytes.toString('base64'),
        name: attachment.name,
      })
    }
    return gatewayAttachments
  }

  return {
    gatewayAttachmentsFromTurnAttachments,
    cleanupExpiredUploads,
    normalizeAttachment,
    persistUpload,
    uploadFileName: commandConsoleUploadFileName,
    uploadLimitBytes,
  }
}

export type CommandConsoleUploadService = ReturnType<typeof createCommandConsoleUploadService>

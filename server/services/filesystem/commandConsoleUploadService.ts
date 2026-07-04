import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024
export const COMMAND_CONSOLE_GATEWAY_IMAGE_LIMIT_BYTES = 6 * 1024 * 1024
export const COMMAND_CONSOLE_GATEWAY_ATTACHMENT_LIMIT_BYTES = 8 * 1024 * 1024

const COMMAND_CONSOLE_UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.rtf', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.ipynb', '.java', '.go', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.rb', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.toml', '.ini', '.env',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus',
])

const COMMAND_CONSOLE_IMAGE_ATTACHMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

const COMMAND_CONSOLE_SIGNATURE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
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
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
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
}

const COMMAND_CONSOLE_SIGNATURE_MIME_TYPES = new Set(Object.values(COMMAND_CONSOLE_SIGNATURE_EXTENSIONS))

export type CommandConsoleUploadAttachment = {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  kind: 'image' | 'file'
}

export type CommandConsoleUploadServiceOptions = {
  uploadsDir: string
  approvedRootDir?: string
  uploadLimitBytes?: number
  imageInlineLimitBytes?: number
  fileInlineLimitBytes?: number
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
  if (ext === '.rtf') return 'application/rtf'
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint'
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (ext === '.xls') return 'application/vnd.ms-excel'
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.aac') return 'audio/aac'
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.opus') return 'audio/opus'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
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
  }
  return null
}

function assertCommandConsoleUploadSignature(bytes: Buffer, safeName: string, resolvedMimeType: string) {
  const extSignatureMimeType = COMMAND_CONSOLE_SIGNATURE_EXTENSIONS[path.extname(safeName).toLowerCase()] || null
  const mimeSignatureMimeType = canonicalSignatureMimeType(resolvedMimeType)
  const requiresMimeSignature = COMMAND_CONSOLE_SIGNATURE_MIME_TYPES.has(mimeSignatureMimeType)
  if (requiresMimeSignature && extSignatureMimeType && extSignatureMimeType !== mimeSignatureMimeType) {
    throw new Error('Upload file type does not match its extension.')
  }
  if (requiresMimeSignature && !extSignatureMimeType) {
    throw new Error('Upload file type does not match its extension.')
  }
  const expectedMimeType = extSignatureMimeType || (requiresMimeSignature ? mimeSignatureMimeType : null)
  if (!expectedMimeType) return
  const detectedMimeType = commandConsoleSignatureMimeFromBytes(bytes)
  if (detectedMimeType !== expectedMimeType) {
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
    throw new Error('Choose a supported image, audio, PDF, Office document, spreadsheet, presentation, text, code, or data file.')
  }
  const ext = extFromName || COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS[mimeType] || ''
  if (!ext) {
    throw new Error('Choose a supported image, audio, PDF, Office document, spreadsheet, presentation, text, code, or data file.')
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
  const isPathUnder = options.isPathUnder ?? defaultIsPathUnder
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID

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
    const uploadPath = path.join(uploadsDir, `${now().toString(36)}-${digest}-${safeName}`)
    const resolvedUploadDir = path.resolve(uploadsDir)
    const resolvedUploadPath = path.resolve(uploadPath)
    if (!isPathUnder(resolvedUploadDir, resolvedUploadPath)) throw new Error('Upload path resolved outside the upload directory.')
    await writeUploadFile(resolvedUploadPath, bytes)
    return {
      id: uploadId,
      name: safeName,
      path: resolvedUploadPath,
      mimeType: resolvedMimeType || 'application/octet-stream',
      size: bytes.length,
      kind,
    }
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

  async function gatewayAttachmentsFromTurnAttachments(attachments: unknown[] | undefined) {
    const normalized = (attachments || []).map(normalizeAttachment).filter((entry): entry is CommandConsoleUploadAttachment => Boolean(entry))
    const gatewayAttachments: Record<string, unknown>[] = []
    for (const attachment of normalized) {
      const inlineLimit = attachment.kind === 'image' ? imageInlineLimitBytes : fileInlineLimitBytes
      if (attachment.size > inlineLimit) continue
      const readPath = await resolveAttachmentReadPath(attachment)
      if (!readPath) continue
      const bytes = await fs.readFile(readPath)
      if (bytes.length > inlineLimit) continue
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
    normalizeAttachment,
    persistUpload,
    uploadFileName: commandConsoleUploadFileName,
    uploadLimitBytes,
  }
}

export type CommandConsoleUploadService = ReturnType<typeof createCommandConsoleUploadService>

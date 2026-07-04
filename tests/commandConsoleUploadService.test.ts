import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  commandConsoleUploadFileName,
  createCommandConsoleUploadService,
} from '../server/services/filesystem/commandConsoleUploadService'

async function createTempUploadsRoot(t: { after(callback: () => Promise<void> | void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dystopai-command-uploads-'))
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
])
const WAV_BYTES = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary')

test('command console upload service persists sanitized supported uploads inside the upload root', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({
    uploadsDir,
    now: () => 1_717_171_717_000,
    randomId: () => 'upload-id',
  })

  const attachment = await service.persistUpload(
    Buffer.from('{"ok":true}', 'utf-8'),
    'Quarterly Report!!.JSON',
    'application/octet-stream',
  )

  assert.equal(attachment.id, 'upload-id')
  assert.equal(attachment.name, 'quarterly-report.json')
  assert.equal(attachment.mimeType, 'application/json')
  assert.equal(attachment.kind, 'file')
  assert.equal(path.dirname(attachment.path), path.resolve(uploadsDir))
  assert.equal(await fs.readFile(attachment.path, 'utf-8'), '{"ok":true}')
})

test('command console upload service strips traversal segments from upload source names', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({
    uploadsDir,
    now: () => 1_717_171_717_000,
    randomId: () => 'upload-id',
  })

  const attachment = await service.persistUpload(
    Buffer.from('# Notes\n', 'utf-8'),
    path.join('..', '..', 'Operator Notes.MD'),
    'application/octet-stream',
  )

  assert.equal(attachment.name, 'operator-notes.md')
  assert.equal(path.dirname(attachment.path), path.resolve(uploadsDir))
  assert.equal(await fs.readFile(attachment.path, 'utf-8'), '# Notes\n')
})

test('command console upload service accepts supported extension and MIME fallback upload types', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({
    uploadsDir,
    now: () => 1_717_171_717_000,
    randomId: () => 'upload-id',
  })

  const image = await service.persistUpload(PNG_BYTES, 'Screenshot.PNG', 'application/octet-stream')
  const pdf = await service.persistUpload(Buffer.from('%PDF-1.7\n', 'utf-8'), 'reference', 'application/pdf')
  const audio = await service.persistUpload(WAV_BYTES, 'clip.wav', 'audio/x-wav')

  assert.equal(image.name, 'screenshot.png')
  assert.equal(image.mimeType, 'image/png')
  assert.equal(image.kind, 'image')
  assert.equal(pdf.name, 'reference.pdf')
  assert.equal(pdf.mimeType, 'application/pdf')
  assert.equal(pdf.kind, 'file')
  assert.equal(audio.name, 'clip.wav')
  assert.equal(audio.mimeType, 'audio/x-wav')
  assert.equal(audio.kind, 'file')
})

test('command console upload service requires high-risk file signatures to match names and MIME types', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({ uploadsDir })

  await assert.rejects(
    service.persistUpload(Buffer.from('not really a png', 'utf-8'), 'screenshot.png', 'application/octet-stream'),
    /contents do not match/,
  )
  await assert.rejects(
    service.persistUpload(Buffer.from('not really a pdf', 'utf-8'), 'reference.pdf', 'application/pdf'),
    /contents do not match/,
  )
  await assert.rejects(
    service.persistUpload(PNG_BYTES, 'notes.txt', 'image/png'),
    /does not match its extension/,
  )
})

test('command console upload service rejects unsupported file types and oversized uploads', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({ uploadsDir, uploadLimitBytes: 4 })

  assert.throws(
    () => commandConsoleUploadFileName('payload.exe', 'image/png'),
    /supported image, audio, PDF/,
  )
  await assert.rejects(
    service.persistUpload(Buffer.from('MZ', 'utf-8'), 'payload.exe', 'image/png'),
    /supported image, audio, PDF/,
  )
  await assert.rejects(
    service.persistUpload(Buffer.from('12345', 'utf-8'), 'notes.txt', 'text/plain'),
    /smaller than 4 bytes/,
  )
})

test('command console upload service enforces upload persistence size limits at the exact boundary', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const service = createCommandConsoleUploadService({
    uploadsDir,
    uploadLimitBytes: 4,
    now: () => 1_717_171_717_000,
    randomId: () => 'boundary-upload',
  })

  const exactLimit = await service.persistUpload(Buffer.from('1234', 'utf-8'), 'limit.txt', 'text/plain')

  assert.equal(exactLimit.id, 'boundary-upload')
  assert.equal(exactLimit.size, 4)
  assert.equal(await fs.readFile(exactLimit.path, 'utf-8'), '1234')
  await assert.rejects(
    service.persistUpload(Buffer.from('12345', 'utf-8'), 'too-large.txt', 'text/plain'),
    /smaller than 4 bytes/,
  )
  assert.deepEqual((await fs.readdir(uploadsDir)).sort(), [path.basename(exactLimit.path)])
})

test('command console upload service normalizes attachment metadata without allowing root escapes', async (t) => {
  const root = await createTempUploadsRoot(t)
  const uploadsDir = path.join(root, 'uploads')
  const siblingDir = path.join(root, 'uploads-other')
  await fs.mkdir(uploadsDir, { recursive: true })
  await fs.mkdir(siblingDir, { recursive: true })
  const acceptedPath = path.join(uploadsDir, 'accepted.txt')
  const siblingPath = path.join(siblingDir, 'accepted.txt')
  await fs.writeFile(acceptedPath, 'ok', 'utf-8')
  await fs.writeFile(siblingPath, 'no', 'utf-8')
  const service = createCommandConsoleUploadService({ uploadsDir })

  assert.deepEqual(service.normalizeAttachment({
    id: 'attachment-1',
    name: 'accepted.txt',
    path: acceptedPath,
    mimeType: 'text/plain; charset=utf-8',
    size: 2,
    kind: 'file',
  }), {
    id: 'attachment-1',
    name: 'accepted.txt',
    path: path.resolve(acceptedPath),
    mimeType: 'text/plain',
    size: 2,
    kind: 'file',
  })
  assert.equal(service.normalizeAttachment({
    id: 'attachment-2',
    name: 'escaped.txt',
    path: siblingPath,
    mimeType: 'text/plain',
    size: 2,
    kind: 'file',
  }), null)
})

test('command console upload service rejects symlinked upload roots outside the approved root', async (t) => {
  const root = await createTempUploadsRoot(t)
  const workspaceRoot = path.join(root, 'workspace')
  const uploadsParent = path.join(workspaceRoot, '.openclaw')
  const uploadsDir = path.join(uploadsParent, 'command-console-uploads')
  const outsideDir = path.join(root, 'outside-uploads')
  await fs.mkdir(uploadsParent, { recursive: true })
  await fs.mkdir(outsideDir, { recursive: true })
  try {
    await fs.symlink(outsideDir, uploadsDir, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
      t.skip(`filesystem directory symlinks are unavailable in this environment: ${code}`)
      return
    }
    throw error
  }
  const service = createCommandConsoleUploadService({
    uploadsDir,
    approvedRootDir: workspaceRoot,
    now: () => 1_717_171_717_000,
    randomId: () => 'upload-id',
  })

  await assert.rejects(
    service.persistUpload(Buffer.from('safe', 'utf-8'), 'notes.txt', 'text/plain'),
    /approved root/,
  )
  assert.deepEqual(await fs.readdir(outsideDir), [])
})

test('command console upload service refuses preexisting symlink upload targets before write', async (t) => {
  const root = await createTempUploadsRoot(t)
  const uploadsDir = path.join(root, 'uploads')
  const outsidePath = path.join(root, 'outside.txt')
  const bytes = Buffer.from('safe upload', 'utf-8')
  const now = 1_717_171_717_000
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const uploadPath = path.join(uploadsDir, `${now.toString(36)}-${digest}-notes.txt`)
  await fs.mkdir(uploadsDir, { recursive: true })
  await fs.writeFile(outsidePath, 'external content', 'utf-8')
  try {
    await fs.symlink(outsidePath, uploadPath, 'file')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
      t.skip(`filesystem symlinks are unavailable in this environment: ${code}`)
      return
    }
    throw error
  }
  const service = createCommandConsoleUploadService({
    uploadsDir,
    approvedRootDir: root,
    now: () => now,
    randomId: () => 'upload-id',
  })

  await assert.rejects(
    service.persistUpload(bytes, 'notes.txt', 'text/plain'),
    /already exists/,
  )
  assert.equal(await fs.readFile(outsidePath, 'utf-8'), 'external content')
})

test('command console upload service rejects upload persistence when containment guard rejects writes', async (t) => {
  const root = await createTempUploadsRoot(t)
  const uploadsDir = path.join(root, 'uploads')
  const service = createCommandConsoleUploadService({
    uploadsDir,
    isPathUnder: () => false,
  })

  await assert.rejects(
    service.persistUpload(Buffer.from('safe', 'utf-8'), 'notes.txt', 'text/plain'),
    /outside the upload directory/,
  )
  await assert.rejects(
    fs.access(uploadsDir),
    /ENOENT/,
  )
})

test('command console upload service builds Gateway attachment payloads and skips oversized inline files', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  const smallPath = path.join(uploadsDir, 'small.txt')
  const bigPath = path.join(uploadsDir, 'big.txt')
  await fs.mkdir(uploadsDir, { recursive: true })
  await fs.writeFile(smallPath, 'abc', 'utf-8')
  await fs.writeFile(bigPath, 'abcd', 'utf-8')
  const service = createCommandConsoleUploadService({ uploadsDir, fileInlineLimitBytes: 3 })

  const attachments = await service.gatewayAttachmentsFromTurnAttachments([
    { id: 'small', name: 'small.txt', path: smallPath, mimeType: 'text/plain', size: 3, kind: 'file' },
    { id: 'big', name: 'big.txt', path: bigPath, mimeType: 'text/plain', size: 4, kind: 'file' },
    { id: 'outside', name: 'outside.txt', path: path.join(path.dirname(uploadsDir), 'outside.txt'), mimeType: 'text/plain', size: 1, kind: 'file' },
  ])

  assert.deepEqual(attachments, [{
    type: 'file',
    mimeType: 'text/plain',
    fileName: 'small.txt',
    content: Buffer.from('abc', 'utf-8').toString('base64'),
    name: 'small.txt',
  }])
})

test('command console upload service enforces Gateway inline attachment size limits for files and images', async (t) => {
  const uploadsDir = await createTempUploadsRoot(t)
  await fs.mkdir(uploadsDir, { recursive: true })
  const fileAtLimitPath = path.join(uploadsDir, 'file-at-limit.txt')
  const fileDeclaredTooLargePath = path.join(uploadsDir, 'file-declared-too-large.txt')
  const fileActualTooLargePath = path.join(uploadsDir, 'file-actual-too-large.txt')
  const imageAtLimitPath = path.join(uploadsDir, 'image-at-limit.png')
  const imageDeclaredTooLargePath = path.join(uploadsDir, 'image-declared-too-large.png')
  await fs.writeFile(fileAtLimitPath, 'abcd', 'utf-8')
  await fs.writeFile(fileDeclaredTooLargePath, 'abc', 'utf-8')
  await fs.writeFile(fileActualTooLargePath, 'abcde', 'utf-8')
  await fs.writeFile(imageAtLimitPath, Buffer.from([0x01, 0x02, 0x03]))
  await fs.writeFile(imageDeclaredTooLargePath, Buffer.from([0x04, 0x05]))
  const service = createCommandConsoleUploadService({
    uploadsDir,
    fileInlineLimitBytes: 4,
    imageInlineLimitBytes: 3,
  })

  const attachments = await service.gatewayAttachmentsFromTurnAttachments([
    { id: 'file-at-limit', name: 'file-at-limit.txt', path: fileAtLimitPath, mimeType: 'text/plain', size: 4, kind: 'file' },
    { id: 'file-declared-too-large', name: 'file-declared-too-large.txt', path: fileDeclaredTooLargePath, mimeType: 'text/plain', size: 5, kind: 'file' },
    { id: 'file-actual-too-large', name: 'file-actual-too-large.txt', path: fileActualTooLargePath, mimeType: 'text/plain', size: 4, kind: 'file' },
    { id: 'image-at-limit', name: 'image-at-limit.png', path: imageAtLimitPath, mimeType: 'image/png', size: 3, kind: 'image' },
    { id: 'image-declared-too-large', name: 'image-declared-too-large.png', path: imageDeclaredTooLargePath, mimeType: 'image/png', size: 4, kind: 'image' },
  ])

  assert.deepEqual(attachments, [
    {
      type: 'file',
      mimeType: 'text/plain',
      fileName: 'file-at-limit.txt',
      content: Buffer.from('abcd', 'utf-8').toString('base64'),
      name: 'file-at-limit.txt',
    },
    {
      type: 'image',
      mimeType: 'image/png',
      fileName: 'image-at-limit.png',
      content: Buffer.from([0x01, 0x02, 0x03]).toString('base64'),
      name: 'image-at-limit.png',
    },
  ])
})

test('command console upload service skips symlinked attachment escapes before inline Gateway reads', async (t) => {
  const root = await createTempUploadsRoot(t)
  const uploadsDir = path.join(root, 'uploads')
  const outsidePath = path.join(root, 'secret.txt')
  const linkPath = path.join(uploadsDir, 'linked-secret.txt')
  await fs.mkdir(uploadsDir, { recursive: true })
  await fs.writeFile(outsidePath, 'external secret', 'utf-8')
  try {
    await fs.symlink(outsidePath, linkPath, 'file')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
      t.skip(`filesystem symlinks are unavailable in this environment: ${code}`)
      return
    }
    throw error
  }

  const service = createCommandConsoleUploadService({ uploadsDir })

  assert.notEqual(service.normalizeAttachment({
    id: 'linked',
    name: 'linked-secret.txt',
    path: linkPath,
    mimeType: 'text/plain',
    size: 'external secret'.length,
    kind: 'file',
  }), null)
  assert.deepEqual(await service.gatewayAttachmentsFromTurnAttachments([
    {
      id: 'linked',
      name: 'linked-secret.txt',
      path: linkPath,
      mimeType: 'text/plain',
      size: 'external secret'.length,
      kind: 'file',
    },
  ]), [])
})

import assert from 'node:assert/strict'
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

  const image = await service.persistUpload(Buffer.from('image-bytes', 'utf-8'), 'Screenshot.PNG', 'application/octet-stream')
  const pdf = await service.persistUpload(Buffer.from('%PDF', 'utf-8'), 'reference', 'application/pdf')

  assert.equal(image.name, 'screenshot.png')
  assert.equal(image.mimeType, 'image/png')
  assert.equal(image.kind, 'image')
  assert.equal(pdf.name, 'reference.pdf')
  assert.equal(pdf.mimeType, 'application/pdf')
  assert.equal(pdf.kind, 'file')
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

import express, { type Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { ControlFilesService } from '../services/controlFilesService'

type CommandConsoleFileRoutesOptions = {
  controlFiles: ControlFilesService
  persistCommandConsoleUpload: (bytes: Buffer, sourceName: string | undefined, rawMimeType: string | undefined) => Promise<unknown>
  uploadLimitBytes: number
}

const COMMAND_CONSOLE_UPLOAD_CONTENT_TYPES = [
  'image/*',
  'audio/*',
  'text/*',
  'application/octet-stream',
  'application/pdf',
  'application/json',
  'application/x-ndjson',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/msword',
  'application/rtf',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

export function registerCommandConsoleFileRoutes(app: Express, options: CommandConsoleFileRoutesOptions) {
  const { controlFiles } = options

  app.get('/api/files', (_req, res) => {
    return apiSuccess(res, { files: controlFiles.files })
  })

  app.post('/api/files/upload', express.raw({
    type: COMMAND_CONSOLE_UPLOAD_CONTENT_TYPES,
    limit: options.uploadLimitBytes,
  }), async (req, res) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const name = typeof req.query.name === 'string' ? req.query.name : undefined
      const mimeType =
        (typeof req.query.mimeType === 'string' ? req.query.mimeType : undefined) ||
        req.get('x-file-type') ||
        req.get('content-type') ||
        undefined
      const attachment = await options.persistCommandConsoleUpload(bytes, name, mimeType)
      return apiSuccess(res, { attachment })
    } catch (error) {
      return apiFailure(res, 400, 'file_upload_failed', 'Upload failed', error instanceof Error ? error.message : String(error))
    }
  })

  app.get('/api/files/:file', async (req, res) => {
    const file = req.params.file
    if (!controlFiles.isAllowedFile(file)) return apiFailure(res, 400, 'invalid_payload', 'File is not in allowed control list.')

    try {
      return apiSuccess(res, { file, content: await controlFiles.readFile(file) })
    } catch (error) {
      return apiFailure(res, 404, 'control_file_operation_failed', `Could not read ${file}`, String(error))
    }
  })

  app.put('/api/files/:file', async (req, res) => {
    const file = req.params.file
    if (!controlFiles.isAllowedFile(file)) return apiFailure(res, 400, 'invalid_payload', 'File is not in allowed control list.')

    const schema = z.object({ content: z.string() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      await controlFiles.writeFile(file, parsed.data.content)
      return apiSuccess(res, { file })
    } catch (error) {
      return apiFailure(res, 500, 'control_file_operation_failed', `Could not write ${file}`, String(error))
    }
  })
}

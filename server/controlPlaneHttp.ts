import cors from 'cors'
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { applyDiagnosticRedactions } from '../src/utils/diagnosticRedaction'

export const CONTROL_CENTER_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

export type ApiErrorCode =
  | 'agent_not_found'
  | 'agent_preflight_failed'
  | 'agent_retire_failed'
  | 'agent_session_operation_failed'
  | 'agent_turn_failed'
  | 'agent_config_sync_failed'
  | 'avatar_preview_failed'
  | 'avatar_upload_failed'
  | 'auth_required'
  | 'auth_provider_failed'
  | 'clawtalk_console_failed'
  | 'control_file_operation_failed'
  | 'doctor_operation_failed'
  | 'filesystem_operation_failed'
  | 'file_upload_failed'
  | 'folder_list_failed'
  | 'folder_picker_failed'
  | 'image_picker_failed'
  | 'invalid_json'
  | 'invalid_payload'
  | 'invalid_token'
  | 'mission_invalid_state'
  | 'mission_not_found'
  | 'mission_report_not_found'
  | 'mission_scheduler_failed'
  | 'model_auth_required'
  | 'model_catalog_failed'
  | 'model_operation_failed'
  | 'origin_not_allowed'
  | 'oauth_operation_failed'
  | 'openclaw_command_failed'
  | 'openclaw_summary_failed'
  | 'party_dispatch_failed'
  | 'party_handoff_failed'
  | 'party_operation_failed'
  | 'party_coordination_failed'
  | 'plugin_command_failed'
  | 'plugin_not_found'
  | 'plugin_operation_failed'
  | 'plugin_terminal_failed'
  | 'runtime_status_failed'
  | 'runtime_action_failed'
  | 'runtime_summary_failed'
  | 'resource_not_found'
  | 'recruit_failed'
  | 'shift_command_failed'
  | 'shift_operation_failed'
  | 'skill_command_failed'
  | 'skill_not_found'
  | 'skill_operation_failed'
  | 'team_sync_failed'
  | 'workspace_unwritable'

type ControlPlaneHttpOptions = {
  authToken: string
  frontendPort: number
  port: number
  sessionTokens: Set<string>
}

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/status'])

export function controlCenterAllowedOrigins(port: number, frontendPort: number) {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${frontendPort}`,
    `http://localhost:${frontendPort}`,
  ])
}

export function isAllowedControlCenterOrigin(origin: string | undefined, port: number, frontendPort: number) {
  if (!origin) return true
  try {
    return controlCenterAllowedOrigins(port, frontendPort).has(new URL(origin).origin)
  } catch {
    return false
  }
}

export function requestIdFor(req: Request) {
  const existing = req.get('x-request-id') || req.get('x-control-center-request-id')
  return existing?.trim() || randomUUID()
}

function bearerToken(req: Request) {
  const header = req.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || ''
}

function apiPath(req: Request) {
  return (req.originalUrl.split('?')[0] || req.path).replace(/\/+$/, '') || '/'
}

function isPublicApiRequest(req: Request) {
  return req.method === 'OPTIONS' || PUBLIC_API_PATHS.has(apiPath(req))
}

export function setStaticSecurityHeaders(res: Response, filePath: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html' || ext === '.htm') {
    res.setHeader('Content-Security-Policy', CONTROL_CENTER_CONTENT_SECURITY_POLICY)
  }
}

function responseRequestId(res: Response): string {
  return String(res.getHeader('X-Request-Id') || randomUUID())
}

export function apiSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({
    ok: true,
    data,
    requestId: responseRequestId(res),
  })
}

function sanitizeApiErrorDetail(detail: unknown): unknown {
  if (detail === undefined || detail === null) return undefined
  if (typeof detail === 'string') return applyDiagnosticRedactions(detail)
  if (detail instanceof Error) return applyDiagnosticRedactions(detail.message)
  return detail
}

export function apiFailure(res: Response, status: number, code: ApiErrorCode, message: string, detail?: unknown) {
  const error: Record<string, unknown> = {
    code,
    message: applyDiagnosticRedactions(message),
    status,
  }
  const cleanDetail = sanitizeApiErrorDetail(detail)
  if (cleanDetail !== undefined) error.detail = cleanDetail
  return res.status(status).json({
    ok: false,
    error,
    requestId: responseRequestId(res),
  })
}

export function installControlPlaneHttp(app: Express, options: ControlPlaneHttpOptions) {
  app.set('etag', false)
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', requestIdFor(req))
    next()
  })
  app.use(cors({
    origin(origin, callback) {
      callback(null, isAllowedControlCenterOrigin(origin, options.port, options.frontendPort) ? origin || true : false)
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Control-Center-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }))
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(express.json({ limit: '4mb' }))
  app.use(jsonParseErrorHandler)
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin')
    if (!isAllowedControlCenterOrigin(origin, options.port, options.frontendPort)) {
      return apiFailure(res, 403, 'origin_not_allowed', 'Request origin is not allowed')
    }
    if (isPublicApiRequest(req)) return next()
    const token = bearerToken(req)
    if (!token || (!options.sessionTokens.has(token) && token !== options.authToken)) {
      return apiFailure(res, 401, 'auth_required', 'Authentication required')
    }
    return next()
  })
}

const jsonParseErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    apiFailure(
      res,
      400,
      'invalid_json',
      'Invalid JSON payload',
      {
        detail: error.message,
        hint: 'Send valid JSON with Content-Type: application/json. For fetch, use body: JSON.stringify(payload).',
      },
    )
    return
  }
  next(error)
}

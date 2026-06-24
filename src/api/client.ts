import { apiUrl } from '../utils/apiUrl'
import { redactDiagnosticText } from '../utils/diagnosticRedaction'

const DEFAULT_TIMEOUT_MS = 20_000
const CONTROL_CENTER_TOKEN_KEY = 'control-center-token'

export type ApiErrorEnvelope = {
  code: string
  message: string
  detail?: string
  status: number
  requestId: string
  url: string
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number; requestId: string; response: Response }
  | { ok: false; error: ApiErrorEnvelope; status: number; requestId: string; response?: Response }

export type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown
  headers?: HeadersInit
  timeoutMs?: number
  requestId?: string
  authToken?: string | null
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(CONTROL_CENTER_TOKEN_KEY)
  } catch {
    return null
  }
}

function hasHeader(headers: Headers, name: string): boolean {
  return Boolean(headers.get(name))
}

function requestBodyAndHeaders(body: unknown, headers: Headers): BodyInit | null | undefined {
  if (body === undefined) return undefined
  if (body === null) return null
  if (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  ) {
    return body
  }
  if (!hasHeader(headers, 'Content-Type')) headers.set('Content-Type', 'application/json')
  return JSON.stringify(body)
}

function sanitizeDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return redactDiagnosticText(value, 700)
  try {
    return redactDiagnosticText(JSON.stringify(value), 700)
  } catch {
    return redactDiagnosticText(String(value), 700)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function payloadErrorMessage(payload: unknown): { message?: string; detail?: unknown; code?: string } {
  if (!payload || typeof payload !== 'object') return {}
  const record = payload as Record<string, unknown>
  const error = record.error
  const message = record.message
  if (isRecord(error)) {
    return {
      message: typeof error.message === 'string' ? error.message : typeof message === 'string' ? message : undefined,
      detail: error.detail ?? record.detail,
      code: typeof error.code === 'string' ? error.code : typeof record.code === 'string' ? record.code : undefined,
    }
  }
  return {
    message: typeof error === 'string' ? error : typeof message === 'string' ? message : undefined,
    detail: record.detail,
    code: typeof record.code === 'string' ? record.code : undefined,
  }
}

function isExplicitFailurePayload(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false)
}

function successPayloadData(payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  if (payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data
  return payload
}

function composeSignal(inputSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abortFromInput = () => {
    if (!controller.signal.aborted) controller.abort(inputSignal?.reason)
  }
  if (inputSignal?.aborted) abortFromInput()
  else inputSignal?.addEventListener('abort', abortFromInput, { once: true })

  const timer = window.setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'))
    }
  }, timeoutMs)

  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer)
      inputSignal?.removeEventListener('abort', abortFromInput)
    },
  }
}

async function readResponsePayload(response: Response): Promise<{ payload: unknown; text: string }> {
  const text = await response.text()
  if (!text.trim()) return { payload: undefined, text }
  try {
    return { payload: JSON.parse(text) as unknown, text }
  } catch {
    return { payload: text, text }
  }
}

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const requestId = options.requestId || randomRequestId()
  const url = apiUrl(path)
  const headers = new Headers(options.headers)
  headers.set('X-Request-Id', requestId)

  const token = options.authToken ?? readStoredAuthToken()
  if (token && !hasHeader(headers, 'Authorization')) headers.set('Authorization', `Bearer ${token}`)

  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const { signal, dispose } = composeSignal(options.signal ?? undefined, timeoutMs)
  const body = requestBodyAndHeaders(options.body, headers)

  try {
    const response = await fetch(url, { ...options, body, headers, signal })
    const responseRequestId = response.headers.get('x-request-id') || response.headers.get('x-control-center-request-id') || requestId
    const { payload, text } = await readResponsePayload(response)
    const payloadFailure = isExplicitFailurePayload(payload)
    if (response.ok && !payloadFailure) {
      return { ok: true, data: successPayloadData(payload) as T, status: response.status, requestId: responseRequestId, response }
    }

    const payloadError = payloadErrorMessage(payload)
    const message = payloadError.message || response.statusText || `HTTP ${response.status}`
    const detail = payloadError.detail !== undefined ? payloadError.detail : text
    return {
      ok: false,
      status: response.status,
      requestId: responseRequestId,
      response,
      error: {
        code: payloadError.code || (payloadFailure ? 'api_payload_error' : 'http_error'),
        message: redactDiagnosticText(message, 300),
        detail: sanitizeDetail(detail),
        status: response.status,
        requestId: responseRequestId,
        url,
      },
    }
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    const message = timeout
      ? `Request timed out after ${timeoutMs}ms`
      : aborted
      ? 'Request was aborted'
      : error instanceof Error
      ? error.message
      : String(error)
    return {
      ok: false,
      status: 0,
      requestId,
      error: {
        code: timeout ? 'timeout' : aborted ? 'aborted' : 'network_error',
        message: redactDiagnosticText(message, 300),
        detail: sanitizeDetail(error instanceof Error ? error.stack || error.message : error),
        status: 0,
        requestId,
        url,
      },
    }
  } finally {
    dispose()
  }
}

export function apiErrorMessage(error: ApiErrorEnvelope): string {
  return error.detail ? `${error.message}: ${error.detail}` : error.message
}

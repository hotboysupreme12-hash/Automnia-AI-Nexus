export type BoundedHttpRequestInit = {
  method?: string
  headers?: Record<string, string> | Array<[string, string]>
  body?: string | Uint8Array
  signal?: AbortSignal
}

export type BoundedHttpResponse = {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  text: () => Promise<string>
}

export type BoundedHttpFetch = (
  url: string,
  init?: BoundedHttpRequestInit,
) => Promise<BoundedHttpResponse>

export type BoundedHttpRequestOptions = {
  timeoutMs: number
  maxResponseBytes: number
  fetch?: BoundedHttpFetch
  signal?: AbortSignal
}

export type BoundedHttpRequestFailure = 'timeout' | 'aborted' | 'response_too_large'

export class BoundedHttpRequestError extends Error {
  readonly code: BoundedHttpRequestFailure

  constructor(code: BoundedHttpRequestFailure) {
    super(code === 'timeout'
      ? 'HTTP request timed out.'
      : code === 'aborted'
        ? 'HTTP request was cancelled.'
        : 'HTTP response exceeded its size limit.')
    this.name = 'BoundedHttpRequestError'
    this.code = code
  }
}

const MAX_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

function boundedPositiveInteger(value: number, fallback: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value))) : fallback
}

async function readResponseText(response: BoundedHttpResponse, maxResponseBytes: number) {
  const contentLength = response.headers?.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new BoundedHttpRequestError('response_too_large')
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
      throw new BoundedHttpRequestError('response_too_large')
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw new BoundedHttpRequestError('response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function boundedHttpRequest(
  url: string,
  init: BoundedHttpRequestInit,
  options: BoundedHttpRequestOptions,
): Promise<{ response: BoundedHttpResponse; text: string }> {
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, 10_000, MAX_TIMEOUT_MS)
  const maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes, 256 * 1024, MAX_RESPONSE_BYTES)
  const fetchImpl = options.fetch || globalThis.fetch as unknown as BoundedHttpFetch
  const externalSignal = options.signal || init.signal
  if (externalSignal?.aborted) throw new BoundedHttpRequestError('aborted')

  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let onExternalAbort: (() => void) | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new BoundedHttpRequestError('timeout'))
    }, timeoutMs)
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!externalSignal) return
    onExternalAbort = () => {
      controller.abort()
      reject(new BoundedHttpRequestError('aborted'))
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  })
  const request = (async () => {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    const text = await readResponseText(response, maxResponseBytes)
    return { response, text }
  })()

  try {
    return await Promise.race([request, timeout, cancelled])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

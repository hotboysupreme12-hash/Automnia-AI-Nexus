type PendingCompression = {
  file: File
  resolve: (file: File) => void
  signal?: AbortSignal
  onAbort?: () => void
  timer: number
  settled: boolean
}

type CompressionWorkerResponse = { id: number; blob: Blob | null }

const pending = new Map<number, PendingCompression>()
let nextRequestId = 0
let compressionWorker: Worker | null = null

function settle(requestId: number, file: File) {
  const request = pending.get(requestId)
  if (!request || request.settled) return
  request.settled = true
  pending.delete(requestId)
  window.clearTimeout(request.timer)
  if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
  request.resolve(file)
}

function stopWorkerAndUseOriginalFiles() {
  const failedWorker = compressionWorker
  compressionWorker = null
  failedWorker?.terminate()
  for (const [requestId, request] of pending) settle(requestId, request.file)
}

function getCompressionWorker(): Worker | null {
  if (compressionWorker) return compressionWorker
  if (typeof Worker === 'undefined') return null
  try {
    const worker = new Worker(new URL('../workers/imageCompression.worker.ts', import.meta.url), {
      type: 'module',
      name: 'automnia-image-compression',
    })
    worker.addEventListener('message', (event: MessageEvent<CompressionWorkerResponse>) => {
      const { id, blob } = event.data || {}
      const request = pending.get(id)
      if (!request) return
      const compressed = blob && blob.size < request.file.size
        ? new File([blob], request.file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: request.file.lastModified })
        : request.file
      settle(id, compressed)
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault()
      stopWorkerAndUseOriginalFiles()
    })
    worker.addEventListener('messageerror', stopWorkerAndUseOriginalFiles)
    compressionWorker = worker
    return worker
  } catch {
    // Environments with a restrictive worker policy still upload the original file.
    return null
  }
}

export async function compressImageForUpload(file: File, signal?: AbortSignal): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_200_000) return file
  if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError')
  const worker = getCompressionWorker()
  if (!worker) return file

  const requestId = ++nextRequestId
  return new Promise<File>((resolve) => {
    const request: PendingCompression = {
      file,
      resolve,
      signal,
      timer: window.setTimeout(() => {
        // Terminating the worker also stops a slow decoder from consuming CPU
        // after the original file has been selected as the safe fallback.
        stopWorkerAndUseOriginalFiles()
      }, 20_000),
      settled: false,
    }
    request.onAbort = () => stopWorkerAndUseOriginalFiles()
    pending.set(requestId, request)
    signal?.addEventListener('abort', request.onAbort, { once: true })
    try {
      worker.postMessage({ id: requestId, file, maxSide: 1600, quality: 0.86 })
    } catch {
      settle(requestId, file)
    }
  })
}

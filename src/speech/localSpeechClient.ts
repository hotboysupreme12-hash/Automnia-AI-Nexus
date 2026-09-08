export type LocalSpeechProgress = {
  phase: 'loading' | 'ready' | 'processing' | 'transcribing'
  progress?: number
  backend?: 'webgpu' | 'wasm'
}

type WorkerRequest =
  | { type: 'prepare'; requestId: string }
  | { type: 'transcribe'; requestId: string; audio: ArrayBuffer }

type WorkerResponse =
  | ({ type: 'progress'; requestId: string } & LocalSpeechProgress)
  | { type: 'prepared'; requestId: string; backend: 'webgpu' | 'wasm' }
  | { type: 'result'; requestId: string; text: string; backend: 'webgpu' | 'wasm' }
  | { type: 'error'; requestId: string; message: string }

type PendingRequest = {
  resolve: (value: { text: string; backend: 'webgpu' | 'wasm' }) => void
  reject: (error: Error) => void
  onProgress?: (progress: LocalSpeechProgress) => void
  cleanup: () => void
}

export type LocalSpeechRequestOptions = { signal?: AbortSignal; timeoutMs?: number }

let worker: Worker | null = null
let requestSequence = 0
const pendingRequests = new Map<string, PendingRequest>()
let idleTimer: ReturnType<typeof setTimeout> | undefined

function scheduleIdleRelease() {
  clearTimeout(idleTimer)
  if (pendingRequests.size || !worker) return
  idleTimer = setTimeout(() => {
    if (pendingRequests.size) return
    worker?.terminate()
    worker = null
  }, 120_000)
}

function nextRequestId(): string {
  requestSequence += 1
  return `local-speech-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function rejectAllPending(message: string) {
  for (const pending of pendingRequests.values()) {
    pending.cleanup()
    pending.reject(new Error(message))
  }
  pendingRequests.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./localSpeech.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const pending = pendingRequests.get(message.requestId)
    if (!pending) return
    if (message.type === 'progress') {
      pending.onProgress?.(message)
      return
    }
    pendingRequests.delete(message.requestId)
    pending.cleanup()
    scheduleIdleRelease()
    if (message.type === 'error') {
      pending.reject(new Error(message.message))
      return
    }
    if (message.type === 'prepared') {
      pending.resolve({ text: '', backend: message.backend })
      return
    }
    pending.resolve({ text: message.text, backend: message.backend })
  })
  worker.addEventListener('error', () => {
    rejectAllPending('The on-device speech engine stopped unexpectedly. Try the microphone again.')
    worker?.terminate()
    worker = null
  })
  return worker
}

function runWorkerRequest(
  request: WorkerRequest,
  onProgress?: (progress: LocalSpeechProgress) => void,
  options: LocalSpeechRequestOptions = {},
): Promise<{ text: string; backend: 'webgpu' | 'wasm' }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason || new DOMException('Speech canceled', 'AbortError')); return }
    clearTimeout(idleTimer)
    const cancel = (error: Error) => {
      if (!pendingRequests.delete(request.requestId)) return
      cleanup()
      reject(error)
      if (!pendingRequests.size) { worker?.terminate(); worker = null }
      scheduleIdleRelease()
    }
    const onAbort = () => cancel(new DOMException('Speech processing canceled.', 'AbortError'))
    const timer = setTimeout(() => cancel(new DOMException('Local speech took too long. Retry the recording.', 'TimeoutError')), options.timeoutMs ?? 180_000)
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    pendingRequests.set(request.requestId, { resolve, reject, onProgress, cleanup })
    try {
      const target = getWorker()
      if (request.type === 'transcribe') target.postMessage(request, [request.audio])
      else target.postMessage(request)
    } catch (error) { cancel(error instanceof Error ? error : new Error(String(error))) }
  })
}

export function prepareLocalSpeechModel(onProgress?: (progress: LocalSpeechProgress) => void, options?: LocalSpeechRequestOptions) {
  return runWorkerRequest({ type: 'prepare', requestId: nextRequestId() }, onProgress, options)
}

export function transcribeAudioLocally(
  audio: Float32Array,
  onProgress?: (progress: LocalSpeechProgress) => void,
  options?: LocalSpeechRequestOptions,
) {
  const canTransferDirectly = audio.buffer instanceof ArrayBuffer
    && audio.byteOffset === 0
    && audio.byteLength === audio.buffer.byteLength
  const transferableAudio = canTransferDirectly
    ? audio.buffer as ArrayBuffer
    : new Float32Array(audio).buffer
  return runWorkerRequest({ type: 'transcribe', requestId: nextRequestId(), audio: transferableAudio }, onProgress, options)
}

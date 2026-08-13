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
}

let worker: Worker | null = null
let requestSequence = 0
const pendingRequests = new Map<string, PendingRequest>()

function nextRequestId(): string {
  requestSequence += 1
  return `local-speech-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function rejectAllPending(message: string) {
  for (const pending of pendingRequests.values()) pending.reject(new Error(message))
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
): Promise<{ text: string; backend: 'webgpu' | 'wasm' }> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(request.requestId, { resolve, reject, onProgress })
    const target = getWorker()
    if (request.type === 'transcribe') target.postMessage(request, [request.audio])
    else target.postMessage(request)
  })
}

export function prepareLocalSpeechModel(onProgress?: (progress: LocalSpeechProgress) => void) {
  return runWorkerRequest({ type: 'prepare', requestId: nextRequestId() }, onProgress)
}

export function transcribeAudioLocally(
  audio: Float32Array,
  onProgress?: (progress: LocalSpeechProgress) => void,
) {
  const canTransferDirectly = audio.buffer instanceof ArrayBuffer
    && audio.byteOffset === 0
    && audio.byteLength === audio.buffer.byteLength
  const transferableAudio = canTransferDirectly
    ? audio.buffer as ArrayBuffer
    : new Float32Array(audio).buffer
  return runWorkerRequest({ type: 'transcribe', requestId: nextRequestId(), audio: transferableAudio }, onProgress)
}

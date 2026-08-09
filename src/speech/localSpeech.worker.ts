/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/whisper-tiny.en'

type SpeechBackend = 'webgpu' | 'wasm'
type ProgressInfo = { status: string; progress?: number }
type SpeechPipeline = (
  audio: Float32Array,
  options: { chunk_length_s?: number; stride_length_s?: number; max_new_tokens?: number },
) => Promise<{ text: string } | Array<{ text: string }>>
type WorkerRequest =
  | { type: 'prepare'; requestId: string }
  | { type: 'transcribe'; requestId: string; audio: ArrayBuffer }

const workerScope = self as DedicatedWorkerGlobalScope
let backend: SpeechBackend = 'wasm'
let transcriberPromise: Promise<SpeechPipeline> | null = null

function post(requestId: string, message: Record<string, unknown>) {
  workerScope.postMessage({ requestId, ...message })
}

function supportsWebGpu() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

function totalProgress(info: ProgressInfo): number | undefined {
  if (info.status !== 'progress' && info.status !== 'progress_total') return undefined
  return typeof info.progress === 'number' && Number.isFinite(info.progress)
    ? Math.max(0, Math.min(100, info.progress))
    : undefined
}

async function createTranscriber(requestId: string, preferredBackend: SpeechBackend): Promise<SpeechPipeline> {
  const progress_callback = (info: ProgressInfo) => {
    const progress = totalProgress(info)
    post(requestId, {
      type: 'progress',
      phase: 'loading',
      ...(progress === undefined ? {} : { progress }),
      backend: preferredBackend,
    })
  }

  if (preferredBackend === 'webgpu') {
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'webgpu',
      dtype: {
        encoder_model: 'fp16',
        decoder_model_merged: 'q4',
      },
      progress_callback,
    }) as SpeechPipeline
    post(requestId, { type: 'progress', phase: 'loading', progress: 100, backend: preferredBackend })
    await transcriber(new Float32Array(16_000), { max_new_tokens: 1 })
    post(requestId, { type: 'progress', phase: 'ready', backend: preferredBackend })
    return transcriber
  }

  const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback,
  }) as SpeechPipeline
  post(requestId, { type: 'progress', phase: 'loading', progress: 100, backend: preferredBackend })
  await transcriber(new Float32Array(16_000), { max_new_tokens: 1 })
  post(requestId, { type: 'progress', phase: 'ready', backend: preferredBackend })
  return transcriber
}

function loadTranscriber(requestId: string) {
  if (transcriberPromise) return transcriberPromise
  const preferredBackend: SpeechBackend = supportsWebGpu() ? 'webgpu' : 'wasm'
  backend = preferredBackend
  transcriberPromise = createTranscriber(requestId, preferredBackend).catch(async (error) => {
    if (preferredBackend !== 'webgpu') throw error
    backend = 'wasm'
    post(requestId, { type: 'progress', phase: 'loading', backend, progress: 0 })
    return createTranscriber(requestId, 'wasm')
  }).catch((error) => {
    transcriberPromise = null
    throw error
  })
  return transcriberPromise
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void (async () => {
    try {
      const transcriber = await loadTranscriber(request.requestId)
      if (request.type === 'prepare') {
        post(request.requestId, { type: 'prepared', backend })
        return
      }

      post(request.requestId, { type: 'progress', phase: 'transcribing', backend })
      const audio = new Float32Array(request.audio)
      const output = await transcriber(audio, {
        chunk_length_s: 15,
        stride_length_s: 3,
        max_new_tokens: 96,
      })
      const text = Array.isArray(output) ? output.map((entry) => entry.text).join(' ') : output.text
      post(request.requestId, { type: 'result', text: text.trim(), backend })
    } catch (error) {
      post(request.requestId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Local transcription failed.',
      })
    }
  })()
})

/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers'
import { prepareAudioForSpeechRecognition } from './audioProcessing'

const MODEL_ID = 'onnx-community/whisper-base'

type SpeechBackend = 'webgpu' | 'wasm'
type ProgressInfo = { status: string; progress?: number }
type SpeechPipeline = ((
  audio: Float32Array,
  options: { chunk_length_s?: number; stride_length_s?: number; max_new_tokens?: number; language?: string; task?: string },
) => Promise<{ text: string } | Array<{ text: string }>>) & { dispose?: () => Promise<unknown> }
type WorkerRequest =
  | { type: 'prepare'; requestId: string }
  | { type: 'transcribe'; requestId: string; audio: ArrayBuffer; language?: string }

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
        encoder_model: 'fp32',
        decoder_model_merged: 'q8',
      },
      progress_callback,
    }) as SpeechPipeline
    post(requestId, { type: 'progress', phase: 'loading', progress: 100, backend: preferredBackend })
    await transcriber(new Float32Array(16_000), { max_new_tokens: 1, language: 'en', task: 'transcribe' })
    post(requestId, { type: 'progress', phase: 'ready', backend: preferredBackend })
    return transcriber
  }

  const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    // ORT 1.27's extended QDQ optimizer rejects Whisper's merged embeddings.
    // Keep quantized weights, but avoid that incompatible graph rewrite.
    session_options: { graphOptimizationLevel: 'basic' },
    progress_callback,
  }) as SpeechPipeline
  post(requestId, { type: 'progress', phase: 'loading', progress: 100, backend: preferredBackend })
  await transcriber(new Float32Array(16_000), { max_new_tokens: 1, language: 'en', task: 'transcribe' })
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

// ONNX sessions share decoder state; never run two recordings concurrently.
let requestQueue = Promise.resolve()
workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  requestQueue = requestQueue.then(async () => {
    try {
      if (request.type === 'prepare') {
        await loadTranscriber(request.requestId)
        post(request.requestId, { type: 'prepared', backend })
        return
      }

      post(request.requestId, { type: 'progress', phase: 'processing', backend })
      const preparedAudio = prepareAudioForSpeechRecognition(new Float32Array(request.audio)).audio
      const transcriber = await loadTranscriber(request.requestId)
      post(request.requestId, { type: 'progress', phase: 'transcribing', backend })
      const generationOptions = {
        chunk_length_s: 30,
        stride_length_s: 5,
        max_new_tokens: 440,
        task: 'transcribe',
        // Transformers.js currently defaults to English; detection is not implemented.
        language: request.language || 'en',
      }
      let output
      try {
        output = await transcriber(preparedAudio, generationOptions)
      } catch (error) {
        if (backend !== 'webgpu') throw error
        // Device loss and unsupported GPU kernels can happen after warmup.
        await transcriber.dispose?.().catch(() => undefined)
        backend = 'wasm'
        transcriberPromise = null
        transcriberPromise = createTranscriber(request.requestId, 'wasm').catch((loadError) => {
          transcriberPromise = null
          throw loadError
        })
        const fallback = await transcriberPromise
        post(request.requestId, { type: 'progress', phase: 'transcribing', backend })
        output = await fallback(preparedAudio, generationOptions)
      }
      const text = Array.isArray(output) ? output.map((entry) => entry.text).join(' ') : output.text
      post(request.requestId, { type: 'result', text: text.trim(), backend })
    } catch (error) {
      post(request.requestId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Local transcription failed.',
      })
    }
  })
})

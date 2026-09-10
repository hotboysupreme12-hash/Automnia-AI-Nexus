import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { prepareAudioForSpeechRecognition } from '../src/speech/audioProcessing'

type Request = { type: string; requestId: string; audio?: ArrayBuffer; language?: string }
type Message = { type: string; requestId: string; text?: string; backend?: string; message?: string }
type Transcriber = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string }>) & { dispose?: () => Promise<void> }
function workerHarness(pipeline: (_task: string, _model: string, options: { device: string; session_options?: { graphOptimizationLevel: string } }) => Promise<Transcriber>) {
  let listener: (event: { data: Request }) => void
  const responses = new Map<string, (message: Message) => void>()
  const source = transformSync(readFileSync(new URL('../src/speech/localSpeech.worker.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  runInNewContext(source, {
    require: (name: string) => name === '@huggingface/transformers' ? { pipeline } : { prepareAudioForSpeechRecognition },
    navigator: { gpu: {} },
    Float32Array,
    Error,
    self: {
      addEventListener: (_name: string, callback: typeof listener) => { listener = callback },
      postMessage: (message: Message) => { if (['result', 'prepared', 'error'].includes(message.type)) responses.get(message.requestId)?.(message) },
    },
  })
  return (request: Request) => new Promise<Message>((resolve) => { responses.set(request.requestId, resolve); listener({ data: request }) })
}
function speech() {
  return Float32Array.from({ length: 16000 }, (_, index) => Math.sin(index * 0.1) * 0.04).buffer
}

test('worker retries inference on the new CPU pipeline after GPU device loss', async () => {
  const devices: string[] = []
  let disposed = false
  const send = workerHarness(async (_task, _model, options) => {
    devices.push(options.device)
    if (options.device === 'wasm') assert.equal(options.session_options?.graphOptimizationLevel, 'basic')
    const transcriber: Transcriber = async (_audio, generation) => {
      if (generation.max_new_tokens === 1) return { text: '' }
      if (options.device === 'webgpu') throw new Error('GPU device lost')
      assert.equal(generation.language, 'fr')
      assert.equal(generation.task, 'transcribe')
      assert.equal(generation.max_new_tokens, 440)
      return { text: 'Bonjour Jean.' }
    }
    transcriber.dispose = async () => { disposed = true }
    return transcriber
  })
  const result = await send({ type: 'transcribe', requestId: 'first', audio: speech(), language: 'fr' })
  assert.equal(result.type, 'result')
  assert.equal(result.text, 'Bonjour Jean.')
  assert.equal(result.backend, 'wasm')
  assert.deepEqual(devices, ['webgpu', 'wasm'])
  assert.equal(disposed, true)
})

test('worker serializes overlapping recordings and reuses its loaded model', async () => {
  let active = 0
  let loads = 0
  const send = workerHarness(async () => {
    loads++
    return async () => {
      active++
      assert.equal(active, 1)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return { text: 'Full recording.' }
    }
  })
  const results = await Promise.all(['first', 'second'].map((requestId) => send({ type: 'transcribe', requestId, audio: speech() })))
  assert.ok(results.every((result) => result.text === 'Full recording.'))
  assert.equal(loads, 1)
})

test('silent recordings fail without downloading a model', async () => {
  const send = workerHarness(async () => { throw new Error('must not load for silence') })
  const result = await send({ type: 'transcribe', requestId: 'silent', audio: new Float32Array(16000).buffer })
  assert.equal(result.type, 'error')
  assert.match(result.message || '', /did not capture clear speech/)
})

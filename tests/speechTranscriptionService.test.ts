import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ONLINE_SPEECH_MODEL,
  SpeechTranscriptionError,
  createSpeechTranscriptionService,
} from '../server/services/speech/speechTranscriptionService'

test('online speech transcription keeps credentials server-side and sends audio multipart data', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const service = createSpeechTranscriptionService({
    resolveOpenAiApiKey: async () => 'test-secret-key',
    fetch: async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({ text: 'Tell the agents to ship it.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const result = await service.transcribeOnline({
    bytes: Buffer.from('recorded-audio'),
    mimeType: 'audio/webm;codecs=opus',
    fileName: 'dictation.webm',
  })

  assert.equal(capturedUrl, 'https://api.openai.com/v1/audio/transcriptions')
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer test-secret-key')
  assert.ok(capturedInit?.body instanceof FormData)
  const form = capturedInit.body as FormData
  assert.equal(form.get('model'), ONLINE_SPEECH_MODEL)
  const file = form.get('file')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'dictation.webm')
  assert.equal(file.type, 'audio/webm')
  assert.deepEqual(result, {
    text: 'Tell the agents to ship it.',
    model: ONLINE_SPEECH_MODEL,
    provider: 'openai',
  })
})

test('online speech transcription fails closed when no API key is configured', async () => {
  const service = createSpeechTranscriptionService({
    resolveOpenAiApiKey: async () => '',
    fetch: async () => {
      throw new Error('fetch should not be called')
    },
  })

  await assert.rejects(
    () => service.transcribeOnline({ bytes: Buffer.from('audio'), mimeType: 'audio/webm' }),
    (error: unknown) => error instanceof SpeechTranscriptionError && error.statusCode === 409,
  )
})

test('online speech transcription does not leak upstream response bodies for non-JSON failures', async () => {
  const service = createSpeechTranscriptionService({
    resolveOpenAiApiKey: async () => 'test-secret-key',
    fetch: async () => new Response('upstream internal body', { status: 503 }),
  })

  await assert.rejects(
    () => service.transcribeOnline({ bytes: Buffer.from('audio'), mimeType: 'audio/webm' }),
    (error: unknown) => error instanceof SpeechTranscriptionError && error.statusCode === 502 && !error.message.includes('internal body'),
  )
})

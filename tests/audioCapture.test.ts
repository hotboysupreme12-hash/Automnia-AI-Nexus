import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareAudioForSpeechRecognition } from '../src/speech/audioCapture'

const SAMPLE_RATE = 16_000

test('speech audio preparation trims silence and normalizes a quiet voice signal', () => {
  const input = new Float32Array(SAMPLE_RATE * 2)
  const speechStart = Math.floor(SAMPLE_RATE * 0.65)
  const speechEnd = Math.floor(SAMPLE_RATE * 1.05)
  for (let index = speechStart; index < speechEnd; index += 1) {
    input[index] = Math.sin(2 * Math.PI * 180 * index / SAMPLE_RATE) * 0.045
  }

  const prepared = prepareAudioForSpeechRecognition(input, SAMPLE_RATE)

  assert.ok(prepared.audio.length < input.length)
  assert.ok(prepared.audio.length >= SAMPLE_RATE * 0.7)
  assert.ok(prepared.gain > 1)
  assert.ok(prepared.voicedMs >= 300)
  assert.ok(Math.max(...prepared.audio) > 0.3)
})

test('speech audio preparation rejects silent microphone captures', () => {
  assert.throws(
    () => prepareAudioForSpeechRecognition(new Float32Array(SAMPLE_RATE), SAMPLE_RATE),
    /did not capture clear speech/i,
  )
})

test('quiet continuous speech without leading silence is retained', () => {
  const input = Float32Array.from({ length: SAMPLE_RATE }, (_, index) => Math.sin(2 * Math.PI * 180 * index / SAMPLE_RATE) * 0.006)
  const prepared = prepareAudioForSpeechRecognition(input)
  assert.equal(prepared.audio.length, input.length)
  assert.ok(prepared.voicedMs >= 900)
  assert.ok(prepared.gain > 1)
})

test('audio preparation preserves quiet word endings and sanitizes invalid samples', () => {
  const input = new Float32Array(SAMPLE_RATE * 2)
  for (let i = SAMPLE_RATE / 2; i < SAMPLE_RATE; i++) input[i] = Math.sin(i * 0.1) * 0.1
  for (let i = SAMPLE_RATE; i < SAMPLE_RATE * 1.3; i++) input[i] = Math.sin(i * 0.1) * 0.002
  input[500] = NaN
  const prepared = prepareAudioForSpeechRecognition(input)
  assert.ok(prepared.audio.length >= SAMPLE_RATE * 1.25)
  assert.ok(prepared.audio.every(Number.isFinite))
})

test('portable PCM upload has valid WAV headers and bounded samples', async () => {
  const { encodeSpeechWav } = await import('../src/speech/audioProcessing')
  const blob = encodeSpeechWav(new Float32Array([-2, 0, 2, NaN]))
  const buffer = Buffer.from(await blob.arrayBuffer())
  assert.equal(blob.type, 'audio/wav')
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.readUInt32LE(4), buffer.length - 8)
  assert.equal(buffer.readUInt32LE(24), 16000)
  assert.equal(buffer.readUInt16LE(22), 1)
  assert.equal(buffer.readUInt32LE(40), 8)
  assert.deepEqual([0, 1, 2, 3].map((i) => buffer.readInt16LE(44 + i * 2)), [-32768, 0, 32767, 0])
})

test('native denial prevents capture and unavailable saved microphones fall back once', async (context) => {
  const { requestSpeechMicrophone } = await import('../src/speech/audioCapture')
  const { DEFAULT_SPEECH_SETTINGS } = await import('../src/speech/speechSettings')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  context.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window') })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { automniaDesktop: { requestMicrophoneAccess: async () => ({ status: 'denied', platform: 'darwin' }) } } })
  let attempts = 0
  const mediaDevices = { getUserMedia: async () => { attempts++; throw new Error('must not capture') } } as unknown as MediaDevices
  await assert.rejects(requestSpeechMicrophone(DEFAULT_SPEECH_SETTINGS, mediaDevices), { name: 'NotAllowedError' })
  assert.equal(attempts, 0)

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  const stream = {} as MediaStream
  const settings = { ...DEFAULT_SPEECH_SETTINGS, microphoneDeviceId: 'disconnected' }
  const fallback = await requestSpeechMicrophone(settings, { getUserMedia: async (constraints: MediaStreamConstraints) => {
    attempts++
    if (attempts === 1) throw new DOMException('Device disappeared', 'NotFoundError')
    assert.equal((constraints.audio as MediaTrackConstraints).deviceId, undefined)
    assert.deepEqual((constraints.audio as MediaTrackConstraints).channelCount, { ideal: 1 })
    return stream
  } } as MediaDevices)
  assert.equal(attempts, 2)
  assert.equal(fallback.stream, stream)
  assert.equal(fallback.usedFallback, true)
  assert.equal(settings.microphoneDeviceId, 'disconnected')
})

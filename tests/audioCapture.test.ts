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

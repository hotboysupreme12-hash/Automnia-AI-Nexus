import assert from 'node:assert/strict'
import test from 'node:test'
import { requestSpeechMicrophone } from '../src/speech/audioCapture'
import { DEFAULT_SPEECH_SETTINGS } from '../src/speech/speechSettings'

test('voice uses the selected microphone and explains fallback only when it is missing', async () => {
  const calls: MediaStreamConstraints[] = []
  const stream = {} as MediaStream
  const devices = { getUserMedia: async (constraints: MediaStreamConstraints) => { calls.push(structuredClone(constraints)); if (calls.length === 1) throw new DOMException('Missing device', 'OverconstrainedError'); return stream } } as MediaDevices
  const settings = { ...DEFAULT_SPEECH_SETTINGS, microphoneDeviceId: 'preferred' }
  const result = await requestSpeechMicrophone(settings, devices)
  assert.equal(result.usedFallback, true)
  assert.deepEqual((calls[0].audio as MediaTrackConstraints).deviceId, { exact: 'preferred' })
  assert.equal((calls[1].audio as MediaTrackConstraints).deviceId, undefined)
  assert.equal(settings.microphoneDeviceId, 'preferred')
})

test('denied microphone permission does not retry against another input', async () => {
  let calls = 0
  const devices = { getUserMedia: async () => { calls += 1; throw new DOMException('Denied', 'NotAllowedError') } } as unknown as MediaDevices
  await assert.rejects(requestSpeechMicrophone({ ...DEFAULT_SPEECH_SETTINGS, microphoneDeviceId: 'preferred' }, devices), /Denied/)
  assert.equal(calls, 1)
})

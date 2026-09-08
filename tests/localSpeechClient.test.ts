import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareLocalSpeechModel, transcribeAudioLocally } from '../src/speech/localSpeechClient'

class FakeSpeechWorker extends EventTarget {
  static instances: FakeSpeechWorker[] = []
  messages: Array<{ requestId: string }> = []
  terminated = false
  constructor() { super(); FakeSpeechWorker.instances.push(this) }
  postMessage(message: { requestId: string }) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply(data: Record<string, unknown>) { this.dispatchEvent(new MessageEvent('message', { data })) }
}

test('speech requests have a deadline, cancel promptly, and can restart after failure', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeSpeechWorker })
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous)
    else Reflect.deleteProperty(globalThis, 'Worker')
  })
  const timed = prepareLocalSpeechModel(undefined, { timeoutMs: 100 })
  const timeoutAssertion = assert.rejects(timed, { name: 'TimeoutError' })
  const first = FakeSpeechWorker.instances.at(-1)!
  context.mock.timers.tick(100)
  await timeoutAssertion
  assert.equal(first.terminated, true)

  const controller = new AbortController()
  const canceled = transcribeAudioLocally(new Float32Array(100), undefined, { signal: controller.signal })
  const cancellationAssertion = assert.rejects(canceled, { name: 'AbortError' })
  controller.abort()
  await cancellationAssertion
  assert.equal(FakeSpeechWorker.instances.at(-1)!.terminated, true)

  const success = prepareLocalSpeechModel()
  const active = FakeSpeechWorker.instances.at(-1)!
  active.reply({ type: 'prepared', requestId: active.messages[0].requestId, backend: 'wasm' })
  assert.deepEqual(await success, { text: '', backend: 'wasm' })
  context.mock.timers.tick(119_999)
  assert.equal(active.terminated, false)
  context.mock.timers.tick(1)
  assert.equal(active.terminated, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { compressAttachmentImage } from '../src/components/monitor/attachmentImage'

class FakeWorker {
  static latest: FakeWorker
  onmessage: ((event: MessageEvent<Blob | null>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminated = false
  constructor() { FakeWorker.latest = this }
  postMessage() {}
  terminate() { this.terminated = true }
}

test('image processing stays cancelable and cleans up its worker', async () => {
  const originalWorker = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const file = new File([new Uint8Array(1_200_001)], 'photo.png', { type: 'image/png' })
    const controller = new AbortController()
    const pending = compressAttachmentImage(file, controller.signal)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(FakeWorker.latest.terminated, true)
  } finally { globalThis.Worker = originalWorker }
})

test('image processing uses a smaller result and falls back to the original on failure', async () => {
  const originalWorker = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const file = new File([new Uint8Array(1_200_001)], 'photo.png', { type: 'image/png' })
    const processed = compressAttachmentImage(file, new AbortController().signal)
    FakeWorker.latest.onmessage?.({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) } as MessageEvent<Blob>)
    const result = await processed
    assert.equal(result.name, 'photo.jpg')
    assert.equal(result.type, 'image/jpeg')
    assert.equal(FakeWorker.latest.terminated, true)

    const failed = compressAttachmentImage(file, new AbortController().signal)
    FakeWorker.latest.onerror?.()
    assert.equal(await failed, file)
    assert.equal(FakeWorker.latest.terminated, true)
    const gif = new File([new Uint8Array(1_200_001)], 'animated.gif', { type: 'image/gif' })
    assert.equal(await compressAttachmentImage(gif, new AbortController().signal), gif)
  } finally { globalThis.Worker = originalWorker }
})

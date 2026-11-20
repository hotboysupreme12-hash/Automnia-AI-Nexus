import test from 'node:test'
import assert from 'node:assert/strict'
import { compressImageForUpload } from '../src/utils/imageCompression'

type WorkerMessage = { data: { id: number; file: File } }
type WorkerMessageListener = (event: MessageEvent<{ id: number; blob: Blob | null }>) => void

class ImageCompressionWorkerMock {
  static nextBlob: Blob | null = new Blob(['small image'])
  static instances = 0
  private messageListener?: WorkerMessageListener

  constructor(url: URL, options?: WorkerOptions) {
    void url
    void options
    ImageCompressionWorkerMock.instances += 1
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'message') this.messageListener = listener as WorkerMessageListener
  }

  postMessage(message: WorkerMessage['data']) {
    queueMicrotask(() => this.messageListener?.({ data: { id: message.id, blob: ImageCompressionWorkerMock.nextBlob } } as MessageEvent<{ id: number; blob: Blob | null }>))
  }

  terminate() {}
}

test('image compression runs through a worker and falls back to the original when it cannot reduce size', async () => {
  const originalWorker = globalThis.Worker
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ImageCompressionWorkerMock })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout, clearTimeout },
  })
  ImageCompressionWorkerMock.instances = 0

  try {
    const audio = new File(['audio'], 'voice.mp3', { type: 'audio/mpeg' })
    assert.equal(await compressImageForUpload(audio), audio)
    assert.equal(ImageCompressionWorkerMock.instances, 0)

    const image = new File([new Uint8Array(1_300_000)], 'long-photo.png', { type: 'image/png', lastModified: 123 })
    const compressed = await compressImageForUpload(image)
    assert.equal(compressed.name, 'long-photo.jpg')
    assert.equal(compressed.type, 'image/jpeg')
    assert.equal(compressed.size, ImageCompressionWorkerMock.nextBlob?.size)
    assert.equal(ImageCompressionWorkerMock.instances, 1)

    ImageCompressionWorkerMock.nextBlob = new Blob([new Uint8Array(1_300_001)])
    assert.equal(await compressImageForUpload(image), image)
  } finally {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})

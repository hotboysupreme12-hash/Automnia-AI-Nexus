type CompressionRequest = {
  id: number
  file: File
  maxSide: number
  quality: number
}

type CompressionResponse = {
  id: number
  blob: Blob | null
}

const workerScope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<CompressionRequest>) => void) => void
  postMessage: (message: CompressionResponse) => void
}

workerScope.addEventListener('message', (event) => {
  const { id, file, maxSide, quality } = event.data
  void (async () => {
    let bitmap: ImageBitmap | null = null
    try {
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
        workerScope.postMessage({ id, blob: null })
        return
      }

      bitmap = await createImageBitmap(file)
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
      )
      const context = canvas.getContext('2d')
      if (!context) {
        workerScope.postMessage({ id, blob: null })
        return
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      workerScope.postMessage({ id, blob: blob.size < file.size ? blob : null })
    } catch {
      // Keep the original file uploadable when a codec or image format is unsupported.
      workerScope.postMessage({ id, blob: null })
    } finally {
      bitmap?.close()
    }
  })()
})

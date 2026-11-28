self.onmessage = async ({ data: file }) => {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // PNG/WebP may contain transparency; keep an alpha-capable format.
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await canvas.convertToBlob({ type, quality: 0.86 })
    self.postMessage(blob)
  } catch {
    self.postMessage(null)
  } finally {
    bitmap?.close()
  }
}

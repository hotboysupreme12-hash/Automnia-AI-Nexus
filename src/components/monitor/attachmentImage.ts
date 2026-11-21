// Image decoding and resizing can be expensive even for small compressed files.
// Keep it off the renderer thread and fall back to the original on failure.
export async function compressAttachmentImage(file: File, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted()
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_200_000 || typeof Worker === 'undefined') return file
  let worker: Worker
  try {
    worker = new Worker(new URL('./attachmentImage.worker.js', import.meta.url), { type: 'module' })
  } catch {
    return file
  }
  return new Promise<File>((resolve, reject) => {
    let settled = false
    const finish = (blob?: Blob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      if (signal.aborted) return reject(signal.reason)
      resolve(blob && blob.size < file.size
        ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
        : file)
    }
    const abort = () => finish()
    const timer = setTimeout(() => finish(), 15_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<Blob | null>) => finish(event.data)
    worker.onerror = () => finish()
    worker.onmessageerror = () => finish()
    try { worker.postMessage(file) } catch { finish() }
    if (signal.aborted) abort()
  })
}

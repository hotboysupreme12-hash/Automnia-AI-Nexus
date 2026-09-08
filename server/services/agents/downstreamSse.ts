type SseWritable = {
  write: (chunk: string) => unknown
  writableLength?: number
  destroyed?: boolean
  writableEnded?: boolean
  destroy?: (error?: Error) => unknown
  once?: (event: 'drain' | 'close', listener: () => void) => unknown
  removeListener?: (event: 'drain' | 'close', listener: () => void) => unknown
}

const MAX_SSE_BUFFER_BYTES = 1024 * 1024
const MAX_SSE_STALL_MS = 15_000
const stalled = new WeakMap<SseWritable, { timer: NodeJS.Timeout; cancel: () => void }>()

/** Disconnect a stalled consumer before its socket can retain unbounded output. */
export function writeBoundedSseEvent(res: SseWritable, event: string, data: Record<string, unknown>) {
  if (res.destroyed || res.writableEnded) return false
  const id = typeof data.id === 'string' && !/[\r\n\0]/.test(data.id) ? `id: ${data.id}\n` : ''
  const frame = `${id}event: ${event.replace(/[\r\n]/g, '')}\ndata: ${JSON.stringify(data)}\n\n`
  if ((res.writableLength || 0) + Buffer.byteLength(frame) > MAX_SSE_BUFFER_BYTES) {
    stalled.get(res)?.cancel()
    res.destroy?.(new Error('Event stream consumer exceeded the output buffer limit'))
    return false
  }
  const ready = res.write(frame) !== false
  if (!ready && !stalled.has(res)) {
    const cancel = () => {
      const state = stalled.get(res)
      if (state) clearTimeout(state.timer)
      stalled.delete(res)
      res.removeListener?.('drain', cancel)
      res.removeListener?.('close', cancel)
    }
    const timer = setTimeout(() => {
      cancel()
      res.destroy?.(new Error('Event stream consumer stopped draining output'))
    }, MAX_SSE_STALL_MS)
    timer.unref?.()
    stalled.set(res, { timer, cancel })
    res.once?.('drain', cancel)
    res.once?.('close', cancel)
  }
  return ready
}

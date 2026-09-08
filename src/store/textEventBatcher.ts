type TextEvent = { event?: string; text?: string; replace?: boolean }

/** Coalesce only text deltas. Lifecycle events always flush earlier text first. */
export function createTextEventBatcher<T extends TextEvent>(
  publish: (event: T) => void,
  keyFor: (event: T) => string,
  delayMs = 48,
) {
  const pending = new Map<string, T>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const frames = [...pending.values()]
    pending.clear()
    for (const frame of frames) publish(frame)
  }
  return {
    push(frame: T) {
      const key = keyFor(frame)
      if (frame.event !== 'delta' || !key) {
        const previous = pending.get(key)
        if (previous) { pending.delete(key); publish(previous) }
        publish(frame)
        return
      }
      const previous = pending.get(key)
      const text = frame.replace ? frame.text || '' : `${previous?.text || ''}${frame.text || ''}`
      pending.set(key, { ...previous, ...frame, text, replace: Boolean(frame.replace || previous?.replace) })
      if (text.length >= 65_536 || pending.size >= 128) flush()
      else timer ??= setTimeout(flush, delayMs)
    },
    flush,
    clear() { clearTimeout(timer); timer = undefined; pending.clear() },
  }
}

/** Poll only while visible, with at most one request and no idle interval wakeups. */
export function startForegroundPolling(
  poll: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: AbortController | undefined
  const run = async () => {
    if (stopped || visibility.hidden || inFlight) return
    const controller = new AbortController()
    inFlight = controller
    try {
      await poll(controller.signal)
    } catch {
      // A failed poll must not terminate future refreshes. The caller owns its UI error.
    } finally {
      if (inFlight === controller) {
        inFlight = undefined
        if (!stopped && !visibility.hidden && timer === undefined) {
          timer = setTimeout(() => { timer = undefined; void run() }, Math.max(1000, intervalMs))
        }
      }
    }
  }
  const onVisibilityChange = () => {
    clearTimeout(timer)
    timer = undefined
    if (visibility.hidden) {
      inFlight?.abort()
      inFlight = undefined
    } else {
      void run()
    }
  }
  visibility.addEventListener('visibilitychange', onVisibilityChange)
  void run()
  return () => {
    stopped = true
    clearTimeout(timer)
    inFlight?.abort()
    visibility.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

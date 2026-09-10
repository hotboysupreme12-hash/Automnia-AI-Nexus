import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

const positions = new Map<string, Map<string, { top: number; left: number }>>()

/** Restore session scroll after lazy content settles, yielding immediately to user input. */
export function useWorkspaceScroll(workspace: string, rootRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const saved = positions.get(workspace) || new Map<string, { top: number; left: number }>()
    positions.set(workspace, saved)
    const requested = new Map(saved)
    if (!requested.has('window')) requested.set('window', { top: 0, left: 0 })
    let restoring = true
    let leaving = false
    let settleTimer: number | undefined
    const page = document.scrollingElement as HTMLElement || document.documentElement
    const originalAnchor = page.style.overflowAnchor
    page.style.overflowAnchor = 'none'
    const surfaces = () => new Map<string, Element>([
      ['window', page],
      ...Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-scroll]'), (element) => [element.dataset.workspaceScroll!, element] as [string, Element]),
    ])
    const record = () => {
      if (restoring || leaving) return
      for (const [key, element] of surfaces()) saved.set(key, { top: element.scrollTop, left: element.scrollLeft })
    }
    // Scroll events from the console used to scan every workspace surface and
    // read all their offsets. Only the surface that moved needs to be recorded.
    const recordScroll = (event: Event) => {
      if (restoring || leaving) return
      const target = event.target
      if (target === document || target === page || target === window) {
        saved.set('window', { top: page.scrollTop, left: page.scrollLeft })
      } else if (target instanceof HTMLElement && root.contains(target)) {
        const key = target.dataset.workspaceScroll
        if (key) saved.set(key, { top: target.scrollTop, left: target.scrollLeft })
      }
    }
    const takeControl = () => {
      if (!restoring) return
      restoring = false
      window.clearTimeout(settleTimer)
      page.style.overflowAnchor = originalAnchor
      record()
    }
    const restore = () => {
      if (!restoring) return
      window.clearTimeout(settleTimer)
      const available = surfaces()
      let ready = !root.querySelector('[role="status"][aria-label^="Loading"]')
      for (const [key, point] of requested) {
        const element = available.get(key)
        if (!element) { ready = false; continue }
        element.scrollTop = point.top
        element.scrollLeft = point.left
        if (Math.abs(element.scrollTop - point.top) >= 1 || Math.abs(element.scrollLeft - point.left) >= 1) ready = false
      }
      if (ready) settleTimer = window.setTimeout(takeControl, 250)
    }
    const keyControl = (event: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) takeControl() }
    const freeze = () => { takeControl(); record(); leaving = true }
    const resume = () => { leaving = false; record() }
    restore()
    const observer = new MutationObserver(restore)
    observer.observe(root, { childList: true, subtree: true })
    const resize = new ResizeObserver(restore)
    resize.observe(root)
    const timeout = window.setTimeout(() => { takeControl(); observer.disconnect(); resize.disconnect() }, 3000)
    window.addEventListener('scroll', recordScroll, { capture: true, passive: true })
    window.addEventListener('wheel', takeControl, { passive: true })
    window.addEventListener('touchstart', takeControl, { passive: true })
    window.addEventListener('pointerdown', takeControl, { passive: true })
    window.addEventListener('keydown', keyControl)
    window.addEventListener('automnia:workspace-leaving', freeze)
    window.addEventListener('automnia:workspace-staying', resume)
    return () => {
      observer.disconnect()
      resize.disconnect()
      window.clearTimeout(timeout)
      window.clearTimeout(settleTimer)
      page.style.overflowAnchor = originalAnchor
      window.removeEventListener('scroll', recordScroll, true)
      window.removeEventListener('wheel', takeControl)
      window.removeEventListener('touchstart', takeControl)
      window.removeEventListener('pointerdown', takeControl)
      window.removeEventListener('keydown', keyControl)
      window.removeEventListener('automnia:workspace-leaving', freeze)
      window.removeEventListener('automnia:workspace-staying', resume)
    }
  }, [workspace, rootRef])
}

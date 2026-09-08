import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './utils'
import './dialog.css'

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
type DialogLayer = { root: HTMLElement; panel: HTMLElement }
const layers: DialogLayer[] = []
const originalInert = new Map<HTMLElement, boolean>()
let originalOverflow = ''

function ownedPopovers(layer: DialogLayer): HTMLElement[] {
  const owners = new Set(Array.from(layer.panel.querySelectorAll('[data-model-picker-instance]'), (node) => node.getAttribute('data-model-picker-instance')))
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-popover][data-popover-owner]')).filter((node) => owners.has(node.getAttribute('data-popover-owner')))
}

function syncBackground() {
  const active = layers.at(-1)
  if (!active) {
    for (const [node, inert] of originalInert) node.inert = inert
    originalInert.clear()
    document.body.style.overflow = originalOverflow
    return
  }
  const allowed = [active.root, ...ownedPopovers(active)]
  const visit = (parent: HTMLElement) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue
      if (!originalInert.has(child)) originalInert.set(child, child.inert)
      const containsLayer = allowed.some((node) => child === node || child.contains(node))
      child.inert = !containsLayer
      if (containsLayer && !allowed.includes(child)) visit(child)
    }
  }
  visit(document.body)
}

/** Focus containment for dialogs, including model menus rendered into body. */
// eslint-disable-next-line react-refresh/only-export-components -- The shared focus hook also supports existing custom dialog surfaces.
export function useDialogFocus({ open, rootRef, panelRef, onClose, preventClose = false }: {
  open: boolean
  rootRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  preventClose?: boolean
}) {
  const closeRef = useRef(onClose)
  const preventCloseRef = useRef(preventClose)
  useLayoutEffect(() => { closeRef.current = onClose; preventCloseRef.current = preventClose }, [onClose, preventClose])
  useLayoutEffect(() => {
    const root = rootRef.current
    const panel = panelRef.current
    if (!open || !root || !panel) return
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const layer = { root, panel }
    if (!layers.length) originalOverflow = document.body.style.overflow
    layers.push(layer)
    document.body.style.overflow = 'hidden'
    syncBackground()
    const isTop = () => layers.at(-1) === layer
    const isInside = (target: Node) => panel.contains(target) || ownedPopovers(layer).some((node) => node.contains(target))
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[inert]'))
    const focusFirst = () => (focusables()[0] || panel).focus({ preventScroll: true })
    const frame = window.requestAnimationFrame(() => { if (isTop() && !isInside(document.activeElement || document.body)) focusFirst() })
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return
      // The model menu owns Escape/Tab while open; it restores its trigger before closing.
      if (ownedPopovers(layer).length) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!preventCloseRef.current) closeRef.current()
      } else if (event.key === 'Tab') {
        const items = focusables()
        const first = items[0]
        const last = items.at(-1)
        if (!first) { event.preventDefault(); panel.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !isInside(event.target)) focusFirst()
    }
    const observer = new MutationObserver(syncBackground)
    observer.observe(document.body, { childList: true })
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      const index = layers.indexOf(layer)
      const wasTop = isTop()
      if (index >= 0) layers.splice(index, 1)
      syncBackground()
      if (wasTop && invoker?.isConnected && !invoker.closest('[inert]')) invoker.focus({ preventScroll: true })
    }
  }, [open, rootRef, panelRef])
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  preventClose?: boolean
  role?: 'dialog' | 'alertdialog'
}

export function Dialog({ open, onClose, title, description, children, footer, className, preventClose = false, role = 'dialog' }: DialogProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  useDialogFocus({ open, rootRef, panelRef, onClose, preventClose })
  if (!open) return null
  return createPortal(
    <div ref={rootRef} className="dui-dialog-backdrop" data-dialog-root>
      <section ref={panelRef} className={cx('dui-dialog', className)} role={role} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}>
        <header className="dui-dialog__header">
          <div><h2 id={`${id}-title`}>{title}</h2>{description ? <p id={`${id}-description`}>{description}</p> : null}</div>
          <button type="button" className="dui-dialog__close" aria-label="Close dialog" disabled={preventClose} onClick={onClose}>×</button>
        </header>
        <div className="dui-dialog__body">{children}</div>
        {footer ? <footer className="dui-dialog__footer">{footer}</footer> : null}
      </section>
    </div>, document.body,
  )
}

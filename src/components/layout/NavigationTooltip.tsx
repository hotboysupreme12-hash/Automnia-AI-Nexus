import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function NavigationTooltip() {
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const hide = () => { clearTimeout(timer); setTooltip(null) }
    const show = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-nav-label]') : null
      if (!target) return
      const label = target.querySelector<HTMLElement>('.dy-human-nav-copy')
      if (label && label.getBoundingClientRect().width > 0) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const box = target.getBoundingClientRect()
        const width = Math.min(200, window.innerWidth - 16)
        setTooltip({ label: target.dataset.navLabel || '', left: Math.max(8, Math.min(box.right + 8, window.innerWidth - width - 8)), top: Math.max(8, Math.min(box.top, window.innerHeight - 48)) })
      }, event.type === 'focusin' ? 0 : 250)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    document.addEventListener('pointerover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('pointerout', hide)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => { clearTimeout(timer); document.removeEventListener('pointerover', show); document.removeEventListener('focusin', show); document.removeEventListener('pointerout', hide); document.removeEventListener('focusout', hide); document.removeEventListener('keydown', escape); document.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide) }
  }, [])
  return tooltip ? createPortal(<div role="tooltip" className="dui-navigation-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>, document.body) : null
}

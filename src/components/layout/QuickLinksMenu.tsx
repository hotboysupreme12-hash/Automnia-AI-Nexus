import { useEffect, useId, useRef, useState } from 'react'
import type { HelpNavigationTarget } from '../help/HelpAssistantPanel'

const links: { label: string; keywords: string; target: HelpNavigationTarget }[] = [
  { label: 'Open agents', keywords: 'roster party team', target: 'agents' },
  { label: 'Focus command console', keywords: 'chat prompt message', target: 'command-console' },
  { label: 'Recruit an agent', keywords: 'new create add', target: 'recruit' },
  { label: 'Edit selected agent', keywords: 'profile identity', target: 'agent-editor' },
  { label: 'Choose agent model', keywords: 'provider llm', target: 'agent-editor-model' },
  { label: 'Configure agent heartbeat', keywords: 'interval schedule', target: 'agent-editor-heartbeat' },
  { label: 'Open missions', keywords: 'launch objective team', target: 'missions' },
  { label: 'Open monitor', keywords: 'logs runs reports activity', target: 'monitor' },
  { label: 'Manage plugins', keywords: 'extensions integrations', target: 'plugins' },
  { label: 'Configure Telegram', keywords: 'channel chat bot', target: 'plugins-telegram' },
  { label: 'Account settings', keywords: 'license credits authentication', target: 'settings-account' },
  { label: 'Appearance settings', keywords: 'theme contrast text size', target: 'settings-appearance' },
  { label: 'Workspace settings', keywords: 'layout console', target: 'settings-workspace' },
  { label: 'Voice settings', keywords: 'microphone speech recording', target: 'settings-voice' },
  { label: 'Mission settings', keywords: 'defaults schedule', target: 'settings-missions' },
  { label: 'Agent settings', keywords: 'runtime policies', target: 'settings-agents' },
  { label: 'Data settings', keywords: 'backup import export preferences', target: 'settings-data' },
]

type QuickLinksMenuProps = {
  onClose: () => void
  onNavigate: (target: HelpNavigationTarget) => void
  placement?: 'anchored' | 'fixed'
  anchorId?: string
}

export function QuickLinksMenu({ onClose, onNavigate, placement = 'anchored', anchorId = 'nexus-quick-links-trigger' }: QuickLinksMenuProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [anchorPosition, setAnchorPosition] = useState<{ top: number; right: number; maxHeight: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const filtered = links.filter((link) => words.every((word) => `${link.label} ${link.keywords}`.toLowerCase().includes(word)))
  const selected = Math.min(active, Math.max(0, filtered.length - 1))
  const execute = (target: HelpNavigationTarget) => {
    onClose()
    onNavigate(target)
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (placement !== 'anchored') return
    const positionMenu = () => {
      const trigger = document.getElementById(anchorId)
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const top = Math.min(rect.bottom + 8, window.innerHeight - 160)
      setAnchorPosition({
        top: Math.max(16, top),
        right: Math.max(16, window.innerWidth - rect.right),
        maxHeight: Math.max(160, window.innerHeight - Math.max(16, top) - 16),
      })
    }
    positionMenu()
    window.addEventListener('resize', positionMenu)
    document.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      document.removeEventListener('scroll', positionMenu, true)
    }
  }, [anchorId, placement])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-quick-links-root], [data-quick-links-menu]')) return
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      requestAnimationFrame(() => document.getElementById(anchorId)?.focus())
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [anchorId, onClose])

  useEffect(() => {
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [listId, selected])

  return (
    <div
      id="quick-links-menu"
      data-quick-links-menu
      role="dialog"
      aria-label="Quick links"
      style={placement === 'anchored' && anchorPosition ? anchorPosition : undefined}
      className="fixed right-4 top-20 z-[9999] flex max-h-[min(70dvh,34rem)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1b1e21] shadow-2xl shadow-black/50"
    >
      <div className="border-b border-white/[0.08] px-3 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-200">Quick Links</h2>
          <span className="text-[10px] text-slate-500">Ctrl/⌘ K</span>
        </div>
        <input
          ref={input}
          role="combobox"
          aria-label="Search quick links"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={filtered.length ? `${listId}-${selected}` : undefined}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
          placeholder="Search links..."
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (filtered.length) setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length)
            } else if (event.key === 'Enter' && filtered[selected]) {
              event.preventDefault()
              execute(filtered[selected].target)
            }
          }}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Quick links" className="min-h-0 overflow-y-auto p-1.5">
        {filtered.map((link, index) => (
          <div
            key={link.target}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === selected}
            className={`cursor-pointer rounded-lg px-3 py-2.5 text-[13px] transition-colors ${index === selected ? 'bg-cyan-300/10 text-cyan-50' : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => execute(link.target)}
          >
            {link.label}
          </div>
        ))}
        {!filtered.length && <p role="status" className="px-3 py-4 text-[13px] text-slate-400">No quick links match that search.</p>}
      </div>
    </div>
  )
}

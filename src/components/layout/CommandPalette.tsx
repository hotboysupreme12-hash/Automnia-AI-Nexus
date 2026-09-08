import { useEffect, useId, useRef, useState } from 'react'
import type { HelpNavigationTarget } from '../help/HelpAssistantPanel'
import { Dialog } from '../ui'

const commands: { label: string; keywords: string; target: HelpNavigationTarget }[] = [
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

export function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (target: HelpNavigationTarget) => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const filtered = commands.filter((command) => words.every((word) => `${command.label} ${command.keywords}`.toLowerCase().includes(word)))
  const selected = Math.min(active, Math.max(0, filtered.length - 1))
  const execute = (target: HelpNavigationTarget) => { onClose(); onNavigate(target) }
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => { document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' }) }, [listId, selected])
  return <Dialog open title="Find a command" description="Search destinations and actions. Use the arrow keys and Enter to choose." onClose={onClose}>
    <input ref={input} role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered.length ? `${listId}-${selected}` : undefined}
      value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }}
      className="mb-3 w-full rounded-lg border border-white/20 bg-transparent px-3 py-3 text-[14px]"
      placeholder="Try microphone, reports, or model"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (filtered.length) setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length)
        } else if (event.key === 'Enter' && filtered[selected]) { event.preventDefault(); execute(filtered[selected].target) }
      }} />
    <div id={listId} role="listbox" aria-label="Matching commands" className="max-h-[45dvh] overflow-y-auto">
      {filtered.map((command, index) => <div key={command.target} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
        className={`cursor-pointer rounded-lg border px-3 py-3 text-[14px] ${index === selected ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-50' : 'border-transparent text-slate-300'}`}
        onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => execute(command.target)}>{command.label}</div>)}
    </div>
    {!filtered.length && <p role="status" className="py-4 text-[13px] text-slate-300">No commands match. Try a workspace or setting name.</p>}
  </Dialog>
}

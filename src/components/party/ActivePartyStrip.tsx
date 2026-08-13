import { useMemo, useState, type ReactNode } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { OpenClawAgent } from '../../types/nexus'
import { agentPortraitSrc } from '../../utils/portrait'

const PARTY_SLOT_COUNT = 6

const RARITY_SLOT: Record<string, { border: string; glow: string; ring: string; bg: string }> = {
  legendary: {
    border: 'border-amber-400/40',
    glow: 'shadow-[0_0_30px_-6px_rgba(251,191,36,0.30)]',
    ring: 'ring-amber-400/70 ring-offset-1 ring-offset-slate-950',
    bg: 'bg-gradient-to-b from-[#161616] via-[#111111] to-[#0d0d0d]',
  },
  epic: {
    border: 'border-[#9475ae]/34',
    glow: 'shadow-[0_0_24px_-6px_rgba(148,117,174,0.24)]',
    ring: 'ring-[#9475ae]/45 ring-offset-1 ring-offset-slate-950',
    bg: 'bg-gradient-to-b from-[#161616] via-[#111111] to-[#0d0d0d]',
  },
  rare: {
    border: 'border-[#7097aa]/30',
    glow: 'shadow-[0_0_18px_-4px_rgba(112,151,170,0.20)]',
    ring: 'ring-[#7097aa]/38 ring-offset-1 ring-offset-slate-950',
    bg: 'bg-gradient-to-b from-[#161616] via-[#111111] to-[#0d0d0d]',
  },
  common: {
    border: 'border-white/10',
    glow: '',
    ring: 'ring-white/15 ring-offset-1 ring-offset-slate-950',
    bg: 'bg-gradient-to-b from-[#161616] via-[#111111] to-[#0d0d0d]',
  },
}

const RARITY_BADGE: Record<string, string> = {
  legendary: 'border-white/12 bg-[#171717] text-slate-300',
  epic: 'border-white/12 bg-[#171717] text-slate-300',
  rare: 'border-white/12 bg-[#171717] text-slate-300',
  common: 'border-white/12 bg-[#171717] text-slate-300',
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AI'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function portraitSrcForAgent(agent: OpenClawAgent) {
  return agentPortraitSrc(agent.id, agent.portrait)
}

interface ActivePartyStripProps {
  toolbar?: ReactNode
}

export function ActivePartyStrip({ toolbar }: ActivePartyStripProps) {
  const agents = useNexusStore((state) => state.agents)
  const activePartyIds = useNexusStore((state) => state.activePartyIds)
  const missionRunning = useNexusStore((state) => state.activeMission?.status === 'running')
  const confirmParty = useNexusStore((state) => state.confirmParty)
  const clearAll = useNexusStore((state) => state.clearAll)
  const reorderPartyMembers = useNexusStore((state) => state.reorderPartyMembers)
  const togglePartyMember = useNexusStore((state) => state.togglePartyMember)
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null)
  const [hoverSlot, setHoverSlot] = useState<number | null>(null)
  const [failedPortraitIds, setFailedPortraitIds] = useState<Set<string>>(() => new Set())

  const slots = useMemo(
    () =>
      Array.from({ length: PARTY_SLOT_COUNT }, (_, slot) => {
        const agentId = activePartyIds[slot]
        const agent = agents.find((entry) => entry.id === agentId) ?? null
        return { slot, agent }
      }),
    [activePartyIds, agents],
  )

  const handleDragLeaveSlot = (event: React.DragEvent) => {
    const el = event.currentTarget as HTMLElement
    const related = event.relatedTarget as Node | null
    if (related && el.contains(related)) return
    setDragOverSlot(null)
  }

  return (
    <section
      data-dui-panel="active-party"
      className="overflow-hidden rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,23,42,0.72),rgba(2,6,23,0.92))] shadow-2xl shadow-black/25"
    >
      <div className="active-party-head flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <div>
          <h3 className="text-[13px] font-bold tracking-[-0.01em] text-slate-100">Active Party</h3>
          <p className="mt-0.5 text-[10px] font-medium text-slate-500/80">
            Drag agents to add / reorder slots
          </p>
        </div>
        <div className="active-party-actions flex items-center gap-2">
          {toolbar && <div className="active-party-toolbar">{toolbar}</div>}
          <button
            type="button"
            onClick={clearAll}
            disabled={!activePartyIds.length || missionRunning}
            data-party-action="clear"
            className="rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-red-200/80 transition hover:bg-red-400/[0.14] hover:text-red-100 disabled:opacity-30"
            title="Clear entire party and console"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={confirmParty}
            disabled={!activePartyIds.length || missionRunning}
            data-party-action="confirm"
            className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-400/[0.14] disabled:opacity-40"
          >
            {missionRunning ? 'Locked' : 'Confirm'}
          </button>
        </div>
      </div>

      <div className="active-party-grid grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {slots.map(({ slot, agent }) => {
          const rs = agent ? RARITY_SLOT[agent.rarity || 'common'] : null
          const rarityClass = agent?.rarity ? RARITY_BADGE[agent.rarity] ?? RARITY_BADGE.common : RARITY_BADGE.common
          const portraitFailed = agent ? failedPortraitIds.has(agent.id) : false
          const portraitSrc = agent ? portraitSrcForAgent(agent) : ''

          return (
            <div
              key={`party-slot-${slot}`}
              data-slot-card
              data-slot-index={slot}
              data-slot-state={agent ? 'occupied' : 'empty'}
              data-rarity={agent?.rarity || 'empty'}
              data-dy-rarity={agent?.rarity || 'empty'}
              data-dy-slot-number={slot + 1}
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (missionRunning) return
                event.dataTransfer.dropEffect = 'move'
                if (dragOverSlot !== slot) setDragOverSlot(slot)
              }}
              onDragLeave={handleDragLeaveSlot}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setDragOverSlot(null)
                const fromPartyIndex = event.dataTransfer.getData('text/party-index')
                const agentId = event.dataTransfer.getData('text/agent-id')
                if (fromPartyIndex) {
                  const from = Number(fromPartyIndex)
                  if (Number.isFinite(from) && from >= 0) reorderPartyMembers(from, slot)
                } else if (agentId && !activePartyIds.includes(agentId) && activePartyIds.length < PARTY_SLOT_COUNT) {
                  togglePartyMember(agentId)
                }
              }}
              className={[
                'dy-party-slot relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition-all duration-200',
                'min-h-[120px] cursor-default select-none',
                agent ? 'is-filled' : 'is-empty',
                agent
                  ? dragOverSlot === slot
                    ? 'z-10 scale-[1.03] border-dashed border-cyan-400/70 bg-cyan-400/[0.12]'
                    : hoverSlot === slot
                      ? 'border-red-400/40 bg-red-400/[0.06] shadow-[0_0_16px_-2px_rgba(248,113,113,0.18)]'
                      : `${rs?.border ?? ''} ${rs?.bg ?? ''} ${rs?.glow ?? ''} border-solid hover:border-red-400/35 hover:bg-red-400/[0.05] hover:shadow-[0_0_16px_-2px_rgba(248,113,113,0.12)]`.trim().replace(/\s+/g, ' ')
                  : dragOverSlot === slot
                    ? 'z-10 scale-[1.03] border-dashed border-cyan-400/70 bg-cyan-400/[0.12] shadow-[0_0_24px_-4px_rgba(34,211,238,0.20)]'
                    : hoverSlot === slot
                      ? 'border-dashed border-cyan-400/40 bg-cyan-400/[0.06]'
                      : 'border-dashed border-white/[0.10] bg-white/[0.015] hover:border-cyan-400/35 hover:bg-cyan-400/[0.04]',
              ].join(' ')}
              onMouseEnter={() => setHoverSlot(slot)}
              onMouseLeave={() => setHoverSlot(null)}
            >
              {agent && !missionRunning && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    togglePartyMember(agent.id)
                  }}
                  aria-label={`Remove ${agent.name}`}
                  tabIndex={hoverSlot === slot ? 0 : -1}
                  className="party-slot-remove"
                  title={`Remove ${agent.name}`}
                >
                  x
                </button>
              )}

              {agent ? (
                <div
                  className="party-slot-content pointer-events-auto flex w-full items-center gap-3 rounded-lg bg-[#121212] px-3 py-2.5 ring-1 ring-white/[0.06]"
                  draggable={!missionRunning}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/party-index', String(slot))
                    event.dataTransfer.setData('text/agent-id', agent.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <div className={`active-party-avatar relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-900 ring-1 ${rs?.ring ?? 'ring-white/10'}`}>
                    {portraitSrc && !portraitFailed ? (
                      <img
                        src={portraitSrc}
                        alt={agent.name}
                        className="h-full w-full object-cover"
                        style={agent.portraitFocusY != null ? { objectPosition: `center ${agent.portraitFocusY}%` } : { objectPosition: 'center 38%' }}
                        onError={() => {
                          setFailedPortraitIds((current) => {
                            const next = new Set(current)
                            next.add(agent.id)
                            return next
                          })
                        }}
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-sm font-black text-slate-500">
                        {initials(agent.name)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="party-agent-name truncate text-[12px] font-bold tracking-[-0.01em] text-slate-100">{agent.name}</p>
                    <p className="truncate text-[9px] font-medium text-slate-400">{agent.role}</p>
                    {agent.rarity && (
                      <span className={`party-rarity-badge mt-0.5 inline-block rounded-full border px-1.5 py-px text-[7px] font-bold uppercase tracking-[0.10em] ${rarityClass}`}>
                        {agent.rarity === 'legendary' ? '★ ' : ''}{agent.rarity}{agent.rarity === 'legendary' ? ' ★' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="party-slot-empty grid h-full place-items-center text-center">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                      Slot {slot + 1}
                    </p>
                    <p className="mt-1 text-[10px] font-medium text-slate-600">
                      {dragOverSlot === slot ? 'Drop here' : 'Open'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

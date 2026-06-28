import { memo, useMemo, useState } from 'react'
import type { OpenClawAgent } from '../../types/nexus'
import { useNexusStore } from '../../store/nexusStore'
import { clampAgentStat, deriveLevelScaledAttributes } from '../../engine/AgentStatScaling'

const RARITY: Record<string, {
  cardBg: string; cardBorder: string; cardGlow: string
  badgeBg: string; badgeText: string; badgeBorder: string
  ring: string; nameClass: string
  portraitStage?: string
}> = {
  legendary: {
    cardBg: 'from-[#17130b] via-[#111315] to-[#090b0d]',
    cardBorder: 'border-amber-300/35',
    cardGlow: 'shadow-[0_22px_70px_-58px_rgba(251,191,36,0.72)]',
    badgeBg: 'bg-amber-300/[0.10]',
    badgeText: 'text-amber-100',
    badgeBorder: 'border-amber-200/35',
    ring: 'ring-amber-200/65 ring-offset-2 ring-offset-[#101113]',
    nameClass: 'text-amber-50',
    portraitStage: 'portrait-stage--legendary',
  },
  epic: {
    cardBg: 'from-[#18150f] via-[#111315] to-[#090b0d]',
    cardBorder: 'border-[#9475ae]/30',
    cardGlow: 'shadow-[0_22px_70px_-58px_rgba(148,117,174,0.42)]',
    badgeBg: 'bg-[#9475ae]/[0.10]',
    badgeText: 'text-[#eadcff]',
    badgeBorder: 'border-[#b895d6]/30',
    ring: 'ring-[#9475ae]/45 ring-offset-2 ring-offset-[#101113]',
    nameClass: 'text-[#f0e8ff]',
    portraitStage: 'portrait-stage--epic',
  },
  rare: {
    cardBg: 'from-[#161411] via-[#111315] to-[#090b0d]',
    cardBorder: 'border-[#7097aa]/28',
    cardGlow: 'shadow-[0_22px_64px_-58px_rgba(112,151,170,0.34)]',
    badgeBg: 'bg-[#7097aa]/[0.09]',
    badgeText: 'text-[#dbeaf0]',
    badgeBorder: 'border-[#9fb6bf]/28',
    ring: 'ring-[#7097aa]/36 ring-offset-2 ring-offset-[#101113]',
    nameClass: 'text-[#edf7fa]',
    portraitStage: 'portrait-stage--rare',
  },
  common: {
    cardBg: 'from-[#121416] via-[#101214] to-[#090b0d]',
    cardBorder: 'border-white/[0.12]',
    cardGlow: '',
    badgeBg: 'bg-white/[0.045]',
    badgeText: 'text-white/86',
    badgeBorder: 'border-white/[0.14]',
    ring: 'ring-white/18 ring-offset-1 ring-offset-[#101113]',
    nameClass: 'text-slate-50',
  },
}

const BEHAVIOR_LABELS: Record<string, string> = {
  executor: 'Executor',
  architect: 'Architect',
  auditor: 'Auditor',
  researcher: 'Researcher',
  hybrid: 'Hybrid',
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  intelligence: 'INT',
  speed: 'SPD',
  precision: 'PREC',
  creativity: 'CRE',
  stability: 'STAB',
  compute: 'CPU',
  parallelism: 'PAR',
}

const CAPABILITY_LABELS: Record<string, string> = {
  codeGeneration: 'Code',
  planning: 'Planning',
  research: 'Research',
  orchestration: 'Orchestration',
  memoryManagement: 'Memory',
}

function rarityAccent(rarity: string | undefined) {
  if (rarity === 'legendary') return 'from-[#caa25a] via-[#e0bf72] to-[#7a5f31]'
  if (rarity === 'epic') return 'from-[#7e6296] via-[#b795d4] to-[#5c486d]'
  if (rarity === 'rare') return 'from-[#577887] via-[#9fb6bf] to-[#324b55]'
  return 'from-stone-500/65 via-stone-400/45 to-neutral-700/30'
}

function rarityWash(rarity: string | undefined) {
  if (rarity === 'legendary') {
    return 'bg-[radial-gradient(circle_at_24%_0%,rgba(242,204,98,0.18),transparent_34%),linear-gradient(145deg,rgba(242,204,98,0.08),transparent_48%)]'
  }
  if (rarity === 'epic') {
    return 'bg-[radial-gradient(circle_at_24%_0%,rgba(148,117,174,0.16),transparent_34%),linear-gradient(145deg,rgba(184,149,214,0.06),transparent_50%)]'
  }
  if (rarity === 'rare') {
    return 'bg-[radial-gradient(circle_at_24%_0%,rgba(112,151,170,0.14),transparent_34%),linear-gradient(145deg,rgba(159,182,191,0.05),transparent_52%)]'
  }
  return 'bg-[radial-gradient(circle_at_24%_0%,rgba(255,255,255,0.045),transparent_34%)]'
}

function modelTier(modelId = '') {
  const id = modelId.toLowerCase()
  if (id.includes('gpt-5') || id.includes('opus') || id.includes('pro') || id.includes('o3')) return 92
  if (id.includes('gpt-4') || id.includes('sonnet') || id.includes('deepseek') || id.includes('gemini')) return 82
  if (id.includes('flash') || id.includes('mini') || id.includes('nano') || id.includes('haiku')) return 66
  return 72
}

function deriveConfiguredAttributePotential(agent: OpenClawAgent): OpenClawAgent['attributes'] {
  const primary = agent.model?.primary || ''
  const fallbackCount = agent.model?.fallbacks?.length || 0
  const tier = modelTier(primary)
  const thinking = agent.runtimePolicy?.thinkingDefault || 'off'
  const thinkingBoost = thinking === 'high' ? 12 : thinking === 'medium' ? 8 : thinking === 'low' ? 4 : thinking === 'minimal' ? 2 : 0
  const timeout = agent.runtimePolicy?.timeoutSeconds || 90
  const tick = agent.heartbeat.tickIntervalMs || 30000
  const idle = agent.heartbeat.idleTimeoutMs || 60000
  const fastWake = clampAgentStat(100 - Math.log10(Math.max(1000, tick)) * 14)
  const idleRoom = clampAgentStat(Math.log10(Math.max(5000, idle)) * 18)
  const capabilityCount = Object.values(agent.mds.capabilities).filter(Boolean).length
  const toolCount = agent.mds.toolAccess.length + (agent.toolsPolicy?.allow?.length || 0)
  const sandboxPenalty = agent.sandbox?.mode === 'all' ? 3 : agent.sandbox?.mode === 'non-main' ? 1 : 0

  return {
    intelligence: clampAgentStat(tier + thinkingBoost + fallbackCount * 2),
    speed: clampAgentStat(fastWake + (thinking === 'off' ? 10 : thinking === 'minimal' ? 5 : -thinkingBoost) - sandboxPenalty),
    precision: clampAgentStat(tier * 0.62 + thinkingBoost * 2.1 + idleRoom * 0.22 + (agent.heartbeat.recoveryMode ? 5 : 0)),
    creativity: clampAgentStat(58 + thinkingBoost * 1.8 + capabilityCount * 4 + (agent.behaviorProfile === 'researcher' ? 8 : 0)),
    stability: clampAgentStat(58 + idleRoom * 0.32 + (agent.heartbeat.recoveryMode ? 14 : 0) + (agent.heartbeat.continuous ? 4 : 0) - sandboxPenalty),
    compute: clampAgentStat(tier * 0.72 + Math.min(18, timeout / 120) + fallbackCount * 3 + toolCount),
    parallelism: clampAgentStat(42 + capabilityCount * 8 + fallbackCount * 5 + (agent.runtimePolicy?.parallelPreferred ? 12 : 0)),
  }
}

function hasGenericBaseAttributes(agent: OpenClawAgent): boolean {
  const values = Object.values(agent.attributes).filter(Number.isFinite)
  if (values.length < 4) return true
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const spread = Math.max(...values) - Math.min(...values)
  return spread <= 8 && average >= 45 && average <= 72
}

function deriveCardAttributes(agent: OpenClawAgent): OpenClawAgent['attributes'] {
  return deriveLevelScaledAttributes(
    agent,
    deriveConfiguredAttributePotential(agent),
    hasGenericBaseAttributes(agent) ? 0.76 : 0.36,
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AI'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function portraitSrcForAgent(agent: OpenClawAgent) {
  if (agent.id === 'hn-netanyahu') return `${import.meta.env.BASE_URL}agents/generated/benjamin-netanyahu.jpg`
  if (agent.portrait) return agent.portrait
  return ''
}

interface AgentCardProps {
  agent: OpenClawAgent
  isSelected: boolean
  slotNumber?: number | null
  partyIndex?: number | null
  inParty?: boolean
  isBusy?: boolean
  missionRunning?: boolean
  displayMode?: 'showcase' | 'grid6' | 'grid8' | 'grid10' | 'list'
}

export const AgentCard = memo(function AgentCard({ agent, isSelected, slotNumber, partyIndex, inParty, isBusy = false, missionRunning, displayMode = 'showcase' }: AgentCardProps) {
  const selectAgent = useNexusStore((s) => s.selectAgent)
  const togglePartyMember = useNexusStore((s) => s.togglePartyMember)
  const openEditor = useNexusStore((s) => s.openEditor)
  const [failedPortraitSrc, setFailedPortraitSrc] = useState<string | null>(null)

  const busy = isBusy
  const inP = Boolean(inParty)
  const displaySlot = slotNumber ?? (partyIndex != null ? partyIndex + 1 : 0)
  const thinkingMode = agent.runtimePolicy?.thinkingDefault && agent.runtimePolicy.thinkingDefault !== 'off'
  const portraitSrc = portraitSrcForAgent(agent)
  const showPortrait = Boolean(portraitSrc && failedPortraitSrc !== portraitSrc)

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('text/agent-id', agent.id)
    if (inP && partyIndex != null) {
      event.dataTransfer.setData('text/party-index', String(partyIndex))
    }
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleCardClick = () => {
    selectAgent(agent.id, { toggle: true })
  }

  const handleDoubleClick = () => {
    togglePartyMember(agent.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openEditor(agent.id)
  }

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, textarea, a')) return
    e.preventDefault()
    selectAgent(agent.id, { toggle: true })
  }

  const r = RARITY[agent.rarity || 'common']
  const listMode = displayMode === 'list'
  const denseMode = displayMode === 'grid10'
  const compactMode = displayMode === 'grid8' || denseMode
  const cardMinHeight = listMode ? 'min-h-[124px]' : denseMode ? 'min-h-[284px]' : compactMode ? 'min-h-[310px]' : 'min-h-[390px]'
  const a = useMemo(() => deriveCardAttributes(agent), [agent])
  const topStats = useMemo(
    () => (Object.keys(a) as Array<keyof typeof a>)
      .slice(0, 6)
      .map((key) => ({ key, value: a[key] }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 3),
    [a],
  )
  const capabilities = useMemo(
    () => Object.entries(agent.mds.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([key]) => CAPABILITY_LABELS[key] || key)
      .slice(0, 4),
    [agent.mds.capabilities],
  )
  const statCells = topStats.slice(0, 3)
  const visibleCapabilities = (denseMode || listMode || compactMode ? capabilities.slice(0, 1) : capabilities.slice(0, 2))

  return (
    <div
      data-agent-card="true"
      data-agent-id={agent.id}
      data-agent-rarity={agent.rarity || 'common'}
      data-agent-display-mode={displayMode}
      data-agent-in-party={inP ? 'true' : 'false'}
      role="button"
      tabIndex={missionRunning && !inP ? -1 : 0}
      aria-pressed={isSelected}
      aria-label={`${agent.name}, ${agent.role}. ${inP ? `In party slot ${displaySlot}.` : 'Not in party.'} Press Enter to select.`}
      draggable={!missionRunning}
      onDragStart={handleDragStart}
      onClick={handleCardClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleCardKeyDown}
      className={[
        'agent-card-shell agent-card-pro relative flex h-full cursor-pointer border p-0 transition-all duration-300 select-none overflow-hidden group/card',
        listMode ? 'flex-row' : 'flex-col',
        cardMinHeight,
        r.cardBorder,
        r.cardGlow,
        `bg-gradient-to-b ${r.cardBg}`,
        isSelected ? 'ring-2 ring-amber-300/55 !border-amber-200/60 z-10 shadow-[0_0_44px_-18px_rgba(214,169,74,0.58),0_22px_58px_-46px_rgba(214,169,74,0.72)]' : '',
        'hover:-translate-y-0.5 hover:z-10',
      ].join(' ')}
    >
      <div className={[
        'pointer-events-none absolute inset-0 z-[1] opacity-90',
        'agent-card-rarity-wash',
        rarityWash(agent.rarity),
      ].join(' ')} />
      <div className={`agent-card-accent-line pointer-events-none absolute inset-x-0 top-0 z-[6] h-[3px] bg-gradient-to-r ${rarityAccent(agent.rarity)} opacity-85`} />
      <div className="agent-card-grid pointer-events-none absolute inset-0 z-[1]" />
      <div className="agent-card-foil pointer-events-none absolute inset-0 z-[2]" />
      <div className="agent-card-inner-frame pointer-events-none absolute z-[3]" />

      <div className={listMode ? 'agent-card-media-wrap relative z-10 w-[136px] shrink-0 p-3 pr-0' : denseMode ? 'agent-card-media-wrap relative z-10 px-3 pt-3' : compactMode ? 'agent-card-media-wrap relative z-10 px-3.5 pt-3.5' : 'agent-card-media-wrap relative z-10 px-4 pt-4'}>
        <div className={[
          'agent-card-media relative w-full overflow-hidden border border-white/[0.08] shadow-[0_20px_50px_-34px_rgba(0,0,0,0.92)] transition-transform duration-300',
          listMode ? 'h-full min-h-[124px]' : denseMode ? 'aspect-[16/11]' : compactMode ? 'aspect-[16/11]' : 'aspect-[16/10]',
          agent.rarity !== 'common' ? `portrait-stage ${r.portraitStage || ''}` : '',
        ].join(' ')}>
          <div className="pointer-events-none absolute inset-0 z-10 ring-1 ring-inset ring-white/[0.08]" />
          <div className="pointer-events-none absolute inset-[5px] z-10 ring-1 ring-inset ring-white/[0.055]" />
          <div className="portrait-corners" />

          {showPortrait ? (
            <div className="relative h-full w-full bg-slate-950">
              <img
                src={portraitSrc}
                alt={agent.name}
                className="agent-card-portrait-img h-full w-full object-cover transition duration-500 group-hover/card:scale-[1.035]"
                style={{ objectPosition: agent.portraitFocusY != null ? `center ${agent.portraitFocusY}%` : 'center 38%' }}
                loading="lazy"
                onError={() => setFailedPortraitSrc(portraitSrc || null)}
              />
            </div>
          ) : (
            <div className="agent-card-placeholder-stage flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
              <div className="agent-card-initials flex h-20 w-20 items-center justify-center border border-white/[0.10] bg-white/[0.04] shadow-inner">
                <span className="text-3xl font-black text-slate-300/80">{initials(agent.name)}</span>
              </div>
            </div>
          )}

          <div className="agent-card-media-shade pointer-events-none absolute inset-0 z-10" />
          <div className="agent-card-media-top absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <span className={`agent-card-badge truncate border px-2 py-1 text-[8px] font-black uppercase leading-none ${r.badgeBg} ${r.badgeText} ${r.badgeBorder}`}>
                {agent.rarity || 'common'}
              </span>
              {inP && (
                <span className="agent-card-badge agent-card-badge-slot truncate border px-2 py-1 text-[8px] font-black uppercase leading-none">
                  Slot {displaySlot}
                </span>
              )}
            </div>
            {busy && (
              <span className="agent-card-status-pill is-live shrink-0">
                <span aria-hidden="true" />
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={listMode ? 'agent-card-body relative z-10 flex min-w-0 flex-1 flex-col p-3' : denseMode ? 'agent-card-body relative z-10 flex flex-1 flex-col p-3 pt-2.5' : compactMode ? 'agent-card-body relative z-10 flex flex-1 flex-col p-3.5 pt-3' : 'agent-card-body relative z-10 flex flex-1 flex-col p-4 pt-3.5'}>
        <div className="agent-card-heading mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="agent-card-class truncate text-[9px] font-extrabold uppercase leading-none text-white/45">
              {agent.className}
            </p>
            <h3 className={`agent-card-name mt-1.5 ${listMode ? 'truncate' : 'line-clamp-2'} text-[18px] font-black leading-tight ${r.nameClass}`}>
              {agent.name}
            </h3>
            <p className={`${listMode ? 'line-clamp-1' : 'line-clamp-2'} agent-card-role mt-1 min-w-0 text-[11px] font-semibold leading-snug text-white/72`}>
              {agent.role}
            </p>
          </div>
          <div className="agent-card-level-pill shrink-0 border px-2.5 py-2 text-right shadow-xl backdrop-blur">
            <p className="text-[8px] font-black uppercase leading-none text-white/45">LV</p>
            <p className="mt-1 text-[20px] font-black leading-none text-white tabular-nums">{agent.level}</p>
          </div>
        </div>

        <div className={listMode ? 'agent-card-stat-matrix agent-card-stat-matrix--list mb-2 grid grid-cols-3 gap-1.5' : 'agent-card-stat-matrix mb-3 grid grid-cols-3 gap-1.5'}>
          {statCells.map(({ key, value }) => (
            <div key={key}>
              <span>{ATTRIBUTE_LABELS[key] || key}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className={listMode ? 'agent-card-tags mb-2 flex min-h-0 flex-wrap items-start gap-1 overflow-hidden' : denseMode ? 'agent-card-tags mb-2.5 flex min-h-[32px] flex-wrap items-start gap-1 overflow-hidden' : 'agent-card-tags mb-3 flex min-h-[38px] flex-wrap items-start gap-1 overflow-hidden'}>
          <span>{BEHAVIOR_LABELS[agent.behaviorProfile] ?? 'Agent'}</span>
          {visibleCapabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
          {thinkingMode && !compactMode && !listMode && <span>Think {agent.runtimePolicy?.thinkingDefault}</span>}
        </div>

        <div className="agent-card-actions mt-auto grid grid-cols-[1fr_auto] gap-2 border-t border-white/[0.07] pt-3">
          <button
            type="button"
            aria-label={inP ? `Remove ${agent.name} from active party` : `Deploy ${agent.name} to active party`}
            onClick={(e) => { e.stopPropagation(); togglePartyMember(agent.id) }}
            disabled={!!missionRunning && !inP}
            className="agent-card-action-primary inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <span aria-hidden="true" className="agent-card-action-icon">{inP ? '-' : '+'}</span>
            {inP ? 'Remove' : 'Deploy'}
          </button>
          <button
            type="button"
            aria-label={`Edit ${agent.name}`}
            onClick={(e) => { e.stopPropagation(); openEditor(agent.id) }}
            className="agent-card-action-secondary inline-flex items-center justify-center border px-3 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200"
            title="Configure agent"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  )
})

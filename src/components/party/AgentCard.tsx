import { memo, useMemo, useState } from 'react'
import type { OpenClawAgent } from '../../types/nexus'
import { useNexusStore } from '../../store/nexusStore'
import { clampAgentStat, deriveLevelScaledAttributes } from '../../engine/AgentStatScaling'
import { agentPortraitSrc } from '../../utils/portrait'
import type { AgentCardTheme } from '../settings/workspaceSettings'

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
  return agentPortraitSrc(agent.id, agent.portrait)
}

function shortModelName(modelId = '') {
  if (!modelId) return 'Unassigned'
  const parts = modelId.split('/').filter(Boolean)
  return parts[parts.length - 1] || modelId
}

function shortProviderName(modelId = '') {
  if (!modelId) return 'Unassigned'
  return modelId.split('/').filter(Boolean)[0] || 'Unassigned'
}

interface AgentCardProps {
  agent: OpenClawAgent
  isSelected: boolean
  slotNumber?: number | null
  partyIndex?: number | null
  inParty?: boolean
  isBusy?: boolean
  missionRunning?: boolean
  cardTheme: AgentCardTheme
  displayMode?: 'grid8' | 'grid10' | 'list'
  activityStatus?: {
    label: string
    detail: string
    kind: 'working' | 'queued' | 'approval' | 'reply'
  }
}

export const AgentCard = memo(function AgentCard({ agent, isSelected, slotNumber, partyIndex, inParty, isBusy = false, missionRunning, cardTheme, displayMode = 'grid8', activityStatus }: AgentCardProps) {
  const selectAgent = useNexusStore((s) => s.selectAgent)
  const togglePartyMember = useNexusStore((s) => s.togglePartyMember)
  const openEditor = useNexusStore((s) => s.openEditor)
  const [failedPortraitSrc, setFailedPortraitSrc] = useState<string | null>(null)

  const listMode = displayMode === 'list'
  const busy = isBusy
  const inP = Boolean(inParty)
  const liveStatusLabel = activityStatus?.label || 'Working'
  const liveStatusDetail = activityStatus?.detail || `${agent.name} is handling an active turn.`
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

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // A double click emits two click events. Treat it as one selection action;
    // party membership is controlled by the explicit Deploy/Remove button.
    if (event.detail > 1) return
    selectAgent(agent.id, { toggle: true })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openEditor(agent.id)
  }

  const handleCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))
    const maxTilt = listMode ? 1.1 : 5.5
    const rotateX = ((50 - y) / 50) * maxTilt
    const rotateY = ((x - 50) / 50) * maxTilt

    event.currentTarget.style.setProperty('--agent-card-pointer-x', `${x}%`)
    event.currentTarget.style.setProperty('--agent-card-pointer-y', `${y}%`)
    event.currentTarget.style.setProperty('--agent-card-rotate-x', `${rotateX.toFixed(2)}deg`)
    event.currentTarget.style.setProperty('--agent-card-rotate-y', `${rotateY.toFixed(2)}deg`)
  }

  const handleCardPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--agent-card-pointer-x', '50%')
    event.currentTarget.style.setProperty('--agent-card-pointer-y', '50%')
    event.currentTarget.style.setProperty('--agent-card-rotate-x', '0deg')
    event.currentTarget.style.setProperty('--agent-card-rotate-y', '0deg')
  }

  const simpleMode = displayMode === 'grid8'
  const denseMode = displayMode === 'grid10'
  const compactMode = displayMode === 'grid8' || denseMode
  const cardMinHeight = listMode ? 'min-h-[124px]' : denseMode ? 'min-h-[360px]' : compactMode ? 'min-h-[310px]' : 'min-h-[390px]'
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
  const visibleCapabilities = denseMode
    ? capabilities.slice(0, 3)
    : listMode
      ? capabilities.slice(0, 4)
      : compactMode
        ? capabilities.slice(0, 1)
        : capabilities.slice(0, 2)
  const toolCount = agent.mds.toolAccess.length + (agent.toolsPolicy?.allow?.length || 0)
  const heartbeatSeconds = Math.round((agent.heartbeat.tickIntervalMs || 0) / 1_000)
  const listDetailItems = [
    { label: 'Provider', value: shortProviderName(agent.model?.primary) },
    { label: 'Model', value: shortModelName(agent.model?.primary) },
    { label: 'Timing', value: heartbeatSeconds > 0 ? `${heartbeatSeconds}s` : 'off' },
    { label: 'Tools', value: String(toolCount) },
    { label: 'Skills', value: String(agent.unlockedSkills.length) },
    { label: 'Sandbox', value: agent.sandbox?.mode || 'default' },
  ]
  const detailItems = denseMode ? [
    { label: 'Model', value: shortModelName(agent.model?.primary) },
    { label: 'Thinking', value: agent.runtimePolicy?.thinkingDefault || 'off' },
    { label: 'Heartbeat', value: heartbeatSeconds > 0 ? `${heartbeatSeconds}s` : 'off' },
    { label: 'Tools', value: String(toolCount) },
    { label: 'Sandbox', value: agent.sandbox?.mode || 'default' },
    { label: 'Fallbacks', value: String(agent.model?.fallbacks?.length || 0) },
  ] : []

  return (
    <div
      data-agent-card="true"
      data-agent-id={agent.id}
      data-agent-rarity={agent.rarity || 'common'}
      data-agent-card-theme={cardTheme}
      data-agent-display-mode={displayMode}
      data-agent-in-party={inP ? 'true' : 'false'}
      data-agent-running={busy ? 'true' : 'false'}
      data-agent-activity={activityStatus?.kind || (busy ? 'working' : 'idle')}
      data-agent-selected={isSelected ? 'true' : 'false'}
      role="group"
      aria-label={`${agent.name}, ${agent.role}. ${inP ? `In party slot ${displaySlot}.` : 'Not in party.'} ${isSelected ? 'Selected for Agent Chat.' : 'Not selected for Agent Chat.'}`}
      draggable={!missionRunning}
      onDragStart={handleDragStart}
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      onPointerMove={handleCardPointerMove}
      onPointerLeave={handleCardPointerLeave}
      className={[
        'agent-card-shell agent-card-pro agent-card-3d relative flex h-full cursor-pointer border p-0 select-none overflow-visible',
        listMode ? 'flex-row' : 'flex-col',
        cardMinHeight,
        'border-white/[0.12] bg-[#101214]',
        isSelected ? 'ring-2 ring-amber-300/55 !border-amber-200/60 z-10' : '',
      ].join(' ')}
    >
      <div className={listMode ? 'agent-card-media-wrap relative z-10 w-[136px] shrink-0 p-3 pr-0' : denseMode ? 'agent-card-media-wrap relative z-10 px-3 pt-3' : compactMode ? 'agent-card-media-wrap relative z-10 px-3.5 pt-3.5' : 'agent-card-media-wrap relative z-10 px-4 pt-4'}>
        <div className={[
          'agent-card-media relative w-full overflow-hidden border border-white/[0.08]',
          listMode ? 'h-full min-h-[124px]' : denseMode ? 'aspect-[16/11]' : compactMode ? 'aspect-[16/11]' : 'aspect-[16/10]',
          'portrait-stage',
        ].join(' ')}>
          {showPortrait ? (
            <div className="relative h-full w-full bg-slate-950">
              <img
                src={portraitSrc}
                alt={agent.name}
                className="agent-card-portrait-img h-full w-full object-cover"
                style={{ objectPosition: agent.portraitFocusY != null ? `center ${agent.portraitFocusY}%` : 'center 38%' }}
                loading="lazy"
                onError={() => setFailedPortraitSrc(portraitSrc || null)}
              />
            </div>
          ) : (
            <div className="agent-card-placeholder-stage flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
              <div className="agent-card-initials flex h-20 w-20 items-center justify-center border border-white/[0.10] bg-white/[0.04]">
                <span className="text-3xl font-black text-slate-300/80">{initials(agent.name)}</span>
              </div>
            </div>
          )}

          <div className="agent-card-media-top absolute left-3 right-3 top-3 z-20 flex items-start justify-end gap-2">
            {busy && (
              <span
                className="agent-card-status-pill is-live shrink-0"
                data-status-kind={activityStatus?.kind || 'working'}
                title={liveStatusDetail}
                aria-label={`${agent.name}: ${liveStatusLabel}. ${liveStatusDetail}`}
              >
                <span aria-hidden="true" />
                {liveStatusLabel}
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
            <h3 className={`agent-card-name mt-1.5 ${listMode ? 'truncate' : 'line-clamp-2'} text-[18px] font-black leading-tight text-slate-50`}>
              {agent.name}
            </h3>
            <p
              className="agent-card-role mt-1 min-w-0 truncate text-[11px] font-semibold leading-snug text-white/72"
              title={agent.role}
              aria-label={`Role: ${agent.role}`}
            >
              {agent.role}
            </p>
            <span
              className="agent-card-badge agent-card-rarity-badge mt-2 inline-flex max-w-full items-center truncate border px-2 py-1 text-[8px] font-black uppercase leading-none"
              aria-label={`Rarity: ${agent.rarity || 'common'}`}
            >
              {agent.rarity || 'common'}
            </span>
          </div>
          <div className="agent-card-heading-actions flex shrink-0 items-start gap-2">
            <div className="agent-card-level-pill shrink-0 border px-2.5 py-2 text-center">
              <p className="text-[8px] font-black uppercase leading-none text-white/45">LV</p>
              <p className="mt-1 text-[20px] font-black leading-none text-white tabular-nums">{agent.level}</p>
            </div>
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
          <span className="agent-card-tag agent-card-tag--behavior">{BEHAVIOR_LABELS[agent.behaviorProfile] ?? 'Agent'}</span>
          {visibleCapabilities.map((capability) => (
            <span className="agent-card-tag" key={capability}>{capability}</span>
          ))}
          {inP && displaySlot > 0 && (
            <span className="agent-card-tag agent-card-tag--slot" aria-label={`Active party slot ${displaySlot}`}>
              Slot {displaySlot}
            </span>
          )}
          {thinkingMode && !compactMode && !listMode && <span>Think {agent.runtimePolicy?.thinkingDefault}</span>}
        </div>

        {listMode && (
          <div className="agent-card-list-details" aria-label="Agent runtime and configuration summary">
            {listDetailItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong title={item.value}>{item.value}</strong>
              </div>
            ))}
          </div>
        )}

        {simpleMode && (
          <div className="agent-card-simple-meta" aria-label="Agent model and runtime summary">
            <div className="agent-card-simple-meta__model" title={agent.model?.primary || 'No primary model assigned'}>
              <span>Model</span>
              <strong>{shortModelName(agent.model?.primary)}</strong>
            </div>
            <div className="agent-card-simple-meta__tools" title={`${toolCount} tools available`}>
              <span>Tools</span>
              <strong>{toolCount}</strong>
            </div>
          </div>
        )}

        {denseMode && (
          <div className="agent-card-details" aria-label="Detailed agent configuration">
            {detailItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong title={item.value}>{item.value}</strong>
              </div>
            ))}
          </div>
        )}

        <div className="agent-card-actions mt-auto grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-t border-white/[0.07] pt-3">
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
            aria-label={isSelected ? `Remove ${agent.name} from Agent Chat` : `Add ${agent.name} to Agent Chat`}
            aria-pressed={isSelected}
            onClick={(event) => { event.stopPropagation(); selectAgent(agent.id, { toggle: true }) }}
            className={`agent-card-action-chat inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200 ${isSelected ? 'is-selected' : ''}`}
            title={isSelected ? 'Remove from Agent Chat' : 'Add to Agent Chat'}
          >
            <span aria-hidden="true">{isSelected ? '✓' : '+'}</span>
            Chat
          </button>
          {!listMode ? (
            <button
              type="button"
              aria-label={`Edit ${agent.name}`}
              onClick={(e) => { e.stopPropagation(); openEditor(agent.id) }}
              className="agent-card-action-secondary inline-flex items-center justify-center border px-3 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200"
              title="Configure agent"
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Edit ${agent.name}`}
              title={`Edit ${agent.name}`}
              onClick={(e) => { e.stopPropagation(); openEditor(agent.id) }}
              className="agent-card-list-edit agent-card-action-secondary inline-flex items-center justify-center gap-1.5 border px-2.5 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                <path d="m4 16.5-.8 3.3 3.3-.8L17.9 7.6a2.3 2.3 0 0 0-3.3-3.3L4 16.5Z" />
                <path d="m13.5 5.5 5 5" />
              </svg>
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

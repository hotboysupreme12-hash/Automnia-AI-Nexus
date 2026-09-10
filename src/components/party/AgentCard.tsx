import { useAgentVoiceStore } from '../../speech/agentVoiceStore'
import { AvatarFallback } from '../ui/AvatarFallback'
import { memo, useState } from 'react'
import type { OpenClawAgent } from '../../types/nexus'
import { useNexusStore } from '../../store/nexusStore'
import { agentPortraitSrc } from '../../utils/portrait'
import type { AgentCardTheme } from '../settings/workspaceSettings'

const BEHAVIOR_LABELS: Record<string, string> = {
  executor: 'Executor',
  architect: 'Architect',
  auditor: 'Auditor',
  researcher: 'Researcher',
  hybrid: 'Hybrid',
}



function portraitSrcForAgent(agent: OpenClawAgent) {
  return agentPortraitSrc(agent.id, agent.portrait)
}

function formatModelName(modelId = '') {
  if (!modelId) return 'Unassigned'
  const parts = modelId.split('/').filter(Boolean)
  const model = parts[parts.length - 1] || modelId
  const friendlyModel = model
    .replace(/(\d+)-(\d+)(?=-|$)/g, '$1.$2')
    .replace(/[-_:@]+/g, ' ')

  return friendlyModel
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase()
      if (normalized === 'gpt') return 'GPT'
      if (normalized === 'gemini') return 'Gemini'
      if (normalized === 'claude') return 'Claude'
      if (normalized === 'llama') return 'Llama'
      if (/^o\d+$/i.test(part)) return part.toUpperCase()
      if (/^\d+(?:\.\d+)?[a-z]+$/i.test(part)) {
        return part.replace(/[a-z]+$/i, (suffix) => suffix.toUpperCase())
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
    })
    .join(' ')
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
  const voice = useAgentVoiceStore()
  const voiceActive = voice.agentId === agent.id && voice.phase !== 'idle'
  const voiceListening = voiceActive && voice.phase === 'recording'
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
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
  const skillCount = agent.unlockedSkills.length
  const heartbeatSeconds = Math.round((agent.heartbeat.tickIntervalMs || 0) / 1_000)
  const listDetailItems = [
    { label: 'Provider', value: shortProviderName(agent.model?.primary) },
    { label: 'Model', value: formatModelName(agent.model?.primary) },
    { label: 'Timing', value: heartbeatSeconds > 0 ? `${heartbeatSeconds}s` : 'off' },
    { label: 'Skills', value: String(skillCount) },
    { label: 'Sandbox', value: agent.sandbox?.mode || 'default' },
  ]
  const detailItems = denseMode ? [
    { label: 'Model', value: formatModelName(agent.model?.primary) },
    { label: 'Thinking', value: agent.runtimePolicy?.thinkingDefault || 'off' },
    { label: 'Heartbeat', value: heartbeatSeconds > 0 ? `${heartbeatSeconds}s` : 'off' },
    { label: 'Skills', value: String(skillCount) },
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
        'agent-card-shell agent-card-pro agent-card-3d agent-card-modern relative flex h-full cursor-pointer border p-0 select-none overflow-visible',
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
            <AvatarFallback name={agent.name} large />
          )}

          <div className="agent-card-portrait-shade" aria-hidden="true" />
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
            <span className="agent-card-kicker">{BEHAVIOR_LABELS[agent.behaviorProfile] ?? 'Agent'} · {agent.className}</span>
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
          </div>
        </div>

        {listMode && (
          <div className="agent-card-list-details" aria-label="Agent runtime and configuration summary">
            {listDetailItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong className={item.label === 'Model' ? 'agent-card-model-value' : undefined} title={item.value}>{item.value}</strong>
              </div>
            ))}
          </div>
        )}

        {simpleMode && (
          <div className="agent-card-simple-meta" aria-label="Agent model and runtime summary">
            <div className="agent-card-simple-meta__model" title={agent.model?.primary || 'No primary model assigned'}>
              <span>Model</span>
              <strong className="agent-card-model-value">{formatModelName(agent.model?.primary)}</strong>
            </div>
            <div className="agent-card-simple-meta__tools" title={`${skillCount} enabled skills`}>
              <span>Skills</span>
              <strong>{skillCount}</strong>
            </div>
          </div>
        )}

        {denseMode && (
          <div className="agent-card-details" aria-label="Detailed agent configuration">
            {detailItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong className={item.label === 'Model' ? 'agent-card-model-value' : undefined} title={item.value}>{item.value}</strong>
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
            aria-label={voiceListening ? `Stop recording and send to ${agent.name}` : voiceActive ? `Preparing voice message for ${agent.name}` : `Chat with ${agent.name} using microphone`}
            aria-pressed={voiceActive}
            disabled={voice.phase !== 'idle' && !voiceListening}
            data-voice-phase={voiceActive ? voice.phase : 'idle'}
            onClick={(event) => {
              event.stopPropagation()
              if (voice.request(agent.id)) selectAgent(agent.id)
            }}
            className={`agent-card-action-chat inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-[9px] font-black uppercase leading-none transition-all duration-200 ${isSelected ? 'is-selected' : ''}`}
            title={voiceListening ? 'Pause or click to finish and send' : voiceActive ? 'Preparing voice message' : 'Speak a message to this agent'}
          >
            {voiceActive ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`size-4 ${voiceListening ? 'animate-pulse' : ''}`}>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
              </svg>
            ) : 'Chat'}
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

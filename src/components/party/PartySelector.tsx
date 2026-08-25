import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AgentCard } from './AgentCard'
import { Panel } from '../common/Panel'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentActivityEvent, AgentRarity, AgentResponse, OpenClawAgent } from '../../types/nexus'
import { useRuntimeSummaryStatus, type RuntimeStatus } from '../../hooks/useRuntimeStatus'
import {
  DEFAULT_REGISTRY_PREFERENCES,
  REGISTRY_DISPLAY_OPTIONS,
  REGISTRY_OVERLAY_OPTIONS,
  REGISTRY_PREFS_CHANGED_EVENT,
  applyRegistryCardTheme,
  readRegistryPreferences,
  resolveAgentCardTheme,
  saveRegistryPreferences,
  type AgentDisplayMode,
  type AgentOverlayPreset,
  type RegistryPreferences,
  type RegistrySortKey as SortKey,
} from '../settings/workspaceSettings'

type DisplayModeConfig = { id: AgentDisplayMode; label: string; pageSize: number; hint: string }
type OverlayPresetConfig = { id: AgentOverlayPreset; label: string; hint: string }

const DISPLAY_MODES: DisplayModeConfig[] = REGISTRY_DISPLAY_OPTIONS
const OVERLAY_PRESETS: OverlayPresetConfig[] = REGISTRY_OVERLAY_OPTIONS

const gridClassByMode: Record<AgentDisplayMode, string> = {
  grid8: 'agent-card-registry-grid agent-card-registry-grid--grid8',
  grid10: 'agent-card-registry-grid agent-card-registry-grid--grid10',
  list: 'grid grid-cols-1 gap-2',
}

const FLOW_GRID_MODES = new Set<AgentDisplayMode>(['grid8', 'grid10'])
const EXTERNAL_CHANNEL_RUNNING_WINDOW_MS = 90_000
const CYAN_SELECT_CHEVRON_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%2367e8f9' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
} as const

function countRenderedGridColumns(element: HTMLElement | null): number {
  if (!element) return 1
  const columns = window.getComputedStyle(element).gridTemplateColumns
  if (!columns || columns === 'none') return 1
  return Math.max(1, columns.split(' ').filter(Boolean).length)
}

function activeExternalChannelAgentIds(status: RuntimeStatus | null): Set<string> {
  const active = new Set<string>()
  if (!status) return active

  for (const session of status.sessions || []) {
    if (session.active && session.agentId) active.add(session.agentId)
  }

  const newestActivityByAgent = new Map<string, { direction: string; timestamp: string }>()
  for (const event of status.gateway.activity?.events || []) {
    if (!event.agentId || newestActivityByAgent.has(event.agentId)) continue
    newestActivityByAgent.set(event.agentId, event)
  }
  const now = Date.now()
  for (const [agentId, event] of newestActivityByAgent) {
    const ageMs = now - Date.parse(event.timestamp)
    // An inbound message starts the external turn. A later outbound message
    // ends it; a bounded window prevents a missing provider delivery log from
    // leaving an agent card in the Running state indefinitely.
    if (event.direction === 'inbound' && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= EXTERNAL_CHANNEL_RUNNING_WINDOW_MS) {
      active.add(agentId)
    }
  }
  return active
}

type AgentCardActivityStatus = {
  label: string
  detail: string
  kind: 'working' | 'queued' | 'approval' | 'reply'
}

function latestVisibleActivity(response: AgentResponse): AgentActivityEvent | undefined {
  return [...(response.activity || [])].reverse().find((event) => {
    const type = event.type.toLowerCase()
    return !type.startsWith('message.final') && !type.startsWith('run.finished') && Boolean(event.label.trim())
  })
}

function cardActivityStatus(response: AgentResponse): AgentCardActivityStatus {
  const event = latestVisibleActivity(response)
  const type = event?.type.toLowerCase() || ''
  const detail = event?.label.trim() || response.progressLabel?.trim() || 'Working on the current request.'

  if (response.transport === 'command-console-queue' || type.startsWith('run.queued')) {
    return { label: 'Queued', detail, kind: 'queued' }
  }
  if (type.startsWith('approval.')) return { label: 'Needs approval', detail, kind: 'approval' }
  if (type.startsWith('tool.')) return { label: 'Using tools', detail, kind: 'working' }
  if (type.startsWith('browser.')) return { label: 'Browsing', detail, kind: 'working' }
  if (type.startsWith('file.')) return { label: 'Editing files', detail, kind: 'working' }
  if (type.startsWith('command.')) return { label: 'Running command', detail, kind: 'working' }
  if (type === 'message.partial' || type.startsWith('agent.finalizing')) return { label: 'Replying', detail, kind: 'reply' }
  if (type === 'run.model_running' || type === 'agent.working') return { label: 'Thinking', detail, kind: 'working' }
  if (type.startsWith('run.') || type.startsWith('agent.')) return { label: 'Preparing', detail, kind: 'working' }
  return { label: 'Working', detail, kind: 'working' }
}

const RARITY_ORDER: Record<AgentRarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  common: 3,
}

function agentSearchText(agent: OpenClawAgent): string {
  return [
    agent.id,
    agent.name,
    agent.className,
    agent.role,
    agent.behaviorProfile,
    agent.rarity ?? 'common',
    ...agent.unlockedSkills,
    ...agent.mds.toolAccess,
    ...agent.id.replace(/^hn-/, '').split('-'),
  ].join(' ').toLowerCase()
}

type AgentSearchIndex = {
  haystack: string
  hayWords: string[]
  tags: string[]
}

const INTENT_KEYWORDS: Record<string, string[]> = {
  money: ['money', 'finance', 'wealth', 'invest', 'investment', 'investing', 'portfolio', 'asset', 'assets', 'capital', 'income', 'cash', 'market', 'markets', 'trading', 'trade', 'crypto', 'value', 'alpha', 'quant', 'sentiment', 'technical', 'onchain', 'blockchain', 'buffett'],
  finance: ['money', 'finance', 'wealth', 'investment', 'investing', 'portfolio', 'asset', 'capital', 'market', 'value', 'buffett'],
  wealth: ['money', 'finance', 'wealth', 'investment', 'portfolio', 'income', 'capital', 'value', 'buffett'],
  investing: ['invest', 'investment', 'investing', 'portfolio', 'value', 'market', 'wealth', 'buffett', 'capital'],
  investor: ['invest', 'investment', 'investing', 'portfolio', 'value', 'market', 'wealth', 'buffett'],
  stocks: ['market', 'markets', 'trading', 'technical', 'quant', 'portfolio', 'investment', 'value'],
  stock: ['market', 'markets', 'trading', 'technical', 'quant', 'portfolio', 'investment', 'value'],
  trade: ['trade', 'trading', 'technical', 'pattern', 'quant', 'alpha', 'market', 'crypto'],
  trading: ['trade', 'trading', 'technical', 'pattern', 'quant', 'alpha', 'market', 'crypto'],
  trader: ['trade', 'trading', 'technical', 'pattern', 'quant', 'alpha', 'market', 'crypto'],
  crypto: ['crypto', 'blockchain', 'onchain', 'on-chain', 'token', 'defi', 'alpha', 'sentiment', 'technical', 'quant', 'trading'],
  bitcoin: ['crypto', 'blockchain', 'btc', 'onchain', 'technical', 'sentiment', 'quant'],
  btc: ['crypto', 'blockchain', 'bitcoin', 'onchain', 'technical', 'sentiment', 'quant'],
  market: ['market', 'markets', 'trading', 'technical', 'sentiment', 'quant', 'investment', 'alpha'],
  markets: ['market', 'markets', 'trading', 'technical', 'sentiment', 'quant', 'investment', 'alpha'],
  alpha: ['alpha', 'crypto', 'trading', 'quant', 'sentiment', 'technical', 'market'],
  buffett: ['buffett', 'warren', 'oracle', 'omaha', 'value', 'investment', 'wealth', 'finance', 'money'],
  warrent: ['warren', 'buffett', 'oracle', 'omaha', 'value', 'investment'],
  warren: ['warren', 'buffett', 'oracle', 'omaha', 'value', 'investment'],
}

const AGENT_INTENT_TAGS: Record<string, string[]> = {
  'hn-crypto-lead': ['money', 'finance', 'trading', 'market', 'futures', 'index', 'indices', 'nasdaq', 'mnq', 'nq', 'qqq', 'ymu', 'stocks', 'equity', 'portfolio'],
  'hn-coordinator': ['strategy', 'planning', 'finance', 'market', 'coordination'],
  'hn-architect': ['architecture', 'planning', 'research', 'strategy', 'coordination'],
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = Array.from({ length: b.length + 1 }, () => 0)
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }
  return prev[b.length]
}

function normalizeSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1)
}

function expandIntentTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens)
  for (const token of tokens) {
    for (const candidate of INTENT_KEYWORDS[token] || []) expanded.add(candidate)
    for (const [key, values] of Object.entries(INTENT_KEYWORDS)) {
      if (levenshteinDistance(token, key) <= (token.length <= 5 ? 1 : 2)) {
        expanded.add(key)
        values.forEach((value) => expanded.add(value))
      }
    }
  }
  return Array.from(expanded)
}

function scoreAgentForSearch(agent: OpenClawAgent, query: string, index?: AgentSearchIndex): number {
  const tokens = normalizeSearchTokens(query)
  if (!tokens.length) return 1
  const expanded = expandIntentTokens(tokens)
  const haystack = index?.haystack ?? agentSearchText(agent)
  const hayWords = index?.hayWords ?? haystack.split(/\s+/).filter(Boolean)
  const tags = (index?.tags ?? AGENT_INTENT_TAGS[agent.id]) || []
  let score = 0

  for (const token of tokens) {
    if (haystack.includes(token)) score += 12
    if (tags.some((tag) => tag.includes(token) || token.includes(tag))) score += 16
    if (hayWords.some((word) => levenshteinDistance(token, word) <= (token.length <= 5 ? 1 : 2))) score += 8
  }

  for (const token of expanded) {
    if (haystack.includes(token)) score += 4
    if (tags.includes(token)) score += 10
  }

  if (tokens.some((token) => ['money', 'finance', 'wealth', 'investing', 'investor', 'stocks', 'stock', 'market', 'trading', 'crypto'].includes(token))) {
    if (agent.id === 'hn-crypto-lead') score += 22
  }

  return score
}

export function PartySelector() {
  const agents = useNexusStore((s) => s.agents)
  const selectedAgentIds = useNexusStore((s) => s.selectedAgentIds)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const busyAgentIds = useNexusStore((s) => s.busyAgentIds)
  const agentResponses = useNexusStore((s) => s.agentResponses)
  const activeMission = useNexusStore((s) => s.activeMission)
  // Agent cards only need the lightweight activity/run summary. Keeping the
  // full session/config/diagnostics payload out of this high-traffic surface
  // prevents the registry from waking the expensive runtime status path.
  const { status: runtimeStatus } = useRuntimeSummaryStatus(15000)
  const missionRunning = activeMission?.status === 'running'
  const registryScrollRef = useRef<HTMLDivElement | null>(null)
  const registryGridRef = useRef<HTMLDivElement | null>(null)
  const prefs = useMemo(() => readRegistryPreferences(), [])
  const [pageIndex, setPageIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [sortKey, setSortKey] = useState<SortKey>(prefs.sortKey || 'party')
  const [rarityFilter, setRarityFilter] = useState<AgentRarity | 'all'>(prefs.rarityFilter || 'all')
  const [displayMode, setDisplayMode] = useState<AgentDisplayMode>(prefs.displayMode || 'grid8')
  const [overlayPreset, setOverlayPreset] = useState<AgentOverlayPreset>(prefs.overlayPreset)
  const [rarityColorsEnabled, setRarityColorsEnabled] = useState(prefs.rarityColorsEnabled)
  const [registryColumnCount, setRegistryColumnCount] = useState(1)
  const activeDisplayMode = DISPLAY_MODES.find((mode) => mode.id === displayMode) || DISPLAY_MODES[0]
  const nominalPageSize = activeDisplayMode.pageSize
  const pageSize = useMemo(() => {
    if (!FLOW_GRID_MODES.has(displayMode)) return nominalPageSize
    const columns = Math.max(1, registryColumnCount)
    const minimumRows = columns >= nominalPageSize ? 2 : 1
    const rows = Math.max(minimumRows, Math.ceil(nominalPageSize / columns))
    return Math.max(nominalPageSize, columns * rows)
  }, [displayMode, nominalPageSize, registryColumnCount])
  const activePartySet = useMemo(() => new Set(activePartyIds), [activePartyIds])
  const activePartyOrder = useMemo(
    () => new Map(activePartyIds.map((agentId, slotIndex) => [agentId, slotIndex])),
    [activePartyIds],
  )
  const selectedAgentSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds])
  const validSelectedAgentCount = useMemo(
    () => selectedAgentIds.filter((agentId) => agents.some((agent) => agent.id === agentId)).length,
    [agents, selectedAgentIds],
  )
  const busyAgentSet = useMemo(() => new Set([
    ...busyAgentIds,
    ...activeExternalChannelAgentIds(runtimeStatus),
  ]), [busyAgentIds, runtimeStatus])
  const activityStatusByAgent = useMemo(() => {
    const next = new Map<string, AgentCardActivityStatus>()
    for (const response of agentResponses) {
      if (!response.streaming || next.has(response.agentId)) continue
      next.set(response.agentId, cardActivityStatus(response))
    }
    return next
  }, [agentResponses])
  const searchIndex = useMemo(() => new Map(agents.map((agent) => {
    const haystack = agentSearchText(agent)
    return [agent.id, {
      haystack,
      hayWords: haystack.split(/\s+/).filter(Boolean),
      tags: AGENT_INTENT_TAGS[agent.id] || [],
    } satisfies AgentSearchIndex]
  })), [agents])

  const filtered = useMemo(() => {
    let list = [...agents]
    const searchScores = new Map<string, number>()
    const query = deferredSearchQuery.trim()

    // Search — intent-aware weighted matching with typo tolerance.
    if (query) {
      list = list
        .map((agent) => {
          const score = scoreAgentForSearch(agent, query, searchIndex.get(agent.id))
          searchScores.set(agent.id, score)
          return agent
        })
        .filter((agent) => (searchScores.get(agent.id) || 0) > 0)
    }

    // Rarity filter
    if (rarityFilter !== 'all') {
      list = list.filter((a) => (a.rarity ?? 'common') === rarityFilter)
    }

    // Sort
    list.sort((a, b) => {
      const aPartySlot = activePartyOrder.get(a.id)
      const bPartySlot = activePartyOrder.get(b.id)
      if (sortKey === 'party') {
        const aIn = aPartySlot === undefined ? 1 : 0
        const bIn = bPartySlot === undefined ? 1 : 0
        if (aIn !== bIn) return aIn - bIn
        if (aPartySlot !== undefined && bPartySlot !== undefined) return aPartySlot - bPartySlot
      }
      if (query) {
        const scoreDelta = (searchScores.get(b.id) || 0) - (searchScores.get(a.id) || 0)
        if (scoreDelta !== 0) return scoreDelta
      }
      switch (sortKey) {
        case 'party':
          return (b.level || 1) - (a.level || 1)
        case 'level':
          return (b.level || 1) - (a.level || 1)
        case 'name':
          return a.name.localeCompare(b.name)
        case 'rarity':
          return (RARITY_ORDER[a.rarity ?? 'common'] ?? 99) - (RARITY_ORDER[b.rarity ?? 'common'] ?? 99)
        default:
          return 0
      }
    })
    return list
  }, [activePartyOrder, agents, deferredSearchQuery, rarityFilter, searchIndex, sortKey])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(pageIndex, totalPages - 1)
  const visibleAgents = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, pageSize, safePage],
  )
  const agentCountLabel = filtered.length === agents.length
    ? `${filtered.length} agents`
    : `${filtered.length}/${agents.length} agents`

  useEffect(() => {
    saveRegistryPreferences({ displayMode, overlayPreset, rarityColorsEnabled, rarityFilter, sortKey })
  }, [displayMode, overlayPreset, rarityColorsEnabled, rarityFilter, sortKey])

  useEffect(() => {
    const syncPreferences = (event?: Event) => {
      const next = event instanceof CustomEvent
        ? event.detail as RegistryPreferences
        : readRegistryPreferences()
      setDisplayMode(next.displayMode || DEFAULT_REGISTRY_PREFERENCES.displayMode)
      setOverlayPreset(next.overlayPreset || DEFAULT_REGISTRY_PREFERENCES.overlayPreset)
      setRarityColorsEnabled(next.rarityColorsEnabled ?? DEFAULT_REGISTRY_PREFERENCES.rarityColorsEnabled)
      setRarityFilter(next.rarityFilter || DEFAULT_REGISTRY_PREFERENCES.rarityFilter)
      setSortKey(next.sortKey || DEFAULT_REGISTRY_PREFERENCES.sortKey)
    }
    window.addEventListener(REGISTRY_PREFS_CHANGED_EVENT, syncPreferences)
    window.addEventListener('storage', syncPreferences)
    return () => {
      window.removeEventListener(REGISTRY_PREFS_CHANGED_EVENT, syncPreferences)
      window.removeEventListener('storage', syncPreferences)
    }
  }, [])

  useLayoutEffect(() => {
    applyRegistryCardTheme({ overlayPreset, rarityColorsEnabled })
  }, [overlayPreset, rarityColorsEnabled])

  useEffect(() => {
    if (!FLOW_GRID_MODES.has(displayMode)) {
      return
    }

    const element = registryGridRef.current
    if (!element) return

    const updateColumnCount = () => {
      const nextColumnCount = countRenderedGridColumns(element)
      setRegistryColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount))
    }

    let frameId = 0
    const scheduleColumnCountUpdate = () => {
      if (frameId) return
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        updateColumnCount()
      })
    }
    scheduleColumnCountUpdate()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleColumnCountUpdate)
      return () => {
        if (frameId) window.cancelAnimationFrame(frameId)
        window.removeEventListener('resize', scheduleColumnCountUpdate)
      }
    }

    const observer = new ResizeObserver(scheduleColumnCountUpdate)
    observer.observe(element)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [displayMode, filtered.length])

  // Reset to page 0 when the result set changes; display-size changes keep the current page.
  useEffect(() => {
    const timer = window.setTimeout(() => setPageIndex(0), 0)
    return () => window.clearTimeout(timer)
  }, [searchQuery, sortKey, rarityFilter])
  useEffect(() => {
    if (registryScrollRef.current) registryScrollRef.current.scrollTop = 0
  }, [safePage, searchQuery, sortKey, rarityFilter, displayMode])
  useEffect(() => {
    if (pageIndex < totalPages) return
    const timer = window.setTimeout(() => setPageIndex(Math.max(0, totalPages - 1)), 0)
    return () => window.clearTimeout(timer)
  }, [totalPages, pageIndex])

  return (
    <div
      className="min-h-0"
      data-agent-card-theme={rarityColorsEnabled ? 'rarity' : overlayPreset}
      data-agent-card-rarity-colors={rarityColorsEnabled ? 'enabled' : 'disabled'}
    >
      <Panel
        title="Agent Registry"
        className="flex min-h-0 flex-col"
        action={
          <div className="agent-registry-pager flex translate-y-2 items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous page"
              disabled={safePage <= 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              className="agent-registry-pager-btn inline-flex size-7 items-center justify-center rounded-lg border border-[#4cb5d1]/28 bg-[#08090c] text-xs text-cyan-200 transition hover:border-[#4cb5d1]/55 hover:bg-[#08090c] disabled:cursor-not-allowed disabled:opacity-25"
            >
              ◂
            </button>
            <span className="agent-registry-pager-count rounded-lg border border-[#4cb5d1]/28 bg-[#08090c] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100 tabular-nums">
              {agentCountLabel}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
              className="agent-registry-pager-btn inline-flex size-7 items-center justify-center rounded-lg border border-[#4cb5d1]/28 bg-[#08090c] text-xs text-cyan-200 transition hover:border-[#4cb5d1]/55 hover:bg-[#08090c] disabled:cursor-not-allowed disabled:opacity-25"
            >
              ▸
            </button>
          </div>
        }
      >
        {/* ── Search + Sort + Filter toolbar ── */}
        <div data-agent-filter-toolbar className="mb-4">
          {/* Transparent search bar */}
          <div data-agent-filter-search className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              aria-label="Search agents"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, role, keyword…"
              spellCheck={false}
              className="w-full py-2 pl-9 pr-8 text-[11px] font-medium outline-none transition"
            />
            {searchQuery && (
              <button type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cyan-300 hover:text-cyan-100 text-xs leading-none"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Sort + Rarity filter row */}
          <div data-agent-filter-controls className="flex items-center gap-2 flex-wrap">
            <select
              data-agent-filter-select
              aria-label="Sort agents"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2.5 py-1.5 pr-7 text-[10px] font-semibold outline-none transition cursor-pointer appearance-none"
              style={CYAN_SELECT_CHEVRON_STYLE}
            >
              <option value="party">Party First</option>
              <option value="level">Level ↓</option>
              <option value="name">A–Z</option>
              <option value="rarity">Rarity</option>
            </select>

            <select
              data-agent-filter-select
              aria-label="Filter agents by rarity"
              value={rarityFilter}
              onChange={(e) => setRarityFilter(e.target.value as AgentRarity | 'all')}
              className="px-2.5 py-1.5 pr-7 text-[10px] font-semibold outline-none transition cursor-pointer appearance-none"
              style={CYAN_SELECT_CHEVRON_STYLE}
            >
              <option value="all">All rarities</option>
              <option value="legendary">Legendary</option>
              <option value="epic">Epic</option>
              <option value="rare">Rare</option>
              <option value="common">Common</option>
            </select>

            <div data-agent-view-switch className="flex">
              {DISPLAY_MODES.map((mode) => (
                <button
                  key={mode.id}
                  data-agent-view-choice
                  data-active={displayMode === mode.id ? 'true' : undefined}
                  type="button"
                  title={mode.hint}
                  onClick={() => setDisplayMode(mode.id)}
                  className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.10em] transition ${
                    displayMode === mode.id
                      ? 'text-cyan-100'
                      : 'text-cyan-300/85 hover:text-cyan-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {!rarityColorsEnabled && (
              <select
                data-agent-filter-select
                data-agent-overlay-control
                aria-label="Card background theme"
                value={overlayPreset}
                onChange={(e) => setOverlayPreset(e.target.value as AgentOverlayPreset)}
                className="px-2.5 py-1.5 pr-7 text-[10px] font-semibold outline-none transition cursor-pointer appearance-none"
                style={CYAN_SELECT_CHEVRON_STYLE}
              >
                {OVERLAY_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            )}

          </div>
        </div>

        {/* Status line */}
        <p data-agent-status className="mb-3 text-[10px] font-medium text-cyan-300/80 tracking-[0.02em]">
          {searchQuery ? (
            <>
              {filtered.length} match{filtered.length !== 1 ? 'es' : ''} for "{searchQuery}"
            </>
          ) : (
            <>
              {rarityFilter !== 'all' && <>{filtered.length}/{agents.length} shown · </>}
            </>
          )}
          <span data-agent-selection-status className="ml-2 text-cyan-100/60">
            {validSelectedAgentCount
              ? `${validSelectedAgentCount} selected for Agent Chat`
              : 'Select agents with Chat to address them directly.'}
          </span>
        </p>

        {/* Empty state */}
        {filtered.length === 0 ? (
          <div className="grid h-32 place-items-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.01]">
            <p className="text-[11px] font-medium text-slate-600">No agents match your search</p>
          </div>
        ) : (
          <div
            ref={registryScrollRef}
            data-agent-registry-scroll
            className="-m-2 min-h-0 overflow-y-auto overflow-x-hidden p-2"
            style={{
              height: 'min(78vh, max(560px, calc(100vh - 260px)))',
              maxHeight: 'min(78vh, max(560px, calc(100vh - 260px)))',
              scrollbarGutter: 'stable',
            }}
          >
            <div ref={registryGridRef} className={gridClassByMode[displayMode]} data-agent-grid-mode={displayMode}>
              {visibleAgents.map((agent) => {
                const inParty = activePartySet.has(agent.id)
                const slotNumber = inParty ? activePartyIds.indexOf(agent.id) + 1 : null
                return (
                  <div
                    key={agent.id}
                    className={`dy-agent-card-entry ${missionRunning && !inParty ? 'pointer-events-none opacity-30' : ''}`}
                  >
                    <AgentCard
                      agent={agent}
                      isSelected={selectedAgentSet.has(agent.id)}
                      inParty={inParty}
                      slotNumber={slotNumber}
                      partyIndex={inParty && slotNumber ? slotNumber - 1 : null}
                      isBusy={busyAgentSet.has(agent.id)}
                      activityStatus={activityStatusByAgent.get(agent.id)}
                      missionRunning={missionRunning}
                      cardTheme={resolveAgentCardTheme(agent.rarity, { overlayPreset, rarityColorsEnabled })}
                      displayMode={displayMode}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}

import { motion } from 'framer-motion'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AgentCard } from './AgentCard'
import { Panel } from '../common/Panel'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentRarity, OpenClawAgent } from '../../types/nexus'

type SortKey = 'party' | 'level' | 'name' | 'rarity'
type AgentDisplayMode = 'showcase' | 'grid6' | 'grid8' | 'grid10' | 'list'
type AgentOverlayPreset = 'rarity' | 'original' | 'graphite-glass' | 'anime-sky' | 'neon-city' | 'cloud-horizon' | 'blueprint-grid' | 'aurora-mesh' | 'tactical-map' | 'silver-lines' | 'studio-noir'
type PersistedRegistryPrefs = { displayMode?: AgentDisplayMode; overlayPreset?: AgentOverlayPreset; overlayPresetVersion?: number; rarityFilter?: AgentRarity | 'all'; sortKey?: SortKey }
type DisplayModeConfig = { id: AgentDisplayMode; label: string; pageSize: number; hint: string }
type OverlayPresetConfig = { id: AgentOverlayPreset; label: string; hint: string }

const DISPLAY_MODES: DisplayModeConfig[] = [
  { id: 'showcase', label: 'Showcase', pageSize: 6, hint: 'large cards' },
  { id: 'grid6', label: '6 Grid', pageSize: 6, hint: 'balanced' },
  { id: 'grid8', label: '9 Grid', pageSize: 9, hint: 'more agents' },
  { id: 'grid10', label: '12 Grid', pageSize: 12, hint: 'dense' },
  { id: 'list', label: 'List', pageSize: 12, hint: 'scan rows' },
]

const OVERLAY_PRESETS: OverlayPresetConfig[] = [
  { id: 'rarity', label: 'By Rarity', hint: 'rarity card skins' },
  { id: 'original', label: 'Original', hint: 'cyber circuit' },
  { id: 'graphite-glass', label: 'Graphite', hint: 'clean modern glass' },
  { id: 'anime-sky', label: 'Anime Sky', hint: 'soft open sky' },
  { id: 'neon-city', label: 'Neon City', hint: 'night city glow' },
  { id: 'cloud-horizon', label: 'Horizon', hint: 'quiet clouds' },
  { id: 'blueprint-grid', label: 'Blueprint', hint: 'technical grid' },
  { id: 'aurora-mesh', label: 'Aurora', hint: 'soft mesh wave' },
  { id: 'tactical-map', label: 'Tactical', hint: 'stone map texture' },
  { id: 'silver-lines', label: 'Silver', hint: 'minimal data lines' },
  { id: 'studio-noir', label: 'Noir', hint: 'warm studio shadow' },
]

const gridClassByMode: Record<AgentDisplayMode, string> = {
  showcase: 'agent-card-registry-grid agent-card-registry-grid--showcase',
  grid6: 'agent-card-registry-grid agent-card-registry-grid--grid6',
  grid8: 'agent-card-registry-grid agent-card-registry-grid--grid8',
  grid10: 'agent-card-registry-grid agent-card-registry-grid--grid10',
  list: 'grid grid-cols-1 gap-2',
}

const FLOW_GRID_MODES = new Set<AgentDisplayMode>(['showcase', 'grid6', 'grid8', 'grid10'])
const REGISTRY_PREFS_KEY = 'dystopai-agent-registry-prefs'
const REGISTRY_PREFS_VERSION = 4
const CYAN_SELECT_CHEVRON_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%2367e8f9' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
} as const

function loadRegistryPrefs(): PersistedRegistryPrefs {
  try {
    const raw = window.localStorage.getItem(REGISTRY_PREFS_KEY)
    const prefs = raw ? JSON.parse(raw) as PersistedRegistryPrefs : {}
    return { ...prefs, overlayPreset: 'rarity', rarityFilter: 'all' }
  } catch {
    return { overlayPreset: 'rarity' }
  }
}

function countRenderedGridColumns(element: HTMLElement | null): number {
  if (!element) return 1
  const columns = window.getComputedStyle(element).gridTemplateColumns
  if (!columns || columns === 'none') return 1
  return Math.max(1, columns.split(' ').filter(Boolean).length)
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
  'hn-buffett': ['money', 'finance', 'wealth', 'investing', 'investment', 'portfolio', 'value', 'market', 'capital', 'stocks', 'stock', 'buffett', 'warren'],
  'hn-crypto-lead': ['money', 'finance', 'crypto', 'trading', 'market', 'alpha', 'token', 'defi', 'portfolio'],
  'hn-crypto-technical': ['crypto', 'trading', 'technical', 'charts', 'patterns', 'market', 'alpha', 'trade', 'stocks'],
  'hn-crypto-onchain': ['crypto', 'blockchain', 'onchain', 'wallet', 'token', 'forensics', 'market', 'alpha'],
  'hn-crypto-quant': ['crypto', 'trading', 'quant', 'statistics', 'risk', 'modeling', 'market', 'alpha', 'finance'],
  'hn-crypto-sentiment': ['crypto', 'trading', 'sentiment', 'social', 'narrative', 'market', 'alpha'],
  'hn-netanyahu': ['strategy', 'geopolitics', 'risk', 'market', 'macro'],
  'hn-coordinator': ['strategy', 'planning', 'finance', 'market', 'coordination'],
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
    if (agent.id === 'hn-buffett') score += 30
    if (agent.id.startsWith('hn-crypto-')) score += 22
  }

  return score
}

export function PartySelector() {
  const agents = useNexusStore((s) => s.agents)
  const selectedAgentIds = useNexusStore((s) => s.selectedAgentIds)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const busyAgentIds = useNexusStore((s) => s.busyAgentIds)
  const activeMission = useNexusStore((s) => s.activeMission)
  const missionRunning = activeMission?.status === 'running'
  const registryScrollRef = useRef<HTMLDivElement | null>(null)
  const registryGridRef = useRef<HTMLDivElement | null>(null)
  const prefs = useMemo(() => loadRegistryPrefs(), [])
  const [pageIndex, setPageIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [sortKey, setSortKey] = useState<SortKey>(prefs.sortKey || 'party')
  const [rarityFilter, setRarityFilter] = useState<AgentRarity | 'all'>(prefs.rarityFilter || 'all')
  const [displayMode, setDisplayMode] = useState<AgentDisplayMode>(prefs.displayMode || 'grid8')
  const [overlayPreset, setOverlayPreset] = useState<AgentOverlayPreset>(prefs.overlayPreset || 'graphite-glass')
  const [registryColumnCount, setRegistryColumnCount] = useState(1)
  const activeDisplayMode = DISPLAY_MODES.find((mode) => mode.id === displayMode) || DISPLAY_MODES[1]
  const nominalPageSize = activeDisplayMode.pageSize
  const pageSize = useMemo(() => {
    if (!FLOW_GRID_MODES.has(displayMode)) return nominalPageSize
    const columns = Math.max(1, registryColumnCount)
    const minimumRows = columns >= nominalPageSize ? 2 : 1
    const rows = Math.max(minimumRows, Math.ceil(nominalPageSize / columns))
    return Math.max(nominalPageSize, columns * rows)
  }, [displayMode, nominalPageSize, registryColumnCount])
  const activePartySet = useMemo(() => new Set(activePartyIds), [activePartyIds])
  const selectedAgentSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds])
  const busyAgentSet = useMemo(() => new Set(busyAgentIds), [busyAgentIds])
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
      if (query) {
        const scoreDelta = (searchScores.get(b.id) || 0) - (searchScores.get(a.id) || 0)
        if (scoreDelta !== 0) return scoreDelta
      }
      switch (sortKey) {
        case 'party': {
          const aIn = activePartySet.has(a.id) ? 0 : 1
          const bIn = activePartySet.has(b.id) ? 0 : 1
          if (aIn !== bIn) return aIn - bIn
          return (b.level || 1) - (a.level || 1)
        }
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
  }, [activePartySet, agents, deferredSearchQuery, rarityFilter, searchIndex, sortKey])

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
    window.localStorage.setItem(REGISTRY_PREFS_KEY, JSON.stringify({ displayMode, overlayPreset, overlayPresetVersion: REGISTRY_PREFS_VERSION, sortKey }))
  }, [displayMode, overlayPreset, sortKey])

  useEffect(() => {
    document.documentElement.dataset.agentCardOverlay = overlayPreset
    return () => {
      delete document.documentElement.dataset.agentCardOverlay
    }
  }, [overlayPreset])

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

    const frameId = window.requestAnimationFrame(updateColumnCount)

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateColumnCount)
      return () => {
        window.cancelAnimationFrame(frameId)
        window.removeEventListener('resize', updateColumnCount)
      }
    }

    const observer = new ResizeObserver(updateColumnCount)
    observer.observe(element)
    return () => {
      window.cancelAnimationFrame(frameId)
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
    <div className="min-h-0">
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
        <div data-agent-toolbar className="mb-4 rounded-2xl border border-[#4cb5d1]/34 bg-[#08090c] p-3 text-cyan-300 shadow-inner">
          {/* Transparent search bar */}
          <div data-agent-search className="relative">
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
              className="w-full rounded-lg border border-[#4cb5d1]/28 bg-[#08090c] py-2 pl-9 pr-8 text-[11px] font-medium text-cyan-100 placeholder:text-cyan-300/80 outline-none transition focus:border-[#4cb5d1]/60 focus:bg-[#08090c]"
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
          <div data-agent-controls className="flex items-center gap-2 flex-wrap">
            <select
              data-agent-control
              aria-label="Sort agents"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-[#4cb5d1]/30 bg-[#08090c] px-2.5 py-1.5 pr-7 text-[10px] font-semibold text-cyan-100 outline-none transition focus:border-[#4cb5d1]/60 cursor-pointer appearance-none"
              style={CYAN_SELECT_CHEVRON_STYLE}
            >
              <option value="party">Party First</option>
              <option value="level">Level ↓</option>
              <option value="name">A–Z</option>
              <option value="rarity">Rarity</option>
            </select>

            <select
              data-agent-control
              aria-label="Filter agents by rarity"
              value={rarityFilter}
              onChange={(e) => setRarityFilter(e.target.value as AgentRarity | 'all')}
              className="rounded-lg border border-[#4cb5d1]/30 bg-[#08090c] px-2.5 py-1.5 pr-7 text-[10px] font-semibold text-cyan-100 outline-none transition focus:border-[#4cb5d1]/60 cursor-pointer appearance-none"
              style={CYAN_SELECT_CHEVRON_STYLE}
            >
              <option value="all">All rarities</option>
              <option value="legendary">Legendary</option>
              <option value="epic">Epic</option>
              <option value="rare">Rare</option>
              <option value="common">Common</option>
            </select>

            <div data-agent-view-toggle className="flex rounded-lg border border-[#4cb5d1]/34 bg-[#08090c] p-0.5">
              {DISPLAY_MODES.map((mode) => (
                <button
                  key={mode.id}
                  data-agent-view-option
                  data-active={displayMode === mode.id ? 'true' : undefined}
                  type="button"
                  title={mode.hint}
                  onClick={() => setDisplayMode(mode.id)}
                  className={`rounded-md px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.10em] transition ${
                    displayMode === mode.id
                      ? 'bg-[#08090c] text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'text-cyan-300/85 hover:bg-[#08090c] hover:text-cyan-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <select
              data-agent-overlay-control
              aria-label="Card overlay style"
              value={overlayPreset}
              onChange={(e) => setOverlayPreset(e.target.value as AgentOverlayPreset)}
              className="rounded-lg border border-[#4cb5d1]/30 bg-[#08090c] px-2.5 py-1.5 pr-7 text-[10px] font-semibold text-cyan-100 outline-none transition focus:border-[#4cb5d1]/60 cursor-pointer appearance-none"
              style={CYAN_SELECT_CHEVRON_STYLE}
            >
              {OVERLAY_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>

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
                  <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.12 }}
                    className={missionRunning && !inParty ? 'pointer-events-none opacity-30' : ''}
                  >
                    <AgentCard
                      agent={agent}
                      isSelected={selectedAgentSet.has(agent.id)}
                      inParty={inParty}
                      slotNumber={slotNumber}
                      partyIndex={inParty && slotNumber ? slotNumber - 1 : null}
                      isBusy={busyAgentSet.has(agent.id)}
                      missionRunning={missionRunning}
                      displayMode={displayMode}
                    />
                  </motion.div>
                )
              })}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}


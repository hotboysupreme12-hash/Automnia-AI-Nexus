import { RuntimeComposer } from '../engine/RuntimeComposer'
import { makeSeedAgents } from '../data/seeds'
import type { OpenClawAgent } from '../types/nexus'

export const MAX_PARTY_SIZE = 6

const DEFAULT_TEMPLATE_AGENT_ID = 'hn-coordinator'
const DEFAULT_ACTIVE_PARTY_IDS = [
  'hn-architect',
  'hn-coordinator',
  'hn-crypto-lead',
]
export const LEGACY_DEFAULT_PARTY_IDS = [
  'hn-netanyahu',
  'hn-commander',
  'hn-coordinator',
  'hn-builder',
  'hn-reviewer',
]
const MAX_PERSISTED_PORTRAIT_LENGTH = 2048

const BUILTIN_RETIRED_AGENT_IDS = new Set([
  'recruit-check-mps3678p',
  'no-such-agent',
  'hn-builder',
  'hn-commander',
  'hn-reviewer',
  'hn-fullstack',
  'hn-netanyahu',
  'hn-crypto-technical',
  'hn-crypto-onchain',
  'hn-crypto-quant',
  'hn-crypto-sentiment',
  'hn-buffett',
  'hn-devops',
  'hn-security',
  'hn-testing',
  'hn-ux',
  'hn-franklin',
  'hn-trump',
])
const RETIRED_AGENT_IDS = new Set(BUILTIN_RETIRED_AGENT_IDS)

const DEFAULT_AGENT_PORTRAIT_SUFFIXES: Record<string, string[]> = {
  'hn-architect': ['agents/elena-vasquez.svg', 'agents/generated/elena-vasquez.jpg'],
  'hn-coordinator': ['agents/sarah-cooper.jpg', 'agents/generated/sarah-cooper.jpg'],
  'hn-crypto-lead': ['agents/marcus-chen.jpg', 'agents/generated/marcus-chen.jpg'],
}

export interface NexusAgentConfigState {
  agents: OpenClawAgent[]
  retiredAgentIds: string[]
  activePartyIds: string[]
  confirmedPartyIds: string[]
}

export function withComputedRuntime(agent: OpenClawAgent): OpenClawAgent {
  const preview = RuntimeComposer.compose(agent)
  return { ...agent, runtime: { ...preview, ...agent.runtime } }
}

export function updateAgentInList(
  agents: OpenClawAgent[],
  agentId: string,
  updater: (agent: OpenClawAgent) => OpenClawAgent,
): OpenClawAgent[] {
  return agents.map((agent) => (agent.id === agentId ? withComputedRuntime(updater(agent)) : agent))
}

function normalizeRetiredAgentId(agentId: string | undefined): string {
  return agentId?.trim().toLowerCase() || ''
}

export function rememberRetiredAgentIds(ids: unknown): string[] {
  const input = Array.isArray(ids) ? ids : []
  for (const rawId of input) {
    if (typeof rawId !== 'string') continue
    const id = normalizeRetiredAgentId(rawId)
    if (/^[a-z0-9-]+$/.test(id)) RETIRED_AGENT_IDS.add(id)
  }
  return retiredAgentIdsForStore()
}

export function rememberRetiredAgentId(agentId: string): string[] {
  const id = normalizeRetiredAgentId(agentId)
  if (/^[a-z0-9-]+$/.test(id)) RETIRED_AGENT_IDS.add(id)
  return retiredAgentIdsForStore()
}

export function retiredAgentIdsForStore(): string[] {
  return [...RETIRED_AGENT_IDS]
    .filter((id) => !BUILTIN_RETIRED_AGENT_IDS.has(id))
    .sort((a, b) => a.localeCompare(b))
}

export function isRetiredAgentId(agentId: string | undefined): boolean {
  const id = normalizeRetiredAgentId(agentId)
  return Boolean(id && RETIRED_AGENT_IDS.has(id))
}

let seedCache: OpenClawAgent[] | null = null
export function getSeedAgents(): OpenClawAgent[] {
  if (!seedCache) seedCache = makeSeedAgents().filter((agent) => !isRetiredAgentId(agent.id))
  return seedCache
}

export function resolveDefaultTemplateAgentId(agents: OpenClawAgent[]): string | null {
  const selectableAgents = agents.filter((agent) => !isRetiredAgentId(agent.id))
  if (selectableAgents.some((agent) => agent.id === DEFAULT_TEMPLATE_AGENT_ID)) return DEFAULT_TEMPLATE_AGENT_ID
  return selectableAgents[0]?.id ?? null
}

export function getDefaultTemplateAgent(): OpenClawAgent {
  const agents = getSeedAgents()
  const defaultId = resolveDefaultTemplateAgentId(agents)
  return agents.find((agent) => agent.id === defaultId) ?? agents[0]!
}

export function makeDefaultParty(agents: OpenClawAgent[]): string[] {
  const validIds = new Set(agents.map((agent) => agent.id).filter((id) => !isRetiredAgentId(id)))
  const preferred = DEFAULT_ACTIVE_PARTY_IDS.filter((id) => validIds.has(id))
  const preferredIds = new Set(preferred)
  const fillers = agents
    .map((agent) => agent.id)
    .filter((id) => validIds.has(id) && !preferredIds.has(id))
  const fallback = agents
    .map((agent) => agent.id)
    .filter((id) => validIds.has(id) && !preferredIds.has(id) && !fillers.includes(id))
  return [...preferred, ...fillers, ...fallback].slice(0, MAX_PARTY_SIZE)
}

export function sameOrderedIds(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((id, index) => id === right[index])
}

export function sanitizePartyIds(ids: unknown, agents: OpenClawAgent[]): string[] {
  if (!Array.isArray(ids)) return makeDefaultParty(agents)
  const validIds = new Set(agents.map((agent) => agent.id).filter((id) => !isRetiredAgentId(id)))
  const next: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !validIds.has(id) || next.includes(id)) continue
    next.push(id)
    if (next.length >= MAX_PARTY_SIZE) break
  }
  return next
}

export function isDefaultAgentPortrait(agentId: string, portrait: string | undefined): boolean {
  if (!portrait?.trim()) return false
  const normalized = portrait.trim().replace(/\\/g, '/').replace(/^https?:\/\/[^/]+/i, '')
  return Boolean(DEFAULT_AGENT_PORTRAIT_SUFFIXES[agentId]?.some((suffix) => normalized.endsWith(suffix)))
}

export function isUsablePortrait(value: string | undefined): value is string {
  if (!value?.trim()) return false
  if (value.startsWith('data:')) return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(value)
  return true
}

function isPersistablePortrait(value: string | undefined): value is string {
  if (!isUsablePortrait(value)) return false
  const portrait = value.trim()
  if (/^(data|blob):/i.test(portrait)) return false
  return portrait.length <= MAX_PERSISTED_PORTRAIT_LENGTH
}

function clampPercent(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(99, Math.max(1, Math.round(value as number)))
}

export function sanitizeAgentForStore(agent: OpenClawAgent): OpenClawAgent {
  const pct = (value: number, fallback: number) => clampPercent(value, fallback)
  const seedPortrait = getSeedAgents().find((seed) => seed.id === agent.id)?.portrait || ''
  return withComputedRuntime({
    ...agent,
    portrait: isUsablePortrait(agent.portrait)
      ? agent.portrait
      : isUsablePortrait(seedPortrait)
        ? seedPortrait
        : '',
    performance: {
      ...agent.performance,
      xp: Math.max(0, Math.round(agent.performance.xp || 0)),
      completedMissions: Math.max(0, Math.round(agent.performance.completedMissions || 0)),
      failedMissions: Math.max(0, Math.round(agent.performance.failedMissions || 0)),
      efficiencyAverage: pct(agent.performance.efficiencyAverage, 70),
      heartbeatStability: pct(agent.performance.heartbeatStability, 70),
      runtimeEfficiency: pct(agent.performance.runtimeEfficiency, 70),
      errors: Math.min(99, Math.max(0, Math.round(agent.performance.errors || 0))),
    },
  })
}

export function sanitizeAgentForPersistentStore(agent: OpenClawAgent): OpenClawAgent {
  const sanitized = sanitizeAgentForStore(agent)
  const seedPortrait = getSeedAgents().find((seed) => seed.id === agent.id)?.portrait || ''
  return {
    ...sanitized,
    portrait: isPersistablePortrait(sanitized.portrait)
      ? sanitized.portrait
      : isPersistablePortrait(seedPortrait)
        ? seedPortrait
        : '',
  }
}

export function makeAgentConfigState(): NexusAgentConfigState {
  const agents = getSeedAgents().filter((agent) => !isRetiredAgentId(agent.id)).map(withComputedRuntime)
  const party = makeDefaultParty(agents)
  return {
    agents,
    retiredAgentIds: retiredAgentIdsForStore(),
    activePartyIds: party,
    confirmedPartyIds: party,
  }
}

export function mergeAgentConfigState(data: Partial<NexusAgentConfigState>): NexusAgentConfigState {
  rememberRetiredAgentIds(data.retiredAgentIds)
  const seedAgents = getSeedAgents()
  const seedIds = new Set(seedAgents.map((seed) => seed.id))
  const persistedAgents = (data.agents || []).filter((agent) => !isRetiredAgentId(agent.id))
  const agents = [
    ...seedAgents.map((seed) => {
      const existing = persistedAgents.find((agent: OpenClawAgent) => agent.id === seed.id)
      if (!existing) return seed
      const keepSeedPortrait = isDefaultAgentPortrait(seed.id, existing.portrait)
      return sanitizeAgentForStore({ ...seed, ...existing, portrait: keepSeedPortrait ? seed.portrait : existing.portrait })
    }),
    ...persistedAgents.filter((agent: OpenClawAgent) => !seedIds.has(agent.id)).map(sanitizeAgentForStore),
  ].map(sanitizeAgentForStore).filter((agent) => !isRetiredAgentId(agent.id))

  return {
    agents,
    retiredAgentIds: retiredAgentIdsForStore(),
    activePartyIds: sameOrderedIds(data.activePartyIds, LEGACY_DEFAULT_PARTY_IDS)
      ? makeDefaultParty(agents)
      : sanitizePartyIds(data.activePartyIds, agents),
    confirmedPartyIds: sameOrderedIds(data.confirmedPartyIds, LEGACY_DEFAULT_PARTY_IDS)
      ? makeDefaultParty(agents)
      : sanitizePartyIds(data.confirmedPartyIds, agents),
  }
}

export function partializeAgentConfigState(state: NexusAgentConfigState): NexusAgentConfigState {
  const agents = state.agents.filter((agent) => !isRetiredAgentId(agent.id)).map(sanitizeAgentForPersistentStore)
  return {
    retiredAgentIds: state.retiredAgentIds,
    agents,
    activePartyIds: sanitizePartyIds(state.activePartyIds, agents),
    confirmedPartyIds: sanitizePartyIds(state.confirmedPartyIds, agents),
  }
}

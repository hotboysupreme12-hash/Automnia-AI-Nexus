import { apiUrl } from '../utils/apiUrl'
import type {
  AgentMDS,
  AgentRuntimePolicy,
  BehaviorProfile,
  CapabilityKey,
  CoreAttributes,
  HeartbeatConfig,
  OpenClawAgent,
  SoulConfig,
} from '../types/nexus'
import { apiRequest, type ApiResult } from './client'

export type PartyOverviewAgent = {
  id: string
  isDefault?: boolean
  name?: string
  workspace?: string
  avatar?: string
  skills?: string[]
  abilities?: string[]
  tools?: string[]
  className?: string
  role?: string
  behaviorProfile?: BehaviorProfile
  level?: number
  stats?: {
    execution?: number
    reliability?: number
    speed?: number
    analysis?: number
    communication?: number
  }
  sandbox?: OpenClawAgent['sandbox']
  model?: OpenClawAgent['model']
  heartbeat?: Partial<HeartbeatConfig>
  mds?: Partial<AgentMDS>
  runtime?: AgentRuntimePolicy
  toolsPolicy?: OpenClawAgent['toolsPolicy']
}

export type PartyOverviewPayload = {
  party?: PartyOverviewAgent[]
}

export type RecruitAgentProfile = {
  className: string
  role: string
  behaviorProfile: BehaviorProfile
  level: number
  motto: string
  bio: string
  skills: string[]
  abilities: string[]
  tools: string[]
  stats: NonNullable<PartyOverviewAgent['stats']>
}

export type RecruitAgentRequest = {
  agentId: string
  name: string
  workspace?: string
  emoji?: string
  theme: BehaviorProfile
  avatar?: string
  profile: RecruitAgentProfile
  model?: OpenClawAgent['model']
  runtime?: AgentRuntimePolicy
  attributes: CoreAttributes
  mds: AgentMDS
  heartbeat: HeartbeatConfig
  soul: SoulConfig
  sandbox?: OpenClawAgent['sandbox']
  tools?: OpenClawAgent['toolsPolicy']
}

export type RecruitAgentPayload = {
  agentId?: string
}

export type RecruitAgentTemplateDocument = {
  file: string
  content: string
}

export type RecruitAgentTemplateDefaults = {
  agentId: string
  name: string
  className: string
  role: string
  behaviorProfile: BehaviorProfile
  level: number
  capabilities: Record<CapabilityKey, boolean>
  tools: string[]
}

export type RecruitAgentTemplateSummary = {
  id: string
  slug: string
  name: string
  description: string
  division: string
  divisionLabel: string
  color: string
  emoji?: string
  vibe?: string
  relativePath: string
  sourceUrl: string
  defaults: RecruitAgentTemplateDefaults
}

export type RecruitAgentTemplate = RecruitAgentTemplateSummary & {
  documents: RecruitAgentTemplateDocument[]
  sourceMarkdown: string
}

export type RecruitAgentTemplateCatalogPayload = {
  source?: {
    repository?: string
    sourceRoot?: string
    commit?: string | null
    importedAt?: string
    templateCount?: number
  }
  divisions?: Record<string, { label: string; color: string; icon?: string }>
  templates?: RecruitAgentTemplateSummary[]
}

export type RecruitAgentTemplatePayload = {
  template?: RecruitAgentTemplate
}

export type AgentConfigSavePayload = {
  ok?: boolean
  error?: string
  detail?: unknown
}

export type AgentResourceSavePayload = {
  file?: string
  resourcePath?: string
}

export function partyAvatarUrl(agentId: string): string {
  return apiUrl(`/api/party/avatar/${encodeURIComponent(agentId)}`)
}

export function fetchPartyOverview(): Promise<ApiResult<PartyOverviewPayload>> {
  return apiRequest<PartyOverviewPayload>('/api/party/overview', { timeoutMs: 20_000 })
}

export function fetchRecruitAgentTemplates(refresh = false): Promise<ApiResult<RecruitAgentTemplateCatalogPayload>> {
  const suffix = refresh ? '?refresh=1' : ''
  return apiRequest<RecruitAgentTemplateCatalogPayload>(`/api/party/recruit/templates${suffix}`, { timeoutMs: 30_000 })
}

export function fetchRecruitAgentTemplate(templateId: string): Promise<ApiResult<RecruitAgentTemplatePayload>> {
  return apiRequest<RecruitAgentTemplatePayload>(`/api/party/recruit/templates/${encodeURIComponent(templateId)}`, {
    timeoutMs: 30_000,
  })
}

export function saveAgentConfig(
  agentId: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<ApiResult<AgentConfigSavePayload>> {
  return apiRequest<AgentConfigSavePayload>(`/api/party/agent/${encodeURIComponent(agentId)}/config`, {
    method: 'POST',
    timeoutMs: options.timeoutMs ?? 18_000,
    body,
  })
}

export function recruitPartyAgent(body: RecruitAgentRequest): Promise<ApiResult<RecruitAgentPayload>> {
  return apiRequest<RecruitAgentPayload>('/api/party/recruit', {
    method: 'POST',
    timeoutMs: 120_000,
    body,
  })
}

export function saveAgentResource(
  agentId: string,
  file: string,
  content: string,
): Promise<ApiResult<AgentResourceSavePayload>> {
  return apiRequest<AgentResourceSavePayload>(`/api/party/resources/${encodeURIComponent(agentId)}/${encodeURIComponent(file)}`, {
    method: 'PUT',
    timeoutMs: 20_000,
    body: { content },
  })
}

export function retirePartyAgent(agentId: string, timeoutMs: number): Promise<ApiResult<unknown>> {
  return apiRequest(`/api/party/agent/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    timeoutMs,
  })
}

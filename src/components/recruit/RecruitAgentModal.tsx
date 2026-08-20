import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import {
  fetchRecruitAgentTemplate,
  fetchRecruitAgentTemplates,
  type RecruitAgentTemplate,
  type RecruitAgentTemplateSummary,
} from '../../api/party'
import {
  authStatusForProvider,
  fetchProviderAuthStatuses,
  saveProviderApiKey,
  safeAuthProviders,
  type AuthProviderStatus,
} from '../../api/providerAuth'
import { useNexusStore } from '../../store/nexusStore'
import type { RecruitAgentInput } from '../../store/nexusStore'
import type { BehaviorProfile, CapabilityKey, OpenClawAgent } from '../../types/nexus'
import { isSelectableModelId } from '../../utils/modelGrouping'
import { AUTOMNIA_CREDITS_MODEL_ID, isAutomniaCreditsModelId, isCreditsOnlyEntitlement } from '../../utils/licenseEntitlement'
import { agentPortraitSrc, localPortraitPathFromInput } from '../../utils/portrait'
import { ProviderAuthModal } from '../auth/ProviderAuthModal'
import { ModelPicker } from '../models/ModelPicker'
import { useLicense } from '../../context/useLicense'

type AvailableModel = {
  id: string
  alias: string
  provider: string
  name: string
}

type AutoForgeApiResponse = {
  ok?: boolean
  error?: string
  detail?: unknown
  modelId?: string
  provider?: string
  personalityDepth?: number
  files?: Array<{ file: string; content: string }>
}

const RECRUIT_LOOKUP_CACHE_MS = 5 * 60 * 1000
const MARKDOWN_HIGHLIGHT_MAX_LINES = 650
const MARKDOWN_HIGHLIGHT_MAX_CHARS = 18000

let recruitModelsCache: { value: AvailableModel[]; expiresAt: number } | null = null
let recruitModelsRequest: Promise<AvailableModel[]> | null = null
let recruitAuthProvidersCache: { value: AuthProviderStatus[]; expiresAt: number } | null = null
let recruitAuthProvidersRequest: Promise<AuthProviderStatus[]> | null = null
let recruitTemplatesCache: { value: RecruitAgentTemplateSummary[]; expiresAt: number } | null = null
let recruitTemplatesRequest: Promise<RecruitAgentTemplateSummary[]> | null = null

const isAvailableModel = (value: unknown): value is AvailableModel => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AvailableModel>
  return typeof entry.id === 'string' && typeof entry.provider === 'string'
}

const safeAvailableModels = (value: unknown): AvailableModel[] =>
  Array.isArray(value) ? value.filter(isAvailableModel).filter((model) => isSelectableModelId(model.id)) : []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const safeString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const safeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

const policyToolList = (value: string) => Array.from(new Set(
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean),
))

const safeBehaviorProfile = (value: unknown): BehaviorProfile =>
  value === 'executor' || value === 'architect' || value === 'auditor' || value === 'researcher' || value === 'hybrid'
    ? value
    : 'hybrid'

const safeCapabilityRecord = (value: unknown): Record<CapabilityKey, boolean> => {
  const entry = isRecord(value) ? value : {}
  return {
    codeGeneration: entry.codeGeneration === undefined ? true : entry.codeGeneration === true,
    planning: entry.planning === undefined ? true : entry.planning === true,
    research: entry.research === true,
    orchestration: entry.orchestration === true,
    memoryManagement: entry.memoryManagement === undefined ? true : entry.memoryManagement === true,
  }
}

const normalizeRecruitAgentTemplateSummary = (value: unknown): RecruitAgentTemplateSummary | null => {
  if (!isRecord(value)) return null
  const defaults = isRecord(value.defaults) ? value.defaults : null
  const id = safeString(value.id).trim()
  const name = safeString(value.name).trim()
  if (!id || !name) return null

  const division = safeString(value.division, 'specialized').trim() || 'specialized'
  const divisionLabel = safeString(value.divisionLabel, division).trim() || division
  const description = safeString(value.description).trim()
  const defaultsRecord = defaults || {}
  return {
    id,
    slug: safeString(value.slug, id),
    name,
    description,
    division,
    divisionLabel,
    color: safeString(value.color).trim() || '#64748b',
    ...(typeof value.emoji === 'string' ? { emoji: value.emoji } : {}),
    ...(typeof value.vibe === 'string' ? { vibe: value.vibe } : {}),
    relativePath: safeString(value.relativePath),
    sourceUrl: safeString(value.sourceUrl),
    defaults: {
      agentId: safeString(defaultsRecord.agentId, id),
      name: safeString(defaultsRecord.name, name),
      className: safeString(defaultsRecord.className, divisionLabel),
      role: safeString(defaultsRecord.role, description),
      behaviorProfile: safeBehaviorProfile(defaultsRecord.behaviorProfile),
      level: Number.isFinite(defaultsRecord.level) ? Number(defaultsRecord.level) : 22,
      capabilities: safeCapabilityRecord(defaultsRecord.capabilities),
      tools: safeStringArray(defaultsRecord.tools),
    },
  }
}

const safeRecruitAgentTemplates = (value: unknown): RecruitAgentTemplateSummary[] =>
  Array.isArray(value)
    ? value
      .map(normalizeRecruitAgentTemplateSummary)
      .filter((entry): entry is RecruitAgentTemplateSummary => Boolean(entry))
    : []

function applyDivisionCatalogColors(
  templates: RecruitAgentTemplateSummary[],
  divisions: unknown,
): RecruitAgentTemplateSummary[] {
  if (!isRecord(divisions)) return templates
  return templates.map((template) => {
    const divisionValue = divisions[template.division]
    const division = isRecord(divisionValue) ? divisionValue : null
    if (!division) return template
    const color = safeString(division.color).trim()
    const label = safeString(division.label).trim()
    return {
      ...template,
      ...(color ? { color } : {}),
      ...(label ? { divisionLabel: label } : {}),
    }
  })
}

const cachedRecruitModels = () =>
  recruitModelsCache && recruitModelsCache.expiresAt > Date.now() ? recruitModelsCache.value : null

const cachedRecruitAuthProviders = () =>
  recruitAuthProvidersCache && recruitAuthProvidersCache.expiresAt > Date.now() ? recruitAuthProvidersCache.value : null

const cachedRecruitTemplates = () =>
  recruitTemplatesCache && recruitTemplatesCache.expiresAt > Date.now() ? recruitTemplatesCache.value : null

async function loadRecruitModels() {
  const cached = cachedRecruitModels()
  if (cached) return cached
  if (recruitModelsRequest) return recruitModelsRequest

  recruitModelsRequest = apiRequest<{ models?: unknown }>('/api/models/available?background=0', { timeoutMs: 10_000 })
    .then((result) => {
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const payload = result.data
      const models = safeAvailableModels(payload.models)
      recruitModelsCache = { value: models, expiresAt: Date.now() + RECRUIT_LOOKUP_CACHE_MS }
      return models
    })
    .finally(() => {
      recruitModelsRequest = null
    })
  return recruitModelsRequest
}

async function loadRecruitAuthProviders(force = false) {
  const cached = force ? null : cachedRecruitAuthProviders()
  if (cached) return cached
  if (!force && recruitAuthProvidersRequest) return recruitAuthProvidersRequest

  recruitAuthProvidersRequest = fetchProviderAuthStatuses({
    refresh: force,
    timeoutMs: force ? 30_000 : 10_000,
  })
    .then((result) => {
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const data = result.data
      const providers = safeAuthProviders(data.providers)
      recruitAuthProvidersCache = { value: providers, expiresAt: Date.now() + RECRUIT_LOOKUP_CACHE_MS }
      return providers
    })
    .finally(() => {
      recruitAuthProvidersRequest = null
    })
  return recruitAuthProvidersRequest
}

async function loadRecruitTemplates(force = false) {
  const cached = force ? null : cachedRecruitTemplates()
  if (cached) return cached
  if (!force && recruitTemplatesRequest) return recruitTemplatesRequest

  recruitTemplatesRequest = fetchRecruitAgentTemplates(force)
    .then(async (result) => {
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const catalog = isRecord(result.data) ? result.data : {}
      let templates = applyDivisionCatalogColors(safeRecruitAgentTemplates(catalog.templates), catalog.divisions)
      if (!force && templates.length > 0 && templates.length <= 51) {
        const refreshed = await fetchRecruitAgentTemplates(true)
        if (refreshed.ok) {
          const refreshedCatalog = isRecord(refreshed.data) ? refreshed.data : {}
          const nextTemplates = applyDivisionCatalogColors(safeRecruitAgentTemplates(refreshedCatalog.templates), refreshedCatalog.divisions)
          if (nextTemplates.length > templates.length) templates = nextTemplates
        }
      }
      recruitTemplatesCache = { value: templates, expiresAt: Date.now() + RECRUIT_LOOKUP_CACHE_MS }
      return templates
    })
    .finally(() => {
      recruitTemplatesRequest = null
    })
  return recruitTemplatesRequest
}

const isOpenAiCodexSubscriptionModel = (modelId: string) => {
  const [provider = '', ...modelParts] = modelId.trim().split('/')
  const model = modelParts.join('/') || modelId.trim()
  return /^(openai|openai-codex|codex)$/i.test(provider) && /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model)
}

const BEHAVIOR_OPTIONS: Array<{
  id: BehaviorProfile
  label: string
  className: string
  role: string
  brief: string
}> = [
  {
    id: 'executor',
    label: 'Executor',
    className: 'Field Operator',
    role: 'Implementation and task execution specialist',
    brief: 'Fast delivery and verification.',
  },
  {
    id: 'architect',
    label: 'Architect',
    className: 'Systems Architect',
    role: 'Planning, scope, and delegation commander',
    brief: 'Owns structure and handoffs.',
  },
  {
    id: 'auditor',
    label: 'Auditor',
    className: 'Risk Sentinel',
    role: 'Quality, security, and regression reviewer',
    brief: 'Reviews for risk and regressions.',
  },
  {
    id: 'researcher',
    label: 'Researcher',
    className: 'Research Analyst',
    role: 'Evidence gathering and synthesis specialist',
    brief: 'Finds evidence and context.',
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    className: 'Adaptive Operator',
    role: 'Flexible support across execution and planning',
    brief: 'Balanced mixed-work lane.',
  },
]

const CAPABILITY_OPTIONS: Array<{ key: CapabilityKey; label: string; detail: string }> = [
  { key: 'codeGeneration', label: 'Code', detail: 'Patch and verify files' },
  { key: 'planning', label: 'Plan', detail: 'Break work into phases' },
  { key: 'research', label: 'Research', detail: 'Gather external context' },
  { key: 'orchestration', label: 'Command', detail: 'Coordinate handoffs' },
  { key: 'memoryManagement', label: 'Memory', detail: 'Record continuity' },
]

type RecruitSandboxMode = Exclude<NonNullable<OpenClawAgent['sandbox']>['mode'], undefined>
type RecruitSandboxScope = Exclude<NonNullable<OpenClawAgent['sandbox']>['scope'], undefined>
type RecruitFileAccess = Exclude<NonNullable<OpenClawAgent['sandbox']>['workspaceAccess'], undefined>

type RecruitPolicyDraft = {
  mode: RecruitSandboxMode
  scope: RecruitSandboxScope
  access: RecruitFileAccess
  allow: string
  deny: string
}

const DEFAULT_RECRUIT_POLICY: RecruitPolicyDraft = {
  mode: 'all',
  scope: 'agent',
  access: 'rw',
  allow: '',
  deny: '',
}

const POLICY_MODE_OPTIONS: RecruitChoiceOption[] = [
  { value: 'all', label: 'Sandbox all work', detail: 'Run every turn inside the sandbox.' },
  { value: 'non-main', label: 'Sandbox non-main', detail: 'Keep the main session outside the sandbox.' },
  { value: 'off', label: 'Sandbox off', detail: 'Use full runtime and tool access.' },
]

const POLICY_SCOPE_OPTIONS: RecruitChoiceOption[] = [
  { value: 'agent', label: 'Agent', detail: 'Isolated policy for this agent.' },
  { value: 'session', label: 'Session', detail: 'Apply restrictions per active session.' },
  { value: 'shared', label: 'Shared', detail: 'Share the policy across sessions.' },
]

const POLICY_ACCESS_OPTIONS: RecruitChoiceOption[] = [
  { value: 'rw', label: 'Read and write', detail: 'Allow the agent to update files.' },
  { value: 'ro', label: 'Read only', detail: 'Allow inspection without file changes.' },
  { value: 'none', label: 'No file access', detail: 'Block file access for this agent.' },
]

const DEFAULT_CAPABILITIES: Record<CapabilityKey, boolean> = {
  codeGeneration: true,
  planning: true,
  research: false,
  orchestration: false,
  memoryManagement: true,
}

const DEFAULT_MD_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md',
  'TOOLS.md',
  'MISSION_PROMPT.md',
]

const AGENCY_TEMPLATE_CATEGORY_ORDER = [
  'academic',
  'engineering',
  'design',
  'finance',
  'game-development',
  'gis',
  'marketing',
  'paid-media',
  'product',
  'project-management',
  'sales',
  'security',
  'testing',
  'support',
  'spatial-computing',
  'specialized',
]

const DEFAULT_RECRUIT_TEMPLATE_DIVISION = 'support'

const PERSONALITY_DEPTH_OPTIONS = [
  { value: 1, label: 'Basic', detail: 'Lean' },
  { value: 2, label: 'Guided', detail: 'Traits' },
  { value: 3, label: 'Detailed', detail: 'Voice' },
  { value: 4, label: 'Signature', detail: 'Cadence' },
  { value: 5, label: 'Max', detail: 'Full' },
]

const DEFAULT_PERSONALITY_DEPTH = 3

const TAB_INSERT = '  '

type RecruitWizardStep = 1 | 2 | 3 | 4

const RECRUIT_WIZARD_STEPS: Array<{ id: RecruitWizardStep; number: string; label: string; eyebrow: string; title: string; copy: string }> = [
  { id: 1, number: '01', label: 'Starting point', eyebrow: 'Step 1 of 4 · Choose a starting point', title: 'Start with a point of view.', copy: 'Pick a focused agency template or begin with a clean slate. You can shape every detail before the agent joins your roster.' },
  { id: 2, number: '02', label: 'Agent identity', eyebrow: 'Step 2 of 4 · Shape the agent', title: 'Give this agent a clear identity.', copy: 'A good recruit knows what they are here to do. Set the name, working style, and personality depth in one calm pass.' },
  { id: 3, number: '03', label: 'Runtime lane', eyebrow: 'Step 3 of 4 · Set the mission lane', title: 'Decide how the work gets done.', copy: 'Choose the model, agent policy, capabilities, and party placement. System defaults are always a safe starting point.' },
  { id: 4, number: '04', label: 'Operating files', eyebrow: 'Step 4 of 4 · Review and recruit', title: 'Give them a playbook.', copy: 'Review the durable markdown files that travel with this agent. Edit them directly or let Auto Forge draft a richer operating voice.' },
]

const CLASS_OPTIONS = Array.from(new Set(BEHAVIOR_OPTIONS.map((option) => option.className)))

const personalityDepthOption = (value: number) =>
  PERSONALITY_DEPTH_OPTIONS.find((option) => option.value === value) || PERSONALITY_DEPTH_OPTIONS[DEFAULT_PERSONALITY_DEPTH - 1]

const clampPersonalityDepth = (value: number) =>
  Math.min(PERSONALITY_DEPTH_OPTIONS.length, Math.max(1, Math.round(value) || DEFAULT_PERSONALITY_DEPTH))

const personalityDepthFillStyle = (value: number) => ({
  '--dy-range-value': `${((clampPersonalityDepth(value) - 1) / (PERSONALITY_DEPTH_OPTIONS.length - 1)) * 100}%`,
}) as CSSProperties

type RecruitIconName = 'identity' | 'role' | 'runtime' | 'policy' | 'capabilities' | 'markdown' | 'status' | 'rocket' | 'close' | 'add' | 'expand' | 'chevron'

function RecruitIcon({ type }: { type: RecruitIconName }) {
  if (type === 'identity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 5v14" />
        <path d="M18 5v14" />
        <path d="M4 9h5" />
        <path d="M15 9h5" />
        <path d="M9 15h6" />
        <path d="M10 7h4" />
        <path d="M8 17h8" />
      </svg>
    )
  }
  if (type === 'role') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </svg>
    )
  }
  if (type === 'runtime') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  }
  if (type === 'policy') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 19 6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    )
  }
  if (type === 'capabilities') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h5v5H5z" />
        <path d="M14 5h5v5h-5z" />
        <path d="M5 14h5v5H5z" />
        <path d="M14 14h5v5h-5z" />
      </svg>
    )
  }
  if (type === 'markdown') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M14 3v5h5" />
        <path d="M10 13h6" />
        <path d="M10 17h4" />
      </svg>
    )
  }
  if (type === 'status') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
  }
  if (type === 'rocket') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19c2-5 6-10 12-14 1.4-.9 2.6.3 1.7 1.7C14.7 12.7 9 16.8 5 19Z" />
        <path d="M12 12 5 9l2.5-2.5 6.5 1" />
        <path d="M12 12l3 7 2.5-2.5-1-6.5" />
        <path d="M6 18 3 21" />
        <path d="M16 7h.01" />
      </svg>
    )
  }
  if (type === 'close') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    )
  }
  if (type === 'add') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }
  if (type === 'chevron') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M21 16v5h-5" />
      <path d="M3 16v5h5" />
    </svg>
  )
}

function SectionTitle({ icon, label, meta }: { icon: RecruitIconName; label: string; meta?: ReactNode }) {
  return (
    <div className="dui-recruit-section-head">
      <strong>
        <span className="dui-recruit-section-icon">
          <RecruitIcon type={icon} />
        </span>
        {label}
      </strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  )
}

type RecruitChoiceOption = {
  value: string
  label: ReactNode
  detail?: ReactNode
  disabled?: boolean
}

function RecruitChoiceField({
  label,
  value,
  options,
  placeholder,
  meta,
  disabled,
  className,
  onChange,
}: {
  label: string
  value: string
  options: RecruitChoiceOption[]
  placeholder: ReactNode
  meta?: ReactNode
  disabled?: boolean
  className?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <div
      className={['dui-recruit-field', 'dui-recruit-choice-field', className || ''].filter(Boolean).join(' ')}
      data-open={open ? 'true' : 'false'}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget
        if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) setOpen(false)
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        className="dui-recruit-choice-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{selected?.label || placeholder}</strong>
        <RecruitIcon type="chevron" />
      </button>
      {meta ? <small>{meta}</small> : null}
      {open && (
        <div className="dui-recruit-choice-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value || 'empty'}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              data-active={option.value === value ? 'true' : 'false'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (option.disabled) return
                onChange(option.value)
                setOpen(false)
              }}
            >
              <strong>{option.label}</strong>
              {option.detail ? <small>{option.detail}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function renderInlineMarkdown(text: string) {
  if (!text) return null

  const parts: ReactNode[] = []
  const tokenPattern = /(`[^`]+`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\)|\b[A-Z][A-Z0-9_ -]*\.md\b)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const className = token.startsWith('`')
      ? 'dui-token-inline-code'
      : token.startsWith('[')
        ? 'dui-token-link'
        : /^[A-Z][A-Z0-9_ -]*\.md$/.test(token)
          ? 'dui-token-file-ref'
          : 'dui-token-emphasis'
    parts.push(<span key={`${match.index}-${token}`} className={className}>{token}</span>)
    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length ? parts : text
}

function renderMarkdownLine(line: string) {
  if (!line) return null
  if (/^```/.test(line)) return <span className="dui-token-code-fence">{line}</span>
  if (line.startsWith('## ')) return <span className="dui-token-section">{line}</span>
  if (line.startsWith('# ')) return <span className="dui-token-title">{line}</span>
  if (/^---+$/.test(line.trim())) return <span className="dui-token-rule">{line}</span>

  const fieldMatch = line.match(/^(Agent ID|Class|Role|Behavior profile):\s*(.*)$/)
  if (fieldMatch) {
    const valueClass = fieldMatch[1] === 'Agent ID' ? 'dui-token-id' : 'dui-token-value'
    return (
      <>
        <span className="dui-token-label">{fieldMatch[1]}:</span>{' '}
        <span className={valueClass}>{renderInlineMarkdown(fieldMatch[2])}</span>
      </>
    )
  }

  const listMatch = line.match(/^(\s*)((?:[-*+]|\d+\.))(\s+)(.*)$/)
  if (listMatch) {
    return (
      <>
        {listMatch[1]}
        <span className="dui-token-list-marker">{listMatch[2]}</span>
        {listMatch[3]}
        {renderInlineMarkdown(listMatch[4])}
      </>
    )
  }

  return renderInlineMarkdown(line)
}

function markdownFileTone(file: string) {
  const normalized = file.toUpperCase()
  if (normalized === 'IDENTITY.MD') return 'identity'
  if (normalized === 'SOUL.MD') return 'soul'
  if (normalized === 'BOOTSTRAP.MD') return 'bootstrap'
  if (normalized === 'AGENTS.MD') return 'agents'
  if (normalized === 'USER.MD') return 'user'
  if (normalized === 'HEARTBEAT.MD') return 'heartbeat'
  if (normalized === 'MEMORY.MD') return 'memory'
  if (normalized === 'TOOLS.MD') return 'tools'
  if (normalized === 'MISSION_PROMPT.MD') return 'mission'
  return 'custom'
}

function cursorPositionFor(value: string, selectionStart: number, selectionEnd: number) {
  const beforeCursor = value.slice(0, selectionStart)
  const lines = beforeCursor.split('\n')
  const currentLine = lines[lines.length - 1] || ''
  return {
    line: lines.length,
    column: currentLine.length + 1,
    selectionLength: Math.abs(selectionEnd - selectionStart),
  }
}

function slugifyAgentId(value: string) {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (base.length >= 3) return base
  return base ? `${base}-agent` : ''
}

function normalizeAgentIdInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function behaviorOption(profile: BehaviorProfile) {
  return BEHAVIOR_OPTIONS.find((option) => option.id === profile) || BEHAVIOR_OPTIONS[0]
}

function normalizeMdFileName(value: unknown) {
  const cleaned = safeString(value)
    .trim()
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!cleaned) return ''
  return cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`
}

function uniqueRecruitAgentId(base: string, existingIds: Set<string>) {
  const fallback = slugifyAgentId(base) || 'agency-agent'
  if (!existingIds.has(fallback)) return fallback
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`
    const stem = fallback.slice(0, Math.max(3, 60 - suffix.length)).replace(/-+$/g, '')
    const candidate = `${stem || 'agency'}${suffix}`
    if (!existingIds.has(candidate)) return candidate
  }
  return fallback
}

function templateDocumentsToResources(template: RecruitAgentTemplate) {
  const order: string[] = []
  const files: Record<string, string> = {}
  const seen = new Set<string>()
  const documents = Array.isArray(template.documents) ? template.documents : []
  for (const document of documents) {
    if (!isRecord(document)) continue
    const file = normalizeMdFileName(document.file)
    const content = safeString(document.content).trim()
    if (!file || !content) continue
    const key = file.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    order.push(file)
    files[file] = content.endsWith('\n') ? content : `${content}\n`
  }
  return { order, files }
}

function normalizeRecruitAgentTemplate(value: unknown): RecruitAgentTemplate | null {
  const summary = normalizeRecruitAgentTemplateSummary(value)
  if (!summary || !isRecord(value)) return null
  const documents = Array.isArray(value.documents)
    ? value.documents
      .filter(isRecord)
      .map((document) => ({
        file: safeString(document.file),
        content: safeString(document.content),
      }))
      .filter((document) => Boolean(document.file.trim()))
    : []
  return {
    ...summary,
    documents,
    sourceMarkdown: safeString(value.sourceMarkdown),
  }
}

function templateCategoryRank(division: string) {
  const index = AGENCY_TEMPLATE_CATEGORY_ORDER.indexOf(division)
  return index === -1 ? AGENCY_TEMPLATE_CATEGORY_ORDER.length : index
}

function compareTemplateCategories(
  left: Pick<RecruitAgentTemplateSummary, 'division' | 'divisionLabel'>,
  right: Pick<RecruitAgentTemplateSummary, 'division' | 'divisionLabel'>,
) {
  return templateCategoryRank(left.division) - templateCategoryRank(right.division)
    || (left.divisionLabel || left.division).localeCompare(right.divisionLabel || right.division)
}

function normalizeRecruitTemplateSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function templateMatchesSearch(template: RecruitAgentTemplateSummary, normalizedQuery: string) {
  if (!normalizedQuery) return true
  const enabledCapabilities = Object.entries(template.defaults.capabilities || {})
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capability)
  const haystack = normalizeRecruitTemplateSearch([
    template.name,
    template.description,
    template.division,
    template.divisionLabel,
    template.relativePath,
    template.defaults.role,
    template.defaults.behaviorProfile,
    ...(template.defaults.tools || []),
    ...enabledCapabilities,
  ].join(' '))
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function markdownDefaults(input: {
  name: string
  agentId: string
  className: string
  role: string
  behaviorLabel: string
  capabilities: string[]
  files: string[]
}): Record<string, string> {
  const name = input.name || 'New Agent'
  const agentId = input.agentId || 'agent-id'
  const className = input.className || 'Field Operator'
  const role = input.role || 'Implementation and task execution specialist'
  const capabilities = input.capabilities.length ? input.capabilities.join(', ') : 'Plan, Code, Memory'
  const fileList = input.files.map((file) => `- ${file}`).join('\n')

  return {
    'IDENTITY.md': `# IDENTITY.md - ${name}

Agent ID: ${agentId}
Class: ${className}
Role: ${role}
Behavior profile: ${input.behaviorLabel}

## Operating Identity
You are ${name}. Work as a practical teammate.
State assumptions, make concrete progress,
and keep outputs grounded in files and evidence.

Stay focused. Document decisions.
Prefer clarity over cleverness.

`,
    'SOUL.md': `# SOUL.md - ${name}

## Core Judgment
- Optimize for useful finished work, not theatrical personality.
- Prefer clear file ownership, direct edits, and verified results.
- Ask only when a missing decision would create real risk.

## Behavioral Bias
${role}

## Capability Focus
${capabilities}
`,
    'BOOTSTRAP.md': `# BOOTSTRAP.md - ${name}

Read these doctrine files before work:
${fileList}

## Startup Contract
1. Load identity from IDENTITY.md and SOUL.md.
2. Check MEMORY.md for durable facts.
3. Use AGENTS.md and USER.md for operating rules.
4. Record meaningful discoveries back to the appropriate markdown file.
`,
    'AGENTS.md': `# AGENTS.md - ${name}

## Workflow
- Search the workspace before assuming files are missing.
- Make focused edits.
- Verify when feasible.
- Report changed paths and remaining risks.
`,
    'USER.md': `# USER.md - ${name}

Serve the user with concise, actionable engineering work. Avoid filler. Keep the current request as the priority.
`,
    'HEARTBEAT.md': `# HEARTBEAT.md - ${name}

## Heartbeat
On scheduled checks, summarize current state, blockers, and the next useful action.
`,
    'MEMORY.md': `# MEMORY.md - ${name}

## Durable Notes
- Recruited from Automnia AI Nexus.
`,
    'TOOLS.md': `# TOOLS.md - ${name}

## Tool Use
- Prefer direct filesystem inspection for local code.
- Use search before broad edits.
- Verify outputs with tests or browser checks when relevant.
`,
    'MISSION_PROMPT.md': `# MISSION_PROMPT.md - ${name}

## Default Mission Frame
Clarify the objective, claim files, execute the smallest useful change, and return evidence.
`,
  }
}

function defaultRecruitResourceFiles() {
  const option = behaviorOption('executor')
  return markdownDefaults({
    name: '',
    agentId: '',
    className: option.className,
    role: option.role,
    behaviorLabel: option.label,
    capabilities: CAPABILITY_OPTIONS.filter((entry) => DEFAULT_CAPABILITIES[entry.key]).map((entry) => entry.label),
    files: DEFAULT_MD_FILES,
  })
}

export function RecruitAgentModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { license } = useLicense()
  const creditsOnly = isCreditsOnlyEntitlement(license)
  const recruitAgent = useNexusStore((s) => s.recruitAgent)
  const agents = useNexusStore((s) => s.agents)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const editorTextRef = useRef<HTMLTextAreaElement | null>(null)
  const editorPreviewRef = useRef<HTMLPreElement | null>(null)
  const editorGutterRef = useRef<HTMLDivElement | null>(null)
  const recruitBodyRef = useRef<HTMLDivElement | null>(null)
  const recruitFormRef = useRef<HTMLDivElement | null>(null)
  const recruitSideRef = useRef<HTMLDivElement | null>(null)
  const recruitFilesRef = useRef<HTMLElement | null>(null)
  const authRefreshKeyRef = useRef('')
  const templateRequestIdRef = useRef(0)

  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [behaviorProfile, setBehaviorProfile] = useState<BehaviorProfile>('executor')
  const [className, setClassName] = useState(behaviorOption('executor').className)
  const [role, setRole] = useState(behaviorOption('executor').role)
  const [level, setLevel] = useState(18)
  const [personalityDepth, setPersonalityDepth] = useState(DEFAULT_PERSONALITY_DEPTH)
  const [policy, setPolicy] = useState<RecruitPolicyDraft>({ ...DEFAULT_RECRUIT_POLICY })
  const [avatar, setAvatar] = useState('')
  const [avatarPreviewFailed, setAvatarPreviewFailed] = useState(false)
  const [primaryModel, setPrimaryModel] = useState('')
  const [capabilities, setCapabilities] = useState<Record<CapabilityKey, boolean>>({ ...DEFAULT_CAPABILITIES })
  const [addToParty, setAddToParty] = useState(true)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [templates, setTemplates] = useState<RecruitAgentTemplateSummary[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState('')
  const [selectedTemplateDivision, setSelectedTemplateDivision] = useState(DEFAULT_RECRUIT_TEMPLATE_DIVISION)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateSearchQuery, setTemplateSearchQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<RecruitAgentTemplate | null>(null)
  const [templateToolAccess, setTemplateToolAccess] = useState<string[]>([])
  const [templateApplying, setTemplateApplying] = useState(false)
  const [authProviders, setAuthProviders] = useState<AuthProviderStatus[]>([])
  const [authModalProvider, setAuthModalProvider] = useState<AuthProviderStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [autoForging, setAutoForging] = useState(false)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral')
  const [fileOrder, setFileOrder] = useState<string[]>(DEFAULT_MD_FILES)
  const [activeFile, setActiveFile] = useState('IDENTITY.md')
  const [resourceFiles, setResourceFiles] = useState<Record<string, string>>(defaultRecruitResourceFiles)
  const [newFileName, setNewFileName] = useState('')
  const [filesTouched, setFilesTouched] = useState(false)
  const [editorExpanded, setEditorExpanded] = useState(false)
  const [cursorStatus, setCursorStatus] = useState({ line: 1, column: 1, selectionLength: 0 })
  const [currentStep, setCurrentStep] = useState<RecruitWizardStep>(1)

  const existingIds = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const trimmedName = name.trim()
  const trimmedId = agentId.trim()
  const duplicateId = Boolean(trimmedId && existingIds.has(trimmedId))
  const invalidId = Boolean(trimmedId && !/^[a-z0-9-]{3,60}$/.test(trimmedId))
  const idError = invalidId
    ? 'Use 3-60 lowercase letters, numbers, and hyphens.'
    : duplicateId
      ? 'That agent ID is already in the roster.'
      : ''
  const selectedBehavior = behaviorOption(behaviorProfile)
  const partyRoom = activePartyIds.length < 6
  const enabledCapabilities = CAPABILITY_OPTIONS.filter((option) => capabilities[option.key])
  const selectableModels = useMemo(
    () => creditsOnly ? models.filter((model) => isAutomniaCreditsModelId(model.id)) : models,
    [creditsOnly, models],
  )
  const selectedModel = useMemo(() => selectableModels.find((model) => model.id === primaryModel), [selectableModels, primaryModel])
  const classChoiceOptions = useMemo(() => {
    const options = CLASS_OPTIONS.includes(className) ? CLASS_OPTIONS : [className, ...CLASS_OPTIONS]
    return options
      .filter(Boolean)
      .map((option) => ({ value: option, label: option }))
  }, [className])
  const trimmedTemplateSearch = templateSearchQuery.trim()
  const normalizedTemplateSearch = useMemo(
    () => normalizeRecruitTemplateSearch(templateSearchQuery),
    [templateSearchQuery],
  )
  const searchedTemplates = useMemo(
    () => templates.filter((template) => templateMatchesSearch(template, normalizedTemplateSearch)),
    [normalizedTemplateSearch, templates],
  )
  const templateCategories = useMemo(() => {
    const groups = new Map<string, {
      division: string
      label: string
      color: string
      count: number
      sample: RecruitAgentTemplateSummary
    }>()
    for (const template of searchedTemplates) {
      const current = groups.get(template.division)
      if (current) {
        current.count += 1
      } else {
        groups.set(template.division, {
          division: template.division,
          label: template.divisionLabel || template.division,
          color: template.color,
          count: 1,
          sample: template,
        })
      }
    }
    return Array.from(groups.values())
      .sort((a, b) => compareTemplateCategories(a.sample, b.sample))
  }, [searchedTemplates])
  const templateGroups = useMemo(() => {
    const visibleTemplates = selectedTemplateDivision
      ? searchedTemplates.filter((template) => template.division === selectedTemplateDivision)
      : searchedTemplates
    const groups = new Map<string, { division: string; label: string; templates: RecruitAgentTemplateSummary[]; sample: RecruitAgentTemplateSummary }>()
    for (const template of visibleTemplates) {
      const current = groups.get(template.division)
      if (current) {
        current.templates.push(template)
      } else {
        groups.set(template.division, {
          division: template.division,
          label: template.divisionLabel || template.division || 'Agency',
          templates: [template],
          sample: template,
        })
      }
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        templates: group.templates.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => compareTemplateCategories(a.sample, b.sample))
  }, [searchedTemplates, selectedTemplateDivision])
  const selectedTemplateCategory = selectedTemplateDivision
    ? templateCategories.find((category) => category.division === selectedTemplateDivision)
    : undefined
  const visibleTemplateCount = templateGroups.reduce((count, group) => count + group.templates.length, 0)
  const visibleTemplateSummaries = useMemo(
    () => templateGroups.flatMap((group) => group.templates),
    [templateGroups],
  )
  const templatePickerMeta = templatesLoading
    ? 'loading'
    : trimmedTemplateSearch
      ? `${visibleTemplateCount} matches for "${trimmedTemplateSearch}"`
      : selectedTemplateDivision
        ? `${selectedTemplateCategory?.label || 'Category'}: ${visibleTemplateCount} templates`
      : templates.length
        ? `${templateCategories.length} organized categories`
      : 'blank'
  const browsingTemplateCategories = !selectedTemplateDivision && !trimmedTemplateSearch
  const selectedProvider = primaryModel
    ? isOpenAiCodexSubscriptionModel(primaryModel)
      ? 'openai'
      : selectedModel?.provider || primaryModel.split('/')[0]
    : ''
  const selectedProviderAuth = !creditsOnly && selectedProvider ? authStatusForProvider(authProviders, selectedProvider) : undefined
  const selectedPersonalityDepth = personalityDepthOption(personalityDepth)
  const autoForgeVisible = Boolean(trimmedName && className.trim() && role.trim())
  const autoForgeControlsVisible = autoForgeVisible
  const autoForgeModelLabel = selectedModel
    ? `${selectedModel.provider} / ${selectedModel.name || selectedModel.alias}`
    : primaryModel.trim()
  const canAutoForge = Boolean(autoForgeVisible && primaryModel.trim() && !autoForging && !submitting && !templateApplying)
  const canSubmit = Boolean(trimmedName && trimmedId && !idError && !submitting && !autoForging)
  const avatarValue = avatar.trim()
  const avatarPreviewSrc = avatarValue && !localPortraitPathFromInput(avatarValue) ? agentPortraitSrc(undefined, avatarValue) : ''
  const canPreviewAvatar = Boolean(avatarPreviewSrc && !avatarPreviewFailed)
  const activeMarkdownContent = safeString(resourceFiles[activeFile])
  const deferredMarkdownContent = useDeferredValue(activeMarkdownContent)
  const activeMarkdownLines = useMemo(() => deferredMarkdownContent.split('\n'), [deferredMarkdownContent])
  const activeMarkdownLineCount = activeMarkdownLines.length
  const activeMarkdownCharCount = activeMarkdownContent.length
  const markdownHighlightEnabled = activeMarkdownLineCount <= MARKDOWN_HIGHLIGHT_MAX_LINES
    && activeMarkdownCharCount <= MARKDOWN_HIGHLIGHT_MAX_CHARS
  const highlightedMarkdownLines = markdownHighlightEnabled ? activeMarkdownLines : []
  const editorClassName = [
    'dui-recruit-code-editor',
    editorExpanded ? 'is-expanded' : '',
    markdownHighlightEnabled ? '' : 'is-plain-text',
  ].filter(Boolean).join(' ')
  const activeMarkdownTone = markdownFileTone(activeFile)
  const activeWizardStep = RECRUIT_WIZARD_STEPS[currentStep - 1]

  const syncRecruitColumnHeights = useCallback(() => {
    const form = recruitFormRef.current
    const side = recruitSideRef.current
    const files = recruitFilesRef.current
    if (!form || !side || !files || typeof window === 'undefined') return

    const twoColumn = window.matchMedia('(min-width: 1041px)').matches
    side.style.removeProperty('height')
    side.style.removeProperty('min-height')
    files.style.removeProperty('height')
    files.style.removeProperty('min-height')

    if (!twoColumn) return

    const formHeight = Math.ceil(Math.max(form.scrollHeight, form.getBoundingClientRect().height))
    const nextHeight = `${formHeight}px`
    side.style.setProperty('height', nextHeight, 'important')
    side.style.setProperty('min-height', nextHeight, 'important')
    files.style.setProperty('height', nextHeight, 'important')
    files.style.setProperty('min-height', nextHeight, 'important')
  }, [])

  const readTextDrafts = useCallback(() => ({ name, agentId, avatar, role, newFileName }), [agentId, avatar, name, newFileName, role])

  useEffect(() => {
    setAvatarPreviewFailed(false)
  }, [avatarValue])

  const buildDefaults = (files = fileOrder, draft?: Partial<ReturnType<typeof readTextDrafts>>) => markdownDefaults({
    name: (draft?.name ?? trimmedName).trim(),
    agentId: (draft?.agentId ?? trimmedId).trim(),
    className: className.trim() || selectedBehavior.className,
    role: (draft?.role ?? role).trim() || selectedBehavior.role,
    behaviorLabel: selectedBehavior.label,
    capabilities: enabledCapabilities.map((option) => option.label),
    files,
  })

  useEffect(() => {
    if (!isOpen) return
    const option = behaviorOption('executor')
    setName('')
    setAgentId('')
    setIdTouched(false)
    setBehaviorProfile('executor')
    setClassName(option.className)
    setRole(option.role)
    setLevel(18)
    setPersonalityDepth(DEFAULT_PERSONALITY_DEPTH)
    setPolicy({ ...DEFAULT_RECRUIT_POLICY })
    setAvatar('')
    setPrimaryModel('')
    setCapabilities({ ...DEFAULT_CAPABILITIES })
    setAddToParty(activePartyIds.length < 6)
    setFileOrder(DEFAULT_MD_FILES)
    setActiveFile('IDENTITY.md')
    setNewFileName('')
    setFilesTouched(false)
    setEditorExpanded(false)
    setCursorStatus({ line: 1, column: 1, selectionLength: 0 })
    setCurrentStep(1)
    setAutoForging(false)
    setSelectedTemplateDivision(DEFAULT_RECRUIT_TEMPLATE_DIVISION)
    setSelectedTemplateId('')
    setTemplateSearchQuery('')
    setSelectedTemplate(null)
    setTemplateToolAccess([])
    setTemplateApplying(false)
    setTemplatesError('')
    authRefreshKeyRef.current = ''
    setResourceFiles(defaultRecruitResourceFiles())
    setStatus('')
    setStatusTone('neutral')
    window.setTimeout(() => nameRef.current?.focus(), 40)
  }, [activePartyIds.length, isOpen])

  useEffect(() => {
    if (!isOpen || filesTouched) return
    const refreshHandle = window.setTimeout(() => {
      setResourceFiles(buildDefaults(fileOrder))
    }, 120)
    return () => window.clearTimeout(refreshHandle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, behaviorProfile, capabilities, className, fileOrder, filesTouched, isOpen, name, role])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const cached = cachedRecruitModels()
    if (cached) setModels(cached)
    setModelsLoading(!cached)
    const loadHandle = window.setTimeout(() => {
      loadRecruitModels()
        .then((models) => {
          if (!cancelled) setModels(models)
        })
        .catch(() => {
          if (!cancelled) setModels([])
        })
        .finally(() => {
          if (!cancelled) setModelsLoading(false)
        })
    }, cached ? 120 : 40)
    return () => {
      cancelled = true
      window.clearTimeout(loadHandle)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const cached = cachedRecruitTemplates()
    if (cached) setTemplates(cached)
    setTemplatesError('')
    setTemplatesLoading(!cached)
    const loadHandle = window.setTimeout(() => {
      loadRecruitTemplates()
        .then((nextTemplates) => {
          if (!cancelled) setTemplates(nextTemplates)
        })
        .catch((error) => {
          if (!cancelled) {
            setTemplates([])
            setTemplatesError(error instanceof Error ? error.message : String(error))
          }
        })
        .finally(() => {
          if (!cancelled) setTemplatesLoading(false)
        })
    }, cached ? 140 : 40)
    return () => {
      cancelled = true
      window.clearTimeout(loadHandle)
    }
  }, [isOpen])

  const upsertAuthProviderStatus = useCallback((next?: AuthProviderStatus | null) => {
    if (!next) return
    setAuthModalProvider((current) => current?.provider === next.provider ? next : current)
    setAuthProviders((current) => {
      const merged = current.some((entry) => entry.provider === next.provider)
        ? current.map((entry) => entry.provider === next.provider ? next : entry)
        : [next, ...current]
      recruitAuthProvidersCache = { value: merged, expiresAt: Date.now() + RECRUIT_LOOKUP_CACHE_MS }
      return merged
    })
  }, [])

  const fetchAuthProviders = useCallback(async (force = false) => {
    try {
      const next = await loadRecruitAuthProviders(force)
      setAuthProviders(next)
      setAuthModalProvider((current) => current ? next.find((entry) => entry.provider === current.provider) || current : current)
      return next
    } catch {
      setAuthProviders([])
      return []
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !primaryModel || !selectedProvider) return
    if (!selectedProviderAuth?.oauth?.supported || selectedProviderAuth.configured) return
    const key = `${selectedProvider}:${primaryModel}`
    if (authRefreshKeyRef.current === key) return
    authRefreshKeyRef.current = key
    void fetchAuthProviders(true).then((next) => {
      const refreshedStatus = authStatusForProvider(next, selectedProvider)
      if (refreshedStatus && !refreshedStatus.configured) setAuthModalProvider(refreshedStatus)
    })
  }, [
    isOpen,
    primaryModel,
    selectedProvider,
    selectedProviderAuth?.configured,
    selectedProviderAuth?.oauth?.supported,
    fetchAuthProviders,
  ])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const cached = cachedRecruitAuthProviders()
    if (cached) setAuthProviders(cached)
    const loadHandle = window.setTimeout(() => {
      loadRecruitAuthProviders()
        .then((providers) => {
          if (!cancelled) setAuthProviders(providers)
        })
        .catch(() => {
          if (!cancelled) setAuthProviders([])
        })
    }, cached ? 140 : 60)
    return () => {
      cancelled = true
      window.clearTimeout(loadHandle)
    }
  }, [isOpen])

  const handleBehaviorChange = (next: BehaviorProfile) => {
    const option = behaviorOption(next)
    setBehaviorProfile(next)
    setClassName(option.className)
    setRole(option.role)
    setCapabilities((current) => ({
      ...current,
      research: next === 'researcher' || current.research,
      orchestration: next === 'architect' || current.orchestration,
    }))
  }

  const syncEditorScroll = useCallback(() => {
    const input = editorTextRef.current
    if (!input) return
    if (editorPreviewRef.current) {
      editorPreviewRef.current.scrollTop = input.scrollTop
      editorPreviewRef.current.scrollLeft = input.scrollLeft
    }
    if (editorGutterRef.current) {
      editorGutterRef.current.scrollTop = input.scrollTop
    }
  }, [])

  const updateEditorCursor = useCallback((target?: HTMLTextAreaElement | null) => {
    const input = target || editorTextRef.current
    if (!input) return
    setCursorStatus(cursorPositionFor(input.value, input.selectionStart, input.selectionEnd))
  }, [])

  useEffect(() => {
    if (!isOpen) return
    window.setTimeout(() => updateEditorCursor(), 0)
  }, [activeFile, isOpen, updateEditorCursor])

  useEffect(() => {
    if (!isOpen || !editorExpanded) return
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setEditorExpanded(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [editorExpanded, isOpen])

  useEffect(() => {
    if (!isOpen) return

    let frame = 0
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(syncRecruitColumnHeights)
    }

    scheduleSync()

    const form = recruitFormRef.current
    const sideForCleanup = recruitSideRef.current
    const filesForCleanup = recruitFilesRef.current
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleSync)
    if (form) observer?.observe(form)
    window.addEventListener('resize', scheduleSync)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleSync)
      if (sideForCleanup) {
        sideForCleanup.style.removeProperty('height')
        sideForCleanup.style.removeProperty('min-height')
      }
      if (filesForCleanup) {
        filesForCleanup.style.removeProperty('height')
        filesForCleanup.style.removeProperty('min-height')
      }
    }
  }, [isOpen, syncRecruitColumnHeights])

  const applyRecruitTemplate = useCallback((template: RecruitAgentTemplate) => {
    const defaults = template.defaults
    const fallbackBehavior = behaviorOption(defaults.behaviorProfile || 'hybrid')
    const nextName = defaults.name || template.name
    const nextAgentId = uniqueRecruitAgentId(defaults.agentId || nextName, existingIds)
    const nextClassName = defaults.className || template.divisionLabel || fallbackBehavior.className
    const nextRole = defaults.role || template.description || fallbackBehavior.role
    const { order, files } = templateDocumentsToResources(template)
    const nextOrder = order.length ? order : DEFAULT_MD_FILES
    const nextFiles = order.length
      ? files
      : markdownDefaults({
        name: nextName,
        agentId: nextAgentId,
        className: nextClassName,
        role: nextRole,
        behaviorLabel: fallbackBehavior.label,
        capabilities: CAPABILITY_OPTIONS.filter((entry) => defaults.capabilities?.[entry.key]).map((entry) => entry.label),
        files: nextOrder,
      })

    setName(nextName)
    setAgentId(nextAgentId)
    setIdTouched(true)
    setBehaviorProfile(defaults.behaviorProfile || 'hybrid')
    setClassName(nextClassName)
    setRole(nextRole)
    setLevel(Math.min(99, Math.max(1, Math.round(defaults.level || 22))))
    setCapabilities({ ...DEFAULT_CAPABILITIES, ...(defaults.capabilities || {}) })
    setTemplateToolAccess(defaults.tools || [])
    setFileOrder(nextOrder)
    setResourceFiles(nextFiles)
    setFilesTouched(true)
    setActiveFile(nextOrder.find((file) => file.toLowerCase() === 'identity.md') || nextOrder[0] || 'IDENTITY.md')
    setStatusTone('success')
    setStatus(`Loaded ${template.name} with ${nextOrder.length} markdown files and ${(defaults.tools || []).length} tools.`)
    window.setTimeout(() => updateEditorCursor(), 0)
  }, [existingIds, updateEditorCursor])

  const handleTemplateDivisionChange = (nextDivision: string) => {
    setSelectedTemplateDivision(nextDivision)
    const selectedSummary = selectedTemplateId
      ? templates.find((template) => template.id === selectedTemplateId)
      : undefined
    if (nextDivision && selectedSummary && selectedSummary.division !== nextDivision) {
      templateRequestIdRef.current += 1
      setSelectedTemplateId('')
      setSelectedTemplate(null)
      setTemplateToolAccess([])
      setTemplateApplying(false)
    }
    const category = nextDivision
      ? templateCategories.find((entry) => entry.division === nextDivision)
      : undefined
    setStatusTone('neutral')
    setStatus(nextDivision
      ? `Showing ${category?.count || 0} ${category?.label || 'category'} templates.`
      : `Showing ${templateCategories.length} organized template categories.`)
  }

  const handleTemplateSelect = async (nextTemplateId: string) => {
    const requestId = templateRequestIdRef.current + 1
    templateRequestIdRef.current = requestId
    setSelectedTemplateId(nextTemplateId)
    setTemplatesError('')

    if (!nextTemplateId) {
      setSelectedTemplate(null)
      setTemplateToolAccess([])
      setTemplateApplying(false)
      setStatusTone('neutral')
      setStatus('Blank recruit defaults ready.')
      return
    }

    setTemplateApplying(true)
    setStatusTone('neutral')
    setStatus('Loading agency template...')
    try {
      const result = await fetchRecruitAgentTemplate(nextTemplateId)
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const templatePayload = isRecord(result.data) ? result.data : {}
      const template = normalizeRecruitAgentTemplate(templatePayload.template)
      if (!template) throw new Error('Template response did not include usable template details.')
      if (templateRequestIdRef.current !== requestId) return
      setSelectedTemplateId(template.id)
      setSelectedTemplate(template)
      applyRecruitTemplate(template)
    } catch (error) {
      if (templateRequestIdRef.current !== requestId) return
      const message = error instanceof Error ? error.message : String(error)
      setSelectedTemplate(null)
      setTemplateToolAccess([])
      setTemplatesError(message)
      setStatusTone('error')
      setStatus(message)
    } finally {
      if (templateRequestIdRef.current === requestId) setTemplateApplying(false)
    }
  }

  const handlePrimaryModelChange = (next: string) => {
    if (creditsOnly && !isAutomniaCreditsModelId(next)) {
      setPrimaryModel(AUTOMNIA_CREDITS_MODEL_ID)
      return
    }
    setPrimaryModel(next)
    const selected = models.find((model) => model.id === next)
    const provider = next
      ? isOpenAiCodexSubscriptionModel(next)
        ? 'openai'
        : selected?.provider || next.split('/')[0]
      : ''
    const auth = provider ? authStatusForProvider(authProviders, provider) : undefined
    if (auth && !auth.configured) setAuthModalProvider(auth)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const input = event.currentTarget
    const start = input.selectionStart
    const end = input.selectionEnd
    const nextContent = `${input.value.slice(0, start)}${TAB_INSERT}${input.value.slice(end)}`
    setFilesTouched(true)
    setResourceFiles((current) => ({ ...current, [activeFile]: nextContent }))
    window.requestAnimationFrame(() => {
      input.selectionStart = start + TAB_INSERT.length
      input.selectionEnd = start + TAB_INSERT.length
      updateEditorCursor(input)
      syncEditorScroll()
    })
  }

  const handleRecruitFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement | null
    if (!target || target.tagName === 'TEXTAREA') return
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
      event.preventDefault()
    }
  }

  const goToPreviousRecruitStep = () => {
    if (currentStep > 1) setCurrentStep((step) => (step - 1) as RecruitWizardStep)
  }

  const goToNextRecruitStep = () => {
    if (currentStep === 1) {
      setCurrentStep(2)
      return
    }
    if (currentStep === 2) {
      const draft = readTextDrafts()
      const nextName = draft.name.trim()
      const nextId = draft.agentId.trim()
      const nextIdError = !nextId
        ? 'Add an agent ID before continuing.'
        : !/^[a-z0-9-]{3,60}$/.test(nextId)
          ? 'Use 3-60 lowercase letters, numbers, and hyphens.'
          : existingIds.has(nextId)
            ? 'That agent ID is already in the roster.'
            : ''
      if (!nextName || nextIdError) {
        setStatusTone('error')
        setStatus(nextIdError || 'Add a name before continuing.')
        return
      }
      setStatusTone('neutral')
      setStatus('Identity looks good. Set the runtime lane next.')
      setCurrentStep(3)
      return
    }
    if (currentStep === 3) {
      setStatusTone('neutral')
      setStatus('Runtime lane ready. Review the operating files before recruiting.')
      setCurrentStep(4)
    }
  }

  const addMarkdownFile = () => {
    const draft = readTextDrafts()
    const nextFile = normalizeMdFileName(draft.newFileName)
    if (!nextFile || fileOrder.some((file) => file.toLowerCase() === nextFile.toLowerCase())) return
    const nextOrder = [...fileOrder, nextFile]
    setFileOrder(nextOrder)
    setResourceFiles((current) => ({
      ...current,
      'BOOTSTRAP.md': current['BOOTSTRAP.md'] || buildDefaults(nextOrder)['BOOTSTRAP.md'],
      [nextFile]: `# ${nextFile}\n\nNotes for ${draft.name.trim() || 'this agent'}.\n`,
    }))
    setFilesTouched(true)
    setActiveFile(nextFile)
    setNewFileName('')
  }

  const handleAutoForge = async () => {
    const draft = readTextDrafts()
    const autoName = draft.name.trim()
    const autoId = draft.agentId.trim()
    const autoRole = draft.role.trim()
    if (!autoName || !className.trim() || !autoRole) return
    if (!primaryModel.trim()) {
      setStatusTone('error')
      setStatus('Select a model before running Auto Forge.')
      return
    }
    if (selectedProviderAuth && !selectedProviderAuth.configured) {
      setStatusTone('error')
      setStatus(`Connect ${selectedProviderAuth.label || selectedProviderAuth.provider} before running Auto Forge.`)
      setAuthModalProvider(selectedProviderAuth)
      return
    }

    setAutoForging(true)
    setStatusTone('neutral')
    setStatus(`Auto Forge is generating ${selectedPersonalityDepth.label.toLowerCase()} persona markdown with ${autoForgeModelLabel || primaryModel.trim()}...`)

    try {
      const result = await apiRequest<AutoForgeApiResponse>('/api/party/recruit/auto-markdown', {
        method: 'POST',
        timeoutMs: 90_000,
        body: {
          model: primaryModel.trim(),
          name: autoName,
          agentId: autoId || undefined,
          className: className.trim() || selectedBehavior.className,
          role: autoRole || selectedBehavior.role,
          behaviorProfile,
          level,
          personalityDepth,
          capabilities,
          files: fileOrder,
          currentFiles: resourceFiles,
        },
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const payload = isRecord(result.data) ? result.data : {}
      if (payload.ok !== true) {
        const detail = typeof payload.detail === 'string'
          ? payload.detail
          : payload.detail
            ? JSON.stringify(payload.detail)
            : ''
        throw new Error([safeString(payload.error, 'Auto Forge failed.'), detail].filter(Boolean).join(': '))
      }

      const generatedFiles = (Array.isArray(payload.files) ? payload.files : [])
        .filter(isRecord)
        .map((entry) => ({
          file: normalizeMdFileName(entry.file),
          content: safeString(entry.content),
        }))
        .filter((entry) => entry.file && entry.content.trim())
      if (!generatedFiles.length) throw new Error('Auto Forge returned no markdown files.')

      const nextOrder = [...fileOrder]
      for (const entry of generatedFiles) {
        if (!nextOrder.some((file) => file.toLowerCase() === entry.file.toLowerCase())) {
          nextOrder.push(entry.file)
        }
      }
      const defaults = buildDefaults(nextOrder)
      setFileOrder(nextOrder)
      setResourceFiles((current) => {
        const next = { ...defaults, ...current }
        for (const entry of generatedFiles) {
          next[entry.file] = entry.content.endsWith('\n') ? entry.content : `${entry.content}\n`
        }
        return next
      })
      setFilesTouched(true)
      setActiveFile(generatedFiles[0].file)
      setEditorExpanded(false)
      setStatusTone('success')
      const generatedDepth = typeof payload.personalityDepth === 'number' && Number.isFinite(payload.personalityDepth)
        ? personalityDepthOption(payload.personalityDepth).label
        : selectedPersonalityDepth.label
      setStatus(`Auto Forge generated ${generatedFiles.length} markdown files at ${generatedDepth} depth with ${safeString(payload.modelId, autoForgeModelLabel)}. Review, then recruit.`)
      window.setTimeout(() => updateEditorCursor(), 0)
    } catch (error) {
      setStatusTone('error')
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setAutoForging(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const draft = readTextDrafts()
    const submitName = draft.name.trim()
    const submitId = draft.agentId.trim()
    const submitRole = draft.role.trim()
    const submitAvatar = draft.avatar.trim()
    const submitInvalidId = Boolean(submitId && !/^[a-z0-9-]{3,60}$/.test(submitId))
    const submitDuplicateId = Boolean(submitId && existingIds.has(submitId))
    if (!submitName || !submitId || submitInvalidId || submitDuplicateId || submitting || autoForging) return
    if (selectedProviderAuth && !selectedProviderAuth.configured) {
      setStatusTone('error')
      setStatus(`Connect ${selectedProviderAuth.label || selectedProviderAuth.provider} before recruiting with this model.`)
      setAuthModalProvider(selectedProviderAuth)
      return
    }
    setSubmitting(true)
    setStatusTone('neutral')
    setStatus('Creating agent and markdown files...')

    const defaults = buildDefaults(fileOrder, draft)
    const payload: RecruitAgentInput = {
      agentId: submitId,
      name: submitName,
      avatar: submitAvatar || undefined,
      className: className.trim() || selectedBehavior.className,
      role: submitRole || selectedBehavior.role,
      behaviorProfile,
      level,
      primaryModel: primaryModel.trim() || undefined,
      capabilities,
      sandbox: {
        mode: policy.mode,
        scope: policy.mode === 'off' ? 'agent' : policy.scope,
        workspaceAccess: policy.mode === 'off' ? 'rw' : policy.access,
      },
      toolsPolicy: policy.mode === 'off'
        ? { profile: 'full', allow: [], deny: [] }
        : { profile: 'full', allow: policyToolList(policy.allow), deny: policyToolList(policy.deny) },
      addToParty,
      templateId: selectedTemplate?.id,
      templateName: selectedTemplate?.name,
      templateSource: selectedTemplate?.relativePath,
      toolAccess: templateToolAccess,
      resourceFiles: fileOrder.map((file) => ({
        file,
        content: safeString(resourceFiles[file], defaults[file as keyof typeof defaults] || `# ${file}\n\n`),
      })),
    }

    try {
      const result = await recruitAgent(payload)
      setStatusTone(result.warnings.length ? 'neutral' : 'success')
      setStatus(result.warnings.length ? `Created ${result.agentId}. ${result.warnings.join(' ')}` : `Created ${result.agentId} with ${fileOrder.length} markdown files.`)
      window.setTimeout(onClose, result.warnings.length ? 1500 : 800)
    } catch (error) {
      setStatusTone('error')
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {isOpen && (
        <div
          className="dui-recruit-backdrop fixed inset-0 z-[60] grid place-items-center p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget && !submitting && !autoForging) onClose()
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="recruit-agent-title"
            data-dui-modal="recruit-agent"
            data-markdown-editor="open"
            data-markdown-editor-expanded={editorExpanded ? 'true' : 'false'}
            className="dui-recruit-modal w-full overflow-hidden"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={handleSubmit} onKeyDown={handleRecruitFormKeyDown} className="dui-recruit-form-shell flex max-h-[88vh] flex-col">
              <div className="dui-recruit-header">
                <div className="dui-recruit-title-block">
                  <span className="dui-recruit-header-eyebrow">Automnia · Agent intake</span>
                  <h2 id="recruit-agent-title">{activeWizardStep.title}</h2>
                  <p className="dui-recruit-copy">{activeWizardStep.copy}</p>
                </div>
                <div className="dui-recruit-step-rail" aria-label="Recruit setup progress">
                  {RECRUIT_WIZARD_STEPS.map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      data-state={currentStep === step.id ? 'active' : currentStep > step.id ? 'done' : 'upcoming'}
                      aria-current={currentStep === step.id ? 'step' : undefined}
                      onClick={() => {
                        if (step.id <= currentStep) setCurrentStep(step.id)
                      }}
                      disabled={step.id > currentStep || submitting || autoForging}
                    >
                      <small>{step.number}</small>
                      <strong>{step.label}</strong>
                    </button>
                  ))}
                </div>
                <button type="button" className="dui-recruit-close" onClick={onClose} disabled={submitting || autoForging} aria-label="Close recruit agent" title="Close recruit menu">
                  <RecruitIcon type="close" />
                </button>
              </div>

              <div ref={recruitBodyRef} className="dui-recruit-body min-h-0 overflow-y-auto">
                <div className="dui-recruit-wizard" data-step={currentStep}>
                  <div ref={recruitFormRef} className="dui-recruit-step-window" data-step={currentStep} key={currentStep}>
                    <div className="dui-recruit-step-intro">
                      <span>{activeWizardStep.eyebrow}</span>
                      <h3>{activeWizardStep.title}</h3>
                      <p>{activeWizardStep.copy}</p>
                    </div>

                    {currentStep === 1 && (
                      <section className="dui-recruit-step-content dui-recruit-template-step" aria-label="Choose an agent template">
                        <div className="dui-recruit-template-panel">
                          <div className="dui-recruit-template-panel-head">
                            <span>
                              <strong>Agent templates</strong>
                              <small>{templatesLoading ? 'Loading agency templates...' : templateApplying ? 'Applying template...' : templatePickerMeta}</small>
                            </span>
                            {selectedTemplateDivision ? (
                              <button type="button" className="dui-recruit-template-reset" disabled={templatesLoading || templateApplying || submitting || autoForging} onClick={() => handleTemplateDivisionChange('')}>
                                All categories
                              </button>
                            ) : null}
                          </div>
                          <div className="dui-recruit-template-search">
                            <input type="search" value={templateSearchQuery} disabled={templatesLoading || templateApplying || submitting || autoForging} placeholder="Search agents, jobs, tools..." aria-label="Search agent templates" onChange={(event) => setTemplateSearchQuery(event.target.value)} />
                            {templateSearchQuery ? <button type="button" disabled={templateApplying || submitting || autoForging} aria-label="Clear template search" title="Clear search" onClick={() => setTemplateSearchQuery('')}>×</button> : null}
                          </div>
                            <div className="dui-recruit-category-chips" aria-label="Template categories">
                              {templateCategories.map((category) => (
                              <button key={category.division} type="button" data-active={selectedTemplateDivision === category.division} style={{ '--category-color': category.color } as CSSProperties} disabled={templatesLoading || templateApplying || submitting || autoForging} onClick={() => handleTemplateDivisionChange(category.division)}>
                                {category.label} <small>{category.count}</small>
                              </button>
                            ))}
                          </div>
                          {browsingTemplateCategories && !templatesLoading && !templatesError ? (
                            <div className="dui-recruit-template-category-grid" aria-label="Template category overview">
                              {templateCategories.map((category) => (
                                <button key={category.division} type="button" className="dui-recruit-template-category-card" style={{ '--category-color': category.color } as CSSProperties} disabled={templatesLoading || templateApplying || submitting || autoForging} onClick={() => handleTemplateDivisionChange(category.division)}>
                                  <span className="dui-recruit-template-category-mark" style={{ '--category-color': category.color } as CSSProperties} />
                                  <span><strong>{category.label}</strong><small>{category.count} ready-to-use profiles</small></span>
                                  <b aria-hidden="true">→</b>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className="dui-recruit-template-cards" aria-label="Agent templates">
                            {!browsingTemplateCategories ? (
                              <button type="button" className="dui-recruit-template-card dui-recruit-template-card-blank" data-active={!selectedTemplateId} disabled={templateApplying || submitting || autoForging} onClick={() => handleTemplateSelect('')}>
                                <strong>Blank recruit defaults</strong>
                                <small>Clean starter agent with prepared markdown.</small>
                              </button>
                            ) : null}
                            {templatesError ? <p className="dui-recruit-template-empty" data-tone="error">{templatesError}</p> : null}
                            {!templatesError && templatesLoading ? <p className="dui-recruit-template-empty">Loading templates...</p> : null}
                            {!templatesError && !templatesLoading && visibleTemplateSummaries.length === 0 ? <p className="dui-recruit-template-empty">{trimmedTemplateSearch ? 'No matching templates found.' : 'No templates found for this category.'}</p> : null}
                            {!browsingTemplateCategories && templateGroups.map((group) => (
                              <section key={group.division} className="dui-recruit-template-group" style={{ '--category-color': group.sample.color } as CSSProperties}>
                                <div className="dui-recruit-template-group-head"><span className="dui-recruit-template-group-mark" aria-hidden="true" /><strong>{group.label}</strong><small>{group.templates.length}</small></div>
                                <div className="dui-recruit-template-group-grid">
                                  {group.templates.map((template) => (
                                    <button key={template.id} type="button" className="dui-recruit-template-card" data-active={selectedTemplateId === template.id} disabled={templateApplying || submitting || autoForging} onClick={() => handleTemplateSelect(template.id)}>
                                      <strong>{template.emoji ? `${template.emoji} ` : ''}{template.name}</strong>
                                      <small>{template.defaults.behaviorProfile} · {(template.defaults.tools || []).length} tools</small>
                                      <span>{template.description}</span>
                                    </button>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        </div>
                        {selectedTemplate ? (
                          <div className="dui-recruit-template-preview" style={{ '--category-color': selectedTemplateCategory?.color || selectedTemplate.color } as CSSProperties}>
                            <div><strong>{selectedTemplate.emoji ? `${selectedTemplate.emoji} ` : ''}{selectedTemplate.name}</strong><p>{selectedTemplate.description}</p></div>
                            <span className="dui-recruit-template-meta"><span>{selectedTemplate.divisionLabel}</span><span>{(selectedTemplate.documents || []).length} files</span><span>{templateToolAccess.length} tools</span></span>
                          </div>
                        ) : (
                          <div className="dui-recruit-template-preview is-blank"><div><strong>Blank recruit defaults</strong><p>A flexible operator profile with a complete starter playbook.</p></div><span className="dui-recruit-template-meta"><span>Customizable</span><span>{DEFAULT_MD_FILES.length} files</span></span></div>
                        )}
                      </section>
                    )}

                    {currentStep === 2 && (
                      <div className="dui-recruit-step-content dui-recruit-profile-step">
                        <section className="dui-recruit-section dui-recruit-section-primary">
                          <SectionTitle icon="identity" label="Identity" meta={trimmedId || 'new-agent'} />
                          <div className="dui-recruit-grid two">
                            <label className="dui-recruit-field"><span>Name</span><input ref={nameRef} type="text" value={name} onChange={(event) => { const next = event.target.value; setName(next); if (!idTouched) setAgentId(slugifyAgentId(next)) }} placeholder="Nova Builder" maxLength={80} required /></label>
                            <label className="dui-recruit-field"><span>Agent ID</span><input type="text" value={agentId} onChange={(event) => { setIdTouched(true); setAgentId(normalizeAgentIdInput(event.target.value)) }} placeholder="nova-builder" maxLength={60} required />{idError && <small data-tone="error">{idError}</small>}</label>
                          </div>
                          <div className="dui-recruit-avatar-row">
                            <div className="dui-recruit-portrait-preview" aria-label="Selected profile picture preview">{canPreviewAvatar ? <img src={avatarPreviewSrc} alt="" onError={() => setAvatarPreviewFailed(true)} /> : <span>{trimmedName.charAt(0).toUpperCase() || 'A'}</span>}</div>
                            <label className="dui-recruit-field dui-recruit-avatar-field"><span>Avatar</span><input type="text" value={avatar} onChange={(event) => setAvatar(event.target.value)} placeholder="Optional URL, /agents/name.jpg, or local path" /></label>
                          </div>
                        </section>

                        <section className="dui-recruit-section">
                          <SectionTitle icon="role" label="Working style" meta={selectedBehavior.label} />
                          <div className="dui-recruit-behaviors" role="radiogroup" aria-label="Behavior profile">
                            {BEHAVIOR_OPTIONS.map((option) => <button key={option.id} type="button" role="radio" aria-checked={behaviorProfile === option.id} className={behaviorProfile === option.id ? 'is-active' : ''} onClick={() => handleBehaviorChange(option.id)} title={option.brief} aria-label={`${option.label}. ${option.brief}`}><strong>{option.label}</strong><span>{option.brief}</span></button>)}
                          </div>
                          <div className="dui-recruit-style-settings" data-recruit-settings="agent-profile" aria-label="Agent profile settings">
                            <div className="dui-recruit-style-settings-head"><div><span>Configuration</span><strong>Agent profile</strong><small>Set the role and the amount of personality this recruit should bring to the room.</small></div><span className="dui-recruit-settings-ready" data-ready={canSubmit ? 'true' : 'false'}><i aria-hidden="true" />{canSubmit ? 'Ready to continue' : 'Profile in progress'}</span></div>
                            <div className="dui-recruit-settings-overview" aria-label="Agent profile summary"><span data-tone="profile"><small>Behavior</small><strong>{selectedBehavior.label}</strong></span><span data-tone="role"><small>Role level</small><strong>{className} · {level}</strong></span><span data-tone="runtime"><small>Runtime lane</small><strong>{primaryModel ? autoForgeModelLabel : 'System default'}</strong></span><span data-tone="access"><small>Access</small><strong>{enabledCapabilities.length} capabilities</strong></span></div>
                            <div className="dui-recruit-settings-content">
                              <section className="dui-recruit-setting-group"><SectionTitle icon="role" label="Role and seniority" meta={`Level ${level}`} /><div className="dui-recruit-grid three"><RecruitChoiceField label="Class" value={className} options={classChoiceOptions} placeholder="Choose class" onChange={setClassName} /><label className="dui-recruit-field"><span>Role</span><input type="text" value={role} onChange={(event) => setRole(event.target.value)} maxLength={180} /></label><label className="dui-recruit-field"><span>Level</span><input type="number" min={1} max={99} value={level} onChange={(event) => setLevel(Math.min(99, Math.max(1, Number(event.target.value) || 1)))} /></label></div>
                                <div className="dui-recruit-personality-depth"><span className="dui-recruit-personality-depth-head"><strong>Persona detail</strong><em>{selectedPersonalityDepth.label}</em></span><input type="range" min={1} max={PERSONALITY_DEPTH_OPTIONS.length} step={1} value={personalityDepth} onChange={(event) => setPersonalityDepth(clampPersonalityDepth(Number(event.target.value)))} style={personalityDepthFillStyle(personalityDepth)} aria-label="Auto Forge persona detail" /><div className="dui-recruit-personality-depth-scale" aria-label="Persona detail presets">{PERSONALITY_DEPTH_OPTIONS.map((option) => <button key={option.value} type="button" data-active={option.value === personalityDepth} aria-pressed={option.value === personalityDepth} aria-label={`${option.label} persona detail`} title={`${option.label}: ${option.detail} persona detail`} onClick={() => setPersonalityDepth(option.value)}>{option.detail}</button>)}</div></div>
                              </section>
                            </div>
                          </div>
                        </section>
                      </div>
                    )}

                    {currentStep === 3 && (
                      <div className="dui-recruit-step-content dui-recruit-runtime-step">
                        <section className="dui-recruit-section dui-recruit-section-primary">
                          <SectionTitle icon="runtime" label="Runtime lane" meta={primaryModel ? 'Model selected' : 'System default'} />
                          <div className="dui-recruit-runtime-grid">
                              <div className="dui-recruit-model-field">
                                <ModelPicker mode="primary" models={selectableModels} selectedIds={primaryModel ? [primaryModel] : []} emptyOption={{ label: 'Use system default', detail: creditsOnly ? 'Starter subscriptions use Automnia credits only.' : 'Follow the current runtime lane.' }} label="Model" disabled={modelsLoading} loading={modelsLoading} providerAuthStatusFor={(provider) => authStatusForProvider(authProviders, provider)} onProviderAuth={(_, providerStatus) => setAuthModalProvider(providerStatus)} onSelect={handlePrimaryModelChange} />
                                {selectedProviderAuth && !selectedProviderAuth.configured && (
                                  <div role="alert" className="dui-recruit-auth-notice">
                                    <strong>Missing {selectedProviderAuth.label || selectedProviderAuth.provider} authentication.</strong>
                                    <span>Connect this provider before using this model.</span>
                                    <button
                                      type="button"
                                      title={`Connect ${selectedProviderAuth.label || selectedProviderAuth.provider} authentication`}
                                      onClick={() => setAuthModalProvider(selectedProviderAuth)}
                                    >
                                      Connect provider
                                    </button>
                                  </div>
                                )}
                                <p className="dui-recruit-section-note">{creditsOnly ? 'Starter subscriptions are locked to Automnia credits. Provider credentials and BYOK are unavailable.' : 'Leave the model blank to follow the runtime default. Provider credentials can be connected inline when a model needs them.'}</p>
                            </div>
                            <section className="dui-recruit-policy-panel" aria-label="Agent policy settings">
                              <SectionTitle icon="policy" label="Agent policy" meta={policy.mode === 'off' ? 'Unrestricted' : 'Sandboxed'} />
                              <p className="dui-recruit-policy-intro">Set the safety boundary this agent will use from its first mission.</p>
                              <div className="dui-recruit-grid two dui-recruit-policy-grid">
                                <RecruitChoiceField label="Sandbox mode" value={policy.mode} options={POLICY_MODE_OPTIONS} placeholder="Choose mode" onChange={(value) => setPolicy((current) => ({ ...current, mode: value as RecruitSandboxMode }))} />
                                <RecruitChoiceField label="Policy scope" value={policy.scope} options={POLICY_SCOPE_OPTIONS} placeholder="Choose scope" disabled={policy.mode === 'off'} onChange={(value) => setPolicy((current) => ({ ...current, scope: value as RecruitSandboxScope }))} />
                                <RecruitChoiceField label="File access" value={policy.mode === 'off' ? 'rw' : policy.access} options={POLICY_ACCESS_OPTIONS} placeholder="Choose access" disabled={policy.mode === 'off'} onChange={(value) => setPolicy((current) => ({ ...current, access: value as RecruitFileAccess }))} />
                              </div>
                              <div className="dui-recruit-policy-tools">
                                <label className="dui-recruit-field"><span>Allow tools</span><input value={policy.allow} disabled={policy.mode === 'off'} onChange={(event) => setPolicy((current) => ({ ...current, allow: event.target.value }))} placeholder="filesystem, shell" /></label>
                                <label className="dui-recruit-field"><span>Deny tools</span><input value={policy.deny} disabled={policy.mode === 'off'} onChange={(event) => setPolicy((current) => ({ ...current, deny: event.target.value }))} placeholder="exec, browser" /></label>
                              </div>
                              <p className="dui-recruit-section-note">{policy.mode === 'off' ? 'Sandbox is off, so the agent starts with full tool access and read/write file access.' : 'Use commas or new lines to tune the tool allowlist and denylist. Blank lists follow the runtime defaults.'}</p>
                            </section>
                          </div>
                        </section>
                        <section className="dui-recruit-section"><SectionTitle icon="capabilities" label="Capabilities and party" meta={`${enabledCapabilities.length} enabled`} /><div className="dui-recruit-capability-grid">{CAPABILITY_OPTIONS.map((option) => <label key={option.key} className="dui-recruit-capability" title={option.detail}><input type="checkbox" aria-label={`${option.label}. ${option.detail}`} checked={capabilities[option.key]} onChange={(event) => setCapabilities((current) => ({ ...current, [option.key]: event.target.checked }))} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</div><label className="dui-recruit-toggle"><input type="checkbox" checked={addToParty} disabled={!partyRoom} onChange={(event) => setAddToParty(event.target.checked)} /><span>{partyRoom ? 'Add to active party' : 'Active party is full'}</span></label></section>
                        <div className="dui-recruit-lane-summary"><span><small>Template</small><strong>{selectedTemplate?.name || 'Blank defaults'}</strong></span><span><small>Policy</small><strong>{policy.mode === 'off' ? 'Unrestricted' : `${policy.access === 'rw' ? 'Read/write' : policy.access === 'ro' ? 'Read only' : 'No files'} sandbox`}</strong></span><span><small>Files ready</small><strong>{fileOrder.length} markdown files</strong></span></div>
                      </div>
                    )}

                    {currentStep === 4 && (
                      <div className="dui-recruit-step-content dui-recruit-files-step">
                        <div className="dui-recruit-review-strip"><div className="dui-recruit-review-avatar">{canPreviewAvatar ? <img src={avatarPreviewSrc} alt="" onError={() => setAvatarPreviewFailed(true)} /> : <span>{trimmedName.charAt(0).toUpperCase() || 'A'}</span>}</div><div className="dui-recruit-review-main"><span>Recruit preview</span><strong>{trimmedName || 'Unnamed agent'}</strong><small>{className} · {selectedBehavior.label} · Level {level}</small></div><div className="dui-recruit-review-facts"><span><small>Runtime</small><strong>{primaryModel ? autoForgeModelLabel : 'System default'}</strong></span><span><small>Access</small><strong>{enabledCapabilities.length} capabilities</strong></span><span><small>Party</small><strong>{addToParty ? 'Join active party' : 'Roster only'}</strong></span></div></div>
                        <div ref={recruitSideRef} className="dui-recruit-side"><section ref={recruitFilesRef} className="dui-recruit-files" data-markdown-tone={activeMarkdownTone} aria-label="Agent markdown bootstrap files"><SectionTitle icon="markdown" label="Operating files" meta={`${fileOrder.length} authored`} /><p className="dui-recruit-files__intro">These documents become part of the agent’s durable operating context. Edit the identity, memory, instructions, and tools they carry into every mission.</p><div className="dui-recruit-file-toolbar"><div className="dui-recruit-file-tabs" role="tablist" aria-label="Markdown files">{fileOrder.map((file) => <button key={file} type="button" role="tab" aria-selected={activeFile === file} aria-controls="recruit-markdown-editor-panel" data-md-tone={markdownFileTone(file)} data-file-extension="md" className={activeFile === file ? 'is-active' : ''} onClick={() => setActiveFile(file)} title={`Edit ${file}`}><span className="dui-recruit-file-tab__icon" aria-hidden="true"><RecruitIcon type="markdown" /></span><span className="dui-recruit-file-tab__name">{file}</span><span className="dui-recruit-file-tab__type" aria-hidden="true">MD</span></button>)}</div><div className="dui-recruit-file-add"><input value={newFileName} onChange={(event) => setNewFileName(event.target.value)} placeholder="EXTRA.md" /><button type="button" onClick={addMarkdownFile} title="Add a markdown bootstrap file">Add <RecruitIcon type="add" /></button></div></div>{editorExpanded ? <button type="button" className="dui-recruit-editor-scrim" onClick={() => setEditorExpanded(false)} aria-label="Close expanded markdown editor" /> : null}<div id="recruit-markdown-editor-panel" role="tabpanel" aria-label={`${activeFile} markdown editor`} className={editorClassName} data-md-tone={activeMarkdownTone} onClick={() => editorTextRef.current?.focus()}><div className="dui-recruit-code-scroll"><div ref={editorGutterRef} className="dui-recruit-code-gutter" aria-hidden="true">{highlightedMarkdownLines.map((_, index) => <span key={`${activeFile}-line-${index}`}>{index + 1}</span>)}</div><pre ref={editorPreviewRef} className="dui-recruit-code-preview" aria-hidden="true">{highlightedMarkdownLines.map((line, index) => <span key={`${activeFile}-preview-${index}`} className="dui-recruit-code-line">{renderMarkdownLine(line)}</span>)}</pre><textarea ref={editorTextRef} className="dui-recruit-code-input" value={activeMarkdownContent} onChange={(event) => { setFilesTouched(true); setResourceFiles((current) => ({ ...current, [activeFile]: event.target.value })); updateEditorCursor(event.currentTarget) }} onClick={(event) => updateEditorCursor(event.currentTarget)} onFocus={(event) => updateEditorCursor(event.currentTarget)} onKeyDown={handleEditorKeyDown} onKeyUp={(event) => updateEditorCursor(event.currentTarget)} onSelect={(event) => updateEditorCursor(event.currentTarget)} onScroll={syncEditorScroll} spellCheck aria-label={`Edit ${activeFile}`} /></div><div className="dui-recruit-code-status"><span className="dui-recruit-code-mode"><span aria-hidden="true">MD</span>{activeFile}</span><span>Ln {cursorStatus.line}, Col {cursorStatus.column}</span><span>{activeMarkdownLineCount} lines</span><span>{activeMarkdownCharCount} chars</span>{!markdownHighlightEnabled ? <span>Plain text</span> : null}{cursorStatus.selectionLength ? <span>{cursorStatus.selectionLength} selected</span> : null}<span>Spaces: 2</span><button type="button" className="dui-recruit-code-expand" aria-label={editorExpanded ? 'Collapse markdown editor' : 'Expand markdown editor'} aria-pressed={editorExpanded} title={editorExpanded ? 'Collapse markdown editor' : 'Expand markdown editor'} onClick={(event) => { event.stopPropagation(); setEditorExpanded((current) => !current); window.setTimeout(() => { editorTextRef.current?.focus(); syncEditorScroll() }, 0) }}><RecruitIcon type="expand" /></button></div></div></section></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="dui-recruit-footer">
                <p data-tone={statusTone}>
                  <span className="dui-recruit-status-icon">
                    <RecruitIcon type="status" />
                  </span>
                  {(idError && currentStep >= 2) ? idError : status || `Ready with ${fileOrder.length} prepared markdown files.`}
                </p>
                <div>
                  {autoForgeControlsVisible && currentStep === 4 && (
                    <span
                      className="dui-recruit-auto-indicator"
                      data-state={autoForging ? 'running' : !primaryModel.trim() ? 'missing-model' : selectedProviderAuth && !selectedProviderAuth.configured ? 'auth' : 'ready'}
                    >
                        {autoForging
                          ? 'Inference running'
                          : !primaryModel.trim()
                            ? 'Select model for Auto'
                            : selectedProviderAuth && !selectedProviderAuth.configured
                              ? 'Auth needed for Auto'
                              : `Inference ready: ${autoForgeModelLabel}`}
                    </span>
                  )}
                  {autoForgeControlsVisible && currentStep === 4 && (
                    <button
                      type="button"
                      className="dui-recruit-auto-button"
                      disabled={!canAutoForge}
                      onClick={handleAutoForge}
                      title="Generate persona markdown from the selected model"
                    >
                        {autoForging ? 'Forging...' : 'Auto Forge'}
                        <RecruitIcon type="rocket" />
                    </button>
                  )}
                  <button type="button" className="dui-recruit-secondary" onClick={currentStep === 1 ? onClose : goToPreviousRecruitStep} disabled={submitting || autoForging} title={currentStep === 1 ? 'Cancel recruitment' : 'Go to the previous step'}>
                    {currentStep === 1 ? 'Cancel' : 'Back'}
                  </button>
                  <button type={currentStep === 4 ? 'submit' : 'button'} className="dui-recruit-primary" disabled={currentStep === 4 ? !canSubmit : submitting || autoForging || templateApplying} onClick={currentStep === 4 ? undefined : goToNextRecruitStep} title={currentStep === 4 ? 'Create this agent and bootstrap files' : 'Continue to the next step'}>
                    {currentStep === 4 ? (submitting ? 'Creating...' : 'Recruit Agent') : 'Continue'}
                    <RecruitIcon type={currentStep === 4 ? 'rocket' : 'chevron'} />
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
      {authModalProvider && (
        <ProviderAuthModal
          isOpen
          provider={authModalProvider.provider}
          envKeys={authModalProvider.envKeys}
          providerStatus={authModalProvider}
          onClose={() => setAuthModalProvider(null)}
          onSave={async (apiKey) => {
            const result = await saveProviderApiKey(authModalProvider.provider, apiKey)
            if (!result.ok) throw new Error(apiErrorMessage(result.error))
            await fetchAuthProviders(true)
          }}
          onConnected={async (nextStatus) => {
            upsertAuthProviderStatus(nextStatus)
            await fetchAuthProviders(true)
          }}
        />
      )}
    </>
  )
}

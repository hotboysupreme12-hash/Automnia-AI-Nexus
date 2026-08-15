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
import type { BehaviorProfile, CapabilityKey } from '../../types/nexus'
import { formatModelGroupLabel, groupAvailableModels } from '../../utils/modelGrouping'
import { agentPortraitSrc, localPortraitPathFromInput } from '../../utils/portrait'
import { ProviderAuthModal } from '../auth/ProviderAuthModal'

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
  Array.isArray(value) ? value.filter(isAvailableModel) : []

const isRecruitAgentTemplateSummary = (value: unknown): value is RecruitAgentTemplateSummary => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<RecruitAgentTemplateSummary>
  return typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.divisionLabel === 'string'
    && Boolean(entry.defaults)
}

const safeRecruitAgentTemplates = (value: unknown): RecruitAgentTemplateSummary[] =>
  Array.isArray(value) ? value.filter(isRecruitAgentTemplateSummary) : []

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
      let templates = safeRecruitAgentTemplates(result.data.templates)
      if (!force && templates.length > 0 && templates.length <= 51) {
        const refreshed = await fetchRecruitAgentTemplates(true)
        if (refreshed.ok) {
          const nextTemplates = safeRecruitAgentTemplates(refreshed.data.templates)
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

const PERSONALITY_DEPTH_OPTIONS = [
  { value: 1, label: 'Basic', detail: 'Lean' },
  { value: 2, label: 'Guided', detail: 'Traits' },
  { value: 3, label: 'Detailed', detail: 'Voice' },
  { value: 4, label: 'Signature', detail: 'Cadence' },
  { value: 5, label: 'Max', detail: 'Full' },
]

const DEFAULT_PERSONALITY_DEPTH = 3

const TAB_INSERT = '  '

const CLASS_OPTIONS = Array.from(new Set(BEHAVIOR_OPTIONS.map((option) => option.className)))

const personalityDepthOption = (value: number) =>
  PERSONALITY_DEPTH_OPTIONS.find((option) => option.value === value) || PERSONALITY_DEPTH_OPTIONS[DEFAULT_PERSONALITY_DEPTH - 1]

const clampPersonalityDepth = (value: number) =>
  Math.min(PERSONALITY_DEPTH_OPTIONS.length, Math.max(1, Math.round(value) || DEFAULT_PERSONALITY_DEPTH))

const personalityDepthFillStyle = (value: number) => ({
  '--dy-range-value': `${((clampPersonalityDepth(value) - 1) / (PERSONALITY_DEPTH_OPTIONS.length - 1)) * 100}%`,
}) as CSSProperties

type RecruitIconName = 'identity' | 'role' | 'runtime' | 'capabilities' | 'markdown' | 'status' | 'rocket' | 'close' | 'add' | 'expand' | 'chevron'

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

function behaviorOption(profile: BehaviorProfile) {
  return BEHAVIOR_OPTIONS.find((option) => option.id === profile) || BEHAVIOR_OPTIONS[0]
}

function normalizeMdFileName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!cleaned) return ''
  return cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`
}

function setTextInputValue(ref: { current: HTMLInputElement | null }, value: string) {
  if (ref.current) ref.current.value = value
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
  for (const document of template.documents || []) {
    const file = normalizeMdFileName(document.file)
    const content = document.content.trim()
    if (!file || !content) continue
    const key = file.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    order.push(file)
    files[file] = content.endsWith('\n') ? content : `${content}\n`
  }
  return { order, files }
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
  const recruitAgent = useNexusStore((s) => s.recruitAgent)
  const agents = useNexusStore((s) => s.agents)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const agentIdRef = useRef<HTMLInputElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const roleInputRef = useRef<HTMLInputElement | null>(null)
  const newFileNameInputRef = useRef<HTMLInputElement | null>(null)
  const editorTextRef = useRef<HTMLTextAreaElement | null>(null)
  const editorPreviewRef = useRef<HTMLPreElement | null>(null)
  const editorGutterRef = useRef<HTMLDivElement | null>(null)
  const recruitBodyRef = useRef<HTMLDivElement | null>(null)
  const recruitFormRef = useRef<HTMLDivElement | null>(null)
  const recruitSideRef = useRef<HTMLDivElement | null>(null)
  const recruitFilesRef = useRef<HTMLElement | null>(null)
  const textDraftTimerRef = useRef<number | null>(null)
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
  const [workspace, setWorkspace] = useState('')
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
  const [selectedTemplateDivision, setSelectedTemplateDivision] = useState('')
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
  const selectedModel = useMemo(() => models.find((model) => model.id === primaryModel), [models, primaryModel])
  const modelGroups = useMemo(() => groupAvailableModels(models), [models])
  const classChoiceOptions = useMemo(() => {
    const options = CLASS_OPTIONS.includes(className) ? CLASS_OPTIONS : [className, ...CLASS_OPTIONS]
    return options
      .filter(Boolean)
      .map((option) => ({ value: option, label: option }))
  }, [className])
  const modelChoiceOptions = useMemo<RecruitChoiceOption[]>(() => [
    {
      value: '',
      label: modelsLoading ? 'Loading models...' : 'Use system default',
      detail: 'Follow the current runtime lane',
      disabled: modelsLoading,
    },
    ...modelGroups.flatMap((group) => group.models.map((model) => ({
      value: model.id,
      label: model.name || model.alias || model.id,
      detail: formatModelGroupLabel(group),
    }))),
  ], [modelGroups, modelsLoading])
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
  const selectedProviderAuth = selectedProvider ? authStatusForProvider(authProviders, selectedProvider) : undefined
  const selectedPersonalityDepth = personalityDepthOption(personalityDepth)
  const autoForgeVisible = Boolean(trimmedName && className.trim() && role.trim())
  const autoForgeControlsVisible = autoForgeVisible
  const autoForgeModelLabel = selectedModel
    ? `${selectedModel.provider} / ${selectedModel.name || selectedModel.alias}`
    : primaryModel.trim()
  const canAutoForge = Boolean(autoForgeVisible && primaryModel.trim() && !autoForging && !submitting && !templateApplying)
  const canSubmit = Boolean(trimmedName && trimmedId && !idError && !submitting && !autoForging && !templateApplying)
  const avatarValue = avatar.trim()
  const avatarPreviewSrc = avatarValue && !localPortraitPathFromInput(avatarValue) ? agentPortraitSrc(undefined, avatarValue) : ''
  const canPreviewAvatar = Boolean(avatarPreviewSrc && !avatarPreviewFailed)
  const activeMarkdownContent = resourceFiles[activeFile] || ''
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

  const readTextDrafts = useCallback(() => ({
    name: nameRef.current?.value ?? name,
    agentId: agentIdRef.current?.value ?? agentId,
    avatar: avatarInputRef.current?.value ?? avatar,
    role: roleInputRef.current?.value ?? role,
    newFileName: newFileNameInputRef.current?.value ?? newFileName,
  }), [agentId, avatar, name, newFileName, role])

  const commitTextDrafts = useCallback(() => {
    const draft = readTextDrafts()
    setName(draft.name)
    setAgentId(draft.agentId)
    setAvatar(draft.avatar)
    setRole(draft.role)
    setNewFileName(draft.newFileName)
  }, [readTextDrafts])

  const scheduleTextDraftCommit = useCallback((delayMs = 260) => {
    if (textDraftTimerRef.current !== null) window.clearTimeout(textDraftTimerRef.current)
    textDraftTimerRef.current = window.setTimeout(() => {
      textDraftTimerRef.current = null
      commitTextDrafts()
    }, delayMs)
  }, [commitTextDrafts])

  useEffect(() => () => {
    if (textDraftTimerRef.current !== null) window.clearTimeout(textDraftTimerRef.current)
  }, [])

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
    setWorkspace('')
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
    setAutoForging(false)
    setSelectedTemplateDivision('')
    setSelectedTemplateId('')
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
    } catch {
      setAuthProviders([])
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !primaryModel || !selectedProvider) return
    if (!selectedProviderAuth?.oauth?.supported || selectedProviderAuth.configured) return
    const key = `${selectedProvider}:${primaryModel}`
    if (authRefreshKeyRef.current === key) return
    authRefreshKeyRef.current = key
    void fetchAuthProviders(true)
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
    if (roleInputRef.current) roleInputRef.current.value = option.role
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

    setTextInputValue(nameRef, nextName)
    setTextInputValue(agentIdRef, nextAgentId)
    setTextInputValue(roleInputRef, nextRole)
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
      const template = result.data.template
      if (!template) throw new Error('Template response did not include template details.')
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
    if (newFileNameInputRef.current) newFileNameInputRef.current.value = ''
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
      const payload = result.data
      if (!payload.ok) {
        const detail = typeof payload.detail === 'string'
          ? payload.detail
          : payload.detail
            ? JSON.stringify(payload.detail)
            : ''
        throw new Error([payload.error || 'Auto Forge failed.', detail].filter(Boolean).join(': '))
      }

      const generatedFiles = (payload.files || [])
        .map((entry) => ({
          file: normalizeMdFileName(entry.file),
          content: entry.content,
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
      const generatedDepth = payload.personalityDepth
        ? personalityDepthOption(payload.personalityDepth).label
        : selectedPersonalityDepth.label
      setStatus(`Auto Forge generated ${generatedFiles.length} markdown files at ${generatedDepth} depth with ${payload.modelId || autoForgeModelLabel}. Review, then recruit.`)
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
    commitTextDrafts()
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
      workspace: workspace.trim() || undefined,
      avatar: submitAvatar || undefined,
      className: className.trim() || selectedBehavior.className,
      role: submitRole || selectedBehavior.role,
      behaviorProfile,
      level,
      primaryModel: primaryModel.trim() || undefined,
      capabilities,
      addToParty,
      templateId: selectedTemplate?.id,
      templateName: selectedTemplate?.name,
      templateSource: selectedTemplate?.relativePath,
      toolAccess: templateToolAccess,
      resourceFiles: fileOrder.map((file) => ({
        file,
        content: resourceFiles[file] || defaults[file as keyof typeof defaults] || `# ${file}\n\n`,
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
            className="dui-recruit-modal w-full overflow-hidden"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <form onSubmit={handleSubmit} onKeyDown={handleRecruitFormKeyDown} className="dui-recruit-form-shell flex max-h-[88vh] flex-col">
              <div className="dui-recruit-header">
                <div className="dui-recruit-title-block">
                  <h2 id="recruit-agent-title">New Agent</h2>
                  <p className="dui-recruit-copy">Start with a name. The rest has calm defaults.</p>
                </div>
                <div className="dui-recruit-step-rail" aria-label="Recruit setup progress">
                  <span data-state={trimmedName && trimmedId && !idError ? 'done' : 'active'}>
                    <small>01</small>
                    <strong>Basics</strong>
                  </span>
                  <span data-state="done">
                    <small>02</small>
                    <strong>Style</strong>
                  </span>
                  <span data-state="active">
                    <small>03</small>
                    <strong>Files</strong>
                  </span>
                </div>
                <button type="button" className="dui-recruit-close" onClick={onClose} disabled={submitting || autoForging} aria-label="Close recruit agent" title="Close recruit menu">
                  <RecruitIcon type="close" />
                </button>
              </div>

              <div ref={recruitBodyRef} className="dui-recruit-body min-h-0 overflow-y-auto">
                <div className="dui-recruit-layout">
                  <div ref={recruitFormRef} className="dui-recruit-form">
                    <section className="dui-recruit-section dui-recruit-section-primary">
                      <SectionTitle icon="identity" label="Basics" meta={trimmedId || 'new-agent'} />
                      <div className="dui-recruit-basics-stack">
                        <div className="dui-recruit-template-panel">
                          <div className="dui-recruit-template-panel-head">
                            <span>
                              <strong>Template</strong>
                              <small>{templatesLoading ? 'Loading agency templates...' : templateApplying ? 'Applying template...' : templatePickerMeta}</small>
                            </span>
                            {selectedTemplateDivision ? (
                              <button
                                type="button"
                                className="dui-recruit-template-reset"
                                disabled={templatesLoading || templateApplying || submitting || autoForging}
                                onClick={() => handleTemplateDivisionChange('')}
                              >
                                Back to categories
                              </button>
                            ) : null}
                          </div>
                          <div className="dui-recruit-template-search">
                            <input
                              type="search"
                              value={templateSearchQuery}
                              disabled={templatesLoading || templateApplying || submitting || autoForging}
                              placeholder="Search agents, jobs, tools..."
                              aria-label="Search agent templates"
                              onChange={(event) => setTemplateSearchQuery(event.target.value)}
                            />
                            {templateSearchQuery ? (
                              <button
                                type="button"
                                disabled={templateApplying || submitting || autoForging}
                                aria-label="Clear template search"
                                title="Clear search"
                                onClick={() => setTemplateSearchQuery('')}
                              >
                                x
                              </button>
                            ) : null}
                          </div>
                          <div className="dui-recruit-category-chips" aria-label="Template categories">
                            {templateCategories.map((category) => (
                              <button
                                key={category.division}
                                type="button"
                                data-active={selectedTemplateDivision === category.division}
                                disabled={templatesLoading || templateApplying || submitting || autoForging}
                                onClick={() => handleTemplateDivisionChange(category.division)}
                              >
                                {category.label} <small>{category.count}</small>
                              </button>
                            ))}
                          </div>
                          <div className="dui-recruit-template-cards" aria-label="Agent templates">
                            {!browsingTemplateCategories ? (
                              <button
                                type="button"
                                className="dui-recruit-template-card dui-recruit-template-card-blank"
                                data-active={!selectedTemplateId}
                                disabled={templateApplying || submitting || autoForging}
                                onClick={() => handleTemplateSelect('')}
                              >
                                <strong>Blank recruit defaults</strong>
                                <small>Clean starter agent with prepared markdown.</small>
                              </button>
                            ) : null}
                            {templatesError ? (
                              <p className="dui-recruit-template-empty" data-tone="error">{templatesError}</p>
                            ) : null}
                            {!templatesError && templatesLoading ? (
                              <p className="dui-recruit-template-empty">Loading templates...</p>
                            ) : null}
                            {!templatesError && !templatesLoading && visibleTemplateSummaries.length === 0 ? (
                              <p className="dui-recruit-template-empty">
                                {trimmedTemplateSearch ? 'No matching templates found.' : 'No templates found for this category.'}
                              </p>
                            ) : null}
                            {!browsingTemplateCategories && templateGroups.map((group) => (
                              <section
                                key={group.division}
                                className="dui-recruit-template-group"
                              >
                                <div className="dui-recruit-template-group-head">
                                  <strong>{group.label}</strong>
                                  <small>{group.templates.length}</small>
                                </div>
                                <div className="dui-recruit-template-group-grid">
                                  {group.templates.map((template) => (
                                    <button
                                      key={template.id}
                                      type="button"
                                      className="dui-recruit-template-card"
                                      data-active={selectedTemplateId === template.id}
                                      disabled={templateApplying || submitting || autoForging}
                                      onClick={() => handleTemplateSelect(template.id)}
                                    >
                                      <strong>{template.emoji ? `${template.emoji} ` : ''}{template.name}</strong>
                                      <small>{template.defaults.behaviorProfile} - {template.defaults.tools.length} tools</small>
                                      <span>{template.description}</span>
                                    </button>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        </div>
                        {selectedTemplate && (
                          <div className="dui-recruit-template-preview">
                            <strong>{selectedTemplate.emoji ? `${selectedTemplate.emoji} ` : ''}{selectedTemplate.name}</strong>
                            <p>{selectedTemplate.description}</p>
                            <span className="dui-recruit-template-meta">
                              <span>{selectedTemplate.divisionLabel}</span>
                              <span>{selectedTemplate.documents.length} files</span>
                              <span>{templateToolAccess.length} tools</span>
                            </span>
                          </div>
                        )}
                        <div className="dui-recruit-grid two">
                          <label className="dui-recruit-field">
                            <span>Name</span>
                            <input
                              ref={nameRef}
                              type="text"
                              defaultValue={name}
                              onChange={(event) => {
                                const next = event.target.value
                                if (!idTouched && agentIdRef.current) agentIdRef.current.value = slugifyAgentId(next)
                                scheduleTextDraftCommit()
                              }}
                              onBlur={() => commitTextDrafts()}
                              placeholder="Nova Builder"
                              maxLength={80}
                              required
                            />
                          </label>
                          <label className="dui-recruit-field">
                            <span>Agent ID</span>
                            <input
                              ref={agentIdRef}
                              type="text"
                              defaultValue={agentId}
                              onChange={(event) => {
                                if (!idTouched) setIdTouched(true)
                                event.currentTarget.value = slugifyAgentId(event.currentTarget.value)
                                scheduleTextDraftCommit()
                              }}
                              onBlur={() => commitTextDrafts()}
                              placeholder="nova-builder"
                              maxLength={60}
                              required
                            />
                            {idError && <small data-tone="error">{idError}</small>}
                          </label>
                        </div>
                        <div className="dui-recruit-avatar-row">
                          <div className="dui-recruit-portrait-preview" aria-label="Selected profile picture preview">
                            {canPreviewAvatar ? (
                              <img src={avatarPreviewSrc} alt="" onError={() => setAvatarPreviewFailed(true)} />
                            ) : (
                              <span>{trimmedName.charAt(0).toUpperCase() || 'A'}</span>
                            )}
                          </div>
                          <label className="dui-recruit-field dui-recruit-avatar-field">
                            <span>Avatar</span>
                            <input ref={avatarInputRef} type="text" defaultValue={avatar} onChange={() => scheduleTextDraftCommit()} onBlur={() => commitTextDrafts()} placeholder="Optional URL, /agents/name.jpg, or local path" />
                          </label>
                        </div>
                      </div>
                    </section>

                    <section className="dui-recruit-section">
                      <SectionTitle icon="role" label="Style" meta={selectedBehavior.label} />
                      <div className="dui-recruit-behaviors" role="radiogroup" aria-label="Behavior profile">
                        {BEHAVIOR_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={behaviorProfile === option.id}
                            className={behaviorProfile === option.id ? 'is-active' : ''}
                            onClick={() => handleBehaviorChange(option.id)}
                            title={option.brief}
                            aria-label={`${option.label}. ${option.brief}`}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.brief}</span>
                          </button>
                        ))}
                      </div>
                      <div className="dui-recruit-style-settings" data-recruit-settings="agent-profile" aria-label="Agent settings">
                        <div className="dui-recruit-style-settings-head">
                          <div>
                            <span>Configuration</span>
                            <strong>Agent profile</strong>
                            <small>Review the identity, runtime lane, and access boundaries before recruitment.</small>
                          </div>
                          <span className="dui-recruit-settings-ready" data-ready={canSubmit ? 'true' : 'false'}>
                            <i aria-hidden="true" />
                            {canSubmit ? 'Ready to recruit' : 'Profile in progress'}
                          </span>
                        </div>
                        <div className="dui-recruit-settings-overview" aria-label="Agent profile summary">
                          <span data-tone="profile">
                            <small>Behavior</small>
                            <strong>{selectedBehavior.label}</strong>
                          </span>
                          <span data-tone="role">
                            <small>Role level</small>
                            <strong>{className} · {level}</strong>
                          </span>
                          <span data-tone="runtime">
                            <small>Runtime lane</small>
                            <strong>{primaryModel ? autoForgeModelLabel : 'System default'}</strong>
                          </span>
                          <span data-tone="access">
                            <small>Access</small>
                            <strong>{enabledCapabilities.length} capabilities</strong>
                          </span>
                        </div>
                        <div className="dui-recruit-settings-content">
                          <section className="dui-recruit-setting-group">
                            <SectionTitle icon="role" label="Identity and role" meta={`Level ${level}`} />
                            <div className="dui-recruit-grid three">
                              <RecruitChoiceField
                                label="Class"
                                value={className}
                                options={classChoiceOptions}
                                placeholder="Choose class"
                                onChange={setClassName}
                              />
                              <label className="dui-recruit-field">
                                <span>Role</span>
                                <input ref={roleInputRef} type="text" defaultValue={role} onChange={() => scheduleTextDraftCommit()} onBlur={() => commitTextDrafts()} maxLength={180} />
                              </label>
                              <label className="dui-recruit-field">
                                <span>Level</span>
                                <input type="number" min={1} max={99} value={level} onChange={(event) => setLevel(Math.min(99, Math.max(1, Number(event.target.value) || 1)))} />
                              </label>
                            </div>
                            <div className="dui-recruit-personality-depth">
                              <span className="dui-recruit-personality-depth-head">
                                <strong>Persona detail</strong>
                                <em>{selectedPersonalityDepth.label}</em>
                              </span>
                              <input
                                type="range"
                                min={1}
                                max={PERSONALITY_DEPTH_OPTIONS.length}
                                step={1}
                                value={personalityDepth}
                                onChange={(event) => setPersonalityDepth(clampPersonalityDepth(Number(event.target.value)))}
                                style={personalityDepthFillStyle(personalityDepth)}
                                aria-label="Auto Forge persona detail"
                              />
                              <div className="dui-recruit-personality-depth-scale" aria-label="Persona detail presets">
                                {PERSONALITY_DEPTH_OPTIONS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    data-active={option.value === personalityDepth}
                                    aria-pressed={option.value === personalityDepth}
                                    aria-label={`${option.label} persona detail`}
                                    title={`${option.label}: ${option.detail} persona detail`}
                                    onClick={() => setPersonalityDepth(option.value)}
                                  >
                                    {option.detail}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </section>

                          <section className="dui-recruit-setting-group">
                            <SectionTitle icon="runtime" label="Runtime lane" meta={primaryModel ? 'Model selected' : 'System default'} />
                            <div className="dui-recruit-grid two">
                              <div className="dui-recruit-model-field">
                                <RecruitChoiceField
                                  label="Model"
                                  value={primaryModel}
                                  options={modelChoiceOptions}
                                  placeholder="Use system default"
                                  disabled={modelsLoading}
                                  onChange={handlePrimaryModelChange}
                                />
                                {selectedProviderAuth && !selectedProviderAuth.configured && (
                                  <small data-tone="error">
                                    {selectedProviderAuth.label || selectedProviderAuth.provider} auth required.{' '}
                                    <button type="button" onClick={() => setAuthModalProvider(selectedProviderAuth)} title={`Connect ${selectedProviderAuth.label || selectedProviderAuth.provider} authentication`}>Connect</button>
                                  </small>
                                )}
                                {selectedProvider === 'google-vertex' && (
                                  <small className="inline-flex w-fit rounded-full border border-sky-300/30 bg-sky-400/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-sky-200">
                                    google-vertex
                                  </small>
                                )}
                              </div>
                              <div className="dui-recruit-field">
                                <span>Workspace</span>
                                <div className="dui-recruit-static-value">{workspace || 'Default workspace'}</div>
                              </div>
                            </div>
                          </section>

                          <section className="dui-recruit-setting-group">
                            <SectionTitle icon="capabilities" label="Capabilities and party" meta={`${enabledCapabilities.length} enabled`} />
                            <div className="dui-recruit-capability-grid">
                              {CAPABILITY_OPTIONS.map((option) => (
                                <label key={option.key} className="dui-recruit-capability" title={option.detail}>
                                  <input
                                    type="checkbox"
                                    aria-label={`${option.label}. ${option.detail}`}
                                    checked={capabilities[option.key]}
                                    onChange={(event) => setCapabilities((current) => ({ ...current, [option.key]: event.target.checked }))}
                                  />
                                  <span>
                                    <strong>{option.label}</strong>
                                    <small>{option.detail}</small>
                                  </span>
                                </label>
                              ))}
                            </div>
                            <label className="dui-recruit-toggle">
                              <input type="checkbox" checked={addToParty} disabled={!partyRoom} onChange={(event) => setAddToParty(event.target.checked)} />
                              <span>{partyRoom ? 'Add to active party' : 'Active party is full'}</span>
                            </label>
                          </section>
                        </div>
                      </div>
                    </section>

                  </div>

                  <div ref={recruitSideRef} className="dui-recruit-side">
                    <section ref={recruitFilesRef} className="dui-recruit-files" data-markdown-tone={activeMarkdownTone} aria-label="Agent markdown bootstrap files">
                      <SectionTitle icon="markdown" label="Markdown files" meta={`${fileOrder.length} authored`} />
                      <p className="dui-recruit-files__intro">Each document becomes part of the agent’s durable operating context. Select a file to edit its identity, memory, instructions, or tools.</p>
                      <div className="dui-recruit-file-toolbar">
                        <div className="dui-recruit-file-tabs" role="tablist" aria-label="Markdown files">
                          {fileOrder.map((file) => (
                            <button
                              key={file}
                              type="button"
                              role="tab"
                              aria-selected={activeFile === file}
                              aria-controls="recruit-markdown-editor-panel"
                              data-md-tone={markdownFileTone(file)}
                              data-file-extension="md"
                              className={activeFile === file ? 'is-active' : ''}
                              onClick={() => setActiveFile(file)}
                              title={`Edit ${file}`}
                            >
                              <span className="dui-recruit-file-tab__icon" aria-hidden="true"><RecruitIcon type="markdown" /></span>
                              <span className="dui-recruit-file-tab__name">{file}</span>
                              <span className="dui-recruit-file-tab__type" aria-hidden="true">MD</span>
                            </button>
                          ))}
                        </div>
                        <div className="dui-recruit-file-add">
                          <input ref={newFileNameInputRef} defaultValue={newFileName} onChange={() => scheduleTextDraftCommit()} onBlur={() => commitTextDrafts()} placeholder="EXTRA.md" />
                          <button type="button" onClick={addMarkdownFile} title="Add a markdown bootstrap file">
                            Add
                            <RecruitIcon type="add" />
                          </button>
                        </div>
                      </div>
                      <div id="recruit-markdown-editor-panel" role="tabpanel" aria-label={`${activeFile} markdown editor`} className={editorClassName} data-md-tone={activeMarkdownTone} onClick={() => editorTextRef.current?.focus()}>
                        <div className="dui-recruit-code-scroll">
                          <div ref={editorGutterRef} className="dui-recruit-code-gutter" aria-hidden="true">
                            {highlightedMarkdownLines.map((_, index) => (
                              <span key={`${activeFile}-line-${index}`}>{index + 1}</span>
                            ))}
                          </div>
                          <pre ref={editorPreviewRef} className="dui-recruit-code-preview" aria-hidden="true">
                            {highlightedMarkdownLines.map((line, index) => (
                              <span key={`${activeFile}-preview-${index}`} className="dui-recruit-code-line">
                                {renderMarkdownLine(line)}
                              </span>
                            ))}
                          </pre>
                          <textarea
                            ref={editorTextRef}
                            className="dui-recruit-code-input"
                            value={activeMarkdownContent}
                            onChange={(event) => {
                              setFilesTouched(true)
                              setResourceFiles((current) => ({ ...current, [activeFile]: event.target.value }))
                              updateEditorCursor(event.currentTarget)
                            }}
                            onClick={(event) => updateEditorCursor(event.currentTarget)}
                            onFocus={(event) => updateEditorCursor(event.currentTarget)}
                            onKeyDown={handleEditorKeyDown}
                            onKeyUp={(event) => updateEditorCursor(event.currentTarget)}
                            onSelect={(event) => updateEditorCursor(event.currentTarget)}
                            onScroll={syncEditorScroll}
                            spellCheck
                            aria-label={`Edit ${activeFile}`}
                          />
                        </div>
                        <div className="dui-recruit-code-status">
                          <span className="dui-recruit-code-mode"><span aria-hidden="true">MD</span>{activeFile}</span>
                          <span>Ln {cursorStatus.line}, Col {cursorStatus.column}</span>
                          <span>{activeMarkdownLineCount} lines</span>
                          <span>{activeMarkdownCharCount} chars</span>
                          {!markdownHighlightEnabled ? <span>Plain text</span> : null}
                          {cursorStatus.selectionLength ? <span>{cursorStatus.selectionLength} selected</span> : null}
                          <span>Spaces: 2</span>
                          <button
                            type="button"
                            className="dui-recruit-code-expand"
                            aria-label={editorExpanded ? 'Collapse markdown editor' : 'Expand markdown editor'}
                            aria-pressed={editorExpanded}
                            title={editorExpanded ? 'Collapse markdown editor' : 'Expand markdown editor'}
                            onClick={(event) => {
                              event.stopPropagation()
                              setEditorExpanded((current) => !current)
                              window.setTimeout(() => {
                                editorTextRef.current?.focus()
                                syncEditorScroll()
                              }, 0)
                            }}
                          >
                            <RecruitIcon type="expand" />
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div className="dui-recruit-footer">
                <p data-tone={statusTone}>
                  <span className="dui-recruit-status-icon">
                    <RecruitIcon type="status" />
                  </span>
                  {status || (idError ? idError : `Ready with ${fileOrder.length} prepared markdown files.`)}
                </p>
                <div>
                  {autoForgeControlsVisible && (
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
                  {autoForgeControlsVisible && (
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
                  <button type="button" className="dui-recruit-secondary" onClick={onClose} disabled={submitting || autoForging} title="Cancel recruitment">
                    Cancel
                  </button>
                  <button type="submit" className="dui-recruit-primary" disabled={!canSubmit} title="Create this agent and bootstrap files">
                    {submitting ? 'Creating...' : 'Create Agent'}
                    <RecruitIcon type="rocket" />
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

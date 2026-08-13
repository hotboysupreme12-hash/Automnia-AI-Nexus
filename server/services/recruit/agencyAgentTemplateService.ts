import { promises as fs } from 'node:fs'
import path from 'node:path'

export type AgencyTemplateBehaviorProfile = 'executor' | 'architect' | 'auditor' | 'researcher' | 'hybrid'
export type AgencyTemplateCapabilityKey = 'codeGeneration' | 'planning' | 'research' | 'orchestration' | 'memoryManagement'

export type AgencyAgentTemplateDocument = {
  file: string
  content: string
}

export type AgencyAgentTemplateDefaults = {
  agentId: string
  name: string
  className: string
  role: string
  behaviorProfile: AgencyTemplateBehaviorProfile
  level: number
  capabilities: Record<AgencyTemplateCapabilityKey, boolean>
  tools: string[]
}

export type AgencyAgentTemplate = {
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
  defaults: AgencyAgentTemplateDefaults
  documents: AgencyAgentTemplateDocument[]
  sourceMarkdown: string
}

export type AgencyAgentTemplateSummary = Omit<AgencyAgentTemplate, 'documents' | 'sourceMarkdown'>

export type AgencyAgentTemplateCatalog = {
  schemaVersion: 1
  source: {
    repository: string
    sourceRoot: string
    commit: string | null
    importedAt: string
    templateCount: number
  }
  divisions: Record<string, { label: string; color: string; icon?: string }>
  templates: AgencyAgentTemplate[]
}

type FrontmatterParseResult = {
  fields: Record<string, string>
  body: string
  sourceMarkdown: string
}

const AGENCY_REPOSITORY = 'msitarzewski/agency-agents'
const AGENCY_REPOSITORY_URL = `https://github.com/${AGENCY_REPOSITORY}`

const FALLBACK_DIVISION_COLORS: Record<string, string> = {
  academic: '#8B5CF6',
  design: '#EC4899',
  engineering: '#3B82F6',
  finance: '#22C55E',
  'game-development': '#A855F7',
  gis: '#14B8A6',
  marketing: '#F97316',
  'paid-media': '#EAB308',
  product: '#D946EF',
  'project-management': '#0EA5E9',
  sales: '#10B981',
  security: '#EF4444',
  'spatial-computing': '#06B6D4',
  specialized: '#6366F1',
  support: '#84CC16',
  testing: '#F59E0B',
}

const AGENCY_DIVISION_ORDER = [
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

const SOURCE_DOC_FILE = 'AGENCY_SOURCE.md'
const NON_TEMPLATE_DIRECTORIES = new Set([
  'assets',
  'docs',
  'examples',
  'integrations',
  'node_modules',
  'scripts',
  'strategy',
])

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function stripQuotes(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function slugifyAgencyTemplate(value: string) {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'agency-agent'
}

function agentIdFromRelativePath(relativePath: string, name: string) {
  const stem = path.basename(relativePath, path.extname(relativePath))
  return slugifyAgencyTemplate(stem || name).slice(0, 60)
}

function parseFrontmatter(raw: string): FrontmatterParseResult | null {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return null
  let endIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      endIndex = index
      break
    }
  }
  if (endIndex < 0) return null

  const fields: Record<string, string> = {}
  for (const line of lines.slice(1, endIndex)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    fields[match[1].trim()] = stripQuotes(match[2] || '')
  }

  const body = lines.slice(endIndex + 1).join('\n').trimStart()
  return { fields, body, sourceMarkdown: normalized }
}

function plainMarkdownDescription(body: string, name: string) {
  const specialization = body.match(/^\*\*Specialization\*\*:\s*(.+)$/im)
  if (specialization?.[1]?.trim()) return specialization[1].trim()
  const line = body
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#') && !entry.startsWith('---'))
  if (!line) return `${name} specialist.`
  return line
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim() || `${name} specialist.`
}

function parsePlainMarkdown(raw: string, filePath: string): FrontmatterParseResult {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const heading = normalized.match(/^#\s+(.+)$/m)
  const name = cleanString(heading?.[1], titleizeDivision(path.basename(filePath, path.extname(filePath))))
  const body = normalized.trimStart()
  return {
    fields: {
      name,
      description: plainMarkdownDescription(body, name),
    },
    body,
    sourceMarkdown: normalized,
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}

async function readTextIfPresent(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function titleizeDivision(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function divisionSortRank(value: string) {
  const index = AGENCY_DIVISION_ORDER.indexOf(value)
  return index === -1 ? AGENCY_DIVISION_ORDER.length : index
}

function compareDivisionNames(left: string, right: string) {
  return divisionSortRank(left) - divisionSortRank(right) || left.localeCompare(right)
}

function normalizeDivisions(value: unknown): Record<string, { label: string; color: string; icon?: string }> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { divisions?: unknown }).divisions
    : null
  const divisions = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const normalized: Record<string, { label: string; color: string; icon?: string }> = {}
  for (const [key, rawEntry] of Object.entries(divisions)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    const entry = rawEntry as Record<string, unknown>
    normalized[key] = {
      label: cleanString(entry.label, titleizeDivision(key)),
      color: cleanString(entry.color, FALLBACK_DIVISION_COLORS[key] || '#64748B'),
      ...(cleanString(entry.icon) ? { icon: cleanString(entry.icon) } : {}),
    }
  }
  return normalized
}

function normalizeToolTargets(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { tools?: unknown }).tools
    : null
  const tools = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return Object.entries(tools)
    .map(([key, rawEntry]) => {
      const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
        ? rawEntry as Record<string, unknown>
        : {}
      return {
        key,
        label: cleanString(entry.label, titleizeDivision(key)),
        installKind: cleanString(entry.installKind, 'per-agent'),
        format: cleanString(entry.format, ''),
        order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 999,
      }
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
}

function toolTargetMarkdown(toolTargets: ReturnType<typeof normalizeToolTargets>) {
  if (!toolTargets.length) return ['- No upstream tool-target catalog was bundled with this source.']
  return toolTargets.map((tool) => {
    const format = tool.format ? `, format: ${tool.format}` : ''
    return `- ${tool.label} (${tool.key}) - ${tool.installKind}${format}`
  })
}

async function discoverDivisionCatalog(sourceRoot: string, divisions: Record<string, { label: string; color: string; icon?: string }>) {
  const configured = Object.keys(divisions)
  if (configured.length) return { divisions, divisionNames: configured.sort(compareDivisionNames) }

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => [])
  const divisionNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !NON_TEMPLATE_DIRECTORIES.has(name.toLowerCase()))
    .sort(compareDivisionNames)
  const discovered: Record<string, { label: string; color: string; icon?: string }> = {}
  for (const division of divisionNames) {
    discovered[division] = {
      label: titleizeDivision(division),
      color: FALLBACK_DIVISION_COLORS[division] || '#64748B',
    }
  }
  return { divisions: discovered, divisionNames }
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath)
    }
  }
  return files
}

function inferBehaviorProfile(division: string, name: string, description: string): AgencyTemplateBehaviorProfile {
  const text = `${division} ${name} ${description}`.toLowerCase()
  if (/\b(audit|auditor|review|reviewer|testing|test|qa|security|compliance|risk|penetration|incident)\b/.test(text)) return 'auditor'
  if (/\b(architect|manager|management|producer|orchestrator|commander|lead|strategist|shepherd|governance)\b/.test(text)) return 'architect'
  if (/\b(research|researcher|analyst|analysis|academic|historian|psychologist|geographer|anthropologist|intelligence)\b/.test(text)) return 'researcher'
  if (/\b(developer|engineer|builder|automator|scripter|responder|operator|designer|creator|writer)\b/.test(text)) return 'executor'
  return 'hybrid'
}

function inferCapabilities(division: string, behaviorProfile: AgencyTemplateBehaviorProfile, name: string, description: string): Record<AgencyTemplateCapabilityKey, boolean> {
  const text = `${division} ${name} ${description}`.toLowerCase()
  const codeDivision = /^(engineering|game-development|spatial-computing|gis|security|testing)$/.test(division)
  const researchDivision = /^(academic|finance|marketing|paid-media|product|sales|security|support|testing|gis|specialized)$/.test(division)
  const orchestrationDivision = division === 'project-management' || /\b(orchestrator|commander|manager|producer|architect|lead|workflow|governance)\b/.test(text)
  return {
    codeGeneration: codeDivision || /\b(code|developer|engineer|frontend|backend|devops|software|firmware|scripter|automation)\b/.test(text),
    planning: true,
    research: researchDivision || behaviorProfile === 'researcher' || /\b(research|analysis|analyst|market|intelligence|audit|discovery)\b/.test(text),
    orchestration: orchestrationDivision,
    memoryManagement: true,
  }
}

function inferTools(capabilities: Record<AgencyTemplateCapabilityKey, boolean>, rawTools = '') {
  const tools = new Set<string>(['message', 'memory', 'planner'])
  if (capabilities.codeGeneration) {
    tools.add('filesystem')
    tools.add('shell')
  }
  if (capabilities.research) {
    tools.add('web_search')
    tools.add('web_fetch')
  }
  if (capabilities.orchestration) {
    tools.add('planner')
    tools.add('message')
  }
  for (const token of rawTools.split(/[,|\s]+/).map((part) => part.trim()).filter(Boolean)) {
    tools.add(token)
  }
  return Array.from(tools).sort((a, b) => a.localeCompare(b))
}

function sectionTargetForHeader(line: string): 'soul' | 'agents' {
  const header = line.toLowerCase()
  if (
    /identity/.test(header) ||
    /learning.*memory/.test(header) ||
    /communication/.test(header) ||
    /style/.test(header) ||
    /critical.*rule/.test(header) ||
    /rules.*must.*follow/.test(header)
  ) {
    return 'soul'
  }
  return 'agents'
}

function splitAgencyBody(body: string) {
  let currentTarget: 'soul' | 'agents' = 'agents'
  let currentSection = ''
  let soul = ''
  let agents = ''
  const flush = () => {
    if (!currentSection) return
    if (currentTarget === 'soul') soul += currentSection
    else agents += currentSection
    currentSection = ''
  }

  for (const line of body.split('\n')) {
    if (/^##\s+/.test(line)) {
      flush()
      currentTarget = sectionTargetForHeader(line)
    }
    currentSection += `${line}\n`
  }
  flush()
  return { soul: soul.trim(), agents: agents.trim() }
}

function ensureDocumentHeading(file: string, name: string, content: string, fallback: string) {
  const body = (content || fallback).trim()
  if (/^#\s+/m.test(body)) return `${body}\n`
  return `# ${file} - ${name}\n\n${body}\n`
}

function buildDocuments(input: {
  name: string
  description: string
  emoji?: string
  vibe?: string
  relativePath: string
  sourceMarkdown: string
  body: string
  tools: string[]
  toolTargets: ReturnType<typeof normalizeToolTargets>
  divisionLabel: string
  defaults: AgencyAgentTemplateDefaults
}) {
  const split = splitAgencyBody(input.body)
  const identityTitle = input.emoji ? `${input.emoji} ${input.name}` : input.name
  const sourceLine = `Source: ${AGENCY_REPOSITORY}/${input.relativePath}`
  const capabilityLines = Object.entries(input.defaults.capabilities)
    .map(([capability, enabled]) => `- ${capability}: ${enabled ? 'enabled' : 'disabled'}`)
  return [
    {
      file: 'IDENTITY.md',
      content: `# ${identityTitle}\n\n${input.vibe || input.description}\n\n${sourceLine}\n`,
    },
    {
      file: 'SOUL.md',
      content: ensureDocumentHeading('SOUL.md', input.name, split.soul, [
        `You are ${input.name}.`,
        input.description,
        '',
        sourceLine,
      ].join('\n')),
    },
    {
      file: 'AGENTS.md',
      content: ensureDocumentHeading('AGENTS.md', input.name, split.agents, input.body || input.description),
    },
    {
      file: 'TOOLS.md',
      content: [
        `# TOOLS.md - ${input.name}`,
        '',
        `Division: ${input.divisionLabel}`,
        `Template source: ${AGENCY_REPOSITORY}/${input.relativePath}`,
        '',
        '## Automnia Runtime Tool Access',
        ...input.tools.map((tool) => `- ${tool}`),
        '',
        '## Capability Flags',
        ...capabilityLines,
        '',
        '## Agency Source Install Targets',
        'The upstream Agency catalog can render agents for these target tools. Automnia Recruit preserves the source persona and converts it into OpenClaw workspace doctrine files.',
        ...toolTargetMarkdown(input.toolTargets),
        '',
        '## Native Services',
        '- Automnia/OpenClaw recruit API',
        '- OpenClaw workspace doctrine files',
        '- Agency Agents source markdown',
        '- Control Center template catalog state',
        '',
      ].join('\n'),
    },
    {
      file: 'BOOTSTRAP.md',
      content: [
        `# BOOTSTRAP.md - ${input.name}`,
        '',
        '## Startup Contract',
        '1. Read IDENTITY.md and SOUL.md first.',
        '2. Use AGENTS.md for the operating workflow and deliverables.',
        `3. Treat ${SOURCE_DOC_FILE} as the original upstream template reference.`,
        '4. Use TOOLS.md for allowed tools and service expectations.',
        '5. Keep MEMORY.md updated with durable discoveries.',
        '',
        `Template: ${input.name}`,
        `Source: ${AGENCY_REPOSITORY}/${input.relativePath}`,
        '',
      ].join('\n'),
    },
    {
      file: 'USER.md',
      content: `# USER.md - ${input.name}\n\nUse the ${input.name} specialty when it fits the user's request. Keep answers concrete, evidence-backed, and scoped to the task.\n`,
    },
    {
      file: 'HEARTBEAT.md',
      content: `# HEARTBEAT.md - ${input.name}\n\nOn heartbeat, report current objective, useful progress, blockers, and the next action for this ${input.defaults.behaviorProfile} lane.\n`,
    },
    {
      file: 'MEMORY.md',
      content: `# MEMORY.md - ${input.name}\n\n## Durable Notes\n- Recruited from the ${AGENCY_REPOSITORY} template at ${input.relativePath}.\n`,
    },
    {
      file: 'MISSION_PROMPT.md',
      content: `# MISSION_PROMPT.md - ${input.name}\n\nDefault mission frame: ${input.description}\n\nUse the original Agency source in ${SOURCE_DOC_FILE} when a task needs the full persona details.\n`,
    },
    {
      file: SOURCE_DOC_FILE,
      content: [
        `# ${SOURCE_DOC_FILE} - ${input.name}`,
        '',
        `Original source: ${AGENCY_REPOSITORY}/${input.relativePath}`,
        '',
        input.sourceMarkdown.trim(),
        '',
      ].join('\n'),
    },
  ]
}

function sourceUrlFor(relativePath: string) {
  return `${AGENCY_REPOSITORY_URL}/blob/main/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

async function readGitHead(sourceRoot: string) {
  const head = (await readTextIfPresent(path.join(sourceRoot, '.git', 'HEAD'))).trim()
  if (!head) {
    const manifest = await readJsonFile(path.join(sourceRoot, '.agency-source.json'))
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      const commit = (manifest as { commit?: unknown }).commit
      return typeof commit === 'string' && commit.trim() ? commit.trim() : null
    }
    return null
  }
  const refMatch = head.match(/^ref:\s*(.+)$/)
  if (!refMatch) return head
  const ref = (await readTextIfPresent(path.join(sourceRoot, '.git', refMatch[1]))).trim()
  return ref || null
}

export async function scanAgencyAgentTemplateCatalog(sourceRoot: string): Promise<AgencyAgentTemplateCatalog> {
  const discovered = await discoverDivisionCatalog(
    sourceRoot,
    normalizeDivisions(await readJsonFile(path.join(sourceRoot, 'divisions.json'))),
  )
  const divisions = discovered.divisions
  const divisionNames = discovered.divisionNames
  const toolTargets = normalizeToolTargets(await readJsonFile(path.join(sourceRoot, 'tools.json')))
  const templates: AgencyAgentTemplate[] = []

  for (const division of divisionNames) {
    const divisionRoot = path.join(sourceRoot, division)
    const files = await collectMarkdownFiles(divisionRoot)
    for (const filePath of files) {
      const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
      const parsed = parseFrontmatter(raw) || parsePlainMarkdown(raw, filePath)
      if (!parsed?.fields.name || !parsed.fields.description) continue
      const relativePath = path.relative(sourceRoot, filePath).replace(/\\/g, '/')
      const divisionInfo = divisions[division] || { label: titleizeDivision(division), color: FALLBACK_DIVISION_COLORS[division] || '#64748B' }
      const name = parsed.fields.name
      const description = parsed.fields.description
      const behaviorProfile = inferBehaviorProfile(division, name, description)
      const capabilities = inferCapabilities(division, behaviorProfile, name, description)
      const tools = inferTools(capabilities, parsed.fields.tools)
      const defaults: AgencyAgentTemplateDefaults = {
        agentId: agentIdFromRelativePath(relativePath, name),
        name,
        className: divisionInfo.label,
        role: description.slice(0, 180),
        behaviorProfile,
        level: behaviorProfile === 'architect' || behaviorProfile === 'auditor' ? 28 : 22,
        capabilities,
        tools,
      }
      const documents = buildDocuments({
        name,
        description,
        emoji: parsed.fields.emoji,
        vibe: parsed.fields.vibe,
        relativePath,
        sourceMarkdown: parsed.sourceMarkdown,
        body: parsed.body,
        tools,
        toolTargets,
        divisionLabel: divisionInfo.label,
        defaults,
      })
      templates.push({
        id: `${division}:${slugifyAgencyTemplate(path.basename(relativePath, path.extname(relativePath)))}`,
        slug: slugifyAgencyTemplate(name),
        name,
        description,
        division,
        divisionLabel: divisionInfo.label,
        color: parsed.fields.color || divisionInfo.color,
        ...(parsed.fields.emoji ? { emoji: parsed.fields.emoji } : {}),
        ...(parsed.fields.vibe ? { vibe: parsed.fields.vibe } : {}),
        relativePath,
        sourceUrl: sourceUrlFor(relativePath),
        defaults,
        documents,
        sourceMarkdown: parsed.sourceMarkdown,
      })
    }
  }

  templates.sort((a, b) => compareDivisionNames(a.division, b.division) || a.name.localeCompare(b.name))
  return {
    schemaVersion: 1,
    source: {
      repository: AGENCY_REPOSITORY,
      sourceRoot,
      commit: await readGitHead(sourceRoot),
      importedAt: new Date().toISOString(),
      templateCount: templates.length,
    },
    divisions,
    templates,
  }
}

function normalizeTemplateCatalog(value: unknown): AgencyAgentTemplateCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const catalog = value as Partial<AgencyAgentTemplateCatalog>
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.templates)) return null
  return catalog as AgencyAgentTemplateCatalog
}

function catalogMatchesSource(catalog: AgencyAgentTemplateCatalog | null, sourceAvailable: boolean, sourceCommit: string | null) {
  if (!catalog) return null
  if (sourceAvailable && sourceCommit && catalog.source.commit !== sourceCommit) return null
  return catalog
}

function catalogMatchesExpandedSource(catalog: AgencyAgentTemplateCatalog | null, sourceHasExpandedRoster: boolean) {
  if (!catalog) return null
  if (sourceHasExpandedRoster && catalog.templates.length <= 51) return null
  return catalog
}

export async function loadAgencyAgentTemplateCatalog(options: {
  sourceRoot: string
  stateKey: string
  stateFilePath: string
  forceRefresh?: boolean
  readState: <T>(stateKey: string) => T | null
  writeState: (stateKey: string, value: unknown, sourcePath?: string) => boolean
  readTemplateCatalog?: () => AgencyAgentTemplateCatalog | null
  writeTemplateCatalog?: (catalog: AgencyAgentTemplateCatalog) => boolean
}) {
  const sourceAvailable = await pathExists(options.sourceRoot)
  const sourceCommit = sourceAvailable ? await readGitHead(options.sourceRoot) : null
  const sourceHasExpandedRoster = sourceAvailable
    ? await pathExists(path.join(options.sourceRoot, 'specialized', 'grant-writer.md'))
    : false
  const sqliteCatalog = options.forceRefresh
    ? null
    : catalogMatchesExpandedSource(
      catalogMatchesSource(normalizeTemplateCatalog(options.readTemplateCatalog?.()), sourceAvailable, sourceCommit),
      sourceHasExpandedRoster,
    )
  if (sqliteCatalog) return sqliteCatalog

  const cached = options.forceRefresh
    ? null
    : catalogMatchesExpandedSource(
      catalogMatchesSource(normalizeTemplateCatalog(options.readState(options.stateKey)), sourceAvailable, sourceCommit),
      sourceHasExpandedRoster,
    )
  if (cached) {
    options.writeTemplateCatalog?.(cached)
    return cached
  }

  if (!options.forceRefresh) {
    const diskCatalog = catalogMatchesSource(
      normalizeTemplateCatalog(await readJsonFile(options.stateFilePath)),
      sourceAvailable,
      sourceCommit,
    )
    const expandedDiskCatalog = catalogMatchesExpandedSource(diskCatalog, sourceHasExpandedRoster)
    if (expandedDiskCatalog) {
      options.writeTemplateCatalog?.(expandedDiskCatalog)
      return expandedDiskCatalog
    }
  }

  if (!sourceAvailable) {
    const diskCatalog = normalizeTemplateCatalog(await readJsonFile(options.stateFilePath))
    if (diskCatalog) {
      options.writeTemplateCatalog?.(diskCatalog)
      return diskCatalog
    }
    throw new Error(`Agency template source not found: ${options.sourceRoot}`)
  }

  const catalog = await scanAgencyAgentTemplateCatalog(options.sourceRoot)
  options.writeState(options.stateKey, catalog, options.sourceRoot)
  options.writeTemplateCatalog?.(catalog)
  try {
    await fs.mkdir(path.dirname(options.stateFilePath), { recursive: true })
    await fs.writeFile(options.stateFilePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8')
  } catch {
    // SQLite-backed state remains the primary store; disk snapshot is best effort.
  }
  return catalog
}

export function summarizeAgencyAgentTemplate(template: AgencyAgentTemplate): AgencyAgentTemplateSummary {
  const summary: Partial<AgencyAgentTemplate> = { ...template }
  delete summary.documents
  delete summary.sourceMarkdown
  return summary as AgencyAgentTemplateSummary
}

import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { lstat, mkdtemp, mkdir, opendir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import { createSkillWorkshopService, SkillWorkshopError, SKILL_ID_PATTERN, type SkillWorkshopSource } from '../services/skills/skillWorkshopService'

type OpenClawCommandResult = {
  stdout: string
  stderr: string
  code: number
}

type OpenClawCommandOptions = {
  cwd?: string
  envOverrides?: Record<string, string>
  signal?: AbortSignal
}

type ClawHubInstallResult = {
  result: OpenClawCommandResult
  retried: boolean
  cleanup?: unknown
}

type ClawHubInstallConfirmation = {
  confirmationId: string
  skillRef: string
  version?: string
  outcome: string
  publisher?: string
  summary: string
  detailsUrl?: string
}

type PendingClawHubOperation = {
  operation: 'install' | 'update'
  skillRef: string
  version?: string
  force: boolean
  all: boolean
  expiresAt: number
}

type SkillPreviewOperation = 'install' | 'update'
type SkillPreviewFile = { path: string; sizeBytes: number; mode: number; sha256: string }
type SkillPreviewChange = {
  path: string
  change: 'added' | 'removed' | 'modified'
  before?: SkillPreviewFile
  after?: SkillPreviewFile
  contentPreview?: {
    kind: 'text' | 'binary' | 'omitted' | 'permission-only'
    before?: { text: string; truncated: boolean }
    after?: { text: string; truncated: boolean }
  }
}
type PendingSkillPreview = {
  previewId: string
  operation: SkillPreviewOperation
  skillRef: string
  skillId: string
  version: string
  stagingRoot: string
  stateRoot: string
  workspaceRoot: string
  configPath: string
  expiresAt: number
  currentSha256: string | null
  stagedSha256: string
  changes: SkillPreviewChange[]
  stagingBytes: number
}

const MAX_SKILL_PREVIEW_COUNT = 8
const MAX_SKILL_PREVIEW_TREE_BYTES = 64 * 1024 * 1024
const MAX_SKILL_PREVIEW_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_SKILL_PREVIEW_TREE_ENTRIES = 2_000
const MAX_SKILL_PREVIEW_TEXT_FILES = 24
const MAX_SKILL_PREVIEW_TEXT_BYTES = 128 * 1024
const MAX_SKILL_PREVIEW_TTL_MS = 10 * 60 * 1000

class SkillPreviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillPreviewError'
  }
}

type SkillRoutesOptions = {
  findSkillContent: (skillId: string, agentId?: string) => Promise<unknown | null>
  installClawHubSkillWithRetry: (args: string[], slug: string) => Promise<ClawHubInstallResult>
  invalidateSkillLibraryCache: (root?: string) => void
  listSkillsFromRoot: (root: string, source: 'library' | 'agent') => Promise<unknown[]>
  readAgentSkillLibrary: (agentId?: string) => Promise<{
    shared: unknown[]
    agent: unknown[]
    agentSkillsRoot: string | null
  }>
  readSkillEntryFromDir: (root: string, skillId: string, source: 'library' | 'agent') => Promise<unknown | null>
  resolveSkillsCommandContext: (agentId?: string) => Promise<OpenClawCommandOptions>
  runOpenClaw: (args: string[], timeoutMs?: number, options?: OpenClawCommandOptions) => Promise<OpenClawCommandResult>
  runOpenClawWithManagedSkillsWorkspace: (args: string[], timeoutMs: number) => Promise<OpenClawCommandResult>
  sharedSkillsRoot: string
  slugifySkillId: (value: string) => string
  writeLearnedSkill: (params: {
    agentId: string
    name: string
    description: string
    body: string
    shared: boolean
    xpValue: number
  }) => Promise<unknown>
  skillPreviewTtlMs?: number
  now?: () => number
}

const CLAWHUB_SKILL_REFERENCE_PATTERN = /^(?:@?[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isInsideDirectory(rootInput: string, targetInput: string) {
  const root = path.resolve(rootInput)
  const target = path.resolve(targetInput)
  const relative = path.relative(root, target)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function pathsOverlap(first: string, second: string) {
  return isInsideDirectory(first, second) || isInsideDirectory(second, first)
}

function clawHubResultReference(value: unknown) {
  const result = asRecord(value)
  if (!result) return ''
  const install = asRecord(result.install)
  const reference = typeof install?.reference === 'string' ? install.reference
    : typeof result.reference === 'string' ? result.reference
      : typeof result.slug === 'string' && (typeof result.ownerHandle === 'string' || asRecord(result.owner)?.handle)
        ? `${String(result.ownerHandle || asRecord(result.owner)?.handle)}/${result.slug}`
        : ''
  return resolveClawHubSkillReference({ skillRef: reference })
}

function resolveSearchVersion(output: string, expectedSkillRef: string) {
  let parsed: unknown
  try { parsed = JSON.parse(output || '{}') } catch { return '' }
  const payload = asRecord(parsed)
  const results = Array.isArray(payload?.results) ? payload.results : []
  const expected = resolveClawHubSkillReference({ skillRef: expectedSkillRef })
  const match = results.find((candidate) => clawHubResultReference(candidate).toLowerCase() === expected.toLowerCase())
  const result = asRecord(match)
  const version = typeof result?.version === 'string' ? result.version
    : typeof result?.latestVersion === 'string' ? result.latestVersion
      : ''
  return version.trim().slice(0, 80)
}

function skillPreviewChanges(beforeFiles: SkillPreviewFile[], afterFiles: SkillPreviewFile[]): SkillPreviewChange[] {
  const before = new Map(beforeFiles.map((file) => [file.path, file]))
  const after = new Map(afterFiles.map((file) => [file.path, file]))
  const changes: SkillPreviewChange[] = []
  for (const file of afterFiles) {
    const previous = before.get(file.path)
    if (!previous) changes.push({ path: file.path, change: 'added', after: file })
    else if (previous.sha256 !== file.sha256 || previous.sizeBytes !== file.sizeBytes || previous.mode !== file.mode) {
      changes.push({ path: file.path, change: 'modified', before: previous, after: file })
    }
  }
  for (const file of beforeFiles) {
    if (!after.has(file.path)) changes.push({ path: file.path, change: 'removed', before: file })
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

async function measureSkillPreviewTree(rootInput: string) {
  const root = path.resolve(rootInput)
  let totalBytes = 0
  let entriesVisited = 0
  async function visit(directoryPath: string, depth: number): Promise<void> {
    if (depth > 12) throw new SkillPreviewError('The staged skill preview exceeds the directory depth limit.')
    const directoryStat = await lstat(directoryPath)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new SkillPreviewError('The staged skill preview contains an unsafe directory.')
    const directory = await opendir(directoryPath)
    for await (const entry of directory) {
      entriesVisited += 1
      if (entriesVisited > MAX_SKILL_PREVIEW_TREE_ENTRIES) throw new SkillPreviewError('The staged skill preview exceeds the entry limit.')
      if (entry.isSymbolicLink()) throw new SkillPreviewError('The staged skill preview contains a symbolic link.')
      const target = path.resolve(directoryPath, entry.name)
      if (!isInsideDirectory(root, target) || target === root) throw new SkillPreviewError('The staged skill preview contains an unsafe path.')
      if (entry.isDirectory()) {
        await visit(target, depth + 1)
        continue
      }
      if (!entry.isFile()) throw new SkillPreviewError('The staged skill preview contains an unsupported file type.')
      const stat = await lstat(target)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new SkillPreviewError('The staged skill preview contains an unsafe file.')
      totalBytes += stat.size
      if (totalBytes > MAX_SKILL_PREVIEW_TREE_BYTES) throw new SkillPreviewError('The staged skill preview exceeds the byte limit.')
    }
  }
  await visit(root, 0)
  return totalBytes
}

/**
 * The ClawHub API exposes lifetime downloads at the result level and star
 * ratings inside native.skill.stats. Keep a stable, compact API shape for
 * the renderer while tolerating equivalent registry response variants.
 */
function normalizeClawHubSearchResult(value: unknown) {
  const result = asRecord(value)
  if (!result) return value
  const native = asRecord(result.native)
  const skill = asRecord(native?.skill)
  const stats = asRecord(skill?.stats) || asRecord(result.stats)
  const downloads = finiteNumber(result.downloads)
    ?? finiteNumber(result.downloadCount)
    ?? finiteNumber(stats?.downloads)
  const rating = finiteNumber(result.rating)
    ?? finiteNumber(result.stars)
    ?? finiteNumber(stats?.rating)
    ?? finiteNumber(stats?.stars)
  return {
    ...result,
    ...(downloads === undefined ? {} : { downloads }),
    ...(rating === undefined ? {} : { rating }),
  }
}

function queryAgentId(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function resolveClawHubSkillReference(value: { skillRef?: string; slug?: string }) {
  const reference = (value.skillRef || value.slug || '').trim()
  if (!CLAWHUB_SKILL_REFERENCE_PATTERN.test(reference)) return ''
  // Current OpenClaw requires the @ prefix for a publisher-qualified ClawHub
  // reference. Older search responses may omit it (for example,
  // "grpaiva/youtube"), so canonicalize before invoking the CLI.
  return reference.includes('/') && !reference.startsWith('@') ? `@${reference}` : reference
}

function clawHubSkillSlug(reference: string) {
  const normalized = reference.replace(/^@/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function stripAnsi(text: string) {
  const ansiCsiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
  return text.replace(ansiCsiPattern, '')
}

function clawHubAuditLines(text: string) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*[╭╰│|]\s?/, '')
      .replace(/\s*[╮╯│|]\s*$/, '')
      .replace(/[─]+/g, '')
      .trim())
    .filter(Boolean)
}

function parseClawHubSecurityReview(text: string, fallbackSkillRef: string, fallbackVersion?: string) {
  const normalized = stripAnsi(text)
  if (!/clawhub\s+security\s+audit|security\.installPolicy/i.test(normalized)) return null
  const outcome = normalized.match(/Outcome:\s*([^\r\n│|]+)/i)?.[1]?.trim() || ''
  if (!outcome || !/review|warn|warning|block|reject|fail/i.test(outcome)) return null

  const lines = clawHubAuditLines(normalized)
  const overviewIndex = lines.findIndex((line) => /^Overview:\s*$/i.test(line))
  const detailsIndex = lines.findIndex((line, index) => index > overviewIndex && /^Details:\s*/i.test(line))
  const overviewLines = overviewIndex >= 0
    ? lines.slice(overviewIndex + 1, detailsIndex >= 0 ? detailsIndex : undefined)
    : []
  const summary = overviewLines.join(' ').replace(/\s+/g, ' ').trim()
  const reportedReference = normalized.match(/(?:^|\n)\s*[│|]\s*(@?[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}(?:@[^\s│|]+)?)\s*[│|]/i)?.[1]
  const skillRef = reportedReference?.replace(/@([^/]+\/[^@\s│|]+)@[^@\s│|]+$/, '@$1') || fallbackSkillRef
  const version = fallbackVersion || reportedReference?.match(/@([^/]+\/[^@\s│|]+)@([^\s│|]+)/)?.[2]
  const publisher = skillRef.match(/^@?([^/]+)\//)?.[1]
  const detailsUrl = normalized.match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/i)?.[1]

  return {
    skillRef,
    ...(version ? { version } : {}),
    outcome,
    ...(publisher ? { publisher } : {}),
    summary: summary || 'ClawHub marked this skill for security review before installation.',
    ...(detailsUrl ? { detailsUrl } : {}),
  }
}

export function registerSkillRoutes(app: Express, options: SkillRoutesOptions) {
  const skillWorkshop = createSkillWorkshopService(options.sharedSkillsRoot)
  const pendingClawHubOperations = new Map<string, PendingClawHubOperation>()
  const pendingOperationTtlMs = 10 * 60 * 1000
  const pendingSkillPreviews = new Map<string, PendingSkillPreview>()
  const previewTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const previewTtlMs = typeof options.skillPreviewTtlMs === 'number' && Number.isSafeInteger(options.skillPreviewTtlMs) && options.skillPreviewTtlMs > 0
    ? Math.min(options.skillPreviewTtlMs, MAX_SKILL_PREVIEW_TTL_MS)
    : MAX_SKILL_PREVIEW_TTL_MS
  const currentTime = options.now || Date.now
  const previewCleanupTasks = new Map<string, Promise<void>>()

  const discardSkillPreview = async (previewId: string) => {
    const preview = pendingSkillPreviews.get(previewId)
    if (!preview) {
      await previewCleanupTasks.get(previewId)
      return
    }
    pendingSkillPreviews.delete(previewId)
    const timer = previewTimers.get(previewId)
    if (timer) clearTimeout(timer)
    previewTimers.delete(previewId)
    const cleanupTask = rm(preview.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    previewCleanupTasks.set(previewId, cleanupTask)
    await cleanupTask
    if (previewCleanupTasks.get(previewId) === cleanupTask) previewCleanupTasks.delete(previewId)
  }

  const pruneSkillPreviews = async () => {
    const now = currentTime()
    for (const [previewId, preview] of pendingSkillPreviews) {
      if (preview.expiresAt <= now) await discardSkillPreview(previewId)
    }
  }

  const stageContext = async (preview: Pick<PendingSkillPreview, 'stagingRoot' | 'stateRoot' | 'workspaceRoot' | 'configPath'>) => {
    const base = await options.resolveSkillsCommandContext()
    const envOverrides = { ...(base.envOverrides || {}) }
    envOverrides.OPENCLAW_HOME = preview.stagingRoot
    envOverrides.OPENCLAW_STATE_DIR = preview.stateRoot
    envOverrides.OPENCLAW_CONFIG_PATH = preview.configPath
    envOverrides.OPENCLAW_WORKSPACE_DIR = preview.workspaceRoot
    envOverrides.OPENCLAW_PROFILE = ''
    return { ...base, cwd: preview.workspaceRoot, envOverrides }
  }

  const searchClawHubVersion = async (preview: Pick<PendingSkillPreview, 'stagingRoot' | 'stateRoot' | 'workspaceRoot' | 'configPath'>, skillRef: string) => {
    const context = await stageContext(preview)
    const result = await options.runOpenClaw(['skills', 'search', clawHubSkillSlug(skillRef), '--json', '--limit', '30'], 90_000, context)
    if (result.code !== 0) throw new SkillPreviewError('ClawHub could not confirm the selected skill version.')
    return resolveSearchVersion(result.stdout, skillRef)
  }

  const scanOptionalSkill = async (root: string, skillId: string) => {
    try {
      return await skillWorkshop.scanIntegrity(root, skillId)
    } catch (error) {
      if (error instanceof SkillWorkshopError && error.code === 'skill_not_found') return null
      throw error
    }
  }

  const createSkillPreview = async (operation: SkillPreviewOperation, skillRef: string, requestedVersion?: string) => {
    await pruneSkillPreviews()
    if (pendingSkillPreviews.size >= MAX_SKILL_PREVIEW_COUNT) throw new SkillPreviewError('Too many skill previews are waiting for confirmation. Apply or cancel one before starting another.')
    const skillId = options.slugifySkillId(clawHubSkillSlug(skillRef))
    if (!SKILL_ID_PATTERN.test(skillId)) throw new SkillPreviewError('The ClawHub skill id is invalid.')
    // macOS may expose the temporary directory through a symlink (for example,
    // /var -> /private/var). Keep staged skills on the physical path because
    // the preview integrity checks reject symlinked ancestors.
    const stagingRoot = await mkdtemp(path.join(await realpath(os.tmpdir()), 'automnia-clawhub-preview-'))
    if (pathsOverlap(stagingRoot, options.sharedSkillsRoot)) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      throw new SkillPreviewError('The temporary preview location overlaps the shared skills directory.')
    }
    const stateRoot = path.join(stagingRoot, 'state')
    const workspaceRoot = path.join(stagingRoot, 'workspace')
    const configPath = path.join(stateRoot, 'openclaw.json')
    const stagedSkillsRoot = path.join(stateRoot, 'skills')
    let retained = false
    try {
      await mkdir(stateRoot)
      await mkdir(workspaceRoot)
      const config = {
        skills: { load: { watch: false, extraDirs: [stagedSkillsRoot] }, entries: {}, install: { nodeManager: 'npm' } },
        agents: { defaults: { workspace: workspaceRoot }, entries: { main: { workspace: workspaceRoot } } },
      }
      await writeFile(configPath, `${JSON.stringify(config)}\n`, 'utf8')
      const previewContext = { stagingRoot, stateRoot, workspaceRoot, configPath }
      const version = await searchClawHubVersion(previewContext, skillRef)
      if (!version) throw new SkillPreviewError('ClawHub did not return an exact version for this skill.')
      if (requestedVersion && requestedVersion !== version) throw new SkillPreviewError('The ClawHub result changed. Refresh the search and preview the current version.')

      const installArgs = ['skills', 'install', skillRef, '--version', version, '--global']
      const result = await options.runOpenClaw(installArgs, 120_000, await stageContext(previewContext))
      if (result.code !== 0) throw new SkillPreviewError('OpenClaw could not stage this ClawHub skill safely.')

      const stagingBytes = await measureSkillPreviewTree(stagingRoot)
      const stagedIntegrity = await skillWorkshop.scanIntegrity(stagedSkillsRoot, skillId)
      const currentIntegrity = await scanOptionalSkill(options.sharedSkillsRoot, skillId)
      let textPreviewBytes = 0
      let textPreviewFiles = 0
      const changes = skillPreviewChanges(currentIntegrity?.files || [], stagedIntegrity.files)
      for (let index = 0; index < changes.length; index += 1) {
        const change = changes[index]!
        if (change.before && change.after && change.before.sha256 === change.after.sha256) {
          changes[index] = { ...change, contentPreview: { kind: 'permission-only' } }
          continue
        }
        if (textPreviewFiles >= MAX_SKILL_PREVIEW_TEXT_FILES) {
          changes[index] = { ...change, contentPreview: { kind: 'omitted' } }
          continue
        }
        const beforePreview = change.before
          ? await skillWorkshop.readTextPreview(options.sharedSkillsRoot, skillId, change.path)
          : null
        const afterPreview = change.after
          ? await skillWorkshop.readTextPreview(stagedSkillsRoot, skillId, change.path)
          : null
        if (beforePreview?.kind === 'binary' || afterPreview?.kind === 'binary') {
          changes[index] = { ...change, contentPreview: { kind: 'binary' } }
          continue
        }
        const beforeText = beforePreview?.kind === 'text' ? beforePreview : null
        const afterText = afterPreview?.kind === 'text' ? afterPreview : null
        const previewBytes = Buffer.byteLength(beforeText?.text || '', 'utf8') + Buffer.byteLength(afterText?.text || '', 'utf8')
        if (textPreviewBytes + previewBytes > MAX_SKILL_PREVIEW_TEXT_BYTES) {
          changes[index] = { ...change, contentPreview: { kind: 'omitted' } }
          continue
        }
        textPreviewBytes += previewBytes
        textPreviewFiles += 1
        changes[index] = {
          ...change,
          contentPreview: {
            kind: 'text',
            ...(beforeText ? { before: { text: beforeText.text, truncated: beforeText.truncated } } : {}),
            ...(afterText ? { after: { text: afterText.text, truncated: afterText.truncated } } : {}),
          },
        }
      }
      const previewId = randomUUID()
      const expiresAt = currentTime() + previewTtlMs
      const preview: PendingSkillPreview = {
        previewId,
        operation,
        skillRef,
        skillId,
        version,
        stagingRoot,
        stateRoot,
        workspaceRoot,
        configPath,
        expiresAt,
        currentSha256: currentIntegrity?.sha256 || null,
        stagedSha256: stagedIntegrity.sha256,
        changes,
        stagingBytes,
      }
      const retainedBytes = [...pendingSkillPreviews.values()].reduce((total, item) => total + item.stagingBytes, 0)
      if (retainedBytes + stagingBytes > MAX_SKILL_PREVIEW_TOTAL_BYTES) {
        throw new SkillPreviewError('Pending skill previews exceed the temporary storage budget. Apply or cancel an existing preview first.')
      }
      pendingSkillPreviews.set(previewId, preview)
      const timer = setTimeout(() => { void discardSkillPreview(previewId) }, previewTtlMs)
      timer.unref?.()
      previewTimers.set(previewId, timer)
      retained = true
      return {
        previewId,
        operation,
        skillRef,
        version,
        expiresAt: new Date(expiresAt).toISOString(),
        currentSha256: preview.currentSha256,
        stagedSha256: stagedIntegrity.sha256,
        totalBytes: stagedIntegrity.totalBytes,
        files: stagedIntegrity.files.length,
        changes,
      }
    } finally {
      if (!retained) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const validateSkillPreviewForApply = async (preview: PendingSkillPreview, operation: SkillPreviewOperation, skillRef: string, version: string) => {
    if (preview.operation !== operation || preview.skillRef !== skillRef || preview.version !== version) return 'The preview does not match this skill operation.'
    const latestVersion = await searchClawHubVersion(preview, preview.skillRef)
    if (latestVersion !== preview.version) return 'The ClawHub version changed after preview. Create a new preview before applying.'
    const current = await scanOptionalSkill(options.sharedSkillsRoot, preview.skillId)
    if ((current?.sha256 || null) !== preview.currentSha256) return 'The installed skill changed after preview. Create a new preview before applying.'
    const staged = await skillWorkshop.scanIntegrity(path.join(preview.stateRoot, 'skills'), preview.skillId)
    if (staged.sha256 !== preview.stagedSha256) return 'The staged files changed after preview. Create a new preview before applying.'
    return null
  }

  const prunePendingOperations = () => {
    const now = Date.now()
    for (const [confirmationId, operation] of pendingClawHubOperations) {
      if (operation.expiresAt <= now) pendingClawHubOperations.delete(confirmationId)
    }
  }

  const issueClawHubConfirmation = (params: {
    operation: PendingClawHubOperation['operation']
    skillRef: string
    version?: string
    force?: boolean
    all?: boolean
    output: string
  }): ClawHubInstallConfirmation | null => {
    prunePendingOperations()
    const review = parseClawHubSecurityReview(params.output, params.skillRef, params.version)
    if (!review) return null
    const confirmationId = randomUUID()
    pendingClawHubOperations.set(confirmationId, {
      operation: params.operation,
      skillRef: params.skillRef,
      ...(params.version ? { version: params.version } : {}),
      force: Boolean(params.force),
      all: Boolean(params.all),
      expiresAt: Date.now() + pendingOperationTtlMs,
    })
    return { confirmationId, ...review }
  }

  const consumeClawHubConfirmation = (params: {
    confirmationId?: string
    operation: PendingClawHubOperation['operation']
    skillRef: string
    version?: string
    force?: boolean
    all?: boolean
  }) => {
    prunePendingOperations()
    const confirmationId = params.confirmationId?.trim() || ''
    const pending = confirmationId ? pendingClawHubOperations.get(confirmationId) : undefined
    if (!pending || pending.operation !== params.operation || pending.skillRef !== params.skillRef ||
      pending.version !== params.version || pending.force !== Boolean(params.force) || pending.all !== Boolean(params.all)) {
      return false
    }
    pendingClawHubOperations.delete(confirmationId)
    return true
  }

  const resolveSkillRoot = async (source: SkillWorkshopSource, agentId?: string) => {
    if (source === 'library') return options.sharedSkillsRoot
    const library = await options.readAgentSkillLibrary(agentId)
    if (!library.agentSkillsRoot) throw new SkillWorkshopError('skill_not_found', 'Agent skill root is unavailable.')
    return library.agentSkillsRoot
  }

  const preflightSkillRoots = async (agentId?: string, quarantineChanges = true) => {
    const sharedQuarantined = await skillWorkshop.quarantineChangedSkills(options.sharedSkillsRoot, 'library', undefined, quarantineChanges)
    let agentQuarantined: string[] = []
    if (agentId) {
      const library = await options.readAgentSkillLibrary(agentId)
      if (library.agentSkillsRoot) agentQuarantined = await skillWorkshop.quarantineChangedSkills(library.agentSkillsRoot, 'agent', agentId, quarantineChanges)
    }
    if (sharedQuarantined.length) options.invalidateSkillLibraryCache(options.sharedSkillsRoot)
    if (agentId && agentQuarantined.length) {
      const library = await options.readAgentSkillLibrary(agentId)
      if (library.agentSkillsRoot) options.invalidateSkillLibraryCache(library.agentSkillsRoot)
    }
    return [...sharedQuarantined, ...agentQuarantined]
  }

  const skillWorkshopFailure = (res: Parameters<typeof apiFailure>[0], error: unknown) => {
    if (!(error instanceof SkillWorkshopError)) return apiFailure(res, 500, 'skill_operation_failed', 'Skill Workshop operation failed safely.')
    const status = error.code === 'skill_workshop_limit' ? 413
      : error.code === 'skill_not_found' ? 404
        : 409
    const code = error.code === 'skill_workshop_limit' ? 'skill_integrity_limit'
      : error.code === 'skill_not_found' ? 'skill_not_found'
        : 'skill_operation_failed'
    const message = error.code === 'skill_workshop_limit' ? 'Skill integrity scan exceeded its safety limits.' : error.message
    return apiFailure(res, status, code, message, { kind: error.code })
  }

  app.get('/api/skills/check', async (req, res) => {
    try {
      const agentId = queryAgentId(req.query.agentId)
      await preflightSkillRoots(agentId)
      const context = await options.resolveSkillsCommandContext(agentId)
      const result = await options.runOpenClaw(['skills', 'check'], 90000, context)
      const data = { agentId: agentId || null, output: result.stdout, code: result.code }
      if (result.code !== 0) {
        return apiFailure(res, 500, 'skill_command_failed', 'Skill check failed', { ...data, error: result.stderr })
      }
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to check skills', String(error))
    }
  })

  app.get('/api/skills/list', async (req, res) => {
    try {
      const agentId = queryAgentId(req.query.agentId)
      await preflightSkillRoots(agentId)
      const context = await options.resolveSkillsCommandContext(agentId)
      const result = await options.runOpenClaw(['skills', 'list'], 90000, context)
      const data = { agentId: agentId || null, output: result.stdout, code: result.code }
      if (result.code !== 0) {
        return apiFailure(res, 500, 'skill_command_failed', 'Skill list failed', { ...data, error: result.stderr })
      }
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to list skills', String(error))
    }
  })

  app.get('/api/skills/info/:skillName', async (req, res) => {
    try {
      const skillName = req.params.skillName?.trim()
      if (!skillName) return apiFailure(res, 400, 'invalid_payload', 'Skill name is required')
      const agentId = queryAgentId(req.query.agentId)
      await preflightSkillRoots(agentId)
      const context = await options.resolveSkillsCommandContext(agentId)
      const result = await options.runOpenClaw(['skills', 'info', skillName], 90000, context)
      const data = { agentId: agentId || null, skillName, output: result.stdout, code: result.code }
      if (result.code !== 0) {
        return apiFailure(res, 500, 'skill_command_failed', 'Skill info failed', { ...data, error: result.stderr })
      }
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to read skill info', String(error))
    }
  })

  app.get('/api/skills/library', async (req, res) => {
    try {
      const agentId = queryAgentId(req.query.agentId)
      await preflightSkillRoots(agentId, false)
      if (req.query.refresh === '1') options.invalidateSkillLibraryCache()
      const { shared, agent, agentSkillsRoot } = await options.readAgentSkillLibrary(agentId)
      return apiSuccess(res, {
        agentId: agentId || null,
        shared,
        agent,
        index: null,
        paths: {
          shared: options.sharedSkillsRoot,
          agent: agentSkillsRoot,
        },
      })
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.get('/api/skills/library/:skillId/integrity', async (req, res) => {
    try {
      const skillId = options.slugifySkillId(req.params.skillId?.trim() || '')
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(skillId)) {
        return apiFailure(res, 400, 'invalid_payload', 'Skill id is invalid')
      }
      const agentId = queryAgentId(req.query.agentId)
      await preflightSkillRoots(agentId, false)
      const library = await options.readAgentSkillLibrary(agentId)
      const findEntry = (entries: unknown[]) => entries.find((value) => {
        const entry = asRecord(value)
        return entry && typeof entry.id === 'string' && options.slugifySkillId(entry.id) === skillId
      })
      const agentEntry = findEntry(library.agent)
      const sharedEntry = agentEntry ? undefined : findEntry(library.shared)
      const entry = asRecord(agentEntry || sharedEntry)
      if (!entry) return apiFailure(res, 404, 'skill_not_found', 'Skill not found')

      const root = agentEntry ? library.agentSkillsRoot : options.sharedSkillsRoot
      if (!root) return apiFailure(res, 404, 'skill_not_found', 'Skill files are unavailable')
      const comparison = await skillWorkshop.inspect(root, skillId, agentEntry ? 'agent' : 'library', agentEntry ? agentId : undefined)
      return apiSuccess(res, {
        skill: { id: skillId, source: agentEntry ? 'agent' : 'library' },
        algorithm: 'sha256',
        complete: true,
        ...comparison.current,
        comparison: {
          status: comparison.status,
          baseline: comparison.baseline,
          revisionCount: comparison.revisionCount,
          canRollback: comparison.canRollback,
          added: comparison.added,
          removed: comparison.removed,
          modified: comparison.modified,
        },
      })
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.post('/api/skills/library/:skillId/verify', async (req, res) => {
    const parsed = z.object({ source: z.enum(['library', 'agent']).default('library'), agentId: z.string().regex(/^[a-z0-9-]+$/).optional() }).safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid skill verification request', parsed.error.flatten())
    try {
      const skillId = options.slugifySkillId(req.params.skillId?.trim() || '')
      if (!SKILL_ID_PATTERN.test(skillId)) return apiFailure(res, 400, 'invalid_payload', 'Skill id is invalid')
      await preflightSkillRoots(parsed.data.agentId, false)
      const root = await resolveSkillRoot(parsed.data.source, parsed.data.agentId)
      const result = await skillWorkshop.verify(root, skillId, parsed.data.source, parsed.data.agentId)
      options.invalidateSkillLibraryCache(root)
      return apiSuccess(res, { skillId, source: parsed.data.source, ...result })
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.post('/api/skills/library/:skillId/rollback', async (req, res) => {
    const parsed = z.object({ source: z.enum(['library', 'agent']).default('library'), agentId: z.string().regex(/^[a-z0-9-]+$/).optional() }).safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid skill rollback request', parsed.error.flatten())
    try {
      const skillId = options.slugifySkillId(req.params.skillId?.trim() || '')
      if (!SKILL_ID_PATTERN.test(skillId)) return apiFailure(res, 400, 'invalid_payload', 'Skill id is invalid')
      await preflightSkillRoots(parsed.data.agentId, false)
      const root = await resolveSkillRoot(parsed.data.source, parsed.data.agentId)
      const result = await skillWorkshop.rollback(root, skillId, parsed.data.source, parsed.data.agentId)
      options.invalidateSkillLibraryCache(root)
      return apiSuccess(res, { skillId, source: parsed.data.source, ...result })
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.post('/api/skills/library/:skillId/quarantine', async (req, res) => {
    const parsed = z.object({ source: z.enum(['library', 'agent']).default('library'), agentId: z.string().regex(/^[a-z0-9-]+$/).optional(), reason: z.string().trim().max(200).default('Quarantined by the operator.') }).safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid skill quarantine request', parsed.error.flatten())
    try {
      const skillId = options.slugifySkillId(req.params.skillId?.trim() || '')
      if (!SKILL_ID_PATTERN.test(skillId)) return apiFailure(res, 400, 'invalid_payload', 'Skill id is invalid')
      await preflightSkillRoots(parsed.data.agentId, false)
      const root = await resolveSkillRoot(parsed.data.source, parsed.data.agentId)
      const result = await skillWorkshop.quarantine(root, skillId, parsed.data.source, parsed.data.agentId, parsed.data.reason || 'Quarantined by the operator.')
      options.invalidateSkillLibraryCache(root)
      return apiSuccess(res, result)
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.get('/api/skills/quarantine', async (req, res) => {
    try {
      const agentId = queryAgentId(req.query.agentId)
      return apiSuccess(res, { skills: await skillWorkshop.listQuarantined(undefined, agentId) })
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.post('/api/skills/quarantine/:skillId/restore', async (req, res) => {
    const parsed = z.object({ source: z.enum(['library', 'agent']), agentId: z.string().regex(/^[a-z0-9-]+$/).optional() }).safeParse(req.body || {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid skill restore request', parsed.error.flatten())
    try {
      const skillId = options.slugifySkillId(req.params.skillId?.trim() || '')
      if (!SKILL_ID_PATTERN.test(skillId)) return apiFailure(res, 400, 'invalid_payload', 'Skill id is invalid')
      const root = await resolveSkillRoot(parsed.data.source, parsed.data.agentId)
      const result = await skillWorkshop.restore(root, skillId, parsed.data.source, parsed.data.agentId)
      options.invalidateSkillLibraryCache(root)
      return apiSuccess(res, result)
    } catch (error) {
      return skillWorkshopFailure(res, error)
    }
  })

  app.get('/api/skills/library/:skillId', async (req, res) => {
    try {
      const skillId = req.params.skillId?.trim()
      if (!skillId) return apiFailure(res, 400, 'invalid_payload', 'Skill id is required')
      const agentId = queryAgentId(req.query.agentId)
      const result = await options.findSkillContent(skillId, agentId)
      if (!result) return apiFailure(res, 404, 'skill_not_found', 'Skill not found')
      return apiSuccess(res, result)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to read skill content', String(error))
    }
  })

  app.post('/api/skills/learn', async (req, res) => {
    const schema = z.object({
      agentId: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1).max(120),
      description: z.string().min(1).max(1200),
      body: z.string().max(60000).default(''),
      shared: z.boolean().default(false),
      xpValue: z.number().int().min(0).max(5000).default(250),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const skill = await options.writeLearnedSkill(parsed.data)
      return apiSuccess(res, { skill })
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to save learned skill', String(error))
    }
  })

  app.get('/api/skills/clawhub/search', async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 12
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(30, rawLimit)) : 12
      const args = ['skills', 'search']
      if (query) args.push(query)
      args.push('--json', '--limit', String(limit))
      const result = await options.runOpenClawWithManagedSkillsWorkspace(args, 90000)
      if (result.code !== 0) {
        return apiFailure(
          res,
          502,
          'skill_command_failed',
          'ClawHub search failed',
          { output: result.stdout, error: result.stderr, code: result.code },
        )
      }
      const parsed = JSON.parse(result.stdout || '{"results":[]}') as { results?: unknown[] }
      const results = Array.isArray(parsed.results) ? parsed.results.map(normalizeClawHubSearchResult) : []
      return apiSuccess(res, { results })
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to search ClawHub', String(error))
    }
  })

  app.post('/api/skills/clawhub/preview', async (req, res) => {
    const schema = z.object({
      operation: z.enum(['install', 'update']),
      skillRef: z.string().trim().min(1).max(196),
      version: z.string().trim().min(1).max(80).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid skill preview request', parsed.error.flatten())
    const skillRef = resolveClawHubSkillReference(parsed.data)
    if (!skillRef) return apiFailure(res, 400, 'invalid_payload', 'Provide a valid ClawHub skill reference such as @owner/skill')
    try {
      const preview = await createSkillPreview(parsed.data.operation, skillRef, parsed.data.version)
      return apiSuccess(res, preview)
    } catch (error) {
      const message = error instanceof SkillWorkshopError || error instanceof SkillPreviewError
        ? error.message
        : 'Failed to create the isolated skill preview.'
      const status = (error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit')
        || /exceeds the (?:byte|entry|directory)/i.test(message) ? 413
        : /too many|budget/i.test(message) ? 429
          : 502
      return apiFailure(res, status, 'skill_operation_failed', message)
    }
  })

  app.post('/api/skills/clawhub/install', async (req, res) => {
    const schema = z.object({
      skillRef: z.string().trim().min(1).max(196).optional(),
      // Keep the legacy field for existing clients, but prefer the owner-qualified ref.
      slug: z.string().trim().min(1).max(196).optional(),
      version: z.string().min(1).max(80).optional(),
      force: z.boolean().default(false),
      confirmReview: z.boolean().default(false),
      confirmationId: z.string().uuid().optional(),
      previewId: z.string().uuid().optional(),
      confirmPreview: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const skillRef = resolveClawHubSkillReference(parsed.data)
    if (!skillRef) return apiFailure(res, 400, 'invalid_payload', 'Provide a valid ClawHub skill reference such as @owner/skill')
    const skillSlug = clawHubSkillSlug(skillRef)
    if (parsed.data.confirmPreview !== Boolean(parsed.data.previewId)) {
      return apiFailure(res, 400, 'invalid_payload', 'A skill preview must be explicitly confirmed before applying.')
    }
    const preview = parsed.data.previewId ? pendingSkillPreviews.get(parsed.data.previewId) : undefined
    if (parsed.data.previewId && !preview) {
      await discardSkillPreview(parsed.data.previewId)
      return apiFailure(res, 410, 'invalid_payload', 'This skill preview expired or was already used. Create a new preview.')
    }
    if (preview && preview.expiresAt <= currentTime()) {
      await discardSkillPreview(preview.previewId)
      return apiFailure(res, 410, 'invalid_payload', 'This skill preview expired. Create a new preview.')
    }
    const effectiveVersion = preview?.version || parsed.data.version
    if (preview && (preview.operation !== 'install' || preview.skillRef !== skillRef || preview.version !== effectiveVersion
      || (parsed.data.version && parsed.data.version !== preview.version))) {
      return apiFailure(res, 409, 'invalid_payload', 'The preview does not match this install request.')
    }

    if (parsed.data.confirmReview && !consumeClawHubConfirmation({
      confirmationId: parsed.data.confirmationId,
      operation: 'install',
      skillRef,
      version: parsed.data.version,
      force: parsed.data.force,
      all: false,
    })) {
      return apiFailure(res, 400, 'invalid_payload', 'This ClawHub review confirmation is missing, expired, or no longer matches the requested skill. Start the install again.')
    }

    try {
      if (preview) {
        const previewError = await validateSkillPreviewForApply(preview, 'install', skillRef, effectiveVersion || '')
        if (previewError) {
          await discardSkillPreview(preview.previewId)
          return apiFailure(res, 409, 'invalid_payload', previewError)
        }
      }
      await preflightSkillRoots()
      const existing = await options.readSkillEntryFromDir(options.sharedSkillsRoot, options.slugifySkillId(skillSlug), 'library')
      // Bare slugs are retained only for backwards compatibility. Scoped refs must
      // always reach OpenClaw so the publisher cannot be silently substituted.
      if (!skillRef.includes('/') && existing && !parsed.data.force) {
        return apiSuccess(res, {
          output: `Skill ${skillRef} is already installed in the shared OpenClaw skills folder.`,
          skill: existing,
          skillRef,
          alreadyInstalled: true,
          sharedRoot: options.sharedSkillsRoot,
        })
      }
      const args = ['skills', 'install', skillRef, '--global']
      if (effectiveVersion) args.push('--version', effectiveVersion)
      if (parsed.data.force) args.push('--force')
      if (parsed.data.confirmReview) args.push('--acknowledge-install-policy-warning')
      const install = await options.installClawHubSkillWithRetry(args, skillSlug)
      const { result } = install
      const quarantined = await preflightSkillRoots()
      options.invalidateSkillLibraryCache(options.sharedSkillsRoot)
      const skill = await options.readSkillEntryFromDir(options.sharedSkillsRoot, options.slugifySkillId(skillSlug), 'library')
      const data = {
        output: result.stdout,
        code: result.code,
        retried: install.retried,
        cleanup: install.cleanup,
        skill,
        skillRef,
        sharedRoot: options.sharedSkillsRoot,
        ...(quarantined.length ? { quarantined } : {}),
      }
      if (result.code !== 0) {
        if (!parsed.data.confirmReview) {
          const confirmation = issueClawHubConfirmation({
            operation: 'install',
            skillRef,
            version: effectiveVersion,
            force: parsed.data.force,
            output: `${result.stdout}\n${result.stderr}`,
          })
          if (confirmation) {
            return apiFailure(res, 409, 'skill_install_confirmation_required', 'ClawHub flagged this skill for review. Confirm the displayed risks to install it anyway.', {
              output: result.stdout,
              code: result.code,
              retried: install.retried,
              confirmation,
            })
          }
        }
        return apiFailure(res, 500, 'skill_command_failed', 'ClawHub skill install failed', { ...data, error: result.stderr })
      }
      if (preview) await discardSkillPreview(preview.previewId)
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to install ClawHub skill', String(error))
    }
  })

  app.post('/api/skills/clawhub/update', async (req, res) => {
    const schema = z.object({
      skillRef: z.string().trim().min(1).max(196).optional(),
      // Keep accepting slug while clients migrate to owner-qualified refs.
      slug: z.string().trim().min(1).max(196).optional(),
      version: z.string().trim().min(1).max(80).optional(),
      all: z.boolean().default(false),
      confirmReview: z.boolean().default(false),
      confirmationId: z.string().uuid().optional(),
      previewId: z.string().uuid().optional(),
      confirmPreview: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const skillRef = resolveClawHubSkillReference(parsed.data)
    if (!skillRef && !parsed.data.all) return apiFailure(res, 400, 'invalid_payload', 'Provide a skill reference or set all=true')
    if (skillRef && parsed.data.all) return apiFailure(res, 400, 'invalid_payload', 'Use either a skill reference or all=true, not both')
    if (!parsed.data.all && !skillRef) return apiFailure(res, 400, 'invalid_payload', 'Provide a valid ClawHub skill reference such as @owner/skill')
    if (parsed.data.confirmPreview !== Boolean(parsed.data.previewId)) {
      return apiFailure(res, 400, 'invalid_payload', 'A skill preview must be explicitly confirmed before applying.')
    }

    const updateSkillRef = skillRef || '@all'
    const preview = parsed.data.previewId ? pendingSkillPreviews.get(parsed.data.previewId) : undefined
    if (parsed.data.previewId && !preview) {
      await discardSkillPreview(parsed.data.previewId)
      return apiFailure(res, 410, 'invalid_payload', 'This skill preview expired or was already used. Create a new preview.')
    }
    if (preview && preview.expiresAt <= currentTime()) {
      await discardSkillPreview(preview.previewId)
      return apiFailure(res, 410, 'invalid_payload', 'This skill preview expired. Create a new preview.')
    }
    const effectiveVersion = preview?.version || parsed.data.version
    if (preview && (parsed.data.all || preview.operation !== 'update' || preview.skillRef !== skillRef
      || preview.version !== effectiveVersion || (parsed.data.version && parsed.data.version !== preview.version))) {
      return apiFailure(res, 409, 'invalid_payload', 'The preview does not match this update request.')
    }
    if (parsed.data.confirmReview && !consumeClawHubConfirmation({
      confirmationId: parsed.data.confirmationId,
      operation: 'update',
      skillRef: updateSkillRef,
      version: parsed.data.version,
      force: false,
      all: parsed.data.all,
    })) {
      return apiFailure(res, 400, 'invalid_payload', 'This ClawHub review confirmation is missing, expired, or no longer matches the requested update. Start the update again.')
    }

    try {
      if (preview) {
        const previewError = await validateSkillPreviewForApply(preview, 'update', skillRef || '', effectiveVersion || '')
        if (previewError) {
          await discardSkillPreview(preview.previewId)
          return apiFailure(res, 409, 'invalid_payload', previewError)
        }
      }
      await preflightSkillRoots()
      const args = parsed.data.all ? ['skills', 'update', '--all', '--global'] : ['skills', 'update', skillRef, '--global']
      if (parsed.data.confirmReview) args.push('--acknowledge-install-policy-warning')
      const result = await options.runOpenClawWithManagedSkillsWorkspace(args, 180000)
      const quarantined = await preflightSkillRoots()
      options.invalidateSkillLibraryCache(options.sharedSkillsRoot)
      const shared = await options.listSkillsFromRoot(options.sharedSkillsRoot, 'library')
      const data = {
        output: result.stdout,
        code: result.code,
        ...(skillRef ? { skillRef } : {}),
        ...(quarantined.length ? { quarantined } : {}),
        shared,
        sharedRoot: options.sharedSkillsRoot,
      }
      if (result.code !== 0) {
        if (!parsed.data.confirmReview) {
          const confirmation = issueClawHubConfirmation({
            operation: 'update',
            skillRef: updateSkillRef,
            version: effectiveVersion,
            all: parsed.data.all,
            output: `${result.stdout}\n${result.stderr}`,
          })
          if (confirmation) {
            return apiFailure(res, 409, 'skill_install_confirmation_required', 'ClawHub flagged this update for review. Confirm the displayed risks to continue anyway.', {
              output: result.stdout,
              code: result.code,
              confirmation,
            })
          }
        }
        return apiFailure(res, 500, 'skill_command_failed', 'ClawHub skill update failed', { ...data, error: result.stderr })
      }
      if (preview) await discardSkillPreview(preview.previewId)
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to update ClawHub skill', String(error))
    }
  })
}

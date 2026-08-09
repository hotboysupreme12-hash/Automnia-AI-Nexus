import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

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
}

const CLAWHUB_SKILL_REFERENCE_PATTERN = /^(?:@?[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/i

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

export function registerSkillRoutes(app: Express, options: SkillRoutesOptions) {
  app.get('/api/skills/check', async (req, res) => {
    try {
      const agentId = queryAgentId(req.query.agentId)
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
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to load skill library', String(error))
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
      return apiSuccess(res, { results: Array.isArray(parsed.results) ? parsed.results : [] })
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to search ClawHub', String(error))
    }
  })

  app.post('/api/skills/clawhub/install', async (req, res) => {
    const schema = z.object({
      skillRef: z.string().trim().min(1).max(196).optional(),
      // Keep the legacy field for existing clients, but prefer the owner-qualified ref.
      slug: z.string().trim().min(1).max(196).optional(),
      version: z.string().min(1).max(80).optional(),
      force: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const skillRef = resolveClawHubSkillReference(parsed.data)
    if (!skillRef) return apiFailure(res, 400, 'invalid_payload', 'Provide a valid ClawHub skill reference such as @owner/skill')
    const skillSlug = clawHubSkillSlug(skillRef)

    try {
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
      if (parsed.data.version) args.push('--version', parsed.data.version)
      if (parsed.data.force) args.push('--force')
      const install = await options.installClawHubSkillWithRetry(args, skillSlug)
      const { result } = install
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
      }
      if (result.code !== 0) {
        return apiFailure(res, 500, 'skill_command_failed', 'ClawHub skill install failed', { ...data, error: result.stderr })
      }
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
      all: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    const skillRef = resolveClawHubSkillReference(parsed.data)
    if (!skillRef && !parsed.data.all) return apiFailure(res, 400, 'invalid_payload', 'Provide a skill reference or set all=true')
    if (skillRef && parsed.data.all) return apiFailure(res, 400, 'invalid_payload', 'Use either a skill reference or all=true, not both')
    if (!parsed.data.all && !skillRef) return apiFailure(res, 400, 'invalid_payload', 'Provide a valid ClawHub skill reference such as @owner/skill')

    try {
      const args = parsed.data.all ? ['skills', 'update', '--all', '--global'] : ['skills', 'update', skillRef, '--global']
      const result = await options.runOpenClawWithManagedSkillsWorkspace(args, 180000)
      options.invalidateSkillLibraryCache(options.sharedSkillsRoot)
      const shared = await options.listSkillsFromRoot(options.sharedSkillsRoot, 'library')
      const data = {
        output: result.stdout,
        code: result.code,
        ...(skillRef ? { skillRef } : {}),
        shared,
        sharedRoot: options.sharedSkillsRoot,
      }
      if (result.code !== 0) {
        return apiFailure(res, 500, 'skill_command_failed', 'ClawHub skill update failed', { ...data, error: result.stderr })
      }
      return apiSuccess(res, data)
    } catch (error) {
      return apiFailure(res, 500, 'skill_operation_failed', 'Failed to update ClawHub skill', String(error))
    }
  })
}

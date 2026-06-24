import type { Express } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type AgentIdentity = {
  name?: string
  emoji?: string
  theme?: string
  avatar?: string
}

type AgentModelSelection = {
  primary?: string
  fallbacks?: string[]
}

type AgentConfigEntry = {
  id: string
  workspace?: string
  agentDir?: string
  identity?: AgentIdentity
  name?: string
  model?: AgentModelSelection
  [key: string]: unknown
}

type OpenClawConfigFile = {
  agents?: {
    list?: AgentConfigEntry[]
    defaults?: {
      workspace?: string
      model?: AgentModelSelection
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

type AgentLocalConfig = {
  agent: {
    displayName: string
    aliases: string[]
    updatedAt: string
    [key: string]: unknown
  }
  identity: {
    name: string
    emoji?: string
    theme?: string
    avatar?: string
  }
  routing?: {
    workspace?: string
    canonicalFolder?: string
  }
  [key: string]: unknown
}

type AgentResourceContext = {
  config: OpenClawConfigFile
  target: AgentConfigEntry
  workspace: string
  executionWorkspace: string
  canonicalWorkspace: string
  doctrineWorkspace: string
}

type FolderPickerSession = {
  id: string
  status: 'pending' | 'selected' | 'cancelled' | 'error'
  path?: string | null
  detail?: string
  startedAt: number
  updatedAt: number
  expiresAt: number
}

type ImagePickerSession = FolderPickerSession & {
  agentId?: string
  sourcePath?: string | null
  avatar?: string | null
  previewUrl?: string | null
}

type FilesystemRoutesOptions = {
  agentLocalConfigPath: (agentId: string) => string
  applyLocalConfigToGlobal: (agentId: string, local: AgentLocalConfig, config: OpenClawConfigFile) => void
  canonicalResourcePath: (agentId: string, file: string) => string
  deriveAgentAliases: (agentId: string, displayName: string) => string[]
  editorResourceFiles: readonly string[]
  ensureAgentLocalConfig: (params: {
    agentId: string
    entry?: AgentConfigEntry
    defaultsModel?: AgentModelSelection
  }) => Promise<AgentLocalConfig>
  extractIdentityNameFromMarkdown: (markdown: string) => string | null
  getAgentById: (agentId: string) => Promise<{ config: OpenClawConfigFile; target?: AgentConfigEntry }>
  getFolderPickerSession: (sessionId: string) => FolderPickerSession | undefined
  getImagePickerSession: (sessionId: string) => ImagePickerSession | undefined
  isMarkdownResourceFile: (file: string) => boolean
  isValidAgentId: (agentId: string) => boolean
  mirrorSharedTeamFile: (file: string, content: string) => Promise<void>
  normalizePickerStartPath: (startPath?: string, fallbackPath?: string) => string
  pickFolderWithOsDialog: (
    startPath?: string,
    abortSignal?: AbortSignal,
  ) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; detail?: string }>
  pruneFolderPickerSessions: () => void
  propagateDisplayNameAcrossAgentFiles: (agentId: string, previousName: string | null, local: AgentLocalConfig) => Promise<void>
  readAgentLocalConfigIfPresent: (agentId: string) => Promise<AgentLocalConfig | null | undefined>
  rememberAgentLocalConfigCache: (filePath: string, local: AgentLocalConfig) => Promise<void>
  resolveAgentResourceContext: (agentId: string, seedFiles?: readonly string[]) => Promise<AgentResourceContext | null>
  resolveWorkspaceForAgent: (target: AgentConfigEntry | undefined, agentId: string, defaultsWorkspace?: string) => string
  samePath: (left: string, right: string) => boolean
  saveAgentFileToCodexProfile: (agentId: string, file: string, content: string) => Promise<void>
  serializeFolderPickerSession: (session: FolderPickerSession) => Record<string, unknown>
  serializeImagePickerSession: (session: ImagePickerSession) => Record<string, unknown>
  sharedTeamFiles: readonly string[]
  startFolderPickerSession: (startPath: string) => FolderPickerSession
  startImagePickerSession: (agentId: string | undefined, startPath: string) => ImagePickerSession
  syncDoctrineToWorkspace: (agentId: string, workspace: string) => Promise<void>
  workspaceRoot: string
  writeOpenclawConfig: (config: OpenClawConfigFile) => Promise<void>
  writeTextFileWithLockRetry: (filePath: string, content: string) => Promise<void>
}

const FOLDER_LIST_CACHE_MS = 30_000
const folderListCache = new Map<string, { expiresAt: number; value: { base: string; folders: string[] } }>()

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function resourceSeedFiles(options: FilesystemRoutesOptions, file: string) {
  return options.editorResourceFiles.includes(file) ? [file] : []
}

export function registerFilesystemRoutes(app: Express, options: FilesystemRoutesOptions) {
  app.get('/api/party/resources/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')

    try {
      const context = await options.resolveAgentResourceContext(agentId)
      if (!context) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      const entries = await fs.readdir(context.canonicalWorkspace, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
      return apiSuccess(res, {
        agentId,
        workspace: context.workspace,
        executionWorkspace: context.executionWorkspace,
        canonicalWorkspace: context.canonicalWorkspace,
        doctrineWorkspace: context.doctrineWorkspace,
        files,
      })
    } catch (error) {
      return apiFailure(res, 500, 'filesystem_operation_failed', 'Failed to fetch agent resources', String(error))
    }
  })

  app.get('/api/party/resources/:agentId/:file', async (req, res) => {
    const { agentId, file } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (!options.isMarkdownResourceFile(file)) return apiFailure(res, 400, 'invalid_payload', 'Resource file not allowed.')

    try {
      const context = await options.resolveAgentResourceContext(agentId, resourceSeedFiles(options, file))
      if (!context) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      const filePath = options.canonicalResourcePath(agentId, file)
      const content = await fs.readFile(filePath, 'utf-8')
      return apiSuccess(res, {
        agentId,
        workspace: context.workspace,
        executionWorkspace: context.executionWorkspace,
        canonicalWorkspace: context.canonicalWorkspace,
        doctrineWorkspace: context.doctrineWorkspace,
        file,
        resourcePath: filePath,
        content,
      })
    } catch (error) {
      const status = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500
      return apiFailure(
        res,
        status,
        status === 404 ? 'resource_not_found' : 'filesystem_operation_failed',
        status === 404 ? 'Resource file not found' : 'Could not read resource file',
        String(error),
      )
    }
  })

  app.put('/api/party/resources/:agentId/:file', async (req, res) => {
    const { agentId, file } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (!options.isMarkdownResourceFile(file)) return apiFailure(res, 400, 'invalid_payload', 'Resource file not allowed.')
    const schema = z.object({ content: z.string() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const context = await options.resolveAgentResourceContext(agentId, resourceSeedFiles(options, file))
      if (!context) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      await fs.mkdir(context.canonicalWorkspace, { recursive: true })
      const filePath = options.canonicalResourcePath(agentId, file)
      await fs.writeFile(filePath, parsed.data.content, 'utf-8')
      const persisted = await fs.readFile(filePath, 'utf-8')
      if (persisted !== parsed.data.content) {
        return apiFailure(
          res,
          500,
          'filesystem_operation_failed',
          'Canonical save verification failed.',
          { expectedPath: filePath, persistedPath: filePath },
        )
      }
      await options.saveAgentFileToCodexProfile(agentId, file, parsed.data.content)

      if (file.toUpperCase() === 'IDENTITY.MD') {
        const parsedName = options.extractIdentityNameFromMarkdown(parsed.data.content)
        if (parsedName) {
          const existingLocal = await options.readAgentLocalConfigIfPresent(agentId)
          const currentName = existingLocal?.identity?.name || context.target.identity?.name || context.target.name || ''
          if (parsedName !== currentName) {
            const local = await options.ensureAgentLocalConfig({
              agentId,
              entry: context.target,
              defaultsModel: context.config.agents?.defaults?.model || {},
            })
            const previousName = local.identity.name || local.agent.displayName || ''
            local.identity.name = parsedName
            local.agent.displayName = parsedName
            local.agent.aliases = options.deriveAgentAliases(agentId, parsedName)
            local.agent.updatedAt = new Date().toISOString()
            await options.writeTextFileWithLockRetry(options.agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
            await options.rememberAgentLocalConfigCache(options.agentLocalConfigPath(agentId), local)
            await options.propagateDisplayNameAcrossAgentFiles(agentId, previousName, local)
            options.applyLocalConfigToGlobal(agentId, local, context.config)
            await options.writeOpenclawConfig(context.config)
          }
        }
      }

      if (options.sharedTeamFiles.includes(file)) {
        await options.mirrorSharedTeamFile(file, parsed.data.content)
      }
      if (!options.samePath(context.executionWorkspace, context.canonicalWorkspace)) {
        await options.syncDoctrineToWorkspace(agentId, context.executionWorkspace)
      }
      return apiSuccess(res, {
        agentId,
        workspace: context.workspace,
        executionWorkspace: context.executionWorkspace,
        canonicalWorkspace: context.canonicalWorkspace,
        doctrineWorkspace: context.doctrineWorkspace,
        file,
        resourcePath: filePath,
      })
    } catch (error) {
      return apiFailure(res, 500, 'filesystem_operation_failed', 'Failed to update resource file', String(error))
    }
  })

  app.get('/api/party/folders', async (req, res) => {
    const base = typeof req.query.path === 'string' && req.query.path.trim() ? req.query.path : options.workspaceRoot
    const full = path.resolve(base)
    try {
      const cacheKey = full.toLowerCase()
      const cached = folderListCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return apiSuccess(res, cloneJson(cached.value))
      }
      const entries = await fs.readdir(full, { withFileTypes: true })
      const folders = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(full, entry.name))
        .slice(0, 200)
      const payload = { base: full, folders }
      folderListCache.set(cacheKey, { expiresAt: Date.now() + FOLDER_LIST_CACHE_MS, value: cloneJson(payload) })
      return apiSuccess(res, payload)
    } catch (error) {
      return apiFailure(res, 400, 'folder_list_failed', 'Could not list folders', String(error))
    }
  })

  app.post('/api/party/folder-picker', async (req, res) => {
    const schema = z.object({
      startPath: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const startPath = options.normalizePickerStartPath(parsed.data.startPath)
    const controller = new AbortController()
    req.once('aborted', () => controller.abort())
    const picked = await options.pickFolderWithOsDialog(startPath, controller.signal)
    if (res.writableEnded) return

    if (picked.ok && picked.path) {
      return apiSuccess(res, { status: 'selected', path: path.resolve(picked.path), cancelled: false, detail: 'Folder selected.' })
    }
    if (picked.cancelled) {
      return apiSuccess(res, { status: 'cancelled', path: null, cancelled: true, detail: 'No folder selected.' })
    }
    return apiFailure(
      res,
      501,
      'folder_picker_failed',
      'Folder picker unavailable',
      picked.detail || 'No supported native folder picker is available in this environment.',
    )
  })

  app.post('/api/party/folder-picker/start', async (req, res) => {
    const schema = z.object({
      startPath: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const startPath = options.normalizePickerStartPath(parsed.data.startPath)
    const session = options.startFolderPickerSession(startPath)
    return apiSuccess(res, options.serializeFolderPickerSession(session))
  })

  app.get('/api/party/folder-picker/:sessionId', (req, res) => {
    options.pruneFolderPickerSessions()
    const session = options.getFolderPickerSession(String(req.params.sessionId || ''))
    if (!session) {
      return apiFailure(
        res,
        404,
        'folder_picker_failed',
        'Folder picker session not found.',
        'The folder picker session expired. Press Browse again.',
      )
    }
    return apiSuccess(res, options.serializeFolderPickerSession(session))
  })

  app.post('/api/party/avatar-picker/start', async (req, res) => {
    const schema = z.object({
      agentId: z.string().min(1),
      startPath: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    if (!options.isValidAgentId(parsed.data.agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')

    try {
      const { config, target } = await options.getAgentById(parsed.data.agentId)
      if (!target) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${parsed.data.agentId}`)

      const fallbackStart = path.resolve(options.resolveWorkspaceForAgent(target, target.id, config.agents?.defaults?.workspace))
      const startPath = options.normalizePickerStartPath(parsed.data.startPath, fallbackStart)
      const session = options.startImagePickerSession(target.id, startPath)
      return apiSuccess(res, options.serializeImagePickerSession(session))
    } catch (error) {
      return apiFailure(res, 500, 'image_picker_failed', 'Failed to start image picker', String(error))
    }
  })

  app.get('/api/party/avatar-picker/:sessionId', (req, res) => {
    options.pruneFolderPickerSessions()
    const session = options.getImagePickerSession(String(req.params.sessionId || ''))
    if (!session) {
      return apiFailure(
        res,
        404,
        'image_picker_failed',
        'Image picker session not found.',
        'The image picker session expired. Press Browse again.',
      )
    }
    return apiSuccess(res, options.serializeImagePickerSession(session))
  })
}
